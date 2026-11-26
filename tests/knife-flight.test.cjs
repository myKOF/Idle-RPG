const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const helperFile=path.join(__dirname,'skill2-knife-range.test.cjs');
const helper=fs.readFileSync(helperFile,'utf8');
const scope={require:createRequire(helperFile),__dirname,console};vm.createContext(scope);
vm.runInContext(helper.slice(0,helper.indexOf("test("))+'\nthis.h={loadContext,enemy,playerEnt};',scope);
function setup(){
 const c=scope.h.loadContext(),p=scope.h.playerEnt(),events=[],hits=[];
 c.GT=0;c.resetSkill2RT();c.bfPlayerPos=()=>({x:0,y:0});
 c.G.player.skills2.levels.knife=[1,0,1,0,0,0,0];
 c.SKILLS2.knife.tiers[0].fx.speed=10;c.enemyEventFloatTarget=e=>e.name;
 c.playCombatVfx=e=>events.push(e);c.applySkillFinalDamageMultiplier=()=>{};c.chance=()=>false;
 c.resolveHit=(a,e)=>{e.hp=Math.max(0,e.hp-100);hits.push({target:e,time:c.GT});return {dmg:100,crit:false,miss:false,killed:e.hp===0};};
 const cfg={pEnt:p,st:c.getStats(),pool:[],floatSel:'mv-float',out:{dmg:0},dmgVal:100,onCrit(){},pathPct:0,execPct:0,bounceRangePx:200};
 function tick(t){c.GT=t;c.sgTickFlyingProjectiles(.01,{getEnemies:()=>cfg.pool});}
 return {c,p,cfg,events,hits,tick,enemy:(x,hp=1000,name='E')=>scope.h.enemy(hp,x,0,name)};
}
test('飛刀真正到達才扣血，起飛事件不提前排受擊',()=>{
 const h=setup(),a=h.enemy(100);h.cfg.pool=[a];
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife');
 assert.equal(a.hp,1000);assert.equal(h.events[0].hit,false);assert.equal(h.events[0].travelMs[0],1000);
 h.tick(.99);assert.equal(a.hp,1000);h.tick(1);assert.equal(a.hp,900);
 assert.equal(h.events.filter(e=>e.fxKind==='impact').length,1);assert.equal(h.cfg.out._pendingProjectiles,0);
});
test('擊殺起點仍保留 A→B、飛行時間按 A 到 B 計算',()=>{
 const h=setup(),a=h.enemy(100,100,'A'),b=h.enemy(250,1000,'B');h.cfg.pool=[a,b];
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife',()=>h.c.sgKnifeBounceChain(h.cfg,a,100,0,1,0,0,false));
 h.tick(1);assert.equal(a.hp,0);assert.equal(b.hp,1000);
 const bounce=h.events.find(e=>e.variant==='knife-bounce');
 assert.deepEqual(Array.from(bounce.targets),['A','B']);assert.equal(bounce.area.sourceX,100);assert.equal(bounce.travelMs[1],1500);
 h.tick(2.49);assert.equal(b.hp,1000);h.tick(2.5);assert.equal(b.hp,900);
});
test('途中目標死亡立即從刀刃位置重鎖，抵達新目標才扣血',()=>{
 const h=setup(),a=h.enemy(100,100,'A'),b=h.enemy(150,1000,'B');h.cfg.pool=[a,b];
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife');
 h.tick(.25);a.hp=0;h.tick(.5);
 const p=h.c.SKILL2_RT.projectiles[0],redirect=h.events.at(-1);
 assert.equal(p.target,b);assert.equal(p.origin.x,50);assert.equal(p.startAt,.5);
 assert.equal(redirect.area.knifeId,h.events[0].area.knifeId);
 assert.equal(redirect.area.sourceX,50);assert.equal(redirect.targets.at(-1),'B');
 assert.equal(h.cfg.out._pendingProjectiles,1);assert.equal(h.hits.length,0);
 h.tick(p.endAt-.001);assert.equal(b.hp,1000);h.tick(p.endAt);assert.equal(b.hp,900);
 assert.equal(h.cfg.out._pendingProjectiles,0);
});
test('死亡目標無有效替代便立即結束，不跨彈射範圍、不補傷害',()=>{
 const h=setup(),a=h.enemy(100),far=h.enemy(500);h.cfg.pool=[a,far];
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife',()=>h.c.sgKnifeBounceChain(h.cfg,a,100,0,2,0,0,false));
 a.hp=0;h.tick(.1);assert.equal(h.hits.length,0);assert.equal(h.c.SKILL2_RT.projectiles.length,0);
 assert.equal(h.events.at(-1).area.knifeStop,true);assert.equal(h.cfg.out._pendingProjectiles,0);
});
test('迴旋飛刀在20敵混合距離場景只向施放距離內起飛，後續仍可彈射到圈外',()=>{
 const h=setup();h.c.G.player.skills2.levels.knife=[1,1,1,1,1,0,0];h.c.FIELD.player=h.p;
 const near=[h.enemy(40,1e9,'near-A'),h.enemy(-45,1e9,'near-B')];
 const outside=Array.from({length:18},(_,i)=>h.enemy(150+i*20,1e9,'far-'+i));
 h.cfg.pool=near.concat(outside);
 for(let run=0;run<40;run++){
  h.c.Math.random=()=>run/40;h.c.resetSkill2RT();h.events.length=0;h.p.skillCds={};h.p.mp=10000;
  h.c.castSkill2(h.p,h.cfg.pool,'knife','mv-float');
  const shots=h.c.SKILL2_RT.projectiles.filter(p=>p.knifeFlight);
  assert.equal(shots.length,2);assert.ok(shots.every(p=>near.includes(p.target)));
 }
 let bounced=false;
 for(let tick=1;tick<100;tick++){
  h.tick(tick*.1);
  bounced ||= h.events.some(e=>e.variant==='knife-bounce'&&e.targets.some(id=>id.startsWith('far-')));
 }
 assert.ok(bounced,'起飛距離不得縮短原有彈射範圍');
});
test('畫面周圍20敵加上場外20敵，反覆施放都不抽場外敵人起飛',()=>{
 const h=setup();h.c.G.player.skills2.levels.knife=[1,1,1,1,1,0,0];h.c.FIELD.player=h.p;
 const near=Array.from({length:20},(_,i)=>{const e=h.enemy(40*Math.cos(i*Math.PI/10),1e9,'near-'+i);e.pos.y=40*Math.sin(i*Math.PI/10);return e;});
 const far=Array.from({length:20},(_,i)=>h.enemy(500+i*20,1e9,'far-'+i));h.cfg.pool=near.concat(far);
 let seed=23;h.c.Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 for(let run=0;run<100;run++){
  h.c.resetSkill2RT();h.p.mp=10000;h.p.skillCds={};
  assert.ok(h.c.castSkill2(h.p,h.cfg.pool,'knife','mv-float'));
  const shots=h.c.SKILL2_RT.projectiles.filter(p=>p.knifeFlight);
  assert.equal(shots.length,2);assert.ok(shots.every(p=>near.includes(p.target)));
 }
});
test('多刀競殺同一目標時其餘刀重鎖存活敵人，不提前結算或增加彈射',()=>{
 const h=setup(),a=h.enemy(100,100,'A'),others=Array.from({length:20},(_,i)=>h.enemy(110+i,1000,'B'+i));
 h.cfg.pool=[a,...others];h.c.Math.random=()=>0;
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife');
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife');
 h.tick(1);assert.equal(a.hp,0);assert.equal(h.hits.length,1);
 assert.equal(h.c.SKILL2_RT.projectiles.length,1);const p=h.c.SKILL2_RT.projectiles[0];
 assert.ok(others.includes(p.target));assert.equal(p.origin.x,100);assert.equal(h.cfg.out._pendingProjectiles,1);
 h.tick(p.endAt);assert.equal(h.hits.length,2);assert.equal(h.cfg.out._pendingProjectiles,0);
});
test('目標活著但已離場也會重鎖，連續失效不耗彈射預算，下一跳由實際命中點出發',()=>{
 const h=setup(),a=h.enemy(100,1000,'A'),b=h.enemy(150,1000,'B'),c=h.enemy(120,1000,'C');
 h.c.Math.random=()=>0;h.cfg.pool=[a];
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife',(res,angle,reached)=>{
  assert.equal(reached,c);h.c.sgKnifeBounceChain(h.cfg,reached,50,0,1,0,0,false,undefined,undefined,undefined,angle);
 });
 h.cfg.pool=[b];h.tick(.2);let p=h.c.SKILL2_RT.projectiles[0];assert.equal(p.target,b);
 h.cfg.pool=[c];b.hp=0;h.tick(.3);assert.equal(p.target,c);assert.equal(h.hits.length,0);
 const d=h.enemy(220,1000,'D');h.cfg.pool=[c,d];h.tick(p.endAt);
 assert.equal(h.hits.length,1);assert.equal(h.hits[0].target,c);
 const bounce=h.events.at(-1);assert.deepEqual(Array.from(bounce.targets),['C','D']);assert.equal(bounce.area.sourceX,120);
 p=h.c.SKILL2_RT.projectiles[0];h.tick(p.endAt);
 assert.equal(h.hits.length,2);assert.equal(h.c.SKILL2_RT.projectiles.length,0);assert.equal(h.cfg.out._pendingProjectiles,0);
});
test('重鎖當拍仍掃過暴雨梨花路徑，轉向後不重複命中已掃過敵人',()=>{
 const h=setup(),a=h.enemy(300,1000,'A'),mid=h.enemy(50,1000,'mid'),b=h.enemy(150,1000,'B');
 h.cfg.pathPct=20;h.cfg.execPct=1;h.cfg.pool=[a,mid,b];
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife');a.hp=0;
 h.tick(1);assert.equal(h.hits.filter(x=>x.target===mid).length,1);
 const p=h.c.SKILL2_RT.projectiles[0];assert.equal(p.target,b);
 h.tick(p.endAt);assert.equal(h.hits.filter(x=>x.target===mid).length,1);assert.equal(h.hits.filter(x=>x.target===b).length,1);
});
test('暴雨梨花只在刀刃掃過路徑時命中、每段每敵一次',()=>{
 const h=setup(),a=h.enemy(300),mid=h.enemy(150);h.cfg.pool=[a,mid];h.cfg.pathPct=20;
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife');
 h.tick(.5);assert.equal(h.hits.length,0);h.tick(1.6);assert.equal(h.hits.filter(x=>x.target===mid).length,1);
 h.tick(2.5);assert.equal(h.hits.filter(x=>x.target===mid).length,1);assert.equal(a.hp,1000);
 h.tick(3);assert.equal(a.hp,900);
});
test('主技能施放只排飛行物，不立即殺死所有彈射目標',()=>{
 const h=setup(),a=h.enemy(40,100,'A'),b=h.enemy(150,100,'B');h.cfg.pool=[a,b];h.c.FIELD.player=h.p;
 h.c.castSkill2(h.p,h.cfg.pool,'knife','mv-float');assert.equal(h.hits.length,0);
 assert.ok(h.c.SKILL2_RT.projectiles.length);assert.ok(h.events.every(e=>e.hit===false));
 h.tick(5);assert.ok(h.hits.length>0);
});
test('兩把一般飛刀鎖同一敵人且無替代，首刀擊殺後另一刀結束', () => {
 const h = setup(), target = h.enemy(40, 100, 'A');
 h.cfg.pool = [target];
 h.c.FIELD.player = h.p;
 h.c.castSkill2(h.p, h.cfg.pool, 'knife', 'mv-float');
 const flights = h.events.filter(e => e.area?.knifeFlight);
 assert.equal(flights.length, 2);
 assert.ok(flights.every(e => e.targets[0] === 'A' && e.area.x === 40));
 h.tick(flights[0].travelMs[0] / 1000);
 assert.equal(target.hp, 0);
 assert.equal(h.hits.length, 1);
 assert.equal(h.events.filter(e => e.area?.knifeImpact).length, 1);
 assert.equal(h.c.SKILL2_RT.projectiles.length, 0);
});
test('輪舞刃共用一般飛刀刀身與尾跡，畫面和接觸判定沿同一條環繞路徑', () => {
 const h = setup(), centre = { x: 20, y: 40 }, groundScale = 0.62;
 const metres = h.c.bfMeterPx(1), target = h.enemy(centre.x, 1000, 'A');
 target.pos.y = centre.y + 10 * metres;
 h.c.bfPlayerPos = () => centre;
 h.c.sgQueueKnifeFlight(h.cfg, null, target, 100, 0, false, 'knife');
 const flight = h.events[0];
 h.c.sgKnifeWaltz(h.p, h.cfg.st, h.cfg, { m: 10, sec: 5 });
 const orbit = h.events[1], field = h.c.SKILL2_RT.orbits[0];
 assert.equal(orbit.variant, 'knife-waltz');
 assert.equal(orbit.vfx.projectile, flight.vfx.projectile);
 assert.equal(orbit.vfx.ground, undefined);
 assert.equal(orbit.area.r, 10 * metres);
 assert.equal(orbit.area.orbR, metres);
 assert.equal(orbit.area.spinRate, Math.PI * 2);
 assert.equal(orbit.dur, 5);

 const Core = require('../js/vfx-core.js'), Runtime = require('../js/vfx-runtime.js');
 const screen = (p) => ({ x: p.x, y: p.y * groundScale });
 const sprites = [], played = [];
 const core = {
  ...Core,
  createRuntime(options) {
   const runtime = Core.createRuntime(options), play = runtime.play;
   runtime.play = (id, params) => {
    played.push({ id, scaleX: params.scaleX, scaleY: params.scaleY });
    return play(id, params);
   };
   return runtime;
  }
 };
 const backend = {
  createNode: spec => ({ blade: spec.assetUrl.endsWith('/dingbats-389.png') }),
  updateNode: (node, transform) => { if (node.blade) sprites.push({ ...transform }); },
  destroyNode() {}
 };
 const rt = Runtime.create({
  core, resolver: { has: () => true, resolve: x => x }, fxBackend: backend, zoneBackend: backend,
  groundScale, profile: { scale: 0.8, areaScale: 0.5 },
  ctx: { playerPos: () => screen(centre), posOf: () => screen(target.pos), footOf: id => screen(id === 'pv-float' ? centre : target.pos) }
 });
 rt.registerPresets([require('../vfx/presets/proj-knife.json')]);
 assert.equal(rt.tryPlay(flight), true);
 rt.clear();
 assert.equal(rt.tryPlay(orbit), true);
 assert.equal(played.length, 2);
 assert.deepEqual(played[1], played[0]);
 h.c.GT = 0.25;
 h.c.sgTickOrbits(0.25, { getEnemies: () => [target] });
 rt.update(0.25);
 const contact = h.c.sgOrbitPos(field.orbs[0], centre), drawn = sprites.at(-1);
 assert.ok(Math.abs(drawn.x - contact.x) < 1e-6);
 assert.ok(Math.abs(drawn.y - contact.y * groundScale) < 1e-6);
 assert.equal(target.hp, 900);
 assert.equal(h.events.find(e => e.fxKind === 'impact').vfx.hit, flight.vfx.hit);
 for (let frame = 0; frame < 30; frame++) rt.update(0.125);
 assert.equal(rt.stats().orbits, 1);
 assert.ok(rt.stats().fx.activeEffects > 0);
 assert.ok(rt.stats().fx.activeParticles > 0);
 h.c.GT = 5;
 h.c.sgTickOrbits(1, { getEnemies: () => [target] });
 rt.update(1);
 assert.equal(h.c.SKILL2_RT.orbits.length, 0);
 assert.equal(rt.stats().orbits, 0);
});
test('無座標高塔仍等待到達，換場清除待命中飛刀',()=>{
 const h=setup(),a=h.enemy(100);delete a.pos;h.cfg.pool=[a];
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife');assert.equal(a.hp,1000);
 h.tick(10);assert.equal(a.hp,900);
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife');h.c.resetSkill2RT();h.tick(20);assert.equal(a.hp,900);
});
test('Runtime 在死亡起點以權威座標出發，目標消失仍飛完整段',()=>{
 const h=setup(),a=h.enemy(100,0,'A'),b=h.enemy(200,1000,'B');h.cfg.pool=[b];
 h.c.sgQueueKnifeFlight(h.cfg,a,b,100,0,false,'knife-bounce');const spec=h.events[0];
 const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');const frames=[];let visible=true;
 const backend={createNode:()=>({}),updateNode:(n,t)=>frames.push({...t}),destroyNode(){}};
 const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:x=>x},fxBackend:backend,zoneBackend:backend,
  ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:999,y:999}),chainPoint:()=>visible?{x:200,y:0}:null}});
 rt.registerPresets([JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/proj-knife.json')))]);
 assert.equal(rt.tryPlay(spec),true);rt.update(.25);assert.ok(frames.some(f=>Math.abs(f.x-125)<1e-6));
 visible=false;rt.update(.25);assert.ok(frames.some(f=>Math.abs(f.x-150)<1e-6));
 assert.equal(rt.stats().projectiles,1);rt.update(.5);assert.equal(rt.stats().projectiles,0);
});
test('Worker 保留飛刀曲線、飛行時間及禁止提前受擊的欄位',()=>{
 const h=setup(),a=h.enemy(100,0,'A'),b=h.enemy(200,1000,'B');h.cfg.pool=[b];
 h.c.sgQueueKnifeFlight(h.cfg,a,b,100,0,false,'knife-bounce',null,Math.PI/2);
 const src=fs.readFileSync(path.join(__dirname,'../js/worker/shim.js'),'utf8');
 const start=src.indexOf('function playCombatVfx(spec)'),end=src.indexOf('\n/* ---- 其餘',start);
 const received=[],ctx={_diag(){},SHIM_DIAG:{ui:0},shimPushEvent:(kind,spec)=>received.push(spec)};
 vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);ctx.playCombatVfx(h.events[0]);
 assert.equal(received[0].hit,false);assert.deepEqual(received[0].area,h.events[0].area);
 assert.equal(received[0].preserveDeadTargets,true);assert.ok(received[0].area.knifeId);
 assert.deepEqual(received[0].travelMs,h.events[0].travelMs);assert.equal(received[0].targets.length,2);
});
test('彈射曲線的模擬中點與 Runtime 畫面一致，長距離仍顯示刀身',()=>{
 const h=setup(),a=h.enemy(100,0,'A'),b=h.enemy(500,1000,'B');h.cfg.pool=[b];
 h.c.sgQueueKnifeFlight(h.cfg,a,b,100,0,false,'knife-bounce',null,Math.PI/2);
 const p=h.c.SKILL2_RT.projectiles[0],spec=h.events[0],duration=p.endAt-p.startAt;
 assert.ok(duration>4,'彎曲路徑比弦長更長');
 const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js'),frames=[];
 const backend={createNode:()=>({}),updateNode:(n,t)=>frames.push({...t}),destroyNode(){}};
 const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:x=>x},fxBackend:backend,zoneBackend:backend,
  ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>b.pos,chainPoint:()=>b.pos}});
 rt.registerPresets([JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/proj-knife.json')))]);
 rt.tryPlay(spec);
 for(let i=0;i<60;i++)rt.update(duration/120);
 const expected=h.c.sgKnifeFlightPoint(p,b.pos,.5);
 assert.ok(frames.some(f=>Math.abs(f.x-expected.x)<1e-6&&Math.abs(f.y-expected.y)<1e-6));
 assert.equal(rt.stats().projectiles,1);assert.ok(rt.stats().fx.activeEffects>0);
});

