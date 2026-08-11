/* 技能等級上限的唯一入口 skillMaxLvForRc（js/formula.js）。

   本檔的存在理由：改制前散在 formula/talents/ui/save/skills 七處的查表各自帶著寫死的
   fallback（`10 + (rc > 0 ? 5 : 0)` 與 `20 + min(10,rc) * 10`），參數表改制後兩種都成了錯的。
   那種錯法特別惡劣——只在對照表沒載入時才走到，不會報錯，安靜地給出對不上的數字。
   現在保底一律從表本身取值，這裡把「取哪一格」釘住。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: { level: 1 } };
  return context;
}

/* 期望值出處：config/Excel/game_parameters.xlsx「1-轉生對照表」轉生 0~20 各列 param e，
   經 tools/apply_params.cjs 套進 js/data.js 的 REINCARNATION_SKILL_MAX_LEVELS。
   依 AI_RULES.md 9.1 例外刻意釘住數值；目前設定：0 轉 10、每轉 +2、10 轉起封頂 30。 */
test('skillMaxLvForRc：表內轉數逐格查表', () => {
  const c = loadFormulaContext();
  assert.equal(c.skillMaxLvForRc(0), 10);
  assert.equal(c.skillMaxLvForRc(1), 12);
  assert.equal(c.skillMaxLvForRc(7), 24);
  assert.equal(c.skillMaxLvForRc(10), 30);
  assert.equal(c.skillMaxLvForRc(20), 30);
});

test('轉數超出表長取表尾——表尾就是封頂設計，往外推沒有依據', () => {
  const c = loadFormulaContext();
  const table = c.REINCARNATION_SKILL_MAX_LEVELS;
  const last = table[table.length - 1];
  assert.equal(c.skillMaxLvForRc(table.length), last);
  assert.equal(c.skillMaxLvForRc(table.length + 500), last);
});

test('負數／非數字轉數取表首，不會回傳 NaN 或 undefined', () => {
  const c = loadFormulaContext();
  const first = c.REINCARNATION_SKILL_MAX_LEVELS[0];
  assert.equal(c.skillMaxLvForRc(-1), first);
  assert.equal(c.skillMaxLvForRc(undefined), first);
  assert.equal(c.skillMaxLvForRc(null), first);
  assert.equal(c.skillMaxLvForRc('abc'), first);
  assert.equal(c.skillMaxLvForRc(NaN), first);
});

test('小數轉數向下取整（1.9 轉仍是 1 轉的上限）', () => {
  const c = loadFormulaContext();
  assert.equal(c.skillMaxLvForRc(1.9), c.skillMaxLvForRc(1));
});

test('對照表整張缺失才回傳 SKILL_MAX_LV_NO_TABLE，且它不是遊戲設定值', () => {
  const c = loadFormulaContext();
  c.REINCARNATION_SKILL_MAX_LEVELS = undefined;
  assert.equal(c.skillMaxLvForRc(0), c.SKILL_MAX_LV_NO_TABLE);
  assert.equal(c.skillMaxLvForRc(7), c.SKILL_MAX_LV_NO_TABLE);
  c.REINCARNATION_SKILL_MAX_LEVELS = [];
  assert.equal(c.skillMaxLvForRc(3), c.SKILL_MAX_LV_NO_TABLE);
});

test('skillMaxLv 走同一張表——不得再有第二套上限算法', () => {
  const c = loadFormulaContext();
  c.reincarnationCount = () => 3;
  assert.equal(c.skillMaxLv({ cat: 'active' }), c.skillMaxLvForRc(3));
  assert.equal(c.skillMaxLv({ cat: 'fusion', maxLv: 40 }), c.skillMaxLvForRc(3));
});

/* 讀表保底不是靠註解維持的：只要有人再寫死一次 fallback，這條就會紅。 */
test('js/ 底下不得再出現舊制的寫死上限公式', () => {
  const root = path.resolve(__dirname, '..');
  const offenders = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); return; }
      if (!ent.name.endsWith('.js')) return;
      const src = fs.readFileSync(full, 'utf8');
      // 舊制兩種寫法：轉生 +5、以及轉生面板那條 20 + min(10, n) * 10
      if (/\+\s*\(\s*\w+\s*>\s*0\s*\?\s*5\s*:\s*0\s*\)/.test(src) ||
        /20\s*\+\s*Math\.min\(\s*10\s*,\s*\w+\s*\)\s*\*\s*10/.test(src)) {
        offenders.push(path.relative(root, full));
      }
    });
  };
  walk(path.join(root, 'js'));
  assert.deepEqual(offenders, [], '這些檔案仍寫死技能上限公式，應改用 skillMaxLvForRc：' + offenders.join(', '));
});
