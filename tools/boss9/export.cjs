'use strict';
// Asset-stage delivery: verify the library and its production tools without installing an NPC.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {resolveLibraryRoot}=require('../vfx/vfx-library-root.cjs');
const project=path.resolve(__dirname,'../..');
const library=path.join(resolveLibraryRoot({libraryId:'effects-materials'}).root,'codex-authored/boss9-dragon-20261119');
const manifest=JSON.parse(fs.readFileSync(path.join(library,'manifest.json'),'utf8'));
const hash=(bytes,file)=>crypto.createHash('sha256').update(/\.(?:py|js|cjs|html|json|md)$/.test(file)?bytes.toString('utf8').replace(/\r\n/g,'\n'):bytes).digest('hex');
for(const entry of manifest.files){
 const source=path.resolve(library,entry.source);assert.ok(source.startsWith(library+path.sep),'Unsafe library source');
 assert.equal(hash(fs.readFileSync(source),entry.source),entry.sha256,entry.source);
 if(entry.project){const target=path.resolve(project,entry.project);assert.ok(target.startsWith(project+path.sep));assert.equal(hash(fs.readFileSync(target),entry.project),entry.sha256,entry.project);}
}
const bytes=fs.readFileSync(path.join(library,'exports/boss9.glb'));
const jsonLength=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonLength));
const bin=bytes.subarray(28+jsonLength);
assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(8),bytes.length);
assert.equal(gltf.animations.length,5);assert.equal(gltf.skins[0].joints.length,65);
assert.equal(gltf.nodes.filter(n=>n.name==='MouthSocket').length,1);
for(let i=24;i<=30;i++)assert.ok(!gltf.nodes.some(n=>n.name==='Bone_'+String(i).padStart(3,'0')));
const durations={Walk:1.6,Attack1:1.5,Attack2:1.2,Attack3:3,Die:2.5};
for(const a of gltf.animations){
 const duration=Math.max(...a.samplers.map(s=>gltf.accessors[s.input].max[0]));assert.ok(Math.abs(duration-durations[a.name])<.00001,a.name);
 for(const s of a.samplers){const accessor=gltf.accessors[s.output],view=gltf.bufferViews[accessor.bufferView];assert.equal(accessor.componentType,5126);
  const components={SCALAR:1,VEC3:3,VEC4:4}[accessor.type],offset=(view.byteOffset||0)+(accessor.byteOffset||0);
  for(let i=0;i<accessor.count*components;i++)assert.ok(Number.isFinite(bin.readFloatLE(offset+i*4)),a.name+' nonfinite');}
}
const capture=JSON.parse(fs.readFileSync(path.join(library,'qa/capture.json'),'utf8'));
assert.deepEqual(capture.errors,[]);assert.deepEqual(capture.warnings,[]);
assert.ok(Math.max(...capture.particleSamples.map(x=>x.maxDistance))>29.9);
assert.ok(capture.particleSamples.every(x=>x.maxDistance<=30));
assert.equal(capture.particleSamples.at(-1).alive,0);
const validation=JSON.parse(fs.readFileSync(path.join(library,'exports/validation.json'),'utf8'));
assert.ok(validation.clips.Die.contactRegions.torso[0]<.4);
console.log('BOSS9_ASSET_PACKAGE_PASS',manifest.files.length,'files, five clips, single tail, finite tracks, particle range, floor contact');
