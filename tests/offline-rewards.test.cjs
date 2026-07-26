const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

/* 離線收益改版：固定速率獵殺「當前地圖最高階段 −10 捨十位」等級的菁英怪，
   每 20 秒 1 隻、每隻掉落單獨擲骰。
   固定化隨機：chance 只在機率 ≥100% 成立 → rollDropCount 退化為 ⌊pct/100⌋，結果可精確斷言。 */

function loadGameContext() {
  const context = { console, UI: { dirty: {} }, GT: 0 };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/skills.js',
   'js/talents.js', 'js/player.js', 'js/factory.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.chance = (p) => p >= 100;
  context.rnd = () => 1;
  context.blog = () => {};
  context.flog = () => {};
  context.FIELD = { player: null, monster: null, monsters: [] }; // gainXp 升級回滿血藍用（combat.js 未載入）
  context.G = context.newGameState();
  return context;
}

test('離線計算等級：目前地圖最高階段 −10 後捨去個位數，下限 1', () => {
  const c = loadGameContext();
  assert.equal(c.OFFLINE_LEVEL_REDUCE, 10);
  assert.equal(c.offlineStageFor(256), 240); // 使用者範例：256-10=246 → 240
  assert.equal(c.offlineStageFor(265), 250);
  assert.equal(c.offlineStageFor(250), 240);
  assert.equal(c.offlineStageFor(20), 10);
  assert.equal(c.offlineStageFor(15), 1);
  assert.equal(c.offlineStageFor(1), 1);
});

test('離線擊殺數：每 20 秒 1 隻菁英怪，離線預言潛力加成擊殺數', () => {
  const c = loadGameContext();
  assert.equal(c.OFFLINE_KILL_INTERVAL, 20);
  assert.equal(c.offlineKillCount(3600, 0), 180);
  assert.equal(c.offlineKillCount(3600, 10), 198); // 離線預言 +10%
  assert.equal(c.offlineKillCount(19, 0), 0);
});

test('離線收益逐殺結算：每隻菁英單獨擲骰、金幣經驗依菁英與場景倍率', () => {
  const c = loadGameContext();
  // 每殺必掉 1 件普通裝備：100% × 菁英掉落倍率 1.3 = 130% → ⌊130/100⌋ = 1
  c.FIELD_DROP_TABLE = [{ min: 1, rates: [100] }];
  c.G.stage.zone = 'swamp';
  c.G.stage.best = 256;
  c.G.stage.current = 256;
  c.G.savedAt = Date.now() - 3600 * 1000; // 離線 1 小時

  const goldBefore = c.G.player.gold;
  const summary = c.applyOfflineProgress();

  assert.ok(summary, '應回傳離線收益彙總');
  assert.equal(summary.kills, 180);
  assert.equal(summary.stage, 240);
  assert.equal(summary.equips[0], 180);       // 普通裝備 ×180（每隻 1 件）
  assert.equal(c.G.factory.conveyor.length, 180); // 實體裝備進輸送帶

  const m = c.monsterStatsFor(240, true);     // 菁英怪
  const rw = c.ZONES.swamp.rewardMult;        // 沼澤場景倍率
  assert.equal(summary.gold, Math.round(m.gold * rw) * 180);
  assert.equal(summary.xp, Math.round(m.xp * rw) * 180);
  assert.equal(c.G.player.gold - goldBefore, summary.gold);
});

test('離線收益採用玩家上線時的經驗/金幣/掉寶加成', () => {
  const c = loadGameContext();
  c.FIELD_DROP_TABLE = [{ min: 1, rates: [100] }];
  // 上線時裝備：金幣 +50%、經驗 +100%、掉寶率 200（有效掉寶率折半 → +100%）
  c.G.equipment.helmet = {
    affixes: [{ key: 'goldBonus', val: 50 }, { key: 'xpBonus', val: 100 }, { key: 'loot', val: 200 }],
    sockets: []
  };
  c.G.stage.zone = 'swamp';
  c.G.stage.best = 256;
  c.G.savedAt = Date.now() - 3600 * 1000;

  const summary = c.applyOfflineProgress();
  const m = c.monsterStatsFor(240, true);
  const rw = c.ZONES.swamp.rewardMult;
  assert.equal(summary.gold, Math.round(m.gold * rw * 1.5) * 180); // 金幣加成 +50%
  assert.equal(summary.xp, Math.round(m.xp * rw * 2) * 180);       // 經驗加成 +100%
  // 掉寶：100% × (1 + 100%) × 菁英 1.3 = 260% → 每殺必掉 2 件
  assert.equal(summary.equips[0], 360);
});

test('有效離線時間上限（OFFLINE_MAX_HOURS），1 分鐘內不計', () => {
  const c = loadGameContext();
  c.FIELD_DROP_TABLE = [{ min: 1, rates: [] }];
  c.G.stage.best = 100;
  // 超過上限 2 小時 → 以 OFFLINE_MAX_HOURS 計（上限值由參數表調整，不寫死）
  c.G.savedAt = Date.now() - (c.OFFLINE_MAX_HOURS + 2) * 3600 * 1000;
  const summary = c.applyOfflineProgress();
  assert.equal(summary.kills, Math.floor(c.OFFLINE_MAX_HOURS * 3600 / c.OFFLINE_KILL_INTERVAL));

  const c2 = loadGameContext();
  const gold2 = c2.G.player.gold;
  c2.G.savedAt = Date.now() - 30 * 1000; // 30 秒不計
  assert.equal(c2.applyOfflineProgress(), undefined);
  assert.equal(c2.G.player.gold, gold2);
});

test('離線收益彈窗接線：上線時顯示擊殺/經驗/金幣/掉落明細', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const save = fs.readFileSync(path.join(root, 'js', 'save.js'), 'utf8');
  assert.match(html, /id="offline-modal"/);
  assert.match(ui, /function showOfflineSummary\(/);
  assert.match(save, /showOfflineSummary/);
});

test('參數表 10-離線段：新增計算等級與擊殺速率、移除舊估算列，錨點同步', () => {
  const csv = fs.readFileSync(path.join(root, 'config', 'CSV', 'game_parameters.csv'), 'utf8');
  assert.match(csv, /10-離線,有效離線時間/);
  assert.match(csv, /10-離線,計算等級/);
  assert.match(csv, /10-離線,擊殺速率/);
  for (const removed of ['期望暴擊倍率', '估算 DPS', '單殺耗時', '擊殺數', '裝備收益']) {
    assert.doesNotMatch(csv, new RegExp('10-離線,' + removed));
  }
  const ap = fs.readFileSync(path.join(root, 'tools', 'apply_params.cjs'), 'utf8');
  assert.match(ap, /OFFLINE_LEVEL_REDUCE.*10-離線.*計算等級/);
  assert.match(ap, /OFFLINE_KILL_INTERVAL.*10-離線.*擊殺速率/);
  assert.doesNotMatch(ap, /OFFLINE_EFFICIENCY|OFFLINE_MAX_KILLS/);
});
