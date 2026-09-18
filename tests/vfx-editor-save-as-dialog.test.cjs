'use strict';
/* ============================================================
   vfx-editor-save-as-dialog.test.cjs — 「另存新檔」的 Windows 存檔視窗

   需求（2026-09-14）：另存新檔不要用網頁的輸入框，要跟「載入 Preset」一樣叫
   Windows 的視窗。視窗由編輯器伺服器開，理由見 tools/vfx/save-as-dialog.cjs 開頭
   （瀏覽器的存檔視窗 API 選到既有檔案會先把它清空，而且拿不到路徑）。

   受測對象：
     tools/vfx/save-as-dialog.cjs   路徑檢查、重問流程、PowerShell 介面
     tools/vfx/editor-server.cjs    POST /__save-as-dialog
     tools/vfx/editor/editor.js     askSaveAsName 與 saveAsPreset 的接線

   真的把視窗彈到使用者桌面上的那一步無法自動測。PowerShell 那一段用 dryRun
   實際跑一次（載入組件、讀環境變數、中文來回、輸出格式），只差 ShowDialog 本身。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dialog = require('../tools/vfx/save-as-dialog.cjs');
const policy = require('../tools/vfx/editor/preset-id-policy.js');
const editorServer = require('../tools/vfx/editor-server.cjs');

const REPO = path.resolve(__dirname, '..');

function sandboxPresets() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-save-as-'));
  const presets = path.join(base, 'repo', 'vfx', 'presets');
  fs.mkdirSync(presets, { recursive: true });
  fs.writeFileSync(path.join(presets, 'beam-light.json'), '{}');
  return { base: base, repoRoot: path.join(base, 'repo'), presets: presets };
}

test('SAVEAS-1 選到的路徑：只收 vfx/presets 這一層、.json、合法的 id', function () {
  const sb = sandboxPresets();
  assert.deepEqual(dialog.chosenPresetId(path.join(sb.presets, 'beam-light-blue.json'), sb.presets, policy),
    { id: 'beam-light-blue' });
  assert.deepEqual(dialog.chosenPresetId(path.join(sb.presets, 'Beam-Light-Blue.JSON'), sb.presets, policy),
    { id: 'beam-light-blue' }, '大小寫照以前的輸入框處理：轉小寫');
  assert.deepEqual(dialog.chosenPresetId(path.join(sb.presets, '..', 'presets', 'x.json'), sb.presets, policy),
    { id: 'x' }, '用 .. 繞一圈回到同一層也算');

  [
    [path.join(sb.base, 'elsewhere', 'x.json'), /vfx\\presets/],
    [path.join(sb.presets, 'sub', 'x.json'), /vfx\\presets/],
    [path.join(sb.presets, 'x.txt'), /\.json/],
    [path.join(sb.presets, 'x - 複製.json'), /不能當成特效名稱/]
  ].forEach(function (c) {
    const r = dialog.chosenPresetId(c[0], sb.presets, policy);
    assert.equal(r.id, undefined, c[0] + ' 不該被接受');
    assert.match(r.problem, c[1]);
  });

  if (process.platform === 'win32') {
    assert.deepEqual(dialog.chosenPresetId(path.join(sb.presets.toUpperCase(), 'x.json'), sb.presets, policy),
      { id: 'x' }, 'Windows 的路徑不分大小寫');
  }
});

test('SAVEAS-2 不能用就帶著原因重開視窗；取消就停；既有檔案一律不收', async function () {
  const sb = sandboxPresets();
  const calls = [];
  function answers(list) {
    return function (opts) { calls.push(opts); return Promise.resolve(list.shift()); };
  }

  let r = await dialog.askPresetId({
    presetsDir: sb.presets, suggested: 'beam-light-copy', policy: policy,
    runDialog: answers([
      { path: path.join(sb.presets, 'beam-light.json') },
      { path: path.join(sb.presets, 'beam-light-blue.json') }
    ])
  });
  assert.deepEqual(r, { id: 'beam-light-blue' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].initialDir, sb.presets, '要從 vfx/presets 開始');
  assert.equal(calls[0].fileName, 'beam-light-copy.json', '預設檔名是另存的建議名稱');
  assert.equal(calls[0].message, '', '第一次不必跳訊息');
  assert.match(calls[1].message, /已經有一份「beam-light」/, '選到既有的特效要說明並重問，不能覆寫');
  assert.equal(calls[1].fileName, 'beam-light.json', '重問時保留剛才輸入的名字，方便改');
  assert.equal(fs.readFileSync(path.join(sb.presets, 'beam-light.json'), 'utf8'), '{}',
    '既有檔案一個位元組都不能動');

  calls.length = 0;
  r = await dialog.askPresetId({
    presetsDir: sb.presets, suggested: '', policy: policy,
    runDialog: answers([{ path: path.join(sb.base, 'x.json') }, { canceled: true }])
  });
  assert.deepEqual(r, { canceled: true });
  assert.match(calls[1].message, /vfx\\presets/);

  calls.length = 0;
  r = await dialog.askPresetId({
    presetsDir: sb.presets, suggested: 'a', policy: policy, maxRounds: 2,
    runDialog: answers([{ path: path.join(sb.base, 'x.json') }, { path: path.join(sb.base, 'y.json') }])
  });
  assert.ok(r.problem && !r.id, '一直不能用就放棄並回報原因，不能無限重開');
  assert.equal(calls.length, 2);
});

test('SAVEAS-3 PowerShell 介面：腳本是常數、輸入只走環境變數；輸出用 base64 解回中文', async function () {
  const args = dialog.powershellArgs();
  const script = Buffer.from(args[args.length - 1], 'base64').toString('utf16le');
  assert.equal(script, dialog.DIALOG_SCRIPT);
  assert.ok(/SaveFileDialog/.test(script));
  assert.ok(/OverwritePrompt = \$false/.test(script), '覆寫由伺服器擋，不讓 Windows 問「要取代嗎」');
  ['VFX_SAVE_DIR', 'VFX_SAVE_NAME', 'VFX_SAVE_TITLE', 'VFX_SAVE_MESSAGE'].forEach(function (v) {
    assert.ok(script.indexOf('$env:' + v) >= 0, '要從環境變數讀 ' + v);
  });
  assert.ok(/^[\x00-\x7f]*$/.test(script), '腳本只放 ASCII，中文一律走環境變數');
  assert.ok(args.indexOf('-STA') >= 0, 'WinForms 視窗要在 STA 執行緒開');
  assert.ok(args.indexOf('-NoProfile') >= 0, '不載入使用者的 profile');

  let seen = null;
  const picked = await dialog.runWindowsDialog(
    { initialDir: 'D:\\repo\\vfx\\presets', fileName: "it's $(x).json", title: '另存' },
    {
      platform: 'win32',
      execFile: function (file, argv, options, cb) {
        seen = { argv: argv, env: options.env };
        cb(null, Buffer.from('OK\nD:\\repo\\vfx\\presets\\冰晶-x.json', 'utf8').toString('base64') + '\r\n', '');
      }
    });
  assert.deepEqual(picked, { path: 'D:\\repo\\vfx\\presets\\冰晶-x.json' });
  assert.equal(seen.env.VFX_SAVE_NAME, "it's $(x).json", '檔名原樣放進環境變數');
  assert.deepEqual(seen.argv, args, '命令列與輸入無關：檔名不會變成程式碼');

  const cancel = await dialog.runWindowsDialog({ initialDir: 'x' }, {
    platform: 'win32',
    execFile: function (f, a, o, cb) { cb(null, Buffer.from('CANCEL').toString('base64'), ''); }
  });
  assert.deepEqual(cancel, { canceled: true });

  await assert.rejects(dialog.runWindowsDialog({ initialDir: 'x' }, {
    platform: 'win32',
    execFile: function (f, a, o, cb) { cb(new Error('exit 1'), '', '找不到組件'); }
  }), /找不到組件/);
  await assert.rejects(dialog.runWindowsDialog({ initialDir: 'x' }, { platform: 'linux' }),
    function (e) { return e.code === 'UNSUPPORTED'; });
});

test('SAVEAS-4 Windows 上實際跑一次 PowerShell（dryRun：不開視窗）',
  { skip: process.platform !== 'win32' && '只有 Windows 有這個視窗' }, async function () {
    const r = await dialog.runWindowsDialog({
      initialDir: 'D:\\某個資料夾\\vfx\\presets', fileName: 'slash-冰-copy.json', title: dialog.TITLE,
      message: '已經有一份了。\n請換一個名字。', dryRun: true
    });
    assert.deepEqual(r, {
      dryRun: true, title: dialog.TITLE, initialDir: 'D:\\某個資料夾\\vfx\\presets',
      fileName: 'slash-冰-copy.json', message: '已經有一份了。\n請換一個名字。'
    });
  });

function post(port, urlPath, body, headers) {
  return new Promise(function (resolve, reject) {
    const data = Buffer.from(JSON.stringify(body || {}), 'utf8');
    const req = http.request({
      host: '127.0.0.1', port: port, path: urlPath, method: 'POST', agent: false,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': data.length }, headers || {})
    }, function (res) {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 非 JSON 回應 */ }
        resolve({ status: res.statusCode, json: json, text: text });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function waitFor(fn) {
  for (let i = 0; i < 500 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(fn(), '等不到伺服器開視窗');
}

test('SAVEAS-5 伺服器：POST /__save-as-dialog 只問名字；同時只開一個；非 Windows 回 501；跨來源擋掉', async function () {
  const sb = sandboxPresets();
  let pending = null;
  const calls = [];
  const ctx = {
    repoRoot: sb.repoRoot, assetRoots: {},
    runSaveDialog: function (opts) {
      calls.push(opts);
      return new Promise(function (resolve) { pending = resolve; });
    }
  };
  const server = editorServer.__testOnly.createServer(ctx);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const first = post(port, '/__save-as-dialog', { suggested: 'beam-light-copy' });
    await waitFor(() => pending);
    const second = await post(port, '/__save-as-dialog', { suggested: 'beam-light-copy' });
    assert.equal(second.status, 409, '視窗開著的時候再按一次，要說已經開著，不能疊出第二個');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].initialDir, sb.presets);
    assert.equal(calls[0].fileName, 'beam-light-copy.json');
    pending({ path: path.join(sb.presets, 'beam-light-copy.json') });
    const done = await first;
    assert.equal(done.status, 200, done.text);
    assert.deepEqual(done.json, { ok: true, id: 'beam-light-copy' });
    assert.ok(!fs.existsSync(path.join(sb.presets, 'beam-light-copy.json')), '這條路由只問名字，不寫檔');

    pending = null;
    const cancel = post(port, '/__save-as-dialog', { suggested: '../../evil' });
    await waitFor(() => pending);
    assert.equal(calls[calls.length - 1].fileName, '', '不合法的建議名稱不帶進視窗');
    pending({ canceled: true });
    assert.deepEqual((await cancel).json, { ok: true, canceled: true });

    let res = await post(port, '/__save-as-dialog', {}, { Origin: 'http://evil.example' });
    assert.equal(res.status, 403, '跨來源的網頁不能在使用者桌面上彈視窗');
    res = await post(port, '/__save-as-dialog', {}, { 'Content-Type': 'text/plain' });
    assert.equal(res.status, 403);

    ctx.runSaveDialog = function () {
      const e = new Error('只有 Windows 有這個存檔視窗');
      e.code = 'UNSUPPORTED';
      return Promise.reject(e);
    };
    res = await post(port, '/__save-as-dialog', { suggested: 'a' });
    assert.equal(res.status, 501);
    assert.equal(res.json.unsupported, true, '頁面據此退回輸入框');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(sb.base, { recursive: true, force: true });
  }
});

