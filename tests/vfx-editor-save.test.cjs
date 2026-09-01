'use strict';
/* ============================================================
   vfx-editor-save.test.cjs — Editor Save 回寫（P0-2）

   受測對象是 tools/vfx/editor-server.cjs 的 PUT /vfx/presets/<id>.json。

   測試一律打真的 HTTP：presetId 是從 URL 來的，路徑穿越也只在 URL 這一層
   才有意義，直接呼叫內部函式會把最該驗的那一段跳過去。

   每個案例都在自己的沙箱 repo 裡跑，沙箱旁邊另外放一個 outside/ 目錄與
   canary 檔；凡是宣稱「沒有寫到別的地方」的案例，都用整棵樹的
   路徑 ＋ sha256 快照前後比對，而不是只數檔案數量。
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

const REPO = path.resolve(__dirname, '..');
const REAL_PRESETS = path.join(REPO, 'vfx', 'presets');

/* ---------------- 沙箱 ---------------- */

function makeSandbox(options) {
  const opts = options || {};
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-editor-save-'));
  const repoRoot = path.join(base, 'repo');
  const outside = path.join(base, 'outside');

  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'canary.txt'), 'OUTSIDE CANARY\n');

  fs.mkdirSync(path.join(repoRoot, 'js'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'js', 'important.js'), 'REPO CANARY\n');
  fs.mkdirSync(path.join(repoRoot, 'vfx'), { recursive: true });

  if (opts.presetsAsJunction) {
    /* vfx/presets 本身是一條指到 repo 外面的 junction */
    const linked = path.join(base, 'linked-presets');
    fs.mkdirSync(linked, { recursive: true });
    copyRealPresets(linked);
    fs.symlinkSync(linked, path.join(repoRoot, 'vfx', 'presets'), 'junction');
    return { base: base, repoRoot: repoRoot, outside: outside, linked: linked };
  }

  const presets = path.join(repoRoot, 'vfx', 'presets');
  fs.mkdirSync(presets, { recursive: true });
  copyRealPresets(presets);
  return { base: base, repoRoot: repoRoot, outside: outside, presets: presets };
}

function copyRealPresets(dir) {
  fs.readdirSync(REAL_PRESETS)
    .filter(function (f) { return /\.json$/i.test(f); })
    .forEach(function (f) {
      fs.copyFileSync(path.join(REAL_PRESETS, f), path.join(dir, f));
    });
}

function cleanup(sb) {
  try { fs.rmSync(sb.base, { recursive: true, force: true }); } catch (e) { }
}

/* 整棵樹的快照：排序後的路徑清單 ＋ 每個檔案的 sha256。
   只比檔案數量的話，「內容被換掉但檔名沒變」會完全看不出來。 */
function snapshot(root) {
  const out = [];
  (function walk(dir, rel) {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    items.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    items.forEach(function (item) {
      const abs = path.join(dir, item.name);
      const r = rel ? rel + '/' + item.name : item.name;
      if (item.isSymbolicLink()) { out.push(r + ' [link]'); return; }
      if (item.isDirectory()) { out.push(r + '/'); walk(abs, r); return; }
      out.push(r + ' ' + crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'));
    });
  })(root, '');
  return out.join('\n');
}

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function tempLeftovers(dir) {
  return fs.readdirSync(dir).filter(function (f) {
    return f.indexOf(editorServer.TEMP_PREFIX) === 0;
  });
}

/* ---------------- HTTP ---------------- */

function withServer(sb, hooks) {
  const server = editorServer.__testOnly.createServer({
    repoRoot: sb.repoRoot,
    assetRoots: {},
    hooks: hooks || null
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port });
    });
  });
}

function closeServer(h) {
  return new Promise(function (resolve) { h.server.close(function () { resolve(); }); });
}

function request(port, opts, body) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      host: '127.0.0.1',
      port: port,
      method: opts.method || 'GET',
      path: opts.path,
      headers: opts.headers || {},
      agent: false                    // 不用 keep-alive，否則 server.close() 會卡住
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { }
        resolve({ status: res.statusCode, text: text, json: json });
      });
    });
    req.on('error', reject);
    if (body !== undefined && body !== null) req.write(body);
    req.end();
  });
}

function put(port, urlPath, body, extraHeaders) {
  const headers = { 'Content-Type': 'application/json' };
  Object.keys(extraHeaders || {}).forEach(function (k) { headers[k] = extraHeaders[k]; });
  if (body !== undefined && body !== null && headers['Content-Length'] === undefined) {
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return request(port, { method: 'PUT', path: urlPath, headers: headers }, body);
}

function savePath(id) { return '/vfx/presets/' + id + '.json'; }

function readPreset(sb, id) {
  return JSON.parse(fs.readFileSync(path.join(sb.presets, id + '.json'), 'utf8'));
}

/* 每個案例都是「建沙箱 → 起伺服器 → 跑 → 收攤」，收攤保證執行 */
function withSandbox(fn, sandboxOptions, hooks) {
  return async function () {
    const sb = makeSandbox(sandboxOptions);
    const h = await withServer(sb, hooks);
    try {
      await fn(sb, h);
    } finally {
      await closeServer(h);
      cleanup(sb);
    }
  };
}

/* ============================================================
   1. 合法 preset overwrite 成功
   ============================================================ */

test('1 合法 preset 回寫成功，檔案內容真的換掉', withSandbox(async function (sb, h) {
  const before = sha(path.join(sb.presets, 'fire-tornado.json'));
  const preset = readPreset(sb, 'fire-tornado');
  preset.layers[0].alpha = 0.42;

  const res = await put(h.port, savePath('fire-tornado'), JSON.stringify(preset));
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.presetId, 'fire-tornado');

  const after = sha(path.join(sb.presets, 'fire-tornado.json'));
  assert.notEqual(after, before, '檔案必須真的被改寫');
  assert.equal(readPreset(sb, 'fire-tornado').layers[0].alpha, 0.42);
  assert.equal(res.json.bytes,
    Buffer.byteLength(fs.readFileSync(path.join(sb.presets, 'fire-tornado.json'))),
    '回報的 bytes 必須等於實際寫入的長度');
  assert.deepEqual(tempLeftovers(sb.presets), [], '成功後不得留下暫存檔');
}));

