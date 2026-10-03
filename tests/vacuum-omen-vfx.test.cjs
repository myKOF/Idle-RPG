'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{createEngine}=require('../scripts/sim/engine');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
const disc=require('../vfx/presets/orb-void-disc.json');
const helperFile=path.join(__dirname,'skill2-windblade-vacuum-legendary.test.cjs');
const h={require:createRequire(helperFile),__dirname,console};vm.createContext(h);
vm.runInContext(fs.readFileSync(helperFile,'utf8').split("test('")[0],h);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function setup(){
 const c=createEngine({seed:23}).boot(null).ctx;
 c.G.player.level=1000;c.G.player.skills2={levels:{vacuumslash:Array(7).fill(10)},ult:{vacuumslash:{pick:0,lv:1}}};
 c.G.player.loadout=['sg:vacuumslash'];c.getStats=()=>h.loadContext().BASE_STATS;c.chance=()=>true;
 c.SKILLS2.vacuumslash.tiers[6].fx.bodyM=12;
 const p=h.playerEnt(),m=h.enemy(1e9,100,80,'victim');p.mp=10000;p.pos={x:20,y:10};
 c.FIELD.player=p;c.FIELD.enemies=[m];c.bfPlayerPos=()=>p.pos;c.shimDrainUrgentVisualEvents();
 c.sgSpawnStaticVacuum(p,c.getStats(),c.sgUlt('vacuumslash','vacuumOmen'),m,'mv-float',100);
 return {c,p,m,f:c.SKILL2_RT.grounds[0],ctx:h.tickCtx(c,p,[m])};
}
function backend(){return {nodes:[],createNode(spec){const n={spec};this.nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.dead=true;}};}
function adapter(preset=disc,k=.5){
 const ground=backend(),air=backend();
 const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},groundScale:k,fxBackend:ground,zoneBackend:ground,airBackend:air,
  ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});
 rt.registerPresets([preset]);return {rt,ground,air};
}
function spec(age=0,id=disc.id){return {fxKind:'aura',variant:'wind-blade-homing',dur:.25,hit:false,vfx:{ground:id},
 area:{id:'static-test',x:100,y:80,r:180*(1+age/3),a:1.1,staticVacuum:true,baseR:180,growTo:2,growSec:3,growAge:age,lifeSec:3-age}};}

test('萬象風劫正式Worker事件使用表定orb-void-disc，保留出生位置／方向與實際判定半徑',()=>{
 const {c,p,m,f,ctx}=setup();assert.ok(f);near(f.baseRadius,60);near(f.angle,Math.atan2(70,80));
 c.sgTickGrounds(.01,ctx);
 const e=c.shimDrainUrgentVisualEvents().find(e=>e.area?.staticVacuum);
 assert.ok(e);assert.equal(e.vfx.ground,'orb-void-disc');assert.equal(e.hit,false);near(e.area.r,f.radius);near(e.area.a,f.angle);
 const pos={...f.pos},angle=f.angle;p.pos={x:1000,y:-1000};m.pos={x:900,y:800};
 c.GT=1.5;c.sgTickGrounds(1.5,ctx);near(f.radius,90);near(f.pos.x,pos.x);near(f.pos.y,pos.y);near(f.angle,angle);
 const grown=c.shimDrainUrgentVisualEvents().find(e=>e.area?.staticVacuum);near(grown.area.baseR,60);near(grown.area.growAge,1.5);near(grown.area.lifeSec,1.5);
 c.GT=2.99;c.sgTickGrounds(.01,ctx);assert.ok(c.SKILL2_RT.grounds.includes(f));
 c.GT=3;c.sgTickGrounds(.01,ctx);assert.equal(c.SKILL2_RT.grounds.length,0);near(f.radius,120);
});

