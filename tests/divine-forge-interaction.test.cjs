'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createEngine} = require('../scripts/sim/engine.js');
function setup(n=12, rarity=6) {
  const e=createEngine({seed:1029}).boot(null), c=e.ctx;
  c.G.player.reincarnations=5;c.G.player.gold=1e12;c.G.player.dust=1000;
  c.setCombatPaused(true);
  c.forgeUnlocked();
  for(let i=0;i<n;i++) c.G.inventory.push(c.makeEquipment(100,{rarity,level:100}));
  return {e,c};
}
function cmd(c,name,args={}) { const r=c.runCommand('forge.'+name,args); assert.equal(r.ok,true); return r.result; }
test('自動放入只取所選品質未鎖定裝備，不足不搬動任何素材',()=>{
  const {c}=setup(5);const locked=c.makeEquipment(100,{rarity:6});locked.locked=true;c.G.inventory.push(locked);
  c.G.inventory.push(c.makeEquipment(100,{rarity:7}));
  const before=JSON.stringify(c.G);assert.ok(cmd(c,'autoFill'));assert.equal(JSON.stringify(c.G),before);
  c.G.inventory.push(c.makeEquipment(100,{rarity:6}));assert.equal(cmd(c,'autoFill'),null);
  assert.equal(c.forgeItemCount(),6);assert.ok(c.G.inventory.includes(locked));
  assert.ok(c.G.forge.slots.every(it=>it.rarity===6&&!it.locked));
  cmd(c,'unloadAll');assert.equal(c.forgeItemCount(),0);assert.equal(c.G.inventory.length,8);
});
test('品質切換完整退回原料且預設神話，石頭可在空法陣預選並限制至100%',()=>{
  const {c}=setup(6);assert.equal(c.G.forge.quality,6);
  cmd(c,'setStones',{count:999});assert.equal(c.G.forge.stones,13);assert.equal(c.G.forge.stonePreference,13);
  cmd(c,'autoFill');cmd(c,'setQuality',{rarity:7});
  assert.equal(c.forgeItemCount(),0);assert.equal(c.G.inventory.length,6);assert.equal(c.G.forge.quality,7);
  assert.equal(c.runCommand('forge.setQuality',{rarity:8}).ok,false);
  c.G.player.dust=2;cmd(c,'setStones',{count:99});assert.equal(c.G.forge.stones,2);
  cmd(c,'setStones',{count:0});assert.equal(c.G.forge.stonePreference,0);
});
test('3秒內不扣款不擲骰；重入／換模式／卸料／增減石頭均拒絕，終點只結算一次',()=>{
  const {e,c}=setup(6);cmd(c,'autoFill');cmd(c,'setStones',{count:13});
  const gold=c.G.player.gold,dust=c.G.player.dust;let rolls=0;c.chance=()=>{rolls++;return true;};
  cmd(c,'start');assert.equal(e.panel('forge').craftProgress.durationMs,3000);
  for(const [name,args] of [['start',{}],['autoFill',{}],['unloadAll',{}],['setStones',{count:1}],['setQuality',{rarity:7}],['setOperation',{mode:'gem'}],['removeItem',{slotIndex:0}]]) assert.ok(cmd(c,name,args));
  e.stepSeconds(2.9);assert.equal(rolls,0);assert.equal(c.G.player.gold,gold);assert.equal(c.G.player.dust,dust);
  e.stepSeconds(.1);assert.equal(rolls,1);assert.equal(c.G.inventory[0].rarity,11);
  assert.equal(c.G.player.gold,gold-2e7);assert.equal(c.G.player.dust,dust-13);
  e.stepSeconds(3);assert.equal(rolls,1);
});
test('連續自動沿用石頭數，六件一輪直到不足，結果與停機原因留在十行記錄',()=>{
  const {e,c}=setup(12);cmd(c,'setStones',{count:13});const gold=c.G.player.gold;
  cmd(c,'setAuto',{on:true});assert.equal(c.G.forge.auto,true);assert.equal(c.forgeItemCount(),6);
  e.stepSeconds(3);assert.equal(c.G.forge.stones,13);assert.ok(c.G.forge.crafting);
  e.stepSeconds(3);assert.equal(c.G.forge.auto,false);assert.equal(c.G.forge.crafting,undefined);
  assert.equal(c.G.inventory.filter(it=>it.rarity===11).length,2);assert.equal(c.G.player.dust,974);
  assert.equal(c.G.player.gold,gold-4e7);assert.match(c.G.forge.log[0].msg,/不足/);
  for(let i=0;i<15;i++)c.forgeLog(String(i));assert.equal(c.G.forge.log.length,10);
});
test('取消連續自動讓目前作業完成一次，下一輪不補料',()=>{
  const {e,c}=setup(12);cmd(c,'setStones',{count:13});cmd(c,'setAuto',{on:true});
  e.stepSeconds(1);cmd(c,'setAuto',{on:false});e.stepSeconds(2);
  assert.equal(c.G.forge.crafting,undefined);assert.equal(c.G.inventory.filter(it=>it.rarity===6).length,6);
  assert.equal(c.G.inventory.filter(it=>it.rarity===11).length,1);
});
test('自動失敗退料仍可補足下一輪，不足時保留剩餘裝備並停止',()=>{
  const {e,c}=setup(9);c.chance=()=>false;c.ri=(a)=>a;
  cmd(c,'setAuto',{on:true});e.stepSeconds(3);
  assert.ok(c.G.forge.crafting);assert.equal(c.forgeItemCount(),6);
  e.stepSeconds(3);assert.equal(c.G.forge.auto,false);assert.equal(c.G.inventory.length,3);
  assert.equal(c.forgeItemCount(),0);
});
test('缺錢或沿用石頭不足便停止，不靜默降石頭數或消耗下一輪',()=>{
  for(const kind of ['gold','dust']) {
    const {e,c}=setup(12);cmd(c,'setStones',{count:13});
    if(kind==='gold')c.G.player.gold=2e7;else c.G.player.dust=13;
    cmd(c,'setAuto',{on:true});e.stepSeconds(3);
    assert.equal(c.G.forge.auto,false);assert.equal(c.G.forge.crafting,undefined);
    assert.equal(c.G.inventory.filter(it=>it.rarity===11).length,1);
    assert.equal(c.forgeItemCount(),6);
    assert.match(c.G.forge.log[0].msg,/已停止/);
  }
});
test('三秒內資源被其他功能花掉，結算拒絕且完整保留入槽裝備',()=>{
  const {e,c}=setup(6);cmd(c,'autoFill');cmd(c,'start');c.G.player.gold=0;e.stepSeconds(3);
  assert.equal(c.forgeItemCount(),6);assert.equal(c.G.player.gold,0);assert.equal(c.G.inventory.length,0);
  assert.match(c.G.forge.log[0].msg,/金幣/);
});
test('讀檔保留作業與偏好，過期作業僅結算一次並從當下啟動下一輪',()=>{
  const {e,c}=setup(18);cmd(c,'setStones',{count:13});cmd(c,'setAuto',{on:true});e.stepSeconds(1);
  const saved=JSON.parse(e.saveJson());const loaded=createEngine({seed:1029}).boot(saved),d=loaded.ctx;
  assert.equal(d.G.forge.stonePreference,13);assert.ok(d.G.forge.crafting);
  const overdue=saved.forge.crafting.startedAt+3600000;d.Date.now=()=>overdue;
  d.forgeTick(d.Date.now());assert.equal(d.G.inventory.filter(it=>it.rarity===11).length,1);
  assert.equal(d.G.forge.crafting.startedAt,d.Date.now());assert.equal(d.forgeItemCount(),6);
});
test('正式Worker菜單暫停保留鑄造剩餘時間及投影，恢復後結算',()=>{
  const {e,c}=setup(6);let now=c.Date.now();c.Date.now=()=>now;
  cmd(c,'autoFill');cmd(c,'setStones',{count:13});cmd(c,'start');
  now+=1000;c.setMenuPaused(true);now+=120000;
  assert.equal(e.panel('forge').craftProgress.elapsedMs,1000);
  assert.equal(e.panel('forge').craftProgress.paused,true);
  c.setMenuPaused(false);c.forgeTick(now+1999);assert.equal(c.G.inventory.length,0);
  c.forgeTick(now+2000);assert.equal(c.G.inventory[0].rarity,11);
});
