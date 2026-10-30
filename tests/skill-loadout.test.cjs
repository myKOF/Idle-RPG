const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: { level: 1 } };
  return context;
}

/* 期望值出處：config/Excel/game_parameters.xlsx 工作表「1-成長經驗」第 4 列「技能裝載欄」，
   param a=每 a 級 +1 格、b=下限、c=上限，經 tools/apply_params.cjs 套進 js/formula.js 的
   LOADOUT_SIZE（改參數請改 xlsx，改 config/CSV 會被下次 sync 沖掉）。
   依 AI_RULES.md 9.1 例外，測試刻意釘住目前數值：參數表一動這裡就會紅，
   這是預期行為——確認新值是有意調整後，把期望值一併更新。
   2026-10-30 改由 system_unlock 表管理（100／200／300／400 級各 +1 格，前 2 格開局即有）。 */
test('未轉生玩家技能裝載欄依等級成長與上限計算', () => {
  const context = loadFormulaContext();
  context.G.player.level = 1;
  assert.equal(context.loadoutSize(), 2);
  context.G.player.level = 99;
  assert.equal(context.loadoutSize(), 2);
  context.G.player.level = 100;
  assert.equal(context.loadoutSize(), 3);
  context.G.player.level = 199;
  assert.equal(context.loadoutSize(), 3);
  context.G.player.level = 200;
  assert.equal(context.loadoutSize(), 4);
  context.G.player.level = 300;
  assert.equal(context.loadoutSize(), 5);
  context.G.player.level = 400;
  assert.equal(context.loadoutSize(), 6);
  context.G.player.level = 9999;
  assert.equal(context.loadoutSize(), 6);   // 封頂＝前 2 格＋4 條解鎖（system_unlock「技能裝載欄 第3~6格」）
});

test('1 轉以上玩家不論等級皆解鎖全數 6 格裝載欄位', () => {
  const context = loadFormulaContext();
  context.reincarnationCount = () => 1;
  context.G.player.level = 1;
  assert.equal(context.loadoutSize(), 6);   // 只寫等級的門檻，轉生過視為越過
});
