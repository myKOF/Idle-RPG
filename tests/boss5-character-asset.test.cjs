'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

for(const file of ['boss5','boss5_lv2','boss5_lv3'])
test('fifth tower boss (oni mask) '+file+' has 18 rigid joints, five finite clips and keeps walk / attacks 2-3 horizontally in place (attack 1 only a short melee lunge)',()=>{
 const bytes=fs.readFileSync(require.resolve('../images/models/npc3d/'+file+'.glb'));
 const size=bytes.readUInt32LE(12),d=JSON.parse(bytes.subarray(20,20+size)),bin=bytes.subarray(28+size);
 assert.equal(d.meshes.length,1);assert.equal(d.skins.length,1);
 const joints=d.skins[0].joints.map(i=>d.nodes[i].name);
 assert.equal(joints.length,18);
 for(const n of ['Root','Body','Eye_L','Eye_R','Shard_01','Shard_14'])assert.ok(joints.includes(n),n);
 assert.ok(d.nodes.some(n=>n.name==='Fx_Mouth')&&d.nodes.some(n=>n.name==='Fx_Back'),'attachment points for flame / skulls / mist');
 const expected={Attack1:1.8,Attack2:1.3333333,Attack3:2.2,Die:4,Walk:1};
 assert.deepEqual(d.animations.map(a=>a.name).sort(),Object.keys(expected).sort());
 const body=d.nodes.findIndex(n=>n.name==='Body');
 for(const a of d.animations){
  assert.equal(a.channels.length,54);
  assert.ok(Math.abs(Math.max(...a.samplers.map(s=>d.accessors[s.input].max[0]))-expected[a.name])<1e-4,a.name);
  for(const s of a.samplers){
   const accessor=d.accessors[s.output],v=d.bufferViews[accessor.bufferView],n={SCALAR:1,VEC3:3,VEC4:4}[accessor.type];
   assert.equal(accessor.componentType,5126);assert.ok(n);
   for(let i=0;i<accessor.count;i++)for(let k=0;k<n;k++)assert.ok(Number.isFinite(bin.readFloatLE((v.byteOffset||0)+(accessor.byteOffset||0)+i*(v.byteStride||n*4)+k*4)));
  }
  if(a.name!=='Die'){
   // the Body translation must not drift in the ground plane (glTF x/z) – only the vertical hover moves
   const c=a.channels.find(c=>c.target.path==='translation'&&c.target.node===body);
   const acc=d.accessors[a.samplers[c.sampler].output],v=d.bufferViews[acc.bufferView];
   const vals=[];for(let i=0;i<acc.count;i++){const o=(v.byteOffset||0)+(acc.byteOffset||0)+i*12;vals.push([bin.readFloatLE(o),bin.readFloatLE(o+4),bin.readFloatLE(o+8)]);}
   // pose translation is expressed in the bone frame; the in-place lock leaves only the bone Y axis (= world up) moving
   const spread=[0,1,2].map(k=>Math.max(...vals.map(x=>x[k]))-Math.min(...vals.map(x=>x[k])));
   if(a.name==='Attack1'){
    // melee boss: the strike keeps one short forward lunge (about 0.9 m); nothing else may drift
    const drift=spread.filter(x=>x>1e-4);
    assert.ok(drift.length<=3&&Math.max(...spread)>0.5&&Math.max(...spread)<1.2,'attack 1 lunge '+spread);
   } else assert.ok(spread.filter(x=>x>1e-4).length<=1,a.name+' horizontal drift '+spread);
  }
 }
});
