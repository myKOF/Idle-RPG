/* 遺物（2026-11-09，js/relic.js、js/relic_data.js、config/Excel/Relics.xlsx）
   1. 配置表：CSV 與 relic_data.js 語意一致；效果鍵清單兩邊一致、每個鍵都有遺物、都接了線
   2. 取得／升級：第一件解鎖 Lv.1、件數累積、升級扣「下一級的升級數量」、錯誤不扣東西
   3. 兩端共算的數值：背包擴充上限／費用、強化碎片、洗煉精華、合成暫存區、封魔塔限時、商人售價
   4. 離線：長夜沙漏延長上限、夜班熔爐／夢境捕手倍率、星圖殘頁次數、晨鐘加成與到期
   數值一律從 RELICS 讀，不寫死表上的數字——設計者調表時測試不該跟著紅。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const { SCHEMAS, csvParse, RELIC_EFFECT_KEYS: TABLE_KEYS, evalLiteral, extractLiteral } = require('../tools/config_tables.cjs');

function loadGameContext() {
  const context = { console, UI: { dirty: {} }, GT: 0 };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/relic_data.js', 'js/relic.js', 'js/status.js', 'js/formula.js',
   'js/battlefield.js', 'js/item.js', 'js/skills.js', 'js/talents.js', 'js/player.js', 'js/factory.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.chance = (p) => p >= 100;
  context.rnd = () => 1;
  context.blog = () => {};
  context.flog = () => {};
  context.FIELD = { player: null, monster: null, monsters: [] };
  context.G = context.newGameState();
  return context;
}
const relicOf = (c, key) => c.RELIC_BY_EFFECT[key];
const valueAt = (c, key, lv) => relicOf(c, key).levels[lv - 1].value;
/* 直接把某效果的遺物設成指定等級（測數值換算時不必走升級流程） */
function setLevel(c, key, lv) { c.G.player.relics[relicOf(c, key).id] = { lv, n: 0 }; }

test('Relics 表：CSV 與 relic_data.js 語意一致', () => {
  const rows = csvParse(fs.readFileSync(path.join(root, 'config/CSV/Relics.csv'), 'utf8')).filter((r) => r.some((x) => String(x).trim() !== ''));
  const built = SCHEMAS.Relics.rebuild(rows.slice(1), rows[0]).RELICS;
  const fromCsv = evalLiteral(extractLiteral(built, 'RELICS').literal);
  const fromJs = evalLiteral(extractLiteral(fs.readFileSync(path.join(root, 'js/relic_data.js'), 'utf8'), 'RELICS').literal);
  assert.deepStrictEqual(fromJs, fromCsv, '表改了卻沒跑「套用參數.bat」，或 relic_data.js 被手改');
});

test('效果鍵：程式與配置表的清單一致，每個鍵恰有一件遺物，而且都接了線', () => {
  const c = loadGameContext();
  assert.deepStrictEqual(Array.from(c.RELIC_EFFECT_KEYS), TABLE_KEYS, 'js/relic.js 與 tools/config_tables.cjs 的效果鍵清單不一致');
  const used = Array.from(c.RELICS, (r) => r.effect).sort();
  assert.deepStrictEqual(used, TABLE_KEYS.slice().sort(), '每個效果鍵應恰好對應一件遺物');
  /* 接線：效果鍵必須以字串出現在 relic.js 以外的遊戲程式（relicValue／relicPct／relicRoll／relicDiscount 的參數）。
     寶箱三鍵由 relic.js 自己的 relicChest* 介面讀，寶箱系統另外實作。 */
  const src = ['js/save.js', 'js/formula.js', 'js/data.js', 'js/item.js', 'js/factory.js', 'js/runeword.js', 'js/forge.js', 'js/tower.js', 'js/worker/sim.worker.js']
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + fs.readFileSync(path.join(root, 'js/relic.js'), 'utf8').split('/* ---- 各系統共用的換算 ---- */')[1];
  TABLE_KEYS.forEach((key) => assert.ok(src.includes("'" + key + "'"), '效果鍵 ' + key + ' 沒有任何讀取點'));
});

