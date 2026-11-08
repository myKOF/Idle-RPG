'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
function load(){const b=fs.readFileSync(require.resolve('../images/models/npc3d/treant.glb'));return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));}
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
