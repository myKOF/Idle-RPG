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
function setup(spawn=true){
 const c=createEngine({seed:23}).boot(null).ctx;
 c.G.player.level=1000;c.G.player.skills2={levels:{vacuumslash:Array(7).fill(10)},ult:{vacuumslash:{pick:0,lv:1}}};
 c.G.player.loadout=['sg:vacuumslash'];c.getStats=()=>h.loadContext().BASE_STATS;c.chance=()=>true;
 c.SKILLS2.vacuumslash.tiers[6].fx.bodyM=12;
 const p=h.playerEnt(),m=h.enemy(1e9,100,80,'victim');p.mp=10000;p.pos={x:20,y:10};
 c.FIELD.player=p;c.FIELD.enemies=[m];c.bfPlayerPos=()=>p.pos;c.shimDrainUrgentVisualEvents();
 if(spawn)c.sgSpawnStaticVacuum(p,c.getStats(),c.sgUlt('vacuumslash','vacuumOmen'),m,'mv-float',100);
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
 const {c,p,m,ctx}=setup(false);m.pos={x:50,y:10};c.shimDrainUrgentVisualEvents();
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
 assert.equal(c.SKILL2_RT.grounds.length,1);near(c.SKILL2_RT.grounds[0].baseRadius,60);
});

test('調整第七階本體尺寸會同步靜止圓盤，迴旋／每波增幅／軌道半徑均不放大圓盤',()=>{
 for(const metres of [6,12,18]){
  const {c,p,m,ctx}=setup(false);m.pos={x:50,y:10};
  const t=c.SKILLS2.vacuumslash.tiers;t[3].fx.m=36;t[4].fx.m=100;t[6].fx.m=60;t[6].fx.bodyM=metres;
  assert.ok(c.castSkill2(p,[m],'vacuumslash','mv-float'));
  near(c.SKILL2_RT.orbits[0].bodyR,metres*5);near(c.SKILL2_RT.orbits[0].rings[0].r,600);
  for(const at of Array.from(c.SKILL2_RT.vacuumWaves,w=>w.at)){c.GT=at;c.sgTickVacuumWaves(ctx);}
  assert.equal(c.SKILL2_RT.grounds.length,1);near(c.SKILL2_RT.grounds[0].baseRadius,metres*5);
 }
});

test('同一敵人的靜止斬作用中不重生／延命／移位，結束後換施放者也可再觸發',()=>{
 const {c,p,m,ctx}=setup(false),u=c.sgUlt('vacuumslash','vacuumOmen');let rolls=0;c.chance=()=>{rolls++;return true;};
 c.sgSpawnStaticVacuum(p,c.getStats(),u,m,'mv-float',100);
 const f=c.SKILL2_RT.grounds[0],pos={...f.pos},other=h.playerEnt();assert.ok(f);assert.equal(f.tgt,m);
 m.pos={x:400,y:400};c.GT=1;
 for(let i=0;i<100;i++)c.sgSpawnStaticVacuum(i%2?p:other,c.getStats(),u,m,'mv-float',100);
 assert.equal(rolls,1);assert.equal(c.SKILL2_RT.grounds.length,1);near(f.bornAt,0);near(f.expiresAt,3);near(f.pos.x,pos.x);near(f.pos.y,pos.y);
 c.GT=3;c.sgTickGrounds(3,ctx);assert.equal(c.SKILL2_RT.grounds.length,0);
 c.sgSpawnStaticVacuum(other,c.getStats(),u,m,'mv-float',100);assert.equal(c.SKILL2_RT.grounds.length,1);assert.equal(rolls,2);
 const next=c.SKILL2_RT.grounds[0];assert.notEqual(next.vfxId,f.vfxId);assert.equal(next.tgt,m);
 near(next.bornAt,3);near(next.expiresAt,6);near(next.pos.x,400);near(next.pos.y,400);
 const fresh=h.enemy(1e9,400,400,m.name);c.sgSpawnStaticVacuum(p,c.getStats(),u,fresh,'mv-float',100);
 assert.equal(c.SKILL2_RT.grounds.length,2);assert.equal(rolls,3);assert.equal(c.SKILL2_RT.grounds[1].tgt,fresh);
});

