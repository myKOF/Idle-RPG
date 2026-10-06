const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const perfSrc = read('js/battle-perf.js');
const coreSrc = read('js/vfx-core.js');

/* 2026-09-30：使用者回報敵人越多、連鎖特效越滾越多，FPS 掉到 7，但本機（同一張 GPU）量不出來。
   battle-perf.js 是為了在使用者自己的場景裡量「時間花在哪」，所以這裡釘的是：
   統計的視窗與算式、掛勾真的數得到東西、以及非內部版本一行都不做。 */

function loadPerf(extra) {
  const sandbox = Object.assign({
    window: {}, location: { search: '', hostname: 'localhost', protocol: 'http:' },
    isInternalVersion: () => true, performance, console, setInterval, clearInterval,
    Date, Math, Object, Array, String, Number, JSON, Promise
  }, extra || {});
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(coreSrc.replace(/if \(typeof module[\s\S]*$/, '') + '\nthis.VFXCore = VFXCore;', ctx);
  vm.runInContext(perfSrc.replace(/if \(typeof module[\s\S]*$/, '') + '\nthis.BattlePerf = BattlePerf;', ctx);
  return ctx;
}

function frame(t, over) {
  return Object.assign({ t, interval: 16, tick: 2, persp: 1, draw: 3, core: 1, nodes: 100, draws: 10, uploads: 0 }, over);
}

test('summarize：只算視窗內的幀，FPS 與缺口由間隔和三段 CPU 推得', () => {
  const P = loadPerf().BattlePerf;
  const frames = [frame(0), frame(500), frame(1500, { interval: 100 }), frame(1600, { interval: 100 })];
  const s = P._summarize({ frames, plays: [], arrivals: [], flushes: [], loafs: [], env: {} }, 2000);
  // 視窗 (1000, 2000]：只剩 t=1500、1600 兩幀
  assert.equal(s.frames, 2);
  assert.equal(s.interval.avg, 100);
  assert.equal(s.cpu, 6);                 // tick 2 + 透視 1 + 送出 3
  assert.equal(s.gap, 94);                // 100 − 6：沒被 Pixi 自己的工作解釋的時間
  assert.ok(Math.abs(s.fps - 10) < 1e-9); // 兩幀相隔 100ms
});

test('summarize：事件到達與 preset 播放用「視窗內次數 ÷ 視窗秒數」，並依次數排 Top', () => {
  const P = loadPerf().BattlePerf;
  const mk = (t, key) => ({ t, key });
  const arrivals = [mk(100, 'lightning-chain'), mk(1200, 'lightning-chain'), mk(1300, 'float'), mk(1400, 'lightning-chain'), mk(1900, 'thunder-strike')];
  const plays = [mk(50, 'old'), mk(1500, 'bolt'), mk(1600, 'bolt'), mk(1700, 'hit')];
  const s = P._summarize({ frames: [], arrivals, plays, flushes: [], loafs: [], env: {} }, 2000);
  assert.equal(s.arrive, 4);              // t=100 落在視窗外
  assert.equal(s.arriveFloat, 1);
  assert.equal(s.arriveVfx, 3);
  assert.deepEqual(Array.from(s.arriveTop[0]), ['lightning-chain', 2]);
  assert.equal(s.plays, 3);
  assert.deepEqual(Array.from(s.playsTop[0]), ['bolt', 2]);
  assert.ok(!('old' in s.playsAll), '視窗外的播放不能算進來');
});

test('summarize：視窗長度會換算成每秒（500ms 視窗 → 次數 ×2）', () => {
  const P = loadPerf().BattlePerf;
  const s = P._summarize({ frames: [], windowMs: 500, arrivals: [{ t: 1800, key: 'a' }, { t: 1900, key: 'a' }], plays: [], env: {} }, 2000);
  assert.equal(s.arrive, 4);
});

test('summarize：長幀依函式歸戶，回傳耗時最多的前兩名', () => {
  const P = loadPerf().BattlePerf;
  const loafs = [
    { t: 1500, dur: 200, scripts: 150, render: 40, layout: 10, top: [['ui.js:onmessage', 90], ['x.js:tick', 60]] },
    { t: 1800, dur: 100, scripts: 70, render: 20, layout: 5, top: [['ui.js:onmessage', 40], ['y.js:z', 5], ['x.js:tick', 20]] },
    { t: 100, dur: 900, scripts: 900, render: 0, layout: 0, top: [['old', 900]] }
  ];
  const s = P._summarize({ frames: [], loafs, env: {} }, 2000);
  assert.equal(s.loaf.n, 2);
  assert.equal(s.loaf.max, 200);
  assert.equal(s.loaf.top[0][0], 'ui.js:onmessage');
  assert.equal(s.loaf.top[0][1], 130);
  assert.equal(s.loaf.top[1][0], 'x.js:tick');
});

test('formatLines：關鍵數字都在，且每行不超過 100 字元（放得進戰鬥區）', () => {
  const P = loadPerf().BattlePerf;
  const frames = [frame(1000), frame(1100), frame(1200)];
  const s = P._summarize({
    frames, arrivals: [{ t: 1500, key: 'lightning-chain-hit' }], plays: [{ t: 1500, key: 'bolt-chain-lightning' }], flushes: [{ t: 1500, ms: 3.5, n: 20 }],
    loafs: [], env: { ent: 63, eff: 214, parts: 1907, floats: 88, queue: 45, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Direct3D11)', w: 670, h: 813, res: 1, persp: 0.82, maxFPS: 60, simRate: 1, flags: '[fx=off]' }
  }, 1300);
  const lines = P._formatLines(s);
  const all = lines.join('\n');
  for (const needle of ['敵 63', '特效 214', '粒子 1907', '飄字 88', '佇列 45', 'GTX 1050', '670x813', '[fx=off]', 'bolt-chain-lightning', 'lightning-chain-hit']) {
    assert.ok(all.includes(needle), '疊層缺少：' + needle);
  }
  lines.forEach((l) => assert.ok(l.length <= 100, '太長(' + l.length + ')：' + l));
});

test('formatLines：沒有 LoAF 明細時退回長任務；占用率＝三段 CPU ÷ 間隔；GPU 名稱去掉廠商重複與十六進位碼', () => {
  const P = loadPerf().BattlePerf;
  const frames = [frame(1000, { interval: 100, tick: 5, persp: 2, draw: 3 }), frame(1100, { interval: 100, tick: 5, persp: 2, draw: 3 })];
  const s = P._summarize({
    frames, tasks: [{ t: 1150, dur: 130 }, { t: 1180, dur: 70 }], loafs: [],
    env: { gpu: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 (0x00001C81) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.15.6094)' }
  }, 1300);
  assert.equal(s.tasks.n, 2);
  assert.equal(s.tasks.max, 130);
  assert.ok(Math.abs(s.busy - 0.1) < 1e-9, 'Pixi CPU 10ms / 間隔 100ms = 10%');
  const all = P._formatLines(s).join('\n');
  assert.ok(all.includes('占用 10%'));
  assert.ok(all.includes('長任務 2 個 最長 130ms'));
  assert.ok(all.includes('NVIDIA GeForce GTX 1050'));
  assert.ok(!all.includes('0x00001C81') && !all.includes('NVIDIA, NVIDIA'));
});

test('formatLines：命中密度控制介入時顯示密度、K 與每秒略過數；沒有這組資料（舊 Runtime）就不印這一行', () => {
  const P = loadPerf().BattlePerf;
  const frames = [frame(1000), frame(1100)];
  const on = P._formatLines(P._summarize({ frames, env: { quality: 0.5, hitCap: 2, cappedRate: 41.4, thinnedRate: 12 } }, 1200)).join('\n');
  assert.ok(on.includes('命中密度 x0.5(吃緊，已介入)'));
  assert.ok(on.includes('K=2'));
  assert.ok(on.includes('略過 41/s'));
  assert.ok(on.includes('少發粒子 12/s'));
  const calm = P._formatLines(P._summarize({ frames, env: { quality: 1, hitCap: 4, cappedRate: 0, thinnedRate: 0 } }, 1200)).join('\n');
  assert.ok(calm.includes('命中密度 x1.0') && !calm.includes('已介入'));
  const old = P._formatLines(P._summarize({ frames, env: {} }, 1200)).join('\n');
  assert.ok(!old.includes('命中密度'));
});

test('formatLines：第二輪降級（限頻、拖尾變疏、全場命中數）有資料才印；舊 Runtime 沒有就不多印一行', () => {
  const P = loadPerf().BattlePerf;
  const frames = [frame(1000), frame(1100)];
  const on = P._formatLines(P._summarize({ frames,
    env: { quality: 0.25, hitCap: 1, cappedRate: 80, thinnedRate: 20, throttledRate: 47.6, trailRate: 9.2, hitLive: 38 } }, 1200)).join('\n');
  assert.ok(on.includes('降級 限頻 48/s'));
  assert.ok(on.includes('拖尾變疏 9/s'));
  assert.ok(on.includes('全場命中 38'));
  const noData = P._formatLines(P._summarize({ frames, env: { quality: 0.25, hitCap: 1, cappedRate: 80, thinnedRate: 20 } }, 1200)).join('\n');
  assert.ok(!noData.includes('降級 限頻'), '只有第一輪資料時不印第二輪那一行');
  assert.ok(noData.includes('命中密度 x0.3'), '第一輪那一行照舊');
});

test('掛勾：Core 的 updateNode／update／play 與 gl 的 draw 都數得到，且不改變行為', () => {
  const ctx = loadPerf();
  const P = ctx.BattlePerf;
  assert.ok(P.enabled, '內部版本應該啟用');
  const Core = ctx.VFXCore;

  const updates = [];
  const backend = { createNode: () => ({}), updateNode: (n, t) => { updates.push(t.visible); }, destroyNode() {} };
  const rt = Core.createRuntime({ backend, resolver: { has: () => true, resolve: (id) => id } });
  // 不釘任何一份 preset 的內容：挑目錄裡第一份含 sprite 層的即可
  const dir = path.join(root, 'vfx/presets');
  const file = fs.readdirSync(dir).sort().find((f) => /\.json$/.test(f) &&
    JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).layers.some((l) => l.type === 'sprite' || !l.type));
  const preset = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  rt.registerPreset(preset);
  const h = rt.play(preset.id);
  assert.ok(h !== null && h !== undefined, 'play 應該回傳 handle（包裝不能吃掉回傳值）');

  // 用假 ticker 走一遍幀標記
  const listeners = [];
  const glCalls = [];
  const gl = {
    drawElements() { glCalls.push('d'); }, drawArrays() { glCalls.push('a'); },
    texImage2D() { glCalls.push('t'); }, texSubImage2D() { glCalls.push('s'); },
    getExtension: () => null, getParameter: () => 'FakeGPU', RENDERER: 1
  };
  P._hook({ ticker: { add: (fn, c, prio) => listeners.push({ fn, prio }) }, renderer: { gl, width: 1, height: 1, resolution: 1 } });
  listeners.sort((a, b) => b.prio - a.prio);
  assert.deepEqual(listeners.map((l) => l.prio), [100, -1, -11, -100], '四個標記要卡在 tickWorld(0)／透視(−10)／render(−25) 之間');

  listeners.forEach((l, i) => {
    if (i === 1) { rt.update(1 / 60); gl.drawElements(); gl.drawElements(); gl.texSubImage2D(); }   // tickWorld 內：推進特效
    if (i === 3) gl.drawArrays();                                                                    // render
    l.fn();
  });

  const st = P._state();
  assert.equal(updates.length > 0, true, '原本的 updateNode 仍要被呼叫');
  const f = st.frames[st.frames.length - 1];
  assert.equal(f.nodes, updates.length, '節點更新數要等於後端實際被呼叫的次數');
  assert.ok(f.core >= 0);
  assert.equal(f.draws, 3, 'draw call：drawElements×2 + drawArrays×1');
  assert.equal(f.uploads, 1);
  assert.equal(st.plays.length, 1);
  assert.equal(st.plays[0].key, preset.id);
});

test('非內部版本：不包裝 Core、不改 BattleRenderer，attach 回傳 false', () => {
  const ctx = loadPerf({ isInternalVersion: () => false, BattleRenderer: { onVfx() { return 'orig'; } } });
  const P = ctx.BattlePerf;
  assert.equal(P.enabled, false);
  assert.equal(P.active, false);
  assert.equal(P.attach(), false);
  assert.equal(ctx.VFXCore.__perfWrapped, undefined);
  assert.equal(ctx.BattleRenderer.onVfx(), 'orig');
});

test('?perf=0 可整個關掉；?fx=off／?float=off 只換掉對應的函式', () => {
  const off = loadPerf({ location: { search: '?perf=0', hostname: 'localhost', protocol: 'http:' } }).BattlePerf;
  assert.equal(off.enabled, false);

  const br = { onVfx() { return 'v'; }, onFloat() { return 'f'; }, onAct() { return 'a'; } };
  const ctx = loadPerf({ location: { search: '?fx=off&float=off', hostname: 'localhost', protocol: 'http:' }, BattleRenderer: br });
  assert.equal(ctx.BattleRenderer.onVfx(), undefined);
  assert.equal(ctx.BattleRenderer.onFloat(), undefined);
  assert.equal(ctx.BattleRenderer.onAct(), 'a', '其他函式不能動');

  const only = { onVfx() { return 'v'; }, onFloat() { return 'f'; } };
  loadPerf({ location: { search: '?fx=off', hostname: 'localhost', protocol: 'http:' }, BattleRenderer: only });
  assert.equal(only.onVfx(), undefined);
  assert.equal(only.onFloat(), 'f');
});

test('接線：index.html 在 ui.js 之後、main.js 之前載入；ui.js 只在 active 時通報；渲染器有 ?res=', () => {
  const html = read('index.html');
  const iUi = html.indexOf('js/ui.js');
  const iPerf = html.indexOf('js/battle-perf.js');
  const iMain = html.indexOf('js/main.js');
  assert.ok(iUi > 0 && iPerf > iUi && iMain > iPerf, 'battle-perf.js 要排在 ui.js 之後、main.js 之前');

  const ui = read('js/ui.js');
  assert.match(ui, /BattlePerf\.active\) BattlePerf\.noteArrival\(event\)/);
  assert.match(ui, /BattlePerf\.noteFlush\(/);
  assert.match(ui, /BattlePerf\.attach\(\)/);
  assert.match(ui, /BattlePerf\.lines\(\)/);

  const br = read('js/battle-renderer.js');
  const fn = br.slice(br.indexOf('function currentResolution()'), br.indexOf('/* ============ Bridge 訂閱'));
  assert.match(fn, /resolutionByQuery\(\)/);
  assert.match(fn, /Math\.max\(0\.25, Math\.min\(2\.5, v\)\)/);
});