test('取得：第一件解鎖 Lv.1，之後累積件數；升級扣下一級的升級數量', () => {
  const c = loadGameContext();
  const relic = c.RELICS[0];
  assert.equal(c.relicLevel(relic.id), 0);
  assert.equal(c.relicValue(relic.effect), 0, '未取得＝0');
  assert.equal(c.relicUpgrade(relic.id), c.STR(2451), '未取得不能升級');

  c.relicGrant(relic.id, relic.levels[0].cost);
  assert.equal(c.relicLevel(relic.id), 1);
  assert.equal(c.relicValue(relic.effect), relic.levels[0].value);

  const need = relic.levels[1].cost;
  if (need > 1) {
    c.relicGrant(relic.id, need - 1);
    assert.equal(c.relicUpgrade(relic.id), c.STR(2453, need, need - 1), '件數不足要回錯誤');
    assert.equal(c.relicEntry(relic.id).n, need - 1, '失敗不扣件數');
    c.relicGrant(relic.id, 1);
  } else {
    c.relicGrant(relic.id, 1);
  }
  assert.equal(c.relicUpgrade(relic.id), null);
  assert.deepEqual({ ...c.relicEntry(relic.id) }, { lv: 2, n: 0 });
  assert.equal(c.relicValue(relic.effect), relic.levels[1].value);

  // 一路升到滿級，再升要回「已滿級」；滿級後件數照樣累積
  const total = relic.levels.slice(2).reduce((s, l) => s + l.cost, 0);
  c.relicGrant(relic.id, total + 3);
  while (c.relicUpgrade(relic.id) === null) { /* 升到不能升 */ }
  assert.equal(c.relicLevel(relic.id), relic.levels.length);
  assert.equal(c.relicEntry(relic.id).n, 3);
  assert.equal(c.relicUpgrade(relic.id), c.STR(2452));
  assert.equal(c.relicUpgrade(9999), c.STR(2450));
});

test('說明文字：{v} 代入該級數值強度', () => {
  const c = loadGameContext();
  c.RELICS.forEach((r) => r.levels.forEach((l, i) => {
    const text = c.relicDescAt(r, i + 1);
    assert.ok(!text.includes('{v}'), r.name + ' Lv.' + (i + 1) + ' 還有沒代入的 {v}');
    if (l.desc.includes('{v}')) assert.ok(text.includes(String(l.value)), r.name + ' Lv.' + (i + 1) + ' 說明沒有出現數值 ' + l.value);
  }));
});

test('兩端共算的費用與上限：背包、強化碎片、洗煉精華、暫存區、封魔塔限時', () => {
  const c = loadGameContext();
  const it = { level: 300, rarity: 6, upgrade: 12 };
  const base = {
    invMax: c.inventoryExpandMax(), invCost: c.inventoryExpandCost(40), scrap: c.upgradeCost(it).scrap,
    essence: c.rerollCost(it).essence, synth: c.synthBufCap(), tower: c.towerTimeLimitWithTalents(10)
  };
  assert.equal(base.invMax, c.INVENTORY_MAX, '沒有遺物時等於參數表');
  ['inventoryMax', 'inventoryExpandDiscount', 'upgradeScrapDiscount', 'rerollEssenceDiscount', 'synthBuffer', 'towerBossTime']
    .forEach((key) => setLevel(c, key, 10));
  const v = (key) => valueAt(c, key, 10);
  assert.equal(c.inventoryExpandMax(), base.invMax + v('inventoryMax'));
  const rawCost = c.INVENTORY_EXPAND_COST_BASE + c.INVENTORY_EXPAND_COST_MULT * Math.pow(c.INVENTORY_EXPAND_COST_RATE, 41);
  assert.equal(c.inventoryExpandCost(40), Math.round(rawCost * (1 - v('inventoryExpandDiscount') / 100)));
  assert.ok(c.upgradeCost(it).scrap < base.scrap, '強化碎片要變少');
  assert.equal(c.rerollCost(it).essence, Math.floor(base.essence * (1 - v('rerollEssenceDiscount') / 100)));
  assert.equal(c.synthBufCap(), base.synth + v('synthBuffer'));
  assert.equal(c.towerTimeLimitWithTalents(10), base.tower + v('towerBossTime'));
});

