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
test('途中目標被別人殺死仍抵達最後座標，屆時才查下一個目標',()=>{
 const h=setup(),a=h.enemy(100,100,'A');h.cfg.pool=[a];
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife',()=>h.c.sgKnifeBounceChain(h.cfg,a,100,0,1,0,0,false));
 a.hp=0;h.tick(.5);assert.equal(h.hits.length,0);assert.equal(h.events.length,1);
 const b=h.enemy(200,1000,'new');h.cfg.pool=[b];h.tick(1);
 const bounce=h.events.find(e=>e.variant==='knife-bounce');assert.ok(bounce);assert.equal(bounce.area.sourceX,100);
 assert.equal(h.hits.length,0);h.tick(2);assert.equal(b.hp,900);
});
test('死亡目標抵達後無目標便消失；不跨彈射範圍、不補傷害',()=>{
 const h=setup(),a=h.enemy(100),far=h.enemy(500);h.cfg.pool=[a,far];
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife',()=>h.c.sgKnifeBounceChain(h.cfg,a,100,0,2,0,0,false));
 a.hp=0;h.tick(1);assert.equal(h.hits.length,0);assert.equal(h.c.SKILL2_RT.projectiles.length,0);assert.equal(h.events.length,1);
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
