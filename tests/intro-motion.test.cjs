'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function env() {
  function el(tag) { return { tag, children: [], style: {}, className: '', appendChild(child) { this.children.push(child); return child; } }; }
  const ctx = { document: { createElement: el } };
  vm.createContext(ctx);
  for (const f of ['intro-data.js', 'intro-motion.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx);
  return { ctx, host: () => el('div') };
}
function descendants(node) { return node.children.flatMap(c => [c, ...descendants(c)]); }

test('四幕局部動態全部由同一時鐘登記，起始／時長有效、物件數有界', () => {
  const e = env(), all = [];
  for (const layer of e.ctx.INTRO_TIMELINES.prologue.layers.filter(l => l.kind === 'motion')) {
    const tracks = [];
    e.ctx.IntroMotion.build(layer, e.host(), (el, frames, opts) => tracks.push({ el, frames, opts }), false);
    if (!layer.src) assert.ok(tracks.length > 0, layer.motion);
    assert.ok(tracks.length < 100, '每幕有界');
    for (const t of tracks) {
      assert.ok(t.opts.delay >= layer.at && t.opts.delay <= layer.at + layer.dur, layer.motion);
      assert.ok(Number.isFinite(t.opts.duration) && t.opts.duration > 0);
      assert.ok(!JSON.stringify(t.frames).includes('NaN'));
    }
    all.push(...tracks);
  }
  assert.ok(all.length > 100 && all.length < 300);
});

test('四個人物姿態各有六翼與前景身軀，減少動態改用完整透明人物而不切件擺動', () => {
  const e = env();
  for (const layer of e.ctx.INTRO_TIMELINES.prologue.layers.filter(l => l.kind === 'motion' && l.src)) {
    const host = e.host();
    e.ctx.IntroMotion.build(layer, host, () => {}, false);
    const nodes = descendants(host);
    assert.equal(e.ctx.IntroMotion._internal.poseAt(layer.motion, .5, layer.dur / 1000).wings.length, 6, layer.motion);
    assert.equal(nodes.filter(n => n.className === 'intro-rig-still').length, 1, '無Canvas時保持完整人物');
    const reduced = e.host(), tracks = [];
    e.ctx.IntroMotion.build(layer, reduced, (...args) => tracks.push(args), true);
    assert.equal(tracks.length, 0);
    assert.equal(descendants(reduced).filter(n => n.className === 'intro-rig-still').length, 1);
  }
});

test('連續網格六翼各自變形，完整頂點無翻面或非有限值，避免裁切件裂縫', () => {
  const e = env(), { deform } = e.ctx.IntroMotion._internal;
  for (const pose of ['fall', 'awakening', 'rising', 'standing']) {
    for (const u of [.16, .84]) for (const v of [.18, .48, .82]) {
      const a = deform(pose, u, v, .1, 6), b = deform(pose, u, v, .5, 6);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > .0001, pose + '六翼有獨立動態');
    }
    for (const t of [0, .5, 1.4, 3, 5.9]) {
      const points = [];
      for (let y = 0; y <= 10; y++) for (let x = 0; x <= 16; x++) {
        const p = deform(pose, x / 16, y / 10, t, 6); assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)); points.push(p);
      }
      const area = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) {
        const n = y * 17 + x;
        assert.ok(area(points[n], points[n + 1], points[n + 17]) > 0, pose + '不翻面');
        assert.ok(area(points[n + 1], points[n + 18], points[n + 17]) > 0, pose + '不翻面');
      }
    }
  }
});

test('第二版來源清單完整、七張正式素材存在，四句字幕逐字來自v2腳本', () => {
  const e = env(), manifest = JSON.parse(fs.readFileSync(path.join(root, 'images/intro-v2/manifest.json')));
  assert.equal(manifest.assets.length, 7);
  assert.equal(manifest.assets.filter(a => a.transparent).length, 4);
  for (const a of manifest.assets) assert.ok(fs.existsSync(path.join(root, a.target)));
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/strings_data.js'), 'utf8'), ctx);
  const script = fs.readFileSync(path.join(root, 'docs/dark_fantasy_opening_animation_script_v2.md'), 'utf8');
  for (const cue of e.ctx.INTRO_PROLOGUE_CAPTIONS) {
    const text = ctx.STRING_DATA[cue.str];
    const tw = typeof text === 'string' ? text : text['zh-TW'] || text.zhTW || text[0];
    assert.ok(tw && script.includes(tw), 'String ' + cue.str + '原文');
    const caption = e.ctx.INTRO_TIMELINES.prologue.layers.find(l => l.kind === 'text' && l.str === cue.str);
    assert.equal(caption.at, cue.at); assert.equal(caption.dur, cue.dur);
  }
});
