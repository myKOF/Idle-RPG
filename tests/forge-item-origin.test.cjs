'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createEngine} = require('../scripts/sim/engine.js');

function setup(slot = 'chest', weaponType) {
  const e = createEngine({seed:1104}).boot(null), c = e.ctx;
  c.setCombatPaused(true);
  Object.assign(c.G.player, {level:250, reincarnations:5, gold:1e12, dust:1000});
  c.forgeSetOperation('ancient');
  const it = c.makeEquipment(250, {rarity:7, level:250, slot:slot==='ring2'?'ring':slot==='weapon2'?'weapon':slot});
  if (weaponType) it.weaponType = weaponType;
  it.affixes.forEach(a => {a.ancient = false;});
  c.equipItem(it, slot);
  c.chance = () => true;
  return {e,c,it};
}
function cmd(c, name, args = {}) {
  const r = c.runCommand('forge.' + name, args);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result, name==='unloadAll'?1:null);
}
function allItems(c) {
  return c.G.inventory.concat(c.G.forge.slots, ...c.G.equipmentSets.map(eq => Object.values(eq))).filter(Boolean);
}
function once(c, it) {assert.equal(allItems(c).filter(x => x.id === it.id).length, 1);}

test('連續兩次精鑄成功還原原欄、重算穿戴屬性，保留物品與鑲嵌資料', () => {
  const {e,c,it} = setup();
  it.sockets[0] = {type:'ruby',level:10};
  it.runes = [1];
  const before = JSON.stringify({sockets:it.sockets,runes:it.runes});
  const order = it.legendaryEquipOrder;
  for (let n = 1; n <= 2; n++) {
    cmd(c,'placeItem',{itemId:it.id});
    assert.deepEqual(JSON.parse(JSON.stringify(e.panel('forge').forge.equipmentOrigin)),
      {itemId:it.id,setIndex:0,slot:'chest'});
    const unequipped = JSON.stringify(c.getStats());
    cmd(c,'start');
    e.stepSeconds(3);
    assert.equal(c.G.equipment.chest,it);
    assert.equal(e.panel('inv').equipment.chest.id,it.id);
    assert.equal(c.G.inventory.some(x => x.id === it.id),false);
    assert.equal(c.divineForgeAncientCount(it),n);
    assert.notEqual(JSON.stringify(c.getStats()),unequipped);
    assert.equal(JSON.stringify(c.getStats()),JSON.stringify(c.computeStats()));
    assert.equal(it.legendaryEquipOrder,order);
    assert.equal(JSON.stringify({sockets:it.sockets,runes:it.runes}),before);
    assert.equal(c.G.forge.equipmentOrigin,undefined);
    once(c,it);
  }
});

for (const action of ['removeItem','unloadAll','setOperation','setQuality']) {
  test(action + ' 取消或切頁還原原套原欄', () => {
    const {c,it} = setup('ring2');
    cmd(c,'placeItem',{itemId:it.id});
    const args = {removeItem:{slotIndex:0},unloadAll:{},setOperation:{mode:'imprint'},setQuality:{rarity:7}};
    cmd(c,action,args[action]);
    assert.equal(c.G.equipment.ring2,it);
    assert.equal(c.G.forge.equipmentOrigin,undefined);
    once(c,it);
  });
}

test('背包來源成功及取消均回背包，不自動填入空穿戴欄或沿用前件來源', () => {
  const {c,it} = setup();
  cmd(c,'placeItem',{itemId:it.id});cmd(c,'unloadAll');
  const bag = c.makeEquipment(250,{rarity:7,slot:'chest'});
  bag.affixes.forEach(a => {a.ancient=false;});
  c.G.inventory.push(bag);
  for (const finish of ['unloadAll','doForge']) {
    cmd(c,'placeItem',{itemId:bag.id});
    assert.equal(c.G.forge.equipmentOrigin,undefined);
    assert.equal(c[finish === 'doForge' ? 'doForge' : 'forgeUnloadAll'](),finish === 'doForge' ? null : 1);
    assert.equal(c.G.equipment.chest,it);
    assert.equal(c.G.inventory.find(x=>x.id===bag.id),bag);
    once(c,it);once(c,bag);
  }
});

