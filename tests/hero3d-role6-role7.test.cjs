'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'images/models/hero3d');
function glb(file) {
  const bytes = fs.readFileSync(file), length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length)), binary = bytes.subarray(28 + length);
  function array(index) {
    const a = json.accessors[index], v = json.bufferViews[a.bufferView];
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const result = [];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < components; c++) {
      const at = (v.byteOffset || 0) + (a.byteOffset || 0) + i * (v.byteStride || size * components) + c * size;
      result.push(a.componentType === 5126 ? binary.readFloatLE(at) : a.componentType === 5125 ? binary.readUInt32LE(at) : a.componentType === 5123 ? binary.readUInt16LE(at) : binary[at]);
    }
    return result;
  }
  return { bytes, json, array };
}
const six = glb(path.join(directory, 'role6.glb')), seven = glb(path.join(directory, 'role7.glb'));
const report = n => JSON.parse(fs.readFileSync(path.join(directory, 'role' + n + '.json'), 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('正式Role6為已確認候選原檔；Role7保留六條動作、原骨架及Sword握點', () => {
  assert.equal(hash(six.bytes), 'a051e9dd30526b5934110e17d3d4a9a814e5eb30c85a371fac60584aaca09a1c');
  assert.deepEqual(six.bytes, fs.readFileSync(path.join(root, 'tools/meshy-pipeline/candidates/role6-20261109/role6.glb')));
  assert.equal(hash(seven.bytes), report(7).outputSha256);
  assert.deepEqual(seven.json.nodes, six.json.nodes);
  assert.deepEqual(seven.array(seven.json.skins[0].inverseBindMatrices), six.array(six.json.skins[0].inverseBindMatrices));
  assert.deepEqual(seven.json.asset.extras.gripFrame, six.json.asset.extras.gripFrame);
  assert.equal(seven.json.animations.length, 6);
  for (let i = 0; i < 6; i++) {
    const a = six.json.animations[i], b = seven.json.animations[i];
    assert.equal(b.name, a.name); assert.deepEqual(b.channels, a.channels);
    for (let k = 0; k < a.samplers.length; k++) {
      assert.equal(b.samplers[k].interpolation, a.samplers[k].interpolation);
      for (const field of ['input', 'output']) assert.deepEqual(seven.array(b.samplers[k][field]), six.array(a.samplers[k][field]));
    }
  }
});

test('七轉原手／獨立手甲、背盾移除及左盾幾何與六轉逐位相同，只有新劍換形', () => {
  const a = report(6), b = report(7), [start, end] = a.weaponPrimitiveRange;
  const offset = b.weaponPrimitiveRange[1] - end;
  for (let i = 0; i < six.json.meshes[0].primitives.length; i++) {
    if (i >= start && i < end) continue;
    const p = six.json.meshes[0].primitives[i], q = seven.json.meshes[0].primitives[i < start ? i : i + offset];
    assert.deepEqual(seven.array(q.indices), six.array(p.indices));
    for (const key of Object.keys(p.attributes)) assert.deepEqual(seven.array(q.attributes[key]), six.array(p.attributes[key]));
  }
  assert.notEqual(b.approvedSwordSha256, a.approvedSwordSha256);
  const names = seven.json.skins[0].joints.map(i => seven.json.nodes[i].name);
  for (const [range, bone] of [[b.weaponPrimitiveRange, 'Sword'], [b.shield.primitiveRange, 'LeftForeArm'], [b.shield.strapPrimitiveRange, 'LeftForeArm']]) {
    for (const p of seven.json.meshes[0].primitives.slice(...range)) {
      const joints = seven.array(p.attributes.JOINTS_0), weights = seven.array(p.attributes.WEIGHTS_0);
      for (let i = 0; i < weights.length; i += 4) {
        assert.equal(joints[i], names.indexOf(bone));
        assert.deepEqual(weights.slice(i, i + 4), [1, 0, 0, 0]);
      }
    }
  }
  assert.equal(b.shield.rodLengthRatio, .3);
});

test('六／七轉完整旁載原PBR；七轉換圖沒有改色或重壓縮', () => {
  const expected = { base: '836f82da1674ee517192dfef3a4d682a4abf880ad248025bf2ee70d4c2d545d2', normal: '23dcc9bde0c26be0503c305b069833719fdd946c4dbdaea2a61c850c3ac4ad2e', mr: '67335bd2b1640c3bf1265fb346222612e94cb0203f3bf6b286b7193bdca23103' };
  for (const [n, model] of [[6, six], [7, seven]]) {
    assert.equal(model.json.asset.extras.pbrExternal, true);
    for (const image of model.json.images) {
      assert.match(image.uri, new RegExp('^role' + n + '/.*\\?v='));
      assert.ok(fs.statSync(path.join(directory, image.uri.split('?')[0])).size > 1_000_000);
    }
    for (const [kind, image] of Object.entries(report(n).originalTextures)) {
      const actual = hash(fs.readFileSync(path.join(directory, image.file)));
      assert.equal(actual, image.sha256);
      if (n === 7) assert.equal(actual, expected[kind]);
    }
  }
});
