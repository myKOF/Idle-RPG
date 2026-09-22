'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');
const { drawSprite } = require('../tools/vfx/preset-render.cjs');
const { decodePng } = require('../tools/vfx/vfx-raster.cjs');
const preset = require('../vfx/presets/proj-firehunt-ring.json');
const shipped = require('../vfx/shipped-assets.json');

// Exercise the real Runtime/Core and shipped textures, including overlapping delayed volleys.
function renderStress(onFrame, options = {}) {
  const textures = new Map(preset.layers.map(layer => {
    const asset = shipped.assets.find(a => a.assetId === layer.assetId);
    return [layer.assetId, decodePng(fs.readFileSync(path.join(__dirname, '..', shipped.baseUrl, asset.relativePath)))];
  }));
  const shim = {}; shim.self = shim; vm.createContext(shim);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/worker/shim.js'), 'utf8'), shim);
  const nodes = new Set();
  const backend = {
    createNode(spec) { const n = { spec }; nodes.add(n); return n; },
    updateNode(n, transform) { n.t = { ...transform }; },
    destroyNode(n) { nodes.delete(n); }
  };
  const adapter = Runtime.create({ core: Core, resolver: { has: () => true, resolve: id => id },
    fxBackend: backend, zoneBackend: backend,
    groundScale: options.groundScale || 1,
    ctx: { playerPos: () => ({ x: 0, y: 0 }), posOf: () => ({ x: 300, y: 0 }) } });
  adapter.registerPresets([preset]);
  const width = 650, height = 240;
  function frame() {
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 24; pixels[i + 1] = 33; pixels[i + 2] = 24; pixels[i + 3] = 255;
    }
    for (const n of [...nodes].sort((a, b) => (a.t?.zIndex || 0) - (b.t?.zIndex || 0))) {
      if (!n.t?.visible) continue;
      const tex = textures.get(n.spec.assetUrl);
      drawSprite(pixels, width, height, tex, { x: 0, y: 0, w: tex.width, h: tex.height },
        { ...n.t, x: n.t.x + 100, y: n.t.y + 120 }, n.spec.blendMode);
    }
    return pixels;
  }
  let atOneSecond;
  for (let i = 0; i < (onFrame || options.inspect ? 480 : 120); i++) {
    if (i < (options.single ? 1 : 240) && i % 12 === 0) for (let j = 0; j < 6; j++) shim.playCombatVfx({
      fxKind: 'projectile', variant: 'firehunt-ring', targets: ['enemy'], hit: false,
      vfx: { projectile: preset.id }, travelMs: [3333], angle: 0, lineLength: 400,
      lineWidth: 16, delayMs: 0,
      area: {flightOrbit: {origin:{x:0,y:0},heading:0,speed:120,length:400,radius:80,phase:-Math.PI/2+j*Math.PI/3,spin:Math.PI*3}}
    });
    for (const event of shim.shimDrainEvents()) adapter.tryPlay(event);
    adapter.update(1 / 120);
    if (i === 119) atOneSecond = { count: adapter.stats().projectiles, pixels: frame(), ringDiameter: Math.max(...[...nodes].filter(n => n.spec.assetUrl.endsWith('/circle_02.png') && n.t?.visible).map(n => Math.abs(n.t.scaleY) * textures.get(n.spec.assetUrl).height)) };
    if (onFrame && i % 5 === 4) onFrame(frame(), width, height);
    if(options.inspect)options.inspect([...nodes], (i+1)/120);
  }
  return atOneSecond;
}

test('火神星環實際 Runtime 高速連發仍可見，不疊成白色實心光塊', () => {
  const { count, pixels, ringDiameter } = renderStress();
  assert.ok(ringDiameter > 15.9 && ringDiameter < 16.1, `actual diameter ${ringDiameter} must follow Worker collision width`);
  assert.equal(count, 60, 'must retain every active projectile, not suppress overlapping volleys');
  let white = 0, visible = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240) white++;
    if (pixels[i] > 90) visible++;
  }
  assert.equal(white, 0);
  assert.ok(visible > 100, 'rings must remain visibly rendered');
  const size = Runtime.resolveSizing(preset.sizing);
  assert.equal(size.scaleX, 1, 'editor nominal size must not fall back to a six-metre radius');
});

module.exports = { renderStress };


test('Worker 幾何通過投影後，Runtime 六枚位置逐幀符合共同旋轉軌跡',()=>{
  const point=require('../js/util.js').projectileOrbitPoint;
  for(const groundScale of [1,.62])renderStress(null,{single:true,groundScale,inspect(nodes,t){
    if(t<.05)return;
    const rings=nodes.filter(n=>n.spec.assetUrl.endsWith('/circle_02.png')&&n.t?.visible);
    if(t>3.34){assert.equal(rings.length,0);return;}
    if(t>3.25)return;
    assert.equal(rings.length,6);
    rings.forEach((n,j)=>{
      const expected=point({origin:{x:0,y:0},heading:0,speed:120,length:400,radius:80,phase:-Math.PI/2+j*Math.PI/3,spin:Math.PI*3},t);
      assert.ok(Math.abs(n.t.x-expected.x)<1e-7);assert.ok(Math.abs(n.t.y-expected.y*groundScale)<1e-7);
    });
  }});
});
