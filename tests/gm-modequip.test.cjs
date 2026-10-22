'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console,
    Math,
    location: { hostname: 'localhost' },
    UI: { dirty: {} }
  };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);

  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js', 'js/player.js', 'js/gm_exec.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  context.G = context.newGameState();
  context.markStatsDirty = () => {};
  return context;
}

test('modequip 指令：指定第 1 套主手裝備修改屬性與數值', () => {
  const c = loadContext();
  const eq = c.makeEquipment(100, { rarity: 5, level: 100, slot: 'weapon' });
  c.G.equipmentSets[0].weapon = eq;
  c.G.equipment.weapon = eq;

  // 指定 1 1 (第1套主手) 修改物攻
  const res = c.executeGMCommand('modequip 1 1 atkFlat 50000');
  assert.equal(res.ok, true);
  assert.match(res.message, /物理攻擊 = 50000/);

  // 驗證屬性計算與詞條
  const targetAffix = eq.affixes.find(a => a.key === 'atkFlat');
  assert.ok(targetAffix);
  const actualVal = c.affixValue(eq, targetAffix);
  assert.equal(actualVal, 50000);
});

test('modequip 指令：太古操作（全太古、全非太古、單條切換、太古數）', () => {
  const c = loadContext();
  const eq = c.makeEquipment(100, { rarity: 6, level: 100, slot: 'helmet' });
  c.G.equipmentSets[0].helmet = eq;

  // 設為全太古
  const rAll = c.executeGMCommand('modequip set1 helmet ancient all');
  assert.equal(rAll.ok, true);
  assert.equal(eq.ancientCount, eq.affixes.length);
  eq.affixes.forEach(a => assert.equal(a.ancient, true));

  // 設為全非太古
  const rNone = c.executeGMCommand('modequip set1 helmet ancient none');
  assert.equal(rNone.ok, true);
  assert.equal(eq.ancientCount, 0);
  eq.affixes.forEach(a => assert.equal(a.ancient, false));

  // 指定第 1 條為太古
  const rFirst = c.executeGMCommand('modequip set1 helmet ancient 1 on');
  assert.equal(rFirst.ok, true);
  assert.equal(eq.affixes[0].ancient, true);
  assert.equal(eq.ancientCount, 1);

  // 切換第 1 條為非太古
  const rFirstOff = c.executeGMCommand('modequip set1 helmet ancient 1 off');
  assert.equal(rFirstOff.ok, true);
  assert.equal(eq.affixes[0].ancient, false);
  assert.equal(eq.ancientCount, 0);
});

test('modequip 指令：背包裝備需先在背包中選中才可修改', () => {
  const c = loadContext();
  const invItem = c.makeEquipment(100, { rarity: 4, level: 100, slot: 'boots' });
  c.G.inventory.push(invItem);

  // 未選中背包裝備時嘗試修改背包裝備 -> 應拒絕並提示
  const rFail = c.executeGMCommand('modequip inv critRate 20');
  assert.equal(rFail.ok, false);
  assert.match(rFail.message, /背包裝備請先在背包清單中點擊選中/);

  // 模擬選中背包裝備 (@sel:inv:<id>)
  const rSuccess = c.executeGMCommand(`modequip inv critRate 25 @sel:inv:${invItem.id}`);
  assert.equal(rSuccess.ok, true);
  assert.match(rSuccess.message, /暴擊率/);

  const found = invItem.affixes.find(a => a.key === 'critRate');
  assert.ok(found);
  assert.equal(c.affixValue(invItem, found), 25);
});

test('modequip 指令：強化等級、裝備等級、品質與別名支援', () => {
  const c = loadContext();
  const eq = c.makeEquipment(100, { rarity: 3, level: 100, slot: 'ring' });
  c.G.equipmentSets[0].ring = eq;

  // 強化 +100
  const rUp = c.executeGMCommand('改裝備 ring +100');
  assert.equal(rUp.ok, true);
  assert.equal(eq.upgrade, 100);

  // 裝備等級
  const rLv = c.executeGMCommand('modequip ring level 500');
  assert.equal(rLv.ok, true);
  assert.equal(eq.level, 500);

  // 品質
  const rRarity = c.executeGMCommand('editequip ring rarity mythic');
  assert.equal(rRarity.ok, true);
  assert.equal(eq.rarity, 6);
});

test('modequip 指令：無裝備部位與未知屬性容錯', () => {
  const c = loadContext();
  // 第二套副手目前為 null
  c.G.equipmentSets[1].weapon2 = null;
  const rEmpty = c.executeGMCommand('modequip set2 weapon2 atkFlat 1000');
  assert.equal(rEmpty.ok, false);
  assert.match(rEmpty.message, /目前沒有裝備/);

  // 未知屬性防呆
  c.G.equipmentSets[0].weapon = c.makeEquipment(100, { rarity: 3, slot: 'weapon' });
  const rBadAffix = c.executeGMCommand('modequip 1 1 notAnAffix 999');
  assert.equal(rBadAffix.ok, false);
  assert.match(rBadAffix.message, /未知屬性/);
});