test('1b 新的 preset id 會建立新檔（Save As 的架構前提）', withSandbox(async function (sb, h) {
  const preset = readPreset(sb, 'demo-basic');
  preset.id = 'brand-new-preset';
  const res = await put(h.port, savePath('brand-new-preset'), JSON.stringify(preset));
  assert.equal(res.status, 200, res.text);
  assert.ok(fs.existsSync(path.join(sb.presets, 'brand-new-preset.json')));
  assert.deepEqual(tempLeftovers(sb.presets), []);
}));

/* ============================================================
   2. canonical serialization
   ============================================================ */

test('2 寫入的一定是 canonical 序列化結果，不是 request body 原文',
  withSandbox(async function (sb, h) {
    const preset = readPreset(sb, 'demo-basic');
    /* 故意把欄位順序打散、縮排改掉、結尾換行拿掉 */
    const scrambled = {};
    Object.keys(preset).reverse().forEach(function (k) { scrambled[k] = preset[k]; });
    scrambled.layers = preset.layers.map(function (layer) {
      const o = {};
      Object.keys(layer).reverse().forEach(function (k) { o[k] = layer[k]; });
      return o;
    });
    const body = JSON.stringify(scrambled);          // 單行、無結尾換行

    const res = await put(h.port, savePath('demo-basic'), body);
    assert.equal(res.status, 200, res.text);

    const written = fs.readFileSync(path.join(sb.presets, 'demo-basic.json'), 'utf8');
    assert.notEqual(written, body, '不得把 request body 原樣落檔');
    assert.equal(written, VFXCore.serialisePreset(scrambled),
      '落檔內容必須等於 Core 的 serialisePreset 輸出');
    assert.equal(written.slice(-1), '\n', 'canonical 輸出以換行結尾');

    /* 再存一次同一份，bytes 必須完全一樣（決定性） */
    const res2 = await put(h.port, savePath('demo-basic'), body);
    assert.equal(res2.status, 200);
    assert.equal(fs.readFileSync(path.join(sb.presets, 'demo-basic.json'), 'utf8'), written);
  }));

/* ============================================================
   3–5. 驗證失敗一律不寫檔
   ============================================================ */

test('3 不合法的 preset 被拒絕，原檔 byte-identical', withSandbox(async function (sb, h) {
  const target = path.join(sb.presets, 'fire-tornado.json');
  const before = sha(target);
  const preset = readPreset(sb, 'fire-tornado');
  preset.duration = -1;

  const res = await put(h.port, savePath('fire-tornado'), JSON.stringify(preset));
  assert.equal(res.status, 400);
  assert.equal(res.json.ok, false);
  assert.ok(res.json.problems.length > 0, '必須回報具體問題，不能只說失敗');
  assert.ok(res.json.problems.some(function (p) { return /duration/.test(p); }));
  assert.equal(sha(target), before, '原檔必須一個 byte 都沒動');
  assert.deepEqual(tempLeftovers(sb.presets), []);
}));

test('4 malformed JSON 被拒絕，原檔 byte-identical', withSandbox(async function (sb, h) {
  const target = path.join(sb.presets, 'fire-tornado.json');
  const before = sha(target);

  const res = await put(h.port, savePath('fire-tornado'), '{ this is not json');
  assert.equal(res.status, 400);
  assert.ok(/JSON/.test(res.json.error));
  assert.equal(sha(target), before);
  assert.deepEqual(tempLeftovers(sb.presets), []);
}));

test('5 未知欄位被拒絕（拼錯的欄位不得被靜靜吃掉）',
  withSandbox(async function (sb, h) {
    const target = path.join(sb.presets, 'fire-tornado.json');
    const before = sha(target);

    const layerTypo = readPreset(sb, 'fire-tornado');
    layerTypo.layers[0].alpah = 0.5;
    const r1 = await put(h.port, savePath('fire-tornado'), JSON.stringify(layerTypo));
    assert.equal(r1.status, 400);
    assert.ok(r1.json.problems.some(function (p) { return /alpah/.test(p); }));

    const presetTypo = readPreset(sb, 'fire-tornado');
    presetTypo.looop = true;
    const r2 = await put(h.port, savePath('fire-tornado'), JSON.stringify(presetTypo));
    assert.equal(r2.status, 400);
    assert.ok(r2.json.problems.some(function (p) { return /looop/.test(p); }));

    assert.equal(sha(target), before);
  }));

