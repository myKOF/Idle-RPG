'use strict';
/* =============================================================================
   intro-scene.test.cjs — 分件場景圖層（js/intro-scene.js）與繪本式序章 storybook 的資料
   ============================================================================= */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));   // vm 內外的陣列原型不同，比較前先轉成一般物件

function load(opts) {
  opts = opts || {};
  const anims = [];
  const observers = [];
  function el(tag) {
    const e = {
      tag, className: '', style: {}, children: [], attrs: {}, textContent: '', src: '',
      appendChild(c) { c.parentNode = e; e.children.push(c); return c; },
      setAttribute(k, v) { e.attrs[k] = v; },
      getBoundingClientRect() { return opts.rect || { width: 1280, height: 720 }; },
      decode() { return Promise.resolve(); }
    };
    return e;
  }
  const ctx = {
    console, Math, Promise,
    document: { createElement: el },
    window: { innerWidth: 0, innerHeight: 0, addEventListener() {}, removeEventListener() {} },
    STR: (id) => '#' + id
  };
  if (!opts.noObserver) {
    ctx.ResizeObserver = function (fn) {
      const o = { fn, observed: [], disconnected: false, observe(t) { o.observed.push(t); }, disconnect() { o.disconnected = true; } };
      observers.push(o);
      return o;
    };
  }
  vm.createContext(ctx);
  vm.runInContext(read('js/intro-scene.js') + '\nthis.IntroScene = IntroScene;', ctx);
  const animate = (target, frames, timing) => { const a = { target, frames, timing }; anims.push(a); return a; };
  return { S: ctx.IntroScene, el, anims, observers, ctx };
}
const byPart = (node, id) => {
  if (node.attrs && node.attrs['data-part'] === id) return node;
  for (const c of node.children || []) { const hit = byPart(c, id); if (hit) return hit; }
  return null;
};

const SAMPLE = {
  kind: 'scene', at: 1000, dur: 5000,
  camera: { path: [{ scale: 1.1 }, { scale: 1 }] },
  parts: [
    { id: 'bg', src: 'a.webp', box: [0, 0, 1920, 1080] },
    { id: 'hero', kind: 'group', box: [100, 200, 600, 800], at: 500, fadeIn: 300,
      path: [{ t: 0, y: -50 }, { t: 1, y: 0 }],
      loop: { frames: [{ y: 0 }, { y: -10 }], dur: 2000, alternate: true, phase: 0.25 },
      children: [
        { id: 'wing', src: 'w.svg', flip: true, box: [10, 20, 300, 200], origin: '90% 60%', at: 200, dur: 1000,
          loop: { frames: [{ rotate: 0 }, { rotate: 4 }], dur: 1500, alternate: true, alpha: [0.5, 1] } },
        { id: 'glow', kind: 'shape', cls: 'glow-x', box: [0, 0, 100, 100] }
      ] },
    { id: 'dust', kind: 'particles', cls: 'mote-x', box: [0, 0, 400, 300], count: 5, seed: 3, size: [4, 8], rise: [100, 200], dur: [3000, 5000] },
    { id: 'line', kind: 'text', str: 2482, cls: 'ink-x', box: [0, 900, 1920, 100] }
  ]
};

/* ---------- 純函式 ---------- */
test('關鍵影格：t 決定 offset、只給一格就原地不動、transform 以設計座標 px 表示', () => {
  const { S } = load();
  const k = S._internal.keyframes;
  assert.deepStrictEqual(plain(k([{ t: 0, x: 1 }, { t: 0.4, y: 2 }, { t: 1, rotate: 3 }]).map((f) => f.offset)), [0, 0.4, 1]);
  assert.deepStrictEqual(plain(k([{ x: 1 }, { x: 2 }, { x: 3 }]).map((f) => f.offset)), [0, 0.5, 1], '缺 t 時平均分配');
  const one = k([{ y: 5 }]);
  assert.equal(one.length, 2);
  assert.equal(one[0].transform, one[1].transform);
  assert.equal(S._internal.transformOf({ x: 10, y: -4, rotate: 7, sx: -1 }), 'translate(10px, -4px) rotate(7deg) scale(-1, 1)');
  assert.equal(k(null), null);
});

