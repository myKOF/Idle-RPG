'use strict';
/* ============================================================
   vfx-editor-rename.test.cjs — VFX Editor「重新命名」

   需求（2026-09-18）：特效除了另存新檔，也要能直接改名。

   受測對象：
     tools/vfx/editor-server.cjs   POST /__rename-preset：特效檔與分組檔一起換名字、
                                   檔案裡的名字跟著換、有人用的不改、途中失敗就還原
     tools/vfx/editor/editor.js    「重新命名」按鈕的流程接線

   伺服器一律打真的 HTTP，每個案例在自己的沙箱 repo 裡跑。「沒有動到別的檔」一律拿整棵樹
   （含 repo 外的 outside/）的路徑 ＋ sha256 快照前後比對，不是只看那兩個檔。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const editorServer = require('../tools/vfx/editor-server.cjs');
const VFXCore = require('../js/vfx-core.js');
const LayoutSchema = require('../tools/vfx/editor/layout-schema.js');

const REPO = path.resolve(__dirname, '..');
/* 沙箱放三份真的 preset（連同分組檔），內容用 repo 裡的實物，不手寫假的 */
const PICK = ['demo-basic', 'burst-explosion-sheet', 'ground-mire-venom'];

/* ---------------- 沙箱 ---------------- */

function makeRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-rename-'));
  const repoRoot = path.join(base, 'repo');
  const presets = path.join(repoRoot, 'vfx', 'presets');
  const layouts = path.join(repoRoot, 'vfx', 'layouts');
  fs.mkdirSync(presets, { recursive: true });
  fs.mkdirSync(layouts, { recursive: true });
  PICK.forEach(function (id) {
    fs.copyFileSync(path.join(REPO, 'vfx', 'presets', id + '.json'), path.join(presets, id + '.json'));
    fs.copyFileSync(path.join(REPO, 'vfx', 'layouts', id + '.json'), path.join(layouts, id + '.json'));
  });
  fs.mkdirSync(path.join(repoRoot, 'js'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'js', 'important.js'), 'REPO CANARY\n');
  fs.mkdirSync(path.join(base, 'outside'), { recursive: true });
  fs.writeFileSync(path.join(base, 'outside', 'canary.txt'), 'OUTSIDE CANARY\n');
  return { base: base, repoRoot: repoRoot, presets: presets, layouts: layouts };
}

/* 路徑 → sha256（目錄記成 [dir]、連結記成 [link] 不跟進去）。比內容，不是只數檔案。 */
function snapshotMap(root) {
  const out = {};
  (function walk(dir, rel) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (item) {
      const abs = path.join(dir, item.name);
      const r = rel ? rel + '/' + item.name : item.name;
      if (item.isSymbolicLink()) { out[r] = '[link]'; return; }
      if (item.isDirectory()) { out[r] = '[dir]'; walk(abs, r); return; }
      out[r] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    });
  })(root, '');
  return out;
}

function changedPaths(before, after) {
  const keys = Object.keys(before).concat(Object.keys(after))
    .filter(function (k, i, all) { return all.indexOf(k) === i; });
  return keys.filter(function (k) { return before[k] !== after[k]; }).sort();
}

function leftovers(sb) {
  return fs.readdirSync(sb.presets).concat(fs.readdirSync(sb.layouts))
    .filter(function (f) { return f.indexOf(editorServer.TEMP_PREFIX) === 0; });
}

function readJson(dir, id) {
  return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
}

/* 每個案例：建沙箱 → 起伺服器 → 跑 → 收攤（保證執行）。ctx 交給案例，hooks 可以中途換。 */
function withRepo(fn) {
  return async function () {
    const sb = makeRepo();
    const ctx = {
      repoRoot: sb.repoRoot, assetRoots: {}, hooks: null, syncCalls: 0,
      syncAssets: function () { ctx.syncCalls++; }
    };
    const server = editorServer.__testOnly.createServer(ctx);
    await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
    try {
      await fn(sb, server.address().port, ctx);
    } finally {
      await new Promise(function (resolve) { server.close(resolve); });
      fs.rmSync(sb.base, { recursive: true, force: true });
    }
  };
}