test('5b preset.id 與檔名不一致時拒絕', withSandbox(async function (sb, h) {
  const target = path.join(sb.presets, 'fire-tornado.json');
  const before = sha(target);
  const preset = readPreset(sb, 'black-hole');          // id = black-hole
  const res = await put(h.port, savePath('fire-tornado'), JSON.stringify(preset));
  assert.equal(res.status, 400);
  assert.ok(/不一致/.test(res.json.error));
  assert.equal(sha(target), before, 'fire-tornado.json 不得被 black-hole 蓋掉');
}));

/* ============================================================
   6–10. 路徑安全
   ============================================================ */

/* 每一個都必須被路由層直接判掉，而且整個沙箱（repo ＋ outside）不得有任何變化。 */
const HOSTILE_IDS = [
  '..',
  '../x',
  '../../x',
  '..%2fx',
  '%2e%2e',
  '%2e%2e%2fx',
  '%2e%2e/x',
  'a/b',
  'a%2fb',
  'a\\b',
  '..\\x',
  '%2e%2e%5cx',
  'C:/evil',
  'C:\\evil',
  '/etc/passwd',
  '//server/share/x',
  '.hidden',
  '.vfx-export-root',
  'Fire-Tornado',
  '-leading-dash',
  '',
  'con',
  'nul',
  'com1',
  'lpt9',
  'x'.repeat(80)
];

test('6–10 惡意 presetId 全部被拒，沙箱整棵樹（repo ＋ outside）不變',
  withSandbox(async function (sb, h) {
    const before = snapshot(sb.base);
    const accepted = [];
    for (const id of HOSTILE_IDS) {
      const res = await put(h.port, savePath(id), JSON.stringify(readPreset(sb, 'demo-basic')));
      if (res.status < 400) accepted.push(id + ' → ' + res.status);
      else {
        assert.equal(res.status, 400, '應由路由層判掉：' + JSON.stringify(id));
        assert.equal(res.json.ok, false);
      }
    }
    assert.deepEqual(accepted, [], '不得有任何惡意 id 被接受');
    assert.equal(snapshot(sb.base), before, '沙箱內外都不得有任何檔案變動');
  }));

test('6b presetIdFromRawPath 對未解碼字串把關（percent-encoding 不會被解開）',
  function () {
    const f = editorServer.presetIdFromRawPath;
    assert.equal(f('/vfx/presets/fire-tornado.json'), 'fire-tornado');
    assert.equal(f('/vfx/presets/a1.json'), 'a1');
    /* 這些必須全部是 null——% 不在字元集內，所以連「解碼幾次才安全」都不必推理 */
    ['%2e%2e', '%2e%2e%2f..', 'a%2fb', '..', 'a/b', 'a\\b', 'A', 'a.b', 'a b', '-a', ''
    ].forEach(function (id) {
      assert.equal(f('/vfx/presets/' + id + '.json'), null, '應拒絕：' + JSON.stringify(id));
    });
    assert.equal(f('/vfx/presets/x.JSON'), null, '副檔名必須是小寫 .json');
    assert.equal(f('/vfx/presets/x'), null, '沒有 .json 副檔名');
    assert.equal(f('/js/vfx-core.js'), null, '不在 preset 目錄下');
    assert.equal(f('/vfx/presets/x.json/y.json'), null);
    assert.equal(f('/vfx/presets/.json'), null, 'id 不得為空');
  });

test('10b 寫入路由不接受 preset 目錄以外的任何路徑',
  withSandbox(async function (sb, h) {
    const before = snapshot(sb.base);
    const paths = [
      '/js/vfx-core.js',
      '/js/important.js',
      '/vfx/asset-index.json',
      '/vfx/shipped-assets.json',
      '/vfx/presets',
      '/vfx/presetsx/a.json',
      '/tools/vfx/editor/editor.js',
      '/'
    ];
    for (const p of paths) {
      const res = await put(h.port, p, '{}');
      assert.equal(res.status, 400, '應拒絕 PUT ' + p);
    }
    assert.equal(snapshot(sb.base), before);
  }));

/* ============================================================
   11. 目標是連結
   ============================================================ */

test('11 目標檔是符號連結時拒絕覆寫', async function (t) {
  const sb = makeSandbox();
  const outsideFile = path.join(sb.outside, 'stolen.json');
  fs.writeFileSync(outsideFile, 'ORIGINAL OUTSIDE CONTENT\n');
  const target = path.join(sb.presets, 'demo-basic.json');
  fs.unlinkSync(target);
  try {
    fs.symlinkSync(outsideFile, target, 'file');
  } catch (e) {
    cleanup(sb);
    /* Windows 上建立檔案符號連結需要額外權限；下面的 junction 案例
       在同一台機器上是真的會跑的，連結逃逸這條路仍有覆蓋。 */
    return t.skip('此環境無法建立檔案符號連結：' + e.code);
  }
  const h = await withServer(sb);
  try {
    const preset = JSON.parse(fs.readFileSync(path.join(REAL_PRESETS, 'demo-basic.json'), 'utf8'));
    const res = await put(h.port, savePath('demo-basic'), JSON.stringify(preset));
    assert.equal(res.status, 403);
    assert.ok(/符號連結/.test(res.json.error));
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'ORIGINAL OUTSIDE CONTENT\n',
      '連結指向的 repo 外檔案不得被改寫');
    assert.deepEqual(tempLeftovers(sb.presets), []);
  } finally {
    await closeServer(h);
    cleanup(sb);
  }
});

