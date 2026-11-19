'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const cfg = require('../tools/config_tables.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
const bosses = cfg.evalLiteral(cfg.extractLiteral(source, 'BOSS_LIST').literal);

for (const suffix of ['', '_lv2', '_lv3']) test('BOSS7' + suffix + ' keeps its textured skin and all five original motion lengths', () => {
  const bytes = fs.readFileSync(path.join(root, 'images/models/npc3d/boss7' + suffix + '.glb'));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const end = 20 + bytes.readUInt32LE(12);
  const g = JSON.parse(bytes.subarray(20, end));
  assert.equal(g.meshes.length, 1);
  assert.equal(g.skins[0].joints.length, 58);
  assert.ok(g.materials[0].pbrMetallicRoughness.baseColorTexture);
  assert.ok(g.images.every(i => Number.isInteger(i.bufferView)), 'textures are embedded');
  const expected = { Walk: .8, Attack1: 2.5, Attack2: 2.8, Attack3: 1.4, Die: 65 / 30 };
  assert.deepEqual(g.animations.map(a => a.name).sort(), Object.keys(expected).sort());
  for (const clip of g.animations) {
    assert.ok(Math.abs(Math.max(...clip.samplers.map(s => g.accessors[s.input].max[0])) - expected[clip.name]) < .001);
    assert.ok(clip.channels.some(c => g.nodes[c.target.node].name === 'mixamorig:Hips'));
    for (const sampler of clip.samplers) {
      for (const index of [sampler.input, sampler.output]) {
        const a = g.accessors[index], view = g.bufferViews[a.bufferView];
        assert.equal(a.componentType, 5126);
        const lanes = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
        assert.ok(lanes);
        for (let i = 0; i < a.count; i++) for (let k = 0; k < lanes; k++) {
          const at = end + 8 + (view.byteOffset || 0) + (a.byteOffset || 0) + i * (view.byteStride || lanes * 4) + k * 4;
          assert.ok(Number.isFinite(bytes.readFloatLE(at)), clip.name + ': finite animation values');
        }
      }
    }
  }
});

test('NPC workbook, export and note generator agree on all three 岩石怪 materials', () => {
  const csv = cfg.csvParse(fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8')).filter(r => r.length > 1);
  const xlsx = cfg.readXlsxRows(path.join(root, 'config/Excel/NPC.xlsx'));
  assert.deepEqual(xlsx, csv);
  const h = csv[0];
  for (const [id, number, suffix] of [['tower_boss_7', 1, ''], ['tower_boss_17', 2, '_lv2'], ['tower_boss_27', 3, '_lv3']]) {
    const row = csv.find(r => r[0] === id);
    assert.equal(row[h.indexOf('NPC名稱')], '岩石怪');
    assert.ok(row[h.indexOf('備註')].startsWith('外觀：岩石怪' + number + '｜'));
    const generated = cfg.SCHEMAS.NPC.extract(source).find(r => r[0] === id);
    assert.equal(generated[h.indexOf('備註')], row[h.indexOf('備註')]);
    assert.equal(row[h.indexOf('3D模型')], 'images/models/npc3d/boss7' + suffix + '.glb');
    for (const key of ['站立圖像', '移動圖像', '攻擊圖像', '死亡圖像']) assert.equal(row[h.indexOf(key)], 'sprites/boss/boss7_rock' + suffix + '.png');
    const boss = bosses.find(b => b.id === id);
    assert.equal(boss.atkSpeed, 3);
    assert.equal(boss.atkRange, 32);
    assert.equal(boss.runSpeed, 21);
    assert.equal(boss.attr, 'ice');
    assert.deepEqual(boss.skills, { ex: ['e_iceshards', 'e_waterprison'], rnd: [4, 6] });
  }
});

test('the three BOSS7 materials repeat on their own independent tower rows', () => {
  const context = { BOSS_LIST: bosses, STR: (_id, floor, name) => floor + ' ' + name,
    bossStatsFor: () => ({ level: 5, hp: 100, atk: 10, def: 5, mdef: 5, aspd: 3, dodge: 0, hit: 100, xp: 5 }),
    towerBossDefFor: f => bosses[(f - 1) % bosses.length],
    npcCombatProfile: b => ({ aspd: b.atkSpeed, runSpeed: b.runSpeed, atkRange: b.atkRange, sightRange: b.sightRange }), ELEMENTS: ['ice'] };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8'), context);
  for (const [baseFloor, suffix] of [[7, ''], [17, '_lv2'], [27, '_lv3']]) {
    for (const floor of [baseFloor, baseFloor + 50, baseFloor + 100]) {
      const boss = context.makeBoss(floor);
      assert.equal(boss.npcId, 'tower_boss_' + baseFloor);
      assert.equal(boss.name, floor + ' 岩石怪');
      assert.equal(boss.model3d.file, 'images/models/npc3d/boss7' + suffix + '.glb');
      assert.deepEqual(boss.model3d.clips, { idle: 'Walk', walk: 'Walk', attack1: 'Attack1', attack2: 'Attack2', attack3: 'Attack3', die: 'Die' });
      assert.equal(boss.maxHp, 100);
    }
    const png = fs.readFileSync(path.join(root, 'images/sprites/boss/boss7_rock' + suffix + '.png'));
    assert.equal(png.readUInt32BE(16), 1080);
    assert.equal(png.readUInt32BE(20), 1080);
    assert.equal(png[25], 6, 'RGBA portrait');
  }
  for (const index of [36, 46]) assert.equal(bosses[index].model3d, undefined, bosses[index].id);
});

test('the three materials have different base-color textures and identical animation samples', () => {
  const models = ['', '_lv2', '_lv3'].map(suffix => {
    const b = fs.readFileSync(path.join(root, 'images/models/npc3d/boss7' + suffix + '.glb'));
    const end = 20 + b.readUInt32LE(12);
    return { g: JSON.parse(b.subarray(20, end)), bin: b.subarray(end + 8) };
  });
  function textureHash({g, bin}) {
    const texture = g.materials[0].pbrMetallicRoughness.baseColorTexture.index;
    const image = g.images[g.textures[texture].source], view = g.bufferViews[image.bufferView];
    return crypto.createHash('sha256').update(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)).digest('hex');
  }
  assert.equal(new Set(models.map(textureHash)).size, 3);
  function samples({g, bin}) {
    const values = index => {
      const a = g.accessors[index], v = g.bufferViews[a.bufferView], lanes = {SCALAR:1,VEC3:3,VEC4:4}[a.type];
      return Array.from({length:a.count * lanes}, (_,i) => bin.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+Math.floor(i/lanes)*(v.byteStride||lanes*4)+(i%lanes)*4));
    };
    return Object.fromEntries(g.animations.flatMap(a => a.channels.map(c => [a.name + ':' + g.nodes[c.target.node].name + ':' + c.target.path,
      values(a.samplers[c.sampler].input).concat(values(a.samplers[c.sampler].output))])));
  }
  const baseline = samples(models[0]);
  for (const model of models.slice(1)) {
    const tracks = samples(model);
    assert.deepEqual(Object.keys(tracks).sort(), Object.keys(baseline).sort());
    for (const key of Object.keys(baseline)) {
      assert.equal(tracks[key].length, baseline[key].length, key);
      assert.ok(tracks[key].every((v,i) => Math.abs(v - baseline[key][i]) < .00005), key);
    }
  }
});
