'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../../vfx/vfx-library-root.cjs');
const root=path.resolve(__dirname,'../../..'),library=resolveLibraryRoot({libraryId:'effects-materials'}).root;
const pack=path.join(library,'codex-authored/boss9-lizard-game-20261127');
const hash=p=>{const b=fs.readFileSync(p);return crypto.createHash('sha256').update(/\.(py|cjs|md|json)$/.test(p)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');};
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);};
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);
const mode=process.argv[2]||'--check';assert.ok(['--stage','--apply','--check'].includes(mode));
if(mode==='--stage'){
  for(const n of ['build.py','verify.py','verify-runtime.cjs','export.cjs'])copy(path.join(__dirname,n),path.join(pack,'source/tools',n));
  copy(path.join(root,'docs/assets/BOSS9_LIZARD_GAME.md'),path.join(pack,'source/BOSS9_LIZARD_GAME.md'));
  const inputs=Object.fromEntries(['glb','blend'].map(ext=>{const p='codex-authored/boss9-lizard-death-20261126/exports/boss9_death.'+ext;return [ext,{libraryPath:p,sha256:hash(path.join(library,p))}];}));
  fs.writeFileSync(path.join(pack,'source/inputs.json'),JSON.stringify(inputs,null,2)+'\n');
  const exported={'exports/boss9.glb':'images/models/npc3d/boss9.glb','exports/boss9_lizard.png':'images/sprites/boss/boss9_lizard.png'};
  const entries=files(pack).filter(p=>path.basename(p)!=='manifest.json').map(p=>{const name=path.relative(pack,p).replaceAll('\\','/');return {path:name,sha256:hash(p),...(exported[name]?{project:exported[name]}:name.startsWith('source/tools/')?{project:'tools/boss9-lizard/game/'+path.basename(p)}:name==='source/BOSS9_LIZARD_GAME.md'?{project:'docs/assets/BOSS9_LIZARD_GAME.md'}:{})};});
  fs.writeFileSync(path.join(pack,'manifest.json'),JSON.stringify({id:'boss9-lizard-game-20261127',approval:'User approved death v2 and game integration on 2026-11-27; retain table attack rate and accelerate combat animations. Follow the standard boss clip names and hold Walk first pose for idle.',source:'User lizard model and temporary materials; five standard runtime clips from the approved six-clip source, which retains the authoring Idle. Original death and portrait rendered in Blender; no external pixels or VFX.',files:entries},null,2)+'\n');
}
const manifest=JSON.parse(fs.readFileSync(path.join(pack,'manifest.json'),'utf8'));
assert.deepEqual(files(pack).filter(p=>path.basename(p)!=='manifest.json').map(p=>path.relative(pack,p).replaceAll('\\','/')).sort(),manifest.files.map(e=>e.path).sort());
for(const e of manifest.files){const p=path.resolve(pack,e.path);assert.ok(p.startsWith(pack+path.sep));assert.equal(hash(p),e.sha256,e.path);if(!e.project)continue;const target=path.resolve(root,e.project);assert.ok(target.startsWith(root+path.sep));if(mode==='--apply'&&e.project.startsWith('images/'))copy(p,target);if(mode!=='--stage')assert.equal(hash(target),e.sha256,e.project);}
const inputs=JSON.parse(fs.readFileSync(path.join(pack,'source/inputs.json'),'utf8'));for(const e of Object.values(inputs))assert.equal(hash(path.join(library,e.libraryPath)),e.sha256);
const build=JSON.parse(fs.readFileSync(path.join(pack,'exports/build.json'),'utf8'));assert.equal(build.sourceSHA256,inputs.glb.sha256);assert.equal(build.glbSHA256,hash(path.join(pack,'exports/boss9.glb')));assert.ok(build.binaryPreserved&&build.fiveAnimationTracksPreserved);assert.deepEqual(build.exportedClips,['Walk','Attack1','Attack2','Attack3','Die']);
const qa=JSON.parse(fs.readFileSync(path.join(pack,'qa/placement.json'),'utf8'));assert.equal(qa.samplesPerFormat,45);assert.ok(qa.uniformPlacementOnly&&Object.values(qa.maximumVertexError).every(n=>n<1e-5));
assert.equal(qa.glbSHA256,build.glbSHA256);assert.equal(qa.blendSHA256,hash(path.join(pack,'exports/boss9.blend')));
if(mode==='--check'){
const runtime=JSON.parse(fs.readFileSync(path.join(pack,'qa/runtime.json'),'utf8'));assert.equal(runtime.glbSHA256,build.glbSHA256);
assert.deepEqual(runtime.errors,[]);assert.equal(runtime.render.count,180);assert.ok(runtime.render.locomotionMetersPerSecond>0);
assert.deepEqual(runtime.warnings,[]);assert.equal(runtime.live.worker.errors,0);
assert.deepEqual(runtime.render.attacks.map(a=>a.clip),['Attack1','Attack2','Attack3']);
assert.equal(runtime.render.idle.clip,'Walk');assert.equal(runtime.render.idle.time,0);assert.equal(runtime.render.idle.paused,true);
assert.equal(runtime.render.death.time,4);assert.ok(runtime.render.death.paused&&runtime.render.death.speed===1);
assert.ok(runtime.live.entered&&runtime.live.deathLastAliveSeconds>3.4&&Number.isFinite(runtime.live.deathGoneSeconds)&&runtime.live.deathGoneSeconds>runtime.live.deathLastAliveSeconds&&runtime.live.deathGoneSeconds<6.5);
for(const clip of ['Walk','Attack1','Attack2','Attack3'])assert.ok(runtime.live.seen.includes(clip));
}
console.log('BOSS9_GAME_EXPORT_PASS',manifest.files.length,'files;',mode);