test('截止前阻擋／截止時可再觸發，不必等待舊場域從陣列回收',()=>{
 const {c,p,m,f}=setup(),u=c.sgUlt('vacuumslash','vacuumOmen');let rolls=0;c.chance=()=>{rolls++;return true;};
 c.GT=2.999;c.sgSpawnStaticVacuum(p,c.getStats(),u,m,'mv-float',100);
 assert.equal(rolls,0);assert.equal(c.SKILL2_RT.grounds.length,1);
 c.GT=3;c.sgSpawnStaticVacuum(p,c.getStats(),u,m,'mv-float',100);
 assert.equal(rolls,1);assert.ok(c.SKILL2_RT.grounds.includes(f));
 const live=c.SKILL2_RT.grounds.filter(f=>f.kind==='vacuumfield'&&f.expiresAt>c.GT);
 assert.equal(live.length,1);assert.notEqual(live[0].vfxId,f.vfxId);near(live[0].bornAt,3);near(live[0].expiresAt,6);
 c.GT=6;c.chance=()=>{rolls++;return false;};c.sgSpawnStaticVacuum(p,c.getStats(),u,m,'mv-float',100);
 assert.equal(rolls,2);assert.equal(c.SKILL2_RT.grounds.filter(f=>f.expiresAt>c.GT).length,0,'結束後仍須通過觸發機率');
 c.chance=()=>true;c.sgSpawnStaticVacuum(p,c.getStats(),u,m,'mv-float',100);
 assert.equal(c.SKILL2_RT.grounds.filter(f=>f.expiresAt>c.GT).length,1,'機率失敗沒有鎖住後續觸發');
});

test('各敵人按自己的靜止斬截止時間解鎖，不受其他敵人的斬結束影響',()=>{
 const {c,p,m}=setup(),u=c.sgUlt('vacuumslash','vacuumOmen'),other=h.enemy(1e9,400,400,'later');
 c.GT=1;c.sgSpawnStaticVacuum(p,c.getStats(),u,other,'mv-float',100);
 const later=c.SKILL2_RT.grounds[1];near(later.expiresAt,4);
 c.GT=3;c.sgSpawnStaticVacuum(p,c.getStats(),u,m,'mv-float',100);c.sgSpawnStaticVacuum(p,c.getStats(),u,other,'mv-float',100);
 const live=c.SKILL2_RT.grounds.filter(f=>f.kind==='vacuumfield'&&f.expiresAt>c.GT);
 assert.equal(live.length,2);assert.equal(live.filter(f=>f.tgt===other).length,1);assert.ok(live.includes(later));
 c.GT=4;c.sgSpawnStaticVacuum(p,c.getStats(),u,other,'mv-float',100);
 const reborn=c.SKILL2_RT.grounds.filter(f=>f.tgt===other&&f.expiresAt>c.GT);
 assert.equal(reborn.length,1);assert.notEqual(reborn[0].vfxId,later.vfxId);near(reborn[0].expiresAt,7);
});

test('靜止斬提前清場後，同一存活敵人可重新觸發',()=>{
 const {c,p,m,f}=setup();c.GT=1;c.SKILL2_RT.grounds=[];
 c.sgSpawnStaticVacuum(p,c.getStats(),c.sgUlt('vacuumslash','vacuumOmen'),m,'mv-float',100);
 assert.equal(c.SKILL2_RT.grounds.length,1);assert.equal(c.SKILL2_RT.grounds[0].tgt,m);
 assert.notEqual(c.SKILL2_RT.grounds[0].vfxId,f.vfxId);near(c.SKILL2_RT.grounds[0].expiresAt,4);
});

