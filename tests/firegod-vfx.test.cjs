'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine}=require('../scripts/sim/engine');
function setup(){const c=createEngine({seed:42}).boot(null).ctx;c.G.player.level=1000;c.G.player.loadout=['sg:firehunt'];c.G.player.skills2.levels.firehunt=Array(7).fill(10);c.G.player.skills2.ult={firehunt:{pick:c.sgUltIndexOfId('firehunt','fireGodDescend'),lv:1}};c.initFieldPlayer();c.gmArenaSpawn(2,'elite',1e6);c.bfPlayerPos().x=0;c.bfPlayerPos().y=0;c.FIELD.monsters.forEach((m,i)=>{m.pos={x:100+i*100,y:0};m._enterCd=0;});const events=[];c.playCombatVfx=s=>events.push(s);return {c,events};}
test('火神星環發射只派送表定子彈，不繼承爆炸／地板或預播受擊',()=>{const {c,events}=setup();const u=c.sgUlt('firehunt','fireGodDescend');u.def.vfx.projectile='configured-ring';c.skills2OnBasicAttack(c.FIELD.player,c.FIELD.monsters[0],'mv-float',c.getStats());assert.ok(events.length>=3);for(const e of events){assert.deepEqual(Object.keys(e.vfx),['projectile']);assert.equal(e.vfx.projectile,'configured-ring');assert.equal(e.hit,false);assert.equal(e.lineLength,400);assert.equal(e.lineWidth,c.SG_FLYING_PROJECTILE_HALF_WIDTH*2);assert.equal(e.travelMs[0],3333);}assert.equal(c.SKILL2_RT.projectiles.length,events.length);for(const p of c.SKILL2_RT.projectiles)assert.equal(p.halfWidthPx,events[0].lineWidth/2);});
test('火神星環穿過敵人時才播放受擊，穿透兩敵不重播發射特效',()=>{const {c,events}=setup();c.sgHitOne=()=>({miss:false,dmg:10});c.skills2OnBasicAttack(c.FIELD.player,c.FIELD.monsters[0],'mv-float',c.getStats());c.SKILL2_RT.projectiles.splice(1);const orbit=c.SKILL2_RT.projectiles[0].flightOrbit;c.FIELD.monsters.forEach((m,i)=>{m.pos=c.projectileOrbitPoint(orbit,[.35,.9][i]);});events.length=0;const ctx={pEnt:c.FIELD.player,getEnemies:()=>c.FIELD.monsters};const start=c.sgProjectileNow();c.GT=start+.1;c.sgTickFlyingProjectiles(.1,ctx);assert.equal(events.length,0);for(let i=2;i<=18;i++){c.GT=start+i*.1;c.sgTickFlyingProjectiles(.1,ctx);}assert.equal(events.length,2);for(const e of events){assert.equal(e.fxKind,'impact');assert.deepEqual(Object.keys(e.vfx),['hit']);assert.equal(e.vfx.hit,'hit-fire');assert.equal(e.targets.length,1);}assert.notEqual(events[0].targets[0],events[1].targets[0]);});
test('高塔無座標仍於抵達時受擊；未命中不播，擊殺仍保留受擊',()=>{for(const miss of [true,false]){const {c,events}=setup();const target=c.FIELD.monsters[0];delete target.pos;c.sgHitOne=()=>{if(!miss)target.hp=0;return {miss,dmg:miss?0:10,killed:!miss}};c.skills2OnBasicAttack(c.FIELD.player,target,'mv-float',c.getStats());c.SKILL2_RT.projectiles.splice(1);events.length=0;const ctx={pEnt:c.FIELD.player,getEnemies:()=>[target]},start=c.sgProjectileNow();c.GT=start+.5;c.sgTickFlyingProjectiles(.5,ctx);assert.equal(events.length,0);c.GT=start+3.4;c.sgTickFlyingProjectiles(2.9,ctx);assert.equal(events.length,miss?0:1);if(!miss){assert.equal(events[0].targets.length,1);assert.equal(events[0].preserveDeadTargets,true);}}});


test('星環同時起飛，六枚等距成環、共同中心等速前進並順時針旋轉',()=>{
  const {c,events}=setup();c.G.player.skills2.ult.firehunt.lv=10;c.skills2OnBasicAttack(c.FIELD.player,c.FIELD.monsters[0],'mv-float',c.getStats());
  assert.equal(events.length,6);
  const orbits=events.map(e=>e.area.flightOrbit);
  for(const e of events)assert.equal(e.delayMs||0,0);
  for(const t of [0,.25,.5,1]){
    const points=orbits.map(o=>c.projectileOrbitPoint(o,t));
    const center={x:points.reduce((n,p)=>n+p.x,0)/6,y:points.reduce((n,p)=>n+p.y,0)/6};
    assert.ok(Math.abs(center.x-120*t)<1e-8);assert.ok(Math.abs(center.y)<1e-8);
    for(const p of points)assert.ok(Math.abs(Math.hypot(p.x-center.x,p.y-center.y)-80)<1e-8);
    for(let i=0;i<6;i++)assert.ok(Math.abs(Math.hypot(points[i].x-points[(i+1)%6].x,points[i].y-points[(i+1)%6 ].y)-80)<1e-8);
  }
  const first=c.projectileOrbitPoint(orbits[0],1/6);assert.ok(Math.abs(first.x-100)<1e-8);assert.ok(Math.abs(first.y)<1e-8);
  assert.deepEqual(JSON.parse(JSON.stringify(c.SKILL2_RT.projectiles[0].flightOrbit)),JSON.parse(JSON.stringify(orbits[0])));
});

test('旋轉掃掠能命中弧線上的敵人，不命中只有中心直線經過的敵人，低 tick 不漏弧',()=>{
  function run(dt){
    const {c,events}=setup();c.bfEntityRadius=()=>1;
    c.skills2OnBasicAttack(c.FIELD.player,c.FIELD.monsters[0],'mv-float',c.getStats());c.SKILL2_RT.projectiles.splice(1);
    const p=c.SKILL2_RT.projectiles[0],a=c.FIELD.monsters[0],b=c.FIELD.monsters[1];
    a.pos=c.projectileOrbitPoint(p.flightOrbit,.1);b.pos={x:12,y:0};
    const hit=[];c.sgHitOne=(...args)=>{hit.push(args);return {miss:false,dmg:10};};events.length=0;
    const start=c.sgProjectileNow(),ctx={pEnt:c.FIELD.player,getEnemies:()=>[a,b]};
    for(let t=dt;t<=.2+1e-8;t+=dt){c.GT=start+t;c.sgTickFlyingProjectiles(dt,ctx);}
    assert.equal(events.length,1);assert.equal(events[0].targets[0],c.enemyEventFloatTarget(a,'mv-float'));
  }
  run(.2);run(.01);
});