test('SAVEAS-6 Editor：另存新檔先請伺服器開視窗，開不起來才退回輸入框；不用瀏覽器的存檔視窗 API', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const body = function (name) {
    const at = src.indexOf('function ' + name + '(');
    assert.ok(at >= 0, '找不到 function ' + name);
    const rest = src.slice(at);
    return rest.slice(0, rest.indexOf('\n  }'));
  };
  /* 問名字的本體是 askPresetName，另存新檔與重新命名共用（2026-09-18 加上重新命名時抽出來） */
  const ask = body('askPresetName');
  assert.ok(/fetch\(SAVE_AS_DIALOG_URL/.test(ask) && /method: 'POST'/.test(ask));
  assert.ok(/'Content-Type': 'application\/json'/.test(ask), '伺服器的寫入防護要求 JSON，少了會被 403');
  assert.ok(/window\.prompt\(/.test(ask), '伺服器太舊或不是 Windows 時要退回輸入框，另存新檔不能整個不能用');
  assert.ok(/askPresetName\(current \? current \+ '-copy' : '', 'save-as'\)/.test(body('askSaveAsName')),
    '另存新檔預填「目前的名字-copy」');
  const save = body('saveAsPreset');
  assert.ok(/askSaveAsName\(current\)/.test(save));
  assert.ok(!/window\.prompt\(/.test(save), '名字只從 askSaveAsName 來');
  assert.ok(!/window\.prompt\(/.test(body('renamePreset')) && !/window\.prompt\(/.test(body('commitRename')),
    '重新命名的名字也只從 askPresetName 來');
  assert.ok(!/showSaveFilePicker\s*\(/.test(src), '瀏覽器的存檔視窗選到既有檔案會先把它清空（見 save-as-dialog.cjs）');
  assert.ok(/var SAVE_AS_DIALOG_URL = '\/__save-as-dialog'/.test(src));

  const server = fs.readFileSync(path.join(REPO, 'tools/vfx/editor-server.cjs'), 'utf8');
  assert.ok(/SAVE_AS_DIALOG_PATH = '\/__save-as-dialog'/.test(server), '頁面與伺服器的路徑要一致');
  assert.ok(server.indexOf("'save-as-dialog.cjs'") >= 0, 'save-as-dialog.cjs 要列進 RESTART_REQUIRED_FILES');
});

test('SAVEAS-7 重新命名也用這個視窗問新名字：標題不同；選到目前的名字與選到別人的名字各有說明', async function () {
  /* 需求（2026-09-18）：特效要能直接改名。新名字一樣要看得到資料夾裡已經有哪些、一樣不能蓋掉別人。 */
  const sb = sandboxPresets();
  const calls = [];
  function answers(list) {
    return function (opts) { calls.push(opts); return Promise.resolve(list.shift()); };
  }
  const r = await dialog.askPresetId({
    presetsDir: sb.presets, suggested: 'beam-light', purpose: 'rename', policy: policy,
    runDialog: answers([
      { path: path.join(sb.presets, 'beam-light.json') },
      { path: path.join(sb.presets, 'beam-light.json') },
      { path: path.join(sb.presets, 'beam-light-blue.json') }
    ])
  });
  assert.deepEqual(r, { id: 'beam-light-blue' });
  assert.equal(calls[0].title, dialog.RENAME_TITLE);
  assert.equal(calls[0].fileName, 'beam-light.json', '重新命名預填的就是目前的名字');
  assert.match(calls[1].message, /就是目前的名字/, '沒改就按下去最常見：不要讓人以為那個名字被別人占了');
  assert.notEqual(dialog.RENAME_TITLE, dialog.TITLE);

  fs.writeFileSync(path.join(sb.presets, 'other.json'), '{}');
  calls.length = 0;
  await dialog.askPresetId({
    presetsDir: sb.presets, suggested: 'beam-light', purpose: 'rename', policy: policy,
    runDialog: answers([{ path: path.join(sb.presets, 'other.json') }, { canceled: true }])
  });
  assert.match(calls[1].message, /已經有一份「other」了。重新命名不會蓋掉別的特效/);

  /* 伺服器把 purpose 帶進視窗；沒帶或亂帶一律當成另存新檔 */
  const seen = [];
  const server = editorServer.__testOnly.createServer({
    repoRoot: sb.repoRoot, assetRoots: {},
    runSaveDialog: function (opts) { seen.push(opts.title); return Promise.resolve({ canceled: true }); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    await post(port, '/__save-as-dialog', { suggested: 'beam-light', purpose: 'rename' });
    await post(port, '/__save-as-dialog', { suggested: 'beam-light' });
    await post(port, '/__save-as-dialog', { suggested: 'beam-light', purpose: 'delete-everything' });
    assert.deepEqual(seen, [dialog.RENAME_TITLE, dialog.TITLE, dialog.TITLE]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(sb.base, { recursive: true, force: true });
  }
});