test('驗證：部件樹逐層檢查，資料錯就回報（播放器據此整段不播）', () => {
  const { S } = load();
  assert.deepStrictEqual(plain(S.validate(SAMPLE)), []);
  assert.ok(S.validate({ parts: [] }).length, '沒有 parts');
  const bad = S.validate({ parts: [
    { kind: 'video', box: [0, 0, 1, 1] },
    { src: 'x' },
    { kind: 'image', box: [0, 0, 1, 1] },
    { kind: 'text', box: [0, 0, 1, 1] },
    { kind: 'particles', box: [0, 0, 1, 1] },
    { src: 'x', box: [0, 0, 1, 1], loop: { frames: [] } },
    { kind: 'group', box: [0, 0, 1, 1], children: [{ id: 'kid', kind: 'image', box: [0, 0, 1, 1] }] }
  ] });
  assert.equal(bad.length, 7, bad.join('\n'));
  assert.ok(bad.some((e) => e.includes('(kid)')), '子部件的錯誤標出名稱');
});

/* ---------- 建構 ---------- */
test('建構：cover 縮放、鏡頭、部件外層時間窗＋主運動、內層循環，時間相對於父部件', () => {
  const env = load({ rect: { width: 960, height: 1080 } });
  const host = env.el('div');
  env.S.build(SAMPLE, host, (t, f, o) => ({ ...{ target: t, frames: f, timing: o }, _push: env.anims.push({ target: t, frames: f, timing: o }) }), false);
  const fit = host.children[0];
  assert.equal(fit.className, 'intro-scene-fit');
  assert.equal(fit.style.transform, 'translate(-50%, -50%) scale(1)', 'cover：取寬高比例較大者（1080/1080）');
  const cam = fit.children[0];
  const camAnim = env.anims.find((a) => a.target === cam);
  assert.equal(camAnim.timing.delay, 1000, '鏡頭跟場景同時開始');

  const hero = byPart(cam, 'hero');
  assert.deepStrictEqual([hero.style.left, hero.style.top, hero.style.width, hero.style.height], ['100px', '200px', '600px', '800px']);
  const heroAnims = env.anims.filter((a) => a.target === hero);
  assert.equal(heroAnims.length, 2, '外層：時間窗淡入淡出＋主運動');
  assert.ok(heroAnims.every((a) => a.timing.delay === 1500), '場景 1000＋部件 500');
  const heroLoop = env.anims.find((a) => a.target === hero.children[0]);
  assert.equal(heroLoop.timing.iterations, Infinity);
  assert.equal(heroLoop.timing.direction, 'alternate');
  assert.equal(heroLoop.timing.iterationStart, 0.25, 'phase 錯開相位');

  const wing = byPart(hero, 'wing');
  assert.equal(wing.style.transformOrigin, '90% 60%');
  const wingFade = env.anims.find((a) => a.target === wing);
  assert.equal(wingFade.timing.delay, 1700, '子部件時間相對於父部件：1000＋500＋200');
  assert.equal(wingFade.timing.duration, 1000);
  const wingImg = wing.children[0].children[0];
  assert.equal(wingImg.tag, 'img');
  assert.match(wingImg.className, /is-flipped/, '左右翼共用一張圖');
  const wingLoop = env.anims.find((a) => a.target === wing.children[0]);
  assert.deepStrictEqual(plain(wingLoop.frames.map((f) => f.opacity)), [0.5, 1], 'alpha 寫進循環影格');
});

test('建構：cls 只套在 shape 外層；粒子的 cls 套在每顆粒子，不套在整塊範圍上', () => {
  const env = load();
  const host = env.el('div');
  env.S.build(SAMPLE, host, (t, f, o) => env.anims.push({ target: t, frames: f, timing: o }), false);
  const cam = host.children[0].children[0];
  assert.match(byPart(cam, 'glow').className, /glow-x/);
  const dust = byPart(cam, 'dust');
  // 2026-11-11 回歸：粒子群外層帶了 mote 的放射漸層，整塊 1200×820 變成蓋住天使的大光暈
  assert.doesNotMatch(dust.className, /mote-x/, '粒子群外層不能帶粒子外觀');
  const dots = dust.children[0].children;
  assert.equal(dots.length, 5);
  assert.ok(dots.every((d) => /mote-x/.test(d.className)));
  const dotAnims = env.anims.filter((a) => dots.includes(a.target));
  assert.ok(dotAnims.every((a) => a.timing.iterations === Infinity && a.timing.iterationStart >= 0 && a.timing.iterationStart < 1));
  const text = byPart(cam, 'line').children[0].children[0];
  assert.equal(text.textContent, '#2482');
  assert.match(text.className, /ink-x/);
  assert.doesNotMatch(byPart(cam, 'line').className, /ink-x/);
});

