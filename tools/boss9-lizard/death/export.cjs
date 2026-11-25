'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../../vfx/vfx-library-root.cjs');
const root=path.resolve(__dirname,'../../..'),library=resolveLibraryRoot({libraryId:'effects-materials'}).root,spec=require('./spec.json');
const pack=path.join(library,'codex-authored',spec.package),source='codex-authored/boss9-lizard-attack3-ref-20261125/exports';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=p=>{const b=fs.readFileSync(p);return crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md)$/.test(p)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);};
const tools=['rig.py','spec.json','author.py','verify.py','viewer.html','viewer.js','capture.cjs','encode.py','export.cjs'];
if(process.argv.includes('--stage')){
  for(const n of tools)copy(path.join(__dirname,n),path.join(pack,'source/tools',n));
  copy(path.join(root,'docs/assets/BOSS9_LIZARD_DEATH.md'),path.join(pack,'source/BOSS9_LIZARD_DEATH.md'));
  const inputs=Object.fromEntries(['glb','blend'].map(ext=>[ext,{libraryPath:source+'/boss9_attack3.'+ext,sha256:hash(path.join(library,source,'boss9_attack3.'+ext))}]));
  fs.writeFileSync(path.join(pack,'source/inputs.json'),JSON.stringify(inputs,null,2)+'\n');
  const entries=files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>{const p=path.relative(pack,f).replaceAll('\\','/');const project=p.startsWith('source/tools/')?'tools/boss9-lizard/death/'+path.basename(f):p==='source/BOSS9_LIZARD_DEATH.md'?'docs/assets/BOSS9_LIZARD_DEATH.md':null;return {path:p,sha256:hash(f),...(project?{project}:{})};});
  fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id:spec.package,status:'Original authored death; user requested direct commit after verification; GIF review and gameplay integration pending',source:'User-provided lizard and approved five clips; death choreography authored by Codex; no external GIF or image pixels',specification:spec,files:entries},null,2)+'\n');
}
const m=read(path.join(pack,'manifest.json'));assert.equal(m.id,spec.package);assert.deepEqual(m.specification,spec);
assert.deepEqual(files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>path.relative(pack,f).replaceAll('\\','/')).sort(),m.files.map(e=>e.path).sort());
for(const e of m.files){const p=path.resolve(pack,e.path);assert.ok(p.startsWith(pack+path.sep));assert.equal(hash(p),e.sha256,e.path);if(e.project)assert.equal(hash(path.join(root,e.project)),e.sha256,e.project);}
const inputs=read(path.join(pack,'source/inputs.json'));for(const e of Object.values(inputs))assert.equal(hash(path.join(library,e.libraryPath)),e.sha256);assert.equal(inputs.glb.sha256,spec.sourceSHA256);
const b=read(path.join(pack,'exports/build.json')),v=read(path.join(pack,'exports/validation.json'));
assert.deepEqual(b.spec,spec);assert.equal(b.sampleFPS,spec.authorFPS);assert.equal(b.bones,73);assert.equal(b.glbSHA256,v.glbSHA256);assert.equal(hash(path.join(pack,'exports/boss9_death.glb')),v.glbSHA256);
assert.ok(b.sourceBinaryPreserved&&v.sourceMeshAndFiveClipsPreserved);assert.deepEqual(v.clips,[...spec.sourceClips,spec.id]);assert.equal(Object.keys(v.preservedNativeActions).length,5);assert.equal(v.duration,spec.duration);assert.ok(v.nativeGLBMaximumVertexDifference<2e-5);
for(const c of Object.values(v.checks)){
  assert.equal(c.samples,2*Math.round(spec.duration*spec.authorFPS)+1);
  assert.ok(c.startIdleError<2e-5&&c.maximumScaleError<1e-5&&c.maximumLinkError<1e-5&&c.maximumJointSpeed<12);
  assert.ok(c.maximumFootRigidError<.0005&&c.maximumBelowGround<.002&&c.maximumGroundLift<.018);
  assert.ok(c.endHoldError<2e-5&&c.endCoreClearance<.08&&c.endHeadClearance<.15&&c.finalRollDegrees>70);
  assert.ok(c.minimumHowlSkyDegrees>65&&c.minimumHowlJawDegrees>25&&c.howlHoldSeconds>=.95);
  assert.ok(Object.values(c.triangleOverlaps).every(n=>n===0));
}
const gifs=[];
for(const view of ['front','side']){
  const c=read(path.join(pack,'qa',view+'-capture.json')),e=read(path.join(pack,'qa',view+'-encoding.json'));
  assert.equal(c.glbSHA256,v.glbSHA256);assert.equal(c.duration,spec.duration);assert.equal(c.frames.length,Math.round(spec.duration*100));assert.deepEqual(c.errors,[]);assert.deepEqual(c.warnings,[]);assert.ok(Object.values(c.controlsCheck).every(Boolean));assert.equal(e.streamedFrames,c.frames.length);gifs.push(...e.gifs);
  assert.equal(c.endHold,true);
  for(const f of c.frames)assert.ok(f.bounds.minX>=0&&f.bounds.maxX<=900&&f.bounds.minY>=0&&f.bounds.maxY<=600);
}
assert.equal(gifs.length,3);
for(const g of gifs){const slow=g.file.endsWith('_Slow.gif');assert.equal(g.frames,Math.round(spec.duration*(slow?100:50)));assert.equal(g.durationMs,spec.duration*(slow?4000:1000));assert.deepEqual(g.size,[900,600]);assert.equal(hash(path.join(pack,'preview',g.file)),g.sha256);}
console.log('BOSS9_DEATH_PACKAGE_PASS',m.files.length,'files; original five clips and non-looping corpse checked');