test('機率未中／零傷害／敵人死亡／場域上限沒有生成時，不鎖住後續觸發',()=>{
 for(const failure of ['chance','damage','dead','cap']){
  const {c,p,m}=setup(false),u=c.sgUlt('vacuumslash','vacuumOmen');
  if(failure==='chance')c.chance=()=>false;
  if(failure==='dead')m.hp=0;
  if(failure==='cap')c.SKILL2_RT.grounds=Array.from({length:c.SG_GROUND_MAX_FIELDS},()=>({kind:'other'}));
  c.sgSpawnStaticVacuum(p,c.getStats(),u,m,'mv-float',failure==='damage'?0:100);
  assert.equal(c.SKILL2_RT.grounds.filter(f=>f.kind==='vacuumfield').length,0,failure);
  c.chance=()=>true;m.hp=1e9;c.SKILL2_RT.grounds=[];
  c.sgSpawnStaticVacuum(p,c.getStats(),u,m,'mv-float',100);assert.equal(c.SKILL2_RT.grounds.length,1);assert.equal(c.SKILL2_RT.grounds[0].tgt,m);
 }
});

test('正式施放MISS不鎖觸發；不同敵人各生成一個，後波／重施不重生，結束後重施可生成',()=>{
 const {c,p,m,ctx}=setup(false);m.pos={x:50,y:10};p.mp=1e6;
 const fresh=h.enemy(1e9,45,15,'second');c.FIELD.enemies.push(fresh);ctx.getEnemies=()=>c.FIELD.enemies;
 const resolve=c.resolveHit;c.resolveHit=()=>({miss:true,dmg:0});
 assert.ok(c.castSkill2(p,c.FIELD.enemies,'vacuumslash','mv-float'));assert.equal(c.SKILL2_RT.grounds.length,0);
 c.SKILL2_RT.vacuumWaves=[];c.resolveHit=resolve;
 assert.ok(c.castSkill2(p,c.FIELD.enemies,'vacuumslash','mv-float'));assert.equal(c.SKILL2_RT.grounds.length,2);
 for(const at of Array.from(c.SKILL2_RT.vacuumWaves,w=>w.at)){c.GT=at;c.sgTickVacuumWaves(ctx);}
 assert.equal(c.SKILL2_RT.grounds.length,2);
 assert.ok(c.castSkill2(p,c.FIELD.enemies,'vacuumslash','mv-float'));assert.equal(c.SKILL2_RT.grounds.length,2);
 c.GT=3;c.sgTickGrounds(3,ctx);assert.equal(c.SKILL2_RT.grounds.length,0);
 assert.ok(c.castSkill2(p,c.FIELD.enemies,'vacuumslash','mv-float'));assert.equal(c.SKILL2_RT.grounds.length,2);
});

test('全場同時最多十五個靜止斬，其他場域不占額度，名額釋出後新舊敵人均可觸發',()=>{
 const {c,p}=setup(false),u=c.sgUlt('vacuumslash','vacuumOmen');
 const other={kind:'other',expiresAt:100};c.SKILL2_RT.grounds.push(other);
 const enemies=Array.from({length:16},(_,i)=>h.enemy(1e9,100+i*20,80,'cap-'+i));
 for(const m of enemies)c.sgSpawnStaticVacuum(p,c.getStats(),u,m,'mv-float',100);
 const fixed=c.SKILL2_RT.grounds.filter(f=>f.kind==='vacuumfield');assert.equal(fixed.length,15);assert.ok(c.SKILL2_RT.grounds.includes(other));
 assert.ok(!fixed.some(f=>f.tgt===enemies[15]),'第十六個因滿場而未生成');
 c.GT=3; // 圓盤已到期，即使模擬回收尚未清掉陣列也不占同時存活額度。
 c.sgSpawnStaticVacuum(p,c.getStats(),u,enemies[15],'mv-float',100);
 assert.equal(c.SKILL2_RT.grounds.filter(f=>f.kind==='vacuumfield'&&f.expiresAt>c.GT).length,1);
 for(const m of enemies.slice(0,15))c.sgSpawnStaticVacuum(p,c.getStats(),u,m,'mv-float',100);
 const live=c.SKILL2_RT.grounds.filter(f=>f.kind==='vacuumfield'&&f.expiresAt>c.GT);
 assert.equal(live.length,15);assert.equal(live.filter(f=>f.tgt===enemies[0]).length,1,'舊敵人的場域結束後可再觸發');
 assert.ok(!live.some(f=>f.tgt===enemies[14]),'名額重新滿場後仍阻擋新生成');
});