test('正式Worker事件送入Runtime後固定命中位置，半徑與接觸傷害同源',()=>{
 const {c,f,p,m,ctx}=setup(),{rt,ground,air}=adapter({...disc,layers:[{id:'marker',type:'sprite',assetId:'marker'}]});
 const outer=h.enemy(1e9,190,80,'outer');c.FIELD.enemies.push(outer);ctx.getEnemies=()=>c.FIELD.enemies;
 c.sgTickGrounds(.01,ctx);
 const e=c.shimDrainUrgentVisualEvents().find(e=>e.area?.staticVacuum);assert.equal(rt.tryPlay(e),true);rt.update(0);
 const n=ground.nodes[0],hp=m.hp;near(n.t.scaleX,f.radius/240);assert.ok(hp<1e9);assert.equal(outer.hp,1e9);
 c.GT=.25;c.sgTickGrounds(.25,ctx);assert.equal(m.hp,hp,'持續接觸不重複傷害');
 p.pos={x:-500,y:-500};rt.update(1.5);near(n.t.x,100);near(n.t.y,40);near(n.t.scaleX,90/240);
 c.GT=1.5;c.sgTickGrounds(1.25,ctx);assert.ok(outer.hp<1e9,'成長半徑掃到新敵人才命中');
 assert.equal(air.nodes.length,0);rt.destroy();
});

test('萬象風劫使用圓盤作者尺寸，留在地面層且不套用追蹤風刃長寬／航向',()=>{
 const source=JSON.stringify(disc),{rt,ground,air}=adapter({...disc,layers:[{id:'marker',type:'sprite',assetId:'marker'}]});
 assert.equal(rt.tryPlay(spec()),true);rt.update(0);
 assert.equal(air.nodes.length,0);assert.equal(ground.nodes.length,1);
 const t=ground.nodes[0].t;near(t.x,100);near(t.y,40);near(t.scaleX,.75);near(t.scaleY,.75);
 near(t.rotation,Math.atan2(Math.sin(1.1)*.5,Math.cos(1.1)));assert.equal(t.motionAngle,undefined);assert.equal(JSON.stringify(disc),source);rt.destroy();
});

test('萬象風劫在兩次快照間連續線性放大，刷新不重播，到三秒立即回收',()=>{
 const {rt,ground}=adapter({...disc,layers:[{id:'marker',type:'sprite',assetId:'marker'}]});
 rt.tryPlay(spec());rt.update(0);const n=ground.nodes[0];
 rt.update(.125);
 // 單獨檢查快照前的中間幀，確保不是只在每跳改尺寸。
 near(n.t.scaleX,.75*(1+.125/3));rt.update(.125);near(n.t.scaleX,.75*(1+.25/3));
 const count=rt.stats().played;rt.tryPlay(spec(.25));assert.equal(rt.stats().played,count);assert.equal(ground.nodes.length,1);
 rt.update(2.74);near(n.t.scaleX,.75*(1+2.99/3));rt.update(.01);
 assert.equal(rt.stats().grounds,0);assert.equal(n.t.visible,false);rt.destroy();
});

test('萬象風劫尊重圓盤原有旋轉／outerScale，循環不會把放大倍率累乘',()=>{
 const {rt,ground,air}=adapter(),reference=adapter();rt.tryPlay(spec());rt.update(0);
 const fixed=spec();fixed.area.growTo=1;reference.rt.tryPlay(fixed);reference.rt.update(1.5);
 const initial=ground.nodes.filter(n=>n.t?.visible).map(n=>({...n.t}));assert.equal(initial.length,disc.layers.length);assert.equal(air.nodes.length,0);
 rt.update(1.5);
 const grown=ground.nodes.filter(n=>n.t?.visible);assert.equal(grown.length,initial.length);
 grown.forEach((n,i)=>{const ref=reference.ground.nodes[i].t;near(n.t.scaleX/ref.scaleX,1.5);near(n.t.scaleY/ref.scaleY,1.5);near(n.t.rotation,ref.rotation);near(n.t.x,100);near(n.t.y,40);assert.equal(n.t.motionAngle,undefined);});
 rt.destroy();reference.rt.destroy();
});

test('萬象風劫替換配置Preset仍靜止成長，短動畫可續播且空觸發欄不補特效',()=>{
 const replacement={schemaVersion:1,id:'replacement',duration:.2,loop:false,sizing:{shape:'circle',radiusM:3,authored:{radius:100}},layers:[{id:'marker',type:'sprite',assetId:'marker',duration:.2}]};
 const {rt,ground,air}=adapter(replacement);rt.tryPlay(spec(0,replacement.id));rt.update(.6);
 assert.equal(rt.stats().grounds,1);assert.equal(air.nodes.length,0);assert.equal(ground.nodes[0].t.visible,true);near(ground.nodes[0].t.scaleX,2.16);rt.destroy();
 const {c,f}=setup();c.SKILLS2.vacuumslash.ult[0].triggerVfx={};
 const e=c.sgGroundVfxSpec(f);assert.equal(e.vfxRoles.ground,undefined);assert.equal(e.hit,false);
});

