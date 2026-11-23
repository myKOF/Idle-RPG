'use strict';
/* 狀態光環貼合本體（playback.fitBody）：採正式本體出生靜止輪廓，不取出招姿勢。 */
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
    return { node: node() ? { t: { ...node().t } } : null, foot };
  });
}

test('FIT-1 fitBody：等比包住出生輪廓，中心對到基準中心（飛行單位罩在空中）', () => {
  const { node, foot } = run({ fitBody: true }, { w: 80, h: 100, cx: 10, cy: 150 });
  close(node.t.scaleX * 60, 100 * 1.15);
  close(node.t.scaleY * 60, 100 * 1.15);
  close(node.t.x - foot.x, 10);
  close(node.t.y - foot.y, -(150 - 100 * 1.15 / 2));
});

test('FIT-2 fitPadding 可調；正式出生輪廓尚未就緒時不鎖備援圓形', () => {
  const { node } = run({ fitBody: true, fitPadding: 1.4 }, { w: 50, h: 50, cx: 0, cy: 25 });
  close(node.t.scaleX * 60, 70);
  const fb = run({ fitBody: true }, null);
  assert.equal(fb.node, null);
});

test('FIT-3 未開 fitBody 的光環不受影響；en-gold-dome 已開啟', () => {
  const plain = run({}, { w: 80, h: 100, cx: 10, cy: 150 });
  close(plain.node.t.x - plain.foot.x, 0);
  const dome = JSON.parse(fs.readFileSync(path.join(__dirname, '../vfx/presets/en-gold-dome.json'), 'utf8'));
  assert.equal(dome.playback.fitBody, true);
  assert.equal(Core.validatePreset ? Core.validatePreset(dome).ok : true, true);
});