test('11b vfx/presets 本身是 junction 時拒絕寫入', async function (t) {
  let sb;
  try {
    sb = makeSandbox({ presetsAsJunction: true });
  } catch (e) {
    return t.skip('此環境無法建立 junction：' + e.code);
  }
  const h = await withServer(sb);
  try {
    const before = snapshot(sb.linked);
    const preset = JSON.parse(fs.readFileSync(path.join(sb.linked, 'demo-basic.json'), 'utf8'));
    const res = await put(h.port, savePath('demo-basic'), JSON.stringify(preset));
    assert.equal(res.status, 403, res.text);
    assert.ok(/符號連結|junction/.test(res.json.error), res.text);
    assert.equal(snapshot(sb.linked), before, '連結指向的目錄不得有任何變動');
  } finally {
    await closeServer(h);
    cleanup(sb);
  }
});

/* ============================================================
   12–13. 落檔本身的安全
   ============================================================ */

test('12 rename 前失敗時原檔不變，且不留暫存檔', async function () {
  const sb = makeSandbox();
  const seen = [];
  const h = await withServer(sb, {
    beforeRename: function (tempAbs) {
      seen.push(tempAbs);
      throw new Error('injected write failure');
    }
  });
  try {
    const target = path.join(sb.presets, 'fire-tornado.json');
    const before = sha(target);
    const preset = readPreset(sb, 'fire-tornado');
    preset.layers[0].alpha = 0.11;

    const res = await put(h.port, savePath('fire-tornado'), JSON.stringify(preset));
    assert.equal(res.status, 500);
    assert.ok(/原檔未變動/.test(res.json.error), res.text);
    assert.equal(sha(target), before, '原檔必須 byte-identical');
    assert.deepEqual(tempLeftovers(sb.presets), [], '失敗後暫存檔必須被清掉');

    /* 暫存檔名不得以 .json 結尾：export-assets.cjs 會把 vfx/presets 下所有
       *.json 當成正式 Preset 讀，殘留檔絕不能被誤認成一份 Preset。 */
    assert.equal(seen.length, 1);
    const tempName = path.basename(seen[0]);
    assert.equal(tempName.charAt(0), '.', '暫存檔必須以 . 開頭（GET 那邊會擋掉）');
    assert.ok(!/\.json$/i.test(tempName), '暫存檔名不得以 .json 結尾：' + tempName);
  } finally {
    await closeServer(h);
    cleanup(sb);
  }
});

test('13 暫存檔撞名時改用下一個名字，不覆寫既有檔案', async function () {
  const sb = makeSandbox();
  const seen = [];
  const h = await withServer(sb, { beforeRename: function (t) { seen.push(t); } });
  try {
    /* 測試與受測程式在同一個 process，所以 pid 可預期；先佔住第 0 號候選名 */
    const squatted = path.join(sb.presets,
      editorServer.TEMP_PREFIX + 'fire-tornado-' + process.pid + '-0');
    fs.writeFileSync(squatted, 'SOMEONE ELSE FILE\n');

    const preset = readPreset(sb, 'fire-tornado');
    preset.layers[0].alpha = 0.33;
    const res = await put(h.port, savePath('fire-tornado'), JSON.stringify(preset));
    assert.equal(res.status, 200, res.text);

    assert.equal(fs.readFileSync(squatted, 'utf8'), 'SOMEONE ELSE FILE\n',
      '既有的同名檔不得被覆寫');
    assert.equal(seen.length, 1);
    assert.notEqual(seen[0], squatted, '必須換到別的候選名');
    assert.equal(readPreset(sb, 'fire-tornado').layers[0].alpha, 0.33);
    assert.deepEqual(tempLeftovers(sb.presets), [path.basename(squatted)],
      '只應剩下事先佔位的那一個檔案');
  } finally {
    await closeServer(h);
    cleanup(sb);
  }
});

/* ============================================================
   16–17. 正式 Preset round-trip
   ============================================================ */

/* 行尾一律先正規化再比對：repo 設了 core.autocrlf=true，同一份檔案在不同機器
   checkout 出來可能是 CRLF，那是 Git 的事，不該讓 round-trip 測試跟著飄。 */
function lf(text) { return text.replace(/\r\n/g, '\n'); }

['fire-tornado', 'black-hole'].forEach(function (id, i) {
  test((16 + i) + ' ' + id + ' round-trip：存回去內容不變，且已是 canonical 形式',
    withSandbox(async function (sb, h) {
      const realText = fs.readFileSync(path.join(REAL_PRESETS, id + '.json'), 'utf8');
      const parsed = JSON.parse(realText);
      const canonical = VFXCore.serialisePreset(parsed);

      /* (a) 正式 preset 本身就必須是 canonical 形式。
         否則從 Editor 按下第一次 Save 就會產生一份純格式的大 diff，
         之後每次要分辨「這次改了什麼」都要先跳過那堆雜訊。 */
      assert.equal(lf(realText), canonical,
        'vfx/presets/' + id + '.json 不是 canonical 形式，請用 serialisePreset 正規化');

      const res = await put(h.port, savePath(id), realText);
      assert.equal(res.status, 200, res.text);
      const written = fs.readFileSync(path.join(sb.presets, id + '.json'), 'utf8');
      assert.equal(written, canonical, '寫入的必須是 canonical 輸出');
      assert.deepStrictEqual(JSON.parse(written), parsed, '語意不得改變');

      /* (b) 冪等：把剛寫出來的再存一次，bytes 完全相同 */
      const res2 = await put(h.port, savePath(id), written);
      assert.equal(res2.status, 200);
      assert.equal(fs.readFileSync(path.join(sb.presets, id + '.json'), 'utf8'), written);
      assert.deepEqual(tempLeftovers(sb.presets), []);
    }));
});