test('整次施放只追加第七階圓盤，萬象風劫與原始單顆虛空斬同尺寸',()=>{
 const {c,p,m,ctx}=setup();m.pos={x:50,y:10};c.SKILL2_RT.grounds=[];c.shimDrainUrgentVisualEvents();
 assert.ok(c.castSkill2(p,[m],'vacuumslash','mv-float'));
 const events=c.shimDrainUrgentVisualEvents(),original=events.filter(e=>e.variant==='void-disc'&&e.fxKind==='aura');
 assert.equal(original.length,4);original.forEach(e=>near(e.area.orbR,60));
 assert.equal(events.filter(e=>e.variant==='wind-spin').length,1);
 assert.equal(events.filter(e=>e.variant==='wind-slash'||e.variant==='vacuum-shock').length,0);
 c.sgTickGrounds(0,ctx);
 const fixed=c.shimDrainUrgentVisualEvents().find(e=>e.area?.staticVacuum);assert.ok(fixed);near(fixed.area.r,original[0].area.orbR);
 assert.deepEqual(Object.keys(fixed.vfx),['ground']);assert.equal(fixed.vfx.ground,original[0].vfx.projectile);
 const marker={...disc,layers:[{id:'marker',type:'sprite',assetId:'marker'}]},staticView=adapter(marker),orbitView=adapter(marker);
 assert.equal(staticView.rt.tryPlay(fixed),true);assert.equal(orbitView.rt.tryPlay(original[0]),true);
 staticView.rt.update(0);orbitView.rt.update(0);
 near(staticView.ground.nodes[0].t.scaleX,orbitView.air.nodes[0].t.scaleX);
 near(staticView.ground.nodes[0].t.scaleY,orbitView.air.nodes[0].t.scaleY);
 near(staticView.ground.nodes[0].t.scaleX,.25);
 staticView.rt.destroy();orbitView.rt.destroy();
 const times=c.SKILL2_RT.vacuumWaves.map(w=>w.at);assert.deepEqual(Array.from(times),[.5,1,1.5,2]);
 for(const at of times){c.GT=at;c.sgTickVacuumWaves(ctx);events.push(...c.shimDrainUrgentVisualEvents());}
 assert.equal(events.filter(e=>e.variant==='wind-spin').length,5);
 assert.equal(events.filter(e=>e.variant==='void-disc'&&e.fxKind==='aura').length,4,'後波不重播整組第七階');
 assert.equal(c.SKILL2_RT.grounds.length,5);c.SKILL2_RT.grounds.forEach(f=>near(f.baseRadius,60));
});

test('調整第七階本體尺寸會同步靜止圓盤，迴旋／每波增幅／軌道半徑均不放大圓盤',()=>{
 for(const metres of [6,12,18]){
  const {c,p,m,ctx}=setup();m.pos={x:50,y:10};c.SKILL2_RT.grounds=[];
  const t=c.SKILLS2.vacuumslash.tiers;t[3].fx.m=36;t[4].fx.m=100;t[6].fx.m=60;t[6].fx.bodyM=metres;
  assert.ok(c.castSkill2(p,[m],'vacuumslash','mv-float'));
  near(c.SKILL2_RT.orbits[0].bodyR,metres*5);near(c.SKILL2_RT.orbits[0].rings[0].r,600);
  for(const at of Array.from(c.SKILL2_RT.vacuumWaves,w=>w.at)){c.GT=at;c.sgTickVacuumWaves(ctx);}
  assert.equal(c.SKILL2_RT.grounds.length,5);c.SKILL2_RT.grounds.forEach(f=>near(f.baseRadius,metres*5));
 }
});

test('追蹤風刃沿用原尺寸與空中層，不受靜止斬影響',()=>{
 const p=require('../vfx/presets/ground-homing-wind-crescent.json');
 const {rt,air,ground}=adapter({...p,layers:[{id:'marker',type:'sprite',assetId:'marker'}]});
 rt.tryPlay({fxKind:'aura',variant:'wind-blade-homing',dur:1,area:{id:'moving',x:0,y:0,r:30,speed:180,moveA:0},vfx:{ground:p.id}});
 rt.update(.1);assert.equal(ground.nodes.length,0);near(air.nodes[0].t.x,18);near(air.nodes[0].t.scaleX,.75);assert.equal(air.nodes[0].t.motionAngle,0);rt.destroy();
});