test('正式金色護罩：依出生基準等比包覆，圓形／寬形輪廓也保留橢圓，中心與定型正確', () => {
  const preset = JSON.parse(fs.readFileSync(path.join(__dirname, '../vfx/presets/en-gold-dome.json'), 'utf8'));
  const shell = preset.layers.find(layer => layer.id === 'shell');
  const svg = fs.readFileSync(path.join(__dirname, '../images/vfx/assets', shell.assetId), 'utf8');
  const diameter = 2 * Number(/<circle\b[^>]*\br="([\d.]+)"/.exec(svg)[1]);
  const old = global.statusVfxPreset;
  global.statusVfxPreset = () => preset.id;
  try {
    for (const mult of [.3, 1, 2.5]) {
      const nodes = [], foot = { x: 180, y: 400 };
      let reads = 0, box = { w: 80, h: 160, cx: 12, cy: 90 };
      const backend = {
        createNode(spec) { const node = { spec }; nodes.push(node); return node; },
        updateNode(node, transform) { node.t = { ...transform }; },
        destroyNode(node) { node.t = null; }
      };
      const rt = Runtime.create({ core: Core, resolver: { resolve: id => id },
        zoneBackend: backend, fxBackend: backend, billboardBackend: backend,
        profile: { scale: mult, areaScale: mult }, ctx: {
          playerPos: () => foot, posOf: () => foot, footOf: () => foot,
          bodyScaleOf: () => 2.2, bodyBoxOf: () => { reads++; return box; }
        } });
      try {
        rt.registerPresets([preset]);
        const sync = radius => rt.syncStatuses([{ key: 'boss', sids: ['eInvuln'], radii: { eInvuln: radius } }]);
        const assertShell = expected => {
          const node = nodes.find(node => node.spec.assetUrl === shell.assetId && node.t && node.t.visible);
          assert.ok(node, '必須實際播放正式外殼圖層');
          const aspect = preset.sizing.authored.width / preset.sizing.authored.height;
          const height = Math.max(expected.h, expected.w / aspect);
          close(diameter * Math.abs(node.t.scaleX), height * aspect);
          close(diameter * Math.abs(node.t.scaleY), height);
          close(node.t.x, foot.x + expected.cx);
          close(node.t.y, foot.y - expected.cy);
        };
        sync(48); rt.update(.3);
        assertShell({ w: 80, h: 160, cx: 12, cy: 90 });
        box = { w: 150, h: 65, cx: -8, cy: 130 };
        foot.x += 27; foot.y -= 18;
        sync(96); rt.update(.4);
        assertShell({ w: 80, h: 160, cx: 12, cy: 90 });
        assert.equal(reads, 1);
        rt.syncStatuses([]);
        sync(96); rt.update(.3);
        assertShell({ w: 150, h: 65, cx: -8, cy: 130 });
        assert.equal(reads, 2);
      } finally { rt.destroy(); }
    }
  } finally { global.statusVfxPreset = old; }
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
      close(t.scaleX * 60, Math.max(expected.w, expected.h) * 1.15);
      close(t.scaleY * 60, Math.max(expected.w, expected.h) * 1.15);
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

test('模型晚載入：等正式出生基準就緒後重試，不把替代圖或範圍半徑鎖成圓形', () => {
  let box = null;
  withAura({ fitBody: true }, () => box, (rt, node, foot) => {
    rt.syncStatuses([{ key: 'e1', sids: ['eInvuln'], radii: { eInvuln: 32 } }]);
    rt.update(.1);
    assert.equal(node(), undefined);
    box = { w: 80, h: 100, cx: 10, cy: 150 };
    rt.syncStatuses([{ key: 'e1', sids: ['eInvuln'], radii: { eInvuln: 60 } }]);
    rt.update(.1);
    close(node().t.scaleX * 60, 115);
    close(node().t.scaleY * 60, 115);
    close(node().t.x, foot.x + 10);
    close(node().t.y - node().t.scaleY * 30, foot.y - 150);
  });
});

test('NPC 出生首幀只量一次：攻擊／翻面／受擊不改基準，移動／縮放／透視正確', () => {
  const c = { navigator: { userAgent: 'node' }, S: { entities: {}, layers: {} }, npcSpriteDef: () => null };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/vendor/pixi.min.js'), 'utf8'), c);
  const helpers = ['readContentRows', 'npc3dContentRows', 'captureEntityBodyBox', 'entityBodyBox', 'airScreenPose', 'perspectiveLayout',
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
  const ent = c.S.entities.e1 = { npc3d: true, root, view, bodyWrap, body, visScale: 1 };
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
  assert.equal(c.entityBodyBox('e1'), null);
  c.captureEntityBodyBox(ent);
  const first = c.entityBodyBox('e1');
  const unit = body.texture.frame.height;
  close(first.cx, unit * 10);
  close(first.cy, unit * 150);
  c.entityBodyBox('e1');
  assert.equal(reads, 1);
  top = 32;
  body.hero3dFrame++;
  body.scale.set(200, 90);
  bodyWrap.position.set(-30, 45);
  bodyWrap.rotation = .7;
  const next = c.entityBodyBox('e1');
  close(next.cy, first.cy);
  close(next.cx, first.cx);
  close(next.w, first.w);
  close(next.h, first.h);
  assert.equal(reads, 1);

  c.S.layers.world = { x: -30, y: 70 };
  c.S.persp = { layout: c.perspectiveLayout(700, 700, .82) };
  c.applyEntityBillboard(ent);
  const projected = c.entityBodyBox('e1');
  const foot = c.airScreenPose(root.x, root.y);
  const { width, height } = body.texture.frame;
  const corners = [32, 80].flatMap(x => [16, 48].map(y => {
    const world = view.toGlobal({ x: (x / 128 - .5) * width * -160, y: (y / 128 - 1) * height * 200 });
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
  assert.equal(reads, 1);
  c.S.persp = null;
  c.applyEntityBillboard(ent);
  ent.visScale = 2;
  const larger = c.entityBodyBox('e1');
  close(larger.w, first.w * 2); close(larger.h, first.h * 2);
  close(larger.cx, first.cx * 2); close(larger.cy, first.cy * 2);
  assert.equal(reads, 1);
});

test('2D 首幀出生基準：等素材就緒、先對準朝向，之後換幀／攻擊不重取輪廓', () => {
  let rows = { left: 2, right: 10, top: 1, bot: 15 }, reads = 0;
  const c = { navigator: { userAgent: 'node' }, S: { entities: {}, layers: {}, npcSheetState: { 'npc:test': 'loading' } },
    npcSpriteDef: () => ({ id: 'test' }), textureContentRows: () => { reads++; return rows; },
    playerPos: () => ({ x: 0 }) };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/vendor/pixi.min.js'), 'utf8'), c);
  vm.runInContext(['captureEntityBodyBox', 'entityBodyBox', 'airScreenPose'].map(n => extractFunction(renderer, n)).join('\n'), c);
  const body = new c.PIXI.Sprite(c.PIXI.Texture.WHITE), root = new c.PIXI.Container(), view = new c.PIXI.Container();
  body.anchor.set(.5, 1); body.scale.set(10, 20);
  const e = c.S.entities.mob = { body, root, view, wx: 100, data: {}, visScale: 1, npcFacing: 1 };
  c.captureEntityBodyBox(e);
  assert.equal(c.entityBodyBox('mob'), null);
  assert.equal(reads, 0);
  e.npcSprite = true;
  c.captureEntityBodyBox(e);
  assert.equal(body.scale.x, -10);
  const first = c.entityBodyBox('mob');
  close(first.w, 80); close(first.h, 280);
  rows = { left: 0, right: 40, top: 0, bot: 80 };
  body.rotation = .8; body.scale.set(9, 8);
  const next = c.entityBodyBox('mob');
  for (const key of ['w', 'h', 'cx', 'cy']) close(next[key], first[key]);
  assert.equal(reads, 1);
  e.body = new c.PIXI.Sprite(c.PIXI.Texture.WHITE);
  assert.equal(c.entityBodyBox('mob'), null, '換正式本體不可沿用舊基準');
});

test('正式模型失敗後可取備援本體基準，像素不可讀時仍保留非空局部邊界', () => {
  const c = { navigator: { userAgent: 'node' }, S: { entities: {}, layers: {}, npcSheetState: {}, imgTex: {} },
    Npc3D: { definition: () => ({ file: 'missing.glb' }) }, npcSpriteDef: () => null, textureContentRows: () => null };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/vendor/pixi.min.js'), 'utf8'), c);
  vm.runInContext(['captureEntityBodyBox', 'entityBodyBox', 'airScreenPose'].map(n => extractFunction(renderer, n)).join('\n'), c);
  const body = new c.PIXI.Sprite(c.PIXI.Texture.WHITE);
  body.anchor.set(.5, 1); body.scale.set(2, 3);
  const e = c.S.entities.mob = { body, root: new c.PIXI.Container(), view: new c.PIXI.Container(), data: {}, npc3dLoading: true };
  c.captureEntityBodyBox(e);
  assert.equal(c.entityBodyBox('mob'), null);
  e.npc3dLoading = 'failed';
  c.captureEntityBodyBox(e);
  const box = c.entityBodyBox('mob');
  assert.ok(box.w > 0 && box.h > 0);
  close(box.cx, 0); close(box.cy, box.h / 2);
});
