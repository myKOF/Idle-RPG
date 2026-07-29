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
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/stats.js', 'js/combat.js']
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

/* 新版戰鬥：敵方改為固定 4×4 棋盤，版面不再隨敵人數量變動。
   舊的 enemy-count-1~4 專用排版已移除，改由 enemy-grid 與 enemy.cell 決定落點。 */
test('戰鬥區寬度固定；棋盤版型把我方縮到左側，其餘空間全給敵方', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(css, /#combat-area\s*\{[\s\S]*flex:\s*0\s+0\s+500px/);
  // 高塔沿用原本的 202px／VS／BOSS 三欄
  assert.match(css, /\.battle-scene\s*\{[\s\S]*grid-template-columns:\s*202px\s+auto\s+minmax\(0,\s*1fr\)/);
  // 野外棋盤版型：我方一欄 + 敵方一欄，且固定畫布（#ui-shell）的 !important 覆寫要同步分開
  assert.match(css, /\.battle-scene\.multi-enemy-layout\s*\{[\s\S]*grid-template-columns:\s*132px\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /#ui-shell \.battle-scene\.multi-enemy-layout\s*\{[\s\S]*grid-template-columns:\s*132px\s+minmax\(0,\s*1fr\)\s*!important/);
  // 棋盤版型沒有 VS 的位置
  assert.match(css, /#ui-shell \.battle-scene\.multi-enemy-layout\s*>\s*\.vs\s*\{[\s\S]*display:\s*none\s*!important/);
  // 版面不再依敵人數量切換
  assert.doesNotMatch(ui, /multi-enemy-layout',\s*enemies\.length/);
  assert.match(ui, /classList\.add\('multi-enemy-layout'\)/);
});

test('敵方棋盤：格數由 BF_COLS/BF_ROWS 帶入，卡片依 enemy.cell 定位，BOSS 跨 2×2', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  // 棋盤本體
  assert.match(css, /\.enemy-party\.enemy-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(var\(--bf-cols,\s*4\),\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.enemy-party\.enemy-grid\s*\{[\s\S]*grid-template-rows:\s*repeat\(var\(--bf-rows,\s*4\),\s*minmax\(0,\s*1fr\)\)/);
  // 格數來自模擬層常數，不在 UI 端寫死
  assert.match(ui, /setProperty\('--bf-cols',\s*battlefieldCols\(\)\)/);
  assert.match(ui, /setProperty\('--bf-rows',\s*battlefieldRows\(\)\)/);
  // 卡片落點與跨格
  assert.match(ui, /grid-column:'\s*\+\s*cell\.col\s*\+\s*' \/ span '\s*\+\s*\(cell\.w \|\| 1\)/);
  assert.match(ui, /grid-row:'\s*\+\s*cell\.row\s*\+\s*' \/ span '\s*\+\s*\(cell\.h \|\| 1\)/);
  // 站位變動要重建 DOM，否則卡片會停在上一波的格子
  assert.match(ui, /enemyCellSignature\(enemy\)/);
  // 舊的數量專用排版已移除
  assert.doesNotMatch(css, /\.enemy-party\.enemy-count-2\s*\{/);
  assert.doesNotMatch(css, /\.enemy-party\.enemy-count-3\s*\{/);
  assert.doesNotMatch(css, /\.enemy-count-1 \.enemy-card\s*\{/);
});

test('敵人卡片仍以 --ec-scale 等比縮放，且棋盤格內不會被狀態列撐爆', () => {
  assert.match(css, /\.enemy-card \.cb-icon\s*\{[\s\S]*width:\s*calc\(72px\s*\*\s*var\(--ec-scale\)\)/);
  assert.match(css, /\.enemy-card \.enemy-hp\s*\{[\s\S]*height:\s*calc\(22px\s*\*\s*var\(--ec-scale\)\)/);
  assert.match(css, /\.enemy-card \.enemy-hp\s*\{[\s\S]*width:\s*min\(100%,\s*calc\(200px\s*\*\s*var\(--ec-scale\)\)\)/);
  // 棋盤格較小：小怪一種縮放、BOSS 佔 2×2 另一種
  assert.match(css, /\.enemy-party\.enemy-grid\s*\{[\s\S]*--ec-scale:\s*0?\.\d+/);
  assert.match(css, /\.enemy-party\.enemy-grid \.enemy-card\.enemy-rank-boss\s*\{[\s\S]*--ec-scale:/);
  /* .enemy-card>* 的 flex-shrink:0 會讓空狀態列硬吃固定高度，在 104px 高的格子裡直接把卡片撐爆，
     所以棋盤模式必須讓狀態列可壓縮（flex: 0 1 auto）。 */
  assert.match(css, /\.enemy-party\.enemy-grid \.enemy-card \.enemy-status\s*\{[\s\S]*flex:\s*0\s+1\s+auto/);
  // 敵方隊伍絕對定位填滿面板：敵人數量不得撐高戰鬥區（避免 #combat-area 出現捲軸）
  assert.match(css, /\.enemy-combatant \.enemy-party\s*\{[\s\S]*position:\s*absolute/);
  // 棋盤需要比我方單張卡片更高的空間
  assert.match(css, /\.battle-scene\.multi-enemy-layout \.enemy-combatant\s*\{[\s\S]*min-height:/);
});

test('敵人階級表現：圖示、名稱顏色、血條三階', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  // 小怪無圖示、菁英骷髏頭、BOSS 專屬圖標
  assert.match(ui, /ENEMY_RANK_ICONS\s*=\s*\{\s*normal:\s*''/);
  assert.match(ui, /elite:\s*'💀'/);
  assert.match(ui, /boss:\s*'👑'/);
  assert.match(ui, /function enemyRankOf\(enemy\)[\s\S]*isBoss[\s\S]*elite \? 'elite' : 'normal'/);
  assert.match(ui, /enemy-card enemy-rank-'\s*\+\s*rank/);
  // 名稱顏色：小怪淺黃、菁英淺藍、BOSS 深紫
  assert.match(css, /\.enemy-card\.enemy-rank-normal \.enemy-name\s*\{[\s\S]*color:\s*#f5e6a8/);
  assert.match(css, /\.enemy-card\.enemy-rank-elite \.enemy-name\s*\{[\s\S]*color:\s*#7fd4ff/);
  assert.match(css, /\.enemy-card\.enemy-rank-boss \.enemy-name\s*\{[\s\S]*color:\s*#c084fc/);
  // 血條：菁英鮮紅＋外框、BOSS 深紫＋高階外框
  assert.match(css, /\.enemy-card\.enemy-rank-elite \.enemy-hp\s*\{[\s\S]*border:/);
  assert.match(css, /\.enemy-card\.enemy-rank-elite \.hp-fill\.monster\s*\{[\s\S]*#ff2d2d/);
  assert.match(css, /\.enemy-card\.enemy-rank-boss \.enemy-hp\s*\{[\s\S]*outline:/);
  assert.match(css, /\.enemy-card\.enemy-rank-boss \.hp-fill\.monster\s*\{[\s\S]*#7e22ce/);
});

test('名稱不再加「菁英・」前綴，階級改以圖示與顏色表示', () => {
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  assert.doesNotMatch(combat, /'菁英・'/);
});
