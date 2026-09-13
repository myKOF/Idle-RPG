const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');

/* 2026-09-13 回報：「任何 UI 操作或觸發事件，都會讓戰鬥區的演出卡頓」——
   滑過技能列讓底框亮起、裝備提示彈出、捲動，每一件都只是幾毫秒的工作。
   卡頓探針在使用者機器上量到每秒 106 幀，rAF 回呼 60 秒吃掉 14938ms
  （四分之一的主執行緒）。106Hz 的每幀預算只有 9.4ms，任何額外工作都會把它擠爆。
   把更新上限壓到 60，每幀預算變成 16.7ms，UI 的工作才塞得進去。 */

test('戰鬥畫面的更新上限預設為 60 幀', () => {
  assert.match(src, /var BATTLE_MAX_FPS = 60;/);
});

test('?fps=N 可覆寫上限，0 代表不設限，其餘夾在 15～240', () => {
  const fn = src.slice(src.indexOf('function battleMaxFps()'), src.indexOf('/* ?vfx=legacy'));
  assert.ok(fn.length > 0, '找不到 battleMaxFps');
  // 只釘行為，不釘正則的寫法：比對跳脫字元的斷言太脆，改一次就要修一次
  assert.ok(fn.indexOf("fps=") >= 0, '要從網址讀 fps 參數');
  assert.match(fn, /location.search/);
  assert.match(fn, /if \(!m\) return BATTLE_MAX_FPS;/);
  assert.match(fn, /if \(n <= 0\) return 0;/);
  assert.match(fn, /Math\.max\(15, Math\.min\(240, n\)\)/);
});

/* 順序是關鍵：maxFPS 是 Pixi 內部把 rAF 節流的依據，tickWorld 自己不判斷要不要跑。
   先 add 再設上限雖然多半也會生效，但把兩者綁在一起才不會有人日後拆開順序卻沒發現。 */
test('上限必須在掛上 tickWorld 之前設定', () => {
  const setIdx = src.indexOf('app.ticker.maxFPS = battleMaxFps();');
  const addIdx = src.indexOf('app.ticker.add(tickWorld);');
  assert.ok(setIdx > 0, '找不到 maxFPS 設定');
  assert.ok(addIdx > 0, '找不到 ticker.add');
  assert.ok(setIdx < addIdx, 'maxFPS 要在 ticker.add 之前設定');
});

test('啟動訊息要印出目前上限，實機才看得出設定有沒有生效', () => {
  assert.match(src, /上限 ' \+\s*\(app\.ticker\.maxFPS \|\| '不設限'\) \+ ' 幀）/);
});
