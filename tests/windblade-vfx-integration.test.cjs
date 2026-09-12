'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
// A centred marker isolates heading from the artwork's own rotation and offsets.
const presets=[{schemaVersion:1,id:'ground-homing-wind-crescent',duration:3,loop:true,layers:[{id:'marker',type:'sprite',assetId:'marker'}]}];

test('小風刃使用大型速度且不將追擊目標當停駐終點',()=>{
 const path=require('path'),{createRequire}=require('module');
 const file=path.join(__dirname,'skill2-ice.test.cjs'),src=fs.readFileSync(file,'utf8');
 const ctx={require:createRequire(file),__dirname,console};vm.createContext(ctx);
 vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',ctx);const c=ctx.c;
 const g=c.SKILLS2.windblade,lvs=[1,0,0,1,1,0,0],geom=c.sgWindbladeGeom(g,lvs,null);
 let cfg;c.sgSpawnGround=(p,st,gid,v)=>cfg=v;
 c.sgSpawnWindChaser({}, {},g,lvs,0,100,geom,'mv-float');assert.equal(cfg.speed,geom.speedPx);
 const motion=c.sgGroundMotionFields({kind:'windblade',pos:{x:0,y:0},speed:geom.speedPx,chaseM:30,moveAngle:0,dest:{x:1,y:0}},{});
 assert.equal(motion.speed,geom.speedPx);assert.equal(motion.destX,undefined);
 let t;const backend={createNode(){return {};},updateNode(n,v){t={...v};},destroyNode(){}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});rt.registerPresets(presets);
 rt.tryPlay({fxKind:'aura',dur:2,area:{id:'fast',x:0,y:0,speed:geom.speedPx,moveA:0,turnRate:0,destX:1,destY:0},vfx:{ground:presets[0].id}});
 for(let i=0;i<60;i++)rt.update(1/60);assert.ok(Math.abs(t.x-geom.speedPx)<1e-6);rt.destroy();
});

test('含位置及航向誤差的快照不造成瞬間左右擺頭',()=>{
 let t;const backend={createNode(){return {};},updateNode(n,v){t={...v};},destroyNode(){}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});rt.registerPresets(presets);
 const send=(x,y,a)=>rt.tryPlay({fxKind:'aura',dur:2,area:{id:'jitter',x,y,speed:180,moveA:a,turnRate:0},vfx:{ground:presets[0].id}});
 send(0,0,0);rt.update(1/60);let prev=t.rotation;
 for(let i=1;i<120;i++){
  if(i%6===0)send(i*3,i%12===0?8:-8,i%12===0?.16:-.16);
  rt.update(1/60);const delta=Math.atan2(Math.sin(t.rotation-prev),Math.cos(t.rotation-prev));
  assert.ok(Math.abs(delta)<.12,'每幀角變化應平滑：'+delta);prev=t.rotation;
 }
 rt.destroy();
});
test('追跡風刃沿每幀實際位移朝向，包含快照修正',()=>{
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});// 運動驗證使用中心標記，排除使用者美術圖層偏移；外觀一致性由上方實際 preset 測試驗證。
 rt.registerPresets(presets.map(p=>({...p,layers:p.layers.map(l=>l.id==='marker'?{...l,position:{x:0,y:0}}:l)})));
 const send=(x,y,angle,speed=585)=>rt.tryPlay({fxKind:'aura',variant:'wind-blade-homing',dur:3,area:{id:'turning',x,y,r:15,a:0,speed,moveA:angle},vfx:{ground:presets[0].id}});
 send(0,0,0);rt.update(1/60);
 const arrow=nodes.find(n=>n.spec.assetUrl==='marker'&&n.t?.visible);assert.ok(arrow);
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
test('風刃模擬與顯示積分相同圓弧並傳遞轉速',()=>{
 const path=require('path'),{createRequire}=require('module');
 const file=path.join(__dirname,'skill2-ice.test.cjs'),src=fs.readFileSync(file,'utf8');
 const ctx={require:createRequire(file),__dirname,console};vm.createContext(ctx);
 vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',ctx);const c=ctx.c;
 const f={kind:'windblade',pos:{x:0,y:0},speed:100,radius:15,chaseM:30,moveAngle:0,dest:{x:0,y:1000},turnSide:1};
 const r=c.sgGroundTurnRadiusPx(f),step=10;c.sgGroundChaseStep(f,step,[]);
 assert.ok(Math.abs(f.pos.x-r*Math.sin(step/r))<1e-8);assert.ok(Math.abs(f.pos.y-r*(1-Math.cos(step/r)))<1e-8);
 const motion=c.sgGroundMotionFields(f,{});assert.ok(Math.abs(motion.turnRate-100/r)<1e-8);
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});// 運動驗證使用中心標記，排除使用者美術圖層偏移；外觀一致性由上方實際 preset 測試驗證。
 rt.registerPresets(presets.map(p=>({...p,layers:p.layers.map(l=>l.id==='marker'?{...l,position:{x:0,y:0}}:l)})));
 rt.tryPlay({fxKind:'aura',variant:'wind-blade-homing',dur:3,area:{id:'arc',x:0,y:0,r:15,a:0,speed:100,moveA:0,turnRate:motion.turnRate},vfx:{ground:presets[0].id}});
 for(let i=0;i<6;i++)rt.update(1/60);
 const arrow=nodes.find(n=>n.spec.assetUrl==='marker'&&n.t?.visible);
 assert.ok(Math.abs(arrow.t.x-f.pos.x)<1e-7);assert.ok(Math.abs(arrow.t.y-f.pos.y)<1e-7,'six rendered frames match one simulation arc');
 const prev={...arrow.t};rt.update(1/60);assert.ok(arrow.t.rotation>prev.rotation,'turn continues between snapshots');rt.destroy();
});