test('正式Worker與Runtime同時保留四道環繞斬及十五道靜止斬，結束後同敵人新斬重新顯示',()=>{
 const {c,p,ctx}=setup(false);p.mp=1e6;
 const st=c.getStats();c.getStats=()=>st;
 const enemies=Array.from({length:16},(_,i)=>h.enemy(1e9,p.pos.x+(i?100*Math.cos((i-1)*Math.PI*2/15):40),p.pos.y+(i?100*Math.sin((i-1)*Math.PI*2/15):0),'cast-cap-'+i));
 c.FIELD.enemies=enemies;ctx.getEnemies=()=>enemies;
 const marker={...disc,layers:[{id:'marker',type:'sprite',assetId:'marker'}]},view=adapter(marker);
 const live=()=>c.SKILL2_RT.grounds.filter(f=>f.kind==='vacuumfield'&&f.expiresAt>c.GT);
 assert.ok(c.castSkill2(p,enemies,'vacuumslash','mv-float'));assert.equal(c.SKILL2_RT.orbits.length,4);assert.equal(live().length,15);
 const original=c.shimDrainUrgentVisualEvents().filter(e=>e.variant==='void-disc'&&e.fxKind==='aura');assert.equal(original.length,4);
 c.sgTickGrounds(0,ctx);const fixed=c.shimDrainUrgentVisualEvents().filter(e=>e.area?.staticVacuum);assert.equal(fixed.length,15);
 for(const e of [...original,...fixed])assert.equal(view.rt.tryPlay(e),true);
 view.rt.update(0);assert.equal(view.air.nodes.filter(n=>n.t?.visible).length,4);assert.equal(view.ground.nodes.filter(n=>n.t?.visible).length,15);
 const ids=new Set(fixed.map(e=>e.area.id));view.rt.update(3);
 assert.equal(view.ground.nodes.filter(n=>n.t?.visible).length,0);assert.equal(view.air.nodes.filter(n=>n.t?.visible).length,4);
 c.GT=3;c.sgTickGrounds(3,ctx);c.shimDrainUrgentVisualEvents();assert.equal(live().length,0);
 assert.ok(c.castSkill2(p,enemies,'vacuumslash','mv-float'));c.shimDrainUrgentVisualEvents();c.sgTickGrounds(0,ctx);
 const again=c.shimDrainUrgentVisualEvents().filter(e=>e.area?.staticVacuum);assert.equal(again.length,15);
 again.forEach(e=>{assert.ok(!ids.has(e.area.id));near(e.area.growAge,0);near(e.area.lifeSec,3);assert.equal(view.rt.tryPlay(e),true);});
 assert.equal(live().filter(f=>f.tgt===enemies[0]).length,1);view.rt.update(0);
 assert.equal(view.ground.nodes.filter(n=>n.t?.visible).length,15);assert.equal(view.air.nodes.filter(n=>n.t?.visible).length,4);view.rt.destroy();
});

test('正式技能說明包含同敵人結束後再觸發／十五個上限／不含原始環繞斬',()=>{
 const {c}=setup(false),desc=c.describeSkill2Ult('vacuumslash',0,1);
 assert.match(desc,/同一個敵人.*結束後可再次觸發/);assert.match(desc,/最多同時存在 15 個靜止真空斬/);
 assert.match(desc,/不包含原本圍繞自身的虛空斬/);assert.doesNotMatch(desc,/存活期間最多成功觸發/);
});

test('追蹤風刃沿用原尺寸與空中層，不受靜止斬影響',()=>{
 const p=require('../vfx/presets/ground-homing-wind-crescent.json');
 const {rt,air,ground}=adapter({...p,layers:[{id:'marker',type:'sprite',assetId:'marker'}]});
 rt.tryPlay({fxKind:'aura',variant:'wind-blade-homing',dur:1,area:{id:'moving',x:0,y:0,r:30,speed:180,moveA:0},vfx:{ground:p.id}});
 rt.update(.1);assert.equal(ground.nodes.length,0);near(air.nodes[0].t.x,18);near(air.nodes[0].t.scaleX,.75);assert.equal(air.nodes[0].t.motionAngle,0);rt.destroy();
});
