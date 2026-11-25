'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../../vfx/vfx-library-root.cjs');
const root=path.resolve(__dirname,'../../..'),library=resolveLibraryRoot({libraryId:'effects-materials'}).root,spec=require('./spec.json');
const pack=path.join(library,'codex-authored',spec.package),approved=path.join(library,'codex-authored/boss9-lizard-attack2-20261124/exports');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>{const b=fs.readFileSync(f);return crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md|log)$/.test(f)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);};
const tools=['rig.py','author.py','spec.json','motion.json','verify.py','viewer.html','viewer.js','capture.cjs','encode.py','export.cjs'];
if(process.argv.includes('--stage')){
  for(const n of tools)copy(path.join(__dirname,n),path.join(pack,'source/tools',n));
  const inputs=Object.fromEntries(['glb','blend'].map(ext=>[ext,{libraryPath:'codex-authored/boss9-lizard-attack2-20261124/exports/boss9_attack2.'+ext,sha256:hash(path.join(approved,'boss9_attack2.'+ext))}]));
  fs.writeFileSync(path.join(pack,'source/inputs.json'),JSON.stringify(inputs,null,2)+'\n');
  copy(path.join(root,'docs/assets/BOSS9_LIZARD_ATTACK3_REFERENCE.md'),path.join(pack,'source/BOSS9_LIZARD_ATTACK3_REFERENCE.md'));
  const entries=files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>{const relative=path.relative(pack,f).replaceAll('\\','/');const project=relative.startsWith('source/tools/')?'tools/boss9-lizard/attack3-ref/'+path.basename(f):relative==='source/BOSS9_LIZARD_ATTACK3_REFERENCE.md'?'docs/assets/BOSS9_LIZARD_ATTACK3_REFERENCE.md':null;return {path:relative,sha256:hash(f),...(project?{project}:{})};});
  fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id:spec.package,status:'Attack3 GIF-reference remake awaiting visual approval; preview only',reference:{sha256:spec.referenceSHA256,duration:spec.referenceDuration,frames:30,usage:'Pose and timing reference only; no reference image pixels or VFX imported'},specification:spec,files:entries},null,2)+'\n');
}
const manifest=read(path.join(pack,'manifest.json'));assert.equal(manifest.id,spec.package);
assert.deepEqual(files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>path.relative(pack,f).replaceAll('\\','/')).sort(),manifest.files.map(e=>e.path).sort());
for(const e of manifest.files){const f=path.resolve(pack,e.path);assert.ok(f.startsWith(pack+path.sep));assert.equal(hash(f),e.sha256,e.path);if(e.project)assert.equal(hash(path.join(root,e.project)),e.sha256,e.project);}
const inputs=read(path.join(pack,'source/inputs.json'));
for(const ext of ['glb','blend'])assert.equal(hash(path.join(library,inputs[ext].libraryPath)),inputs[ext].sha256);
assert.equal(inputs.glb.sha256,spec.sourceSHA256);
const b=read(path.join(pack,'exports/build.json')),v=read(path.join(pack,'exports/validation.json'));
assert.deepEqual(b.spec,spec);assert.equal(b.sampleFPS,spec.authorFPS);assert.equal(b.bones,73);assert.equal(b.glbSHA256,v.glbSHA256);
assert.equal(hash(path.join(pack,'exports/boss9_attack3.glb')),v.glbSHA256);assert.ok(b.sourceBinaryPreserved&&v.sourceMeshAndFourClipsPreserved);
assert.equal(v.sourceSHA256,spec.sourceSHA256);assert.equal(Object.keys(v.preservedNativeActions).length,4);
assert.deepEqual(v.clips,['Walk','Idle','BOSS9_Attack1','BOSS9_Attack2','BOSS9_Attack3']);assert.equal(v.duration,spec.duration);
assert.ok(v.nativeGLBMaximumVertexDifference<2e-5&&v.channelSeamError<1e-5&&b.maximumArmTargetClamp<.01);
for(const c of Object.values(v.checks)){
  assert.equal(c.samples,2*Math.round(spec.duration*spec.authorFPS)+1);
  assert.ok(c.maximumScaleError<1e-5&&c.maximumLinkError<1e-5&&c.maximumJointSpeed<30&&c.maximumFootDrift<1e-4&&c.rootHorizontalDrift<1e-6);
  assert.ok(c.groundError<.012&&c.maximumBelowGround<.008&&c.poseSeamError<2e-5&&c.sourceIdleError<2e-5);
  assert.ok(Object.values(c.triangleOverlaps).every(n=>n===0));assert.ok(c.maximumFootShapeError<.0005&&c.maximumHeadRoll<5&&c.maximumHeadGazeAngle<20);
  assert.ok(c.flow.R.horizontalTravel>.8&&c.flow.L.horizontalTravel<-.8);
  for(const f of Object.values(c.flow))assert.ok(f.verticalTravel<-.7&&f.minimumRaisedLift>.7&&f.minimumRaisedPalmUp>.4&&f.minimumFingerExtension>.97);
  assert.ok(Math.max(...Object.values(c.maximumAuthoredTargetError))<.01);
}
const gifs=[];
for(const view of ['front','side','path']){
  const c=read(path.join(pack,'qa',view+'-capture.json')),e=read(path.join(pack,'qa',view+'-encoding.json'));
  assert.equal(c.glbSHA256,v.glbSHA256);assert.equal(c.duration,spec.duration);assert.equal(c.frames.length,Math.round(spec.duration*100));
  assert.deepEqual(c.errors,[]);assert.deepEqual(c.warnings,[]);assert.ok(Object.values(c.controlsCheck).every(Boolean));assert.equal(e.streamedFrames,c.frames.length);gifs.push(...e.gifs);
  const start=c.frames[0].nodes;
  for(const f of c.frames){assert.ok(f.bounds.minX>=0&&f.bounds.maxX<=900&&f.bounds.minY>=0&&f.bounds.maxY<=600);for(const n of ['rearFootR','rearFootL'])assert.ok(Math.hypot(...f.nodes[n].map((x,i)=>x-start[n][i]))<1e-4);}
}
assert.equal(gifs.length,4);
for(const g of gifs){const slow=g.file.endsWith('_Slow.gif');assert.equal(g.frames,Math.round(spec.duration*(slow?100:50)));assert.equal(g.durationMs,spec.duration*(slow?4000:1000));assert.deepEqual(g.size,[900,600]);assert.equal(hash(path.join(pack,'preview',g.file)),g.sha256);}
console.log('BOSS9_ATTACK3_REFERENCE_PACKAGE_PASS',manifest.files.length,'files; original four actions, planted feet, head, cross-slash and GIFs checked');
