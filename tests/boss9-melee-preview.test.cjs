'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../tools/boss9-lizard/melee/controller.js'),spec=require('../tools/boss9-lizard/melee/spec.json');
const target=(z,x=spec.axisX)=>({id:'player',x,z,y:spec.ground,radius:.18,height:.95});
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
test('shared animation notifies validate and phase boundaries are half-open',()=>{
 api.validate(spec);assert.equal(api.phaseAt(spec,.49999),'Windup');assert.equal(api.phaseAt(spec,.5),'Active');assert.equal(api.phaseAt(spec,1.5),'Recovery');assert.equal(api.phaseAt(spec,2.4),'Idle');
 const bad=structuredClone(spec);bad.notifies.find(e=>e.name==='HitboxOff').time=1.6;assert.throws(()=>api.validate(bad));
 const landing=structuredClone(spec);landing.notifies.find(e=>e.name==='RightClawPlant').time=1.4;assert.throws(()=>api.validate(landing));
});
test('no windup movement or damage; early Active still has no hitbox',()=>{
 const a=new api.Attack(spec,{targets:[target(1.57)]});const w=a.advanceTo(.5);close(w.actualDistance,0);assert.equal(w.hits.length,0);assert.equal(w.hitbox,false);
 const early=a.advanceTo(1.119999);assert.equal(early.hits.length,0);assert.equal(early.hitbox,false);
});
test('peak enables one physical hit and the low point disables before landing',()=>{
 const a=new api.Attack(spec,{targets:[target(1.8)]});const on=a.advanceTo(1.12);assert.equal(on.hitbox,true);assert.equal(on.hits.length,0);a.advanceTo(1.48);assert.equal(a.hits.length,1);assert.equal(a.hits[0].damageType,'physical');
 const off=a.advanceTo(1.5);assert.equal(off.hitbox,false);assert.equal(off.phase,'Recovery');a.advanceTo(2.4);assert.equal(a.hits.length,1);assert.equal(a.targets[0].hp,75);
 const landing=a.events.find(e=>e.name==='RightClawPlant');assert.ok(landing.time>spec.hitbox.off);
});
test('a target entering during Recovery is never damaged',()=>{
 const a=new api.Attack(spec,{targets:[target(5)]});a.advanceTo(1.5);a.moveTarget('player',{z:1});a.advanceTo(2.4);assert.equal(a.hits.length,0);
});
test('skipping the whole clip preserves the exact notify sequence and single hit',()=>{
 const a=new api.Attack(spec,{targets:[target(1.8)]});const done=a.advanceTo(2.4);assert.deepEqual(done.events,spec.notifies);assert.equal(done.hits.length,1);assert.ok(done.hits[0].time>=1.12&&done.hits[0].time<1.5);assert.equal(done.hitbox,false);
 a.advanceTo(100);assert.equal(a.hits.length,1);assert.equal(a.events.length,spec.notifies.length);
});
test('30/60/144 FPS and a single seek agree on movement and hit count',()=>{
 const results=[];for(const fps of [30,60,144]){const a=new api.Attack(spec,{targets:[target(1.8)]});for(let t=0;t<2.4;t+=1/fps)a.advanceTo(t);results.push(a.advanceTo(2.4));}
 const one=new api.Attack(spec,{targets:[target(1.8)]}).advanceTo(2.4);for(const r of results){assert.equal(r.hits.length,one.hits.length);close(r.actualDistance,one.actualDistance,1e-6);close(r.targets[0].z,one.targets[0].z,1e-6);}
});
test('120 degree sector includes capsule edges and excludes back/range/height',()=>{
 const origin={x:0,z:0},face={x:0,z:1},h=spec.hitbox;
 assert.ok(api.sectorTouchesCapsule(origin,face,h,target(1,0)));
 assert.equal(api.sectorTouchesCapsule(origin,face,h,target(-1,0)),false);
 assert.equal(api.sectorTouchesCapsule(origin,face,h,target(3,0)),false);
 assert.equal(api.sectorTouchesCapsule(origin,face,h,{...target(1,0),y:4}),false);
 const angle=65*Math.PI/180;assert.ok(api.sectorTouchesCapsule(origin,face,h,{...target(Math.cos(angle),Math.sin(angle)),radius:.15}));
 const outside=80*Math.PI/180;assert.equal(api.sectorTouchesCapsule(origin,face,h,{...target(Math.cos(outside),Math.sin(outside)),radius:.08}),false);
});
test('continuous capsule sweep cannot tunnel even with a huge displacement',()=>{
 const a={x:0,z:0,y:0,radius:.4,height:1.25},b={...target(1,0),y:0};
 const m=api.sweepCapsule(a,{x:0,z:100},[b],.005);assert.ok(m.z<.421&&m.z>.4);assert.ok(api.capsuleGap({...a,...m},b)>=.005-1e-7);
 const high={...b,y:4};close(api.sweepCapsule(a,{x:0,z:100},[high]).z,100);
});
test('oblique and cap-to-cap contact block at the expanded capsule boundary',()=>{
 const a={x:0,z:0,y:0,radius:.4,height:1},b={id:'b',x:1,z:1,y:.7,radius:.2,height:1};
 const m=api.sweepCapsule(a,{x:2,z:2},[b]);assert.ok(m.fraction<1);assert.ok(api.capsuleGap({...a,...m},b)>-1e-7);
});
test('blocked pounce never overlaps and never catches up blocked distance',()=>{
 const a=new api.Attack(spec,{targets:[target(1.57)]});let minGap=Infinity;
 for(let t=0;t<=2.401;t+=1/120){a.advanceTo(Math.min(2.4,t));minGap=Math.min(minGap,api.capsuleGap(a.body(),a.targets[0]));}
 const s=a.advanceTo(2.4);assert.ok(s.blockedDistance>.01);assert.ok(s.actualDistance<spec.rootMotion.distance);assert.ok(minGap>=.005-1e-7);assert.equal(s.hits.length,1);
 const z=s.position.z;a.advanceTo(4);close(a.position.z,z);
});
test('knockback is outward, smooth, finite and uses physical preview parameters',()=>{
 const a=new api.Attack(spec,{targets:[target(1.8)]});for(let t=1.12;!a.hits.length;t+=1/240)a.advanceTo(t);const start=a.time,z=a.targets[0].z;a.advanceTo(start+.01);assert.ok(a.targets[0].z>z&&a.targets[0].z<z+.1);a.advanceTo(start+.25);assert.ok(a.targets[0].z-z>.23&&a.targets[0].z-z<=.24);
 assert.ok(a.hits[0].knockback.z>0);assert.throws(()=>a.advanceTo(NaN));assert.throws(()=>a.advanceTo(.5));
});
test('rotating the actor rotates its reach and root motion',()=>{
 const a=new api.Attack(spec,{facing:{x:1,z:0},position:{x:0,z:0,y:spec.ground},targets:[{...target(0,1.8)}]});const s=a.advanceTo(2.4);close(s.position.x,.35);close(s.position.z,0);assert.equal(s.hits.length,1);
});
test('dynamic reach grows with the slash and rejects malformed collision settings',()=>{
 close(api.hitboxAt(spec,1.12).range,.35);close(api.hitboxAt(spec,1.42).range,1.5);
 assert.ok(api.hitboxAt(spec,1.27).range>.35&&api.hitboxAt(spec,1.27).range<1.5);
 for(const [group,key,value] of [['hitbox','fullReachAt',1.12],['hitbox','range',NaN],['bossCapsule','height',.1],['previewOnly','knockbackSeconds',0]]){const bad=structuredClone(spec);bad[group][key]=value;assert.throws(()=>api.validate(bad));}
 const s=new api.Attack(spec).snapshot();close(s.bodyCapsule.z,s.position.z+spec.bossCapsule.offsetForward);
});
test('fractional substeps report exact phase and notify boundaries consistently',()=>{
 const a=new api.Attack(spec);
 assert.equal(a.advanceTo(.5-1e-12).phase,'Windup');assert.equal(a.rootEnabled,false);
 const active=a.advanceTo(.5);assert.equal(active.time,.5);assert.equal(active.phase,'Active');assert.equal(active.rootEnabled,true);
 const peak=a.advanceTo(1.12);assert.equal(peak.time,1.12);assert.equal(peak.hitbox,true);
 const recovery=a.advanceTo(1.5);assert.equal(recovery.time,1.5);assert.equal(recovery.phase,'Recovery');assert.equal(recovery.hitbox,false);
 const done=a.advanceTo(2.4);assert.equal(done.time,2.4);assert.equal(done.phase,'Idle');assert.deepEqual(done.events,spec.notifies);
});