test('神祕商人：售價打折；高級品權重只放大符合條件的那幾項', () => {
  const c = loadGameContext();
  const item = { kind: 'gem', type: 'ruby', lv: 3, price: 10000, sold: false };
  assert.equal(c.merchantItemPrice(item), 10000);
  setLevel(c, 'merchantDiscount', 10);
  assert.equal(c.merchantItemPrice(item), Math.round(10000 * (1 - valueAt(c, 'merchantDiscount', 10) / 100)));

  const pairs = [[6, 10], [7, 2], [8, 1]];
  assert.deepEqual(c.relicBoostWeights(pairs, 'merchantHighGem', (lv) => lv >= 7), pairs, '沒有遺物時權重不變');
  setLevel(c, 'merchantHighGem', 3);
  const m = 1 + valueAt(c, 'merchantHighGem', 3) / 100;
  assert.deepEqual(c.relicBoostWeights(pairs, 'merchantHighGem', (lv) => lv >= c.RELIC_MERCHANT_HIGH_GEM_LEVEL).map((p) => [...p]), [[6, 10], [7, 2 * m], [8, 1 * m]]);
});

test('離線：長夜沙漏延長上限，夜班熔爐／夢境捕手另外乘上倍率', () => {
  const c = loadGameContext();
  c.ZONE_STAGE_DROP_TABLE.swamp = [{ min: 1, max: 400, equipmentRates: [100], materials: { gemRates: [], bookRate: 0, ancientEssenceRate: 0, dustRate: 0, partRate: 0 } }];
  c.G.stage.zone = 'swamp';
  c.G.stage.best = 256;
  setLevel(c, 'offlineHours', 2);
  setLevel(c, 'offlineXp', 1);
  setLevel(c, 'offlineEquipDrop', 10);
  const hours = c.OFFLINE_MAX_HOURS + valueAt(c, 'offlineHours', 2);
  c.G.savedAt = Date.now() - (hours + 5) * 3600 * 1000;   // 離線超過延長後的上限
  const sum = c.applyOfflineProgress();
  const kills = Math.floor(hours * 3600 / c.OFFLINE_KILL_INTERVAL);
  assert.equal(sum.kills, kills, '上限＝參數表＋長夜沙漏');
  const stage = sum.stage, m = c.monsterStatsFor(stage, true), rw = c.ZONES.swamp.rewardMult;
  assert.equal(sum.xp, Math.round(m.xp * rw * (1 + valueAt(c, 'offlineXp', 1) / 100)) * kills);
  // 100% × 菁英倍率 × (1 + 夢境捕手%) → 每殺掉 ⌊…/100⌋ 件（chance 只在 ≥100% 成立）
  const per = Math.floor(100 * c.ELITE_DROP_MULT * (1 + valueAt(c, 'offlineEquipDrop', 10) / 100) / 100);
  assert.equal(sum.equips[0], per * kills);
});

