const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function loadGameContext() {
  const context = { console, UI: { dirty: {} }, GT: 0 };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js', 'js/skills.js',
   'js/talents.js', 'js/player.js', 'js/factory.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.chance = (p) => p >= 100;
  context.wpick = (pairs) => pairs[0][0];
  context.rnd = () => 1;
  context.blog = () => {};
  context.flog = () => {};
  context.FIELD = { player: null, monster: null, monsters: [] };
  context.G = context.newGameState();
  return context;
}

function setup(c, stage, enemies = 2, equipment = 0) {
  c.G.stage.zone = 'swamp';
  c.G.stage.best = 290;
  c.G.stage.current = stage;
  c.G.savedAt = Date.now() - 61_000;
  c.ZONE_ENCOUNTER.swamp = {
    mobCount: [[1, 300, [[enemies, 1]]]], eliteChance: [[1, 300, 0]],
    eliteCount: [[1, 300, [[1, 1]]]], eliteSize: [[1, 300, enemies, 1]], elitePure: [[1, 300, 0]],
  };
  c.ZONE_STAGE_DROP_TABLE.swamp = [{
    min: stage, max: stage, equipmentRates: [equipment],
    materials: { gemRates: [], ancientEssenceRate: 0, dustRate: 0 },
  }];
}

test('按存檔所在關卡結算，每 5 秒 1 場且每場可擊殺多隻普通怪', () => {
  const c = loadGameContext();
  setup(c, 256, 3, 100);
  const goldBefore = c.G.player.gold;
  const achievementGold = [];
  c.achAddGold = (gold) => achievementGold.push(gold);
  const m = c.monsterStatsFor(256, false);
  const rw = c.ZONES.swamp.rewardMult;
  const summary = c.applyOfflineProgress();

  assert.equal(summary.stage, 256);
  assert.equal(summary.waves, 12);
  assert.equal(summary.kills, 36);
  assert.equal(summary.equips[0], 36);
  assert.equal(c.G.factory.conveyor.length, 36);
  assert.equal(summary.gold, Math.round(m.gold * rw) * 36);
  assert.equal(summary.xp, Math.round(m.xp * rw) * 36);
  assert.equal(c.G.player.gold - goldBefore, summary.gold);
  assert.deepEqual(achievementGold, [summary.gold]);
});

test('普通關逐波選普通或菁英群，高級菁英及小兵分別套用收益和掉落倍率', () => {
  const c = loadGameContext();
  setup(c, 256, 3, 200);
  c.ZONE_ENCOUNTER.swamp.eliteChance[0][2] = 40;
  c.ELITE_GROUP.normalGroupCount = [[1, 1]];
  c.ELITE_GROUP.leaders = 1;
  c.ELITE_GROUP.advChance = [33, 0];
  let encounterRolls = 0;
  let advancedRolls = 0;
  c.chance = (pct) => {
    if (pct === 40) return ++encounterRolls % 2 === 0;
    if (pct === 33) { advancedRolls++; return true; }
    return pct >= 100;
  };
  const st = c.getStats();
  const rw = c.ZONES.swamp.rewardMult;
  const normal = c.monsterStatsFor(256, false);
  const elite = c.monsterStatsFor(256, true);
  const sum = c.applyOfflineProgress();

  assert.equal(encounterRolls, 12);
  assert.equal(advancedRolls, 6);
  assert.equal(sum.kills, 36);
  assert.equal(sum.equips[0], (30 * 2) + (6 * 3));
  for (const key of ['gold', 'xp']) {
    const bonus = 1 + st[key + 'Bonus'] / 100;
    const normalReward = Math.round(normal[key] * rw * bonus);
    const minionReward = Math.round(normal[key] * rw * c.ELITE_GROUP.minionReward * bonus);
    const advancedReward = Math.round(elite[key] * rw * c.ELITE_GROUP.advReward / c.FIELD_ELITE.rewardMult * bonus);
    assert.equal(sum[key], 18 * normalReward + 12 * minionReward + 6 * advancedReward);
  }
});

