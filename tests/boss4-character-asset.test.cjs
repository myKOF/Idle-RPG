'use strict';
// Fourth tower boss (spear centaur): three textured GLBs share one rig and five clips; the spear is rigid on weapon_r.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const cfg = require('../tools/config_tables.cjs');

function load(file) {
  const bytes = fs.readFileSync(path.join(root, 'images/models/npc3d', file + '.glb'));
  const size = bytes.readUInt32LE(12);
  return { d: JSON.parse(bytes.subarray(20, 20 + size)), bin: bytes.subarray(28 + size) };
}
function read(d, bin, index, row, lane) {
  const a = d.accessors[index], v = d.bufferViews[a.bufferView];
  const size = { 5121: 1, 5123: 2, 5126: 4 }[a.componentType], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const o = (v.byteOffset || 0) + (a.byteOffset || 0) + row * (v.byteStride || size * n) + lane * size;
  return a.componentType === 5121 ? bin.readUInt8(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : bin.readFloatLE(o);
}

for (const file of ['boss4', 'boss4_lv2', 'boss4_lv3']) test(file + ': textured centaur with 56 joints, the five tower clips and a rigid spear on weapon_r', () => {
  const { d, bin } = load(file);
  assert.equal(d.skins.length, 1);
  const joints = d.skins[0].joints.map(i => d.nodes[i].name);
  assert.equal(joints.length, 56);
  for (const n of ['root', 'hips', 'upper_chest', 'upper_head', 'hand_r', 'weapon_r', 'front_leg_foot_l', 'back_leg_foot_r']) assert.ok(joints.includes(n), n);
  const weapon = d.nodes.findIndex(n => n.name === 'weapon_r');
  assert.equal(d.nodes.find(n => (n.children || []).includes(weapon)).name, 'hand_r', 'the spear socket hangs under the right hand');
  assert.ok((d.images || []).length >= 1, 'keeps the textures');
  const expected = { Walk: 0.958, Attack1: 1.5, Attack2: 1.5, Attack3: 2.25, Die: 3.0 };
  assert.deepEqual(d.animations.map(a => a.name).sort(), Object.keys(expected).sort());
  for (const a of d.animations) {
    const end = Math.max(...a.samplers.map(s => d.accessors[s.input].max[0]));
    assert.ok(Math.abs(end - expected[a.name]) < 0.05, a.name + ' length ' + end);
    for (const s of a.samplers) {
      const acc = d.accessors[s.output], n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[acc.type];
      for (let i = 0; i < acc.count; i++) for (let k = 0; k < n; k++) assert.ok(Number.isFinite(read(d, bin, s.output, i, k)));
    }
  }
  // every spear vertex is skinned 100% to weapon_r (it never bends with the arm)
  const prim = d.meshes[0].primitives[0], J = prim.attributes.JOINTS_0, W = prim.attributes.WEIGHTS_0;
  const wj = d.skins[0].joints.indexOf(weapon);
  let rigid = 0;
  for (let i = 0; i < d.accessors[J].count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (read(d, bin, J, i, k) === wj) w += read(d, bin, W, i, k);
    if (w > 0) { assert.ok(w > 0.999, 'vertex ' + i + ' is only partly on the spear'); rigid++; }
  }
  assert.ok(rigid > 600, 'spear vertices bound: ' + rigid);
});

test('NPC table: tower_boss_4 / 14 / 24 use the centaur looks and every new-model boss names its look in 備註', () => {
  const rows = cfg.csvParse(fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8')).filter(r => r.length > 1);
  const h = rows[0], ix = n => h.indexOf(n);
  const look = { boss1: '骷髏王', boss2: '樹人', boss3: '雷霆巨獸', boss4: '半人馬', boss5: '鬼面', boss6: '深淵領主', boss7: '岩石怪' };
  let named = 0;
  for (const r of rows.slice(1)) {
    const m = /npc3d\/(boss\d)(?:_lv(\d))?\.glb$/.exec(r[ix('3D模型')] || '');
    if (!m) continue;
    assert.ok(r[ix('備註')].startsWith('外觀：' + look[m[1]] + (m[2] || '1') + '｜'), r[0] + ': ' + r[ix('備註')].slice(0, 20));
    named++;
  }
  assert.ok(named >= 22);
  for (const [id, suf, name] of [['tower_boss_4', '', '角獸騎士'], ['tower_boss_14', '_lv2', '角獸騎士Ⅱ'], ['tower_boss_24', '_lv3', '角獸騎士Ⅲ']]) {
    const r = rows.find(x => x[0] === id);
    assert.equal(r[ix('3D模型')], 'images/models/npc3d/boss4' + suf + '.glb');
    assert.equal(r[ix('站立圖像')], 'sprites/boss/boss4_centaur' + suf + '.png');
    // 使用者 2026-11-18：名稱與技能改成符合持長槍的半人馬（衝鋒＋閃電矛）；屬性、數值不變
    assert.equal(r[ix('NPC名稱')], name);
    assert.equal(r[ix('外觀')], '🐎');
    assert.equal(r[ix('專屬技能')], 'e_charge;e_lightningspear');
    assert.equal(r[ix('屬性')], 'lightning');
  }
});
