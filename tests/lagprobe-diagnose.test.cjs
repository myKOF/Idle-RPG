const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, 'js/lagprobe.js'), 'utf8');

/* 卡頓探針的判讀結論是「下一刀往哪砍」的唯一依據（2026-09-13 起），
   判錯一次的代價是回報者白跑一輪。三條分叉各自對應完全不同的修法，
   所以三條都要有測試釘住。

   這裡把探針放進一個可控的假瀏覽器：時鐘、rAF、PerformanceObserver 都由測試給，
   才能精準造出「畫面停住 N 次、主執行緒忙不忙、誰最貴」這幾種組合。 */
function bootProbe() {
  const logs = [];
  let now = 0;
  const rafQueue = [];
  let longTaskCb = null;

  const ctx = {
    console: { log: (...a) => logs.push(a.join(' ')), info() {}, warn() {}, error() {} },
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Error,
    isFinite,
    performance: { now: () => now },
    location: { search: '?lag=1', hostname: 'localhost', protocol: 'http:' },
    setTimeout: (fn) => { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
    PerformanceObserver: function (cb) {
      this.observe = (opts) => {
        if (opts && (opts.entryTypes || []).indexOf('longtask') >= 0) longTaskCb = cb;
      };
    },
    Element: function () {},
    HTMLElement: function () {},
    getComputedStyle: () => ({}),
  };
  ctx.Element.prototype = {};
  ctx.HTMLElement.prototype = {};
  ctx.window = ctx;
  ctx.document = {
    readyState: 'complete',
    addEventListener() {},
    getElementsByTagName: () => ({ length: 42 }),
    querySelectorAll: () => ({ length: 0 }),
    querySelector: () => null,
    getElementById: () => null,
    head: { appendChild() {} },
    createElement: () => ({ style: {}, remove() {} }),
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'js/lagprobe.js' });

  return {
    ctx,
    logs,
    setNow(t) { now = t; },
    /* 推進一個影格：時間跳到 t 之後叫出排隊中的 tick，探針就記到 (t - 上一格) 的間隔 */
    frame(t) {
      now = t;
      const cb = rafQueue.shift();
      if (cb) cb(t);
    },
    /* 送一個 rAF 回呼進去，並讓它「跑掉」ms 毫秒 */
    slowRafCallback(ms, name) {
      const fn = { [name]: () => { now += ms; } }[name];
      ctx.window.requestAnimationFrame(fn);
      /* 佇列裡還有 trackFrames 自己的 tick，shift() 會拿錯人；剛推進去的在最後面 */
      const wrapped = rafQueue.pop();
      if (wrapped) wrapped(now);
    },
    longTask(ms, atSec) {
      if (!longTaskCb) throw new Error('longtask observer 未註冊');
      longTaskCb({ getEntries: () => [{ duration: ms, startTime: atSec * 1000 }] });
    },
    verdict() {
      logs.length = 0;
      ctx.window.lagText();
      return logs.join('\n');
    },
  };
}

test('沒有產生畫面時，判讀要直說量不到，不能給出誤導的結論', () => {
  const p = bootProbe();
  p.setNow(20000);
  assert.match(p.verdict(), /沒有在產生畫面/);
});

test('有畫面但沒停住，判讀要說沒量到，並提醒在卡的當下重取', () => {
  const p = bootProbe();
  for (let i = 1; i <= 5; i++) p.frame(i * 16);
  p.setNow(20000);
  const v = p.verdict();
  assert.match(v, /沒有量到畫面停住/);
  assert.match(v, /在卡的當下再取一次/);
});

test('停住時主執行緒是閒的 → 判為顯示卡合成那一側', () => {
  const p = bootProbe();
  p.frame(100);
  p.frame(800);    // 停住 700ms
  p.frame(1600);   // 再停住 800ms
  p.setNow(20000); // 完全沒有長工作
  const v = p.verdict();
  // 起始時鐘為 0，第一格 t=100 本身就算一次停住（測試環境的產物），故為 3 次
  assert.match(v, /畫面停住 3 次，最長 800ms/);
  assert.match(v, /主執行緒是閒的/);
  assert.doesNotMatch(v, /主執行緒被擋住/);
});

test('停住時主執行緒在忙，且最貴的是 rAF 回呼 → 判為畫面更新迴圈', () => {
  const p = bootProbe();
  p.frame(100);
  p.frame(800);
  p.longTask(650, 0);          // 與上面的停住同一秒
  p.slowRafCallback(600, 'tickWorld');
  p.setNow(20000);
  const v = p.verdict();
  assert.match(v, /主執行緒被擋住/);
  assert.match(v, /rAF回呼:tickWorld/);
  assert.match(v, /畫面更新迴圈/);
});

test('停住時主執行緒在忙，但名單上每一支都很便宜 → 判為 JS 之外的樣式重算', () => {
  const p = bootProbe();
  p.frame(100);
  p.frame(800);
  p.longTask(650, 0);
  p.slowRafCallback(3, 'tickWorld');   // 名單上最貴的只有 3ms，遠不足以解釋 650ms
  p.setNow(20000);
  const v = p.verdict();
  assert.match(v, /主執行緒被擋住/);
  assert.match(v, /兇手不在名單上/);
  assert.match(v, /JS 之外/);
});
