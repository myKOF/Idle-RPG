const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/* 裝備數值存檔改造第三階段（2026-08-01）：自動機組零件與融合寶石。

     零件      { key, tier }        數值＝perTier×階級、名稱＝'T階 零件名'（全推導）
     融合寶石  stats:[{type,mult}]  數值＝5 階寶石數值 × mult（「相當於幾顆 5 階寶石」）

   融合寶石那條特別重要：改寶石 base 之後，融合寶石快照不再需要手動縮放
   （ONE_TIME_MIGRATIONS.md 的 gemAttrDmgBaseV1 就是為此存在的一次性遷移）。 */
function loadContext(files) {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  (files || ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js']).forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

/* ---- 自動機組零件 ---- */

test('產出的零件只存 key 與階級；數值與名稱都是算出來的', () => {
  const c = loadContext();
  c.G = { factory: { parts: [], installed: {}, salvageSlots: 4 } };
  const p = c.makePart(5, 'salvage');
  assert.equal(JSON.stringify(Object.keys(p).sort()), JSON.stringify(['id', 'key', 'kind', 'tier']));
  assert.equal(c.partValue(p), Math.round(c.PART_TYPES[p.key].perTier * 5 * 100) / 100);
  assert.equal(c.partName(p), 'T5 ' + c.PART_TYPES[p.key].name);
});

test('調整 PART_TYPES 的 perTier 後，舊存檔既有零件跟著套用新值', () => {
  const c = loadContext();
  const p = { id: 'p1', kind: 'part', key: 'speedGear', tier: 3 };
  assert.equal(c.partValue(p), 75);          // perTier 25 × 3
  c.PART_TYPES.speedGear.perTier = 30;
  assert.equal(c.partValue(p), 90);
});

test('舊存檔零件的 val／name 直接丟棄（都可推導），且冪等', () => {
  const c = loadContext();
  const p = { id: 'p1', kind: 'part', key: 'scrapForge', tier: 4, val: 999, name: '亂寫的名字' };
  c.ensurePartSource(p);
  assert.equal(JSON.stringify(Object.keys(p).sort()), JSON.stringify(['id', 'key', 'kind', 'tier']));
  assert.equal(c.partValue(p), 80);          // perTier 20 × 4
  assert.equal(c.partName(p), 'T4 碎片熔煉爐');
  const snapshot = JSON.stringify(p);
  c.ensurePartSource(p);
  assert.equal(JSON.stringify(p), snapshot);
});

test('零件已下架時沿用凍結值與原名，不崩', () => {
  const c = loadContext();
  const p = { id: 'p1', kind: 'part', key: 'someRemovedPart', tier: 3, val: 12.5, name: 'T3 已下架零件' };
  c.ensurePartSource(p);
  assert.equal(c.partValue(p), 12.5);
  assert.equal(c.partName(p), 'T3 已下架零件');
});

test('零件加成（partBonus）吃推導值', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js',
    'js/item.js', 'js/skills.js', 'js/talents.js', 'js/player.js', 'js/factory.js']);
  c.G = c.newGameState();
  const p = { id: 'p1', kind: 'part', key: 'scrapForge', tier: 6 };
  c.G.factory.parts = [p];
  c.G.factory.installed = { salvage: ['p1'] };
  assert.equal(c.partBonus('salvage', 'scrapForge'), 120);   // perTier 20 × 6
  c.PART_TYPES.scrapForge.perTier = 10;
  assert.equal(c.partBonus('salvage', 'scrapForge'), 60, '改參數後既有零件的加成跟著變');
});

/* ---- 融合寶石 ---- */

test('融合結果只存 5 階等值倍率，數值由寶石表當場算', () => {
  const c = loadContext();
  c.G = { player: { gems: {}, fusedGems: [] } };
  c.gemCount = () => 2;
  c.addGem = () => {};
  c.chance = () => true;                       // 融合必成功
  const r = c.fuseGemsV2({ kind: 'plain', type: 'ruby', lv: 5 }, { kind: 'plain', type: 'ruby', lv: 5 });
  assert.equal(r.success, true);
  const fg = r.result;
  assert.equal(fg.stats.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(fg.stats[0], 'val'), false, '存檔不得再出現 val');
  assert.ok(fg.stats[0].mult >= 1 && fg.stats[0].mult <= 2, '同屬性融合：介於 1 倍與 2 倍之間');
  assert.equal(c.fusedStatValue(fg.stats[0]),
    Math.round(c.gemStatValue('ruby', c.GEM_MAX_LEVEL) * fg.stats[0].mult * 100) / 100);
});

test('素材倍率：5 階＝1 倍，每高 1 階 ×2', () => {
  const c = loadContext();
  c.G = { player: { gems: {}, fusedGems: [] } };
  c.gemCount = () => 2;
  assert.equal(c.normalizeFuseMaterial({ kind: 'plain', type: 'topaz', lv: 5 }).stats[0].mult, 1);
  assert.equal(c.normalizeFuseMaterial({ kind: 'plain', type: 'topaz', lv: 7 }).stats[0].mult, 4);
  // 倍率換算回數值＝該階寶石數值
  const m7 = c.normalizeFuseMaterial({ kind: 'plain', type: 'topaz', lv: 7 });
  assert.equal(c.fusedStatValue(m7.stats[0]), c.gemStatValue('topaz', 7));
});

