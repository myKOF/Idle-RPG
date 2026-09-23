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
  const previewScale = options.scale || 1;
  const width = 650 * previewScale, height = 240 * previewScale;
  function frame() {
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 24; pixels[i + 1] = 33; pixels[i + 2] = 24; pixels[i + 3] = 255;
    }
    for (const n of [...nodes].sort((a, b) => (a.t?.zIndex || 0) - (b.t?.zIndex || 0))) {
      if (!n.t?.visible) continue;
      const tex = textures.get(n.spec.assetUrl);
      drawSprite(pixels, width, height, tex, { x: 0, y: 0, w: tex.width, h: tex.height },
        { ...n.t, x: (n.t.x + 100)*previewScale, y: (n.t.y + 120)*previewScale, scaleX:n.t.scaleX*previewScale,scaleY:n.t.scaleY*previewScale }, n.spec.blendMode);
    }
    return pixels;
  }
  let atOneSecond;
  for (let i = 0; i < (onFrame || options.inspect ? 480 : 120); i++) {
    if (i < (options.single ? 1 : 240) && i % 12 === 0) for (let j = 0; j < 6; j++) shim.playCombatVfx({
      fxKind: 'projectile', variant: 'firehunt-ring', targets: ['enemy'], hit: false,
      vfx: { projectile: preset.id }, travelMs: [2083], angle: 0, lineLength: 500,
      lineWidth: 16, delayMs: 0,
      area: {flightOrbit: {origin:{x:0,y:0},heading:0,speed:240,length:500,radius:80,phase:-Math.PI/2+j*Math.PI/3,spin:Math.PI}}
    });
    for (const event of shim.shimDrainEvents()) adapter.tryPlay(event);
    adapter.update(1 / 120);
    if (i === 119) atOneSecond = { count: adapter.stats().projectiles, pixels: frame(), ringDiameter: Math.max(...[...nodes].filter(n => n.t?.zIndex === 3 && n.t?.visible).map(n => Math.abs(n.t.scaleY) * textures.get(n.spec.assetUrl).height)) };
    if (onFrame && i % 5 === 4) onFrame(frame(), width, height);
    if(options.inspect)options.inspect([...nodes], (i+1)/120);
  }
  return atOneSecond;
}

test('火神星環實際 Runtime 高速連發仍可見，不疊成白色實心光塊', () => {
  const { count, pixels, ringDiameter } = renderStress();
  assert.ok(ringDiameter > 12 && ringDiameter < 16, `actual diameter ${ringDiameter} sharp inner core must stay near the Worker collision width`);
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
    const rings=nodes.filter(n=>n.t?.zIndex === 3&&n.t?.visible);
    if(t>2.09){assert.equal(rings.length,0);return;}
    if(t>1.98)return;
    assert.equal(rings.length,6);
    rings.forEach((n,j)=>{
      const expected=point({origin:{x:0,y:0},heading:0,speed:240,length:500,radius:80,phase:-Math.PI/2+j*Math.PI/3,spin:Math.PI},t);
      assert.ok(Math.abs(n.t.x-expected.x)<1e-7);assert.ok(Math.abs(n.t.y-expected.y*groundScale)<1e-7);
    });
  }});
});

test('星環抵達後保留尾焰自然淡出，之後完整回收',()=>{
  let lingering=false, cleared=false;
  renderStress(null,{single:true,inspect(nodes,t){
    const visible=nodes.filter(n=>n.t?.visible);
    if(t>2.1&&t<2.2&&visible.some(n=>n.t.zIndex===-1))lingering=true;
    if(t>2.7){assert.equal(visible.length,0);cleared=true;}
  }});
  assert.ok(lingering,'抵達瞬間不應刪除尚未消散的世界座標尾焰');assert.ok(cleared);
});

test('星環尾焰與中心一起平移，只留下旋轉弧線，不被前進速度拉向後方',()=>{
  let checked=0;
  renderStress(null,{single:true,inspect(nodes,t){
    if(t<.4||t>1.9)return;
    for(const n of nodes.filter(n=>n.t?.visible&&n.t.zIndex===-1)){
      const radius=Math.hypot(n.t.x-240*t,n.t.y);
      assert.ok(Math.abs(radius-80)<4,`尾焰應沿當前環帶，t=${t} r=${radius}`);
      checked++;
    }
  }});
  assert.ok(checked>100);
});
