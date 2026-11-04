'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(root + '/js/hero3d.js', 'utf8');
const config = JSON.parse(fs.readFileSync(root + '/images/models/hero3d/pbr/materials.json'));
const hashes = {
  role: '0ebd2dd1af1503f7236375bd5e146e84c02a01f2ac10823d2eb32a94dd27b7ad',
  role1: '54f104457683618ee328edd05749476dffd11bc093e7dbeb92619f59a55b1222',
  role2: '262c1f9f78280a09f3e0a3cb57b4896d8a540f709889f0963bd3400c96f0b089',
  role3: '663595d1f798df30df1d9630708605c82396c85195abaa9518a82c9275d4e519'
};
test('四套已核准模型逐位保持，PBR旁載貼圖均存在且配置不套到固定UV握劍手', () => {
  for (const [role, hash] of Object.entries(hashes)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(root + '/images/models/hero3d/' + role + '.glb')).digest('hex'), hash);
    const bindings = config.appearances[role].bindings;
    assert.ok(bindings.some(b => b.primitives.includes(0) && b.normal && b.metallicRoughness));
    for (const binding of bindings) for (const key of ['normal', 'metallicRoughness']) if (binding[key]) {
      assert.ok(!binding.primitives.includes(5), '新雕手部不能套整張身體法線');
      const bytes = fs.readFileSync(root + '/images/models/hero3d/pbr/' + binding[key]);
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.equal(bytes.readUInt32BE(16), 1024); assert.equal(bytes.readUInt32BE(20), 1024);
    }
  }
});
async function fixture(options = {}) {
  const T = await import(pathToFileURL(root + '/js/vendor/three/three.module.min.js'));
  const loaded = [], requested = [], disposed = [];
  class TextureLoader {
    async loadAsync(url) {
      requested.push(url);
      if (options.failMap && url.includes('normal.png')) throw Error('Map unavailable');
      // A second map finishes after the first has failed: it must be disposed.
      await new Promise(resolve => setTimeout(resolve, 5));
      const texture = new T.Texture(); texture.addEventListener('dispose', () => disposed.push(texture));
      loaded.push(texture); return texture;
    }
  }
  let fetches = 0;
  const c = vm.createContext({ URL, console, absUrl: p => 'http://localhost/' + p,
    global: { fetch: async () => { fetches++; return { ok: !options.failConfig || fetches > 1, status: 503, json: async () => config }; } } });
  const start = source.indexOf('  var PBR_URL'), end = source.indexOf('  /* 貼圖調色', start);
  assert.ok(start > 0 && end > start); vm.runInContext(source.slice(start, end), c);
  const material = new T.MeshStandardMaterial({ map: new T.Texture(), vertexColors: true });
  material.map.wrapS = T.RepeatWrapping;
  const body = new T.Mesh(new T.BufferGeometry(), material), hand = new T.Mesh(new T.BufferGeometry(), material);
  const scene = new T.Group(); scene.add(body, hand);
  const gltf = { scene, parser: { associations: new Map([[body, { primitives: 0 }], [hand, { primitives: 5 }]]) } };
  return { restore: appearance => c.restorePbrMaterials({ ...T, TextureLoader }, gltf, appearance), T, body, hand, material, loaded, requested, disposed, fetches: () => fetches };
}
test('原生PBR材質保留頂點色，法線與MR用線性色彩／glTF方向，手部共用材質不被污染', async () => {
  const f = await fixture(); assert.equal(await f.restore('role2'), true);
  assert.ok(f.body.material.isMeshStandardMaterial); assert.equal(f.body.material.vertexColors, true);
  assert.notEqual(f.body.material, f.material); assert.equal(f.hand.material, f.material);
  assert.equal(f.hand.material.normalMap, null);
  assert.equal(f.body.material.metalnessMap, f.body.material.roughnessMap);
  assert.equal(f.body.material.normalMap.wrapS, f.T.RepeatWrapping);
  for (const tex of f.loaded) { assert.equal(tex.colorSpace, f.T.NoColorSpace); assert.equal(tex.flipY, false); }
  assert.ok(f.requested.every(url => url.startsWith('http://localhost/images/models/hero3d/pbr/')));
  assert.equal(f.body.material.metalness, 1); assert.equal(f.body.material.roughness, 1);
});
test('旁載任一貼圖失敗時不部分改材質，包含晚到的貼圖也釋放；未知外觀不下載', async () => {
  const f = await fixture({ failMap: true });
  await assert.rejects(f.restore('role2'), /Map unavailable/);
  assert.equal(f.body.material, f.material); assert.equal(f.body.material.normalMap, null);
  assert.equal(f.loaded.length, 1); assert.deepEqual(f.disposed, f.loaded);
  const unknown = await fixture(); assert.equal(await unknown.restore('other'), false);
  assert.equal(unknown.fetches(), 0); assert.equal(unknown.requested.length, 0);
});
test('配置失敗可重試，成功後同頁共用配置但每個控制器擁有自己的貼圖', async () => {
  const f = await fixture({ failConfig: true });
  await assert.rejects(f.restore('role2'), /PBR config HTTP 503/);
  assert.equal(await f.restore('role2'), true); assert.equal(f.fetches(), 2);
  assert.equal(await f.restore('role2'), true); assert.equal(f.fetches(), 2);
  assert.equal(f.loaded.length, 4); assert.notEqual(f.loaded[0], f.loaded[2]);
});
test('切換外觀先釋放共享貼圖／環境再關renderer及獨立context，重複dispose安全', () => {
  const order = [], item = name => ({ dispose() { order.push(name); } });
  const texture = { ...item('texture'), isTexture: true }, material = { ...item('material'), map: texture, normalMap: texture }, geometry = item('geometry');
  const c = vm.createContext({ ctrl: {}, cape: null, mixer: { stopAllAction() { order.push('mixer'); } },
    environment: item('environment'), renderer: { ...item('renderer'), forceContextLoss() { order.push('context'); } },
    gltf: { scene: { traverse(fn) { fn({ material, geometry }); fn({ material, geometry }); } } } });
  const start = source.indexOf('    var controllerDisposed'), end = source.indexOf('    ctrl.clips =', start);
  assert.ok(start > 0 && end > start); vm.runInContext(source.slice(start, end), c);
  c.ctrl.dispose(); c.ctrl.dispose();
  assert.deepEqual(order, ['mixer', 'environment', 'geometry', 'texture', 'material', 'renderer', 'context']);
});
