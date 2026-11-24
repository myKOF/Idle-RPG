'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../../vfx/vfx-library-root.cjs'),root=path.resolve(__dirname,'../../..'),id='boss9-lizard-attack2-20261124',pack=path.join(resolveLibraryRoot({libraryId:'effects-materials'}).root,'codex-authored',id),spec=require('./spec.json');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),hash=f=>{const b=fs.readFileSync(f);return crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md|log)$/.test(f)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]),copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);};
const tools=['rig.py','author.py','spec.json','reference.json','verify.py','viewer.html','viewer.js','capture.cjs','encode.py','export.cjs'],views=['front','side','path'];
if(process.argv[2]==='--stage'){
 const review=path.resolve(process.argv[3]);for(const n of tools)copy(path.join(__dirname,n),path.join(pack,'source/tools',n));copy(path.join(root,'docs/assets/BOSS9_LIZARD_ATTACK2.md'),path.join(pack,'source/BOSS9_LIZARD_ATTACK2.md'));
 for(const n of ['BOSS9_Attack2.gif','BOSS9_Attack2_Side.gif','BOSS9_Attack2_Path.gif','BOSS9_Attack2_Slow.gif'])copy(path.join(review,'preview',n),path.join(pack,'preview',n));
 copy(path.join(review,'front/0090.png'),path.join(pack,'preview/BOSS9_Attack2_Raised.png'));copy(path.join(review,'front/0135.png'),path.join(pack,'preview/BOSS9_Attack2_BackHands.png'));
 for(const view of views){copy(path.join(review,view,'capture.json'),path.join(pack,'qa',view+'-capture.json'));copy(path.join(review,'preview',view+'-contact.jpg'),path.join(pack,'qa',view+'-contact.jpg'));}
 copy(path.join(review,'preview/encoding.json'),path.join(pack,'qa/encoding.json'));for(const n of ['build.log','verify.log','project-build.log'])copy(path.join(review,n),path.join(pack,'qa',n));
 const entries=files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>{const relative=path.relative(pack,f).replaceAll('\\','/'),project=relative.startsWith('source/tools/')?'tools/boss9-lizard/attack2/'+path.basename(f):relative==='source/BOSS9_LIZARD_ATTACK2.md'?'docs/assets/BOSS9_LIZARD_ATTACK2.md':null;return {path:relative,sha256:hash(f),...(project?{project}:{})};});
 fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id,status:'Attack2 reference remake preview; Attack1 accepted and retained byte-for-byte; awaiting user GIF review',specification:'1.5-second reference retiming: erect chest, skyward roar, bent elbows, delayed vertical forearms, raised hold, head/chest leading simultaneous downward claws; dorsal hands face the enemy; no game integration',files:entries},null,2)+'\n');
}
const manifest=read(path.join(pack,'manifest.json'));assert.equal(manifest.id,id);
assert.deepEqual(files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>path.relative(pack,f).replaceAll('\\','/')).sort(),manifest.files.map(e=>e.path).sort());
for(const e of manifest.files){const f=path.resolve(pack,e.path);assert.ok(f.startsWith(pack+path.sep));assert.equal(hash(f),e.sha256,e.path);if(e.project)assert.equal(hash(path.join(root,e.project)),e.sha256,e.project);}
const b=read(path.join(pack,'exports/build.json')),v=read(path.join(pack,'exports/validation.json')),encoding=read(path.join(pack,'qa/encoding.json'));
assert.equal(v.sourceSHA256,'7cc2450cdf682f287c35c291e843a8bff7315faeeaab4fa8d33e873abfe0f190');assert.equal(hash(path.join(pack,'source/boss9_attack1.glb')),v.sourceSHA256);
const approved=path.join(path.dirname(pack),'boss9-lizard-melee-20261123/exports');assert.equal(hash(path.join(approved,'boss9_attack1.glb')),v.sourceSHA256);assert.equal(hash(path.join(approved,'boss9_attack1.blend')),hash(path.join(pack,'source/boss9_attack1.blend')));
assert.equal(hash(path.join(pack,'exports/boss9_attack2.glb')),v.glbSHA256);assert.equal(b.glbSHA256,v.glbSHA256);assert.deepEqual(b.spec,spec);assert.ok(b.sourceBinaryPreserved&&v.sourceMeshAndThreeClipsPreserved);assert.equal(b.bones,73);assert.equal(v.bones,73);assert.equal(v.duration,1.5);assert.deepEqual(v.clips,['Walk','Idle','BOSS9_Attack1','BOSS9_Attack2']);assert.equal(Object.keys(v.preservedNativeActions).length,3);
assert.ok(v.nativeGLBMaximumVertexDifference<2e-5&&v.channelSeamError<1e-5&&b.maximumArmTargetClamp<.015);
for(const c of Object.values(v.checks)){
 assert.equal(c.samples,1441);assert.ok(c.maximumScaleError<1e-5&&c.maximumLinkError<1e-5&&c.maximumJointSpeed<30&&c.maximumFootDrift<1e-4&&c.rootHorizontalDrift<1e-6&&c.groundError<.012&&c.maximumBelowGround<.008&&c.poseSeamError<2e-5&&c.sourceIdleError<2e-5);assert.ok(Object.values(c.triangleOverlaps).every(n=>n===0));
 const r=c.raised;assert.ok(r.chestLift>.35&&r.chestRetraction>.20&&r.torsoGain>45&&r.torsoInclination>55&&r.headPitch>65&&r.minimumElbowAngle>55&&r.maximumElbowAngle<115&&r.minimumForearmUp>.9&&r.minimumUpperLateral>.85&&r.tipAboveHead>-.12&&r.minimumPadUp>.15&&r.minimumPalmForward>.65);assert.ok(c.fingerExtensionMinimum>.90&&c.minimumLateDorsalForward>.5&&c.maximumSynchronizationError<.03);
 assert.ok(c.flow.R.horizontalTravel>0&&c.flow.L.horizontalTravel<0&&c.flow.R.horizontalTravel-c.flow.L.horizontalTravel>.12);for(const f of Object.values(c.flow))assert.ok(f.verticalTravel<-1&&f.minimumSideClearance>.22);
 assert.ok(c.headLeadsDownstroke.length&&c.headLeadsDownstroke.every(r=>r.headPitch<45&&r.clawDropProgress<.35));
}
for(const view of views){const c=read(path.join(pack,'qa',view+'-capture.json'));assert.equal(c.clipName,spec.id);assert.equal(c.duration,1.5);assert.equal(c.glbSHA256,v.glbSHA256);assert.equal(c.frames.length,150);assert.deepEqual(c.errors,[]);assert.deepEqual(c.warnings,[]);assert.ok(c.controlsCheck&&Object.values(c.controlsCheck).every(Boolean));
 const start=c.frames[0].nodes;for(const f of c.frames){assert.ok(f.bounds.minX>=0&&f.bounds.maxX<=900&&f.bounds.minY>=0&&f.bounds.maxY<=600);for(const n of ['rearFootR','rearFootL'])assert.ok(Math.hypot(...f.nodes[n].map((x,i)=>x-start[n][i]))<1e-4);assert.ok(Math.abs(f.nodes.root[0]-start.root[0])<1e-6&&Math.abs(f.nodes.root[2]-start.root[2])<1e-6);if(f.time>=spec.timing.raised&&f.time<=spec.timing.holdEnd)for(const s of ['R','L'])assert.ok(f.geometry[s].palmNormal[1]>.15&&f.geometry[s].palmNormal[2]>.65);if(f.time>=spec.timing.slashEnd-.025&&f.time<=spec.timing.slashEnd)for(const s of ['R','L'])assert.ok(f.geometry[s].palmNormal[2]<-.5,'Dorsal surface must face the enemy');}
 assert.equal(encoding.captures[view].glbSHA256,v.glbSHA256);
 if(view==='path')assert.equal(c.guide,true);
}
for(const g of encoding.gifs){const slow=g.file==='BOSS9_Attack2_Slow.gif';assert.equal(g.frames,slow?150:75);assert.equal(g.durationMs,slow?6000:1500);assert.deepEqual(g.size,[900,600]);assert.equal(hash(path.join(pack,'preview',g.file)),g.sha256);}assert.equal(encoding.gifs.length,4);
for(const n of ['BOSS9_Attack2_Raised.png','BOSS9_Attack2_BackHands.png']){const p=fs.readFileSync(path.join(pack,'preview',n));assert.equal(p.readUInt32BE(16),900);assert.equal(p.readUInt32BE(20),600);}
console.log('BOSS9_ATTACK2_PACKAGE_PASS',manifest.files.length,'files; original three clips, native/GLB, bilateral paths, hand facing and GIFs verified');
