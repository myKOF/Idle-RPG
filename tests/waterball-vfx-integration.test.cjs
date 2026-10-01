'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
const p=require('../vfx/presets/proj-waterball-flow.json'),hit=require('../vfx/presets/hit-waterball-splash.json');
// 運動座標用中心標記，正式圖層可包含偏移／隨機變形；下方實際Preset案例另驗證外觀。
function motionPreset(){return {schemaVersion:1,id:p.id,duration:1,loop:true,layers:[{id:'centre',type:'sprite',assetId:'test-centre.png'}]};}

function waterScenario(stage,legend,ult){
 const file=path.join(__dirname,'skill2-waterball-frostnova-legendary.test.cjs'),src=fs.readFileSync(file,'utf8');
 const h={require:require('module').createRequire(file),__dirname,console};vm.createContext(h);
 vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',h);const c=h.c;
 for(const gid of ['icearrow','waterball','frostnova']){h.maxLevels(c,gid);h.setUlt(c,gid,c.SKILLS2[gid].ult[0].id,1);}
 h.setLevels(c,'waterball',Array.from({length:7},(_,i)=>i<stage?10:0));
 if(ult)h.setUlt(c,'waterball',ult,1);else delete c.G.player.skills2.ult.waterball;
 h.equip(c,'waterball');h.setLegendary(c,legend?['waterballNovaBurst']:[]);c.Math.random=()=>.999;c.chance=()=>false;
 const p=h.playerEnt();p.pos={x:0,y:0};p.mp=10000;c.FIELD.player=p;
 const es=[h.enemy(1e9,40,0,'A'),h.enemy(1e9,80,0,'B'),h.enemy(1e9,-40,0,'C')];
 const hits=h.stubHits(c),specs=h.stubVfx(c);return {h,c,p,es,hits,specs};
}

test('WATERBALL-NOVA: all tiers and evolutions without the legendary keep water splashes and never render a nova',()=>{
 for(const [stage,ult] of [...Array.from({length:7},(_,i)=>[i+1,null]),...['waterPrisonFall','ragingTide','abyssBurial'].map(id=>[7,id])]){
  const {h,c,p,es,hits,specs}=waterScenario(stage,false,ult);
  assert.ok(c.castSkill2(p,es,'waterball','mv-float'));h.advance(c,p,es,1.6);assert.ok(hits.length);
  const impacts=specs.filter(s=>s.variant==='water-impact');assert.ok(impacts.length);
  assert.ok(impacts.every(s=>s.vfx.hit===hit.id));
  assert.ok(!specs.some(s=>s.variant==='frost-nova'||Object.values(s.vfx||{}).includes('burst-frost-nova')),
   stage+'/'+ult+' 未裝配傳奇時不能在水彈落地播新星');
  if(stage===7)assert.ok(specs.some(s=>s.variant==='water-tornado'),'四道水龍捲保留');
  const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t=t;},destroyNode(n){n.t=null;}};
  const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,
   ctx:{playerPos:()=>p.pos,posOf:id=>es.find(e=>e.name===id)?.pos||p.pos}});
  rt.registerPresets(['proj-waterball-flow','hit-waterball-splash','burst-frost-nova','burst-frost-freeze','field-water-tornado','ground-blizzard'].map(id=>require('../vfx/presets/'+id+'.json')));
  specs.forEach(s=>rt.tryPlay(s));rt.update(.1);
  assert.ok(nodes.some(n=>n.spec.assetUrl==='particle-pack/png-black-background/light_03.png'),'正式水花仍播放');
  assert.ok(!nodes.some(n=>n.spec.assetUrl==='new_materials/impact-ring/impact_14.png'),'不建立新星衝擊波');rt.destroy();
 }
});

test('WATERBALL-NOVA: legendary conversion alone borrows configured base nova without importing its high tiers',()=>{
 const {h,c,p,es,specs,hits}=waterScenario(7,true);
 c.SKILLS2.frostnova.tiers[0].vfx.attack='custom-base-nova';
 c.SKILLS2.frostnova.tiers[3].vfx.attack='wrong-high-tier';
 c.SKILLS2.frostnova.ult[0].vfx={attack:'wrong-evolution'};
 c.SKILLS2.waterball.tiers[3].triggerVfx.attack='ordinary-water-burst';
 assert.ok(c.castSkill2(p,es,'waterball','mv-float'));h.advance(c,p,es,.1);
 const bursts=specs.filter(s=>s.variant==='frost-nova');assert.ok(bursts.length);
 assert.ok(bursts.every(s=>s.vfx.attack==='custom-base-nova'&&s.area.r===78));
 assert.ok(!specs.some(s=>Object.values(s.vfx||{}).some(id=>/wrong-|ordinary-water-burst/.test(id))));
 assert.ok(hits.length);assert.equal(hits[0].atk,2000,'轉換只改形態與範圍，水彈傷害仍讀自己的400%魔攻');
 assert.equal(h.frostStacks(es[0]),2);assert.ok(!c.SKILL2_RT.grounds.some(f=>f.kind==='blizzard'));
});

