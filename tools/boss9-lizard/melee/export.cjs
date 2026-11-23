'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../../vfx/vfx-library-root.cjs');
const project=path.resolve(__dirname,'../../..'),id='boss9-lizard-melee-20261123';
const pack=path.join(resolveLibraryRoot({libraryId:'effects-materials'}).root,'codex-authored',id);
const spec=require('./spec.json'),api=require('./controller.js');
const poseTime=t=>t/spec.duration*2.4;
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>{const b=fs.readFileSync(f);return crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md|log)$/.test(f)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);};
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);
const tools=['author.py','verify.py','spec.json','controller.js','viewer.html','viewer.js','capture.cjs','encode.py','export.cjs'];
const views=['front','side','combat','blocked','path'];
if(process.argv[2]==='--stage'){
 const review=path.resolve(process.argv[3]);
 for(const name of tools)copy(path.join(__dirname,name),path.join(pack,'source/tools',name));
 copy(path.join(project,'tests/boss9-melee-preview.test.cjs'),path.join(pack,'source/boss9-melee-preview.test.cjs'));
 copy(path.join(project,'docs/assets/BOSS9_LIZARD_MELEE.md'),path.join(pack,'source/BOSS9_LIZARD_MELEE.md'));
 for(const name of ['BOSS9_Attack1.gif','BOSS9_Attack1_Side.gif','BOSS9_Attack1_Hitbox.gif','BOSS9_Attack1_Capsule.gif','BOSS9_Attack1_Path.gif','BOSS9_Attack1_Arc_Slow.gif'])copy(path.join(review,'preview',name),path.join(pack,'preview',name));
 copy(path.join(review,'front/0055.png'),path.join(pack,'preview/BOSS9_Attack1_OpenPalm.png'));
 for(const view of views){copy(path.join(review,view,'capture.json'),path.join(pack,'qa',view+'-capture.json'));copy(path.join(review,'preview',view+'-contact.jpg'),path.join(pack,'qa',view+'-contact.jpg'));}
 copy(path.join(review,'preview/encoding.json'),path.join(pack,'qa/encoding.json'));
 for(const name of ['build.log','verify.log','unit.log'])copy(path.join(review,name),path.join(pack,'qa',name));
 const entries=files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>{
  const relative=path.relative(pack,f).replaceAll('\\','/');
  const projectPath=relative.startsWith('source/tools/')?'tools/boss9-lizard/melee/'+path.basename(f):relative==='source/BOSS9_LIZARD_MELEE.md'?'docs/assets/BOSS9_LIZARD_MELEE.md':relative==='source/boss9-melee-preview.test.cjs'?'tests/boss9-melee-preview.test.cjs':null;
  return {path:relative,sha256:hash(f),...(projectPath?{project:projectPath}:{})};
 });
 fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id,status:'Standing 1.2-second attack with raised body and half support-arm bend; awaiting user review; no game integration',base:'Approved forward gaze, gradual palm flip, turn and shallower diagonal slash',specification:'Feet and support palm remain planted; cancel forward pounce; raise chest and halve excessive support bend; synchronize animation notifies with the 1.2-second clip',files:entries},null,2)+'\n');
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
assert.deepEqual(b.spec,spec);assert.deepEqual(v.notifies,spec.notifies);assert.equal(spec.duration,1.2);assert.equal(spec.rootMotion.distance,0);assert.ok(Math.abs(b.timing.riseAndSweepSeconds-spec.duration/2.4)<1e-7);
assert.ok(v.nativeGLBMaximumVertexDifference<2e-5&&v.channelPoseSeamError<1e-5&&v.idleAttackPoseDifference<2e-5);
assert.equal(v.previousRevisionSHA256,'60061ae341708209243d74595df101c760c730042d1172c970df2b169c80f853');assert.ok(v.unchangedIdleAndFingerChannelError<1e-5);
for(const c of Object.values(v.checks)){
 assert.equal(c.samples,1153);assert.ok(c.boneLengthError<1e-5&&c.limbLinkError<1e-5&&c.maximumJointStep<.12&&c.rootMotionError<1e-5);
 assert.ok(c.windupHipDrop>.08&&c.windupHandDrift<.012&&c.plantedGroundError<.012&&c.maximumBelowGround<.008&&c.idlePoseAtAdvancedPositionError<1e-5);
 assert.ok(Object.values(c.triangleOverlaps).every(n=>n===0));
 const f=c.flow;assert.ok(f.minimumTangentAlignment>.82&&f.maximumFingerDirectionStepDegrees<6&&f.horizontalTravel>.7&&f.verticalTravel<-.9&&f.arcChordDeviation>.08&&f.arcChordDeviation<.28&&f.middleHorizontalProgress>.25&&f.middleHorizontalProgress<.55&&f.middleVerticalProgress>.45&&f.middleVerticalProgress<.75&&f.lateHorizontalTravel>.15&&f.lateVerticalDrop>.03&&f.lateVerticalDrop<.15&&f.lateMinimumTipClearance>.05);
 const h=c.openHand;assert.ok(h.minimumPadUp>.45&&h.minimumFingerExtension>.94&&h.minimumTipRiseAbovePalm>.1&&h.arcBowRatio>.9&&h.arcBowRatio<1.1&&h.maximumReferenceClawPathDifference<.06);
 const t=c.palmTransition,p=t.normalProgress,d=t.fingerHeadingDegrees;
 assert.ok(t.padUp[1]>.25&&p[1]>.05&&p[1]<.30&&p[2]>.35&&p[2]<.75&&p[3]>.85,'Palm must pass through gradual intermediate orientations');
 assert.ok(Math.abs(d[1]-d[0])<25&&d[2]>25&&d[2]<85&&d[3]>95,'Finger heading must turn progressively through the stroke');
 assert.ok(t.maximumNormalStepDegrees<6&&t.maximumApprovedPalmRotationErrorDegrees<.2&&t.peakNormalChangeDegrees<5&&t.endNormalChangeDegrees<5);
 const gaze=c.headTracking;assert.ok(gaze.maximumAbsYawDegrees<3&&gaze.minimumPitchDegrees>-8&&gaze.maximumPitchDegrees<-2&&gaze.maximumAbsBankDegrees<3,'Neck and skull must keep the head facing the enemy');
 const stance=c.standing;assert.ok(stance.maximumFootDrift<1e-4&&stance.maximumSupportPalmDrift<.012&&stance.minimumChestLift>.05&&stance.medianSupportBendRatio>.3&&stance.medianSupportBendRatio<.65&&stance.maximumSupportBendRatio<.75,'Feet must stay planted while chest rises and the support elbow straightens');
 const setup=stance.setupArm;assert.ok(setup.minimumUpperArmOutward>.15&&setup.maximumUpperArmDrop<.15&&setup.minimumForearmDrop>.2&&setup.minimumElbowBendDegrees>45&&setup.maximumElbowBendDegrees<80,'Illustrated support arm must open outward and descend to the planted palm');
}
for(const view of views){
 const c=read(path.join(pack,'qa',view+'-capture.json'));assert.equal(c.clipName,spec.id);assert.equal(c.glbSHA256,v.glbSHA256);assert.equal(c.frames.length,120);assert.ok(Math.abs(c.duration-spec.duration)<1e-6);assert.deepEqual(c.errors,[]);assert.deepEqual(c.warnings,[]);
 for(const f of c.frames){
  assert.ok(f.bounds.minX>=0&&f.bounds.maxX<=900&&f.bounds.minY>=0&&f.bounds.maxY<=600);
  const s=f.logic;assert.equal(s.phase,api.phaseAt(spec,f.time));assert.equal(s.hitbox,f.time>=spec.hitbox.on&&f.time<spec.hitbox.off);
  assert.ok(Math.abs(s.actualDistance-f.geometryCenters.rootAdvance)<1e-5,'Rendered root must obey the collision result');
  assert.ok(s.actualDistance>=-1e-7&&s.actualDistance<=spec.rootMotion.distance+1e-7);
  assert.ok(s.hits.length<=1);for(const h of s.hits)assert.ok(h.time>=spec.hitbox.on&&h.time<spec.hitbox.off&&h.damageType==='physical');
  if(poseTime(f.time)>=1.04&&poseTime(f.time)<=1.12)assert.ok(f.geometryCenters.palmNormal[1]>.45&&f.geometryCenters.longTipRise>.10,'Raised palm surface must face upward and fingers must extend above it');
  if(f.time>=spec.timing.riseStart&&f.time<=spec.timing.rightPlant)assert.ok(Math.abs(f.headGaze.yawDegrees)<3&&f.headGaze.pitchDegrees>-8&&f.headGaze.pitchDegrees<-2&&Math.abs(f.headGaze.bankDegrees)<3,'Rendered head and eyes must keep facing forward');
  if(s.phase==='Windup')assert.ok(Math.abs(s.actualDistance)<1e-7&&s.hits.length===0);
  if(f.geometryCenters.minimumCapsuleGap!==null)assert.ok(f.geometryCenters.minimumCapsuleGap>=spec.bossCapsule.skin-1e-6,'Player capsules must not overlap');
 }
 const end=c.endState.logic;assert.deepEqual(end.events,spec.notifies);assert.equal(end.phase,'Idle');assert.equal(end.hitbox,false);assert.equal(end.rootEnabled,false);
 const recovery=c.frames.filter(f=>f.time>=spec.phases.activeEnd);for(const f of recovery){assert.ok(Math.abs(f.logic.actualDistance-end.actualDistance)<1e-7);assert.equal(f.logic.hits.length,end.hits.length);}
 if(view==='combat'||view==='blocked'){assert.equal(end.hits.length,1);assert.equal(end.targets[0].hp,75);}else assert.equal(end.hits.length,0);
 assert.ok(Math.abs(end.actualDistance)<1e-7&&end.contacts===0&&Math.abs(end.blockedDistance)<1e-7,'Standing attack must not advance');
 const initial=c.frames[0].nodes;for(const f of c.frames)for(const n of ['rearFootL','rearFootR'])assert.ok(Math.hypot(...f.nodes[n].map((v,i)=>v-initial[n][i]))<1e-4,'Rendered feet must remain fixed to the ground');
 if(view==='front'){assert.ok(c.controlsCheck&&Object.values(c.controlsCheck).every(Boolean));
  const p=c.frames.filter(f=>poseTime(f.time)>=1.12&&poseTime(f.time)<=1.5).map(f=>f.geometryCenters.claw),a=p[0],z=p.at(-1),dx=z[0]-a[0],dy=z[1]-a[1];
  assert.ok(dx>.7&&dy<-.9);const bow=Math.max(...p.map(q=>Math.abs((q[0]-a[0])*dy-(q[1]-a[1])*dx)/Math.hypot(dx,dy)));assert.ok(bow>.08&&bow<.28,'Actual claw must follow the requested shallower diagonal arc');
  const g=[56,60,65,70,75].map(i=>c.frames[i].geometryCenters),angle=(x,y)=>Math.acos(Math.max(-1,Math.min(1,x.reduce((s,v,i)=>s+v*y[i],0))));
  const progress=g.map(q=>angle(g[0].palmNormal,q.palmNormal)/angle(g[0].palmNormal,g[4].palmNormal)),heading=g.map(q=>Math.atan2(q.fingerDirection[0],q.fingerDirection[1])*180/Math.PI);
  assert.ok(g[1].palmNormal[1]>.25&&progress[1]>.05&&progress[1]<.30&&progress[2]>.35&&progress[2]<.75&&progress[3]>.85,'Rendered palm must stay upward initially and gradually flip');
  assert.ok(Math.abs(heading[1]-heading[0])<25&&heading[2]>25&&heading[2]<85&&heading[3]>95,'Rendered fingers must gradually turn with the arm');
 }
 if(view==='path'){
  assert.ok(c.guide);const active=c.frames.filter(f=>poseTime(f.time)>=1.12&&poseTime(f.time)<=1.5);
  assert.ok(active.every(f=>f.geometryCenters.fingerTips.length===3));
  for(let i=1;i<active.length-1;i++){const f=active[i];if(poseTime(f.time)<1.40||poseTime(f.time)>1.46)continue;const a=active[i-1].geometryCenters.claw,z=active[i+1].geometryCenters.claw,d=z.map((x,j)=>x-a[j]),length=Math.hypot(...d),finger=f.geometryCenters.fingerDirection;assert.ok(d.reduce((s,x,j)=>s+x*finger[j],0)/length>.8,'Late moving claw must finish banking along its arc');}
 }
 assert.equal(e.captures[view].glbSHA256,v.glbSHA256);
}
for(const gif of e.gifs){const slow=gif.file==='BOSS9_Attack1_Arc_Slow.gif';assert.equal(gif.frames,slow?120:60);assert.equal(gif.durationMs,slow?4800:1200);assert.deepEqual(gif.size,[900,600]);assert.equal(hash(path.join(pack,'preview',gif.file)),gif.sha256);if(slow)assert.equal(gif.speed,.25);}
assert.equal(e.gifs.length,6);
const openPalm=fs.readFileSync(path.join(pack,'preview/BOSS9_Attack1_OpenPalm.png'));assert.equal(openPalm.readUInt32BE(16),900);assert.equal(openPalm.readUInt32BE(20),600);
console.log('BOSS9_MELEE_PACKAGE_PASS',manifest.files.length,'files; Walk preserved; native/GLB/Idle/animation notifies/GIFs/collision/UI verified');
