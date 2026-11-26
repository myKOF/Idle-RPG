'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../../vfx/vfx-library-root.cjs');
const root=path.resolve(__dirname,'../../..'),library=resolveLibraryRoot({libraryId:'effects-materials'}).root;
const pack=path.join(library,'codex-authored/boss9-lizard-variants-20261127');
const rawHash=b=>crypto.createHash('sha256').update(b).digest('hex');
const hash=p=>{const b=fs.readFileSync(p);return rawHash(/\.(py|cjs|md|json)$/.test(p)?b.toString('utf8').replace(/\r\n/g,'\n'):b);};
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);};
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);
// Focused diagnostic captures are temporary, not published source or QA.
// A denied cleanup can leave old captures alongside the required final QA.
const delivered=()=>files(pack).filter(p=>!/^qa\/idle-check(?:-\d+\.png|\.json)$/.test(path.relative(pack,p).replaceAll('\\','/')));
const mode=process.argv[2]||'--check';assert.ok(['--ingest','--stage','--apply','--check'].includes(mode));
if(mode==='--ingest'){
  const sources=process.argv.slice(3);assert.equal(sources.length,3);
  const variants=sources.map((p,i)=>{assert.ok(fs.statSync(p).isFile());const name='boss9'+(i?'_lv'+(i+1):''),portrait='boss9_lizard'+(i?'_lv'+(i+1):''),target='source/original/'+path.basename(p);assert.ok(!fs.existsSync(path.join(pack,target)));copy(p,path.join(pack,target));return {name,portrait,floor:9+i*10,path:target,sha256:hash(p)};});
  const ref=p=>({libraryPath:p,sha256:hash(path.join(library,p))});
  const inputs={master:ref('codex-authored/boss9-lizard-game-20261127/exports/boss9.glb'),portraitPose:ref('codex-authored/boss9-lizard-death-20261126/exports/boss9_death.glb'),variants};
  fs.writeFileSync(path.join(pack,'source/inputs.json'),JSON.stringify(inputs,null,2)+'\n');
  console.log('BOSS9_VARIANTS_INPUTS_PASS',variants.map(v=>({name:v.name,sha256:v.sha256})));process.exit(0);
}
const inputs=JSON.parse(fs.readFileSync(path.join(pack,'source/inputs.json'),'utf8'));
for(const v of inputs.variants)assert.equal(hash(path.join(pack,v.path)),v.sha256);
for(const r of [inputs.master,inputs.portraitPose])assert.equal(hash(path.join(library,r.libraryPath)),r.sha256);
const build=JSON.parse(fs.readFileSync(path.join(pack,'exports/build.json'),'utf8'));
assert.equal(build.masterSHA256,inputs.master.sha256);
for(const v of build.variants){assert.ok(v.exactPositionWeightTransfer&&v.animationsPreserved&&v.skinPreserved);assert.equal(hash(path.join(pack,'exports',v.name+'.glb')),v.glbSHA256);assert.equal(hash(path.join(pack,'exports',v.name+'.blend')),v.blendSHA256);}
const exported=Object.fromEntries(inputs.variants.flatMap(v=>[['exports/'+v.name+'.glb','images/models/npc3d/'+v.name+'.glb'],['exports/'+v.portrait+'.png','images/sprites/boss/'+v.portrait+'.png']]));
if(mode==='--stage'){
  for(const n of ['build.py','verify.py','verify-runtime.cjs','export.cjs'])copy(path.join(__dirname,n),path.join(pack,'source/tools',n));
  copy(path.join(root,'docs/assets/BOSS9_LIZARD_VARIANTS.md'),path.join(pack,'source/BOSS9_LIZARD_VARIANTS.md'));
  const entries=delivered().filter(p=>path.basename(p)!=='manifest.json').map(p=>{const n=path.relative(pack,p).replaceAll('\\','/');return {path:n,sha256:hash(p),...(exported[n]?{project:exported[n]}:n.startsWith('source/tools/')?{project:'tools/boss9-lizard/variants/'+path.basename(p)}:n==='source/BOSS9_LIZARD_VARIANTS.md'?{project:'docs/assets/BOSS9_LIZARD_VARIANTS.md'}:{})};});
  fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id:'boss9-lizard-variants-20261127',approval:'User provided three final appearance GLBs on 2026-11-27 and requested the approved five clips and game integration. Preserve the table attack rate and standard boss names.',source:'User supplied mesh and PBR maps, exact coincident-position weight transfer from the approved 73-bone rig; unchanged five animation tracks; 2K game textures and Blender portraits. Full originals retained; no external pixels or VFX.',files:entries},null,2)+'\n');
}
const manifest=JSON.parse(fs.readFileSync(path.join(pack,'manifest.json'),'utf8'));
assert.deepEqual(delivered().filter(p=>path.basename(p)!=='manifest.json').map(p=>path.relative(pack,p).replaceAll('\\','/')).sort(),manifest.files.map(e=>e.path).sort());
for(const e of manifest.files){const p=path.resolve(pack,e.path);assert.ok(p.startsWith(pack+path.sep));assert.equal(hash(p),e.sha256,e.path);if(!e.project)continue;const target=path.resolve(root,e.project);assert.ok(target.startsWith(root+path.sep));if(mode==='--apply'&&e.project.startsWith('images/'))copy(p,target);if(mode!=='--stage')assert.equal(hash(target),e.sha256,e.project);}
if(mode==='--check'){
  const skin=JSON.parse(fs.readFileSync(path.join(pack,'qa/skin.json'),'utf8'));
  assert.equal(skin.samplesPerFormat,45);assert.equal(skin.variants.length,3);
  for(const v of skin.variants){const b=build.variants.find(b=>b.name===v.name);assert.equal(v.glbSHA256,b.glbSHA256);assert.equal(v.blendSHA256,b.blendSHA256);assert.ok(v.maximumVertexError.glb<1e-5&&v.maximumVertexError.blend<1e-5);}
  const qa=JSON.parse(fs.readFileSync(path.join(pack,'qa/runtime.json'),'utf8'));
  assert.deepEqual(qa.errors,[]);assert.deepEqual(qa.warnings,[]);assert.equal(qa.variants.length,3);
  for(const v of qa.variants){assert.equal(v.glbSHA256,build.variants.find(b=>b.name===v.name).glbSHA256);assert.equal(v.render.count,180);assert.equal(v.render.idle.clip,'Walk');assert.equal(v.render.idle.time,0);assert.ok(v.render.idle.paused);assert.equal(v.render.idleAudit.firstAlphaDifferences,0);assert.equal(v.render.idleAudit.secondAlphaDifferences,0);assert.equal(v.render.death.time,4);assert.deepEqual(v.render.attacks.map(a=>a.clip),['Attack1','Attack2','Attack3']);assert.equal(v.portraits.length,2);assert.ok(v.portraits.every(p=>p.naturalWidth===1080));assert.ok(v.live.entered&&v.live.deathLastAliveSeconds>3.4&&v.live.deathGoneSeconds<6.5&&v.live.deathGoneSeconds>v.live.deathLastAliveSeconds);for(const c of ['Walk','Attack1','Attack2','Attack3'])assert.ok(v.live.seen.includes(c));assert.equal(v.live.worker.errors,0);}
}
console.log('BOSS9_VARIANTS_EXPORT_PASS',manifest.files.length,'files;',mode);
