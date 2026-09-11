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
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:999,y:999}),posOf:()=>({x:999,y:999})}});rt.registerPresets([p,hit]);
 assert.equal(rt.tryPlay({fxKind:'projectile',variant:'waterball',targets:[],travelMs:[1000],arcM:8,area:{fixedLanding:true,sourceX:0,sourceY:0,x:320,y:0,r:60},vfx:{projectile:p.id,hit:hit.id}}),true);
 rt.update(.5);const glow=nodes.find(n=>n.spec.assetUrl===p.layers[0].assetId&&n.t?.visible);assert.ok(Math.abs(glow.t.x-160)<1e-6);assert.ok(Math.abs(glow.t.y+80)<1e-6);
 rt.update(.6);assert.equal(rt.stats().projectiles,0);assert.equal(rt.stats().pending,0);rt.destroy();
});
