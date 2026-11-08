'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('../tools/config_tables.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
const rows = cfg.csvParse(fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8')).filter(r => r.length > 1);
const header = rows[0], ix = name => header.indexOf(name);
const clone = () => rows.slice(1).map(r => r.slice());
const bosses = literal => cfg.evalLiteral(cfg.extractLiteral(literal, 'BOSS_LIST').literal);

test('NPC 3D metadata round-trips all tower rows and preserves their gameplay data', () => {
  const result = bosses(cfg.SCHEMAS.NPC.rebuild(clone(), header, source).BOSS_LIST);
  const current = bosses(source);
  assert.equal(result.length, 50);
  for (let i = 0; i < result.length; i++) {
    if (i % 10 < 2) {
      assert.equal(result[i].name, i % 10 === 1 ? "骷髏王Ⅱ" : "骷髏王");
      assert.equal(result[i].img, i % 10 === 1 ? 'sprites/boss/boss_skeleton_king_lv2.png' : 'sprites/boss/boss_skeleton_king.png');
      assert.ok(fs.existsSync(path.join(root, 'images', result[i].img)));
      assert.equal(result[i].model3d.file, 'images/models/npc3d/boss' + (i % 10 === 1 ? 2 : 1) + '.glb');
      assert.deepEqual(Object.values(result[i].model3d.clips), ['Walk', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']);
    } else assert.equal(result[i].model3d, undefined, 'other bosses retain their existing appearance');
    assert.equal(result[i].id, 'tower_boss_' + (i + 1));
    assert.deepEqual(result[i], current[i]);
  }
  const extracted = cfg.SCHEMAS.NPC.extract(source);
  const h = cfg.SCHEMAS.NPC.header;
  assert.equal(extracted.find(r => r[0] === 'tower_boss_1')[h.indexOf('3D攻擊2動作')], 'Attack2');
});

test('changing a clip in the NPC table changes only that boss binding', () => {
  const data = clone(), row = data.find(r => r[0] === 'tower_boss_1');
  row[ix('3D攻擊1動作')] = 'Attack3';
  const result = bosses(cfg.SCHEMAS.NPC.rebuild(data, header, source).BOSS_LIST);
  assert.equal(result[0].model3d.clips.attack1, 'Attack3');
  assert.deepEqual(result[1], bosses(source)[1]);
  assert.deepEqual(result[0].skills, bosses(source)[0].skills);
});

test('mistyped clips, missing models and model-less action bindings stop table application', () => {
  for (const [field, value, expected] of [
    ['3D攻擊2動作', 'AttackTypo', /不在 GLB 動作中/],
    ['3D模型', 'images/models/npc3d/missing.glb', /模型不存在/],
    ['3D模型', '../boss1.glb', /本機 GLB 路徑/],
    ['3D模型', '', /必須指定/]
  ]) {
    const data = clone();
    data.find(r => r[0] === 'tower_boss_1')[ix(field)] = value;
    assert.throws(() => cfg.SCHEMAS.NPC.rebuild(data, header, source), expected);
  }
});

test('empty model and clip cells clear a binding while preserving the legacy image', () => {
  const data = clone(), row = data.find(r => r[0] === 'tower_boss_1');
  for (let i = ix('3D模型'); i < header.length; i++) row[i] = '';
  const result = bosses(cfg.SCHEMAS.NPC.rebuild(data, header, source).BOSS_LIST);
  assert.equal(result[0].model3d, undefined);
  assert.equal(result[0].img, bosses(source)[0].img);
});

for (const model of ['boss1', 'boss2']) test(model + ': sword is a separate rigid mesh under the right hand and all five clips exist', () => {
  const bytes = fs.readFileSync(path.join(root, 'images/models/npc3d/' + model + '.glb'));
  const jsonSize = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString('utf8'));
  assert.deepEqual(gltf.animations.map(a => a.name).sort(), ['Attack1', 'Attack2', 'Attack3', 'Die', 'Walk']);
  const weaponIndex = gltf.nodes.findIndex(n => n.name === 'Sword_R');
  const parent = gltf.nodes.find(n => (n.children || []).includes(weaponIndex));
  assert.equal(parent.name, 'mixamorig:RightHand');
  const sword = gltf.nodes.find(n => n.name === 'BOSS1_Sword');
  const body = gltf.nodes.find(n => n.name === 'BOSS1_Body');
  assert.ok(sword && body && sword.mesh !== body.mesh);
  const cape = gltf.nodes.find(n => n.name === 'BOSS1_Cape');
  assert.ok(cape && cape.mesh !== body.mesh && cape.mesh !== sword.mesh, 'cloth is isolated from shared shoulder armor vertices');
  for (const name of ['Cape_Upper', 'Cape_Middle', 'Cape_Lower']) {
    assert.ok(gltf.nodes.some(n => n.name === name), 'missing gravity-led cloth bone: ' + name);
  }
  const skin = gltf.skins[sword.skin];
  const joint = skin.joints.indexOf(weaponIndex);
  assert.ok(joint >= 0);
  const binary = bytes.subarray(28 + jsonSize);
  function component(accessor, row, lane) {
    const a = gltf.accessors[accessor], view = gltf.bufferViews[a.bufferView];
    const size = {5121: 1, 5123: 2, 5126: 4}[a.componentType];
    const offset = (view.byteOffset || 0) + (a.byteOffset || 0) + row * (view.byteStride || size * 4) + lane * size;
    return a.componentType === 5121 ? binary.readUInt8(offset) : a.componentType === 5123 ? binary.readUInt16LE(offset) : binary.readFloatLE(offset);
  }
  for (const primitive of gltf.meshes[sword.mesh].primitives) {
    for (let v = 0; v < gltf.accessors[primitive.attributes.POSITION].count; v++) {
      const weights = Array.from({length: 4}, (_, c) => component(primitive.attributes.WEIGHTS_0, v, c));
      const joints = Array.from({length: 4}, (_, c) => component(primitive.attributes.JOINTS_0, v, c));
      assert.equal(weights.reduce((a, b) => a + b, 0), 1);
      assert.equal(weights.filter(w => w > 0).length, 1);
      assert.equal(joints[weights.findIndex(w => w > 0)], joint);
    }
  }
  const capeSkin = gltf.skins[cape.skin];
  const allowed = new Set(['mixamorig:Spine2', 'Cape_Upper', 'Cape_Middle', 'Cape_Lower']);
  const collisionBones = gltf.nodes.filter(n => /^CapeFit_\d{2}_\d{2}$/.test(n.name || ''));
  assert.equal(collisionBones.length, 135, 'armor-aware cloth grid is retained in the exported skin');
  for (const node of collisionBones) allowed.add(node.name);
  for (const primitive of gltf.meshes[cape.mesh].primitives) {
    for (let v = 0; v < gltf.accessors[primitive.attributes.POSITION].count; v++) {
      let weight = 0;
      for (let c = 0; c < 4; c++) {
        const w = component(primitive.attributes.WEIGHTS_0, v, c);
        if (w <= 0) continue;
        weight += w;
        const jointIndex = component(primitive.attributes.JOINTS_0, v, c);
        assert.ok(allowed.has(gltf.nodes[capeSkin.joints[jointIndex]].name), 'cape cannot be pulled by legs or source auxiliary bones');
      }
      assert.ok(Math.abs(weight - 1) < 1e-6);
    }
  }
});

test('second boss retains the supplied material variant instead of duplicating the first appearance', () => {
  const models = ['boss1','boss2'].map(name => {
    const bytes = fs.readFileSync(path.join(root, 'images/models/npc3d/' + name + '.glb'));
    const length = bytes.readUInt32LE(12);
    return { bytes, gltf: JSON.parse(bytes.subarray(20, 20 + length)), binaryStart: length + 28 };
  });
  const second = models[1].gltf;
  assert.ok(second.materials.some(m => m.name === 'BOSS_LV2_PBR'));
  const colorBytes = models.map(({bytes,gltf,binaryStart}) => {
    const material = gltf.materials.find(m => m.pbrMetallicRoughness.baseColorTexture);
    const texture = gltf.textures[material.pbrMetallicRoughness.baseColorTexture.index];
    const view = gltf.bufferViews[gltf.images[texture.source].bufferView];
    return bytes.subarray(binaryStart + (view.byteOffset || 0), binaryStart + (view.byteOffset || 0) + view.byteLength);
  });
  assert.equal(colorBytes[0].equals(colorBytes[1]), false);
});
