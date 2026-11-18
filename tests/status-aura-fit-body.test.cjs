'use strict';
/* 狀態光環貼合本體（playback.fitBody）：罩子生成時取樣可見輪廓。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');
const { loadEliteEnv, makeElite } = require('./helpers/elite-env.cjs');
const { extractFunction } = require('./helpers/battle-scene.cjs');
const renderer = fs.readFileSync(path.join(__dirname, '../js/battle-renderer.js'), 'utf8');

function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`); }
function withAura(playback, readBox, check) {
  const nodes = [], backend = { createNode(spec) { const n = { spec }; nodes.push(n); return n; },
    updateNode(n, t) { n.t = { ...t }; }, destroyNode(n) { n.t = null; } };
  const foot = { x: 100, y: 300 };
  const old = global.statusVfxPreset;
  global.statusVfxPreset = () => 'fit-test';
  const rt = Runtime.create({ core: Core, resolver: { resolve: id => id }, zoneBackend: backend, fxBackend: backend,
    ctx: { playerPos: () => foot, posOf: () => foot, footOf: () => foot, bodyScaleOf: () => 2, bodyBoxOf: readBox } });
  try {
    rt.registerPresets([{ schemaVersion: 1, id: 'fit-test', playback, sizing: { shape: 'custom', widthM: 6, heightM: 6, authored: { width: 60, height: 60 } },
      duration: 1, loop: true, layers: [{ id: 'dome', type: 'sprite', assetId: 'test.png' }] }]);
    const node = () => nodes.find(n => n.t && n.t.visible);
    return check(rt, node, foot);
  } finally { rt.destroy(); global.statusVfxPreset = old; }
}
function run(playback, box) {
  return withAura(playback, () => box, (rt, node, foot) => {
    rt.syncStatuses([{ key: 'e1', sids: ['eInvuln'] }]);
    rt.update(.1);
    return { node: { t: { ...node().t } }, foot };
  });
}

test('FIT-1 fitBody：罩子寬高＝可見範圍×1.15，中心對到可見範圍中心（飛行單位罩在空中）', () => {
  const { node, foot } = run({ fitBody: true }, { w: 80, h: 100, cx: 10, cy: 150 });
  close(node.t.scaleX * 60, 80 * 1.15);      // 畫面寬＝scale × 名目寬
  close(node.t.scaleY * 60, 100 * 1.15);
  close(node.t.x - foot.x, 10);
  close(node.t.y - foot.y, -(150 - 100 * 1.15 / 2));
});

test('FIT-2 fitPadding 可調；量不到可見範圍（null）退回原本的體型倍率做法', () => {
  const { node } = run({ fitBody: true, fitPadding: 1.4 }, { w: 50, h: 50, cx: 0, cy: 25 });
  close(node.t.scaleX * 60, 70);
  const fb = run({ fitBody: true }, null);
  close(fb.node.t.x - fb.foot.x, 0); close(fb.node.t.y - fb.foot.y, 0);
  close(fb.node.t.scaleX * 60, 120);   // 名目 6 米 × 每米 10px，再乘體型倍率 2
});

test('FIT-3 未開 fitBody 的光環不受影響；en-gold-dome 已開啟', () => {
  const plain = run({}, { w: 80, h: 100, cx: 10, cy: 150 });
  close(plain.node.t.x - plain.foot.x, 0);
  const dome = JSON.parse(fs.readFileSync(path.join(__dirname, '../vfx/presets/en-gold-dome.json'), 'utf8'));
  assert.equal(dome.playback.fitBody, true);
  assert.equal(Core.validatePreset ? Core.validatePreset(dome).ok : true, true);
});

test('NPC 護罩生成時貼合，姿勢與狀態半徑更新時維持尺寸和相對位置', () => {
  const c = loadEliteEnv();
  const enemy = makeElite(c, ['e_shield']);
  c.eliteStatusOn(enemy, 'eInvuln', 3);
  const radius = c.statusEntries(enemy).find(s => s.sid === 'eInvuln').vfxR;
  assert.ok(radius > 0);
  const initial = { w: 80, h: 100, cx: 10, cy: 150 };
  const next = { w: 50, h: 80, cx: -14, cy: 182 };
  let box = initial, reads = 0;
  const measure = () => { reads++; return box; };
  withAura({ fitBody: true }, measure, (rt, node, foot) => {
    function sync(r) {
      rt.syncStatuses([{ key: enemy.floatSel, sids: ['eInvuln'], radii: { eInvuln: r } }]);
    }
    function assertFit(expected) {
      const t = node().t;
      close(t.scaleX * 60, expected.w * 1.15);
      close(t.scaleY * 60, expected.h * 1.15);
      close(t.x - foot.x, expected.cx);
      close(t.y - foot.y - t.scaleY * 30, -expected.cy);
      assert.equal(t.sortY, foot.y);
    }
    sync(radius);
    for (const pose of [next, null]) {
      box = pose;
      foot.x += 29;
      foot.y -= 31;
      sync(radius * 2);
      rt.update(.016);
      assertFit(initial);
    }
    assert.equal(reads, 1);
    rt.syncStatuses([]);
    assert.equal(node(), undefined);
    box = next;
    sync(radius);
    rt.update(.016);
    assertFit(next);
    assert.equal(reads, 2);
  });
});

test('生成時量不到本體的護罩維持備援尺寸', () => {
  let box = null;
  withAura({ fitBody: true }, () => box, (rt, node, foot) => {
    rt.syncStatuses([{ key: 'e1', sids: ['eInvuln'], radii: { eInvuln: 32 } }]);
    box = { w: 80, h: 100, cx: 10, cy: 150 };
    rt.syncStatuses([{ key: 'e1', sids: ['eInvuln'], radii: { eInvuln: 60 } }]);
    rt.update(.1);
    close(node().t.scaleX * 60, 64);
    close(node().t.scaleY * 60, 64);
    close(node().t.x, foot.x);
    close(node().t.y, foot.y);
  });
});

test('NPC 本體量測跟隨 3D 畫格、翻面、容器位移和透視', () => {
  const c = { navigator: { userAgent: 'node' }, S: { entities: {}, layers: {} } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/vendor/pixi.min.js'), 'utf8'), c);
  const helpers = ['readContentRows', 'npc3dContentRows', 'entityBodyBox', 'airScreenPose', 'perspectiveLayout',
    'sceneBillboardBasis', 'applyEntityBillboard', 'depthScaleOf', 'projectBillboardTransform'];
  vm.runInContext('var npc3dContentContext = null, npc3dContentCache = new WeakMap();\n' +
    helpers.map(name => extractFunction(renderer, name)).join('\n'), c);
  const { Container, Sprite, Texture } = c.PIXI;
  const root = new Container(), view = new Container(), bodyWrap = new Container(), body = new Sprite(Texture.WHITE);
  root.addChild(view);
  view.addChild(bodyWrap);
  bodyWrap.addChild(body);
  root.position.set(450, 400);
  bodyWrap.position.set(7, -9);
  body.anchor.set(.5, 1);
  body.scale.set(-160, 200);
  body.hero3d = { canvas: {} };
  body.hero3dFrame = 1;
  const ent = c.S.entities.e1 = { npc3d: true, root, view, bodyWrap, body };
  let top = 16, reads = 0;
  c.document = { createElement: () => ({ getContext: () => ({
    clearRect() {}, drawImage() {},
    getImageData(x, y, w, h) {
      reads++;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let row = top; row < top + 32; row++) {
        for (let col = 32; col < 80; col++) data[(row * w + col) * 4 + 3] = 255;
      }
      return { data };
    }
  }) }) };
  const first = c.entityBodyBox('e1');
  const unit = body.texture.frame.height;
  close(first.cx, 7 + unit * 10);
  close(first.cy, 9 + unit * 150);
  c.entityBodyBox('e1');
  assert.equal(reads, 1);
  top = 32;
  body.hero3dFrame++;
  const next = c.entityBodyBox('e1');
  close(next.cy, first.cy - unit * 25);
  assert.equal(reads, 2);

  c.S.layers.world = { x: -30, y: 70 };
  c.S.persp = { layout: c.perspectiveLayout(700, 700, .82) };
  c.applyEntityBillboard(ent);
  const projected = c.entityBodyBox('e1');
  const foot = c.airScreenPose(root.x, root.y);
  const { width, height } = body.texture.frame;
  const corners = [32, 80].flatMap(x => [32, 64].map(y => {
    const world = body.toGlobal({ x: (x / 128 - .5) * width, y: (y / 128 - 1) * height });
    return c.S.persp.layout.project(world.x - 30, world.y + 70);
  }));
  const left = Math.min(...corners.map(p => p.x)), right = Math.max(...corners.map(p => p.x));
  const topEdge = Math.min(...corners.map(p => p.y)), bottom = Math.max(...corners.map(p => p.y));
  const t = c.projectBillboardTransform({
    x: root.x + projected.cx, y: root.y - projected.cy,
    scaleX: 1, scaleY: 1, sortY: root.y
  });
  close(t.x, (left + right) / 2);
  close(t.y, (topEdge + bottom) / 2);
  close(projected.w * foot.scale, right - left);
  close(projected.h * foot.scale, bottom - topEdge);
  assert.equal(reads, 2);
});