test('WATERBALL-NOVA: ordinary trigger remains editable and empty legendary base never falls back to it',()=>{
 const normal=waterScenario(4,false);normal.c.SKILLS2.waterball.tiers[3].triggerVfx={attack:'custom-water-burst'};
 normal.c.castSkill2(normal.p,normal.es,'waterball','mv-float');normal.h.advance(normal.c,normal.p,normal.es,.1);
 assert.equal(normal.specs.find(s=>s.variant==='water-burst').vfx.attack,'custom-water-burst');
 const legendary=waterScenario(4,true);legendary.c.SKILLS2.waterball.tiers[3].triggerVfx={attack:'custom-water-burst'};
 legendary.c.SKILLS2.frostnova.tiers[0].vfx={};
 legendary.c.castSkill2(legendary.p,legendary.es,'waterball','mv-float');legendary.h.advance(legendary.c,legendary.p,legendary.es,.1);
 assert.ok(legendary.specs.filter(s=>s.variant==='frost-nova').every(s=>!s.vfx.attack));
 assert.ok(!legendary.specs.some(s=>Object.values(s.vfx||{}).includes('custom-water-burst')));
 assert.ok(legendary.specs.some(s=>s.variant==='water-impact'&&s.vfx.hit===hit.id));
});

test('WATERBALL-NOVA: real legendary nova survives the Worker whitelist and renders only after landing',()=>{
 const {h,c,p,es,specs}=waterScenario(7,true);
 c.castSkill2(p,es,'waterball','mv-float');assert.ok(!specs.some(s=>s.variant==='frost-nova'));
 h.advance(c,p,es,.1);const burst=specs.find(s=>s.variant==='frost-nova');assert.ok(burst);
 assert.deepEqual({...burst.vfx},{attack:'burst-frost-nova'});assert.equal(burst.area.x,40);assert.equal(burst.area.r,78);
 const shim={};shim.self=shim;vm.createContext(shim);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/worker/shim.js'),'utf8'),shim);
 shim.playCombatVfx(burst);const event=JSON.parse(JSON.stringify(shim.shimDrainUrgentVisualEvents()[0]));
 assert.equal(event.area.r,78);assert.equal(event.vfx.attack,'burst-frost-nova');
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t=t;},destroyNode(n){n.t=null;}};
 const starts=[],observedCore={...Core,createRuntime(opts){const actual=Core.createRuntime(opts);return {...actual,
  play(id,params){starts.push({id,position:{...params.position}});return actual.play(id,params);}};}};
 const rt=Runtime.create({core:observedCore,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,
  ctx:{playerPos:()=>p.pos,posOf:id=>es.find(e=>e.name===id)?.pos||p.pos}});
 rt.registerPresets(['burst-frost-nova','ground-blizzard'].map(id=>require('../vfx/presets/'+id+'.json')));
 assert.equal(rt.tryPlay(event),true);rt.update(.1);
 const shockwaves=nodes.filter(n=>n.spec.assetUrl==='new_materials/impact-ring/impact_14.png'&&n.t?.visible);
 assert.ok(shockwaves.length);
 // 作者圖層有shake；定位驗證核對正式Core收到的根座標，不把抖動後的精靈誤認為落點。
 assert.deepEqual(starts.filter(s=>s.id==='burst-frost-nova').map(s=>s.position),[{x:40,y:0}]);
 assert.equal(rt.stats().grounds,0,'不由傳奇代放冰霜新星第7階暴風雪');rt.update(2);rt.destroy();
});

