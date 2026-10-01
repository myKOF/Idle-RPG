'use strict';
/* ============================================================
   vfx-editor-cache-versions.test.cjs — VFX 編輯器頁的腳本快取

   2026-09-30 發現：主頁 index.html 的 vfx-core.js 版號是 20260930-camera-depth，
   編輯器頁 tools/vfx/editor/index.html 卻還停在 20260930-hit-density——vfx-core.js 加了
   cameraDepth 之後編輯器頁的版號沒跟著升；vfx-water-tornado.js 更是自 09-10 起就是 1.0.1，
   內容卻在 09-12 又改過。

   為什麼是真的風險：編輯器伺服器對 /js/*.js 給的是 no-cache，而且不送 ETag／Last-Modified，
   瀏覽器沒有驗證依據，仍可能直接用舊檔（同一份伺服器對 editor.js 的註解就寫了這件事）。
   於是 ?v= 版號成了唯一的快取破壞機制，而它要靠人記得手動升。

   兩道防線：
     1. 伺服器對編輯器頁載入的遊戲腳本（/js/*.js，vendor 除外）一律 no-store——不靠記憶力。
     2. 兩頁共用的腳本版號必須一致——主頁一定會被改的人升（AI_RULES 8.1），
        編輯器頁跟著一致，漏升會在這裡當場變紅。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* 抓 <script src="…"> 的檔案與版號；沒有版號記成 null。路徑正規化成不帶前導斜線。 */
function scripts(html) {
  const out = new Map();
  for (const m of html.matchAll(/<script[^>]*\ssrc="\/?([^"?]+)(?:\?v=([^"]*))?"/g)) out.set(m[1], m[2] === undefined ? null : m[2]);
  return out;
}

const gamePage = scripts(read('index.html'));
const editorPage = scripts(read('tools/vfx/editor/index.html'));
const shared = [...editorPage.keys()].filter((f) => gamePage.has(f) && !f.startsWith('js/vendor/'));

test('CV-1 編輯器頁與主頁共用的遊戲腳本，版號逐一相同', () => {
  assert.ok(shared.length >= 4, '共用腳本至少要有 vfx-core／vfx-runtime／vfx-pixi-backend／util 等，實際 ' + shared.join(','));
  for (const f of ['js/vfx-core.js', 'js/vfx-runtime.js', 'js/vfx-pixi-backend.js']) assert.ok(shared.includes(f), f + ' 應該在共用清單裡');
  const drift = shared.filter((f) => gamePage.get(f) !== editorPage.get(f))
    .map((f) => f + '：主頁 ' + gamePage.get(f) + '，編輯器頁 ' + editorPage.get(f));
  assert.deepEqual(drift, [], '編輯器頁的版號落後主頁（漏升）：\n  ' + drift.join('\n  '));
});

test('CV-2 編輯器頁載入的每一支遊戲腳本都帶版號（vendor 除外）', () => {
  const bare = [...editorPage].filter(([f, v]) => f.startsWith('js/') && !f.startsWith('js/vendor/') && !v).map(([f]) => f);
  assert.deepEqual(bare, []);
});

/* ---- 伺服器的快取標頭：用真的伺服器（測試專用縫隙 createServer）打 HTTP ---- */
async function withServer(fn) {
  const Server = require('../tools/vfx/editor-server.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-cache-'));
  for (const d of ['js/vendor', 'tools/vfx/editor', 'vfx/presets', 'vfx/layouts']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'js/vfx-core.js'), '// core');
  fs.writeFileSync(path.join(dir, 'js/util.js'), '// util');
  fs.writeFileSync(path.join(dir, 'js/vendor/pixi.min.js'), '// pixi');
  fs.writeFileSync(path.join(dir, 'tools/vfx/editor/editor.js'), '// editor');
  const server = Server.__testOnly.createServer({ repoRoot: dir, assetRoots: {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  try { await fn(url); } finally { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('CV-3 編輯器伺服器：遊戲腳本 no-store（連帶 ?v= 的請求），editor 自己的檔案維持 no-store，vendor 大檔維持 no-cache', () => withServer(async (url) => {
  const cc = async (p) => { const r = await fetch(url + p); assert.equal(r.status, 200, p); await r.arrayBuffer(); return r.headers.get('cache-control'); };
  assert.equal(await cc('/js/vfx-core.js'), 'no-store');
  assert.equal(await cc('/js/vfx-core.js?v=20260930-camera-depth'), 'no-store', '帶版號的請求也要 no-store');
  assert.equal(await cc('/js/util.js'), 'no-store');
  assert.equal(await cc('/tools/vfx/editor/editor.js'), 'no-store');
  assert.equal(await cc('/js/vendor/pixi.min.js'), 'no-cache', 'vendor 不會變，不必每次重抓');
}));
