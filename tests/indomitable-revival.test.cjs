'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createEngine}=require('../scripts/sim/engine'),table=require('./helpers/skill-table.cjs');
function setup(lv=10){
 const e=createEngine({seed:42}).boot(null),c=e.ctx;
 c.G.player.level=2000;c.G.player.skills2={levels:{counter:Array(7).fill(10)},ult:{counter:{pick:1,lv}}};c.G.player.loadout=['sg:counter'];
 c.G.stage.current=121;c.G.stage.zone='swamp';c.G.stage.autoAdvance=false;c.markStatsDirty();c.initFieldPlayer();c.gmArenaSpawn(4,'normal',1e9);
 const p=c.FIELD.player,enemies=c.FIELD.monsters,home=c.bfPlayerPos(),r=c.bfMeterPx(30),body=c.bfEntityRadius(enemies[0]);
 enemies.forEach((m,i)=>{m.pos={x:home.x+[50,r+body,r+body+.001,150][i],y:home.y};m.ctrlRes=0;});
 const events=[];c.playCombatVfx=spec=>events.push(spec);let deaths=0;c.recordLootDeath=()=>deaths++;
 return {e,c,p,enemies,events,deaths:()=>deaths};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('不屈鬥魂：野外免死保留戰場、施放、MP與排程，不登記死亡',()=>{
 const {c,p,enemies,deaths}=setup(),original=enemies.slice();p.hp=0;p.mp=7;p._skillCastRemaining=.75;p._skillCastId='sg:knife';
 c.SKILL2_RT.projectiles.push({marker:'existing'});c.onPlayerFieldDeath();
 assert.equal(p.hp,1);assert.equal(p.mp,7);assert.equal(p._skillCastRemaining,.75);assert.equal(p._skillCastId,'sg:knife');
 assert.equal(p._sgRevival,undefined);assert.equal(c.skill2DownedActive(),false);assert.equal(c.skills2AutoCastBlocked(p),false);
 assert.equal(c.FIELD.reviveCd,0);assert.equal(c.G.stage.current,121);assert.deepEqual(c.FIELD.monsters,original);
 assert.equal(c.SKILL2_RT.projectiles[0].marker,'existing');assert.equal(deaths(),0);
 c.onPlayerFieldDeath();assert.equal(deaths(),0,'重複通知不把已免死角色退關');
 c.healPlayer(p,20,c.getStats());assert.equal(p.hp,21,'普通治療立即生效');
});
test('不屈鬥魂：30米體型邊緣內擊暈3秒，範圍外與死亡敵人不受影響、不造成傷害',()=>{
 const {c,p,enemies}=setup(),health=enemies.map(m=>m.hp);enemies[3].hp=0;p.hp=0;c.onPlayerFieldDeath();
 for(const i of [0,1]){near(enemies[i].effects.stun,c.GT+3);assert.ok(enemies[i]._bfKnockback);}
 for(const i of [2,3]){assert.equal(enemies[i].effects.stun,undefined);assert.equal(enemies[i]._bfKnockback,undefined);}
 assert.deepEqual(enemies.slice(0,3).map(m=>m.hp),health.slice(0,3));
});
test('不屈鬥魂：暈眩中仍能在0.25秒內連續擊退5米',()=>{
 const {c,p,enemies}=setup(),m=enemies[0],x=m.pos.x;p.hp=0;c.onPlayerFieldDeath();near(m.pos.x,x);
 c.GT=.125;c.bfTickApproach([m],.125);near(m.pos.x,x+c.bfMeterPx(2.5));assert.ok(c.effectActive(m,'stun'));
 c.GT=.25;c.bfTickApproach([m],.125);near(m.pos.x,x+c.bfMeterPx(5));assert.equal(m._bfKnockback,undefined);
 c.GT=.5;c.bfTickApproach([m],.25);assert.equal(m._bfKnockback,undefined);assert.ok(c.effectActive(m,'stun'));
});
test('不屈鬥魂：各級無敵與冷卻，到期可受傷、冷卻結束可重觸發',()=>{
 for(const [lv,sec,cd] of [[1,2.75,58],[5,3.75,50],[10,5,40]]){
  const {c,p}=setup(lv);p.hp=0;c.onPlayerFieldDeath();near(p.effects.invuln,sec);near(p.skillCds['sg:counter'],cd);
  const hit=()=>c.resolveHit({hp:1e12},p,{atk:1e9,hit:100000,critRate:0,critDmg:150},Object.assign(c.playerDefCfg(p),{def:0,mdef:0,dodge:0,blockRate:0,globalDmgRed:0}));
  assert.equal(hit().invuln,true);assert.equal(p.hp,1);c.GT=sec-.001;assert.ok(c.effectActive(p,'invuln'));
  c.GT=sec;assert.equal(c.effectActive(p,'invuln'),false);assert.equal(hit().killed,true);assert.equal(p.hp,0);
  assert.equal(c.skills2TryLastStand(p),false);c.tickSkillCds(p,cd);assert.equal(p.skillCds['sg:counter'],0);
  assert.equal(c.skills2TryLastStand(p),true);assert.equal(p.hp,1);
 }
});
test('不屈鬥魂：原戰鬥與普攻繼續，沒有升空或漸進補滿生命',()=>{
 const {e,c,p,enemies,deaths}=setup();p.hp=0;c.onPlayerFieldDeath();const m=enemies[0];delete m._bfKnockback;
 const home=c.bfPlayerPos();m.pos={x:home.x+c.bfBodyStopDistance(m),y:home.y};let attacks=0;const original=c.doPlayerAttack;
 c.doPlayerAttack=function(){attacks++;return original.apply(this,arguments);};p.atkCd=0;e.stepSeconds(.5);
 assert.ok(attacks>0);assert.ok(p.hp>0&&p.hp<c.getStats().hp);assert.equal(p._sgRevival,undefined);
 assert.equal(c.G.stage.current,121);assert.equal(c.FIELD.reviveCd,0);assert.equal(deaths(),0);
});
test('不屈鬥魂：真實敵人攻擊與持續傷害各自走免死出口',()=>{
 for(const source of ['attack','dot']){
  const {e,c,p,enemies,deaths}=setup();p.hp=1;p.shield=0;
  if(source==='attack'){
   const m=enemies[0],home=c.bfPlayerPos();m.pos={x:home.x+c.bfBodyStopDistance(m),y:home.y};m.atk=1e12;m.hit=1e9;m.critRate=0;
   c.fieldMonsterAttack(m,p);
  }else{c.applyStatus(p,'bleed',{dps:1e12,dur:3,interval:.1});e.stepSeconds(.2);}
  assert.ok(p.hp>0);assert.ok(c.effectActive(p,'invuln'));assert.ok(p.skillCds['sg:counter']>0);
  assert.equal(p._sgRevival,undefined);assert.equal(c.FIELD.reviveCd,0);assert.equal(deaths(),0);
 }
});
test('不屈鬥魂：高塔保留BOSS並繼續計時、不記死亡，免控BOSS不被擊退暈眩',()=>{
 const {c,deaths}=setup();c.G.player.gold=1e15;c.startTowerFight(1);assert.equal(c.G.tower.active,true);
 const p=c.TOWER.player,b=c.TOWER.boss,pos={...b.pos};c.TOWER.introCd=0;p.hp=0;c.endTowerFight(false,'death');
 assert.equal(p.hp,1);assert.ok(c.effectActive(p,'invuln'));assert.equal(p._sgRevival,undefined);
 assert.equal(c.G.tower.active,true);assert.equal(c.TOWER.showingResult,false);assert.equal(c.TOWER.result,null);
 assert.equal(c.TOWER.boss,b);assert.equal(b.effects.stun,undefined);assert.equal(b._bfKnockback,undefined);assert.deepEqual({...b.pos},pos);assert.equal(deaths(),0);
 const elapsed=c.TOWER.elapsed;c.GT+=.1;c.towerTick(.1);near(c.TOWER.elapsed,elapsed+.1);assert.equal(c.G.tower.active,true);
});
test('不屈鬥魂：免死先於天地共生，冷卻中致命傷再由復活技能接手',()=>{
 const {c,p}=setup();c.G.player.skills2.levels.earthguard=Array(7).fill(10);c.G.player.loadout.push('sg:earthguard');
 p.hp=0;c.onPlayerFieldDeath();assert.equal(p.hp,1);assert.equal(p._sgRevival,undefined);assert.equal(p.skillCds['sg:earthguard']||0,0);
 c.GT=6;p.hp=0;c.onPlayerFieldDeath();assert.equal(p._sgRevival.mode,'earthguard');
});
test('不屈鬥魂：卸裝、切換、降級或冷卻中均不能免死，真死亡正常退關及登記',()=>{
 for(const mode of ['unequip','switch','downgrade','cooldown']){
  const {c,p,deaths}=setup();if(mode==='unequip')c.G.player.loadout=[];if(mode==='switch')c.G.player.skills2.ult.counter.pick=0;
  if(mode==='downgrade')c.G.player.skills2.levels.counter[6]=9;if(mode==='cooldown')p.skillCds['sg:counter']=1;
  p.hp=0;assert.equal(c.skills2TryLastStand(p),false);c.onPlayerFieldDeath();assert.ok(c.FIELD.reviveCd>0);assert.equal(c.G.stage.current,111);assert.equal(deaths(),1);
 }
});
test('不屈鬥魂：VFX與計算同源，不播舊光束，配置／技能文字與畫面補間接線同步',()=>{
 const {c,p,events}=setup(1);p.hp=0;c.onPlayerFieldDeath();
 const wave=events.find(x=>x.variant==='indomitable-repel'),shield=events.find(x=>x.variant==='indomitable-guard');assert.ok(wave&&shield);
 near(wave.area.r,c.bfMeterPx(30));near(wave.dur,.25);assert.equal(wave.vfx.attack,'burst-earth');assert.equal(wave.hit,false);
 near(shield.dur,2.75);assert.equal(shield.vfx.ground,'st-shield');assert.equal(events.some(x=>Object.values(x.vfx||{}).includes('pillar-indomitable')),false);
 const row=table.row('counter','indomitable');assert.equal(row['傷害範圍（米）'],'');assert.equal(row['狀態／控制範圍（米）'],'30');assert.equal(row['敵方狀態'],'stun');
 for(const [lv,sec,cd] of [[1,2.75,58],[10,5,40]]){const desc=c.describeSkill2Ult('counter',1,lv).replace(/<[^>]+>/g,'');assert.ok(desc.includes(`${sec}秒的無敵護盾`));assert.ok(desc.includes(`${cd}秒冷卻時間`));assert.match(desc,/30米|3秒/);assert.doesNotMatch(desc,/升空|回滿|地屬性|總傷害/);}
 assert.match(fs.readFileSync('js/battle-renderer.js','utf8'),/if \(d\.pos && isFinite\(d\.pos\.x\)\) posTrack\(ent, d\.pos\.x, d\.pos\.y\)/);
});
