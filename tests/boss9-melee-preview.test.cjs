'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../tools/boss9-lizard/melee/controller.js'),spec=require('../tools/boss9-lizard/melee/spec.json');
const {windupEnd,activeEnd}=spec.phases,{on,off,fullReachAt}=spec.hitbox,doneAt=spec.duration;
const target=(z,x=spec.axisX)=>({id:'player',x,z,y:spec.ground,radius:.18,height:.95});
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const movingSpec=()=>{const s=structuredClone(spec);s.rootMotion.distance=.35;return s;};
test('shared animation notifies validate and phase boundaries are half-open',()=>{
 api.validate(spec);assert.equal(api.phaseAt(spec,windupEnd-1e-5),'Windup');assert.equal(api.phaseAt(spec,windupEnd),'Active');assert.equal(api.phaseAt(spec,activeEnd),'Recovery');assert.equal(api.phaseAt(spec,doneAt),'Idle');
 const bad=structuredClone(spec);bad.notifies.find(e=>e.name==='HitboxOff').time=off+.01;assert.throws(()=>api.validate(bad));
 const landing=structuredClone(spec);landing.notifies.find(e=>e.name==='RightClawPlant').time=off-.01;assert.throws(()=>api.validate(landing));
});
test('the complete attack and notify timeline last exactly 1.2 seconds',()=>{
 assert.equal(doneAt,1.2);close(windupEnd,.25);close(activeEnd,.75);close(on,.56);close(spec.timing.rightPlant,1.12);
 close(spec.timing.directReturnStart,off);assert.equal(spec.notifies.filter(e=>e.name==='RightClawPlant').length,1);
 assert.equal(spec.rootMotion.distance,0);
 const a=new api.Attack(spec);assert.equal(a.advanceTo(1.2-1e-6).phase,'Recovery');assert.equal(a.advanceTo(1.2).phase,'Idle');assert.deepEqual(a.events,spec.notifies);
});
test('no windup movement or damage; early Active still has no hitbox',()=>{
 const a=new api.Attack(spec,{targets:[target(1.57)]});const w=a.advanceTo(windupEnd);close(w.actualDistance,0);assert.equal(w.hits.length,0);assert.equal(w.hitbox,false);
 const early=a.advanceTo(on-1e-6);assert.equal(early.hits.length,0);assert.equal(early.hitbox,false);
});
test('peak enables one physical hit and the low point disables before landing',()=>{
 const a=new api.Attack(spec,{targets:[target(1.6)]});const peak=a.advanceTo(on);assert.equal(peak.hitbox,true);assert.equal(peak.hits.length,0);a.advanceTo(on+.95*(off-on));assert.equal(a.hits.length,1);assert.equal(a.hits[0].damageType,'physical');
 const low=a.advanceTo(off);assert.equal(low.hitbox,false);assert.equal(low.phase,'Recovery');a.advanceTo(doneAt);assert.equal(a.hits.length,1);assert.equal(a.targets[0].hp,75);
 const landing=a.events.find(e=>e.name==='RightClawPlant');assert.ok(landing.time>spec.hitbox.off);
});
test('a target entering during Recovery is never damaged',()=>{
 const a=new api.Attack(spec,{targets:[target(5)]});a.advanceTo(off);a.moveTarget('player',{z:1});a.advanceTo(doneAt);assert.equal(a.hits.length,0);
});
test('skipping the whole clip preserves the exact notify sequence and single hit',()=>{
 const a=new api.Attack(spec,{targets:[target(1.6)]});const done=a.advanceTo(doneAt);assert.deepEqual(done.events,spec.notifies);assert.equal(done.hits.length,1);assert.ok(done.hits[0].time>=on&&done.hits[0].time<off);assert.equal(done.hitbox,false);
 a.advanceTo(100);assert.equal(a.hits.length,1);assert.equal(a.events.length,spec.notifies.length);
});
test('30/60/144 FPS and a single seek agree on movement and hit count',()=>{
 const results=[];for(const fps of [30,60,144]){const a=new api.Attack(spec,{targets:[target(1.6)]});for(let t=0;t<doneAt;t+=1/fps)a.advanceTo(t);results.push(a.advanceTo(doneAt));}
 const one=new api.Attack(spec,{targets:[target(1.6)]}).advanceTo(doneAt);for(const r of results){assert.equal(r.hits.length,one.hits.length);close(r.actualDistance,one.actualDistance,1e-6);close(r.targets[0].z,one.targets[0].z,1e-6);}
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
 const sMove=movingSpec(),a=new api.Attack(sMove,{targets:[target(1.57)]});let minGap=Infinity;
 for(let t=0;t<=doneAt+1e-4;t+=1/120){a.advanceTo(Math.min(doneAt,t));minGap=Math.min(minGap,api.capsuleGap(a.body(),a.targets[0]));}
 const s=a.advanceTo(doneAt);assert.ok(s.blockedDistance>.01);assert.ok(s.actualDistance<sMove.rootMotion.distance);assert.ok(minGap>=.005-1e-7);assert.equal(s.hits.length,1);
 const z=s.position.z;a.advanceTo(4);close(a.position.z,z);
});
test('standing attack never advances and keeps a touching capsule separated',()=>{
 const a=new api.Attack(spec,{targets:[target(1.435)]});
 for(let t=0;t<doneAt;t+=1/120){const s=a.advanceTo(t);close(s.actualDistance,0);close(s.blockedDistance,0);assert.ok(api.capsuleGap(a.body(),a.targets[0])>=spec.bossCapsule.skin-1e-7);}
 const s=a.advanceTo(doneAt);assert.equal(s.contacts,0);assert.equal(s.hits.length,1);assert.equal(s.targets[0].hp,75);
});
test('knockback is outward, smooth, finite and uses physical preview parameters',()=>{
 const a=new api.Attack(spec,{targets:[target(1.6)]});for(let t=on;!a.hits.length;t+=1/240)a.advanceTo(t);const start=a.time,z=a.targets[0].z;a.advanceTo(start+.01);assert.ok(a.targets[0].z>z&&a.targets[0].z<z+.1);a.advanceTo(start+.25);close(a.targets[0].z,1.6+spec.previewOnly.knockbackDistance);
 assert.ok(a.hits[0].knockback.z>0);assert.throws(()=>a.advanceTo(NaN));assert.throws(()=>a.advanceTo(.5));
});
test('rotating the actor rotates its reach and root motion',()=>{
 const a=new api.Attack(movingSpec(),{facing:{x:1,z:0},position:{x:0,z:0,y:spec.ground},targets:[{...target(0,1.8)}]});const s=a.advanceTo(doneAt);close(s.position.x,.35);close(s.position.z,0);assert.equal(s.hits.length,1);
});
test('dynamic reach grows with the slash and rejects malformed collision settings',()=>{
 close(api.hitboxAt(spec,on).range,.35);close(api.hitboxAt(spec,fullReachAt).range,1.5);
 assert.ok(api.hitboxAt(spec,(on+fullReachAt)/2).range>.35&&api.hitboxAt(spec,(on+fullReachAt)/2).range<1.5);
 for(const [group,key,value] of [['hitbox','fullReachAt',on],['hitbox','range',NaN],['bossCapsule','height',.1],['previewOnly','knockbackSeconds',0]]){const bad=structuredClone(spec);bad[group][key]=value;assert.throws(()=>api.validate(bad));}
 const s=new api.Attack(spec).snapshot();close(s.bodyCapsule.z,s.position.z+spec.bossCapsule.offsetForward);
});
test('fractional substeps report exact phase and notify boundaries consistently',()=>{
 const a=new api.Attack(spec);
 assert.equal(a.advanceTo(windupEnd-1e-12).phase,'Windup');assert.equal(a.rootEnabled,false);
 const active=a.advanceTo(windupEnd);assert.equal(active.time,windupEnd);assert.equal(active.phase,'Active');assert.equal(active.rootEnabled,true);
 const peak=a.advanceTo(on);assert.equal(peak.time,on);assert.equal(peak.hitbox,true);
 const recovery=a.advanceTo(off);assert.equal(recovery.time,off);assert.equal(recovery.phase,'Recovery');assert.equal(recovery.hitbox,false);
 const done=a.advanceTo(doneAt);assert.equal(done.time,doneAt);assert.equal(done.phase,'Idle');assert.deepEqual(done.events,spec.notifies);
});