test('菁英關每場使用多群與純菁英配置，掉落收益依玩家屬性', () => {
  const c = loadGameContext();
  setup(c, 260, 3, 100);
  c.ZONE_ENCOUNTER.swamp.eliteCount[0][2] = [[2, 1]];
  c.ZONE_ENCOUNTER.swamp.elitePure[0][2] = 100;
  c.G.equipment.helmet = {
    affixes: [{ key: 'goldBonus', val: 50 }, { key: 'xpBonus', val: 100 }, { key: 'loot', val: 200 }],
    sockets: []
  };
  const sum = c.applyOfflineProgress();
  const m = c.monsterStatsFor(260, true);
  const rw = c.ZONES.swamp.rewardMult;

  assert.equal(sum.kills, 72);
  assert.equal(sum.gold, Math.round(m.gold * rw * 1.5) * 72);
  assert.equal(sum.xp, Math.round(m.xp * rw * 2) * 72);
  assert.equal(sum.equips[0], 72 * 3);
});

test('野外 BOSS 離線只結算一波，記錄隨存檔保留且正式通關另行記錄', () => {
  const c = loadGameContext();
  setup(c, 50, 2, 100);
  c.G.stage.zone = 'desert';
  c.G.stage.best = 50;
  c.ZONE_ENCOUNTER.desert = c.ZONE_ENCOUNTER.swamp;
  c.ZONE_STAGE_DROP_TABLE.desert = c.ZONE_STAGE_DROP_TABLE.swamp;
  c.ZONE_ENCOUNTER.desert.elitePure[0][2] = 100;
  const first = c.applyOfflineProgress();
  assert.equal(first.kills, 1 + 11 * 2);
  assert.equal(first.equips[0], c.FIELD_BOSS_DROP_MULT + 22);
  assert.equal(c.zoneClearedStage('desert'), 49);
  assert.equal(c.G.stage.current, 50);

  c.G = c.migrateSave(JSON.parse(JSON.stringify(c.G)));
  assert.equal(c.G.stage.current, 50);
  assert.equal(c.G.offlineFieldBossRewards['desert:50'], true);
  c.G.savedAt = Date.now() - 61_000;
  const revisit = c.applyOfflineProgress();
  assert.equal(revisit.kills, 12 * 2);
  assert.equal(revisit.equips[0], 24);
});

test('各敵種寶石及材料倍率跟隨各自敵種，滿載仍按品質折算碎片與寶箱經驗', () => {
  const c = loadGameContext();
  setup(c, 256, 2, 100);
  c.ZONE_STAGE_DROP_TABLE.swamp[0].materials = { gemRates: [60], ancientEssenceRate: 70, dustRate: 70 };
  c.randomGemTypeForLevel = () => 'testGem';
  c.addGem = () => {};
  let chestXpCount = 0;
  c.chestGainSalvageXp = (_rarity, count) => { chestXpCount += count; };
  c.pushConveyor = () => false;
  const sum = c.applyOfflineProgress();
  // 普通怪：60% × 沼澤 1.5 = 90%，在此測試的必掉判定中不產出；材料 70% 同理。
  assert.deepEqual([sum.gems[1], sum.essence, sum.dust], [undefined, 0, 0]);
  assert.equal(sum.equips[0], 24);
  assert.equal(sum.scrap, Math.round(3 * c.RARITIES[0].salv) * 24);
  assert.equal(chestXpCount, 24);
});

test('有效離線時間上限與最短時間門檻', () => {
  const c = loadGameContext();
  setup(c, 256);
  c.G.savedAt = Date.now() - (c.OFFLINE_MAX_HOURS + 2) * 3600 * 1000;
  const summary = c.applyOfflineProgress();
  assert.equal(summary.waves, Math.floor(c.OFFLINE_MAX_HOURS * 3600 / c.OFFLINE_WAVE_INTERVAL));
  assert.equal(summary.kills, summary.waves * 2);

  c.G.savedAt = Date.now() - 59_000;
  const gold = c.G.player.gold;
  assert.equal(c.applyOfflineProgress(), undefined);
  assert.equal(c.G.player.gold, gold);
});

test('非同步尚未結算完換檔時，舊波次無法寫進新存檔', () => {
  const c = loadGameContext();
  setup(c, 256, 2, 100);
  const jobs = [];
  const results = [];
  c.setTimeout = (job) => jobs.push(job);
  c.applyOfflineProgress({ chunkSize: 1, done: (sum) => results.push(sum) });
  jobs.shift()();
  const replacement = c.newGameState();
  const gold = replacement.player.gold;
  c.G = replacement;
  jobs.shift()();
  assert.equal(c.G.player.gold, gold);
  assert.equal(c.G.factory.conveyor.length, 0);
  assert.equal(c._offlineProgressState, null);
  assert.equal(results.length, 0);
});

