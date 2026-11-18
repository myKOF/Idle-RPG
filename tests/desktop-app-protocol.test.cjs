'use strict';
/* 桌面版 app:// 協議的路徑解析與 Range 計算（electron/app-protocol.cjs）。
   這支是遊戲檔案唯一的出口：解析錯一格就可能把開發檔案（.git、.env）或根目錄外的檔案送給頁面。 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const P = require('../electron/app-protocol.cjs');

const ROOT = path.resolve(__dirname, '..');
const r = (url) => P.resolveRequestPath(ROOT, url);

test('一般檔案對應到根目錄底下，query 與 hash 忽略', () => {
  assert.strictEqual(r('app://game/js/main.js?v=1.0.3'), path.join(ROOT, 'js', 'main.js'));
  assert.strictEqual(r('app://game/index.html#x'), path.join(ROOT, 'index.html'));
  assert.strictEqual(r('app://game/'), path.join(ROOT, 'index.html'));
  assert.strictEqual(r('app://game'), path.join(ROOT, 'index.html'));
});

test('URL 編碼的中文與空白檔名可以解析', () => {
  assert.strictEqual(r('app://game/images/%E5%9C%96%20a.png'), path.join(ROOT, 'images', '圖 a.png'));
});

test('跳出根目錄的路徑一律拒絕', () => {
  // 明文 ../ 與 %2e%2e 會被 URL 解析器正規化並夾在根目錄（標準協議的行為），結果仍在根目錄內
  assert.strictEqual(r('app://game/%2e%2e/secret.txt'), path.join(ROOT, 'secret.txt'));
  assert.strictEqual(r('app://game/js/%2e%2e/%2e%2e/%2e%2e/secret.txt'), path.join(ROOT, 'secret.txt'));
  // 解碼後才出現的分隔符號（%2F、%5C）組成的穿越，URL 解析器擋不到，要靠本模組
  assert.strictEqual(r('app://game/js/..%5C..%5Csecret.txt'), null);
  assert.strictEqual(r('app://game/js/%2e%2e%5c%2e%2e%5csecret.txt'), null);
  assert.strictEqual(r('app://game/..%2F..%2Fsecret.txt'), null);
  assert.strictEqual(r('app://game/C:/Windows/win.ini'), null);
  assert.strictEqual(r('app://game/%00.js'), null);
  assert.strictEqual(r('app://game/%E0%A4%A'), null);   // 解碼失敗
});

test('點開頭的路徑段（.git、.env、.claude）拒絕', () => {
  assert.strictEqual(r('app://game/.git/config'), null);
  assert.strictEqual(r('app://game/.env'), null);
  assert.strictEqual(r('app://game/js/.hidden/a.js'), null);
});

test('別的協議或主機名拒絕', () => {
  assert.strictEqual(r('app://other/index.html'), null);
  assert.strictEqual(r('http://game/index.html'), null);
  assert.strictEqual(r('not a url'), null);
});

test('主機名 game 不會被 isInternalServer／isGMHost 視為內測環境', () => {
  // 與 js/ui.js isInternalServer 的判斷同形：正式版靠這點自動關閉 GM
  const host = new URL(P.ORIGIN).hostname;
  assert.strictEqual(host, 'game');
  assert.ok(!['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'].includes(host));
  assert.ok(!/\.(local|test)$/.test(host));
});

test('Worker 與 module 需要的 JavaScript MIME', () => {
  assert.match(P.mimeFor('a/b.js'), /^text\/javascript/);
  assert.match(P.mimeFor('A.MJS'), /^text\/javascript/);
  assert.strictEqual(P.mimeFor('x.glb'), 'model/gltf-binary');
  assert.strictEqual(P.mimeFor('x.unknownext'), 'application/octet-stream');
});

test('Range 標頭解析', () => {
  assert.strictEqual(P.parseRange(null, 100), null);
  assert.deepStrictEqual(P.parseRange('bytes=0-', 100), { start: 0, end: 99 });
  assert.deepStrictEqual(P.parseRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepStrictEqual(P.parseRange('bytes=90-500', 100), { start: 90, end: 99 });
  assert.deepStrictEqual(P.parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepStrictEqual(P.parseRange('bytes=-500', 100), { start: 0, end: 99 });
  assert.strictEqual(P.parseRange('bytes=100-', 100), false);
  assert.strictEqual(P.parseRange('bytes=20-10', 100), false);
  assert.strictEqual(P.parseRange('bytes=-', 100), false);
  assert.strictEqual(P.parseRange('bytes=0-1,5-6', 100), null);   // 多區段退回整檔
});

test('內測模式：一次只伺服一個主機名；localhost 讓 GM 判定成立，game 不成立', () => {
  const ri = (url) => P.resolveRequestPath(ROOT, url, P.INTERNAL_HOST);
  assert.strictEqual(ri('app://localhost/js/main.js'), path.join(ROOT, 'js', 'main.js'));
  assert.strictEqual(ri('app://game/js/main.js'), null, '內測模式不伺服正式主機名');
  assert.strictEqual(r('app://localhost/js/main.js'), null, '正式模式不伺服 localhost');
  assert.strictEqual(ri('app://localhost/.git/config'), null);
  assert.strictEqual(P.originFor(P.INTERNAL_HOST), 'app://localhost');
  assert.strictEqual(P.originFor(), P.ORIGIN);
  // js/gm.js、js/gm_exec.js、js/ui.js 的 isGMHost 只認這幾個主機名
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(P.originFor(P.INTERNAL_HOST)).hostname));
  assert.ok(!['localhost', '127.0.0.1', '::1'].includes(new URL(P.ORIGIN).hostname));
});

test('內測模式只限從原始碼執行：main.cjs 以 app.isPackaged 擋下、不接 Steam、存檔另放', () => {
  const src = require('fs').readFileSync(path.join(ROOT, 'electron', 'main.cjs'), 'utf8');
  assert.match(src, /internal: !!argValue\('internal'\) && !app\.isPackaged/);
  assert.match(src, /cliAppId: OPTS\.internal \? 0 :/);
  assert.match(src, /configAppId: OPTS\.internal \? 0 :/);
  assert.match(src, /INTERNAL_USER_DATA_DIR_NAME = 'idle-rpg-internal'/);
});
