'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadEliteEnv,makeElite}=require('./helpers/elite-env.cjs');
function fixture(){
 const c=loadEliteEnv({stage:1}),m=makeElite(c,[],{x:1000,hp:1000000});
 m.sightRange=500;m.atkRange=60;m.runSpeed=120;m._encounterKey='test:far';c.bfInitRoam(m);
 return {c,m};
}
function hit(c,m,extra){
 return c.resolveHit(c.FIELD.player,m,{atk:100,hit:100,dmgType:'phys',isPlayer:true,level:1},Object.assign(c.monsterDefCfg(m),{dodge:0,absDodge:0},extra));
}
test('視野外普攻命中立即警戒、停止遊走，接近後按原管線反擊',()=>{
 const {c,m}=fixture();assert.equal(c.bfEnemyAlerted(m),false);
 const result=hit(c,m);assert.ok(result.dmg>0);assert.equal(m._alerted,true);assert.equal(m._roam,null);assert.equal(m._frenzyStartAt,c.GT);
 let attacks=0;c.doMonsterAttack=()=>{attacks++;return {};};
 c.fieldMonsterAttack(m,c.FIELD.player);assert.equal(attacks,0);
 c.bfTickApproach([m],1);assert.equal(m.pos.x,880);
 c.BF_PLAYER.x=-1000;c.GT+=1;hit(c,m);assert.equal(m._frenzyStartAt,100);
 c.bfTickApproach([m],1);assert.equal(m.pos.x,760);
 c.BF_PLAYER.x=m.pos.x-30;c.fieldMonsterAttack(m,c.FIELD.player);assert.equal(attacks,1);
});
test('護盾完全吸收傷害也觸發警戒；未命中、無敵與零直接傷害不觸發',()=>{
 const {c,m}=fixture();m.shield=100000;
 const r=hit(c,m);assert.equal(r.hpDamage,0);assert.ok(r.absorbed>0);assert.equal(m._alerted,true);
 for(const kind of ['miss','invuln','zero']){
  const {c,m}=fixture();
  if(kind==='miss'){c.chance=()=>false;assert.equal(hit(c,m).miss,true);}
  if(kind==='invuln')assert.equal(hit(c,m,{invuln:true}).invuln,true);
  if(kind==='zero')c.applyEnemyHpDamage(m,0);
  assert.equal(m._alerted,false,kind);assert.ok(m._roam);
 }
});
test('Skills2範圍命中與衍生傷害皆觸發，未受傷的其他怪物不被連帶喚醒',()=>{
 for(const derived of [false,true]){
  const {c,m}=fixture(),other=makeElite(c,[],{x:1300,hp:1000000});other.sightRange=500;
  const out={dmg:0,crit:false,killed:false};
  if(derived)c.sgDerivedHit(m,10,'icearrow','mv-float',out);
  else c.sgHitOne(c.FIELD.player,c.getStats(),m,100,'icearrow','mv-float',out,0,0,null,true);
  assert.ok(out.dmg>0);assert.equal(m._alerted,true);assert.equal(other._alerted,false);
 }
});
test('持續傷害跳段觸發警戒，玩家自身持續傷害不設定敵方狀態',()=>{
 const {c,m}=fixture();m.dots=[{dps:10,until:c.GT+5,interval:0,sid:'poison',name:'中毒'}];
 c.tickStatuses(m,.1);assert.equal(m._alerted,true);assert.equal(m._roam,null);
 const player=c.FIELD.player;c.applyEnemyHpDamage(player,1);assert.equal(player._alerted,undefined);
});
test('受擊警戒保留進場與控場限制，菁英主動技能恢復原本索敵規則',()=>{
 const {c,m}=fixture();m._enterCd=1;c.applyEnemyHpDamage(m,1);
 assert.equal(m._alerted,true);assert.equal(c.bfInAttackRange(m),false);
 c.bfTickApproach([m],1);assert.equal(m.pos.x,1000);
 m._enterCd=0;m._elLockUntil=c.GT+5;c.bfTickApproach([m],1);assert.equal(m.pos.x,1000);
 m._elLockUntil=0;m.pos.x=30;c.applyEffect(m,'stun',5);
 let attacks=0;c.doMonsterAttack=()=>{attacks++;return {};};c.fieldMonsterAttack(m,c.FIELD.player);assert.equal(attacks,0);
 const d=loadEliteEnv(),id=Object.keys(d.ELITE_AFFIXES).find(id=>d.ELITE_AFFIXES[id].kind==='active'&&!d.ELITE_AFFIXES[id].repo);
 const elite=makeElite(d,[id],{x:1000,hp:1000000});elite.sightRange=500;
 assert.equal(d.eliteReady(elite),false);d.applyEnemyHpDamage(elite,1);assert.equal(d.eliteReady(elite),true);
});
test('正式Worker受擊後權威追擊位置同步至battle面板，塔BOSS沿用受傷警戒',()=>{
 const engine=require('../scripts/sim/engine').createEngine({seed:161017}).boot(null),c=engine.ctx;
 const m=c.makeFieldEnemy(c.NPC_CONFIG_TABLE.desert_2,c.monsterStatsFor(1,false,false),c.currentZoneDef(),1,{enterCd:0});
 m.pos={x:1000,y:0};m.hp=m.maxHp=1000000;c.bfInitRoam(m);c.FIELD.monsters=[m];c.FIELD.monster=m;c.bfResetPlayer();
 c.applyEnemyHpDamage(m,1);c.bfTickApproach([m],.2);
 const panel=c.buildPanel('battle');assert.ok(m.pos.x<1000);assert.equal(panel.field.monsters[0].pos.x,m.pos.x);assert.equal(m._roam,null);
 const b=c.makeBoss(1);b.pos={x:1000,y:0};b.sightRange=500;
 assert.equal(c.bfEnemyAlerted(b),false);c.applyEnemyHpDamage(b,1);assert.equal(c.bfEnemyAlerted(b),true);
 assert.equal(engine.outbox().filter(m=>m.type===c.MSG_OUT.ERROR).length,0);
});