function request(port, opts, bodyBuf) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      host: '127.0.0.1', port: port, method: opts.method || 'GET', path: opts.path,
      headers: opts.headers || {}, agent: false
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 非 JSON 回應 */ }
        resolve({ status: res.statusCode, text: text, json: json });
      });
    });
    req.on('error', reject);
    req.end(bodyBuf);
  });
}

/* body 是物件就 JSON 化；是字串就原樣送（測壞掉的 JSON 用） */
function post(port, body, headers) {
  const data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return request(port, {
    method: 'POST', path: editorServer.RENAME_PATH,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': data.length }, headers || {})
  }, data);
}

/* ============================================================
   成功的路
   ============================================================ */

test('RENAME-1 改名：特效檔與分組檔一起換名字、檔案裡的名字跟著換，其他檔一個 byte 都沒動', withRepo(async function (sb, port, ctx) {
  const before = snapshotMap(sb.base);
  const original = readJson(sb.presets, 'demo-basic');
  const originalLayout = readJson(sb.layouts, 'demo-basic');

  const res = await post(port, { from: 'demo-basic', to: 'demo-basic-renamed' });
  assert.equal(res.status, 200, res.text);
  assert.deepStrictEqual(res.json, { ok: true, from: 'demo-basic', to: 'demo-basic-renamed', layout: true });

  assert.equal(fs.readFileSync(path.join(sb.presets, 'demo-basic-renamed.json'), 'utf8'),
    VFXCore.serialisePreset(Object.assign({}, original, { id: 'demo-basic-renamed' })),
    '內容就是原本那一份換掉 id，而且走存檔同一條 canonical 序列化');
  const layout = readJson(sb.layouts, 'demo-basic-renamed');
  assert.ok(LayoutSchema.validateLayout(layout).ok);
  assert.equal(layout.presetId, 'demo-basic-renamed');
  assert.deepStrictEqual(layout.groups.map(function (g) { return [g.id, g.name]; }),
    [['demo-basic-renamed', 'demo-basic-renamed']], '根群組的 id 與名稱跟著換（LAYOUT-4）');
  assert.deepStrictEqual(layout.order, ['group:demo-basic-renamed']);
  assert.deepStrictEqual(layout.groups[0].layerIds, originalLayout.groups[0].layerIds, '群組收的圖層不變');

  assert.deepStrictEqual(changedPaths(before, snapshotMap(sb.base)), [
    'repo/vfx/layouts/demo-basic-renamed.json', 'repo/vfx/layouts/demo-basic.json',
    'repo/vfx/presets/demo-basic-renamed.json', 'repo/vfx/presets/demo-basic.json'
  ], '只有這四個路徑有變化：舊的兩個不見、新的兩個出現');
  assert.ok(!fs.existsSync(path.join(sb.presets, 'demo-basic.json')));
  assert.ok(!fs.existsSync(path.join(sb.layouts, 'demo-basic.json')));
  assert.deepStrictEqual(leftovers(sb), [], '不留暫存檔');
  /* 改名不改內容、用到的素材一張也沒變，所以不跑素材同步（見 editor-server.cjs 重新命名的說明） */
  assert.equal(ctx.syncCalls, 0);

  const list = await request(port, { path: '/__presets' });
  assert.ok(list.json.presets.indexOf('demo-basic-renamed') >= 0, '清單要出現新名字');
  assert.ok(list.json.presets.indexOf('demo-basic') < 0, '舊名字要從清單消失');
}));