test('離線收益彈窗接線：上線時顯示擊殺/經驗/金幣/掉落明細', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const save = fs.readFileSync(path.join(root, 'js', 'save.js'), 'utf8');
  assert.match(html, /id="offline-modal"/);
  assert.match(html, /id="offline-modal-confirm"[^>]*data-str="1932"/);
  assert.match(ui, /\$id\('offline-modal-confirm'\)\.addEventListener\('click', closeOfflineSummary\)/);
  assert.match(ui, /function showOfflineSummary\(/);
  assert.match(save, /showOfflineSummary/);
});

test('離線裝備與寶石接續排列，材料數量置於框外，擊殺顯示完整數字', () => {
  const c = loadGameContext();
  const overlay = { style: {} };
  const body = {};
  c.$id = (id) => ({ 'offline-modal': overlay, 'offline-modal-body': body })[id];
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  vm.runInContext(ui.slice(ui.indexOf('function divineStoneIconHTML('), ui.indexOf('function divineStoneTextHTML(')), c);
  vm.runInContext(ui.slice(ui.indexOf('function offlineLootItemHTML('), ui.indexOf('function closeOfflineSummary(')), c);
  c.ENCHANT_ENABLED = true;

  const summary = {
    seconds: 3600, stage: 280, zoneName: '<zone>', waves: 1200, kills: 3991, xp: 300, gold: 200,
    equips: { 0: 2 }, gems: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, i + 1])),
    essence: 11, dust: 12, parts: 13, scrap: 14, books: 15,
    forge: { salvaged: 5, gold: 50, scrap: 16, essence: 17, ancientEssence: 18 },
  };
  c.showOfflineSummary(summary);
  assert.equal(overlay.style.display, 'flex');
  assert.ok(body.innerHTML.includes(c.STR(398) + ' 1,200'));
  assert.ok(body.innerHTML.includes(c.STR(2054, '280', '&lt;zone&gt;', '', '3,991')));
  assert.ok(body.innerHTML.includes(`<div class="offline-sum-row">${c.STR(2409, 5, c.STR(1049, 50))}</div>`));
  const grids = [...body.innerHTML.matchAll(/<div class="offline-sum-grid">(.*?)<\/div>/g)];
  assert.equal(grids.length, 1);
  const items = grids[0][1].split('<span class="offline-sum-item">').slice(1);
  assert.equal(items.length, 11);
  assert.ok(items[0].includes(`style="color:${c.RARITIES[0].color}">${c.STR(45, c.RARITIES[0].name)}</span>×2</span>`));
  for (let level = 1; level <= 10; level++) {
    const gem = `<span class="offline-sum-badge" style="color:${c.RARITIES[level - 1].color}">` +
      `<span class="offline-sum-gem-icon" aria-hidden="true"></span>${c.GEM_NAMES[level]}${c.STR(122)}</span>×${level}</span>`;
    assert.equal(items[level], gem, `level ${level}`);
  }
  const materials = body.innerHTML.split('<div class="offline-sum-materials">')[1];
  assert.equal((materials.match(/class="offline-sum-badge"/g) || []).length, 6);
  for (const [id, count] of [[13, 29], [100, 12], [385, 13], [98, 30], [102, 15], [99, 17]]) {
    assert.ok(materials.includes(`${c.STR(id)}</span>×${count}</span>`), `material ${id}`);
  }
  assert.ok(materials.includes(`title="${c.STR(2062, 14)}"`));

  c.showOfflineSummary({ seconds: 3600, stage: 280, kills: 3, xp: 300, gold: 200, forge: summary.forge });
  assert.ok(body.innerHTML.includes(`${c.STR(98)}</span>×16</span>`));
  assert.ok(body.innerHTML.includes(`${c.STR(13)}</span>×18</span>`));
  assert.doesNotMatch(body.innerHTML, /class="offline-sum-item" title=/);

  c.showOfflineSummary({ seconds: 3600, stage: 280, kills: 3, xp: 300, gold: 200 });
  assert.ok(body.innerHTML.includes(`<div class="offline-sum-loot">${c.STR(2064)}</div>`));
});
