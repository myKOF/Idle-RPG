'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

for (const stage of [2, 3]) test('third boss stage '+stage+' retains every joint and all five first-stage clip timings',()=>{
 function load(file){const b=fs.readFileSync(require.resolve('../images/models/npc3d/'+file+'.glb')),n=b.readUInt32LE(12);return{d:JSON.parse(b.subarray(20,20+n)),bin:b.subarray(28+n)}}
 const first=load('boss3_character').d,{d,bin}=load('boss3_character_lv'+stage);
 assert.equal(d.meshes.length,1);assert.equal(d.skins.length,1);assert.equal(d.skins[0].joints.length,47);
 const names=j=>j.skins[0].joints.map(i=>j.nodes[i].name).sort();assert.deepEqual(names(d),names(first));
 assert.deepEqual(d.animations.map(a=>a.name).sort(),first.animations.map(a=>a.name).sort());
 for(const a of d.animations){
  const original=first.animations.find(x=>x.name===a.name),duration=(j,c)=>Math.max(...c.samplers.map(s=>j.accessors[s.input].max[0]));
  assert.ok(Math.abs(duration(d,a)-duration(first,original))<1e-5);
  const targets=new Set(a.channels.map(c=>d.nodes[c.target.node].name+':'+c.target.path));
  for(const c of original.channels)assert.ok(targets.has(first.nodes[c.target.node].name+':'+c.target.path));
  for(const sampler of a.samplers){const access=d.accessors[sampler.output],v=d.bufferViews[access.bufferView],n={SCALAR:1,VEC3:3,VEC4:4}[access.type];
   assert.equal(access.componentType,5126);assert.ok(n);
   for(let i=0;i<access.count;i++)for(let k=0;k<n;k++)assert.ok(Number.isFinite(bin.readFloatLE((v.byteOffset||0)+(access.byteOffset||0)+i*(v.byteStride||n*4)+k*4)));
  }
 }
 assert.equal(d.accessors[d.meshes[0].primitives[0].indices].count/3,10452);
});

test('third boss has its own original skin and five finite clips; strikes stay horizontally in-place',()=>{
 const bytes=fs.readFileSync(require.resolve('../images/models/npc3d/boss3_character.glb'));
 const size=bytes.readUInt32LE(12),d=JSON.parse(bytes.subarray(20,20+size)),bin=bytes.subarray(28+size);
 assert.equal(d.meshes.length,1);assert.equal(d.skins.length,1);assert.equal(d.skins[0].joints.length,47);
 const expected={Running:.6333333,Basic_Jump:5.8666668,Right_Hand_Sword_Slash:1.5,Shield_Push_Left:2.3666668,Shot_and_Fall_Forward:2.1666668};
 assert.deepEqual(d.animations.map(a=>a.name),Object.keys(expected));
 for(const a of d.animations){
  assert.equal(a.channels.length,120);
  assert.ok(Math.abs(Math.max(...a.samplers.map(s=>d.accessors[s.input].max[0]))-expected[a.name])<1e-5);
  for(const s of a.samplers){
   const accessor=d.accessors[s.output],v=d.bufferViews[accessor.bufferView],n={SCALAR:1,VEC3:3,VEC4:4}[accessor.type];
   assert.equal(accessor.componentType,5126);assert.ok(n);
   for(let i=0;i<accessor.count;i++)for(let k=0;k<n;k++)assert.ok(Number.isFinite(bin.readFloatLE((v.byteOffset||0)+(accessor.byteOffset||0)+i*(v.byteStride||n*4)+k*4)));
  }
  if(!['Running','Shot_and_Fall_Forward'].includes(a.name)){
   const c=a.channels.find(c=>c.target.path==='translation'&&d.nodes[c.target.node].name==='mixamorig:Hips');
   const hip=d.accessors[a.samplers[c.sampler].output];
   assert.equal(hip.min[0],hip.max[0]);assert.equal(hip.min[2],hip.max[2]);assert.ok(hip.max[1]>hip.min[1]);
  }
 }
});
