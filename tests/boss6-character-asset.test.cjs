'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

test('sixth tower boss (dark knight): one skinned mesh, sword and shield are rigid parts on their own bones, five finite clips',()=>{
 const bytes=fs.readFileSync(require.resolve('../images/models/npc3d/boss6.glb'));
 const size=bytes.readUInt32LE(12),d=JSON.parse(bytes.subarray(20,20+size)),bin=bytes.subarray(28+size);
 assert.equal(d.meshes.length,1);assert.equal(d.skins.length,1);
 const joints=d.skins[0].joints.map(i=>d.nodes[i].name);
 for(const n of ['mixamorig:Hips','mixamorig:RightHand','mixamorig:LeftForeArm','Sword_R','Shield_L'])assert.ok(joints.includes(n),n);
 const parentOf=n=>{const i=d.nodes.findIndex(x=>x.name===n);return d.nodes.find(x=>(x.children||[]).includes(i)).name;};
 assert.equal(parentOf('Sword_R'),'mixamorig:RightHand','the sword rides on the right hand');
 assert.equal(parentOf('Shield_L'),'mixamorig:LeftForeArm','the shield rides on the forearm');
 // every vertex of the sword and the shield is bound 100% to its own bone
 const prim=d.meshes[0].primitives[0],acc=a=>d.accessors[a],view=a=>d.bufferViews[acc(a).bufferView];
 const jointIdx={};d.skins[0].joints.forEach((n,i)=>jointIdx[d.nodes[n].name]=i);
 const jA=acc(prim.attributes.JOINTS_0),wA=acc(prim.attributes.WEIGHTS_0),jv=view(prim.attributes.JOINTS_0),wv=view(prim.attributes.WEIGHTS_0);
 const readJ=i=>{const o=(jv.byteOffset||0)+(jA.byteOffset||0)+i*(jv.byteStride||(jA.componentType===5123?8:4));return jA.componentType===5123?bin.readUInt16LE(o):bin[o];};
 const readW=i=>{const o=(wv.byteOffset||0)+(wA.byteOffset||0)+i*(wv.byteStride||16);return bin.readFloatLE(o);};
 let sword=0,shield=0;
 for(let i=0;i<jA.count;i++){const j0=readJ(i),w0=readW(i);if(j0===jointIdx.Sword_R&&w0>.999)sword++;if(j0===jointIdx.Shield_L&&w0>.999)shield++;}
 assert.ok(sword>500&&shield>800,'rigid sword '+sword+' / shield '+shield+' vertices');
 // the sword is rigid on the hand in every clip but the death clip, where it leaves the hand and lands on the ground
 const swordIdx=d.nodes.findIndex(n=>n.name==='Sword_R');
 const swordSpread=a=>{const c=a.channels.find(c=>c.target.node===swordIdx&&c.target.path==='translation'),o=d.accessors[a.samplers[c.sampler].output],v=d.bufferViews[o.bufferView];
  const at=(i,k)=>bin.readFloatLE((v.byteOffset||0)+(o.byteOffset||0)+i*(v.byteStride||12)+k*4);let m=0;for(let i=1;i<o.count;i++)for(let k=0;k<3;k++)m=Math.max(m,Math.abs(at(i,k)-at(0,k)));return m;};
 for(const a of d.animations){if(a.name==='Die')assert.ok(swordSpread(a)>0.5,'the sword is dropped and travels in the death clip');else assert.ok(swordSpread(a)<1e-4,a.name+': the sword stays rigid on the hand');}
 const expected={Walk:.8,Attack1:3.1666667,Attack2:5.8666668,Attack3:2.2,Die:2.9666667};
 assert.deepEqual(d.animations.map(a=>a.name).sort(),Object.keys(expected).sort());
 const hips=d.nodes.findIndex(n=>n.name==='mixamorig:Hips');
 for(const a of d.animations){
  assert.ok(Math.abs(Math.max(...a.samplers.map(s=>d.accessors[s.input].max[0]))-expected[a.name])<1e-4,a.name);
  for(const s of a.samplers){const o=d.accessors[s.output],v=d.bufferViews[o.bufferView],n={SCALAR:1,VEC3:3,VEC4:4}[o.type];
   for(let i=0;i<o.count;i++)for(let k=0;k<n;k++)assert.ok(Number.isFinite(bin.readFloatLE((v.byteOffset||0)+(o.byteOffset||0)+i*(v.byteStride||n*4)+k*4)));}
  if(['Attack1','Attack2','Attack3'].includes(a.name)){
   const c=a.channels.find(c=>c.target.node===hips&&c.target.path==='translation');const o=d.accessors[a.samplers[c.sampler].output],v=d.bufferViews[o.bufferView];
   const at=(i,k)=>bin.readFloatLE((v.byteOffset||0)+(o.byteOffset||0)+i*(v.byteStride||12)+k*4);
   for(let i=1;i<o.count;i++){assert.equal(at(i,0),at(0,0));assert.equal(at(i,2),at(0,2),a.name+' strikes stay horizontally in place');}
  }
 }
});
