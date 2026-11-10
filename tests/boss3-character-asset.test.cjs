'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

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
