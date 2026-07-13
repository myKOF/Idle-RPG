const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(__dirname, '..', 'css/style.css'), 'utf8');

function loadCombatContext() {
  const context = { console, Math: Object.create(Math), UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/stats.js', 'js/combat.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  return context;
}

test('普通與菁英波次都依數量表生成 1～4 隻敵人', () => {
  const context = loadCombatContext();
  context.G = {
    stage: { current: 270, best: 270, zone: 'swamp', kills: 0 },
    player: {},
    factory: { parts: [], installed: { salvage: [], synth: [] } },
    tower: { active: false }
  };
  context.rollFieldEnemyCount = () => 4;

  context.spawnFieldMonster();
  assert.equal(context.FIELD.monsters.length, 4);
  assert.equal(context.FIELD.monsters[0].elite, true);

  context.G.stage.current = 271;
  context.spawnFieldMonster();
  assert.equal(context.FIELD.monsters.length, 4);
  assert.equal(context.FIELD.monsters.every((m) => m.elite === false), true);
});

test('我方戰鬥區域寬度固定，多敵人只平移並擴大敵方區域', () => {
  assert.match(css, /#combat-area\s*\{[\s\S]*flex:\s*0\s+0\s+500px/);
  // 我方欄位全模式固定 202px（單敵標準版型實測值），不再使用 1fr 浮動寬度
  assert.match(css, /\.battle-scene\s*\{[\s\S]*grid-template-columns:\s*202px\s+auto\s+minmax\(0,\s*1fr\)/);
  // 多敵人版型只吃兩側內距平移，不得再改我方欄寬（240px 特例移除）
  assert.match(css, /\.battle-scene\.multi-enemy-layout\s*\{[\s\S]*width:\s*calc\(100%\s*\+\s*32px\)[\s\S]*margin-left:\s*-16px/);
  assert.doesNotMatch(css, /grid-template-columns:\s*240px/);
  // 3 隻以上敵人就套用平移版型（原本 >3 只有 4 隻才觸發）
  assert.match(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'), /multi-enemy-layout',\s*enemies\.length\s*>\s*2/);
});

test('敵人卡片使用統一模板依 --ec-scale 等比縮放', () => {
  // 各數量的縮放係數：1 隻為標準、2 隻與 3/4 隻依可用空間縮小
  assert.match(css, /\.enemy-party\s*\{[\s\S]*--ec-scale:\s*1\b/);
  assert.match(css, /\.enemy-party\.enemy-count-2\s*\{[\s\S]*--ec-scale:\s*0?\.75/);
  assert.match(css, /\.enemy-party\.enemy-count-3,\s*\.enemy-party\.enemy-count-4\s*\{[\s\S]*--ec-scale:\s*0?\.7\b/);
  // 圖示、血條與狀態列全部以 calc(基準 × --ec-scale) 呈現
  assert.match(css, /\.enemy-card \.cb-icon\s*\{[\s\S]*width:\s*calc\(72px\s*\*\s*var\(--ec-scale\)\)/);
  assert.match(css, /\.enemy-card \.enemy-hp\s*\{[\s\S]*height:\s*calc\(22px\s*\*\s*var\(--ec-scale\)\)/);
  assert.match(css, /\.enemy-card \.enemy-status\s*\{[\s\S]*flex:\s*0\s+1\s+calc\(80px\s*\*\s*var\(--ec-scale\)\)[\s\S]*max-height:\s*calc\(80px\s*\*\s*var\(--ec-scale\)\)/);
  // 敵方隊伍絕對定位填滿面板：敵人數量不得撐高戰鬥區（避免 #combat-area 出現捲軸）
  assert.match(css, /\.enemy-combatant \.enemy-party\s*\{[\s\S]*position:\s*absolute/);
  assert.match(css, /\.enemy-party\s*\{[\s\S]*grid-auto-rows:\s*minmax\(0,\s*1fr\)/);
  // 血條寬度隨卡片縮放且永不溢出卡片
  assert.match(css, /\.enemy-card \.enemy-hp\s*\{[\s\S]*width:\s*min\(100%,\s*calc\(200px\s*\*\s*var\(--ec-scale\)\)\)/);
  // 舊有 count-1 專屬放大與多敵固定 180px 血條特例已移除
  assert.doesNotMatch(css, /\.enemy-count-1 \.enemy-card \.cb-icon/);
  assert.doesNotMatch(css, /\.enemy-hp\s*\{[\s\S]{0,80}width:\s*180px/);
  // 排列維持：2 隻直向堆疊、3 隻第一張置中上列
  assert.match(css, /\.enemy-party\.enemy-count-2\s*\{[\s\S]*grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.enemy-party\.enemy-count-3 \.enemy-card:first-child\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/);
});
