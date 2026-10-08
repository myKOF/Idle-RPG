'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createEngine}=require('../scripts/sim/engine');
const Core=require('../js/vfx-core'),Runtime=require('../js/vfx-runtime');
function scene(count=4,meteor=false){
 const c=createEngine({seed:42}).boot(null).ctx;
 c.G.player.level=1000;c.G.player.loadout=['sg:fireball'];c.G.player.skills2.levels.fireball=meteor?Array(7).fill(1):[1,1,1,0,0,0,0];
 c.initFieldPlayer();c.gmArenaSpawn(count,'elite',1000000);
 const p=c.FIELD.player;p.mp=1e9;p.pos={x:0,y:0};
 const positions=[[100,0],[240,50],[200,-120],[280,0]];
 const enemies=c.FIELD.monsters;
 enemies.forEach((m,i)=>{m.pos={x:positions[i][0],y:positions[i][1]};m._enterCd=0;m.hp=m.maxHp=1e9;});
 const events=[],send=c.playCombatVfx;c.playCombatVfx=s=>{events.push(JSON.parse(JSON.stringify(s)));send(s);};
 const ctx={pEnt:p,getEnemies:()=>enemies};
 return {c,p,enemies,events,ctx};
}
function explode(s){
 s.c.castSkill2(s.p,s.enemies,'fireball','mv-float');
 const main=s.c.SKILL2_RT.projectiles.find(q=>!q.fireballSplitLanding);
 assert.ok(main);s.c.GT=main.endAt+.001;s.c.sgTickFlyingProjectiles(0,s.ctx);
 return s.c.SKILL2_RT.projectiles.filter(q=>q.fireballSplitLanding);
}
test('FIREBALL-SPLIT 一名敵人分配一顆固定座標，兩顆隨機落點仍完整發射',()=>{
 const s=scene(1),shots=explode(s),events=s.events.filter(e=>e.area?.fixedLanding);
 assert.equal(shots.length,3);assert.equal(events.length,3);
 assert.equal(shots.filter(q=>q.fallbackTargets.length).length,1);
 assert.deepEqual({...shots[0].fireballSplitLanding},{x:100,y:0});
 for(let i=0;i<3;i++){
  const q=shots[i],e=events[i],distance=Math.hypot(q.fireballSplitLanding.x-100,q.fireballSplitLanding.y);
  assert.deepEqual({...q.origin},{x:100,y:0});assert.ok(distance<=s.c.bfMeterPx(20));
  assert.equal(e.sizeMult,.5);assert.ok(Math.abs(e.arcM*s.c.bfMeterPx(1)-Math.max(1,distance)/3)<1e-8);
  assert.deepEqual(Object.keys(e.vfx),['projectile']);assert.equal(e.vfx.projectile,s.c.SKILLS2.fireball.tiers[0].vfx.projectile);
  assert.equal(e.hit,false);assert.equal(e.travelMs[0],Math.round((q.endAt-q.startAt)*1000));
  assert.equal(e.area.sourceX,100);assert.equal(e.area.homingFlight,undefined);
 }
});
test('FIREBALL-SPLIT 目標在爆炸當下選取、不重複，空場仍有三個隨機落點',()=>{
 const s=scene();s.c.castSkill2(s.p,s.enemies,'fireball','mv-float');
 const main=s.c.SKILL2_RT.projectiles[0];
 s.enemies[1].hp=0;s.enemies[2].pos={x:900,y:0};s.enemies[3].pos={x:180,y:80};
 s.c.GT=main.endAt+.001;s.c.sgTickFlyingProjectiles(0,s.ctx);
 const shots=s.c.SKILL2_RT.projectiles.filter(q=>q.fireballSplitLanding),targets=shots.flatMap(q=>Array.from(q.fallbackTargets));
 assert.equal(shots.length,3);assert.equal(targets.length,2);assert.equal(new Set(targets).size,2);
 assert.ok(targets.includes(s.enemies[0]));assert.ok(targets.includes(s.enemies[3]));
 s.enemies.forEach(m=>m.hp=0);
 const empty=s.c.sgFireballSplitLandings(s.enemies[0],s.enemies,3,200);
 assert.equal(empty.length,3);assert.ok(empty.every(q=>q.target===null));
 assert.ok(empty.every(q=>Math.hypot(q.point.x-100,q.point.y)<=200));
});
test('FIREBALL-SPLIT 正式Worker白名單保留空目標固定落點、弧高與縮小倍率',()=>{
 const s=scene(1);explode(s);
 const events=s.c.shimDrainUrgentVisualEvents().filter(e=>e.area?.fixedLanding);
 assert.equal(events.length,3);assert.equal(events.filter(e=>e.targets.length===0).length,2);
 for(const e of events){assert.equal(e.sizeMult,.5);assert.ok(e.arcM>0);assert.equal(e.area.sourceX,100);assert.equal(e.hit,false);assert.ok(e.vfx.projectile);}
});
test('FIREBALL-SPLIT 本體飛行期間新出生的敵人也依爆炸當下名單分配',()=>{
 const s=scene(1);s.c.castSkill2(s.p,s.enemies,'fireball','mv-float');
 const main=s.c.SKILL2_RT.projectiles[0],late={...s.enemies[0],pos:{x:230,y:40}};s.enemies.push(late);
 s.c.GT=main.endAt+.001;s.c.sgTickFlyingProjectiles(0,s.ctx);
 const targets=s.c.SKILL2_RT.projectiles.flatMap(q=>Array.from(q.fallbackTargets));
 assert.equal(targets.length,2);assert.ok(targets.includes(late));
});
test('FIREBALL-SPLIT 固定落點抵達才傷害，移走可避開，無命中也只播一次落地爆點',()=>{
 const s=scene(1),shots=explode(s),q=shots.find(q=>q.fallbackTargets.length);
 const hp=s.enemies[0].hp;
 s.c.GT=q.endAt-.001;s.c.sgTickFlyingProjectiles(0,s.ctx);assert.equal(s.enemies[0].hp,hp);
 s.enemies[0].pos={x:800,y:700};
 s.c.GT=Math.max(...shots.map(q=>q.endAt))+.001;s.c.sgTickFlyingProjectiles(0,s.ctx);
 assert.equal(s.enemies[0].hp,hp);assert.equal(s.c.SKILL2_RT.projectiles.length,0);
 const impacts=s.events.filter(e=>e.variant==='fireball-split-impact');assert.equal(impacts.length,3);
 assert.ok(impacts.every(e=>e.targets.length===0&&Object.keys(e.vfx).join(',')==='attack'));
 assert.equal(s.events.filter(e=>e.area?.fixedLanding).length,3,'爆點不可重新派送投射物');
});
test('FIREBALL-SPLIT 保留每顆傷害比例，原目標存活可命中、落地座標上的新敵人可被命中',()=>{
 const s=scene(1),shots=explode(s),q=shots.find(q=>q.fallbackTargets.length),calls=[];
 const hit=s.c.sgHitOne;s.c.sgHitOne=function(...args){calls.push(args);return hit(...args);};
 s.c.GT=q.endAt;s.c.sgTickFlyingProjectiles(0,s.ctx);
 assert.equal(calls.length,1);assert.equal(calls[0][2],s.enemies[0]);assert.equal(calls[0][3],q.dmgVal);
 const body=s.c.sgGroupBaseStat(s.c.SKILLS2.fireball,q.st)*s.c.sgVal(s.c.SKILLS2.fireball.tiers[0].fx,'pct',1)/100;
 assert.ok(Math.abs(q.dmgVal-body*.33)<1e-8);
 s.enemies[0].pos={...shots[2].fireballSplitLanding};
 s.c.GT=Math.max(...shots.map(q=>q.endAt))+.001;s.c.sgTickFlyingProjectiles(0,s.ctx);
 assert.ok(calls.length>=2,'原本沒有目標的落點也依抵達時位置判定');
});
test('FIREBALL-SPLIT 每顆殞石落地後才從各自爆點生成三顆，來源死亡不消失',()=>{
 const s=scene(1,true);s.c.castSkill2(s.p,s.enemies,'fireball','mv-float');
 assert.equal(s.c.SKILL2_RT.meteors.length,3);assert.equal(s.events.filter(e=>e.area?.fixedLanding).length,0);
 s.c.GT=s.c.SKILL2_RT.meteors[0].at;s.c.sgTickMeteors(s.ctx);
 assert.equal(s.c.SKILL2_RT.projectiles.filter(q=>q.fireballSplitLanding).length,3);
 s.enemies[0].hp=0;s.c.GT=10;s.c.sgTickMeteors(s.ctx);
 assert.equal(s.events.filter(e=>e.area?.fixedLanding).length,9);
 assert.ok(s.events.filter(e=>e.area?.fixedLanding).every(e=>e.area.sourceX===100));
});
function adapter(preset,scale=1,groundScale=1){
 const transforms=[],a=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},groundScale,
  fxBackend:{createNode:()=>({}),updateNode:(_,t)=>transforms.push({...t}),destroyNode:()=>{},destroy:()=>{}},
  ctx:{playerPos:()=>({x:-500,y:-500}),posOf:()=>({x:999,y:888}),projectileTargetPoint:()=>({x:2000,y:1500})}});
 a.registerPresets([preset]);a.tryPlay({fxKind:'projectile',variant:'fireball-small',targets:['enemy'],
  area:{sourceX:100,sourceY:50,x:400,y:50,fixedLanding:true},arcM:10,travelMs:[1000],sizeMult:scale,hit:false,vfx:{projectile:preset.id}});
 return {a,transforms};
}
test('FIREBALL-SPLIT Runtime保留原火球並縮半、固定落點，最高點為距離三分之一',()=>{
 const p={schemaVersion:1,id:'split',duration:.2,layers:[{id:'body',type:'sprite',assetId:'ball.png',perspective:false,cameraDepth:false}]};
 for(const groundScale of [1,.5]){
  const {a,transforms}=adapter(p,.5,groundScale);a.update(.5);
  const t=transforms.at(-1);assert.equal(t.x,250);assert.ok(Math.abs(t.y-(50*groundScale-100))<1e-8);
  assert.equal(t.scaleX,.5);assert.equal(t.scaleY,.5);assert.equal(t.perspective,false);assert.equal(t.cameraDepth,false);
  assert.equal(a.stats().projectiles,1,'短Preset仍完整飛行');a.update(.5);assert.equal(a.stats().projectiles,0);assert.equal(a.stats().fx.activeEffects,0);
 }
 const preset=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/proj-dragon-devour.json'),'utf8'));
 const small=adapter(preset,.5),big=adapter(preset,1);small.a.update(.1);big.a.update(.1);
 const x=small.transforms[0],y=big.transforms[0];assert.ok(Math.abs(x.scaleX*2-y.scaleX)<1e-8);assert.ok(Math.abs(x.scaleY*2-y.scaleY)<1e-8);
 small.a.destroy();big.a.destroy();
});