test('RENAME-2 沒有分組檔的特效只搬特效檔，不會憑空多出一份分組檔', withRepo(async function (sb, port) {
  fs.unlinkSync(path.join(sb.layouts, 'burst-explosion-sheet.json'));
  const before = snapshotMap(sb.base);
  const res = await post(port, { from: 'burst-explosion-sheet', to: 'burst-renamed' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.layout, false);
  assert.deepStrictEqual(changedPaths(before, snapshotMap(sb.base)),
    ['repo/vfx/presets/burst-explosion-sheet.json', 'repo/vfx/presets/burst-renamed.json']);
  assert.equal(readJson(sb.presets, 'burst-renamed').id, 'burst-renamed');
}));

test('RENAME-3 開頭有 BOM 的檔照樣能改（瀏覽器打得開的，改名不能說它壞了）', withRepo(async function (sb, port) {
  const file = path.join(sb.presets, 'ground-mire-venom.json');
  fs.writeFileSync(file, '\uFEFF' + fs.readFileSync(file, 'utf8'));
  const res = await post(port, { from: 'ground-mire-venom', to: 'mire-renamed' });
  assert.equal(res.status, 200, res.text);
  const text = fs.readFileSync(path.join(sb.presets, 'mire-renamed.json'), 'utf8');
  assert.notEqual(text.charAt(0), '\uFEFF', '寫出去的是 canonical 形式，不帶 BOM');
  assert.equal(JSON.parse(text).id, 'mire-renamed');
}));

/* ============================================================
   有人用的不改
   ============================================================ */

test('RENAME-4 有人用的特效不改名：列出用在哪裡；dryRun 只檢查；問名字之後才加的引用也擋得住', withRepo(async function (sb, port) {
  fs.writeFileSync(path.join(sb.repoRoot, 'js', 'data.js'), "var X = { hit: 'demo-basic' };\n");
  fs.mkdirSync(path.join(sb.repoRoot, 'vfx', 'coverage-specs'));
  fs.writeFileSync(path.join(sb.repoRoot, 'vfx', 'coverage-specs', 'demo-basic.json'), '{}');
  const before = snapshotMap(sb.base);
  const blockers = ['覆蓋規格 vfx/coverage-specs/demo-basic.json', '程式碼 js/data.js'];

  let res = await post(port, { from: 'demo-basic', dryRun: true });
  assert.equal(res.status, 200, res.text);
  assert.deepStrictEqual(res.json, { ok: true, dryRun: true, from: 'demo-basic', blockers: blockers });

  res = await post(port, { from: 'demo-basic', to: 'demo-x' });
  assert.equal(res.status, 409, res.text);
  assert.deepStrictEqual(res.json.blockers, blockers);
  assert.deepStrictEqual(changedPaths(before, snapshotMap(sb.base)), [], 'dryRun 與被擋下的改名都不動任何檔');

  /* 頁面先 dryRun（沒人用）→ 使用者慢慢取名字 → 這段時間有人把它寫進程式 → 真正改名時要再擋一次 */
  res = await post(port, { from: 'burst-explosion-sheet', dryRun: true });
  assert.deepStrictEqual(res.json.blockers, []);
  fs.writeFileSync(path.join(sb.repoRoot, 'js', 'later.js'), "play('burst-explosion-sheet');\n");
  res = await post(port, { from: 'burst-explosion-sheet', to: 'burst-x' });
  assert.equal(res.status, 409, '改名時要重新檢查，不能只信頁面先前的 dryRun');
  assert.deepStrictEqual(res.json.blockers, ['程式碼 js/later.js']);
  assert.ok(fs.existsSync(path.join(sb.presets, 'burst-explosion-sheet.json')));

  res = await post(port, { from: 'no-such-preset', dryRun: true });
  assert.equal(res.status, 404);
}));

/* ============================================================
   不蓋掉任何檔、不收不合法的輸入
   ============================================================ */

test('RENAME-5 新名字已經有特效、或有殘留的分組檔：擋下，一個檔都不動', withRepo(async function (sb, port) {
  const before = snapshotMap(sb.base);
  let res = await post(port, { from: 'demo-basic', to: 'burst-explosion-sheet' });
  assert.equal(res.status, 409, res.text);
  assert.match(res.json.error, /已經有一份叫「burst-explosion-sheet」/);
  assert.deepStrictEqual(changedPaths(before, snapshotMap(sb.base)), []);

  /* 只有分組檔、沒有特效：接收下來的話，改名後的特效會套上別人的分組 */
  fs.writeFileSync(path.join(sb.layouts, 'leftover.json'), '{"x":1}');
  const before2 = snapshotMap(sb.base);
  res = await post(port, { from: 'demo-basic', to: 'leftover' });
  assert.equal(res.status, 409, res.text);
  assert.match(res.json.error, /殘留的分組檔/);
  assert.deepStrictEqual(changedPaths(before2, snapshotMap(sb.base)), []);
}));

test('RENAME-6 名字不合法、不存在、或與原本相同：擋下，一個檔都不動', withRepo(async function (sb, port) {
  const before = snapshotMap(sb.base);
  for (const from of ['../demo-basic', 'demo-basic.json', 'Demo-Basic', '', null, 42, 'con', '..\\demo-basic']) {
    const res = await post(port, { from: from, to: 'ok-name' });
    assert.equal(res.status, 400, 'from=' + JSON.stringify(from) + ' 應該被擋：' + res.text);
  }
  for (const to of [undefined, '', '../x', 'X', 'con', 'a/b', 'a.json', 'x'.repeat(65)]) {
    const res = await post(port, { from: 'demo-basic', to: to });
    assert.equal(res.status, 400, 'to=' + JSON.stringify(to) + ' 應該被擋：' + res.text);
  }
  let res = await post(port, { from: 'demo-basic', to: 'demo-basic' });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /相同/);
  res = await post(port, { from: 'no-such-preset', to: 'ok-name' });
  assert.equal(res.status, 404);
  assert.deepStrictEqual(changedPaths(before, snapshotMap(sb.base)), []);
}));

