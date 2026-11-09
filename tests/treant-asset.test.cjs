'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
function load(){const b=fs.readFileSync(require.resolve('../images/models/npc3d/treant.glb'));return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));}

for(const stage of [2,3])test('stage '+stage+' treant retains all first-stage joints, motion targets and timings with its own surface',()=>{
 const first=load(),bytes=fs.readFileSync(require.resolve('../images/models/npc3d/treant_lv'+stage+'.glb'));
 const size=bytes.readUInt32LE(12),d=JSON.parse(bytes.subarray(20,20+size)),bin=bytes.subarray(28+size);
 assert.equal(d.meshes.length,1);assert.equal(d.skins.length,1);assert.equal(d.skins[0].joints.length,58);
 const joints=j=>j.skins[0].joints.map(i=>j.nodes[i].name).sort();assert.deepEqual(joints(d),joints(first));
 assert.ok(d.nodes.every(n=>!/sword|weapon/i.test(n.name||'')));
 assert.deepEqual(d.animations.map(a=>a.name).sort(),first.animations.map(a=>a.name).sort());
 const targets=(j,a)=>a.channels.map(c=>j.nodes[c.target.node].name+':'+c.target.path);
 for(const original of first.animations){
  const actual=d.animations.find(a=>a.name===original.name);
  const duration=(j,a)=>Math.max(...a.samplers.map(s=>j.accessors[s.input].max[0]));
  assert.ok(Math.abs(duration(d,actual)-duration(first,original))<1e-5);
  const names=new Set(targets(d,actual));for(const target of targets(first,original))assert.ok(names.has(target),target);
  for(const sampler of actual.samplers){
   const a=d.accessors[sampler.output],v=d.bufferViews[a.bufferView],width={SCALAR:1,VEC3:3,VEC4:4}[a.type];
   assert.equal(a.componentType,5126);assert.ok(width);
   for(let i=0;i<a.count;i++)for(let k=0;k<width;k++)assert.ok(Number.isFinite(bin.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||width*4)+k*4)));
  }
  if(['Weapon_Combo_2','Attack','Basic_Jump'].includes(actual.name)){
   const c=actual.channels.find(c=>d.nodes[c.target.node].name==='mixamorig:Hips'&&c.target.path==='translation');
   const a=d.accessors[actual.samplers[c.sampler].output],v=d.bufferViews[a.bufferView];
   const values=Array.from({length:a.count},(_,i)=>Array.from({length:3},(_,k)=>bin.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||12)+k*4)));
   // Blender's axis conversion introduces float roundoff, far below mesh precision.
   for(const xyz of values){assert.ok(Math.abs(xyz[0]-values[0][0])<1e-6);assert.ok(Math.abs(xyz[2]-values[0][2])<1e-6);}
   assert.ok(Math.max(...values.map(v=>v[1]))>Math.min(...values.map(v=>v[1])));
  }
 }
 assert.notEqual(d.materials[0].name,first.materials[0].name,'the supplied second-stage material is used');
 assert.equal(d.accessors[d.meshes[0].primitives[0].indices].count/3,10433);
});
test('treant has one original skin, one unarmed mesh and five finite native clips; attacks are horizontally in-place',()=>{
 const d=load();assert.equal(d.meshes.length,1);assert.equal(d.skins.length,1);assert.equal(d.skins[0].joints.length,58);
 assert.ok(d.nodes.every(n=>!/sword|weapon/i.test(n.name||'')));
 const expected={'Unsteady_Walk':2.9666667,'Weapon_Combo_2':4.5,'Attack':2.8,'Basic_Jump':5.8666668,'Shot_and_Fall_Forward':2.1666667};
 assert.deepEqual(d.animations.map(a=>a.name),Object.keys(expected));
 d.animations.forEach((a,i)=>{
  assert.equal(a.channels.length,168);
  assert.ok(Math.abs(Math.max(...a.samplers.map(s=>d.accessors[s.input].max[0]))-expected[a.name])<1e-5);
  for(const s of a.samplers){for(const key of ['min','max'])assert.ok(d.accessors[s.output][key].every(Number.isFinite));}
  if(i>0&&i<4){const channel=a.channels.find(c=>c.target.path==='translation'&&d.nodes[c.target.node].name==='mixamorig:Hips');
   const hip=d.accessors[a.samplers[channel.sampler].output];assert.equal(hip.min[0],hip.max[0]);assert.equal(hip.min[2],hip.max[2]);assert.ok(hip.max[1]>hip.min[1]);}
 });
});
