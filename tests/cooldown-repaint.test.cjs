const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

/* 2026-09-13 使用者機器的 Performance trace：
     RasterTask 佔掉 14 秒中的 6 秒，單筆最大 224.7ms；Commit 在主執行緒最長 420ms
     每一筆超過 50ms 的 RasterTask 之前，最密集的繪製來源都是 bbb-cd-mask／bss-cd-mask
     bbb-cd-mask 在 14 秒內被繪製 2941 次（每秒 210 次）
   冷卻遮罩是 conic-gradient，無法交給合成器：--cd-deg 每變一次就要重新產生漸層、
   重新點陣化所在圖塊。而更新掛在 rAF 上，等於每幀替每個冷卻中的技能各做一次。
   本機 A/B（交替、去暖機）：冷卻圈重繪 4680 → 504 次，整頁重繪 853 → 429 次。 */

function loadCdHelpers() {
  const ctx = { Math };
  vm.createContext(ctx);
  const step = /var CD_DEG_STEP = \d+;/.exec(ui);
  const fn = /function cdDegString\(ratio\) \{[\s\S]*?\n\}/.exec(ui);
  assert.ok(step, '找不到 CD_DEG_STEP');
  assert.ok(fn, '找不到 cdDegString');
  vm.runInContext(step[0] + '\n' + fn[0], ctx);
  return ctx;
}

test('冷卻角度要量化，肉眼看不出的變化不得觸發重繪', () => {
  const { cdDegString, CD_DEG_STEP } = loadCdHelpers();
  assert.ok(CD_DEG_STEP >= 2, '階距太小就失去意義');
  /* 冷卻圈直徑約 40px、周長約 126px，一個像素才對應約 3 度；
     階距大於 5 度就會開始看得出跳格。 */
  assert.ok(CD_DEG_STEP <= 5, '階距太大會看得出跳格');

  assert.equal(cdDegString(0), '0deg');
  assert.equal(cdDegString(1), '360deg');
  // 同一階內的細微變化必須得到同一個字串（＝不會觸發重繪）
  assert.equal(cdDegString(0.5), cdDegString(0.5 + 0.001));
  // 跨階時必須真的改變，否則冷卻圈會卡住不動
  const a = cdDegString(0.5);
  const b = cdDegString(0.5 + CD_DEG_STEP / 360);
  assert.notEqual(a, b);
});

test('三個 cdDeg 產生點都走同一支，初次渲染與每幀更新才會算出同一階', () => {
  assert.equal((ui.match(/cdDegString\(cdRatio\)/g) || []).length, 3);
  assert.doesNotMatch(ui, /\(cdRatio \* 360\)\.toFixed\(1\) \+ 'deg'/);
  assert.doesNotMatch(ui, /\(bRatio \* 360\)\.toFixed\(1\) \+ 'deg'/);
});

/* 把相同的值寫回去仍會讓元素進重繪佇列；textContent 更明顯——
   指派會換掉子節點，必然失效。兩者都要先比對再寫。 */
test('相同的值不得重複寫入', () => {
  assert.match(ui, /function setCdDeg\(el, deg\) \{\s*if \(!el \|\| el\.style\.getPropertyValue\('--cd-deg'\) === deg\) return;/);
  assert.match(ui, /function setCdText\(el, text\) \{\s*if \(!el \|\| el\.textContent === text\) return;/);
  const loop = ui.slice(ui.indexOf('function updateBattleSkillBarCds()'));
  assert.doesNotMatch(loop.slice(0, 3000), /\.style\.setProperty\('--cd-deg'/);
  assert.doesNotMatch(loop.slice(0, 3000), /\.textContent = cdText/);
});

/* 徽章樣板原本在冒號後多一個空白，getPropertyValue 取回時會帶著它，
   guard 的第一次比對必定不相等、白寫一次。 */
test('內嵌樣板不得帶多餘空白，否則首次比對必定失敗', () => {
  assert.match(ui, /class="bbb-cd-mask" style="--cd-deg:' \+ st\.cdDeg/);
  assert.match(ui, /class="bss-cd-mask" style="--cd-deg:' \+ state\.cdDeg/);
});
