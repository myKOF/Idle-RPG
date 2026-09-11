'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
const p=require('../vfx/presets/proj-waterball-flow.json'),hit=require('../vfx/presets/hit-waterball-splash.json');
test('waterball and bounce use approved effects and 15% faster shared travel timing',()=>{
 const file=path.join(__dirname,'skill2-ice.test.cjs'),src=fs.readFileSync(file,'utf8'),c={require:require('module').createRequire(file),__dirname,console};vm.createContext(c);vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',c);const game=c.c;
 assert.equal(game.SKILLS2.waterball.tiers[0].fx.speed,57.96);
 for(const tier of [0,3]){assert.equal(game.SKILLS2.waterball.tiers[tier].vfx.projectile,p.id);assert.equal(game.SKILLS2.waterball.tiers[tier].vfx.hit,hit.id);}
 const target={hp:100,pos:{x:200,y:0}};
 assert.ok(Math.abs(game.sgConfiguredTravelSeconds('waterball',target)-game.bfTravelSeconds(target)/1.15)<1e-9);
});
test('waterball follows table-driven arc and tangent, including bounce origin, then releases nodes',()=>{
 for(const bounce of [false,true]){
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:id=>id==='from'?{x:0,y:0}:{x:320,y:0}}});rt.registerPresets([p,hit]);
 assert.equal(rt.tryPlay({fxKind:bounce?'chain':'projectile',variant:bounce?'water-bounce':'waterball',targets:bounce?['from','to']:['to'],travelMs:bounce?[0,1000]:[1000],arcM:8,vfx:{projectile:p.id,hit:hit.id}}),true);
 rt.update(.5);const glow=nodes.find(n=>n.spec.assetUrl===p.layers[0].assetId&&n.t?.visible);assert.ok(glow);assert.ok(Math.abs(glow.t.x-160)<1e-6);assert.ok(Math.abs(glow.t.y+80)<1e-6,'8 metres above chord');assert.ok(Math.abs(glow.t.rotation)<1e-6,'tangent horizontal at apex');
 rt.update(.25);assert.ok(glow.t.rotation>0,'faces down along landing arc');rt.update(2);assert.equal(rt.stats().projectiles,0);rt.destroy();
 }
});
