const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const plain = (v) => JSON.parse(JSON.stringify(v));

function game() {
  const c = { console, UI: { dirty: {} }, markStatsDirty() {}, blog() {} };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'data', 'status', 'formula', 'item', 'forge']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file + '.js'), 'utf8'), c);
  }
  c.G = { player: { gold: 1e15, dust: 20, level: 100, reincarnations: 3,
    gems: { ruby: { 1: 9, 2: 2, 5: 8 }, sapphire: { 1: 3, 5: 2 } },
    fusedGems: [{ id: 'old', stats: [{ type: 'ruby', mult: 1 }, { type: 'sapphire', mult: 1 }], level: 5 }]
  }, inventory: [], factory: { stats: {} } };
  c.GEM_TYPES.ruby.enabled = false;
  return c;
}

test('Excel匯出的開放欄與數值逐種同步，停用品仍保留定義', () => {
  const c = game();
  c.GEM_TYPES.ruby.enabled = true;
  const rows = fs.readFileSync(path.join(ROOT, 'config/CSV/Gems.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(r => r.split(','));
  const header = rows.shift();
  assert.equal(rows.length, Object.keys(c.GEM_TYPES).length);
  assert.ok(header.includes('開放'));
  for (const row of rows) {
    const type = row[0], g = c.GEM_TYPES[type];
    assert.equal(c.isGemEnabled(type), row[header.indexOf('開放')] === '1', type);
    assert.deepEqual(plain(g.values), Array.from({ length: 10 }, (_, i) => Number(row[header.indexOf((i + 1) + '級')])), type);
  }
  assert.equal(c.isGemEnabled('turquoise'), false);
  assert.equal(c.isGemEnabled('agate'), false);
  assert.ok(c.gemIconHTML('turquoise', 5).includes('gem-turquoise-05'));
});

test('CSV schema往返保留開放，舊表缺欄相容且非法旗標拒絕', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/config_tables.cjs'), 'utf8');
  const schema = src.slice(src.indexOf('SCHEMAS.Gems ='), src.indexOf('/* ---- Talents'));
  const prefix = src.slice(0, src.indexOf('/* ---- Skills'));
  // 載入正式工具的helper與schema，不執行CLI或寫回來源。
  const c = { require, __dirname: path.join(ROOT, 'tools'), process, console };
  vm.createContext(c);
  vm.runInContext(prefix.slice(0, prefix.indexOf('SCHEMAS.Skills')) + '\n' + schema + '\nthis.schema = SCHEMAS.Gems;', c);
  const g = game();
  const literal = 'var GEM_TYPES = ' + JSON.stringify(g.GEM_TYPES) + ';';
  const rows = c.schema.extract(literal);
  const rebuilt = c.schema.rebuild(rows, c.schema.header).GEM_TYPES;
  const out = {};
  vm.runInNewContext(rebuilt, out);
  assert.equal(out.GEM_TYPES.ruby.enabled, false);
  assert.equal(out.GEM_TYPES.sapphire.enabled, true);
  const oldHeader = c.schema.header.filter(h => h !== '開放');
  const legacy = c.schema.rebuild([rows[0].slice(0, -1)], oldHeader).GEM_TYPES;
  vm.runInNewContext(legacy, out);
  assert.equal(out.GEM_TYPES.ruby.enabled, true);
  rows[0][rows[0].length - 1] = '2';
  assert.throws(() => c.schema.rebuild(rows, c.schema.header), /開放只能填/);
});

test('關閉寶石的合成、轉換兩端與拆解均不扣物品或金幣', () => {
  const c = game(), before = JSON.stringify(c.G);
  assert.match(c.composeGems('ruby', 1), /已關閉/);
  assert.match(c.convertGems([{ type: 'ruby', lv: 1, n: 3 }], 'sapphire'), /已關閉/);
  assert.match(c.convertGems([{ type: 'sapphire', lv: 1, n: 3 }], 'ruby'), /已關閉/);
  assert.match(c.convertGems([{ type: 'sapphire', lv: 1, n: 1 }, { type: 'ruby', lv: 1, n: 1 }], 'sapphire'), /已關閉/);
  assert.match(c.dismantleGem('ruby', 2).err, /已關閉/);
  assert.equal(JSON.stringify(c.G), before);
});

test('全部合成與強化材料只消耗開放種類，庫存總數仍包含舊物品', () => {
  const c = game();
  assert.equal(c.totalGemsAll(), 24);
  assert.equal(c.totalGemsOfLevel(1), 3);
  assert.equal(c.takeGemOfLevel(1), 'sapphire');
  assert.equal(c.takeGemOfLevel(1), 'sapphire');
  assert.equal(c.takeGemOfLevel(1), 'sapphire');
  assert.equal(c.takeGemOfLevel(1), null);
  c.addGem('sapphire', 1, 3);
  assert.equal(c.composeGems(c.GEM_TYPE_ALL, 1), null);
  assert.equal(c.gemCount('ruby', 1), 9);
  assert.equal(c.gemCount('sapphire', 2), 1);
});

test('關閉的一般及混合融合寶石不能融合、拆解或鑲嵌', () => {
  const c = game(), before = JSON.stringify(c.G);
  const eq = { rarity: 4, slot: 'helmet', sockets: [null] };
  assert.match(c.socketGem(eq, 'ruby', 0, 5), /已關閉/);
  assert.match(c.socketFusedGem(eq, 'old', 0), /已關閉/);
  assert.ok(c.fuseGemsV2({ kind: 'plain', type: 'ruby', lv: 5 }, { kind: 'plain', type: 'sapphire', lv: 5 }).err);
  assert.ok(c.fuseGemsV2({ kind: 'fused', id: 'old' }, { kind: 'plain', type: 'sapphire', lv: 5 }).err);
  assert.match(c.dismantleFusedGem('old').err, /已關閉/);
  assert.equal(JSON.stringify(c.G), before);
  assert.equal(eq.sockets[0], null);
});

test('舊普通與融合寶石可正常顯示／取下，取下後不能重新鑲上', () => {
  const c = game(), fused = c.G.player.fusedGems[0];
  const eq = { sockets: [{ type: 'ruby', level: 5 }, { fused }] };
  c.G.player.fusedGems = [];
  assert.ok(c.gemLabel('ruby', 5).includes('紅寶石'));
  assert.ok(c.fusedGemLabel(fused).includes('物理攻擊'));
  assert.equal(c.unsocketGem(eq, 0), true);
  assert.equal(c.unsocketGem(eq, 1), true);
  assert.equal(c.gemCount('ruby', 5), 9);
  assert.equal(c.G.player.fusedGems[0], fused);
  assert.match(c.socketGem(eq, 'ruby', 0, 5), /已關閉/);
  assert.match(c.socketFusedGem(eq, 'old', 1), /已關閉/);
});

test('神鑄擋放入及舊法陣結算，素材與魔塵可全部取回', () => {
  const c = game();
  assert.match(c.forgePlaceGem('ruby', 5), /已關閉/);
  const f = c.forgeState();
  f.slots = Array.from({ length: 6 }, () => ({ kind: 'gem', type: 'ruby', level: 5 }));
  const gold = c.G.player.gold, dust = c.G.player.dust;
  assert.match(c.doForge(), /已關閉/);
  f.crafting = { startedAt: 1, durationMs: 1, cost: 1, dustCount: 1, rate: 100 };
  c.forgeTick(10);
  assert.equal(f.crafting, null);
  assert.equal(c.G.player.gold, gold);
  assert.equal(c.G.player.dust, dust);
  assert.equal(c.forgeUnloadAll(), 6);
  assert.equal(c.gemCount('ruby', 5), 14);
});

test('商店僅生成開放寶石，舊商品無法單買且全買略過', () => {
  const c = game();
  for (let i = 0; i < 200; i++) assert.ok(c.isGemEnabled(c.randomGemType()));
  c.rollGemShop();
  assert.ok(c.gemShop().items.every(it => c.isGemEnabled(it.type)));
  c.gemShop().items = [{ type: 'ruby', lv: 1, sold: false }, { type: 'sapphire', lv: 1, sold: false }];
  const gold = c.G.player.gold;
  assert.match(c.buyShopGem(0), /已關閉/);
  assert.equal(c.G.player.gold, gold);
  assert.equal(c.buyAllShopGems().bought, 1);
  assert.equal(c.gemCount('ruby', 1), 9);
  assert.equal(c.gemShop().items[0].sold, false);
});

test('全關閉時隨機獎勵／商店安全留空，不建立null種類', () => {
  const c = game();
  Object.values(c.GEM_TYPES).forEach(g => { g.enabled = false; });
  assert.equal(c.randomGemType(), null);
  c.rollGemShop();
  assert.equal(c.gemShop().items.length, 0);
  c.addGem(c.randomGemType(), 1, 1);
  assert.equal('null' in c.G.player.gems, false);
  assert.equal(c.totalGemsOfLevel(1), 0);
});

test('Worker正式指令及批次無法繞過限制', () => {
  const { createEngine } = require('../scripts/sim/engine.js');
  const e = createEngine({ seed: 18 });
  e.boot();
  const g = e.state();
  g.player.gold = 1e10;
  g.player.gems.turquoise = { 1: 9, 5: 3 };
  g.player.gems.sapphire = { 1: 3 };
  const before = JSON.stringify(g.player.gems);
  e.cmd('gem.compose', { type: 'turquoise', level: 1 });
  e.cmd('gem.composeAll', { type: 'turquoise', level: 1 });
  e.cmd('gem.convert', { slots: [{ type: 'turquoise', lv: 1, n: 3 }], targetType: 'sapphire' });
  e.cmd('gem.dismantle', { type: 'turquoise', level: 5 });
  assert.equal(JSON.stringify(g.player.gems), before);
  assert.equal(g.player.gold, 1e10);
  e.cmd('gem.composeAll', { type: '__all__', level: 1 });
  assert.equal(g.player.gems.turquoise[1], 9);
  assert.equal(g.player.gems.sapphire[1], 0);
  assert.equal(g.player.gems.sapphire[2], 1);
});

test('鑲嵌介面排除關閉素材但仍能產生舊寶石庫存顯示', () => {
  const c = game(), ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  const names = ['gemsViewCount', 'gemsViewFused', 'equipGemGridHTML', 'gemTopLevel', 'gemLibItemHTML'];
  c.esc = String; c.fmtFull = String; c.GEM_TIER_COLORS = {};
  c.UI.gemBrowse = { sel: 'ruby' };
  for (const name of names) {
    const fn = ui.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
    assert.ok(fn, name);
    vm.runInContext(fn[0], c);
  }
  const snap = { gems: c.G.player.gems, fusedGems: c.G.player.fusedGems };
  const html = c.equipGemGridHTML(snap);
  assert.doesNotMatch(html, /data-gem-socket="ruby"|data-gem-socket-fused="old"/);
  assert.match(html, /data-gem-socket="sapphire"/);
  assert.match(c.gemLibItemHTML(snap, 'ruby', 19), /紅寶石.*已關閉/);
});

test('全關閉時野外、高塔、離線與熔爐不產生寶石，也沒有無效掉落紀錄', () => {
  const { createEngine } = require('../scripts/sim/engine.js');
  const e = createEngine({ seed: 19 }).boot(), c = e.ctx, g = e.state();
  Object.values(c.GEM_TYPES).forEach(def => { def.enabled = false; });
  c.ZONE_STAGE_DROP_TABLE.desert = [{ min: 1, max: 400, equipmentRates: [],
    materials: { gemRates: [100], bookRate: 0, ancientEssenceRate: 0, dustRate: 0, partRate: 0 } }];
  const before = JSON.stringify(g.player.gems), loot = [];
  c.recordLootGem = (...a) => loot.push(a);
  assert.doesNotThrow(() => c.rollFieldDrops({ level: 1 }));
  c.taskGrantReward({ rewardType: 'gem', rewardParam: 1, rewardQty: 3 });
  c.startTowerFight(1);
  assert.doesNotThrow(() => c.endTowerFight(true));
  c.TOWER.active = false;
  g.stage.zone = 'desert';
  const offline = e.offlineFor(600);
  assert.ok(offline);
  assert.equal(Object.values(offline.gems).reduce((a, b) => a + b, 0), 0);
  // 真正啟用採集器並強制命中採集機率，確認不是未走到掉落分支。
  c.chance = p => p >= 100;
  let collectorQueried = false;
  assert.doesNotThrow(() => c.doSalvage(c.makeEquipment(1, { rarity: 0 }), true, key => {
    if (key === 'gemCollector') { collectorQueried = true; return 100; }
    return 0;
  }));
  assert.equal(collectorQueried, true);
  assert.equal(JSON.stringify(g.player.gems), before);
  assert.equal(loot.length, 0);
});

test('正式存檔重載保留已關閉庫存、融合與裝備效果', () => {
  const { createEngine } = require('../scripts/sim/engine.js');
  const e = createEngine({ seed: 20 }).boot(), g = e.state();
  g.player.gems.turquoise = { 1: 7, 5: 3 };
  const old = { id: 'old-fused-save', level: 5, stats: [{ type: 'agate', mult: 1 }], fusions: 1, leaves: 2 };
  g.player.fusedGems = [old];
  const it = e.ctx.makeEquipment(100, { rarity: 4, slot: 'helmet' });
  it.slot = 'helmet';
  it.sockets = [{ type: 'turquoise', level: 5 }, { fused: old }];
  g.equipment.helmet = it;
  e.ctx.markStatsDirty();
  const stats = e.ctx.getStats();
  const e2 = createEngine({ seed: 20 }).boot(JSON.parse(e.saveJson())), loaded = e2.state();
  assert.deepEqual(plain(loaded.player.gems.turquoise), { 1: 7, 2: 0, 3: 0, 4: 0, 5: 3 });
  assert.equal(loaded.player.fusedGems[0].id, old.id);
  assert.equal(e2.ctx.getStats().blockRate, stats.blockRate);
  assert.equal(e2.ctx.getStats().blockDmgRed, stats.blockDmgRed);
  assert.equal(e2.ctx.unsocketGem(loaded.equipment.helmet, 0), true);
  assert.equal(loaded.player.gems.turquoise[5], 4);
  assert.match(e2.ctx.socketGem(loaded.equipment.helmet, 'turquoise', 0, 5), /已關閉/);
});
