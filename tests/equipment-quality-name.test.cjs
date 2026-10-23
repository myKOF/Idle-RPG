const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const c = { console, UI: { dirty: {} } };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'item', 'newforge', 'player', 'factory', 'save']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), c);
  }
  return c;
}

const qualities = ['普通', '精良', '稀有', '獨特', '史詩', '傳說', '神話', '創世', '神鑄創世', '混沌', '神鑄混沌'];

test('全部品質新產出的裝備名稱與詳情使用級字前綴', () => {
  const c = loadContext();
  for (const [rarity, quality] of qualities.entries()) {
    const it = c.makeEquipment(200, { rarity, level: 200, slot: 'chest' });
    assert.ok(it.name.startsWith(quality + '級'), it.name);
    assert.ok(c.itemHeaderHTML(it, {}).includes(it.name));
  }
});

test('全部品質及歷史前綴讀檔更新，JSON往返後不重複加前綴', () => {
  const c = loadContext();
  let data = c.newGameState();
  const old = [...qualities.map(q => q + '的'), '粗糙的', '堅實的', '精工的', '奇異的', '大師級', '傳世的', '神鑄的'];
  const expected = [];
  data.inventory = old.map((prefix, i) => {
    const rarity = i % qualities.length;
    const it = c.makeEquipment(200, { rarity, level: 200, slot: 'chest' });
    it.name = prefix + '鎖甲';
    expected.push(qualities[rarity] + '級鎖甲');
    return it;
  });
  for (let n = 0; n < 3; n++) {
    data = c.migrateSave(JSON.parse(JSON.stringify(data)));
    assert.deepEqual(Array.from(data.inventory, it => it.name), expected);
  }
});

test('三套裝備、背包、生產佇列與神鑄槽全部更新名稱並保留物品', () => {
  const c = loadContext();
  const data = c.newGameState();
  const ids = [];
  function item() {
    const it = c.makeEquipment(200, { rarity: 6, level: 200, slot: 'chest' });
    it.name = '神話的鎖甲';
    ids.push(it.id);
    return it;
  }
  data.equipmentSets.forEach(set => { set.chest = item(); });
  data.inventory.push(item());
  data.factory.conveyor.push(item());
  data.factory.synthBuffer.push(item());
  data.newForge.queue.push(item());
  c.sanitizeNewForge(data);
  data.newForge.furnaces[0].queue.push(item());
  data.newForge.furnaces[0].belt.push(item());
  data.forge.slots[0] = item();
  data.forge.result = { name: '神話的鎖甲', rarity: 6, slot: 'chest', level: 200 };
  const migrated = c.migrateSave(JSON.parse(JSON.stringify(data)));
  const found = new Map();
  function visit(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (ids.includes(obj.id)) found.set(obj.id, obj);
    Object.values(obj).forEach(visit);
  }
  visit(migrated);
  assert.equal(found.size, ids.length);
  for (const it of found.values()) assert.equal(it.name, '神話級鎖甲');
  assert.equal(migrated.forge.result.name, '神話級鎖甲');
  migrated.forge.result = { kind: 'gem', type: 'ruby', level: 2 };
  const gemResult = JSON.stringify(migrated.forge.result);
  c.migrateSave(migrated);
  assert.equal(JSON.stringify(migrated.forge.result), gemResult);
});

test('保留中的混合合成大成功以新前綴替換品質，支援新舊輸入', () => {
  const c = loadContext();
  c.SYNTHESIS_ENABLED = true;
  c.ENCHANT_ENABLED = true;
  c.getStats = () => ({ gemEff: 0, hybridMutation: 0 });
  c.partBonus = () => 0;
  c.chance = () => true;
  c.flog = () => {};
  for (const prefix of ['傳說的', '傳說級']) {
    c.G = c.newGameState();
    c.G.factory.autoEquip = false;
    const gemType = Object.keys(c.GEM_TYPES).find(key => c.isGemEnabled(key));
    c.G.player.gems[gemType] = { 1: 1 };
    c.G.player.books.fire = 1;
    const it = c.makeEquipment(200, { rarity: 5, level: 200, slot: 'chest' });
    it.name = prefix + '鎖甲';
    c.G.factory.synthBuffer.push(it);
    assert.equal(c.tryHybridSynthesis(), true);
    assert.equal(it.rarity, 6);
    assert.equal(it.name, '神話級鎖甲');
  }
});