test('離線：星圖殘頁每離線 1 小時給最高層 BOSS 獎勵的 N%；滿 100% 給整場、零頭給部分獎勵；沒通關過就不給', () => {
  const c = loadGameContext();
  const calls = [];
  c.grantTowerBossRewards = (floor, firstClear, bossXp, rewards, scale) => { calls.push([floor, firstClear, scale]); return []; };
  c.G.stage.best = 50;
  setLevel(c, 'offlineTowerReward', 5);
  const perHour = valueAt(c, 'offlineTowerReward', 5);
  c.G.savedAt = Date.now() - 10.9 * 3600 * 1000;
  c.applyOfflineProgress();
  assert.equal(calls.length, 0, '封魔塔沒通關過（highest 0）不給');

  c.G.tower.highest = 37;
  c.G.savedAt = Date.now() - 10.9 * 3600 * 1000;   // 不滿 1 小時的零頭不算：10 小時
  const sum = c.applyOfflineProgress();
  const pct = 10 * perHour, full = Math.floor(pct / 100), part = (pct - full * 100) / 100;
  assert.equal(calls.filter((x) => x[2] === undefined).length, full, '整場數');
  const partial = calls.filter((x) => x[2] !== undefined);
  assert.equal(partial.length, part > 0 ? 1 : 0, '零頭只給一次部分獎勵');
  if (part > 0) assert.ok(Math.abs(partial[0][2] - part) < 1e-9, '部分獎勵的比例＝零頭');
  assert.ok(calls.every(([floor, first]) => floor === 37 && first === false), '固定給最高層、非首通');
  assert.deepEqual({ ...sum.towerRewards }, { hours: 10, pct, floor: 37 });
});

test('晨鐘：時間＝每離線 1 小時 N 分鐘；不滿 1 小時沒有；限時加經驗與掉寶，到期後屬性回原值；不會縮短進行中的加成', () => {
  const c = loadGameContext();
  c.G.stage.best = 30;
  const before = c.getStats();
  const loot0 = before.loot, xp0 = before.xpBonus;
  setLevel(c, 'returnBuffMinutes', 1);
  c.G.savedAt = Date.now() - 0.5 * 3600 * 1000;
  assert.equal(c.applyOfflineProgress().returnBuff, undefined, '不滿 1 小時沒有加成');

  c.G.savedAt = Date.now() - 2.5 * 3600 * 1000;
  const sum = c.applyOfflineProgress();
  assert.equal(sum.returnBuff.minutes, 2 * valueAt(c, 'returnBuffMinutes', 1));
  assert.equal(sum.returnBuff.pct, c.RELIC_RETURN_BUFF_PCT);
  c.markStatsDirty();
  assert.equal(c.getStats().loot, loot0 + c.RELIC_RETURN_BUFF_PCT);
  assert.equal(c.getStats().xpBonus, xp0 + c.RELIC_RETURN_BUFF_PCT);

  const longUntil = Date.now() + 10 * 3600 * 1000;
  c.G.player.relicReturnUntil = longUntil;
  c.G.savedAt = Date.now() - 1.2 * 3600 * 1000;
  c.applyOfflineProgress();
  assert.equal(c.G.player.relicReturnUntil, longUntil, '較短的新加成不會蓋掉進行中較長的加成');

  c.G.player.relicReturnUntil = Date.now() - 1;   // 到期
  c.relicTick();
  assert.equal(c.getStats().loot, loot0, 'relicTick 要在到期時作廢屬性快取');
});

test('遺物頁籤在符文頁籤上方、初始開放；腳本與樣式都有載入', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const relicBtn = html.indexOf('data-tab="relics"'), runeBtn = html.indexOf('data-tab="runes"');
  assert.ok(relicBtn > 0 && relicBtn < runeBtn, '遺物頁籤要排在符文頁籤上方');
  assert.ok(!/data-tab="relics"[^>]*display:\s*none/.test(html), '初始即開放，不得預設隱藏');
  assert.ok(fs.existsSync(path.join(root, 'images/ui/enamel-nav/relics.png')));
  ['js/relic_data.js', 'js/relic.js', 'js/ui-relic.js', 'css/relic.css'].forEach((f) => assert.match(html, new RegExp(f.replace('.', '\\.') + '\\?v=')));
  const worker = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
  assert.match(worker, /'\.\.\/relic_data\.js\?v=[^']+', '\.\.\/relic\.js\?v=/, 'Worker 也要載入遺物資料與邏輯');
});
