'use strict';
// Preserve the limb/tail revision without replacing the accepted flight source.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../vfx/vfx-library-root.cjs');
const project=path.resolve(__dirname,'../..'),root=resolveLibraryRoot({libraryId:'effects-materials'}).root;
const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'flight_refine.json'),'utf8'));
const pack=path.join(root,'codex-authored',cfg.package),dependency='codex-authored/'+cfg.sourcePackage+'/exports/boss9_flight.blend';
const hash=file=>{const b=fs.readFileSync(file);return crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md|log)$/.test(file)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const copy=(from,to)=>{fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);};
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
if(process.argv[2]==='--stage'){
 const preview=path.resolve(process.argv[3]);
 const tools=['flight_refine.py','flight_refine.json','flight_refine_verify.py','flight_refine_export.cjs','flight_capture.cjs','flight_viewer.js','flight_preview.html','flight_profile.json','flight_encode.py'];
 for(const name of tools)copy(path.join(__dirname,name),path.join(pack,'source',name));
 copy(path.join(project,'docs/assets/BOSS9_FLIGHT_LIMBS.md'),path.join(pack,'source/BOSS9_FLIGHT_LIMBS.md'));
 for(const name of ['Walk.gif','Front.gif'])copy(path.join(preview,'preview',name),path.join(pack,'preview',name));
 copy(path.join(preview,'preview/encoding.json'),path.join(pack,'qa/encoding.json'));
 for(const name of ['full','frames','front'])copy(path.join(preview,name,'capture.json'),path.join(pack,'qa',name+'-capture.json'));
 copy(path.join(preview,'build.log'),path.join(pack,'qa/build.log'));
 const entries=files(pack).filter(f=>path.basename(f)!=='manifest.json').map(file=>{const source=path.relative(pack,file).replaceAll('\\','/'),name=path.basename(file);return {source,...(source.startsWith('source/')?{project:name.endsWith('.md')?'docs/assets/'+name:'tools/boss9/'+name}:{}),sha256:hash(file)};});
 fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id:cfg.package,status:'Walk review; other animations await approval',dependency:{source:dependency,sha256:hash(path.join(root,dependency))},referencePolicy:'User image and GIF are pose references only. No reference pixels in this asset package.',files:entries},null,2)+'\n');
}
const manifest=read(path.join(pack,'manifest.json'));
assert.equal(hash(path.join(root,manifest.dependency.source)),manifest.dependency.sha256);
for(const e of manifest.files){
 const file=path.resolve(pack,e.source);assert.ok(file.startsWith(pack+path.sep));assert.equal(hash(file),e.sha256,e.source);
 if(e.project)assert.equal(hash(path.join(project,e.project)),e.sha256,e.project);
}
const v=read(path.join(pack,'exports/flight-validation.json')),build=read(path.join(pack,'exports/flight-build.json'));
assert.equal(v.sourceSHA256,manifest.dependency.sha256);assert.equal(v.retainedCurvesSHA256,build.retainedWingTorsoHeadCurvesSHA256);
assert.equal(v.bones,70);assert.deepEqual(v.clips,['Walk']);assert.ok(Math.abs(v.tailLengthRatio-.6)<.00001);
assert.ok(v.tailVerticalTravelRelativeRootMeters>.3);assert.ok(v.preservedWingTorsoHeadMatrixError<.00001);
assert.ok(Object.values(v.torsoConvexHullInsideVertexSamples).every(x=>x===0));assert.ok(Object.values(v.distalLimbTriangleOverlaps).every(x=>x===0));
assert.equal(hash(path.join(pack,'exports/boss9_flight.glb')),v.glbSHA256);
for(const name of ['full','frames','front']){
 const c=read(path.join(pack,'qa',name+'-capture.json'));assert.equal(c.glbSHA256,v.glbSHA256);assert.equal(c.frames.length,60);assert.deepEqual(c.errors,[]);assert.deepEqual(c.warnings,[]);
 if(name!=='frames')for(const f of c.frames){const b=f.bounds;assert.ok(b.minX>=0&&b.maxX<=800&&b.minY>=0&&b.maxY<=600);}
}
const encoding=read(path.join(pack,'qa/encoding.json'));
for(const name of ['Walk.gif','Front.gif']){const e=encoding.gifs.find(e=>e.file===name);assert.ok(e);assert.equal(e.durationMs,2000);assert.deepEqual(e.size,[800,600]);}
assert.ok(!manifest.files.some(e=>/Reference-comparison|飛龍GIF|clipboard/.test(e.source)));
console.log('FLIGHT_REFINE_PACKAGE_PASS',manifest.files.length,'files; tail 60%; unchanged flight; limb clearance and matching GLB captures passed');