test('作業中換套及存讀後仍歸還原套，保留三秒剩餘進度且只結算一次', () => {
  const {e,c,it} = setup();
  c.G.equipment.chest=null;
  c.switchToEquipSet(1);c.equipItem(it,'chest');
  cmd(c,'placeItem',{itemId:it.id});cmd(c,'start');
  e.stepSeconds(1);
  c.switchToEquipSet(2);
  // 新測試宿主的時鐘預設回到 epoch；讀檔前對齊實際已經過的一秒。
  const saved = JSON.parse(e.saveJson()), loaded = createEngine({seed:1104}).boot(null);
  loaded.offlineFor(1);
  loaded.boot(saved);
  const d = loaded.ctx;
  d.setCombatPaused(true);d.chance=()=>true;
  const gold = d.G.player.gold;
  loaded.stepSeconds(1.9);
  assert.equal(d.forgeItemCount(),1);
  loaded.stepSeconds(.1);
  const out = d.G.equipmentSets[1].chest;
  assert.equal(out.id,it.id);
  assert.equal(out.ancientForgeCount,1);
  assert.equal(d.G.equipActive,2);
  assert.equal(d.G.equipment.chest,null);
  assert.equal(d.G.forge.equipmentOrigin,undefined);
  assert.ok(d.G.player.gold<gold);
  once(d,it);
  const after=d.G.player.gold;
  loaded.stepSeconds(3);assert.equal(d.G.player.gold,after);
});

test('原欄已換裝及背包全滿，精鑄裝備還原、替代裝備完整退包', () => {
  const {c,it} = setup();
  cmd(c,'placeItem',{itemId:it.id});
  const replacement=c.makeEquipment(250,{rarity:7,slot:'chest'});
  c.equipItem(replacement,'chest');
  while(c.G.inventory.length<c.inventoryCapacityNow()) c.G.inventory.push(c.makeEquipment(10,{rarity:0}));
  const n=c.G.inventory.length;
  assert.equal(c.doForge(),null);
  assert.equal(c.G.equipment.chest,it);
  assert.equal(c.G.inventory.length,n+1);
  assert.equal(c.G.inventory.find(x=>x.id===replacement.id),replacement);
  once(c,it);once(c,replacement);
});

for (const slot of ['weapon','weapon2']) {
  test(slot+' 還原遵守雙手互斥，滿背包亦完整退還衝突裝備', () => {
    const {c,it} = setup(slot,slot==='weapon'?'greatsword2h':'shield');
    cmd(c,'placeItem',{itemId:it.id});
    const partner=slot==='weapon'?'weapon2':'weapon';
    const other=c.makeEquipment(250,{rarity:7,slot:'weapon'});
    other.weaponType=slot==='weapon'?'shield':'greatsword2h';
    c.equipItem(other,partner);
    while(c.G.inventory.length<c.inventoryCapacityNow()) c.G.inventory.push(c.makeEquipment(10,{rarity:0}));
    assert.equal(c.doForge(),null);
    assert.equal(c.G.equipment[slot],it);
    assert.equal(c.G.equipment[partner],null);
    assert.equal(c.G.inventory.find(x=>x.id===other.id),other);
    once(c,it);once(c,other);
  });
}

test('失敗清除來源且照原配方消耗裝備；缺錢驗證保留來源供取消還原', () => {
  const {c,it} = setup();
  cmd(c,'placeItem',{itemId:it.id});
  c.G.player.gold=0;
  assert.ok(c.doForge());
  assert.equal(c.G.forge.equipmentOrigin.itemId,it.id);
  cmd(c,'unloadAll');
  assert.equal(c.G.equipment.chest,it);
  c.G.player.gold=1e12;
  cmd(c,'placeItem',{itemId:it.id});c.chance=()=>false;
  assert.equal(c.doForge(),null);
  assert.equal(c.G.equipment.chest,null);
  assert.equal(c.G.forge.equipmentOrigin,undefined);
  assert.equal(allItems(c).some(x=>x.id===it.id),false);
});

test('無來源的舊法陣與無效來源安全退包，不猜測原套或遺失裝備', () => {
  for(const origin of [undefined,{setIndex:99,slot:'chest'},{setIndex:0,slot:'weapon'}]) {
    const {e,c,it}=setup();
    cmd(c,'placeItem',{itemId:it.id});
    if(origin) c.G.forge.equipmentOrigin={itemId:it.id,...origin};
    else delete c.G.forge.equipmentOrigin;
    const loaded=createEngine({seed:1104}).boot(JSON.parse(e.saveJson())),d=loaded.ctx;
    cmd(d,'unloadAll');
    assert.equal(d.G.equipment.chest,null);
    assert.equal(d.G.inventory.find(x=>x.id===it.id).id,it.id);
    once(d,it);
  }
});