test('RENAME-7 寫入防護與存檔 API 同一套：跨來源、非 loopback Host、非 JSON、太大都擋掉', withRepo(async function (sb, port) {
  const before = snapshotMap(sb.base);
  const body = { from: 'demo-basic', to: 'demo-x' };
  let res = await post(port, body, { Origin: 'http://evil.example' });
  assert.equal(res.status, 403, '隨便一個網頁不能改使用者 repo 裡的檔名');
  res = await post(port, body, { Origin: 'null' });
  assert.equal(res.status, 403);
  res = await post(port, body, { Host: 'evil.example' });
  assert.equal(res.status, 403, 'DNS rebinding 時 Host 會是別人的網域');
  res = await post(port, body, { 'Content-Type': 'text/plain' });
  assert.equal(res.status, 403, '不是 JSON 的話跨來源不必 preflight，要擋');
  res = await post(port, '{not json');
  assert.equal(res.status, 400);
  res = await post(port, { from: 'demo-basic', to: 'demo-x', pad: 'x'.repeat(5000) });
  assert.equal(res.status, 413);
  res = await request(port, { method: 'PUT', path: editorServer.RENAME_PATH,
    headers: { 'Content-Type': 'application/json' } }, Buffer.from(JSON.stringify(body)));
  assert.equal(res.status, 400, 'PUT 不是改名：交給存檔路由，那裡不認得這個路徑');
  assert.deepStrictEqual(changedPaths(before, snapshotMap(sb.base)), []);
}));

test('RENAME-8 內容不合法（特效、分組、不是 JSON）就不改名：寫出去的檔都要是載得起來的', withRepo(async function (sb, port) {
  const bad = readJson(sb.presets, 'demo-basic');
  bad.layers[0].alpha = 5;
  fs.writeFileSync(path.join(sb.presets, 'demo-basic.json'), JSON.stringify(bad));
  fs.writeFileSync(path.join(sb.layouts, 'burst-explosion-sheet.json'), '{"schemaVersion":1}');
  fs.writeFileSync(path.join(sb.presets, 'ground-mire-venom.json'), '{');
  const before = snapshotMap(sb.base);

  let res = await post(port, { from: 'demo-basic', to: 'demo-x' });
  assert.equal(res.status, 400, res.text);
  assert.match(res.json.error, /Preset 目前不合法/);
  assert.ok(res.json.problems.length > 0, '要附上哪裡不合法');
  res = await post(port, { from: 'burst-explosion-sheet', to: 'burst-x' });
  assert.equal(res.status, 400, res.text);
  assert.match(res.json.error, /分組檔/);
  res = await post(port, { from: 'ground-mire-venom', to: 'mire-x' });
  assert.equal(res.status, 400, res.text);
  assert.match(res.json.error, /不是合法的 JSON/);
  assert.deepStrictEqual(changedPaths(before, snapshotMap(sb.base)), []);
}));

