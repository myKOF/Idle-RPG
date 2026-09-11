'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
const presets=['proj-icearrow-frost','hit-icearrow-shatter','ground-icearrow-frost'].map(id=>require('../vfx/presets/'+id+'.json'));
test('icearrow ordinary, piercing, homing and rain mappings ship all approved assets',()=>{
 const src=fs.readFileSync(require.resolve('../js/skills2.js'),'utf8'),start=src.indexOf('var SKILLS2 ='),c={};vm.createContext(c);vm.runInContext(src.slice(start,start+src.slice(start).indexOf('\n};')+3),c);
 const g=c.SKILLS2.icearrow;
 for(const row of [g.tiers[0],g.tiers[3],g.ult[2]]){assert.equal(row.vfx.projectile,presets[0].id);assert.equal(row.vfx.hit,presets[1].id);}
 assert.equal(g.tiers[4].vfx.ground,presets[2].id);assert.equal(g.tiers[0].fx.speed,58.5);
 const shipped=require('../vfx/shipped-assets.json').assets;
 for(const p of presets)for(const l of p.layers){const a=shipped.find(a=>a.assetId===l.assetId);assert.ok(a,l.assetId);assert.ok(fs.existsSync(require('path').join(__dirname,'../images/vfx/assets',a.relativePath)));}
});
test('production adapter renders moving icicles and maintains homing aspect ratio',()=>{
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:240,y:0})}});rt.registerPresets(presets);
 assert.equal(rt.tryPlay({fxKind:'projectile',variant:'ice-arrow-pierce',targets:[],angle:0,lineLength:240,travelMs:[410],vfx:{projectile:presets[0].id,hit:presets[1].id}}),true);rt.update(.1);
 const arrow=nodes.find(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.ok(arrow);assert.ok(arrow.t.x>0&&arrow.t.x<240);
 assert.equal(rt.tryPlay({fxKind:'aura',variant:'ice-arrow-homing',dur:.1,area:{id:'homing',x:100,y:80,r:15,a:0,speed:585,moveA:.7},vfx:{ground:presets[2].id}}),true);rt.update(.05);
 const flying=nodes.filter(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.ok(flying.length>=2);
 const homing=flying.at(-1);assert.ok(Math.abs(homing.t.scaleX-homing.t.scaleY)<1e-6,'uniform sizing preserves sharp icicle shape');
 assert.ok(Math.abs(homing.t.rotation-.7)<1e-6,'arrow uses movement heading, not circular area angle');
 assert.ok(Math.abs(homing.t.scaleX-(.1523*2*15/34))<1e-5,'homing arrow is twice the previous visual size');
 for(const angle of [Math.PI/2,Math.PI,-Math.PI/2]){
  rt.tryPlay({fxKind:'aura',variant:'ice-arrow-homing',dur:2,area:{id:'homing',x:100,y:80,r:15,a:0,speed:585,moveA:angle},vfx:{ground:presets[2].id}});
  for(let j=0;j<30;j++)rt.update(1/60);
  const delta=Math.atan2(Math.sin(homing.t.rotation-angle),Math.cos(homing.t.rotation-angle));assert.ok(Math.abs(delta)<.05,'turns to each new flight direction');
 }
 rt.update(5);assert.equal(rt.stats().grounds,0);rt.destroy();
});
