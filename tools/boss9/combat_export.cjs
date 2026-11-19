'use strict';
// Save combat review beside the approved flight, without replacing earlier packages.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../vfx/vfx-library-root.cjs');
const project=path.resolve(__dirname,'../..'),root=resolveLibraryRoot({libraryId:'effects-materials'}).root;
const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'combat.json'),'utf8'));
const pack=path.join(root,'codex-authored',cfg.package),dependency='codex-authored/'+cfg.sourcePackage+'/exports/boss9_flight.blend';
const hash=file=>{const b=fs.readFileSync(file);return crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md|log)$/.test(file)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const copy=(from,to)=>{fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);};
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
if(process.argv[2]==='--stage'){
 const review=path.resolve(process.argv[3]);
 for(const name of ['combat.json','combat_author.py','combat_verify.py','combat_preview.html','combat_viewer.js','combat_capture.cjs','combat_encode.py','combat_export.cjs','fire.js','fire.json'])copy(path.join(__dirname,name),path.join(pack,'source',name));
 copy(path.join(project,'docs/assets/BOSS9_COMBAT.md'),path.join(pack,'source/BOSS9_COMBAT.md'));
 for(const name of Object.keys(cfg.durations)){
  copy(path.join(review,'preview',name+'.gif'),path.join(pack,'preview',name+'.gif'));
  copy(path.join(review,'preview',name+'-contact.jpg'),path.join(pack,'qa',name+'-contact.jpg'));
 }
 copy(path.join(root,'codex-authored',cfg.sourcePackage,'preview/Walk.gif'),path.join(pack,'preview/Walk-approved.gif'));
 copy(path.join(review,'frames/capture.json'),path.join(pack,'qa/capture.json'));
 copy(path.join(review,'preview/encoding.json'),path.join(pack,'qa/encoding.json'));
 for(const name of ['build.log','verify.log'])copy(path.join(review,name),path.join(pack,'qa',name));
 const entries=files(pack).filter(f=>path.basename(f)!=='manifest.json').map(file=>{const source=path.relative(pack,file).replaceAll('\\','/'),name=path.basename(file);return {source,...(source.startsWith('source/')?{project:name.endsWith('.md')?'docs/assets/'+name:'tools/boss9/'+name}:{}),sha256:hash(file)};});
 fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id:cfg.package,status:'Four combat GIFs for user review; approved Walk preserved; no game integration',dependency:{source:dependency,sha256:hash(path.join(root,dependency))},referencePolicy:'User model retained. Original GIF/still are motion references only; no reference pixels copied. New actions, rendering and particle preview are authored locally.',files:entries},null,2)+'\n');
}
const manifest=read(path.join(pack,'manifest.json'));
assert.equal(hash(path.join(root,manifest.dependency.source)),manifest.dependency.sha256);
assert.equal(manifest.dependency.sha256,'c37fa124c488285508099f4634abe49b2fbf2102aaad9c797383ed264f19674c');
for(const e of manifest.files){const file=path.resolve(pack,e.source);assert.ok(file.startsWith(pack+path.sep));assert.equal(hash(file),e.sha256,e.source);if(e.project)assert.equal(hash(path.join(project,e.project)),e.sha256,e.project);}
const v=read(path.join(pack,'exports/combat-validation.json')),b=read(path.join(pack,'exports/combat-build.json')),c=read(path.join(pack,'qa/capture.json')),e=read(path.join(pack,'qa/encoding.json'));
assert.deepEqual(b.configuration,cfg);assert.equal(v.sourceSHA256,manifest.dependency.sha256);assert.equal(v.walkActionSHA256,b.walkActionSHA256);
assert.equal(v.bones,70);assert.ok(v.tailLengthMeters>4.08&&v.tailLengthMeters<4.09);
assert.equal(hash(path.join(pack,'exports/boss9.glb')),v.glb.sha256);assert.equal(c.glbSHA256,v.glb.sha256);assert.equal(e.glbSHA256,v.glb.sha256);
assert.ok(v.glb.originalTextureBytesPreserved&&v.glb.materialsPreserved&&v.glb.walkExportChannelsPreserved);
assert.deepEqual(c.errors,[]);assert.deepEqual(c.warnings,[]);assert.equal(c.clips.Walk,2);
for(const [name,d] of Object.entries(cfg.durations)){
 const clip=v.clips[name],gif=e.gifs.find(g=>g.file===name+'.gif');assert.equal(clip.duration,d);assert.equal(clip.samples,Math.round(d*120)+1);
 assert.ok(clip.startMatrixError<1e-4&&clip.maxBoneLengthError<1e-5);
 assert.equal(c.frames[name].length,Math.round(d*30)+1);assert.ok(Math.abs(c.clips[name]-d)<1e-6);
 assert.equal(gif.animationMs,d*1000);assert.equal(gif.durationMs,d*1000+(name==='Die'?800:0));assert.deepEqual(gif.size,[900,600]);assert.equal(hash(path.join(pack,'preview',gif.file)),gif.sha256);
 for(const f of c.frames[name])assert.ok(f.bounds.minX>=0&&f.bounds.maxX<=900&&f.bounds.minY>=0&&f.bounds.maxY<=600);
 if(name!=='Die'){assert.ok(clip.returnMatrixError<1e-4);assert.ok(Object.values(clip.distalTorsoHullInsideSamples).every(x=>x===0));assert.ok(Object.values(clip.distalTriangleOverlaps).every(x=>x===0));}
}
assert.ok(v.clips.Attack1.maximumForwardMeters>4.9&&v.clips.Attack1.maximumForwardMeters<5.03);
assert.ok(Math.abs(v.clips.Attack2.rootYawDegrees[0]+90)<.02);
assert.ok(v.clips.Die.finalTorsoZ[0]<.4&&v.clips.Die.finalHeadZ[0]<.45&&v.clips.Die.finalHoldVertexError<1e-5&&v.clips.Die.raisedWingHoldLocalMatrixError<1e-4);
assert.equal(read(path.join(pack,'source/fire.json')).range,20);assert.ok(e.particles.maximumDistanceMeters>19.9&&e.particles.maximumDistanceMeters<=20.00001&&e.particles.clearAtEnd);
assert.equal(hash(path.join(pack,'preview/Walk-approved.gif')),hash(path.join(root,'codex-authored',cfg.sourcePackage,'preview/Walk.gif')));
assert.ok(!manifest.files.some(e=>/Reference-comparison|飛龍GIF|clipboard/.test(e.source)));
console.log('COMBAT_PACKAGE_PASS',manifest.files.length,'files; unchanged model/Walk; four clips and matching actual-GLB GIFs');