/* ============================================================
   途中失敗
   ============================================================ */

const STEPS = ['write-preset', 'write-layout', 'remove-old-layout', 'remove-old-preset'];

test('RENAME-9 動檔的每一步失敗都倒回去：整棵樹與改名前一模一樣', async function () {
  for (const failAt of STEPS) {
    await withRepo(async function (sb, port, ctx) {
      const seen = [];
      ctx.hooks = {
        renameStep: function (name) {
          seen.push(name);
          if (name === failAt) throw new Error('注入：' + name + ' 失敗');
        }
      };
      const before = snapshotMap(sb.base);
      const res = await post(port, { from: 'demo-basic', to: 'demo-x' });
      assert.equal(res.status, 500, failAt + '：' + res.text);
      assert.match(res.json.error, /已還原/);
      assert.equal(res.json.incomplete, false);
      assert.deepStrictEqual(changedPaths(before, snapshotMap(sb.base)), [], failAt + ' 失敗後要完全還原');
      assert.deepStrictEqual(leftovers(sb), []);
      /* 先寫新的、再刪舊的：途中當掉最多是新舊並存，不會兩份都沒有 */
      assert.deepStrictEqual(seen.filter(function (s) { return s.indexOf('undo:') < 0; }),
        STEPS.slice(0, STEPS.indexOf(failAt) + 1));
    })();
  }
});

test('RENAME-10 落檔本身失敗（暫存檔換上去的那一步）也一樣還原', withRepo(async function (sb, port, ctx) {
  ctx.hooks = {
    beforeRename: function (tempAbs, targetAbs) {
      if (path.basename(targetAbs) === 'demo-x.json' && path.basename(path.dirname(targetAbs)) === 'layouts') {
        throw new Error('注入：分組檔落檔失敗');
      }
    }
  };
  const before = snapshotMap(sb.base);
  const res = await post(port, { from: 'demo-basic', to: 'demo-x' });
  assert.equal(res.status, 500, res.text);
  assert.match(res.json.error, /注入：分組檔落檔失敗/);
  assert.deepStrictEqual(changedPaths(before, snapshotMap(sb.base)), []);
  assert.deepStrictEqual(leftovers(sb), []);
}));

test('RENAME-11 還原也失敗時停在那一步，照磁碟上現在的樣子回報，不把僅存的一份刪掉', withRepo(async function (sb, port, ctx) {
  const layoutBefore = readJson(sb.layouts, 'demo-basic');
  ctx.hooks = {
    renameStep: function (name) {
      if (name === 'remove-old-preset') throw new Error('注入：舊特效刪不掉');
      if (name === 'undo:restore-old-layout') throw new Error('注入：舊分組寫不回去');
    }
  };
  const res = await post(port, { from: 'demo-basic', to: 'demo-x' });
  assert.equal(res.status, 500, res.text);
  assert.equal(res.json.incomplete, true);
  assert.match(res.json.error, /沒能完全還原.*注入：舊特效刪不掉/);
  assert.deepStrictEqual(res.json.problems, [
    '還原停在 restore-old-layout：注入：舊分組寫不回去（後面的還原沒有做，新名字的檔案留著，免得把僅存的一份也刪掉）',
    'vfx/presets/demo-basic.json：在',
    'vfx/presets/demo-x.json：在',
    'vfx/layouts/demo-basic.json：不在',
    'vfx/layouts/demo-x.json：在'
  ]);
  /* 舊分組已經刪了、又寫不回去：新名字那一份是僅存的分組，不能跟著刪 */
  assert.deepStrictEqual(readJson(sb.layouts, 'demo-x').groups[0].layerIds, layoutBefore.groups[0].layerIds);
}));

