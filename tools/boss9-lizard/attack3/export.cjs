'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../../vfx/vfx-library-root.cjs'),root=path.resolve(__dirname,'../../..'),id='boss9-lizard-attack3-20261124',pack=path.join(resolveLibraryRoot({libraryId:'effects-materials'}).root,'codex-authored',id),spec=require('./spec.json');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),hash=f=>{const b=fs.readFileSync(f);return crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md|log)$/.test(f)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]),copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);};
const tools=['rig.py','author.py','spec.json','verify.py','viewer.html','viewer.js','capture.cjs','encode.py','export.cjs'],views=['front','side','path'];
if(process.argv.includes('--stage')){
 for(const n of tools)copy(path.join(__dirname,n),path.join(pack,'source/tools',n));copy(path.join(root,'docs/assets/BOSS9_LIZARD_ATTACK3.md'),path.join(pack,'source/BOSS9_LIZARD_ATTACK3.md'));
 const entries=files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>{const relative=path.relative(pack,f).replaceAll('\\','/'),project=relative.startsWith('source/tools/')?'tools/boss9-lizard/attack3/'+path.basename(f):relative==='source/BOSS9_LIZARD_ATTACK3.md'?'docs/assets/BOSS9_LIZARD_ATTACK3.md':null;return {path:relative,sha256:hash(f),...(project?{project}:{})};});
 fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id,status:'Attack1 and Attack2 accepted; Attack3 right then left diagonal combo awaiting GIF approval',specification:'1.5 seconds; retarget approved Attack1 with mirrored left-side motion, connected recovery, planted feet and no root translation; animation preview only',files:entries},null,2)+'\n');
}
const manifest=read(path.join(pack,'manifest.json'));assert.equal(manifest.id,id);assert.deepEqual(files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>path.relative(pack,f).replaceAll('\\','/')).sort(),manifest.files.map(e=>e.path).sort());
for(const e of manifest.files){const f=path.resolve(pack,e.path);assert.ok(f.startsWith(pack+path.sep));assert.equal(hash(f),e.sha256,e.path);if(e.project)assert.equal(hash(path.join(root,e.project)),e.sha256,e.project);}
const b=read(path.join(pack,'exports/build.json')),v=read(path.join(pack,'exports/validation.json'));
assert.equal(v.sourceSHA256,spec.sourceSHA256);assert.equal(hash(path.join(pack,'source/boss9_attack2.glb')),spec.sourceSHA256);
const approved=path.join(path.dirname(pack),'boss9-lizard-attack2-20261124/exports');assert.equal(hash(path.join(approved,'boss9_attack2.glb')),spec.sourceSHA256);assert.equal(hash(path.join(approved,'boss9_attack2.blend')),hash(path.join(pack,'source/boss9_attack2.blend')));
assert.equal(hash(path.join(pack,'exports/boss9_attack3.glb')),v.glbSHA256);assert.equal(b.glbSHA256,v.glbSHA256);assert.deepEqual(b.spec,spec);assert.ok(b.sourceBinaryPreserved&&v.sourceMeshAndFourClipsPreserved);assert.equal(b.bones,73);assert.equal(v.bones,73);assert.equal(v.duration,1.5);assert.deepEqual(v.clips,['Walk','Idle','BOSS9_Attack1','BOSS9_Attack2','BOSS9_Attack3']);assert.equal(Object.keys(v.preservedNativeActions).length,4);
assert.ok(v.nativeGLBMaximumVertexDifference<2e-5&&v.channelSeamError<1e-5&&b.maximumArmTargetClamp<.003);
const reference=read(path.join(pack,'exports/reference-samples.json'));assert.equal(reference.key.sourceSHA256,spec.sourceSHA256);assert.equal(reference.key.blendSHA256,hash(path.join(pack,'source/boss9_attack2.blend')));assert.equal(reference.key.clip,spec.referenceClip);assert.equal(reference.samples.length,577);
for(const c of Object.values(v.checks)){
 assert.equal(c.samples,1441);assert.ok(c.maximumScaleError<1e-5&&c.maximumLinkError<1e-5&&c.maximumJointSpeed<30&&c.maximumFootDrift<1e-4&&c.rootHorizontalDrift<1e-6&&c.groundError<.012&&c.maximumBelowGround<.008&&c.poseSeamError<2e-5&&c.sourceIdleError<2e-5);assert.ok(Object.values(c.triangleOverlaps).every(n=>n===0));
 assert.ok(c.flow.R.horizontalTravel>.8&&c.flow.L.horizontalTravel<-.8&&c.flow.R.maximumHeightTime<.6&&c.flow.L.maximumHeightTime>.85&&c.flow.L.maximumHeightTime-c.flow.R.maximumHeightTime>.45);
 for(const f of Object.values(c.flow))assert.ok(f.verticalTravel<-.7&&f.minimumRaisedLift>.7&&f.minimumRaisedPalmUp>.4);
 assert.ok(Math.max(...Object.values(c.maximumReferencePathError))<.01&&Math.max(...Object.values(c.supportDriftDuringOtherStrike))<.003&&c.maximumHeadGazeAngle<20);
 assert.ok(c.maximumFootShapeError<.0005&&c.maximumHeadRoll<5&&c.peakHeadShapeDifference<.002&&Object.values(c.flow).every(f=>f.minimumFingerExtension>.97));
}
const gifs=[];
for(const view of views){const c=read(path.join(pack,'qa',view+'-capture.json')),e=read(path.join(pack,'qa',view+'-encoding.json'));assert.equal(c.clipName,spec.id);assert.equal(c.duration,1.5);assert.equal(c.glbSHA256,v.glbSHA256);assert.equal(c.frames.length,150);assert.deepEqual(c.errors,[]);assert.deepEqual(c.warnings,[]);assert.ok(c.controlsCheck&&Object.values(c.controlsCheck).every(Boolean));assert.equal(e.streamedFrames,150);gifs.push(...e.gifs);
 const start=c.frames[0].nodes;for(const f of c.frames){assert.ok(f.bounds.minX>=0&&f.bounds.maxX<=900&&f.bounds.minY>=0&&f.bounds.maxY<=600);for(const n of ['rearFootR','rearFootL'])assert.ok(Math.hypot(...f.nodes[n].map((x,i)=>x-start[n][i]))<1e-4);assert.ok(Math.abs(f.nodes.root[0]-start.root[0])<1e-6&&Math.abs(f.nodes.root[2]-start.root[2])<1e-6);}
 if(view==='path')assert.equal(c.guide,true);
}
assert.equal(gifs.length,4);for(const g of gifs){const slow=g.file==='BOSS9_Attack3_Slow.gif';assert.equal(g.frames,slow?150:75);assert.equal(g.durationMs,slow?6000:1500);assert.deepEqual(g.size,[900,600]);assert.equal(hash(path.join(pack,'preview',g.file)),g.sha256);}
for(const n of ['BOSS9_Attack3_Right.png','BOSS9_Attack3_Left.png']){const p=fs.readFileSync(path.join(pack,'preview',n));assert.equal(p.readUInt32BE(16),900);assert.equal(p.readUInt32BE(20),600);}
console.log('BOSS9_ATTACK3_PACKAGE_PASS',manifest.files.length,'files; four original clips, mirrored combo, native/GLB, UI and GIFs verified');
