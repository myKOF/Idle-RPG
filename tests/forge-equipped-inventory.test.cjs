'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine.js');

function setup(mode = 'ancient') {
  const e = createEngine({seed:1101}).boot(null), c = e.ctx;
  c.setCombatPaused(true);
  c.G.player.reincarnations = 5;
  c.G.player.gold = 1e12;
  c.G.player.dust = 1000;
  c.forgeSetOperation(mode);
  const it = c.makeEquipment(250, {rarity:6, level:250, slot:'chest'});
  it.affixes.forEach(a => { a.ancient = false; });
  c.G.equipment.chest = it;
  c.markStatsDirty();
  return {e,c,it};
}
function cmd(c, name, args = {}) {
  const r = c.runCommand('forge.' + name, args);
  assert.equal(r.ok, true, r.error);
  return r.result;
}
function occurrences(c, id) {
  const sets = c.G.equipmentSets || [c.G.equipment];
  return c.G.inventory.concat(c.G.forge.slots, ...sets.map(eq => Object.values(eq))).filter(it => it && it.id === id).length;
}

for (const mode of ['ancient','imprint']) {
  test(mode + ' 身上裝備原子入槽，備用套裝不動，卸料只回背包一份', () => {
    const {e,c,it} = setup(mode);
    const spare = c.makeEquipment(250,{rarity:7,slot:'chest'});
    c.G.equipmentSets[1].chest = spare;
    c.G.equipView = 1;
    assert.equal(cmd(c,'placeItem',{itemId:spare.id}), c.STR(1243));
    assert.equal(cmd(c,'placeItem',{itemId:it.id}), null);
    assert.equal(c.G.equipment.chest, null);
    assert.equal(c.G.equipmentSets[1].chest, spare);
    assert.equal(c.G.forge.slots[0], it);
    assert.equal(e.panel('inv').equipment.chest, null);
    assert.equal(cmd(c,'placeItem',{itemId:it.id}), c.STR(1243));
    assert.equal(occurrences(c,it.id), 1);
    cmd(c,'unloadAll');
    assert.equal(c.G.inventory.filter(x=>x.id===it.id).length,1);
    assert.equal(c.G.equipment.chest,null);
    assert.equal(occurrences(c,it.id),1);
  });
  for (const success of [true,false]) test(mode + ' 穿戴來源存讀後三秒結算，成功／失敗沿用原配方 ' + success, () => {
    const {e,c,it} = setup(mode);
    assert.equal(cmd(c,'placeItem',{itemId:it.id}),null);
    const loaded = createEngine({seed:1101}).boot(JSON.parse(e.saveJson())), d = loaded.ctx;
    d.setCombatPaused(true);
    d.chance = () => success;
    assert.equal(d.G.equipment.chest,null);
    assert.equal(occurrences(d,it.id),1);
    assert.equal(cmd(d,'start'),null);
    loaded.stepSeconds(2.9);
    assert.equal(d.forgeItemCount(),1);
    loaded.stepSeconds(.1);
    assert.equal(d.forgeItemCount(),0);
    assert.equal(occurrences(d,it.id),success?1:0);
    if(success) {
      const out = d.G.inventory.find(x=>x.id===it.id);
      if(mode==='ancient') assert.equal(d.divineForgeAncientCount(out),1);
      else assert.ok(out.imprint);
    }
    const gold = d.G.player.gold;
    loaded.stepSeconds(3);
    assert.equal(d.G.player.gold,gold,'不能重複結算');
  });
}

test('鎖定／品質不符／精鑄滿額／滿槽／作業中／未解鎖／BOSS戰拒絕均不卸裝', () => {
  const cases = {
    locked: ({it}) => { it.locked=true; },
    rarity: ({it}) => { it.rarity=0; },
    limit: ({it}) => { it.ancientForgeCount=2; },
    full: ({c}) => { c.G.forge.slots[0]=c.makeEquipment(250,{rarity:6}); },
    crafting: ({c}) => { c.G.forge.crafting={startedAt:Date.now(),durationMs:3000}; },
    lockedMode: ({c}) => { c.G.player.reincarnations=0; },
    boss: ({c}) => { c.G.tower.active=true; }
  };
  for (const [name,mutate] of Object.entries(cases)) {
    const env=setup();mutate(env);
    const before=JSON.stringify(env.c.G);
    assert.ok(cmd(env.c,'placeItem',{itemId:env.it.id}),name);
    assert.equal(JSON.stringify(env.c.G),before,name+' 不應改狀態');
  }
});
test('裝備神鑄不消耗穿戴裝備，背包已滿仍可直接移入單件法陣', () => {
  const {c,it}=setup('equip');
  assert.ok(cmd(c,'placeItem',{itemId:it.id}));
  assert.equal(c.G.equipment.chest,it);
  cmd(c,'setOperation',{mode:'ancient'});
  while(c.G.inventory.length<c.inventoryCapacityNow()) c.G.inventory.push(c.makeEquipment(10,{rarity:0}));
  const n=c.G.inventory.length;
  assert.equal(cmd(c,'placeItem',{itemId:it.id}),null);
  assert.equal(c.G.inventory.length,n);
  assert.equal(c.G.equipment.chest,null);
});

test('身上清單只讀啟用套裝，與品質背包互斥且tooltip不誤用預覽套裝', () => {
  const source=fs.readFileSync(require.resolve('../js/ui.js'),'utf8');
  const names=['forgeShowsEquipped','forgeInventoryItems','findItemById'];
  const funcs=names.map(name=>{const a=source.indexOf('function '+name+'(');return source.slice(a,source.indexOf('\n}',a)+2);}).join('\n');
  const bag={id:'bag',rarity:6}, worn={id:'worn',rarity:7}, spare={id:'spare'};
  const inv={items:[bag],equipment:{chest:worn,ring:null},viewEquipment:{chest:spare}};
  const ctx={UI:{forgeEquipment:true},inventoryViewItems:s=>s.items,
    inventoryForgeMode:()=>true,forgeViewState:s=>s,uiForgePanelSnapshot:()=>({operation:'ancient'}),
    peekUiPanelData:()=>inv,inventoryViewItem:()=>null,equipViewEquipment:()=>({chest:spare})};
  vm.createContext(ctx);vm.runInContext(funcs,ctx);
  for(const mode of ['ancient','imprint']) assert.equal(ctx.forgeInventoryItems(inv,{operation:mode})[0],worn);
  for(const mode of ['equip','gem']) assert.equal(ctx.forgeInventoryItems(inv,{operation:mode})[0],bag);
  assert.equal(ctx.findItemById('worn',true),worn);
  ctx.UI.forgeEquipment=false;
  assert.equal(ctx.forgeInventoryItems(inv,{operation:'ancient'})[0],bag);
});
