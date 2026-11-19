'use strict';
// Preserve the flight-only review asset, without importing the reference pixels.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../vfx/vfx-library-root.cjs');
const project=path.resolve(__dirname,'../..'),root=resolveLibraryRoot({libraryId:'effects-materials'}).root;
const pack=path.join(root,'codex-authored/boss9-flight-reference-20261120');
const hash=(file)=>{const b=fs.readFileSync(file);return crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md|log)$/.test(file)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const copy=(from,to)=>{fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);};
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
if(process.argv[2]==='--stage'){
 const preview=path.resolve(process.argv[3]);
 for(const name of fs.readdirSync(__dirname).filter(n=>/^flight_.*\.(?:py|js|cjs|html|json)$/.test(n)))copy(path.join(__dirname,name),path.join(pack,'source',name));
 copy(path.join(project,'docs/assets/BOSS9_FLIGHT_REFERENCE.md'),path.join(pack,'source/BOSS9_FLIGHT_REFERENCE.md'));
 copy(path.join(preview,'preview/Walk.gif'),path.join(pack,'preview/Walk.gif'));
 copy(path.join(preview,'preview/encoding.json'),path.join(pack,'qa/encoding.json'));
 copy(path.join(preview,'full/capture.json'),path.join(pack,'qa/full-capture.json'));
 copy(path.join(preview,'frames/capture.json'),path.join(pack,'qa/reference-view-capture.json'));
 copy(path.join(preview,'build.log'),path.join(pack,'qa/build.log'));
 const entries=files(pack).filter(f=>path.basename(f)!=='manifest.json').map(file=>{const source=path.relative(pack,file).replaceAll('\\','/');const name=path.basename(file);return {source,...(source.startsWith('source/')?{project:name.endsWith('.md')?'docs/assets/'+name:'tools/boss9/'+name}:{}),sha256:hash(file)};});
 fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id:'boss9-flight-reference-20261120',status:'Flight review; other actions await user approval',dependency:{source:'codex-authored/boss9-dragon-v2-20261120/exports/boss9.blend',sha256:hash(path.join(root,'codex-authored/boss9-dragon-v2-20261120/exports/boss9.blend'))},reference:{sha256:read(path.join(pack,'source/flight_profile.json')).reference.sha256,usage:'Motion analysis only. No reference pixels included. Labelled comparison is a separate private review artifact.'},files:entries},null,2)+'\n');
}
const manifest=read(path.join(pack,'manifest.json'));
assert.equal(hash(path.join(root,manifest.dependency.source)),manifest.dependency.sha256);
for(const e of manifest.files){
 const file=path.resolve(pack,e.source);assert.ok(file.startsWith(pack+path.sep));assert.equal(hash(file),e.sha256,e.source);
 if(e.project)assert.equal(hash(path.join(project,e.project)),e.sha256,e.project);
}
const validation=read(path.join(pack,'exports/flight-validation.json'));
assert.equal(hash(path.join(pack,'exports/boss9_flight.glb')),validation.glb.sha256);
assert.equal(validation.bones,70);assert.deepEqual(validation.glb.clips,['Walk']);
for(const name of ['full-capture.json','reference-view-capture.json']){
 const report=read(path.join(pack,'qa',name));assert.equal(report.glbSHA256,validation.glb.sha256);assert.equal(report.frames.length,60);assert.deepEqual(report.errors,[]);assert.deepEqual(report.warnings,[]);
}
const encoding=read(path.join(pack,'qa/encoding.json'));assert.equal(encoding.gifs[0].durationMs,2000);assert.deepEqual(encoding.gifs[0].size,[800,600]);
assert.ok(!manifest.files.some(e=>/Reference-comparison|飛龍GIF/.test(e.source)));
console.log('FLIGHT_PACKAGE_PASS',manifest.files.length,'files; 70 bones; only Walk; original four actions remain in immutable v2; GLB and preview provenance match');
