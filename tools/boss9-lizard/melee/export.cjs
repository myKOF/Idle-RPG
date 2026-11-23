'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../../vfx/vfx-library-root.cjs');
const project=path.resolve(__dirname,'../../..'),id='boss9-lizard-melee-20261123';
const pack=path.join(resolveLibraryRoot({libraryId:'effects-materials'}).root,'codex-authored',id);
const spec=require('./spec.json'),api=require('./controller.js');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>{const b=fs.readFileSync(f);return crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md|log)$/.test(f)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);};
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);
const tools=['author.py','verify.py','spec.json','controller.js','viewer.html','viewer.js','capture.cjs','encode.py','export.cjs'];
const views=['front','side','combat','blocked'];
if(process.argv[2]==='--stage'){
 const review=path.resolve(process.argv[3]);
 for(const name of tools)copy(path.join(__dirname,name),path.join(pack,'source/tools',name));
 copy(path.join(project,'tests/boss9-melee-preview.test.cjs'),path.join(pack,'source/boss9-melee-preview.test.cjs'));
 copy(path.join(project,'docs/assets/BOSS9_LIZARD_MELEE.md'),path.join(pack,'source/BOSS9_LIZARD_MELEE.md'));
 for(const name of ['BOSS9_Attack1.gif','BOSS9_Attack1_Side.gif','BOSS9_Attack1_Hitbox.gif','BOSS9_Attack1_Capsule.gif'])copy(path.join(review,'preview',name),path.join(pack,'preview',name));
 for(const view of views){copy(path.join(review,view,'capture.json'),path.join(pack,'qa',view+'-capture.json'));copy(path.join(review,'preview',view+'-contact.jpg'),path.join(pack,'qa',view+'-contact.jpg'));}
 copy(path.join(review,'preview/encoding.json'),path.join(pack,'qa/encoding.json'));
 for(const name of ['build.log','verify.log','unit.log'])copy(path.join(review,name),path.join(pack,'qa',name));
 const entries=files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>{
  const relative=path.relative(pack,f).replaceAll('\\','/');
  const projectPath=relative.startsWith('source/tools/')?'tools/boss9-lizard/melee/'+path.basename(f):relative==='source/BOSS9_LIZARD_MELEE.md'?'docs/assets/BOSS9_LIZARD_MELEE.md':relative==='source/boss9-melee-preview.test.cjs'?'tests/boss9-melee-preview.test.cjs':null;
  return {path:relative,sha256:hash(f),...(projectPath?{project:projectPath}:{})};
 });
 fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id,status:'Pure animation and collision preview; awaiting user review; no game integration',base:'User-approved lizard and Walk, original mesh/skin/materials retained',specification:'Latest pure animation and physical hitbox requirements; no VFX or SFX',files:entries},null,2)+'\n');
}
const manifest=read(path.join(pack,'manifest.json'));
assert.equal(manifest.id,id);assert.equal(new Set(manifest.files.map(e=>e.path)).size,manifest.files.length);
assert.deepEqual(files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>path.relative(pack,f).replaceAll('\\','/')).sort(),manifest.files.map(e=>e.path).sort());
for(const entry of manifest.files){const f=path.resolve(pack,entry.path);assert.ok(f.startsWith(pack+path.sep));assert.equal(hash(f),entry.sha256,entry.path);if(entry.project)assert.equal(hash(path.join(project,entry.project)),entry.sha256,entry.project);}
const b=read(path.join(pack,'exports/build.json')),v=read(path.join(pack,'exports/validation.json')),e=read(path.join(pack,'qa/encoding.json'));
assert.equal(hash(path.join(pack,'source/boss9_lizard.glb')),'23319786f8663d55bbde4ee7ae48bd2259e7a493114994cb9407dd2d731dbf5d');
assert.equal(hash(path.join(pack,'source/boss9_lizard.glb')),v.sourceSHA256);assert.equal(b.sourceSHA256,v.sourceSHA256);
assert.equal(hash(path.join(pack,'exports/boss9_attack1.glb')),v.glbSHA256);assert.equal(b.glbSHA256,v.glbSHA256);
assert.ok(b.sourceBinaryPreserved&&v.sourceBinaryAndWalkPreserved);assert.equal(v.bones,73);assert.deepEqual(v.clips,['Walk','Idle',spec.id]);assert.equal(v.duration,spec.duration);
assert.deepEqual(b.spec,spec);assert.deepEqual(v.notifies,spec.notifies);assert.equal(b.timing.riseAndSweepSeconds,1);
assert.ok(v.nativeGLBMaximumVertexDifference<2e-5&&v.channelPoseSeamError<1e-5&&v.idleAttackPoseDifference<2e-5);
for(const c of Object.values(v.checks)){
 assert.equal(c.samples,1153);assert.ok(c.boneLengthError<1e-5&&c.limbLinkError<1e-5&&c.maximumJointStep<.12&&c.rootMotionError<1e-5);
 assert.ok(c.windupHipDrop>.08&&c.windupHandDrift<.012&&c.plantedGroundError<.012&&c.maximumBelowGround<.008&&c.idlePoseAtAdvancedPositionError<1e-5);
 assert.ok(Object.values(c.triangleOverlaps).every(n=>n===0));assert.ok(c.activeTipForwardDot>.9&&c.activeTipInclination[0]>-30&&c.activeTipInclination[1]<5);
}
for(const view of views){
 const c=read(path.join(pack,'qa',view+'-capture.json'));assert.equal(c.clipName,spec.id);assert.equal(c.glbSHA256,v.glbSHA256);assert.equal(c.frames.length,120);assert.ok(Math.abs(c.duration-spec.duration)<1e-6);assert.deepEqual(c.errors,[]);assert.deepEqual(c.warnings,[]);
 for(const f of c.frames){
  assert.ok(f.bounds.minX>=0&&f.bounds.maxX<=900&&f.bounds.minY>=0&&f.bounds.maxY<=600);
  const s=f.logic;assert.equal(s.phase,api.phaseAt(spec,f.time));assert.equal(s.hitbox,f.time>=spec.hitbox.on&&f.time<spec.hitbox.off);
  assert.ok(Math.abs(s.actualDistance-f.geometryCenters.rootAdvance)<1e-5,'Rendered root must obey the collision result');
  assert.ok(s.actualDistance>=-1e-7&&s.actualDistance<=spec.rootMotion.distance+1e-7);
  assert.ok(s.hits.length<=1);for(const h of s.hits)assert.ok(h.time>=spec.hitbox.on&&h.time<spec.hitbox.off&&h.damageType==='physical');
  if(s.phase==='Windup')assert.ok(Math.abs(s.actualDistance)<1e-7&&s.hits.length===0);
  if(f.geometryCenters.minimumCapsuleGap!==null)assert.ok(f.geometryCenters.minimumCapsuleGap>=spec.bossCapsule.skin-1e-6,'Player capsules must not overlap');
 }
 const end=c.endState.logic;assert.deepEqual(end.events,spec.notifies);assert.equal(end.phase,'Idle');assert.equal(end.hitbox,false);assert.equal(end.rootEnabled,false);
 const recovery=c.frames.filter(f=>f.time>=spec.phases.activeEnd);for(const f of recovery){assert.ok(Math.abs(f.logic.actualDistance-end.actualDistance)<1e-7);assert.equal(f.logic.hits.length,end.hits.length);}
 if(view==='combat'||view==='blocked'){assert.equal(end.hits.length,1);assert.equal(end.targets[0].hp,75);}else assert.equal(end.hits.length,0);
 if(view==='blocked'){assert.ok(end.contacts>0&&end.blockedDistance>.01&&end.actualDistance<spec.rootMotion.distance);}else assert.ok(Math.abs(end.actualDistance-spec.rootMotion.distance)<1e-7);
 if(view==='front'){assert.ok(c.controlsCheck&&Object.values(c.controlsCheck).every(Boolean));
  const p=c.frames.filter(f=>f.time>=1.12&&f.time<=1.5).map(f=>f.geometryCenters.claw),a=p[0],z=p.at(-1),dx=z[0]-a[0],dy=z[1]-a[1];
  assert.ok(dx>.7&&dy<-.9);const bow=Math.max(...p.map(q=>Math.abs((q[0]-a[0])*dy-(q[1]-a[1])*dx)/Math.hypot(dx,dy)));assert.ok(bow>.2,'Actual claw must follow a curved diagonal sweep');
 }
 assert.equal(e.captures[view].glbSHA256,v.glbSHA256);
}
for(const gif of e.gifs){assert.equal(gif.frames,120);assert.equal(gif.durationMs,2400);assert.deepEqual(gif.size,[900,600]);assert.equal(hash(path.join(pack,'preview',gif.file)),gif.sha256);}
assert.equal(e.gifs.length,4);
console.log('BOSS9_MELEE_PACKAGE_PASS',manifest.files.length,'files; Walk preserved; native/GLB/Idle/animation notifies/GIFs/collision/UI verified');
