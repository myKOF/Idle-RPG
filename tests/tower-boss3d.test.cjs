'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cfg=require('../tools/config_tables.cjs');
const data=fs.readFileSync(require.resolve('../js/data.js'),'utf8');
const bosses=cfg.evalLiteral(cfg.extractLiteral(data,'BOSS_LIST').literal);
test('first tower boss becomes Skeleton King without changing stats; floor 11 uses its own row with the same look',()=>{
  const stats={level:5,hp:1234,atk:45,def:23,mdef:15,aspd:.8,dodge:4,hit:95,xp:12};
  const context={BOSS_LIST:bosses,STR:(_id,floor,name)=>floor+' '+name,bossStatsFor:()=>stats,
    towerBossDefFor:f=>bosses[(f-1)%bosses.length],
    npcCombatProfile:(bd)=>({aspd:bd.atkSpeed,runSpeed:0,atkRange:0,sightRange:50}),ELEMENTS:['fire']};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/tower.js'),'utf8'),context);
  const boss=context.makeBoss(1);
  assert.match(boss.name,/骷髏王/);
  assert.equal(boss.npcId,'tower_boss_1');
  assert.equal(boss.model3d.file,'images/models/npc3d/boss1.glb');
  assert.equal(boss.maxHp,stats.hp);assert.equal(boss.atk,stats.atk);assert.equal(boss.aspd,bosses[0].atkSpeed);
  assert.equal(context.makeBoss(2).model3d.file,'images/models/npc3d/boss2.glb');
  assert.equal(context.makeBoss(2).maxHp,stats.hp);
  assert.equal(context.makeBoss(2).aspd,bosses[1].atkSpeed);
  assert.equal(context.makeBoss(3).model3d,null);
  assert.equal(context.makeBoss(12).npcId,'tower_boss_12');
  assert.equal(context.makeBoss(12).model3d.file,'images/models/npc3d/boss2.glb');
  assert.equal(context.makeBoss(2).name,'2 '+"骷髏王Ⅱ");
  const f11=context.makeBoss(11);
  assert.equal(f11.npcId,'tower_boss_11');
  assert.match(f11.name,/骷髏王/);
  assert.equal(f11.model3d.file,boss.model3d.file);
  assert.equal(context.makeBoss(51).npcId,'tower_boss_1','51 層起從第 1 關那列重新輪');
});