test('16b 所有正式 preset 都是 canonical 形式', function () {
  const files = fs.readdirSync(REAL_PRESETS).filter(function (f) { return /\.json$/i.test(f); });
  assert.ok(files.length >= 3, '正式 preset 至少三份');
  files.forEach(function (f) {
    const text = fs.readFileSync(path.join(REAL_PRESETS, f), 'utf8');
    assert.equal(lf(text), VFXCore.serialisePreset(JSON.parse(text)),
      'vfx/presets/' + f + ' 不是 canonical 形式');
  });
});

/* ============================================================
   寫入面的來源檢查
   ============================================================ */

test('W1 非 loopback 的 Host 被拒（DNS rebinding）', withSandbox(async function (sb, h) {
  const before = snapshot(sb.base);
  /* 動一個看得見的值，這樣「有沒有寫進去」才驗得出來 */
  const preset = readPreset(sb, 'demo-basic');
  preset.layers[0].alpha = 0.77;
  const body = JSON.stringify(preset);

  for (const host of ['evil.example.com', 'evil.example.com:' + h.port, '10.0.0.5']) {
    const res = await put(h.port, savePath('demo-basic'), body, { Host: host });
    assert.equal(res.status, 403, 'Host ' + host + ' 必須被拒');
    assert.ok(/loopback Host/.test(res.json.error));
  }
  assert.equal(snapshot(sb.base), before, '被拒的請求不得留下任何痕跡');

  /* 對照組：同一個 body、loopback Host → 確實寫得進去，
     證明上面三次失敗是 Host 擋下來的，不是這個 body 本來就存不了 */
  const ok = await put(h.port, savePath('demo-basic'), body, { Host: '127.0.0.1:' + h.port });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(readPreset(sb, 'demo-basic').layers[0].alpha, 0.77);
}));

test('W2 跨來源 Origin 被拒', withSandbox(async function (sb, h) {
  const body = JSON.stringify(readPreset(sb, 'demo-basic'));
  const target = path.join(sb.presets, 'demo-basic.json');
  const before = sha(target);
  const res = await put(h.port, savePath('demo-basic'), body,
    { Origin: 'https://evil.example.com' });
  assert.equal(res.status, 403);
  assert.ok(/Origin/.test(res.json.error));
  assert.equal(sha(target), before);

  const ok = await put(h.port, savePath('demo-basic'), body,
    { Origin: 'http://localhost:' + h.port });
  assert.equal(ok.status, 200, ok.text);
}));

test('W3 Content-Type 不是 application/json 時拒絕（跨來源會被迫先 preflight）',
  withSandbox(async function (sb, h) {
    const body = JSON.stringify(readPreset(sb, 'demo-basic'));
    const target = path.join(sb.presets, 'demo-basic.json');
    const before = sha(target);
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const res = await put(h.port, savePath('demo-basic'), body, { 'Content-Type': type });
      assert.equal(res.status, 403, type + ' 必須被拒');
    }
    assert.equal(sha(target), before);
    const ok = await put(h.port, savePath('demo-basic'), body,
      { 'Content-Type': 'application/json; charset=utf-8' });
    assert.equal(ok.status, 200, ok.text);
  }));

test('W4 過大的 body 被拒，且不寫檔', withSandbox(async function (sb, h) {
  const target = path.join(sb.presets, 'demo-basic.json');
  const before = sha(target);
  const preset = readPreset(sb, 'demo-basic');
  preset.layers[0].id = 'x'.repeat(2 * 1024 * 1024);
  const res = await put(h.port, savePath('demo-basic'), JSON.stringify(preset));
  assert.equal(res.status, 413, res.text);
  assert.equal(sha(target), before);
  assert.deepEqual(tempLeftovers(sb.presets), []);
}));

test('W5 沒有回任何 CORS 標頭（跨來源 preflight 不會通過）',
  withSandbox(async function (sb, h) {
    const res = await new Promise(function (resolve, reject) {
      const req = http.request({
        host: '127.0.0.1', port: h.port, method: 'OPTIONS', agent: false,
        path: savePath('demo-basic'),
        headers: {
          Origin: 'https://evil.example.com',
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type'
        }
      }, function (r) { r.resume(); r.on('end', function () { resolve(r); }); });
      req.on('error', reject);
      req.end();
    });
    Object.keys(res.headers).forEach(function (k) {
      assert.ok(k.toLowerCase().indexOf('access-control-') !== 0,
        '不得回任何 CORS 標頭，卻看到：' + k);
    });
  }));

/* ============================================================
   讀取面的回歸
   ============================================================ */

