'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cfg = require('../tools/config_tables.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
const bosses = cfg.evalLiteral(cfg.extractLiteral(source, 'BOSS_LIST').literal);

for(const suffix of ['', '_lv2']) test('formal BOSS8'+suffix+' keeps its normal-mapped material, final tail rig and five approved animation lengths', () => {
  const bytes = fs.readFileSync(path.join(root, 'images/models/npc3d/boss8'+suffix+'.glb'));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const end = 20 + bytes.readUInt32LE(12), g = JSON.parse(bytes.subarray(20, end)), bin = bytes.subarray(end+8);
  assert.equal(g.meshes.length, 1);
  assert.equal(g.skins[0].joints.length, 70);
  assert.ok(g.materials[0].normalTexture, 'the formal material has its supplied normal map');
  assert.ok(g.materials[0].pbrMetallicRoughness.baseColorTexture);
  assert.ok(g.materials[0].pbrMetallicRoughness.metallicRoughnessTexture);
  assert.ok(g.images.every(i => Number.isInteger(i.bufferView)));
  const expected = { Walk: 1.6, Attack1: 2.6/1.5, Attack2: 2.08, Attack3: 2.4, Die: 113/30 };
  assert.deepEqual(g.animations.map(a => a.name).sort(), Object.keys(expected).sort());
  const values = index => {
    const a = g.accessors[index], v = g.bufferViews[a.bufferView], lanes = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    assert.equal(a.componentType, 5126);
    return Array.from({ length: a.count }, (_,i) => Array.from({ length: lanes }, (_,k) => {
      const at = (v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||lanes*4)+k*4;
      assert.ok(at+4<=bin.length);
      const value = bin.readFloatLE(at); assert.ok(Number.isFinite(value)); return value;
    }));
  };
  for (const clip of g.animations) {
    assert.ok(Math.abs(Math.max(...clip.samplers.map(s => g.accessors[s.input].max[0]))-expected[clip.name])<.0001);
    for (let i=15;i<=22;i++) assert.ok(clip.channels.some(c => g.nodes[c.target.node].name==='Bone_'+String(i).padStart(3,'0') && c.target.path==='rotation'));
    for (const c of clip.channels) {
      const sampler=clip.samplers[c.sampler], times=values(sampler.input).flat(), track=values(sampler.output);
      assert.equal(times.length,track.length);
      assert.ok(times.every((t,i)=>!i || t>times[i-1]));
      if(c.target.path==='rotation') for(const q of track) assert.ok(Math.abs(Math.hypot(...q)-1)<.00001);
      if(clip.name!=='Die') {
        const a=track[0], b=track.at(-1), sign=c.target.path==='rotation' && a.reduce((s,x,i)=>s+x*b[i],0)<0 ? -1 : 1;
        assert.ok(a.every((x,i)=>Math.abs(x-sign*b[i])<.0001),clip.name+' must return to its flight pose');
      }
    }
  }
});

for(const [id,number,suffix] of [['tower_boss_8',1,''],['tower_boss_18',2,'_lv2']]) test('NPC source and exports bind 石像鬼 material '+number, () => {
  const rows = cfg.csvParse(fs.readFileSync(path.join(root,'config/CSV/NPC.csv'),'utf8')).filter(r=>r.length>1);
  assert.deepEqual(cfg.readXlsxRows(path.join(root,'config/Excel/NPC.xlsx')),rows);
  const h=rows[0], row=rows.find(r=>r[0]===id);
  assert.equal(row[h.indexOf('NPC名稱')],'石像鬼');
  assert.ok(row[h.indexOf('備註')].startsWith('外觀：石像鬼'+number+'｜'));
  const generated=cfg.SCHEMAS.NPC.extract(source).find(r=>r[0]===id);
  for(const key of ['NPC名稱','備註','3D模型','3D站立動作','3D移動動作','3D攻擊1動作','3D攻擊2動作','3D攻擊3動作','3D死亡動作'])
    assert.equal(generated[h.indexOf(key)],row[h.indexOf(key)],key);
  assert.equal(row[h.indexOf('3D模型')],'images/models/npc3d/boss8'+suffix+'.glb');
  for(const name of ['站立圖像','移動圖像','攻擊圖像','死亡圖像']) assert.equal(row[h.indexOf(name)],'sprites/boss/boss8_gargoyle'+suffix+'.png');
  const boss=bosses.find(b=>b.id===id);
  assert.equal(boss.name,'石像鬼');
  assert.equal(boss.attr,'light');
  assert.equal(boss.atkSpeed,3);
  assert.equal(boss.atkRange,32);
  assert.equal(boss.runSpeed,21);
  assert.deepEqual(boss.skills,{ex:['e_fireball','e_heal'],rnd:[4,6]});
});

for(const [baseFloor,suffix] of [[8,''],[18,'_lv2']]) test('gargoyle '+baseFloor+' repeats on its own tower row', () => {
  const context={ BOSS_LIST:bosses,STR:(_id,floor,name)=>floor+' '+name,
    bossStatsFor:()=>({level:5,hp:100,atk:10,def:5,mdef:5,aspd:3,dodge:0,hit:100,xp:5}),
    towerBossDefFor:f=>bosses[(f-1)%bosses.length],npcCombatProfile:b=>({aspd:b.atkSpeed,runSpeed:b.runSpeed,atkRange:b.atkRange,sightRange:b.sightRange}),ELEMENTS:['light'] };
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/tower.js'),'utf8'),context);
  for(const floor of [baseFloor,baseFloor+50,baseFloor+100]) {
    const boss=context.makeBoss(floor);
    assert.equal(boss.npcId,'tower_boss_'+baseFloor);
    assert.equal(boss.name,floor+' 石像鬼');
    assert.equal(boss.model3d.file,'images/models/npc3d/boss8'+suffix+'.glb');
    assert.deepEqual(boss.model3d.clips,{idle:'Walk',walk:'Walk',attack1:'Attack1',attack2:'Attack2',attack3:'Attack3',die:'Die'});
    assert.equal(boss.maxHp,100);
  }
  for(const i of [27,37,47]) {assert.equal(bosses[i].model3d,undefined);assert.equal(bosses[i].name,'聖焰審判官');}
  const png=fs.readFileSync(path.join(root,'images/sprites/boss/boss8_gargoyle'+suffix+'.png'));
  assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1080);assert.equal(png[25],6);
});

test('the two gargoyle materials retain distinct supplied base-color textures', () => {
  const crypto=require('node:crypto');
  const hashes=['','_lv2'].map(suffix=>{
    const b=fs.readFileSync(path.join(root,'images/models/npc3d/boss8'+suffix+'.glb'));
    const end=20+b.readUInt32LE(12),g=JSON.parse(b.subarray(20,end)),bin=b.subarray(end+8);
    const texture=g.materials[0].pbrMetallicRoughness.baseColorTexture.index;
    const image=g.images[g.textures[texture].source],view=g.bufferViews[image.bufferView];
    return crypto.createHash('sha256').update(bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength)).digest('hex');
  });
  assert.equal(new Set(hashes).size,2);
});