test('WATERBALL-SIZE: both landing rings fit the actual normal and legendary bounce radii throughout playback',()=>{
 // circle_02為512px黑底貼圖；唯讀像素量測的光圈本體外緣約190px，排除黑底與極淡雜訊。
 const bodyRadius=190;
 for(const legendary of [false,true]){
  const {h,c,p,es,specs}=waterScenario(4,legendary);
  assert.ok(c.castSkill2(p,es,'waterball','mv-float'));h.advance(c,p,es,1.6);
  const impacts=specs.filter(s=>s.variant==='water-impact');assert.ok(impacts.length>1,'涵蓋第一次落地與後續彈射');
  for(const spec of impacts){
   assert.equal(spec.area.r,legendary?78:60,'權威傷害半徑不可為配合光圈而縮小');
   const nodes=[],backend={createNode(s){const n={spec:s};nodes.push(n);return n;},
    updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
   const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,
    ctx:{playerPos:()=>p.pos,posOf:()=>({x:999,y:999})}});
   rt.registerPresets([hit]);assert.equal(rt.tryPlay(spec),true);
   let maxRadius=0;const observedRings=new Set();
   for(let frame=0;frame<170;frame++){
    rt.update(.005);
    for(const n of nodes.filter(n=>n.spec.assetUrl.endsWith('/circle_02.png')&&n.t?.visible&&n.t.alpha>0)){
     observedRings.add(n);const t=n.t,radius=bodyRadius*Math.abs(t.scaleX);maxRadius=Math.max(maxRadius,radius);
     assert.equal(t.x,spec.area.x);assert.equal(t.y,spec.area.y);
     assert.ok(Math.abs(t.scaleY/t.scaleX-.5)<1e-9,'光圈保持原地板投影');
     assert.ok(radius<=spec.area.r+.01,`光圈${radius}超出傷害半徑${spec.area.r}`);
    }
   }
   assert.equal(observedRings.size,2,'內外兩層光圈都實際播放');
   assert.ok(maxRadius>=spec.area.r*.985,'擴張應抵達判定邊界附近');rt.destroy();
  }
 }
});

test('waterball and bounce use approved effects and 15% faster shared travel timing',()=>{
 const file=path.join(__dirname,'skill2-ice.test.cjs'),src=fs.readFileSync(file,'utf8'),c={require:require('module').createRequire(file),__dirname,console};vm.createContext(c);vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',c);const game=c.c;
 assert.equal(game.SKILLS2.waterball.tiers[0].fx.speed,57.96);
 for(const tier of [0,3]){assert.equal(game.SKILLS2.waterball.tiers[tier].vfx.projectile,p.id);assert.equal(game.SKILLS2.waterball.tiers[tier].vfx.hit,hit.id);}
 const target={hp:100,pos:{x:200,y:0}};
 assert.ok(Math.abs(game.sgConfiguredTravelSeconds('waterball',target)-game.bfTravelSeconds(target)/1.15)<1e-9);
});
test('waterball follows table-driven arc and tangent, including bounce origin, then releases nodes',()=>{
 const p=motionPreset();
 for(const bounce of [false,true]){
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:id=>id==='from'?{x:0,y:0}:{x:320,y:0}}});rt.registerPresets([p,hit]);
 assert.equal(rt.tryPlay({fxKind:bounce?'chain':'projectile',variant:bounce?'water-bounce':'waterball',targets:bounce?['from','to']:['to'],travelMs:bounce?[0,1000]:[1000],arcM:8,vfx:{projectile:p.id,hit:hit.id}}),true);
 rt.update(.5);const glow=nodes.find(n=>n.spec.assetUrl===p.layers[0].assetId&&n.t?.visible);assert.ok(glow);assert.ok(Math.abs(glow.t.x-160)<1e-6);assert.ok(Math.abs(glow.t.y+80)<1e-6,'8 metres above chord');assert.ok(Math.abs(glow.t.rotation)<1e-6,'tangent horizontal at apex');
 rt.update(.25);assert.ok(glow.t.rotation>0,'faces down along landing arc');rt.update(2);assert.equal(rt.stats().projectiles,0);rt.destroy();
 }
});