test('R1 GET 仍可讀 preset，且非 GET/PUT 的方法被擋',
  withSandbox(async function (sb, h) {
    const get = await request(h.port, { path: savePath('fire-tornado') });
    assert.equal(get.status, 200);
    assert.equal(get.text, fs.readFileSync(path.join(sb.presets, 'fire-tornado.json'), 'utf8'));

    for (const method of ['POST', 'DELETE', 'PATCH']) {
      const res = await request(h.port, { method: method, path: savePath('fire-tornado') });
      assert.equal(res.status, 405, method + ' 必須被擋');
    }
    const dot = await request(h.port, { path: '/vfx/presets/.vfx-save-tmp-x' });
    assert.equal(dot.status, 403, '以 . 開頭的檔案不得被服務');
  }));

/* ============================================================
   啟動器依賴的身分端點
   ============================================================ */

/* 啟動VFX編輯器.bat 用 /__whoami 判斷「這個埠上的是不是本副本的 Editor」。
   五份 worktree 共用同一個埠範圍，端點若被拿掉或不再回報目錄，
   啟動器會靜靜地把別的副本當成自己的，改了半天才發現改錯地方。 */
test('W6 /__whoami 回報服務中的目錄，供啟動器辨識工作副本',
  withSandbox(async function (sb, h) {
    const res = await request(h.port, { path: '/__whoami' });
    assert.equal(res.status, 200);
    assert.ok(/^idle-rpg-vfx-editor /.test(res.text), '必須以固定標記開頭：' + res.text);
    assert.equal(res.text.trim(), 'idle-rpg-vfx-editor ' + path.resolve(sb.repoRoot),
      '必須含服務中的絕對目錄，否則不同副本無法區分');

    /* 兩個不同的沙箱必須回報不同的目錄——這才是它存在的理由 */
    const sb2 = makeSandbox();
    const h2 = await withServer(sb2);
    try {
      const res2 = await request(h2.port, { path: '/__whoami' });
      assert.notEqual(res2.text, res.text, '不同工作副本必須回報不同身分');
    } finally {
      await closeServer(h2);
      cleanup(sb2);
    }
  }));

test('W7 啟動器與伺服器對身分標記與埠範圍的認知一致', function () {
  const serverSrc = fs.readFileSync(path.join(REPO, 'tools', 'vfx', 'editor-server.cjs'), 'utf8');
  const launcher = fs.readFileSync(path.join(REPO, '啟動VFX編輯器.bat'), 'utf8');

  const markMatch = serverSrc.match(/const WHOAMI_MARK = '([^']+)'/);
  assert.ok(markMatch, '伺服器必須定義 WHOAMI_MARK');
  assert.ok(launcher.indexOf('set MARK=' + markMatch[1] + ' %CD%') >= 0,
    '啟動器的 MARK 必須等於伺服器的標記加上工作目錄');

  const base = Number(serverSrc.match(/const PORT_BASE = (\d+)/)[1]);
  const tries = Number(serverSrc.match(/const PORT_TRIES = (\d+)/)[1]);
  assert.ok(launcher.indexOf('for /l %%p in (' + base + ',1,' + (base + tries - 1) + ')') >= 0,
    '啟動器掃描的埠範圍必須涵蓋伺服器會用到的 ' + base + '~' + (base + tries - 1));
});

test('W8 兩支 .bat 必須是 CRLF，且非 echo 行不得含多位元組字元', function () {
  /* cmd 是逐段解析的，chcp 切換編碼後，rem／指令位置上的多位元組字元會被
     打散成指令執行；LF 行尾則會讓 cmd 在檔案中途失去同步。
     這兩件事都只在實際雙擊時才會炸，測試裡釘住比較實在。 */
  [path.join(REPO, '啟動VFX編輯器.bat'),
    path.join(REPO, 'tools', 'vfx', 'editor_server_window.bat')].forEach(function (file) {
    const raw = fs.readFileSync(file);
    const name = path.basename(file);
    assert.ok(raw.includes(Buffer.from('\r\n')), name + ' 必須是 CRLF');
    assert.equal((raw.toString('latin1').match(/[^\r]\n/g) || []).length, 0,
      name + ' 不得有單獨的 LF 行尾');
    /* 0x0B 之類的控制字元代表路徑字面量在產生過程被轉義吃掉了（tools\vfx → tools+VT+fx） */
    assert.equal((raw.toString('latin1').match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g) || []).length, 0,
      name + ' 含異常控制字元，路徑字面量可能被轉義破壞');

    raw.toString('utf8').split('\r\n').forEach(function (line, i) {
      const isEcho = /^\s*echo(\s|\.|$)/i.test(line);
      if (isEcho) {
        /* 中文與 %VAR% 同行時，實測 echo 前綴會在 chcp 之後遺失，
           cmd 會把中文當成指令執行。標籤與值必須拆行。 */
        const hasCJK = /[一-鿿＀-￯]/.test(line);
        const hasVar = /%[A-Za-z_][A-Za-z0-9_]*%/.test(line);
        assert.ok(!(hasCJK && hasVar),
          name + ':' + (i + 1) + ' 中文與變數不得同行：' + line);
        return;
      }
      /* 非 echo 行：只有「被雙引號包住的參數」可以是多位元組。
         真正的危險是 rem／指令位置上的裸中文——編碼錯位後它會被當成指令執行；
         引號內的字串最壞只是顯示錯字（既有的 啟動數值模擬器.bat 也是這樣寫
         start 的視窗標題，實測沒問題），所以不必連那個也禁掉。 */
      const outsideQuotes = line.replace(/"[^"]*"/g, '""');
      assert.ok(!/[^\x00-\x7f]/.test(outsideQuotes),
        name + ':' + (i + 1) + ' 非 echo 行的引號外必須是純 ASCII：' + line);
    });
  });
});