test('RENAME-13 目錄被換成指到 repo 外面的 junction：動檔之前就擋下，外面的檔一個都不碰', withRepo(async function (sb, port) {
  /* 改名會刪檔。vfx/layouts 是一條連結的話，刪到的是 repo 外面的東西 */
  const linked = path.join(sb.base, 'outside', 'layouts');
  fs.renameSync(sb.layouts, linked);
  fs.symlinkSync(linked, sb.layouts, 'junction');
  const before = snapshotMap(sb.base);
  const res = await post(port, { from: 'demo-basic', to: 'demo-x' });
  assert.equal(res.status, 403, res.text);
  assert.match(res.json.error, /符號連結／junction/);
  assert.deepStrictEqual(changedPaths(before, snapshotMap(sb.base)), []);
  fs.unlinkSync(sb.layouts);                // 收攤時 rmSync 不要跟著連結進去
}));

/* ============================================================
   Editor 接線
   ============================================================ */

function fnBody(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, '找不到 function ' + name);
  const rest = src.slice(at);
  return rest.slice(0, rest.indexOf('\n  }\n'));
}

test('RENAME-12 Editor：按鈕在另存新檔旁邊；先檢查有沒有人用、再問名字；未存檔先問；改完用新名字重開', function () {
  const html = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/index.html'), 'utf8');
  const saveAsAt = html.indexOf('id="btn-save-as"');
  const renameAt = html.indexOf('id="btn-rename"');
  assert.ok(saveAsAt > 0 && renameAt > saveAsAt && renameAt < html.indexOf('id="btn-download"'),
    '「重新命名」要緊接在「另存新檔」後面');

  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  assert.ok(/\$\('btn-rename'\)\.onclick = renamePreset;/.test(src));
  assert.ok(src.indexOf("var RENAME_URL = '" + editorServer.RENAME_PATH + "'") >= 0, '頁面與伺服器的路徑要一致');

  const rename = fnBody(src, 'renamePreset');
  assert.ok(/state\.isNew \|\| state\.sourcePresetId === null/.test(rename),
    '還沒存進 repo 的（新特效、從本機匯入的）沒有檔案可以改名');
  const checkAt = rename.indexOf('dryRun: true');
  const askAt = rename.indexOf("askPresetName(from, 'rename')");
  assert.ok(checkAt > 0 && askAt > checkAt, '先問伺服器有沒有人用，被擋下的就不必讓人白取一個名字');

  const commit = fnBody(src, 'commitRename');
  assert.ok(/ctx\.closed \|\| state\.staleDoc/.test(commit), '問名字時視窗換了別份特效，就不能在這個視窗重開');
  const dirtyAt = commit.indexOf('if (isDirty())');
  /* 比對整個條件句，不是只比「有沒有 window.confirm」：寫成 if (false && !window.confirm(…)) 也有那幾個字 */
  const confirmAt = commit.indexOf('if (!window.confirm(');
  const saveAt = commit.indexOf('savePreset()');
  const layoutAt = commit.indexOf('state.layoutSave');
  const requestAt = commit.indexOf('renameRequest({ from: from, to: to })');
  const reopenAt = commit.indexOf('openPresetInPane(ctx, to,');
  assert.ok(dirtyAt > 0 && confirmAt > dirtyAt && saveAt > confirmAt && layoutAt > saveAt && requestAt > layoutAt,
    '有未存檔的修改：先問 → 存特效 → 等分組也存好 → 才請伺服器改名（伺服器搬的是磁碟上的檔）');
  assert.ok(reopenAt > requestAt, '改完用新名字重新開啟：復原紀錄裡每一步都還帶著舊名字');
  assert.ok(/keepRuntime: true/.test(commit.slice(reopenAt)));

  const ask = fnBody(src, 'askPresetName');
  assert.ok(/purpose: purpose/.test(ask), '問名字的視窗要知道是重新命名（標題與說明不同）');
});
