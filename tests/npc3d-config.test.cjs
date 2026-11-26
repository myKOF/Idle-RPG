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
    if (i === 1 || i === 11 || i === 21) {
      const suffix = i === 1 ? '' : '_lv' + (i === 11 ? 2 : 3);
      assert.equal(result[i].name, current[i].name, 'round-trip preserves the current authoritative NPC name');
      assert.equal(result[i].img, 'sprites/boss/boss_treant' + suffix + '.png');
      assert.equal(result[i].model3d.file, 'images/models/npc3d/boss2' + suffix + '.glb');
      assert.deepEqual(Object.values(result[i].model3d.clips), ['Walk', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']);
    } else if (i === 2 || i === 12 || i === 22) {
      const suffix = i === 2 ? '' : '_lv' + (i === 12 ? 2 : 3);
      assert.equal(result[i].name, current[i].name);
      assert.equal(result[i].img, 'sprites/boss/boss3_character' + suffix + '.png');
      assert.equal(result[i].model3d.file, 'images/models/npc3d/boss3' + suffix + '.glb');
      assert.deepEqual(Object.values(result[i].model3d.clips), ['Walk', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']);
    } else if (i === 3 || i === 13 || i === 23) {
      const suf = i === 3 ? '' : '_lv' + (i === 13 ? 2 : 3);
      assert.equal(result[i].name, current[i].name);
      assert.equal(result[i].atkSpeed, 0.4);
      assert.equal(result[i].atkRange, 5);
      assert.equal(result[i].img, 'sprites/boss/boss4_centaur' + suf + '.png');
      assert.ok(fs.existsSync(path.join(root, 'images', result[i].img)));
      assert.equal(result[i].model3d.file, 'images/models/npc3d/boss4' + suf + '.glb');
      assert.deepEqual(Object.values(result[i].model3d.clips), ['Walk', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']);
    } else if (i === 4 || i === 14 || i === 24) {
      const suf = i === 4 ? '' : '_lv' + (i === 14 ? 2 : 3);
      assert.equal(result[i].name, current[i].name);
      assert.equal(result[i].img, 'sprites/boss/boss5_oni' + suf + '.png');
      assert.ok(fs.existsSync(path.join(root, 'images', result[i].img)));
      assert.equal(result[i].model3d.file, 'images/models/npc3d/boss5' + suf + '.glb');
      assert.deepEqual(Object.values(result[i].model3d.clips), ['Walk', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']);
    } else if (i === 5 || i === 15 || i === 25) {
      const suffix = { 5: '', 15: '_lv2', 25: '_lv3' }[i];
      assert.equal(result[i].name, '深淵領主');
      assert.equal(result[i].attr, 'dark');
      assert.equal(result[i].elem, null);
      assert.equal(result[i].atkSpeed, 0.4);
      assert.equal(result[i].atkRange, 5);
      assert.deepEqual(result[i].skills.ex, ['e_darkzone', 'e_darkorbs']);
      assert.equal(result[i].img, 'sprites/boss/boss6_abyss' + suffix + '.png');
      assert.ok(fs.existsSync(path.join(root, 'images', result[i].img)));
      assert.equal(result[i].model3d.file, 'images/models/npc3d/boss6' + suffix + '.glb');
      assert.deepEqual(Object.values(result[i].model3d.clips), ['Walk', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']);
    } else if (i === 6 || i === 16 || i === 26) {
      const suffix = i === 6 ? '' : '_lv' + (i === 16 ? 2 : 3);
      assert.equal(result[i].name, current[i].name, 'round-trip preserves the current authoritative NPC name');
      assert.equal(result[i].img, 'sprites/boss/boss7_rock' + suffix + '.png');
      assert.equal(result[i].model3d.file, 'images/models/npc3d/boss7' + suffix + '.glb');
      assert.deepEqual(Object.values(result[i].model3d.clips), ['Walk', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']);
    } else if (i === 7 || i === 17 || i === 27) {
      const suffix = { 7: '', 17: '_lv2', 27: '_lv3' }[i];
      assert.equal(result[i].name, '石像鬼');
      assert.equal(result[i].img, 'sprites/boss/boss8_gargoyle' + suffix + '.png');
      assert.equal(result[i].model3d.file, 'images/models/npc3d/boss8' + suffix + '.glb');
      assert.deepEqual(Object.values(result[i].model3d.clips), ['Walk', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']);
    } else if (i === 8 || i === 18 || i === 28) {
      const suffix = { 8: '', 18: '_lv2', 28: '_lv3' }[i];
      assert.equal(result[i].model3d.file, 'images/models/npc3d/boss9' + suffix + '.glb');
      assert.deepEqual(Object.values(result[i].model3d.clips), ['Walk', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']);
      assert.equal(result[i].img, 'sprites/boss/boss9_lizard' + suffix + '.png');
      assert.equal(result[i].atkSpeed, 3);
    } else if (i === 9 || i === 19 || i === 29) {
      const suffix = { 9: '', 19: '_lv2', 29: '_lv3' }[i];
      assert.equal(result[i].name, '熔岩巨人');
      assert.equal(result[i].img, 'sprites/boss/boss10_lava' + suffix + '.png');
      assert.equal(result[i].model3d.file, 'images/models/npc3d/boss10' + suffix + '.glb');
      assert.deepEqual(Object.values(result[i].model3d.clips), ['Walk', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']);
    } else if (i % 10 < 2) {
      const variant = i % 10 + 1;
      assert.equal(result[i].name, ['骷髏王', '骷髏王Ⅱ', '骷髏王Ⅲ'][variant - 1]);
      assert.equal(result[i].img, 'sprites/boss/boss_skeleton_king' + (variant === 1 ? '' : '_lv' + variant) + '.png');
      assert.ok(fs.existsSync(path.join(root, 'images', result[i].img)));
      assert.equal(result[i].model3d.file, 'images/models/npc3d/boss1' + (variant === 1 ? '' : '_lv' + variant) + '.glb');
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

for (const model of ['boss1', 'boss1_lv2', 'boss1_lv3']) test(model + ': sword is a separate rigid mesh under the right hand and all five clips exist', () => {
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

test('all three bosses retain distinct supplied base-color textures', () => {
  const models = ['boss1','boss1_lv2','boss1_lv3'].map(name => {
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
  for (let i = 0; i < colorBytes.length; i++) {
    for (let j = i + 1; j < colorBytes.length; j++) assert.equal(colorBytes[i].equals(colorBytes[j]), false);
  }
});

test('every tower boss 3D binding uses bossN[_lvM].glb and the standard clip names Walk / Attack1-3 / Die', () => {
  const bound = bosses(source).filter(b => b.model3d);
  assert.ok(bound.length >= 16);
  for (const b of bound) {
    assert.match(b.model3d.file, /^images\/models\/npc3d\/boss\d+(_lv[23])?\.glb$/, b.id);
    const expected = { idle: 'Walk', walk: 'Walk', attack1: 'Attack1', attack2: 'Attack2', attack3: 'Attack3', die: 'Die' };
    assert.deepEqual(b.model3d.clips, expected, b.id);
    const bytes = fs.readFileSync(path.join(root, b.model3d.file));
    const names = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12))).animations.map(a => a.name).sort();
    assert.deepEqual(names, [...new Set(Object.values(expected))].sort(), b.model3d.file);
  }
  const files = fs.readdirSync(path.join(root, 'images/models/npc3d')).filter(f => f.endsWith('.glb'));
  for (const f of files) assert.match(f, /^boss\d+(_lv[23])?\.glb$/, 'no old-style model name is left: ' + f);
});
