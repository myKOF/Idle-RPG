'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
function glb(name) {
  const bytes = fs.readFileSync(path.join(root, 'images/models/hero3d', name));
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  return { bytes, json: JSON.parse(bytes.subarray(20, 20 + length)), bin: bytes.subarray(28 + length) };
}
function array(g, index) {
  const a = g.json.accessors[index], v = g.json.bufferViews[a.bufferView];
  const count = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const width = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  const read = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' }[a.componentType];
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: count }, (_, c) =>
    g.bin[read]((v.byteOffset || 0) + (a.byteOffset || 0) + i * (v.byteStride || count * width) + c * width)));
}
const knight = glb('sunbrand-knight.glb'), role = glb('role.glb');

test('新人物沿用黃金騎士所有動作、骨架、握劍與手腕資料，跑步也不替換', () => {
  assert.deepEqual(role.json.animations.slice(0, 5), knight.json.animations);
  assert.equal(role.json.animations[5].name, 'Attack4');
  assert.deepEqual(role.json.nodes, knight.json.nodes);
  assert.deepEqual(role.json.skins, knight.json.skins);
  assert.ok(role.bin.subarray(0, knight.bin.length).equals(knight.bin), '原始動畫與inverse bind二進位資料必須完全保留');
  assert.equal(crypto.createHash('sha256').update(knight.bytes).digest('hex'),
    'ad6645d1db9ebfd18240049e36d3db075ca2e3aa27b7f3c1e6e568a2ed435bc4', '保留黃金騎士原檔供未來外觀切換');
});

test('新劍劍身筆直平整、長度為附件劍身80%，全部剛性綁在原Sword骨骼', () => {
  const g = role.json;
  const sword = g.skins[0].joints.findIndex(i => g.nodes[i].name === 'Sword');
  const primitive = g.meshes[0].primitives.find(p => g.materials[p.material].name === 'Role sword flat steel');
  const positions = array(role, primitive.attributes.POSITION);
  const inv = array(role, g.skins[0].inverseBindMatrices)[sword];
  const local = positions.map(p => [0, 1, 2].map(k => inv[k] * p[0] + inv[4 + k] * p[1] + inv[8 + k] * p[2] + inv[12 + k]));
  const ys = local.map(p => p[1]);
  const length = (Math.max(...ys) - Math.min(...ys)) / 100;
  assert.ok(Math.abs(length / .9245084002614021 - .8) < 1e-6);
  const grip = g.asset.extras.gripFrame;
  for (const p of local) {
    assert.ok(Math.abs(p[2] - grip.bladeRootInSword[2]) <= .351, '平整劍面厚度不得出現凹陷');
    assert.ok(Math.abs(p[0] - grip.bladeRootInSword[0]) <= 2.601, '劍身中心線保持筆直');
  }
  for (const p of g.meshes[0].primitives.filter(p => g.materials[p.material].name === 'Role sword flat steel' ||
      array(role, p.attributes.JOINTS_0).every(j => j[0] === sword))) {
    assert.ok(array(role, p.attributes.JOINTS_0).every(j => j[0] === sword));
    assert.ok(array(role, p.attributes.WEIGHTS_0).every(w => w[0] === 1 && w.slice(1).every(x => x === 0)));
  }
});

test('所有新網格索引、權重、貼圖與材質有效，人體不混入Sword權重', () => {
  const g = role.json, sword = g.skins[0].joints.findIndex(i => g.nodes[i].name === 'Sword');
  assert.ok(role.bytes.length < 5 * 1024 * 1024);
  for (const p of g.meshes[0].primitives) {
    const pos = array(role, p.attributes.POSITION), weights = array(role, p.attributes.WEIGHTS_0);
    assert.ok(pos.every(v => v.every(Number.isFinite)));
    const indices = array(role, p.indices).flat();
    assert.equal(indices.length % 3, 0);
    assert.ok(indices.every(i => i >= 0 && i < pos.length));
    assert.ok(weights.every(w => Math.abs(w.reduce((a, b) => a + b) - 1) < 1e-5));
    if (g.materials[p.material].name.startsWith('Role cloth')) {
      const joints = array(role, p.attributes.JOINTS_0);
      // The separately textured hilt uses this material too.
      if (!joints.every(j => j[0] === sword)) assert.ok(joints.every((j, i) => j.every((v, k) => v !== sword || weights[i][k] === 0)));
    }
  }
  assert.equal(g.asset.extras.appearance, 'role');
  assert.equal(g.asset.extras.capeCollision, false);
  assert.equal(g.asset.extras.textureGrade, false);
  assert.equal(g.asset.extras.gripFrame.type, 'closed-diagonal-palm-grip');
  assert.match(fs.readFileSync(path.join(root, 'js/hero3d.js'), 'utf8'), /MODEL_URL = 'images\/models\/hero3d\/role\.glb\?v=/);
});
