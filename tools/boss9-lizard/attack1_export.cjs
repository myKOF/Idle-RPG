'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../vfx/vfx-library-root.cjs');
const project=path.resolve(__dirname,'../..');
const pack=path.join(resolveLibraryRoot({libraryId:'effects-materials'}).root,'codex-authored/boss9-lizard-attack1-20261123');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>{const b=fs.readFileSync(f);return crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md|log)$/.test(f)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);};
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);
const tools=['attack1.py','attack1_verify.py','attack1_viewer.html','attack1_viewer.js','attack1_capture.cjs','attack1_encode.py','attack1_export.cjs'];
if(process.argv[2]==='--stage'){
 const review=path.resolve(process.argv[3]);
 for(const name of tools)copy(path.join(__dirname,name),path.join(pack,'source/tools',name));
 copy(path.join(project,'docs/assets/BOSS9_LIZARD_ATTACK1.md'),path.join(pack,'source/BOSS9_LIZARD_ATTACK1.md'));
 copy(path.join(review,'reference.json'),path.join(pack,'source/reference.json'));
 for(const name of ['Attack1.gif','Attack1_Side.gif','Attack1_Top.gif'])copy(path.join(review,'preview',name),path.join(pack,'preview',name));
 for(const view of ['front','side','top']){
  copy(path.join(review,view,'capture.json'),path.join(pack,'qa',view+'-capture.json'));
  copy(path.join(review,'preview',view+'-contact.jpg'),path.join(pack,'qa',view+'-contact.jpg'));
 }
 copy(path.join(review,'preview/encoding.json'),path.join(pack,'qa/encoding.json'));
 for(const name of ['build.log','verify.log'])copy(path.join(review,name),path.join(pack,'qa',name));
 const entries=files(pack).filter(f=>path.basename(f)!=='manifest.json').map(f=>{
  const relative=path.relative(pack,f).replaceAll('\\','/');
  return {path:relative,sha256:hash(f),...(relative.startsWith('source/tools/')?{project:'tools/boss9-lizard/'+path.basename(f)}:relative==='source/BOSS9_LIZARD_ATTACK1.md'?{project:'docs/assets/BOSS9_LIZARD_ATTACK1.md'}:{})};
 });
 fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id:'boss9-lizard-attack1-20261123',status:'Attack1 GIF review; no game integration',base:'User-approved straight running lizard; source binary and Walk retained',reference:'User BOSS9_Attack1.gif, movement analysis only; no reference pixels, backgrounds or effects copied',files:entries},null,2)+'\n');
}
const m=read(path.join(pack,'manifest.json'));
for(const entry of m.files){const f=path.resolve(pack,entry.path);assert.ok(f.startsWith(pack+path.sep));assert.equal(hash(f),entry.sha256,entry.path);if(entry.project)assert.equal(hash(path.join(project,entry.project)),entry.sha256,entry.project);}
const b=read(path.join(pack,'exports/build.json')),v=read(path.join(pack,'exports/validation.json')),e=read(path.join(pack,'qa/encoding.json'));
assert.equal(hash(path.join(pack,'source/boss9_lizard.glb')),'23319786f8663d55bbde4ee7ae48bd2259e7a493114994cb9407dd2d731dbf5d');
assert.equal(hash(path.join(pack,'source/boss9_lizard.glb')),v.sourceSHA256);assert.equal(b.sourceSHA256,v.sourceSHA256);
assert.equal(hash(path.join(pack,'exports/boss9_attack1.glb')),v.glbSHA256);assert.equal(b.glbSHA256,v.glbSHA256);
assert.ok(b.sourceBinaryPreserved&&v.sourceBinaryAndWalkPreserved);assert.equal(v.bones,73);assert.deepEqual(v.clips,['Walk','Attack1']);assert.equal(v.duration,3.6);
assert.ok(v.nativeGLBMaximumVertexDifference<2e-5&&v.channelLoopError<1e-5);
for(const c of Object.values(v.checks)){
 assert.equal(c.samples,865);assert.ok(c.boneLengthError<1e-5&&c.limbJointLinkError<1e-5&&c.loopVertexError<1e-5&&c.maximumAdjacentJointStep<.12);
 assert.ok(c.supportFootGroundError<.005&&c.supportHandGroundError<.008&&c.maximumBelowGround<.008);
 assert.ok(Object.values(c.triangleOverlaps).every(n=>n===0));
}
for(const view of ['front','side','top']){
 const c=read(path.join(pack,'qa',view+'-capture.json'));assert.equal(c.clipName,'Attack1');assert.equal(c.glbSHA256,v.glbSHA256);assert.equal(c.frames.length,90);assert.ok(Math.abs(c.duration-3.6)<1e-6);assert.deepEqual(c.errors,[]);assert.deepEqual(c.warnings,[]);
 for(const f of c.frames)assert.ok(f.bounds.minX>=0&&f.bounds.maxX<=900&&f.bounds.minY>=0&&f.bounds.maxY<=600);
 assert.equal(e.captures[view].glbSHA256,v.glbSHA256);
}
for(const gif of e.gifs){assert.equal(gif.frames,90);assert.equal(gif.durationMs,3600);assert.deepEqual(gif.size,[900,600]);assert.equal(hash(path.join(pack,'preview',gif.file)),gif.sha256);}
assert.equal(e.gifs.length,3);
console.log('ATTACK1_PACKAGE_PASS',m.files.length,'files; accepted Walk unchanged; Attack1 native/GLB and GIFs verified');
