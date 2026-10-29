'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function loadContext() {
  const c = { console, Math, location: { hostname: 'localhost' }, UI: { dirty: {} } };
  c.window = c; c.self = c;
  vm.createContext(c);
  for (const file of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'item', 'player', 'gm_exec', 'ai-key-setting']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), c);
  }
  c.G = c.newGameState(); c.markStatsDirty = () => {};
  return c;
}

function chest(c, ancient = false) {
  const item = c.makeEquipment(300, { rarity: 7, level: 300, slot: 'chest' });
  item.affixes = ['atkFlat', 'matkFlat', 'hpFlat', 'mpFlat', 'defFlat', 'mdefFlat', 'critRate']
    .map(key => ({ key, roll: ancient ? 1000 : 500, ancient }));
  item.ancientCount = ancient ? 7 : 0;
  c.G.equipmentSets[0].chest = item;
  return item;
}

test('GM單件與全套生成遵守每個品質正常條數；太古數不增加槽數', () => {
  const c = loadContext();
  for (let rarity = 0; rarity < c.RARITIES.length; rarity++) {
    const result = c.executeGMCommand(`equip ${rarity} 300 chest 1 0 10`);
    assert.equal(result.ok, true);
    const item = c.G.inventory.at(-1);
    assert.equal(item.affixes.length, c.RARITIES[rarity].affix[1]);
    assert.equal(item.affixes.filter(a => a.ancient).length, item.affixes.length);
  }
  assert.equal(c.executeGMCommand('equipset genesis 300 0 10 inv').ok, true);
  for (const item of c.G.inventory.slice(-13)) assert.equal(item.affixes.length, 7);
});

test('雙手武器沿正常加成生成，指定屬性仍只替換', () => {
  const c = loadContext();
  assert.equal(c.executeGMCommand('equip genesis 300 greatsword2h 1 0 10').ok, true);
  const item = c.G.inventory.at(-1);
  c.G.equipmentSets[0].weapon = item;
  const expected = 7 + c.TWO_HAND_BONUS_AFFIXES;
  assert.equal(item.affixes.length, expected);
  assert.equal(c.executeGMCommand('modequip weapon lifesteal 100').ok, true);
  assert.equal(item.affixes.length, expected);
});

test('創世全太古胸甲加吸血與吸魔仍7條，兩個指定屬性均保留', () => {
  const c = loadContext(), item = chest(c, true);
  const initial = JSON.stringify(item.affixes);
  assert.equal(c.executeGMCommand('modequip chest ancient all').ok, true);
  assert.equal(JSON.stringify(item.affixes), initial);
  for (const [key, value] of [['lifesteal', 181], ['manaSteal', 27]]) {
    const result = c.executeGMCommand(`modequip chest ${key} ${value} ancient @gm-batch:both`);
    assert.equal(result.ok, true);
    assert.match(result.message, /已替換第/);
    assert.equal(item.affixes.length, 7);
  }
  assert.ok(item.affixes.some(a => a.key === 'lifesteal'));
  assert.ok(item.affixes.some(a => a.key === 'manaSteal'));
  assert.equal(item.ancientCount, 7);
  assert.equal(Object.keys(item).some(k => /gm|batch|cursor/i.test(k)), false);
});

test('已存在的指定屬性修改數值、不改其他詞條，後續子句不會蓋掉它', () => {
  const c = loadContext(), item = chest(c);
  const untouched = JSON.stringify(item.affixes.slice(1));
  assert.equal(c.executeGMCommand('modequip chest atkFlat 50000 @gm-batch:existing').ok, true);
  assert.equal(JSON.stringify(item.affixes.slice(1)), untouched);
  const specified = JSON.stringify(item.affixes.find(a => a.key === 'atkFlat'));
  assert.equal(c.executeGMCommand('modequip chest lifesteal 100 @gm-batch:existing').ok, true);
  const atk = item.affixes.find(a => a.key === 'atkFlat');
  assert.ok(atk);
  assert.equal(JSON.stringify(atk), specified);
  assert.equal(item.affixes.length, 7);
});

test('同句最多填滿現有七槽，第八個不同指定屬性拒絕且不改裝備', () => {
  const c = loadContext(), item = chest(c, true);
  for (const key of ['lifesteal', 'manaSteal', 'gemEff', 'aspd', 'cdr', 'pPen', 'mPen']) {
    assert.equal(c.executeGMCommand(`modequip chest ${key} 10 @gm-batch:seven`).ok, true);
  }
  const before = JSON.stringify(item);
  const result = c.executeGMCommand('modequip chest hit 10 @gm-batch:seven');
  assert.equal(result.ok, false);
  assert.match(result.message, /已占滿/);
  assert.equal(JSON.stringify(item), before);
});