/* ============================================================
   測試縫隙不得被正式路徑使用
   ============================================================ */

test('S1 正式啟動路徑不經過 __testOnly，也沒有任何 CLI 參數能換掉 repoRoot',
  function () {
    const src = fs.readFileSync(path.join(REPO, 'tools', 'vfx', 'editor-server.cjs'), 'utf8');
    const cli = src.slice(src.indexOf('function start('),
      src.indexOf('if (require.main === module)'));
    assert.ok(cli.length > 200, '切片必須真的涵蓋 start 與 main');
    assert.ok(!/__testOnly/.test(cli), '正式路徑不得提到 __testOnly');
    assert.ok(!/hooks/.test(cli), '正式路徑不得帶入 hooks');
    assert.ok(/createServer\(\{ repoRoot: REPO_ROOT/.test(cli),
      'start() 必須把常數 REPO_ROOT 寫死進去');
    /* main() 只認得 --port */
    const main = src.slice(src.indexOf('function main('), src.indexOf('if (require.main === module)'));
    const flags = main.match(/argv\[i\] === '[^']+'/g) || [];
    assert.deepEqual(flags, ["argv[i] === '--port'"], 'CLI 只能有 --port 這一個參數');
  });

test('S2 目的地目錄是模組常數，落檔一定走 temp → rename', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools', 'vfx', 'editor-server.cjs'), 'utf8');
  assert.ok(/const PRESETS_DIR_REL = 'vfx\/presets';/.test(src));
  /* writePresetFile 不得接受任何路徑參數 */
  const fn = src.slice(src.indexOf('function writePresetFile('),
    src.indexOf('function savePresetText('));
  assert.ok(/function writePresetFile\(ctx, presetId, text\)/.test(fn),
    'writePresetFile 的簽章不得出現路徑參數');
  assert.ok(/openSync\(candidate, 'wx'\)/.test(fn), '暫存檔必須用獨佔建立');
  assert.ok(/renameSync\(tempAbs, targetAbs\)/.test(fn), '必須是 temp → rename，不是直接寫目標');
  assert.ok(!/writeFileSync\(targetAbs/.test(src), '不得直接 writeFileSync 到目標檔');
});

/* ============================================================
   Codex Full Review 修正的回歸保護
   ============================================================ */

/* C2：writeSync 可能短寫。不看回傳值就 rename，等於把截斷的 JSON 蓋到好檔上，
   而且還回報成功。這裡直接把 fs.writeSync 換成「每次只寫 1 byte」，
   如果程式沒有補寫迴圈，落檔內容一定不完整。 */
test('C2 短寫入不會產生截斷的 preset（writeSync 必須補寫到完整）', async function () {
  const sb = makeSandbox();
  const h = await withServer(sb);
  const realWrite = fs.writeSync;
  let calls = 0;
  fs.writeSync = function (fd, buf, off, len, pos) {
    calls++;
    return realWrite(fd, buf, off, Math.min(1, len), pos);   // 每次只寫 1 byte
  };
  try {
    const preset = readPreset(sb, 'demo-basic');
    preset.layers[0].alpha = 0.61;
    const res = await put(h.port, savePath('demo-basic'), JSON.stringify(preset));
    assert.equal(res.status, 200, res.text);
    const written = fs.readFileSync(path.join(sb.presets, 'demo-basic.json'), 'utf8');
    assert.ok(calls > 100, '這個測試要有意義，writeSync 必須真的被切成很多次：' + calls);
    assert.equal(written, VFXCore.serialisePreset(preset), '短寫時仍必須落成完整內容');
    assert.equal(res.json.bytes, Buffer.byteLength(written));
  } finally {
    fs.writeSync = realWrite;
    await closeServer(h);
    cleanup(sb);
  }
});

/* C2b：寫不完時必須失敗，而且不能碰原檔。 */
test('C2b 寫入停滯時原檔不變，不留暫存檔', async function () {
  const sb = makeSandbox();
  const h = await withServer(sb);
  const realWrite = fs.writeSync;
  let n = 0;
  fs.writeSync = function (fd, buf, off, len, pos) {
    if (++n > 3) return 0;                          // 第 4 次開始「寫不進去」
    return realWrite(fd, buf, off, Math.min(8, len), pos);
  };
  try {
    const target = path.join(sb.presets, 'demo-basic.json');
    const before = sha(target);
    const res = await put(h.port, savePath('demo-basic'),
      JSON.stringify(readPreset(sb, 'demo-basic')));
    assert.equal(res.status, 500, res.text);
    assert.ok(/原檔未變動/.test(res.json.error), res.text);
    assert.equal(sha(target), before, '原檔必須 byte-identical');
    assert.deepEqual(tempLeftovers(sb.presets), []);
  } finally {
    fs.writeSync = realWrite;
    await closeServer(h);
    cleanup(sb);
  }
});

/* MINOR 2：lstat 失敗不等於「不存在」。把 EACCES 當成 ENOENT 是典型的 fail-open。 */
test('C3 lstat 出現非 ENOENT 錯誤時 fail-closed，不繼續寫',
  async function () {
    const sb = makeSandbox();
    const h = await withServer(sb);
    const realLstat = fs.lstatSync;
    const target = path.join(sb.presets, 'demo-basic.json');
    fs.lstatSync = function (p) {
      if (String(p) === target) {
        const e = new Error('permission denied');
        e.code = 'EACCES';
        throw e;
      }
      return realLstat.apply(fs, arguments);
    };
    try {
      const before = sha(target);
      const res = await put(h.port, savePath('demo-basic'),
        JSON.stringify(readPreset(sb, 'demo-basic')));
      assert.equal(res.status, 500, res.text);
      assert.ok(/EACCES/.test(res.json.error), res.text);
      assert.equal(sha(target), before);
      assert.deepEqual(tempLeftovers(sb.presets), []);
    } finally {
      fs.lstatSync = realLstat;
      await closeServer(h);
      cleanup(sb);
    }
  });

/* MINOR 1：Origin: null 是 sandboxed iframe／data:／file: 頁面送的，
   代表「有來源，而且不是本機 Editor」，不是「沒有來源」。 */
test('C4 Origin: null 被拒', withSandbox(async function (sb, h) {
  const target = path.join(sb.presets, 'demo-basic.json');
  const before = sha(target);
  for (const origin of ['null', 'not-a-url', 'http://evil.example.com']) {
    const res = await put(h.port, savePath('demo-basic'),
      JSON.stringify(readPreset(sb, 'demo-basic')), { Origin: origin });
    assert.equal(res.status, 403, 'Origin ' + origin + ' 必須被拒');
    assert.ok(/Origin/.test(res.json.error), res.text);
  }
  assert.equal(sha(target), before);
}));

/* MAJOR 1：檔名規則只有一份定義，Editor 與 server 載入的是同一個檔。 */
test('C5 preset id policy 是共用的單一實作', function () {
  const policy = require('../tools/vfx/editor/preset-id-policy.js');
  const serverSrc = fs.readFileSync(path.join(REPO, 'tools', 'vfx', 'editor-server.cjs'), 'utf8');
  const editorSrc = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8');
  const htmlSrc = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'index.html'), 'utf8');

  assert.ok(/require\('\.\/editor\/preset-id-policy\.js'\)/.test(serverSrc),
    'server 必須用共用 policy');
  assert.ok(/preset-id-policy\.js/.test(htmlSrc), 'Editor 頁面必須載入共用 policy');
  assert.ok(/VFXPresetIdPolicy\.presetIdProblem/.test(editorSrc),
    'Editor 的存檔擋門必須用共用 policy');
  /* 兩邊不得各自再留一份規則 */
  assert.ok(!/WINDOWS_RESERVED|com\[0-9\]/.test(editorSrc),
    'editor.js 不得自己再寫一份保留字規則');
  assert.ok(!/const PRESET_ID_RE/.test(serverSrc),
    'editor-server.cjs 不得自己再寫一份 id 規則');

  /* 同一組 id，policy 與實際的 HTTP 路由必須給一樣的答案（下一個測試驗 HTTP 端） */
  ['fire-tornado', 'a', 'a1', 'x-y-z'].forEach(function (id) {
    assert.equal(policy.presetIdProblem(id), null, id + ' 應該可以當檔名');
  });
  ['', 'A', 'a.b', '-a', 'a/b', 'con', 'nul', 'com1', 'lpt9', 'x'.repeat(65)]
    .forEach(function (id) {
      assert.ok(policy.presetIdProblem(id), id + ' 不該可以當檔名');
    });
});

