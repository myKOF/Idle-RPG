'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
const dome=require('../vfx/presets/field-water-prison-dome.json');
test('WATER-DOME: editable preset keeps all layers in one root group',()=>{
 const LS=require('../tools/vfx/editor/layout-schema.js'),layout=require('../vfx/layouts/field-water-prison-dome.json');
 assert.equal(LS.validateLayout(layout).ok,true);
 const rows=LS.reconcile(dome.layers,layout).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].kind,'group');
 assert.equal(layout.groups[0].name,dome.id);
 assert.equal(rows[0].layerIds.length,dome.layers.length);
});
function backend(nodes){return {createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};}

test('WATER-DOME: real preset splits floor and translucent shell, follows radius/feet and releases both',()=>{
 const floors=[],shells=[],old=global.statusVfxPreset;
 global.statusVfxPreset=sid=>sid==='sgWaterPrisonDomain'?dome.id:'';
 let feet={x:100,y:200};
 const rt=Runtime.create({core:Core,profile:{scale:1,areaScale:1},resolver:{resolve:id=>id},fxBackend:backend([]),zoneBackend:backend(floors),billboardBackend:backend(shells),ctx:{playerPos:()=>feet,posOf:()=>feet,footOf:()=>feet}});
 try {
  assert.equal(Core.validatePreset(dome).ok,true);
  rt.registerPresets([dome]);
  rt.syncStatuses([{key:'p',sids:['sgWaterPrisonDomain'],radii:{sgWaterPrisonDomain:200}}]);rt.update(.1);
  const shell=shells.find(n=>n.spec.assetUrl===dome.layers[2].assetId&&n.t?.visible);
  assert.ok(shell,'透明罩子在獨立的角色前方 billboard 層');
  assert.equal(shells.length,1);assert.equal(floors.length,2);
  assert.equal(shell.spec.blendMode,'normal');assert.ok(shell.t.alpha>0&&shell.t.alpha<1);
  assert.ok(Math.abs(shell.t.scaleX*116-200)<.001,'足跡半徑與權威20米一致');
  assert.ok(Math.abs(shell.t.y+shell.t.scaleY*62-feet.y)<.001,'足跡中心錨定腳底');
  const before={x:shell.t.x,y:shell.t.y};feet={x:140,y:260};rt.update(.1);
  assert.equal(shell.t.x-before.x,40);assert.ok(Math.abs(shell.t.y-before.y-60)<1e-6);
  for(let i=0;i<30;i++){
   rt.syncStatuses([{key:'p',sids:['sgWaterPrisonDomain'],radii:{sgWaterPrisonDomain:100}}]);rt.update(.1);
  }
  assert.ok(Math.abs(shell.t.scaleX*116-100)<.001,'範圍改變時罩子跟著縮放');
  rt.syncStatuses([]);rt.update(.01);assert.ok([...floors,...shells].every(n=>!n.t||!n.t.visible),'到期／卸下下一畫格整組隱藏回收');
  assert.equal(rt.stats().auras,0);
  assert.equal(rt.stats().zone.activeEffects+rt.stats().billboard.activeEffects,0);
 }finally{rt.destroy();global.statusVfxPreset=old;}
});

test('WATER-ARC: authoritative launch heights survive Worker and real Runtime at 5m/20m and faster bounce',()=>{
 const file=path.join(__dirname,'skill2-ice.test.cjs'),src=fs.readFileSync(file,'utf8'),box={require:require('node:module').createRequire(file),__dirname,console};vm.createContext(box);vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',box);const c=box.c;
 const shim={};shim.self=shim;vm.createContext(shim);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/worker/shim.js'),'utf8'),shim);
 c.sgEmitVfx=(g,t,s,e)=>shim.playCombatVfx({...e,vfx:{projectile:'water-centre'}});
 assert.equal(c.statusVfxPreset('sgWaterPrisonDomain','aura'),dome.id,'罩子從狀態配置表取用');
 assert.equal(c.statusVfxPreset('sgAbyssDomain','aura'),'ground-domain-ice','海淵共用特效維持原來源');
 const centre={schemaVersion:1,id:'water-centre',duration:1,loop:true,layers:[{id:'centre',type:'sprite',assetId:'centre.png'}]};
 for(const [distance,bounced] of [[50,false],[200,false],[200,true]]){
  c.GT=0;const shot={pEnt:{pos:{x:-80,y:20}},target:{pos:{x:-80+distance,y:20}},origin:bounced?{x:-80,y:20}:null,bounced,cfg:{arcM:999,bounceSpeed:2,burstR:60}};
  c.sgLaunchWaterball(shot);
  const event=JSON.parse(JSON.stringify(shim.shimDrainUrgentVisualEvents()[0]));
  assert.equal(event.arcM,distance/40);
  assert.equal(event.travelMs[0],Math.max(1,Math.round(distance/(579.6*(bounced?2:1))*1000)),'原速度及彈射速度加成保留');
  const nodes=[],rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend(nodes),zoneBackend:backend(nodes),ctx:{playerPos:()=>({x:999,y:999}),posOf:()=>({x:999,y:999})}});
  try{rt.registerPresets([centre]);assert.equal(rt.tryPlay(event),true);rt.update(event.travelMs[0]/2000);
   const n=nodes.find(n=>n.t?.visible);assert.ok(n);
   assert.ok(Math.abs(n.t.x-(-80+distance/2))<1e-6);
   assert.ok(Math.abs(n.t.y-(20-distance/4))<1e-6,'真正畫出的最高點為距離四分之一');
  }finally{rt.destroy();}
 }
});
