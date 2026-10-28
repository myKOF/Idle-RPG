'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine}=require('../scripts/sim/engine.js'),{createPolicy}=require('../scripts/sim/policy.js');
const cfg=require('../scripts/sim/policy.extreme.roi.json'),rule=cfg.rules.find(r=>r.id==='forge-craft');
function setup(){
 const e=createEngine({seed:8}).boot(null),c=e.ctx;c.G.player.reincarnations=2;c.G.player.gold=1e12;c.G.player.dust=100;
 for(const lv of [1,50,100,150,200,300,250])c.G.inventory.push(c.makeEquipment(lv,{rarity:6,level:lv}));
 return e;
}
function decide(e){return createPolicy({name:'forge-v2',needPanels:['forge'],rules:[rule]}).decide({gameTimeSec:100,view:{gold:e.ctx.G.player.gold},panels:{forge:e.panel('forge',{craft:true})}});}
test('新版策略面板唯讀，投影費用／石頭上限來自正式配方',()=>{
 const e=setup(),before=e.saveJson(),p=e.panel('forge',{craft:true});
 assert.equal(e.saveJson(),before);assert.equal(p.equip[6].cost,2e7);assert.equal(p.equip[6].maxStones,13);
 assert.equal(p.equip[5],undefined);assert.equal(p.gem,undefined);
});
test('策略以最高等級載體及五件墊料，三秒後產出神鑄神話且中途不重送',()=>{
 const e=setup(),c=e.ctx,cmds=decide(e),placed=cmds.filter(x=>x.name==='forge.placeItem');
 assert.equal(placed.length,6);assert.equal(c.G.inventory.find(it=>it.id===placed[0].args.itemId).level,300);
 assert.ok(cmds.some(x=>x.name==='forge.setStones'&&x.args.count===13));
 cmds.forEach(cmd=>{const result=c.runCommand(cmd.name,cmd.args);assert.equal(result.ok,true);assert.ok(result.result===null||typeof result.result==='number');});
 assert.equal(c.G.inventory.some(it=>it.rarity===11),false);assert.deepEqual(decide(e),[]);
 e.stepSeconds(3);
 const made=c.G.inventory.find(it=>it.rarity===11);assert.ok(made);assert.equal(made.level,300);
});
test('低轉數／金幣不足／上鎖不足六件不產生消耗指令',()=>{
 for(const variant of ['reinc','gold','lock']){
  const e=setup();if(variant==='reinc')e.ctx.G.player.reincarnations=1;
  if(variant==='gold')e.ctx.G.player.gold=1;
  if(variant==='lock')e.ctx.G.inventory.slice(0,2).forEach(it=>it.locked=true);
  assert.deepEqual(decide(e),[]);
 }
});
