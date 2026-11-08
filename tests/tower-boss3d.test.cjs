'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cfg=require('../tools/config_tables.cjs');
const data=fs.readFileSync(require.resolve('../js/data.js'),'utf8');
const bosses=cfg.evalLiteral(cfg.extractLiteral(data,'BOSS_LIST').literal);
test('first tower boss becomes Skeleton King without changing stats or the ten-boss cycle',()=>{
  const stats={level:5,hp:1234,atk:45,def:23,mdef:15,aspd:.8,dodge:4,hit:95,xp:12};
  const context={BOSS_LIST:bosses,STR:(_id,floor,name)=>floor+' '+name,bossStatsFor:()=>stats,
    npcSightRange:()=>50,ELEMENTS:['fire']};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/tower.js'),'utf8'),context);
  const boss=context.makeBoss(1);
  assert.match(boss.name,/骷髏王/);
  assert.equal(boss.npcId,'tower_boss_1');
  assert.equal(boss.model3d.file,'images/models/npc3d/boss1.glb');
  assert.equal(boss.maxHp,stats.hp);assert.equal(boss.atk,stats.atk);assert.equal(boss.aspd,stats.aspd);
  assert.equal(context.makeBoss(2).model3d.file,'images/models/npc3d/boss2.glb');
  assert.match(context.makeBoss(2).name,/骷髏王Ⅱ/);
  assert.equal(context.makeBoss(2).maxHp,stats.hp);
  assert.equal(context.makeBoss(3).model3d,null);
  assert.equal(context.makeBoss(12).npcId,'tower_boss_2');
  assert.equal(context.makeBoss(11).npcId,boss.npcId);
});
