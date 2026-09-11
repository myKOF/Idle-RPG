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
test('production adapter preserves user-edited appearance and size across launch and homing',()=>{
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({profile:{scale:0.8,areaScale:0.4},core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:240,y:0})}});rt.registerPresets(presets);
 assert.equal(rt.tryPlay({fxKind:'projectile',variant:'ice-arrow-pierce',targets:[],angle:0,lineLength:240,travelMs:[410],vfx:{projectile:presets[0].id,hit:presets[1].id}}),true);rt.update(.1);
 const arrow=nodes.find(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.ok(arrow);assert.ok(arrow.t.x>0&&arrow.t.x<240);
 assert.equal(rt.tryPlay({fxKind:'aura',variant:'ice-arrow-homing',dur:.1,area:{id:'homing',x:100,y:80,r:15,a:0,speed:585,moveA:.7},vfx:{ground:presets[2].id}}),true);rt.update(.05);
 const flying=nodes.filter(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.ok(flying.length>=2);
 const homing=flying.at(-1);assert.equal(homing.t.scaleX,arrow.t.scaleX,'homing preserves launch width'); assert.equal(homing.t.scaleY,arrow.t.scaleY,'homing preserves launch height');
 assert.ok(Math.abs(homing.t.rotation-.7)<1e-6,'arrow uses movement heading, not circular area angle');
 assert.equal(homing.spec.assetUrl,arrow.spec.assetUrl,'both phases use the edited launch asset');
 for(const angle of [Math.PI/2,Math.PI,-Math.PI/2]){
  rt.tryPlay({fxKind:'aura',variant:'ice-arrow-homing',dur:2,area:{id:'homing',x:100,y:80,r:15,a:0,speed:585,moveA:angle},vfx:{ground:presets[2].id}});
  for(let j=0;j<30;j++)rt.update(1/60);
  const delta=Math.atan2(Math.sin(homing.t.rotation-angle),Math.cos(homing.t.rotation-angle));assert.ok(Math.abs(delta)<.05,'turns to each new flight direction');
 }
 rt.update(5);assert.equal(rt.stats().grounds,0);rt.destroy();
});
test('homing arrow points along every rendered displacement during snapshot correction',()=>{
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});// 運動驗證使用中心標記，排除使用者美術圖層偏移；外觀一致性由上方實際 preset 測試驗證。
 rt.registerPresets(presets.map(p=>({...p,layers:p.layers.map(l=>l.id==='faceted-icicle'?{...l,position:{x:0,y:0}}:l)})));
 const send=(x,y,angle,speed=585)=>rt.tryPlay({fxKind:'aura',variant:'ice-arrow-homing',dur:3,area:{id:'turning',x,y,r:15,a:0,speed,moveA:angle},vfx:{ground:presets[2].id}});
 send(0,0,0);rt.update(1/60);
 const arrow=nodes.find(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.ok(arrow);
 for(const [x,y,a] of [[0,18,Math.PI/2],[-15,0,Math.PI],[20,-25,-Math.PI/2],[0,0,Math.PI-.01],[0,0,-Math.PI+.01]]){
  send(x,y,a);
  for(const dt of [1/120,1/60,1/30,.1]){
   const prev={...arrow.t};rt.update(dt);const next=arrow.t,dx=next.x-prev.x,dy=next.y-prev.y;
   assert.ok(Math.hypot(dx,dy)>0);
   const error=Math.atan2(Math.sin(next.rotation-Math.atan2(dy,dx)),Math.cos(next.rotation-Math.atan2(dy,dx)));
   assert.ok(Math.abs(error)<1e-8,'arrow must face frame displacement immediately, including correction');
  }
 }
 const angle=arrow.t.rotation;rt.update(0);assert.equal(arrow.t.rotation,angle,'zero-time update preserves direction');rt.destroy();
});
test('simulation and renderer integrate the same continuous turning arc',()=>{
 const path=require('path'),{createRequire}=require('module');
 const file=path.join(__dirname,'skill2-ice.test.cjs'),src=fs.readFileSync(file,'utf8');
 const ctx={require:createRequire(file),__dirname,console};vm.createContext(ctx);
 vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',ctx);const c=ctx.c;
 const f={kind:'icearrow',pos:{x:0,y:0},speed:100,radius:15,chaseM:30,moveAngle:0,dest:{x:0,y:1000},turnSide:1};
 const r=c.sgGroundTurnRadiusPx(f),step=10;c.sgGroundChaseStep(f,step,[]);
 assert.ok(Math.abs(f.pos.x-r*Math.sin(step/r))<1e-8);assert.ok(Math.abs(f.pos.y-r*(1-Math.cos(step/r)))<1e-8);
 const motion=c.sgGroundMotionFields(f,{});assert.ok(Math.abs(motion.turnRate-100/r)<1e-8);
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});// 運動驗證使用中心標記，排除使用者美術圖層偏移；外觀一致性由上方實際 preset 測試驗證。
 rt.registerPresets(presets.map(p=>({...p,layers:p.layers.map(l=>l.id==='faceted-icicle'?{...l,position:{x:0,y:0}}:l)})));
 rt.tryPlay({fxKind:'aura',variant:'ice-arrow-homing',dur:3,area:{id:'arc',x:0,y:0,r:15,a:0,speed:100,moveA:0,turnRate:motion.turnRate},vfx:{ground:presets[2].id}});
 for(let i=0;i<6;i++)rt.update(1/60);
 const arrow=nodes.find(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);
 assert.ok(Math.abs(arrow.t.x-f.pos.x)<1e-7);assert.ok(Math.abs(arrow.t.y-f.pos.y)<1e-7,'six rendered frames match one simulation arc');
 const prev={...arrow.t};rt.update(1/60);assert.ok(arrow.t.rotation>prev.rotation,'turn continues between snapshots');rt.destroy();
});