test('Runtime 飛刀到達與追魂刃換段保留尾粒子，換場立即清空',()=>{
 const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
 const backend={createNode:()=>({}),updateNode(){},destroyNode(){}};
 const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:x=>x},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:100,y:0}),chainPoint:()=>({x:100,y:0})}});
 rt.registerPresets([{schemaVersion:1,id:'test-knife-tail',duration:1,layers:[{id:'body',type:'sprite',assetId:'p.png'},{id:'tail',type:'particle',assetId:'p.png',emission:{mode:'rate',rate:30},lifetime:2,speed:0}]}]);
 const spec={fxKind:'projectile',variant:'knife',hit:false,targets:['E'],travelMs:[200],vfx:{projectile:'test-knife-tail'},area:{knifeFlight:true,sourceX:0,sourceY:0,x:100,y:0}};
 rt.tryPlay(spec);rt.update(.1);rt.update(.1);assert.equal(rt.stats().projectiles,0);assert.ok(rt.stats().fx.activeParticles>0);
 const soul={...spec,variant:'knife-soulhunter',area:{...spec.area,soulId:'one',soulMode:'flight',soulLife:10}};
 rt.tryPlay(soul);rt.update(.05);const before=rt.stats().fx.activeParticles;rt.tryPlay(soul);assert.equal(rt.stats().projectiles,1);assert.ok(rt.stats().fx.activeParticles>=before);
 rt.clear();assert.equal(rt.stats().fx.activeParticles,0);assert.equal(rt.stats().fx.activeEffects,0);
});
test('Runtime 重鎖替換同一刀身，保留尾粒子且逐幀沿權威轉彎，停止不波及其他刀',()=>{
 const h=setup(),a=h.enemy(100,1000,'A'),b=h.enemy(80,1000,'B');b.pos.y=100;h.cfg.pool=[a,b];
 const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js'),blades=[];
 const backend={createNode:spec=>({blade:spec.assetUrl.endsWith('dingbats-389.png')}),
  updateNode:(n,t)=>{if(n.blade)blades.push({...t});},destroyNode(){}};
 const screen=p=>({x:p.x,y:p.y*.62});
 const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:x=>x},fxBackend:backend,zoneBackend:backend,
  groundScale:.62,ctx:{playerPos:()=>screen({x:0,y:0}),posOf:id=>screen(id==='A'?a.pos:b.pos),
   footOf:id=>screen(id==='A'?a.pos:b.pos),chainPoint:id=>id==='A'&&a.hp<=0?null:screen(id==='A'?a.pos:b.pos)}});
 rt.registerPresets([require('../vfx/presets/proj-knife.json')]);
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife');rt.tryPlay(h.events[0]);
 for(let i=0;i<30;i++)rt.update(1/60);
 a.hp=0;h.tick(.5);const p=h.c.SKILL2_RT.projectiles[0],spec=h.events.at(-1);
 rt.tryPlay(spec);assert.equal(rt.stats().projectiles,1);assert.ok(rt.stats().fx.activeParticles>0);
 const duration=p.endAt-p.startAt;
 for(let frame=1;frame<=30;frame++){
  rt.update(duration/60);const expected=h.c.sgKnifeFlightPoint(p,b.pos,frame/60),drawn=blades.at(-1);
  assert.ok(Math.abs(drawn.x-expected.x)<1e-6);assert.ok(Math.abs(drawn.y-expected.y*.62)<1e-6);
 }
 rt.tryPlay({...spec,area:{...spec.area,knifeId:'other'}});assert.equal(rt.stats().projectiles,2);
 rt.tryPlay({...spec,targets:[],area:{knifeId:spec.area.knifeId,knifeStop:true}});
 assert.equal(rt.stats().projectiles,1);assert.ok(rt.stats().fx.activeParticles>0);rt.clear();
});
