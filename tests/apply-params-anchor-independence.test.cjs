/* 參數套用的錨點必須彼此獨立。

   tools/apply_params.cjs 用正則錨點在程式碼裡定位每一個參數。若某個錨點把**另一個
   參數的現值**寫進字串裡，那麼只要那個參數被調整過一次，這個錨點就再也對不上——
   於是它負責的參數從此靜靜地套不進程式，公式讀的不再是配置表的值。

   這種壞法沒有徵兆：遊戲照跑、測試照綠、參數表照改，只是改了沒有效果。

   實測發現過 23 條（2026-08-02）：防禦減傷每級係數、傷害浮動上限、七個稀有度權重
   上限、附魔防基值、分解碎片、強化金幣／碎片、洗煉金幣、寶石商店升級、技能升級係數。
   起因是 2026-08-02 的參數套用把防禦減傷常數從 60 改成 10000，
   而「每級係數」的錨點寫的是 'return def / (def + 60 + '。

   ⚠️ 檢查一律走 --check-anchors，它全程在記憶體裡做、不寫任何檔案。
   早期版本是「改 CSV → --write → 再檢查 → 還原」，那會與平行執行的其他測試
   互相干擾：實測讓 49 個無關測試連帶紅掉，因為它們讀到了被擾動的中間狀態。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('每個參數的錨點都不依賴其他參數的現值', () => {
  let out, code = 0;
  try {
    out = execFileSync(process.execPath, ['tools/apply_params.cjs', '--check-anchors'],
      { cwd: root, encoding: 'utf8' });
  } catch (err) {
    out = String(err.stdout || '');
    code = err.status;
  }
  assert.equal(code, 0, '有錨點在其他參數變動後失配：\n' + out);
  assert.match(out, /所有錨點仍剛好命中一次/, out);
  /* 擾動數量太少就代表這次檢查沒有效力（例如比對邏輯壞了、edits 沒建起來）。 */
  const n = /擾動了 (\d+) 個數值/.exec(out);
  assert.ok(n && Number(n[1]) > 300, '擾動到的數值太少，這個檢查形同虛設：' + out);
});

test('--check-anchors 不得寫入任何檔案', () => {
  /* 這支檢查會被放進 npm test，而 npm test 是平行跑的。
     它一旦碰檔案，其他測試就會讀到中間狀態——那正是這支測試最初的寫法所犯的錯。 */
  const targets = ['js/formula.js', 'js/data.js', 'js/combat.js', 'js/item.js', 'js/skills.js',
    'config/CSV/game_parameters.csv'].map((p) => path.join(root, p));
  const before = targets.map((f) => fs.readFileSync(f));

  try {
    execFileSync(process.execPath, ['tools/apply_params.cjs', '--check-anchors'], { cwd: root });
  } catch (err) { /* 失敗與否由上一個測試判定，這裡只看有沒有動到檔案 */ }

  targets.forEach((f, i) => {
    assert.ok(before[i].equals(fs.readFileSync(f)), '--check-anchors 動到了 ' + path.relative(root, f));
  });
});