test('調整寶石 base 後，融合寶石數值等比跟著變（gemAttrDmgBaseV1 那類遷移不再需要）', () => {
  const c = loadContext();
  const fg = { id: 'f1', level: 5, fusions: 1, leaves: 2, stats: [{ type: 'topaz', mult: 1.6 }] };
  const before = c.fusedStatValue(fg.stats[0]);
  c.GEM_TYPES.topaz.base *= 0.4;               // 模擬 base 下修（0.5 → 0.2 那次的縮放比）
  assert.equal(c.fusedStatValue(fg.stats[0]), Math.round(before * 0.4 * 100) / 100);
  assert.equal(fg.stats[0].mult, 1.6, '倍率不因參數調整而變動');
});

test('舊存檔融合寶石：val → mult 且數值不變（線性與非線性寶石各一）', () => {
  const c = loadContext();
  ['topaz', 'spinel'].forEach((type) => {
    if (!c.GEM_TYPES[type]) return;
    const oldVal = Math.round(c.gemStatValue(type, c.GEM_MAX_LEVEL) * 1.75 * 100) / 100;
    const fg = { id: 'f', level: 5, fusions: 1, leaves: 2, stats: [{ type: type, val: oldVal }] };
    c.ensureFusedGemSource(fg);
    assert.equal(Object.prototype.hasOwnProperty.call(fg.stats[0], 'val'), false, type);
    assert.ok(Math.abs(c.fusedStatValue(fg.stats[0]) - oldVal) <= 0.05,
      type + ' 換算後 ' + c.fusedStatValue(fg.stats[0]) + ' 應等於原值 ' + oldVal);
  });
});

test('融合寶石換算冪等；雙屬性只換算未換算過的那個', () => {
  const c = loadContext();
  const fg = {
    id: 'f1', level: 5, fusions: 2, leaves: 3,
    stats: [{ type: 'ruby', val: c.gemStatValue('ruby', 5) * 2 }, { type: 'topaz', mult: 1.2 }]
  };
  c.ensureFusedGemSource(fg);
  assert.equal(fg.stats[0].mult, 2);
  assert.equal(fg.stats[1].mult, 1.2, '已是新格式的屬性不得被動到');
  const snapshot = JSON.stringify(fg);
  c.ensureFusedGemSource(fg);
  assert.equal(JSON.stringify(fg), snapshot);
});

test('存檔載入會換算庫存與插槽內的融合寶石（migrateSave）', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js',
    'js/item.js', 'js/skills.js', 'js/talents.js', 'js/player.js', 'js/newforge.js', 'js/save.js']);
  const legacyFused = (id) => ({
    id: id, level: 5, fusions: 1, leaves: 2,
    stats: [{ type: 'topaz', val: c.gemStatValue('topaz', 5) * 1.5 }]
  });
  const save = c.newGameState();
  save.version = 1;
  save.player.fusedGems = [legacyFused('inv-1')];
  save.inventory = [{
    id: 'it-1', kind: 'equip', name: '神話的鎖甲', slot: 'chest', rarity: 6, level: 200,
    upgrade: 0, locked: false, affixes: [], enchants: [],
    sockets: [{ fused: legacyFused('sock-1') }],
    parts: undefined
  }];
  save.factory.parts = [{ id: 'p1', kind: 'part', key: 'speedGear', tier: 2, val: 50, name: 'T2 加速齒輪' }];

  const out = c.migrateSave(JSON.parse(JSON.stringify(save)));

  [out.player.fusedGems[0], out.inventory[0].sockets[0].fused].forEach(function (fg) {
    assert.equal(Object.prototype.hasOwnProperty.call(fg.stats[0], 'val'), false, '融合寶石未換算：' + fg.id);
    assert.equal(fg.stats[0].mult, 1.5);
  });
  const p = out.factory.parts[0];
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'val'), false, '零件 val 未丟棄');
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'name'), false, '零件 name 未丟棄');
  assert.equal(c.partValue(p), 50);
});

test('融合公式在倍率空間與改造前等價（同屬性取 rnd(較小, 較大×2)）', () => {
  const c = loadContext();
  c.G = { player: { gems: {}, fusedGems: [] } };
  c.gemCount = () => 2;
  c.addGem = () => {};
  c.chance = () => true;
  c.rnd = (a, b) => b;                         // 取區間上限
  const r = c.fuseGemsV2(
    { kind: 'plain', type: 'ruby', lv: 5 },    // 1 倍
    { kind: 'plain', type: 'ruby', lv: 6 }     // 2 倍
  );
  assert.equal(r.result.stats[0].mult, 4, '上限＝較大值(2)×2');
  assert.equal(c.fusedStatValue(r.result.stats[0]), c.gemStatValue('ruby', c.GEM_MAX_LEVEL) * 4);
});
