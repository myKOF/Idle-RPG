const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* ---------- 最小假 DOM：只實作播放器用到的部分 ---------- */
function makeEnv(opts) {
  opts = opts || {};
  const timers = [];
  const anims = [];
  const docListeners = {};
  const winListeners = {};
  function el(tag) {
    const e = {
      tag, className: '', style: {}, children: [], parentNode: null, attrs: {}, listeners: {}, textContent: '',
      appendChild(c) { c.parentNode = e; e.children.push(c); return c; },
      removeChild(c) { e.children = e.children.filter((x) => x !== c); c.parentNode = null; return c; },
      setAttribute(k, v) { e.attrs[k] = v; },
      addEventListener(t, fn) { (e.listeners[t] = e.listeners[t] || []).push(fn); },
      focus() {},
      animate(frames, timing) {
        const a = {
          el: e, frames, timing, currentTime: 0, state: 'running', onfinish: null,
          pause() { a.state = 'paused'; }, play() { a.state = 'running'; }, cancel() { a.state = 'cancelled'; }
        };
        anims.push(a);
        return a;
      }
    };
    return e;
  }
  const body = el('body');
  const document = {
    body, hidden: !!opts.hidden,
    createElement: el,
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    removeEventListener(t, fn) { docListeners[t] = (docListeners[t] || []).filter((x) => x !== fn); }
  };
  const window = {
    addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    removeEventListener(t, fn) { winListeners[t] = (winListeners[t] || []).filter((x) => x !== fn); },
    matchMedia: () => ({ matches: !!opts.reduced })
  };
  function Element() {}
  Element.prototype.animate = function () {};
  const bridgeCalls = [];
  const ctx = {
    console: { error() {}, warn() {}, log() {} },
    document, window, Element,
    location: { search: opts.search || '' },
    STR: (id) => '#' + id,
    setTimeout(fn, ms) { timers.push({ fn, ms, alive: true }); return timers.length; },
    clearTimeout(id) { if (id && timers[id - 1]) timers[id - 1].alive = false; },
    WorkerBridge: {
      suspendStartupHoldTimeout() { bridgeCalls.push('suspend'); },
      resumeStartupHoldTimeout() { bridgeCalls.push('resume'); }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(read('js/intro-data.js') + '\nthis.INTRO_TIMELINES = INTRO_TIMELINES;', ctx);
  vm.runInContext(read('js/intro-player.js') + '\nthis.IntroPlayer = IntroPlayer;', ctx);
  const clock = () => anims.find((a) => a.el.className === 'intro-clock');
  const playerRoot = () => body.children.find((c) => c.className.indexOf('intro-player') === 0);
  return { ctx, P: ctx.IntroPlayer, body, anims, timers, docListeners, winListeners, bridgeCalls, clock, playerRoot };
}

const SAMPLE = {
  layers: [
    { kind: 'shape', cls: 'a', at: 0, dur: 1000, from: { scale: 1 }, to: { scale: 2 } },
    { kind: 'text', str: 48, at: 500, dur: 1500 }
  ]
};

/* ---------- 純函式 ---------- */
test('淡入淡出關鍵影格：offset 不倒退，淡入淡出超過持續時間時等比壓縮', () => {
  const { P } = makeEnv();
  const kf = P._internal.opacityKeyframes;
  const norm = (frames) => JSON.parse(JSON.stringify(frames.map((f) => [Math.round(f.offset * 1000) / 1000, f.opacity])));
  assert.deepStrictEqual(norm(kf({ dur: 1000, fadeIn: 200, fadeOut: 300 })), [[0, 0], [0.2, 1], [0.7, 1], [1, 0]]);
  assert.deepStrictEqual(norm(kf({ dur: 1000, fadeIn: 0, fadeOut: 0 })), [[0, 1], [1, 1]], '硬切：全程不透明');
  const squeezed = norm(kf({ dur: 500, fadeIn: 500, fadeOut: 500 }));
  for (let i = 1; i < squeezed.length; i++) assert.ok(squeezed[i][0] >= squeezed[i - 1][0], 'offset 必須非遞減');
  assert.deepStrictEqual(squeezed[1], [0.5, 1]);
});

test('位移關鍵影格：省略欄位取預設值，只有 from 時停在原地', () => {
  const { P } = makeEnv();
  assert.equal(P._internal.transformOf({ x: 3, scale: 1.2 }), 'translate(3vw, 0vh) scale(1.2, 1.2) rotate(0deg)');
  assert.equal(P._internal.transformOf({ sx: 0.1 }), 'translate(0vw, 0vh) scale(0.1, 1) rotate(0deg)', 'sx／sy 分軸縮放');
  assert.equal(P._internal.motionKeyframes({}), null, '沒有 from/to 就不建位移動畫');
  const m = P._internal.motionKeyframes({ from: { y: 2 } });
  assert.equal(m[0].transform, m[1].transform);
});

test('時間軸檢查：資料錯誤寧可不播', () => {
  const { P } = makeEnv();
  const v = P._internal.validateTimeline;
  assert.deepStrictEqual(Array.from(v(SAMPLE)), []);
  assert.ok(v({ layers: [] }).length > 0);
  assert.ok(v({ layers: [{ kind: 'video', at: 0, dur: 1 }] }).length > 0);
  assert.ok(v({ layers: [{ kind: 'text', at: 0, dur: 1 }] }).length > 0, 'text 沒有 String 編號');
  assert.ok(v({ layers: [{ kind: 'image', at: 0, dur: 1 }] }).length > 0, 'image 沒有 src');
  assert.ok(v({ layers: [{ kind: 'shape', at: -1, dur: 1 }] }).length > 0);
  assert.equal(P._internal.timelineDuration(SAMPLE), 2000, '總長預設取最晚結束的圖層');
});

test('所有內建時間軸都通過檢查，文字圖層的 String 編號都在表裡', () => {
  const { P, ctx } = makeEnv();
  const ids = new Set(read('config/CSV/String.csv').split(/\r?\n/).slice(1).map((l) => l.split(',')[0]));
  for (const [key, tl] of Object.entries(ctx.INTRO_TIMELINES)) {
    assert.deepStrictEqual(Array.from(P._internal.validateTimeline(tl)), [], key);
    tl.layers.filter((l) => l.kind === 'text').forEach((l) => assert.ok(ids.has(String(l.str)), key + ' 缺 String ' + l.str));
  }
  assert.ok(ids.has('2410'), '略過按鈕文字');
});

test('起播選擇：預設每次播標題開場，網址可指定或關閉，決定論測試模式不播', () => {
  const { P, ctx } = makeEnv();
  const pick = P._internal.chooseStartupTimeline;
  const tls = { test: {}, title: {} };
  assert.equal(pick({ hasSave: false }, '', tls), 'title', '新玩家');
  assert.equal(pick({ hasSave: true }, '?lang=en', tls), 'title', '舊存檔也播');
  assert.equal(pick({}, '?seed=42', tls), null, '決定論測試模式不播');
  assert.equal(pick({}, '?seed=42&intro=title', tls), 'title', '網址指定優先');
  assert.equal(pick({}, '', { test: {} }), null, '沒有 title 時退回不播');
  assert.equal(pick({}, '', ctx.INTRO_TIMELINES), 'title', '內建資料有 title');
  assert.equal(pick({}, '?intro=test', tls), 'test');
  assert.equal(pick({}, '?seed=1&intro=title', tls), 'title');
  assert.equal(pick({}, '?intro=0', tls), null);
  assert.equal(pick({}, '?intro=off', tls), null);
  assert.equal(pick({}, '?intro=nope', tls), null, '不存在的鍵不播');
  assert.equal(pick({}, '?intro=toString', tls), null, '原型鍵不算');
});

/* ---------- 播放流程 ---------- */
test('播完：總時鐘結束才收掉舞台，onDone 與 whenIdle 各呼叫一次', () => {
  const env = makeEnv();
  const done = [];
  const idle = [];
  assert.equal(env.P.play(SAMPLE, { onDone: (r) => done.push(r) }), true);
  assert.equal(env.P.isPlaying(), true);
  assert.ok(env.playerRoot(), '舞台已掛上 body');
  env.P.whenIdle((r) => idle.push(r));
  assert.deepStrictEqual(idle, [], '播放中不立即回呼');
  assert.equal(env.clock().timing.duration, 2000);
  env.clock().onfinish();
  assert.deepStrictEqual(done, ['end']);
  assert.deepStrictEqual(idle, ['end']);
  assert.equal(env.playerRoot(), undefined, '舞台已移除');
  assert.ok(env.anims.every((a) => a.state === 'cancelled'), '動畫全部取消');
  env.clock().onfinish();
  assert.deepStrictEqual(done, ['end'], '重複觸發不再回呼');
  const later = [];
  env.P.whenIdle((r) => later.push(r));
  assert.deepStrictEqual(later, ['idle'], '沒在播時立即回呼');
});

test('略過：淡出後結束；淡出期間總時鐘結束不會提早收掉；Esc 不往下傳', () => {
  const env = makeEnv();
  const done = [];
  env.P.play(SAMPLE, { onDone: (r) => done.push(r) });
  const keyFn = env.winListeners.keydown[0];
  let stopped = false, prevented = false;
  keyFn({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.ok(stopped && prevented, 'Esc 不讓底下的遊戲同時開選單');
  assert.equal(env.P.state().skipping, true);
  env.clock().onfinish();
  assert.deepStrictEqual(done, [], '淡出中不因時鐘結束而跳過淡出');
  const fade = env.anims.find((a) => a.el === env.playerRoot());
  fade.onfinish();
  assert.deepStrictEqual(done, ['skip']);
  assert.equal(env.winListeners.keydown.length, 0, '鍵盤監聽已移除');
  let other = false;
  env.P.play(SAMPLE, {});
  env.winListeners.keydown[0]({ key: 'a', preventDefault() { other = true; }, stopPropagation() { other = true; } });
  assert.equal(other, false, '其他按鍵照常傳下去');
});

test('中止：立即收掉，不淡出', () => {
  const env = makeEnv();
  const done = [];
  env.P.play(SAMPLE, { onDone: (r) => done.push(r) });
  env.P.abort('veil');
  assert.deepStrictEqual(done, ['veil']);
  assert.equal(env.P.isPlaying(), false);
});

test('分頁隱藏：所有動畫暫停、保險計時器停掉；回來後繼續', () => {
  const env = makeEnv({ hidden: true });
  env.P.play(SAMPLE, {});
  assert.ok(env.anims.every((a) => a.state === 'paused'), '隱藏狀態下載入就先暫停');
  assert.ok(env.timers.every((t) => !t.alive), '隱藏時不計保險時間');
  env.ctx.document.hidden = false;
  env.docListeners.visibilitychange.forEach((fn) => fn());
  assert.ok(env.anims.every((a) => a.state === 'running'));
  assert.ok(env.timers.some((t) => t.alive), '回來後重新計保險時間');
});

test('減少動態偏好：只建淡入淡出，不建位移動畫', () => {
  const env = makeEnv({ reduced: true });
  env.P.play(SAMPLE, {});
  assert.ok(env.anims.every((a) => !a.frames.some((f) => 'transform' in f)));
  assert.equal(env.P.state().reduced, true);
});

test('保險：可見狀態下超過預定長度仍未結束就強制收掉', () => {
  const env = makeEnv();
  const done = [];
  env.P.play(SAMPLE, { onDone: (r) => done.push(r) });
  const fs_ = env.timers.filter((t) => t.alive);
  assert.equal(fs_.length, 1);
  assert.ok(fs_[0].ms > 2000);
  fs_[0].fn();
  assert.deepStrictEqual(done, ['failsafe']);
});

test('開機起播：播放中暫停開機等待的逾時，結束時交回', () => {
  const env = makeEnv({ search: '?intro=test' });
  assert.equal(env.P.startupBegin({ hasSave: true }), true);
  assert.deepStrictEqual(env.bridgeCalls, ['suspend']);
  env.clock().onfinish();
  assert.deepStrictEqual(env.bridgeCalls, ['suspend', 'resume']);
  const env2 = makeEnv({ search: '?intro=0' });
  assert.equal(env2.P.startupBegin({ hasSave: false }), false, '?intro=0 不播');
  assert.deepStrictEqual(env2.bridgeCalls, [], '沒播就不動開機等待');
});

/* ---------- 停格等載入（標題開場） ---------- */
const HOLDING = {
  holdAt: 1000,
  layers: [{ kind: 'shape', at: 0, dur: 1500, fadeOut: 500 }]
};
const holdClock = (env) => env.anims.find((a) => a.el.className === 'intro-clock' && a.timing.duration === 1000);

test('停格：載入沒好就停在停格點，所有動畫暫停、顯示圓點、不計保險時間；放行後播完', () => {
  const env = makeEnv();
  const done = [];
  env.P.play(HOLDING, { hold: true, onDone: (r) => done.push(r) });
  assert.ok(env.playerRoot().children.some((c) => c.className === 'intro-hold-dots'), '有載入圓點');
  holdClock(env).onfinish();
  assert.equal(env.P.state().holding, true);
  assert.match(env.playerRoot().className, /is-holding/);
  assert.ok(env.anims.every((a) => a.state === 'paused'), '停住');
  assert.ok(env.timers.filter((t) => t.alive).length === 1, '只剩停格上限計時（保險時間不計）');
  env.ctx.document.hidden = false;
  env.docListeners.visibilitychange.forEach((fn) => fn());
  assert.ok(env.anims.every((a) => a.state === 'paused'), '切回分頁也繼續停著');
  env.P.release();
  assert.equal(env.P.state().holding, false);
  assert.doesNotMatch(env.playerRoot().className, /is-holding/);
  assert.ok(env.anims.every((a) => a.state === 'running'), '放行後接著播');
  env.clock().onfinish();
  assert.deepStrictEqual(done, ['end']);
});

test('停格：停格點之前就放行的話不停，直接播完', () => {
  const env = makeEnv();
  env.P.play(HOLDING, { hold: true });
  env.P.release();
  holdClock(env).onfinish();
  assert.equal(env.P.state().holding, false);
  assert.ok(env.anims.every((a) => a.state === 'running'));
});

test('停格：超過上限自動放行；GM 預覽（沒有 hold）不停格；停格中仍可略過', () => {
  const env = makeEnv();
  env.P.play(HOLDING, { hold: true });
  holdClock(env).onfinish();
  const cap = env.timers.find((t) => t.alive);
  assert.equal(cap.ms, 20000, '與開機等待逾時同長');
  cap.fn();
  assert.equal(env.P.state().holding, false);
  assert.equal(env.P.state().released, true);

  const gm = makeEnv();
  gm.P.play(HOLDING, {});
  assert.equal(holdClock(gm), undefined, '沒有停格時鐘');
  assert.ok(!gm.playerRoot().children.some((c) => c.className === 'intro-hold-dots'), '不顯示圓點');

  const sk = makeEnv();
  const done = [];
  sk.P.play(HOLDING, { hold: true, onDone: (r) => done.push(r) });
  holdClock(sk).onfinish();
  sk.P.skip();
  sk.anims.find((a) => a.el === sk.playerRoot()).onfinish();
  assert.deepStrictEqual(done, ['skip']);
  assert.ok(sk.timers.every((t) => !t.alive || t.ms !== 20000), '收掉時清掉停格上限計時');
});

test('開機起播帶停格；揭幕前先放行停格再等播完', () => {
  const env = makeEnv({ search: '' });
  assert.equal(env.P.startupBegin({ hasSave: true }), true, '預設播標題');
  assert.equal(env.P.state().id, 'title');
  assert.ok(holdClock(env) === undefined && env.anims.some((a) => a.el.className === 'intro-clock' && a.timing.duration === 1900), 'title 的停格點 1.9 秒');
  const main = read('js/main.js');
  assert.match(main, /IntroPlayer\.release\(\);[^\n]*\n\s*IntroPlayer\.whenIdle\(reveal\);/, '先放行再等');
});

test('標題開場：停格點之後只剩淡出，停住的那一格是完整標題', () => {
  const { ctx } = makeEnv();
  const tl = ctx.INTRO_TIMELINES.title;
  assert.ok(tl.holdAt > 0 && tl.holdAt < tl.duration);
  for (const l of tl.layers) {
    const fadeOutStart = l.at + l.dur - (l.fadeOut === undefined ? 400 : l.fadeOut);
    assert.ok(l.at + (l.fadeIn === undefined ? 400 : l.fadeIn) <= tl.holdAt, '停格前已完全淡入：' + (l.cls || l.str));
    assert.ok(fadeOutStart >= tl.holdAt, '停格後才開始淡出：' + (l.cls || l.str));
  }
  assert.ok(tl.duration <= 3000, '載入很快時總長不超過 3 秒');
});

/* ---------- 開機流程接線 ---------- */
test('接線：存檔確認後、Worker 開機前起播；揭幕等動畫；收掉 Loading 會中止動畫', () => {
  const bridge = read('js/bridge.js');
  const main = read('js/main.js');
  const html = read('index.html');
  const gate = /SaveOrigin\.gate\(save, info, function \(approved\) \{[\s\S]*?WorkerBridge\.start\(/.exec(bridge);
  assert.ok(gate && /IntroPlayer\.startupBegin\(\{ hasSave: !!approved \}\)/.test(gate[0]), '在 Worker 開機前起播');
  assert.match(bridge, /suspendStartupHoldTimeout: suspendStartupHoldTimeout, resumeStartupHoldTimeout: resumeStartupHoldTimeout/);
  const resume = /function resumeStartupHoldTimeout\(\) \{[\s\S]*?\n  \}/.exec(bridge)[0];
  assert.match(resume, /if \(!_startupHold\) return;/, '已放行就不再計時');
  assert.match(main, /IntroPlayer\.whenIdle\(reveal\)/, '揭幕等動畫');
  assert.match(main, /finished = true;\s*revealWhenIntroIdle\(\);/);
  assert.match(html, /IntroPlayer\.isPlaying\(\)\) IntroPlayer\.abort\('veil'\)/, 'hideLoadingScreen 收掉動畫');
  const iData = html.indexOf('js/intro-data.js'), iPlayer = html.indexOf('js/intro-player.js'), iBridge = html.indexOf('js/bridge.js');
  assert.ok(iData > 0 && iData < iPlayer && iPlayer < iBridge, '資料 → 播放器 → bridge 的載入順序');
  assert.match(html, /css\/intro\.css\?v=/);
});