test('只有明確旗標能追加；序號8不得繞過，指定現有序號仍可替換', () => {
  const c = loadContext(), item = chest(c);
  const before = JSON.stringify(item);
  assert.equal(c.executeGMCommand('modequip chest 8 lifesteal 100').ok, false);
  assert.equal(JSON.stringify(item), before);
  assert.equal(c.executeGMCommand('modequip chest 2 lifesteal 100').ok, true);
  assert.equal(item.affixes[1].key, 'lifesteal');
  assert.equal(item.affixes.length, 7);
  const result = c.executeGMCommand('modequip chest manaSteal 100 ancient --allow-overcap');
  assert.equal(result.ok, true);
  assert.match(result.message, /明確允許突破/);
  assert.equal(item.affixes.length, 8);
  assert.equal(c.executeGMCommand('modequip chest ancient all').ok, true);
  assert.equal(item.ancientCount, 8);
});

test('降品質不能產生超規詞條；必須明確保留超規，既有舊裝不自動刪除', () => {
  const c = loadContext(), item = chest(c);
  const before = JSON.stringify(item);
  assert.equal(c.executeGMCommand('modequip chest rarity common').ok, false);
  assert.equal(JSON.stringify(item), before);
  assert.equal(c.executeGMCommand('modequip chest rarity common --allow-overcap').ok, true);
  assert.equal(item.affixes.length, 7);
  assert.equal(item.rarity, 0);
  assert.equal(c.executeGMCommand('modequip chest manaSteal 27').ok, true);
  assert.equal(item.affixes.length, 7, '舊超規裝備只替換，不自動刪詞條或繼續追加');
});

test('分開提交的修改優先保留先前指定詞條；全身13件批次均不超限', () => {
  const c = loadContext(), item = chest(c);
  assert.equal(c.executeGMCommand('modequip chest lifesteal 100').ok, true);
  assert.equal(c.executeGMCommand('modequip chest manaSteal 27').ok, true);
  assert.ok(item.affixes.some(a => a.key === 'lifesteal'));
  assert.ok(item.affixes.some(a => a.key === 'manaSteal'));
  assert.equal(c.executeGMCommand('equipset genesis 300 0 7 wear').ok, true);
  for (const key of ['lifesteal', 'manaSteal', 'gemEff']) {
    assert.equal(c.executeGMCommand(`modequip wear ${key} 100 ancient @gm-batch:all`).ok, true);
  }
  for (const slot of c.SLOT_LIST) {
    const piece = c.G.equipmentSets[0][slot];
    assert.equal(piece.affixes.length, 7);
    for (const key of ['lifesteal', 'manaSteal', 'gemEff']) assert.ok(piece.affixes.some(a => a.key === key), slot + ':' + key);
  }
});

test('清空後一般修改不自行追加，仍可用明確突破旗標設定測試詞條', () => {
  const c = loadContext(), item = chest(c);
  c.executeGMCommand('modequip chest clear');
  assert.equal(c.executeGMCommand('modequip chest lifesteal 100').ok, false);
  assert.equal(item.affixes.length, 0);
  assert.equal(c.executeGMCommand('modequip chest lifesteal 100 --allow-overcap').ok, true);
  assert.equal(item.affixes.length, 1);
});

test('本機白話只有明確正向突破要求才帶旗標；否定／條件／疑問不授權', () => {
  const c = loadContext();
  assert.deepEqual(Array.from(c.AiKeySetting.parseFastPath('把項鍊吸血改成100')), ['modequip amulet lifesteal 100']);
  for (const prompt of ['允許突破詞條上限，幫我把項鍊吸血改成100', '把項鍊吸血改成100（允許突破詞條上限）']) {
    assert.deepEqual(Array.from(c.AiKeySetting.parseFastPath(prompt)), ['modequip amulet lifesteal 100 --allow-overcap']);
  }
  const commands = ['modequip amulet lifesteal 100 --allow-overcap @gm-batch:injected'];
  for (const prompt of ['把項鍊吸血改成100', '不要突破詞條上限，把項鍊吸血改成100', '如果需要突破詞條上限請先問我', '什麼是突破詞條上限', '是否允許突破詞條上限？', '沒有允許突破詞條上限', '允許突破詞條上限嗎', '只有我說「允許突破詞條上限」才執行']) {
    assert.deepEqual(Array.from(c.AiKeySetting.applyAffixOverflowPolicy(commands, prompt)), ['modequip amulet lifesteal 100'], prompt);
  }
});