test('減少動態偏好：只留淡入淡出，不建鏡頭、主運動、循環與粒子', () => {
  const env = load();
  const host = env.el('div');
  env.S.build(SAMPLE, host, (t, f, o) => env.anims.push({ target: t, frames: f, timing: o }), true);
  assert.ok(env.anims.every((a) => a.frames.every((f) => !('transform' in f))), '沒有任何位移動畫');
  const cam = host.children[0].children[0];
  assert.equal(byPart(cam, 'dust').children[0].children.length, 0);
});

test('尺寸：以圖層實際大小 cover 縮放，尺寸改變時重算；dispose 解除監聽', () => {
  const env = load({ rect: { width: 0, height: 0 } });
  const host = env.el('div');
  const scene = env.S.build(SAMPLE, host, () => ({}), false);
  const fit = host.children[0];
  assert.equal(fit.style.transform, 'translate(-50%, -50%) scale(1)', '大小為 0 時退回設計尺寸，不縮成 0');
  assert.equal(env.observers.length, 1);
  assert.equal(env.observers[0].observed[0], host);
  host.getBoundingClientRect = () => ({ width: 3840, height: 1080 });
  env.observers[0].fn();
  assert.equal(fit.style.transform, 'translate(-50%, -50%) scale(2)', '超寬螢幕取寬度比例');
  scene.dispose();
  assert.equal(env.observers[0].disconnected, true);
});

/* ---------- storybook 資料 ---------- */
test('storybook 第一鏡：結構完整、素材都在、旁白在 String 表、左右翼對稱', () => {
  const env = load();
  vm.runInContext(read('js/intro-data.js') + '\nthis.INTRO_TIMELINES = INTRO_TIMELINES;', env.ctx);
  const tl = env.ctx.INTRO_TIMELINES.storybook;
  assert.ok(tl && tl.duration > 0);
  const scene = tl.layers.find((l) => l.kind === 'scene');
  assert.deepStrictEqual(plain(env.S.validate(scene)), []);
  const all = [];
  (function walk(parts) { parts.forEach((p) => { all.push(p); if (p.children) walk(p.children); }); })(scene.parts);
  for (const p of all.filter((x) => x.src)) {
    assert.ok(fs.existsSync(path.join(root, p.src.split('?')[0])), '素材存在：' + p.src);
  }
  const ids = new Set(read('config/CSV/String.csv').split(/\r?\n/).slice(1).map((l) => l.split(',')[0]));
  for (const p of all.filter((x) => x.kind === 'text')) assert.ok(ids.has(String(p.str)), '旁白在 String 表：' + p.str);
  // 天使各部位拆開控制（使用者要求：不是對一張圖整體變形）
  const angel = all.find((p) => p.id === 'angel');
  const parts = angel.children.map((c) => c.id);
  for (const need of ['wing-upper-l', 'wing-upper-r', 'wing-lower-l', 'wing-lower-r', 'cape', 'sword', 'body', 'halo']) {
    assert.ok(parts.includes(need), '天使部位：' + need);
  }
  for (const pair of [['wing-upper-l', 'wing-upper-r'], ['wing-lower-l', 'wing-lower-r']]) {
    const [l, r] = pair.map((id) => angel.children.find((c) => c.id === id));
    assert.equal(l.src, r.src, '左右翼共用同一張圖');
    assert.ok(!l.flip && r.flip, '右翼翻轉');
    assert.equal(l.box[0] + l.box[2] / 2 + r.box[0] + r.box[2] / 2, 600, '左右翼對稱於本體中線 x=300');
    assert.equal(l.loop.frames[1].rotate, -r.loop.frames[1].rotate, '擺動方向對稱');
  }
  // 背景三層雲帶有視差（速度不同）
  const drift = ['clouds-far', 'clouds-mid', 'clouds-near'].map((id) => Math.abs(all.find((p) => p.id === id).path[1].x));
  assert.ok(drift[0] < drift[1] && drift[1] < drift[2], '越近漂得越快');
});

test('播放器：接受 scene 圖層、播完時釋放場景', () => {
  const html = read('index.html');
  const iScene = html.indexOf('js/intro-scene.js'), iPlayer = html.indexOf('js/intro-player.js');
  assert.ok(iScene > 0 && iScene < iPlayer, 'intro-scene.js 在播放器之前載入');
  const player = read('js/intro-player.js');
  assert.match(player, /l\.kind === 'scene'/);
  assert.match(player, /c\.scenes\.forEach\(function \(scene\) \{ if \(scene && scene\.dispose\) scene\.dispose\(\); \}\)/);
});
