'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadEliteEnv,makeElite}=require('./helpers/elite-env.cjs');
function fresh(floor=1){
 const c=loadEliteEnv();c.Math.random=()=>.5;
 const stats={...c.getStats(),hp:1e20,mp:1e10};c.getStats=()=>stats;
 c.G.player.gold=1e30;c.G.tower.highest=150;c.startTowerFight(floor);
 c.TOWER.player.hp=c.TOWER.player.maxHp=1e20;c.TOWER.boss.hp=c.TOWER.boss.maxHp=1e20;
 c.doPlayerAttack=()=>({dmg:0,killed:false});c.doMonsterAttack=()=>({dmg:0});
 c.pickAndCastSkill=()=>null;c.tickSkillSchedulers=()=>{};
 const events=[];c.emitEnemyAct=(act,b,seconds)=>events.push({act,seconds,t:c.GT,x:b.pos.x,y:b.pos.y});
 return {c,b:c.TOWER.boss,events,step(){c.GT+=.05;c.towerTick(.05);}};
}
test('all 50 tower bosses approach or stand to act at opening, without a retreat target',()=>{
 for(let floor=1;floor<=50;floor++){
  const s=fresh(floor),{c,b}=s,initial=b.pos.x;
  for(let n=0;n<140&&!b._towerHasActed;n++){
   s.step();
   if(!b._towerHasActed){assert.equal(b._rp,undefined,'floor '+floor+' may not reposition before acting');assert.ok(b.pos.x<=initial+1e-6);}
  }
  assert.ok(s.events.length>0,'floor '+floor+' must act');
 }
});
test('basic attacks hold the full animation, pause an existing route, then resume the same fixed target',()=>{
 const s=fresh(),{c,b}=s;c.TOWER.introCd=0;
 Object.keys(b._el.cd).forEach(k=>b._el.cd[k]=1e9);b._el.repoAt=Infinity;
 b.pos.x=c.TOWER.playerPos.x+40;b.pos.y=c.TOWER.playerPos.y;b.atkCd=0;c.TOWER.specialCd=1e9;
 s.step();assert.equal(s.events[0].act,'attack');
 const end=b._towerActionUntil,point={...b.pos};b.atkCd=1e9;
 b._rp={x:b.pos.x+300,y:b.pos.y+100,ang:0,dist:300,t0:c.GT};
 while(c.GT+.05<end-1e-8){s.step();assert.deepEqual({...b.pos},point);assert.equal(s.events.length,1);}
 for(let i=0;i<4;i++)s.step();
 assert.ok(Math.hypot(b.pos.x-point.x,b.pos.y-point.y)>0,'movement resumes after the action');
});
test('tower spells lock ordinary movement even when the archetype permits wild movement; min-range spells never trigger opening retreat',()=>{
 const {c,b}=fresh(2);b.pos.x=c.TOWER.playerPos.x+20;b.pos.y=c.TOWER.playerPos.y;
 assert.equal(c.eliteKeepAway(b,{minRange:300},'test'),true);assert.equal(b._rp,undefined);
 c.eliteBusy(b,3,false);c.towerBossHoldAction(b,'cast',3);
 const point={...b.pos};c.bfTickApproach([b],.1);assert.deepEqual({...b.pos},point);
 c.GT+=2.9;assert.equal(c.eliteLocked(b),true);c.GT+=.2;assert.equal(c.eliteLocked(b),false);
 const wild=makeElite(c,['e_vitality']);c.eliteBusy(wild,3,false);assert.equal(c.eliteLocked(wild),false);
});
test('tower reposition has a fixed endpoint while the player moves',()=>{
 const {c,b}=fresh();assert.equal(c.eliteRepoPick(b),false);
 b._towerHasActed=true;assert.equal(c.eliteRepoPick(b),true);
 const target={x:b._rp.x,y:b._rp.y};c.TOWER.playerPos.x+=500;c.bfTickApproach([b],.05);
 assert.deepEqual({x:b._rp.x,y:b._rp.y},target);
});
test('a full live tower skill loadout cannot starve an existing movement route',()=>{
 const s=fresh(2),{c,b}=s;let moved=0,locked=0;
 for(let n=0;n<600;n++){
  const point={...b.pos},wasLocked=c.towerBossActionLocked(b);s.step();
  const distance=Math.hypot(b.pos.x-point.x,b.pos.y-point.y);
  if(wasLocked&&c.towerBossActionLocked(b)){assert.equal(distance,0);locked++;}
  if(distance>0){moved++;assert.equal(c.towerBossActionLocked(b),false);}
 }
 assert.ok(locked>20);assert.ok(moved>0,'must resume moving despite ready spells');
});