test('C5b HTTP 路由的判斷與共用 policy 完全一致', withSandbox(async function (sb, h) {
  const policy = require('../tools/vfx/editor/preset-id-policy.js');
  const ids = ['fire-tornado', 'demo-basic', 'a', 'a1', 'x-y-z',
    '', 'A', 'a.b', '-a', 'a/b', 'con', 'nul', 'com1', 'lpt9', 'x'.repeat(65)];
  const preset = readPreset(sb, 'demo-basic');
  for (const id of ids) {
    const rejectedByPolicy = policy.presetIdProblem(id) !== null;
    const routed = editorServer.presetIdFromRawPath(savePath(id));
    assert.equal(routed === null, rejectedByPolicy,
      '路由與 policy 對 ' + JSON.stringify(id) + ' 的判斷必須一致');
    if (rejectedByPolicy) {
      preset.id = id;
      const res = await put(h.port, savePath(id), JSON.stringify(preset));
      assert.equal(res.status, 400, JSON.stringify(id) + ' 必須被 HTTP 層拒絕');
    }
  }
}));

/* MAJOR 2：存檔目標與載入來源必須一致，否則會改到別人的檔案。 */
test('C6 Editor 在 preset.id 與載入來源不一致時停用存檔', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8');
  const guard = src.slice(src.indexOf('function saveTargetProblem'),
    src.indexOf('function showSaveError'));
  assert.ok(/state\.sourcePresetId/.test(guard), '必須比對載入來源 id');
  const saveFn = src.slice(src.indexOf('function savePreset'),
    src.indexOf('function downloadPreset'));
  assert.ok(saveFn.indexOf('saveTargetProblem()') >= 0 &&
    saveFn.indexOf('saveTargetProblem()') < saveFn.indexOf("method: 'PUT'"),
    'savePreset 必須在送出 PUT 之前先過這道擋門');
  assert.ok(/state\.sourcePresetId = bootPresetId/.test(src),
    '開場載入時必須記下來源 id');
});
