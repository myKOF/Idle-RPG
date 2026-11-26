'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function harness() {
  let now = 0, seq = 0, current = null, columns = 10;
  const timers = new Map(), observers = [];
  class Node {
    constructor() {
      this.listeners = {};
      this.attrs = {};
      this.children = [];
      this.style = { setProperty(k, v) { this[k] = v; } };
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: n => classes.has(n),
        toggle(n, on = !classes.has(n)) { if (on) classes.add(n); else classes.delete(n); }
      };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k]; }
    addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
    emit(k, props = {}) {
      const e = { preventDefault() { this.defaultPrevented = true; }, ...props };
      (this.listeners[k] || []).forEach(f => f(e));
      return e;
    }
    set innerHTML(html) {
      this.html = html;
      this.children = Array.from(html.matchAll(/<li data-nfc-index="(\d+)"/g), m => {
        const n = new Node(); n.setAttribute('data-nfc-index', m[1]); return n;
      });
    }
    get innerHTML() { return this.html; }
    focus() { this.focused = true; }
    setPointerCapture(id) { this.capture = id; }
    hasPointerCapture(id) { return this.capture === id; }
    releasePointerCapture() { this.capture = null; this.emit('lostpointercapture'); }
  }
  function gridNodes() {
    const viewport = new Node(), grid = new Node(), track = new Node();
    viewport.querySelector = () => grid;
    viewport.clientHeight = 112;
    viewport.scrollHeight = 56000;
    viewport.scrollTop = 0;
    grid.parentNode = track;
    return { viewport, grid, track };
  }
  const stage = { appendChild(n) { current = n; } };
  const c = {
    console, window: {}, performance: { now: () => now },
    setTimeout(f, delay) { const id = ++seq; timers.set(id, { f, at: now + Math.max(0, delay) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    getComputedStyle: () => ({ rowGap: '6', gridAutoRows: '50', gridTemplateColumns: Array(columns).fill('50px').join(' ') }),
    ResizeObserver: class {
      constructor(fn) { this.fn = fn; this.active = true; observers.push(this); }
      observe() {}
      disconnect() { this.active = false; }
    },
    hideTooltip() {}, itemFrameColor: () => '#fff', itemRarityEffectClass: () => '', ancientStarBadgeHTML: () => '',
    document: {
      body: stage,
      getElementById: id => id === 'ui-stage' ? stage : current,
      querySelectorAll: () => [],
      createElement() {
        const el = new Node(), nodes = gridNodes(), confirm = new Node(), panel = new Node();
        panel.inert = true;
        panel.setAttribute('aria-hidden', 'true');
        el.panel = panel;
        el.nodes = nodes; el.confirm = confirm;
        confirm.hidden = confirm.disabled = true;
        nodes.viewport.hidden = true;
        el.querySelector = q => q === '.nfc-res-confirm' ? confirm : q === '.nfc-res-rewards' ? panel : nodes.viewport;
        el.querySelectorAll = () => [{ decode: () => c.decode() }];
        el.showModal = () => { el.open = true; };
        el.close = () => { el.open = false; el.emit('close'); };
        el.remove = () => { if (current === el) current = null; };
        el.getAnimations = () => [{ animationName: 'nfc-chest-charge', currentTime: c.animationTime, get ready() { return c.animationReady(); }, cancel() { el.animationsCancelled = true; } }];
        return el;
      }
    },
    decode: () => Promise.resolve(),
    animationReady: () => Promise.resolve(), animationTime: 0
  };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'strings_data', 'strings', 'data', 'chest_data', 'chest', 'ui-chest']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), c, { filename: file });
  }
  return {
    c, timers, observers, gridNodes, current: () => current,
    columns(n) { columns = n; observers.filter(o => o.active).forEach(o => o.fn()); },
    async flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); },
    advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        now = next[1].at;
        timers.delete(next[0]); next[1].f();
      }
      now = until;
    }
  };
}

function result(c, n = 40, chestId = c.CHESTS[0].id) {
  return { chestId, opened: 1, rewards: n ? [{ k: 'equip', r: 1, n, items: [{ n, level: 12, ancientCount: 0, icon: 'equipment/icon_chest.png' }] }] : [] };
}
const visible = grid => grid.children.filter(n => !n.classList.contains('is-pending')).map(n => Number(n.getAttribute('data-nfc-index')));