test('fixed landing damages current occupants only and bounces from the ground impact',()=>{
 const file=path.join(__dirname,'skill2-ice.test.cjs'),src=fs.readFileSync(file,'utf8'),box={require:require('module').createRequire(file),__dirname,console};vm.createContext(box);vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',box);const c=box.c;
 const pEnt={hp:100,pos:{x:0,y:0}},a={hp:100,pos:{x:100,y:0}},b={hp:100,pos:{x:250,y:0}},pool=[a,b],hits=[],events=[],out={dmg:0};
 c.sgEmitVfx=(...args)=>events.push(args[3]);c.sgWaterballHit=(p,s,t,cfg,f,o)=>{hits.push(t);o.dmg+=10;return {};};c.bfRandomOther=()=>b;
 const cfg={delayMs:0,bounces:1,burstR:60,arcM:8,bounceSpeed:1};c.GT=0;c.sgWaterballShot(pEnt,{},null,null,pool,a,'mv',out,cfg);
 assert.equal(hits.length,0);assert.equal(events[0].area.x,100);assert.equal(events[0].area.fixedLanding,true);
 a.pos.x=500;b.pos.x=110;const shot=c.SKILL2_RT.waterballs[0];c.GT=shot.at;c.sgTickWaterballs({pEnt,enemies:pool});
 assert.deepEqual(hits,[b]);assert.equal(events[1].area.x,100);assert.equal(events[2].area.sourceX,100);assert.equal(events[2].area.x,110);
 b.pos.x=500;const newcomer={hp:100,pos:{x:115,y:0}};c.GT=shot.at;c.sgTickWaterballs({pEnt,enemies:[a,b,newcomer]});
 assert.deepEqual(hits,[b,newcomer]);assert.equal(c.SKILL2_RT.waterballs.length,0);assert.equal(out._pendingProjectiles,0);
 c.bfRandomOther=()=>null;a.pos.x=200;c.sgWaterballShot(pEnt,{},null,null,pool,a,'mv',out,{...cfg,bounces:0});
 a.hp=0;c.GT=c.SKILL2_RT.waterballs[0].at;c.sgTickWaterballs({pEnt,enemies:[]});
 assert.equal(hits.length,2,'empty ground hit never forces damage onto the original target');assert.equal(events.at(-1).area.x,200,'still splashes at the locked coordinate after target dies');
 assert.equal(c.SKILL2_RT.waterballs.length,0);assert.equal(out._pendingProjectiles,0);
});
test('fixed ground projectile ignores target movement and does not emit early splash',()=>{
 const p=motionPreset();
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:999,y:999}),posOf:()=>({x:999,y:999})}});rt.registerPresets([p,hit]);
 assert.equal(rt.tryPlay({fxKind:'projectile',variant:'waterball',targets:[],travelMs:[1000],arcM:8,area:{fixedLanding:true,sourceX:0,sourceY:0,x:320,y:0,r:60},vfx:{projectile:p.id,hit:hit.id}}),true);
 rt.update(.5);const glow=nodes.find(n=>n.spec.assetUrl===p.layers[0].assetId&&n.t?.visible);assert.ok(Math.abs(glow.t.x-160)<1e-6);assert.ok(Math.abs(glow.t.y+80)<1e-6);
 rt.update(.6);assert.equal(rt.stats().projectiles,0);assert.equal(rt.stats().pending,0);rt.destroy();
});

test('real Worker shim preserves arc height and rendered water body pitches up then down',()=>{
 const shim={};shim.self=shim;vm.createContext(shim);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/worker/shim.js'),'utf8'),shim);
 shim.playCombatVfx({fxKind:'projectile',variant:'waterball',targets:[],travelMs:[1000],arcM:8,area:{fixedLanding:true,sourceX:0,sourceY:0,x:320,y:0,r:60},vfx:{projectile:p.id,hit:hit.id}});
 const event=JSON.parse(JSON.stringify(shim.shimDrainUrgentVisualEvents()[0]));assert.equal(event.arcM,8);
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:999,y:999})}});rt.registerPresets([p,hit]);assert.equal(rt.tryPlay(event),true);
 rt.update(.25);const body=nodes.filter(n=>n.spec.assetUrl==='new_materials/orb/sphere_28.png'&&n.t?.visible).at(-1);assert.ok(body);assert.ok(Math.abs(body.t.rotation-Math.atan2(-160,320))<1e-6,'nose points up while rising');
 rt.update(.25);assert.ok(Math.abs(body.t.rotation)<1e-6,'level at apex');rt.update(.25);assert.ok(Math.abs(body.t.rotation-Math.atan2(160,320))<1e-6,'nose points down while falling');rt.destroy();
 for(const arcM of [0,-1,Infinity,NaN]){shim.playCombatVfx({arcM});assert.equal(shim.shimDrainUrgentVisualEvents()[0].arcM,undefined);}
});
