'use strict';
// This package belongs to the new lizard model. It does not restore the discarded dragon.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../vfx/vfx-library-root.cjs');
const project=path.resolve(__dirname,'../..'),root=resolveLibraryRoot({libraryId:'effects-materials'}).root,pack=path.join(root,'codex-authored/boss9-lizard-run-20261120');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=file=>{const b=fs.readFileSync(file);return crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md|log)$/.test(file)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const copy=(from,to)=>{fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);};
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
if(process.argv[2]==='--stage'){
 const review=path.resolve(process.argv[3]);
 for(const name of ['inspect.py','prepare.py','verify.py','viewer.html','viewer.js','capture.cjs','encode.py','export.cjs'])copy(path.join(__dirname,name),path.join(pack,'source/tools',name));
 copy(path.join(project,'docs/assets/BOSS9_LIZARD_RUN.md'),path.join(pack,'source/BOSS9_LIZARD_RUN.md'));
 for(const name of ['Run.gif','Front.gif'])copy(path.join(review,'preview',name),path.join(pack,'preview',name));
 for(const name of ['side','front']){copy(path.join(review,name,'capture.json'),path.join(pack,'qa',name+'-capture.json'));copy(path.join(review,'preview',name+'-contact.jpg'),path.join(pack,'qa',name+'-contact.jpg'));}
 copy(path.join(review,'preview/encoding.json'),path.join(pack,'qa/encoding.json'));
 for(const name of ['build.log','verify.log'])copy(path.join(review,name),path.join(pack,'qa',name));
 const entries=files(pack).filter(f=>path.basename(f)!=='manifest.json').map(file=>{const relative=path.relative(pack,file).replaceAll('\\','/');return {path:relative,sha256:hash(file),...(relative.startsWith('source/tools/')?{project:'tools/boss9-lizard/'+path.basename(file)}:relative==='source/BOSS9_LIZARD_RUN.md'?{project:'docs/assets/BOSS9_LIZARD_RUN.md'}:{})};});
 fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id:'boss9-lizard-run-20261120',status:'Movement fix GIF review; no game integration',source:{path:'source/BOSS9.glb',sha256:'1f3f5daad3100305fd51c5fd070cf53a2d5a6b3c59394be3db94500ce68ffa0d',authorization:'New model supplied by user for these repairs; placeholder materials retained.'},changes:'Align upper-body roll/heading with rear-foot travel and remove misclassified leg animation from hand fingers. Original geometry, weights and textures retained.',files:entries},null,2)+'\n');
}
const manifest=read(path.join(pack,'manifest.json'));assert.equal(hash(path.join(pack,manifest.source.path)),manifest.source.sha256);
for(const e of manifest.files){const file=path.resolve(pack,e.path);assert.ok(file.startsWith(pack+path.sep));assert.equal(hash(file),e.sha256,e.path);if(e.project)assert.equal(hash(path.join(project,e.project)),e.sha256,e.project);}
const b=read(path.join(pack,'exports/build.json')),v=read(path.join(pack,'exports/validation.json')),e=read(path.join(pack,'qa/encoding.json'));
assert.equal(v.sourceSHA256,manifest.source.sha256);assert.equal(b.sourceSHA256,manifest.source.sha256);assert.equal(hash(path.join(pack,'exports/boss9_lizard.glb')),v.glbSHA256);assert.equal(b.glbSHA256,v.glbSHA256);
assert.equal(v.bones,73);assert.equal(v.unchangedAnimationChannels,177);assert.ok(v.originalGeometryMaterialBinaryPreserved&&b.originalBinaryPrefixPreserved);assert.equal(v.forelimbVerticesWeightedToRearLegs,0);
for(const c of Object.values(v.checks)){assert.equal(c.samples,161);assert.equal(c.rearBoneMatrixError,0);assert.equal(c.rearSurfaceVertexError,0);assert.ok(c.bodyVsFeetHeadingErrorDegrees<.2&&c.headVsForwardHeadingErrorDegrees<.2&&c.bodyRollMaximumDegrees<.05);assert.ok(c.fingerLocalBasisError<1e-5&&c.fingerRigidToPalmError<1e-5&&c.fingerToFootMinimumVertexDistance>.04&&c.loopVertexError<1e-5);assert.equal(c.fingerFootTriangleOverlaps,0);}
for(const view of ['side','front']){const c=read(path.join(pack,'qa',view+'-capture.json'));assert.equal(c.glbSHA256,v.glbSHA256);assert.equal(c.frames.length,20);assert.deepEqual(c.errors,[]);assert.deepEqual(c.warnings,[]);for(const f of c.frames)assert.ok(f.bounds.minX>=0&&f.bounds.maxX<=900&&f.bounds.minY>=0&&f.bounds.maxY<=600);assert.equal(e.captures[view].glbSHA256,v.glbSHA256);}
for(const name of ['Run.gif','Front.gif']){const gif=e.gifs.find(g=>g.file===name);assert.ok(gif);assert.equal(gif.frames,60);assert.equal(gif.durationMs,2000);assert.equal(gif.cycles,3);assert.deepEqual(gif.size,[900,600]);assert.equal(hash(path.join(pack,'preview',name)),gif.sha256);}
console.log('LIZARD_PACKAGE_PASS',manifest.files.length,'files; original mesh/material/gait preserved, actual GLB and two GIFs verified');