test('預留完整獎勵格版面時不消耗揭示時間，開箱後啟動且重複啟動不重置', () => {
  const h = harness(), { viewport, grid } = h.gridNodes();
  const ctrl = h.c.chestBindResultGrid(viewport, { total: 40, slots: [{ end: 40, html: '<li class="nfc-res-slot">item</li>' }] }, true);
  assert.ok(grid.children.length > 0, '先量好格位和完整高度');
  h.advance(5000);
  assert.deepEqual(visible(grid), []);
  assert.equal(h.timers.size, 0);
  ctrl.start();
  assert.deepEqual(visible(grid), [0]);
  h.advance(100);
  ctrl.start();
  assert.deepEqual(visible(grid), [0, 1]);
  h.advance(100);
  assert.deepEqual(visible(grid), [0, 1, 2]);
  ctrl.disconnect();
  ctrl.start();
  assert.equal(h.timers.size, 0);
});

test('搖晃結束1500ms先出光效，1650ms才出獎勵與確認，Esc及點擊不可提早跳過', async () => {
  const h = harness(), c = h.c;
  c.chestShowResult(result(c));
  const el = h.current();
  assert.equal(el.confirm.hidden, true);
  assert.deepEqual(visible(el.nodes.grid), []);
  assert.equal(el.panel.inert, true);
  await h.flush();
  assert.equal(el.style['--nfc-shake-time'], '1500ms');
  assert.equal(el.style['--nfc-lid-open-time'], '150ms');
  assert.ok(el.classList.contains('is-opening'));
  h.advance(1499);
  assert.equal(el.classList.contains('has-opening-fx'), false);
  assert.deepEqual(visible(el.nodes.grid), []);
  h.advance(1);
  assert.ok(el.classList.contains('has-opening-fx'));
  assert.ok(el.classList.contains('is-opening'));
  assert.equal(el.confirm.hidden, true);
  assert.deepEqual(visible(el.nodes.grid), []);
  h.advance(149);
  el.emit('cancel'); el.confirm.emit('click'); el.emit('keydown', { key: 'Escape' });
  assert.equal(h.current(), el);
  assert.equal(el.confirm.hidden, true);
  h.advance(1);
  assert.ok(el.classList.contains('is-opened'));
  assert.ok(el.classList.contains('has-opening-fx'));
  assert.equal(el.nodes.viewport.hidden, false);
  assert.equal(el.confirm.hidden, false);
  assert.equal(el.confirm.disabled, false);
  assert.equal(el.confirm.focused, true);
  assert.equal(el.panel.inert, false);
  assert.equal(el.panel.getAttribute('aria-hidden'), 'false');
  assert.deepEqual(visible(el.nodes.grid), [0]);
  h.advance(99); assert.deepEqual(visible(el.nodes.grid), [0]);
  h.advance(1); assert.deepEqual(visible(el.nodes.grid), [0, 1]);
  h.advance(800); assert.deepEqual(visible(el.nodes.grid), Array.from({ length: 10 }, (_, i) => i));
  h.advance(100); assert.equal(visible(el.nodes.grid).length, 11);
});

test('虛擬格捲動或縮放不會提前顯示尚未揭示的物品，離屏物品仍依全域次序揭示', () => {
  const h = harness(), { viewport, grid } = h.gridNodes();
  const ctrl = h.c.chestBindResultGrid(viewport, { total: 100000, slots: [{ end: 100000, html: '<li class="nfc-res-slot">item</li>' }] });
  assert.ok(grid.children.length <= 40);
  viewport.scrollTop = 5600; viewport.emit('scroll');
  assert.deepEqual(visible(grid), []);
  h.advance(1000); assert.deepEqual(visible(grid), []);
  h.columns(5); assert.deepEqual(visible(grid), []);
  viewport.scrollTop = 0; viewport.emit('scroll');
  assert.deepEqual(visible(grid), Array.from({ length: 11 }, (_, i) => i));
  assert.equal(grid.children[11].getAttribute('aria-hidden'), 'true');
  viewport.emit('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 7, clientY: 50 });
  assert.equal(viewport.hasPointerCapture(7), true);
  ctrl.disconnect();
  assert.equal(viewport.hasPointerCapture(7), false);
  assert.equal(h.timers.size, 0);
});

for (const event of ['click', 'cancel', 'keydown', 'close']) {
  test(`${event}中止未播完獎勵、旋轉光效、觀察器及排隊演出，後續開箱重新計時`, async () => {
    const h = harness(), c = h.c;
    c.chestShowResult(result(c)); await h.flush(); h.advance(1650);
    const el = h.current();
    c.chestShowResult(result(c)); assert.equal(c.CHEST_UI.results.length, 1);
    if (event === 'click') el.confirm.emit('click');
    else if (event === 'keydown') el.emit('keydown', { key: 'Escape', repeat: false, isComposing: false });
    else if (event === 'close') el.close();
    else el.emit(event);
    assert.equal(h.current(), null);
    assert.equal(h.timers.size, 0);
    assert.ok(h.observers.every(o => !o.active));
    assert.equal(c.CHEST_UI.results.length, 0);
    assert.equal(el.animationsCancelled, true);
    h.advance(50000); assert.equal(h.current(), null);
    c.chestShowResult(result(c)); await h.flush();
    assert.equal(h.current().confirm.hidden, true);
    h.advance(1650); assert.deepEqual(visible(h.current().nodes.grid), [0]);
  });
}

test('冷圖解碼前不耗用開箱時長，解碼失敗仍可完成，外部提前關閉不殘留計時', async () => {
  const h = harness(), c = h.c;
  let complete;
  c.decode = () => new Promise(r => { complete = r; });
  c.chestShowResult(result(c)); h.advance(10000);
  assert.equal(h.timers.size, 0);
  complete(); await h.flush();
  h.advance(1649); assert.equal(h.current().confirm.hidden, true);
  h.current().close(); assert.equal(h.timers.size, 0);
  c.decode = () => Promise.reject(new Error('missing image'));
  c.chestShowResult(result(c, 0)); await h.flush(); h.advance(1650);
  assert.equal(h.current().confirm.hidden, false);
  assert.ok(h.current().classList.contains('is-art-fallback'));
  h.current().close();
  c.decode = () => new Promise(r => { complete = r; });
  c.chestShowResult(result(c)); h.current().close(); complete(); await h.flush();
  assert.equal(h.timers.size, 0); assert.equal(h.current(), null);
});

test('CSS首幀尚未起播不消耗倒數，提前關閉／取消ready後不殘留光效計時', async () => {
  const h = harness(), c = h.c;
  let begin;
  c.animationReady = () => new Promise(resolve => { begin = resolve; });
  c.chestShowResult(result(c)); await h.flush();
  const el = h.current();
  h.advance(300);
  assert.equal(h.timers.size, 0);
  assert.equal(el.classList.contains('has-opening-fx'), false);
  assert.equal(el.confirm.hidden, true);
  begin(); await h.flush();
  h.advance(1499); assert.equal(el.classList.contains('has-opening-fx'), false);
  h.advance(1); assert.equal(el.classList.contains('has-opening-fx'), true);
  h.advance(149); assert.equal(el.confirm.hidden, true);
  h.advance(1); assert.equal(el.confirm.hidden, false);
  el.confirm.emit('click');
  c.chestShowResult(result(c)); await h.flush();
  const complete = begin;
  h.current().close(); complete(); await h.flush();
  assert.equal(h.timers.size, 0); assert.equal(h.current(), null);
  c.animationReady = () => Promise.reject(new Error('animation cancelled'));
  c.chestShowResult(result(c)); await h.flush(); h.advance(1650);
  assert.equal(h.current().confirm.hidden, false);
  h.current().close();
});

test('CSS ready回呼延遲時扣除已播放時間，掀蓋起播事件保證光效先可見', async () => {
  const h = harness(), c = h.c;
  c.animationTime = 20;
  c.chestShowResult(result(c)); await h.flush();
  const el = h.current();
  h.advance(1479); assert.equal(el.classList.contains('has-opening-fx'), false);
  h.advance(1); assert.equal(el.classList.contains('has-opening-fx'), true);
  h.advance(149); assert.equal(el.confirm.hidden, true);
  h.advance(1); assert.equal(el.confirm.hidden, false);
  el.close();
  c.animationTime = 0;
  c.chestShowResult(result(c)); await h.flush();
  const next = h.current();
  next.emit('animationstart', { animationName: 'nfc-chest-charge' });
  assert.equal(next.classList.contains('has-opening-fx'), false);
  next.emit('animationstart', { animationName: 'nfc-open-sheet' });
  assert.equal(next.classList.contains('has-opening-fx'), true);
  assert.equal(next.confirm.hidden, true);
  next.close(); assert.equal(h.timers.size, 0);
});

test('五種品質依配置選擇色系與箱圖，空獎勵仍有確認，所有格完成後停止計時', async () => {
  const h = harness(), c = h.c;
  for (const def of c.CHESTS) {
    c.chestShowResult(result(c, 0, def.id));
    assert.equal(h.current().className, 'nfc-result q-' + def.quality);
    assert.ok(h.current().innerHTML.includes('images/chests/' + c.CHEST_ART_FILES[def.quality] + '.webp'));
    await h.flush(); h.advance(1650);
    assert.equal(h.current().nodes.viewport.hidden, true);
    assert.equal(h.current().confirm.disabled, false);
    assert.equal(h.timers.size, 0);
    h.current().confirm.emit('click');
  }
  c.chestShowResult(result(c, 2)); await h.flush(); h.advance(1750);
  assert.deepEqual(visible(h.current().nodes.grid), [0, 1]);
  assert.equal(h.timers.size, 0);
});

test('品質光效共用卡片顏色，由提前光效狀態持續旋轉，減少動態保留靜態光效', () => {
  const css = fs.readFileSync(path.join(root, 'css/chest.css'), 'utf8');
  for (const quality of ['rare', 'epic', 'legendary', 'mythic']) {
    assert.match(css, new RegExp('\\.nfc-card\\.q-' + quality + ', \\.nfc-result\\.q-' + quality + ' \\{ --q:'));
  }
  assert.match(css, /\.has-opening-fx \.nfc-res-halo \{ animation: nfc-light-spin 24s linear infinite/);
  assert.match(css, /\.has-opening-fx \.nfc-res-rays \{ animation: nfc-light-spin 18s linear infinite reverse/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.nfc-res-slot\.is-pending \{ visibility: hidden/);
});

test('五品質使用25幀透明立體開箱圖集，保留首幀、末幀及相同演出時鐘', () => {
  const crypto = require('node:crypto');
  const directory = path.join(root, 'images/chests/opening');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  assert.equal(manifest.frames, 25);
  assert.equal(manifest.columns, 5);
  assert.equal(manifest.frameSize, 320);
  assert.equal(manifest.version, 3);
  assert.deepEqual(Object.keys(manifest.files).sort(), ['bronze.webp','epic.webp','fine.webp','legendary.webp','mythic.webp']);
  for (const [name, sha] of Object.entries(manifest.files)) {
    const geometry=manifest.geometry[path.basename(name,'.webp')];
    assert.ok(geometry.minShellThickness>.04, name+' positive solid thickness');
    assert.ok(geometry.liningRecessDepth>.3, name+' recessed curved cavity');
    assert.equal(geometry.edgeWalls, 4);
    assert.ok(geometry.innerSurfaceVertices>400, name+' curved lining, not a quad');
    assert.equal(geometry.opaqueTexturedEndCaps, 2, name+' complete painted end caps');
    assert.equal(geometry.slopedCavityWalls, 4, name+' visibly sloped cavity walls');
    assert.ok(geometry.recessedCenterWidth/geometry.mouthWidth<.75, name+' narrower recessed lining');
    assert.equal(geometry.mouthRimFaces, 4);
    assert.equal(geometry.cornerHighlights, 4);
    assert.ok(geometry.exposedRoofPixels>15, name+' outer roof remains in view');
    assert.ok(geometry.capSourceAlphaMin>.95, name+' UVs sample opaque painted pixels');
    assert.equal(geometry.endDegrees, 60);
    const bytes = fs.readFileSync(path.join(directory, name));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha, name);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    let found = false;
    for (let offset = 12; offset + 8 < bytes.length;) {
      const kind = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
      if (kind === 'VP8L') {
        assert.equal(bytes[offset+8], 0x2f);
        const bits = bytes.readUInt32LE(offset+9);
        assert.equal((bits & 0x3fff)+1, 1600, name+' width');
        assert.equal(((bits >>> 14) & 0x3fff)+1, 1600, name+' height');
        found = true; break;
      }
      offset += 8 + size + (size % 2);
    }
    assert.ok(found, name+' lossless WebP');
  }
  const css = fs.readFileSync(path.join(root, 'css/chest.css'), 'utf8');
  assert.match(css, /nfc-open-sheet var\(--nfc-lid-open-time\) steps\(1, end\) var\(--nfc-shake-time\) both/);
  assert.match(css, /0\.000000% \{ transform: translate\(0, 0\)/);
  assert.match(css, /100\.000000% \{ transform: translate\(-80%, -80%\)/);
  assert.match(css, /\.is-opened \.nfc-res-sheet \{ transform: translate\(-80%, -80%\)/);
  assert.doesNotMatch(css, /nfc-res-lid|rotateX\(/);
});

test('抖動維持1.5秒且幅度加倍，歸位後延遲播放0.15秒開蓋', () => {
  const h=harness();
  const css=fs.readFileSync(path.join(root,'css/chest.css'),'utf8');
  assert.equal(h.c.CHEST_SHAKE_MS,1500);
  assert.equal(h.c.CHEST_LID_OPEN_MS,150);
  assert.equal(h.c.CHEST_OPENING_MS,1650);
  assert.match(css,/nfc-chest-charge var\(--nfc-shake-time\) ease-in-out both/);
  assert.match(css,/nfc-open-sheet var\(--nfc-lid-open-time\) steps\(1, end\) var\(--nfc-shake-time\) both/);
  const sheet=css.slice(css.indexOf('@keyframes nfc-open-sheet'),css.indexOf('@keyframes nfc-inner-opening'));
  const points=[...sheet.matchAll(/([\d.]+)% \{ transform: translate\(/g)].map(m=>Number(m[1]));
  assert.equal(points.length,25);
  assert.equal(points[0],0);
  assert.equal(points.at(-1),100);
  assert.ok(points.every((p,i)=>Math.abs(p-i*100/24)<.00001));
  const shake=css.slice(css.indexOf('@keyframes nfc-chest-charge'),css.indexOf('@keyframes nfc-open-sheet'));
  assert.match(shake,/0\.000000%, 100% \{ transform: translate\(0, 0\) rotate\(0\)/);
  const rotations=[...shake.matchAll(/rotate\((-?[\d.]+)deg\)/g)].map(m=>Math.abs(Number(m[1])));
  const moves=[...shake.matchAll(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/g)];
  assert.ok(rotations.length>=16);
  assert.equal(Math.max(...rotations),3.51);
  assert.equal(Math.max(...moves.map(m=>Math.abs(Number(m[1])))),4.47);
  assert.equal(Math.max(...moves.map(m=>Math.abs(Number(m[2])))),.7);
  assert.match(css,/\.has-opening-fx \.nfc-res-fx \{ opacity: 1; \}/);
});

for (const ms of [1499,1500,1575]) {
  test(`外部在${ms}ms關閉會清掉提前光效與開蓋計時，下一次開箱重置`, async () => {
    const h=harness(), c=h.c;
    c.chestShowResult(result(c)); await h.flush(); h.advance(ms);
    const el=h.current();
    assert.equal(el.classList.contains('has-opening-fx'),ms>=1500);
    el.close();
    assert.equal(h.timers.size,0);
    assert.ok(h.observers.every(o=>!o.active));
    h.advance(10000); assert.equal(h.current(),null);
    c.chestShowResult(result(c)); await h.flush();
    const next=h.current();
    h.advance(1499); assert.equal(next.classList.contains('has-opening-fx'),false);
    h.advance(1); assert.equal(next.classList.contains('has-opening-fx'),true);
    assert.equal(next.confirm.hidden,true);
    h.advance(150); assert.equal(next.confirm.hidden,false);
    next.confirm.emit('click'); assert.equal(h.timers.size,0);
  });
}
