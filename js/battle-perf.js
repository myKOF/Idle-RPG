'use strict';
/* ============================================================
   battle-perf.js — 戰鬥效能診斷（內部版本才啟用，玩家版一行都不執行）

   為什麼有這支檔案
   ────────────────
   2026-09-30 使用者回報：敵人越多、連鎖類技能就連鎖得越快，特效越滾越多，
   FPS 一路掉到 7。本機（同一張 GTX 1050）用 32 隻木樁量到的是 60 FPS，
   重現不出來——所以先不猜，在使用者自己的場景裡把「時間花在哪」量出來。

   量的是什麼（全部是滾動 1 秒的視窗，不是累計值——累計值不帶時間，截圖時會誤導）
     幀內   tick（實體＋飄字＋VFX 推進）／透視（場景畫進離屏貼圖）／送出（主畫布）的 CPU 毫秒
     空檔   幀間隔 − 上面三段的總和＝這一幀「沒有被 Pixi 自己的工作解釋」的時間。
            60 FPS 時約 14ms 是正常的閒置（在等 vsync）；掉到 7 FPS 時若空檔仍有一百多 ms，
            代表時間花在別處：等 GPU，或被主執行緒上別的任務佔走（看 LoAF／長任務那一行）。
     占用   Pixi 三段 CPU 占幀間隔的比例。很低（例如 10%）＝瓶頸不在 Pixi 的 CPU。
     Core   VFX Core 的 update 總耗時（含後端 updateNode）與每幀節點更新數
     GL     每幀 draw call 與貼圖上傳次數
     事件   Worker 送來的視覺事件到達率（依種類）與 VFX 播放率（依 preset）——
            滾雪球的迴圈長在這兩個數字上
     LoAF   瀏覽器的 long-animation-frame：一幀裡腳本／排版／渲染各佔多少，
            以及是哪個函式佔的。空檔大的時候，這一段告訴你是 JS 還是別的。
            LoAF 只有頁面真的渲染時才會產生；另外收 longtask（任何時候都有，但沒有明細）。

   怎麼看：左上角 FPS 計數器多出幾行（?perf=0 關掉）。7 FPS 的場景截一張圖，
   或在 Console 執行 perfReport() 取得過去 60 秒逐秒的表格（會複製到剪貼簿）。

   A／B 開關（網址參數，只在內部版本有效）
     ?fx=off     不畫任何 VFX（Preset 與舊畫法都不畫）——剩下的就是「非特效」的成本
     ?float=off  不畫傷害飄字
     ?res=0.5    Canvas 渲染解析度（battle-renderer.js 的 currentResolution）
     ?persp=0    關掉畫面透視（既有）

   已知副作用：為了數節點更新，會包住 VFXCore.createRuntime 產生的 runtime
   （update／play）與後端的 updateNode。每次呼叫只多一次計數或兩次 performance.now，
   不改任何行為；診斷本身的成本量級 < 0.3ms／幀。
   ============================================================ */

var BattlePerf = (function () {

  var RING = 256;          // 幀記錄環（7 FPS 時夠 30 秒、60 FPS 時 4 秒）
  var LOG_CAP = 6000;      // 事件日誌上限
  var HISTORY_CAP = 300;   // 逐秒歷史（5 分鐘）
  var WINDOW_MS = 1000;

  var enabled = false;     // install() 判定為內部版本才會 true
  var attached = false;
  var hooked = false;
  var flags = { fx: 'on', float: 'on', res: null };

  /* ---------- 幀記錄環 ---------- */
  var frames = [];
  for (var fi = 0; fi < RING; fi++) {
    frames.push({ t: 0, interval: 0, tick: 0, persp: 0, draw: 0, core: 0, nodes: 0, draws: 0, uploads: 0, d0: 0, u0: 0 });
  }
  var head = -1, filled = 0, cur = null, lastStart = 0, mark = 0;
  var acc = { core: 0, nodes: 0 };      // 由 Core 包裝累加，每幀開頭歸零
  var GL = { draws: 0, uploads: 0 };    // 由 gl 包裝累加，只增不減，取差值

  /* ---------- 日誌（時間遞增，統計時由後往前掃到視窗邊界） ---------- */
  var plays = [];       // { t, key }  Core.play：哪個 preset 被播
  var arrivals = [];    // { t, key }  Worker → 主執行緒：視覺事件到達
  var flushes = [];     // { t, ms, n } ui.js 每次 flush 的耗時與處理件數
  var loafs = [];       // long-animation-frame 條目（濃縮過）
  var tasks = [];       // longtask 條目（只有時間與長度；LoAF 要真的渲染過才會有，這條任何狀態都會有）
  var history = [];     // 逐秒快照

  var gpuName = '', loafType = '';
  var simMark = null, simRate = null;
  var worst = null;

  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function pushLog(arr, item) {
    arr.push(item);
    if (arr.length > LOG_CAP) arr.splice(0, LOG_CAP >> 2);
  }

  /* ============ 純函式：統計與排版（測試直接餵資料） ============ */

  function statOf(list, pick) {
    var sum = 0, max = 0;
    for (var i = 0; i < list.length; i++) {
      var v = pick(list[i]);
      sum += v;
      if (v > max) max = v;
    }
    return { avg: list.length ? sum / list.length : 0, max: max, sum: sum };
  }

  /* 從日誌尾端往前數到視窗邊界（日誌是時間遞增的）。 */
  function tally(log, cutoff) {
    var map = Object.create(null), total = 0;
    for (var i = log.length - 1; i >= 0; i--) {
      var e = log[i];
      if (e.t < cutoff) break;
      map[e.key] = (map[e.key] || 0) + 1;
      total++;
    }
    return { total: total, map: map };
  }

  function topOf(map, n) {
    return Object.keys(map).map(function (k) { return [k, map[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, n);
  }

  /* src = { frames:[時間遞增], plays, arrivals, flushes, loafs, env, windowMs }
     回傳一份快照。全部是「視窗內」的數字。 */
  function summarize(src, atMs) {
    var winMs = src.windowMs || WINDOW_MS;
    var cutoff = atMs - winMs;
    var perSec = 1000 / winMs;
    var fr = src.frames.filter(function (f) { return f.t >= cutoff; });
    var ivList = fr.filter(function (f) { return f.interval > 0; });
    var span = fr.length > 1 ? fr[fr.length - 1].t - fr[0].t : 0;

    var s = { at: atMs, frames: fr.length };
    s.fps = span > 0 ? (fr.length - 1) * 1000 / span : 0;
    s.interval = statOf(ivList, function (f) { return f.interval; });
    s.tick = statOf(fr, function (f) { return f.tick; });
    s.persp = statOf(fr, function (f) { return f.persp; });
    s.draw = statOf(fr, function (f) { return f.draw; });
    s.core = statOf(fr, function (f) { return f.core; });
    s.nodes = statOf(fr, function (f) { return f.nodes; });
    s.draws = statOf(fr, function (f) { return f.draws; });
    s.uploads = statOf(fr, function (f) { return f.uploads; });
    s.cpu = s.tick.avg + s.persp.avg + s.draw.avg;
    s.gap = Math.max(0, s.interval.avg - s.cpu);

    var arr = tally(src.arrivals || [], cutoff);
    s.arrive = arr.total * perSec;
    s.arriveTop = topOf(arr.map, 3).map(function (e) { return [e[0], e[1] * perSec]; });
    s.arriveFloat = (arr.map.float || 0) * perSec;
    s.arriveVfx = s.arrive - s.arriveFloat;
    var pl = tally(src.plays || [], cutoff);
    s.plays = pl.total * perSec;
    s.playsTop = topOf(pl.map, 3).map(function (e) { return [e[0], e[1] * perSec]; });
    s.playsAll = pl.map;

    var fl = (src.flushes || []).filter(function (e) { return e.t >= cutoff; });
    s.flushMs = statOf(fl, function (e) { return e.ms; });
    s.processed = statOf(fl, function (e) { return e.n; }).sum * perSec;

    var lf = (src.loafs || []).filter(function (e) { return e.t >= cutoff; });
    s.loaf = {
      n: lf.length,
      max: statOf(lf, function (e) { return e.dur; }).max,
      scripts: statOf(lf, function (e) { return e.scripts; }).avg,
      render: statOf(lf, function (e) { return e.render; }).avg,
      layout: statOf(lf, function (e) { return e.layout; }).avg,
      top: []
    };
    var agg = Object.create(null);
    lf.forEach(function (e) { (e.top || []).forEach(function (p) { agg[p[0]] = (agg[p[0]] || 0) + p[1]; }); });
    s.loaf.top = topOf(agg, 2);

    var tk = (src.tasks || []).filter(function (e) { return e.t >= cutoff; });
    s.tasks = { n: tk.length, max: statOf(tk, function (e) { return e.dur; }).max };

    s.busy = s.interval.avg > 0 ? Math.min(1, s.cpu / s.interval.avg) : 0;   // Pixi 自己的 CPU 占幀間隔的比例
    s.env = src.env || {};
    return s;
  }

  function f0(x) { return String(Math.round(x)); }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function short(k, n) { k = String(k); return k.length > n ? k.slice(0, n - 1) + '…' : k; }
  /* "ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 (0x00001C81) Direct3D11 …)" → "NVIDIA GeForce GTX 1050" */
  function gpuLabel(raw) {
    if (!raw) return 'GPU ?';
    var g = String(raw).replace(/^ANGLE \(/, '').replace(/\(0x[0-9a-fA-F]+\)/, '');
    g = g.replace(/^NVIDIA, /, '').replace(/^AMD, /, '').replace(/^Intel, /, '');
    g = g.replace(/ Direct3D.*$/, '').replace(/ vs_.*$/, '');
    return short(g.trim(), 44);
  }
  function topText(list, n) {
    if (!list || !list.length) return '—';
    return list.map(function (e) { return short(e[0], n || 22) + '×' + f0(e[1]); }).join('  ');
  }

  /* 疊層文字。每行 ≤ 約 95 字元（11px 等寬字型在 670px 的戰鬥區放得下）。 */
  function formatLines(s) {
    var e = s.env || {};
    var out = [];
    out.push('敵 ' + (e.ent || 0) + '  特效 ' + (e.eff || 0) + '  粒子 ' + (e.parts || 0) + '  飄字 ' + (e.floats || 0) +
      '  節點更新/幀 ' + f0(s.nodes.avg) + '(max ' + f0(s.nodes.max) + ')' +
      '  draw ' + f0(s.draws.avg) + '(max ' + f0(s.draws.max) + ')  上傳/s ' + f0(s.uploads.sum));
    out.push('幀 ' + f1(s.fps) + '/s  間隔 ' + f0(s.interval.avg) + '/' + f0(s.interval.max) + 'ms' +
      '  tick ' + f1(s.tick.avg) + ' 透視 ' + f1(s.persp.avg) + ' 送出 ' + f1(s.draw.avg) +
      '  core ' + f1(s.core.avg) + '  占用 ' + f0(s.busy * 100) + '%  空檔 ' + f0(s.gap) + 'ms');
    out.push('事件/s 到達 ' + f0(s.arrive) + '(特效 ' + f0(s.arriveVfx) + ' 字 ' + f0(s.arriveFloat) + ')' +
      ' 處理 ' + f0(s.processed) + '  佇列 ' + (e.queue || 0) + '  播出 ' + f0(s.plays) + '/s' +
      '  flush ' + f1(s.flushMs.avg) + 'ms' + (e.simRate != null ? '  模擬 x' + f1(e.simRate) : ''));
    var l = s.loaf, tk = s.tasks || { n: 0, max: 0 };
    if (l.n) {
      out.push('長幀(LoAF) ' + l.n + ' 個 最長 ' + f0(l.max) + 'ms  腳本 ' + f0(l.scripts) + ' 渲染 ' + f0(l.render) +
        ' 排版 ' + f0(l.layout) + '  ' + topText(l.top, 30));
    } else if (tk.n) {
      out.push('長任務 ' + tk.n + ' 個 最長 ' + f0(tk.max) + 'ms（沒有對應的 LoAF 明細）');
    } else {
      out.push('長幀/長任務：這 1 秒內沒有 >50ms 的' + (e.loafType ? '' : '（此瀏覽器不支援 LoAF）'));
    }
    out.push('播出 ' + topText(s.playsTop));
    out.push('事件 ' + topText(s.arriveTop));
    out.push(gpuLabel(e.gpu) +
      '  畫布 ' + (e.w || 0) + 'x' + (e.h || 0) + ' @' + (e.res != null ? f1(e.res) : '?') +
      '  透視 ' + (e.persp != null ? e.persp : '?') + '  上限 ' + (e.maxFPS || '無') +
      (e.flags ? '  ' + e.flags : ''));
    return out;
  }

  /* ============ 環境讀取（不在純函式裡） ============ */

  function readEnv() {
    var env = { ent: 0, floats: 0, eff: 0, parts: 0, queue: 0, gpu: gpuName, loafType: loafType };
    try {
      var st = BattleRenderer.status();
      env.ent = st.entities; env.floats = st.floats; env.persp = st.persp;
      var p = st.preset;
      if (p) {
        ['fx', 'zone', 'air', 'billboard'].forEach(function (k) {
          if (p[k]) { env.eff += p[k].activeEffects || 0; env.parts += p[k].activeParticles || 0; }
        });
      }
    } catch (err) { /* 渲染器還沒好 */ }
    try {
      var app = BattleRenderer._app();
      if (app) {
        env.w = Math.round(app.renderer.width); env.h = Math.round(app.renderer.height);
        env.res = app.renderer.resolution; env.maxFPS = app.ticker.maxFPS;
      }
    } catch (err2) { /* 同上 */ }
    if (typeof UI_WORKER_VISUAL_EVENT_QUEUE !== 'undefined') env.queue = UI_WORKER_VISUAL_EVENT_QUEUE.length;
    /* 模擬速度＝遊戲時間走多快（1.0＝即時）。掉到 1 以下代表 Worker 追不上，那是另一種卡法。 */
    try {
      var gt = UI_WORKER_STATE && UI_WORKER_STATE.view && UI_WORKER_STATE.view.gt;
      var t = now();
      if (typeof gt === 'number') {
        if (!simMark) simMark = { gt: gt, at: t };
        else if (t - simMark.at >= 900) {
          simRate = (gt - simMark.gt) / ((t - simMark.at) / 1000);
          simMark = { gt: gt, at: t };
        }
      }
      env.simRate = simRate;
    } catch (err3) { /* 沒有 UI 狀態 */ }
    var fl = [];
    if (flags.fx !== 'on') fl.push('fx=' + flags.fx);
    if (flags.float !== 'on') fl.push('float=' + flags.float);
    if (flags.res != null) fl.push('res=' + flags.res);
    env.flags = fl.length ? '[' + fl.join(' ') + ']' : '';
    return env;
  }

  function windowFrames() {
    var list = [];
    for (var i = filled - 1; i >= 0; i--) {
      list.push(frames[(head - i + RING) % RING]);
    }
    return list;      // 時間遞增
  }

  function snapshot() {
    return summarize({
      frames: windowFrames(), plays: plays, arrivals: arrivals, flushes: flushes, loafs: loafs, tasks: tasks, env: readEnv()
    }, now());
  }

  /* ============ 掛勾 ============ */

  function queryFlag(name) {
    if (typeof location === 'undefined') return null;
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search || '');
    return m ? decodeURIComponent(m[1]) : null;
  }

  function isInternal() {
    return typeof isInternalVersion === 'function' && isInternalVersion();
  }

  /* 包住 VFXCore.createRuntime：必須趕在 VFX Runtime 建立之前，所以在載入時就做。 */
  function wrapCore() {
    if (typeof VFXCore === 'undefined' || !VFXCore.createRuntime || VFXCore.__perfWrapped) return;
    VFXCore.__perfWrapped = true;
    var orig = VFXCore.createRuntime;
    VFXCore.createRuntime = function (o) {
      var be = o && o.backend;
      if (be && typeof be.updateNode === 'function' && !be.__perfWrapped) {
        be.__perfWrapped = true;
        var un = be.updateNode;
        be.updateNode = function (node, t) { acc.nodes++; return un.call(be, node, t); };
      }
      var rt = orig.apply(this, arguments);
      var up = rt.update, pl = rt.play;
      rt.update = function (dt) {
        var s = now();
        try { return up.call(rt, dt); } finally { acc.core += now() - s; }
      };
      rt.play = function (id, params) {
        pushLog(plays, { t: now(), key: id });
        return pl.call(rt, id, params);
      };
      return rt;
    };
  }

  /* A／B 開關：直接替換 BattleRenderer 匯出物件上的函式（ui.js 每次都是用屬性呼叫）。 */
  function applyKillSwitches() {
    if (typeof BattleRenderer === 'undefined') return;
    var fx = queryFlag('fx'), fl = queryFlag('float');
    if (fx === 'off') { flags.fx = 'off'; BattleRenderer.onVfx = function () {}; }
    if (fl === 'off') { flags.float = 'off'; BattleRenderer.onFloat = function () {}; }
    /* ?res= 由 battle-renderer.js 自己讀（它才知道怎麼重建離屏貼圖）；這裡只記下來顯示在疊層上。 */
    var res = queryFlag('res');
    if (res != null && isFinite(Number(res))) flags.res = Number(res);
  }

  function install() {
    if (typeof window === 'undefined') return;
    if (queryFlag('perf') === '0' || !isInternal()) return;
    enabled = true;
    wrapCore();
    applyKillSwitches();
  }

  function markStart() {
    var t = now();
    head = (head + 1) % RING;
    var f = cur = frames[head];
    f.t = t; f.interval = lastStart ? t - lastStart : 0; lastStart = t;
    f.d0 = GL.draws; f.u0 = GL.uploads;
    acc.core = 0; acc.nodes = 0;
    mark = t;
  }
  function markTick() { if (!cur) return; var t = now(); cur.tick = t - mark; mark = t; }
  function markPersp() { if (!cur) return; var t = now(); cur.persp = t - mark; mark = t; }
  function markEnd() {
    if (!cur) return;
    var t = now(), f = cur;
    f.draw = t - mark; f.core = acc.core; f.nodes = acc.nodes;
    f.draws = GL.draws - f.d0; f.uploads = GL.uploads - f.u0;
    if (filled < RING) filled++;
  }

  function patchGl(gl) {
    function wrap(name, key) {
      var orig = gl[name];
      if (typeof orig !== 'function') return;
      gl[name] = function () { GL[key]++; return orig.apply(gl, arguments); };
    }
    ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'].forEach(function (n) { wrap(n, 'draws'); });
    ['texImage2D', 'texSubImage2D', 'texStorage2D', 'compressedTexImage2D'].forEach(function (n) { wrap(n, 'uploads'); });
    try {
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpuName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    } catch (err) { gpuName = '?'; }
  }

  /* 幀標記用 ticker 的優先序卡位：tickWorld 0、透視場景 −10、主畫布 render −25。
     只用公開的 ticker.add，不碰 Pixi 內部。 */
  function hook(app) {
    if (hooked) return;
    hooked = true;
    var t = app.ticker;
    t.add(markStart, null, 100);
    t.add(markTick, null, -1);
    t.add(markPersp, null, -11);
    t.add(markEnd, null, -100);
    patchGl(app.renderer.gl);
  }

  function observeLoaf() {
    if (typeof PerformanceObserver === 'undefined') return;
    var types = PerformanceObserver.supportedEntryTypes || [];
    if (types.indexOf('long-animation-frame') >= 0) {
      loafType = 'long-animation-frame';
      try {
        new PerformanceObserver(function (list) {
          list.getEntries().forEach(function (e) {
            var end = e.startTime + e.duration;
            var item = { t: end, dur: e.duration, scripts: 0, render: 0, layout: 0, top: [] };
            if (e.renderStart) item.render = Math.max(0, end - e.renderStart);
            if (e.styleAndLayoutStart) item.layout = Math.max(0, end - e.styleAndLayoutStart);
            (e.scripts || []).forEach(function (sc) {
              item.scripts += sc.duration;
              var file = String(sc.sourceURL || '').split('/').pop().split('?')[0];
              var name = sc.sourceFunctionName || sc.invoker || sc.invokerType || '?';
              item.top.push([(file ? file + ':' : '') + name, sc.duration]);
            });
            pushLog(loafs, item);
          });
        }).observe({ type: 'long-animation-frame', buffered: false });
      } catch (err) { loafType = ''; }
    }
    if (types.indexOf('longtask') >= 0) {
      try {
        new PerformanceObserver(function (list) {
          list.getEntries().forEach(function (e) { pushLog(tasks, { t: e.startTime + e.duration, dur: e.duration }); });
        }).observe({ type: 'longtask', buffered: false });
      } catch (err2) { /* 不支援就算了 */ }
    }
  }

  /* 逐秒歷史：畫面停擺（分頁隱藏）的那幾秒不記，免得污染趨勢。 */
  function sampleHistory() {
    if (typeof document !== 'undefined' && document.hidden) return;
    var s = snapshot();
    if (!s.frames) return;
    var row = {
      at: s.at, wall: Date.now(), fps: s.fps, ent: s.env.ent, eff: s.env.eff, parts: s.env.parts, floats: s.env.floats,
      nodes: s.nodes.avg, nodesMax: s.nodes.max, ivAvg: s.interval.avg, ivMax: s.interval.max,
      tick: s.tick.avg, persp: s.persp.avg, draw: s.draw.avg, core: s.core.avg, gap: s.gap,
      draws: s.draws.avg, uploads: s.uploads.sum, arrive: s.arrive, plays: s.plays, processed: s.processed,
      queue: s.env.queue, sim: s.env.simRate, loafN: s.loaf.n, loafMax: s.loaf.max,
      loafScripts: s.loaf.scripts, loafRender: s.loaf.render, playsAll: s.playsAll, arriveTop: s.arriveTop
    };
    history.push(row);
    if (history.length > HISTORY_CAP) history.shift();
    if (history.length > 5 && s.fps > 0 && (!worst || s.fps < worst.fps)) worst = row;
  }

  function attach() {
    if (!enabled) install();
    if (!enabled || attached) return enabled;
    attached = true;
    var poll = setInterval(function () {
      var app = null;
      try { app = BattleRenderer._app(); } catch (err) { /* 未就緒 */ }
      if (app && app.ticker && app.renderer && app.renderer.gl) { clearInterval(poll); hook(app); }
    }, 500);
    setInterval(sampleHistory, 1000);
    observeLoaf();
    return true;
  }

  /* ============ 給 ui.js 的通報（active 為 false 時呼叫端就不會進來） ============ */

  function noteArrival(event) {
    if (!event) return;
    var key = event.kind === 'float' ? 'float' : (event.variant || event.fxKind || event.cat || 'vfx');
    pushLog(arrivals, { t: now(), key: key });
  }
  function noteFlush(ms, n) { pushLog(flushes, { t: now(), ms: ms, n: n }); }

  /* 疊層：回傳字串，ui.js 接在 FPS 後面。 */
  function lines() {
    if (!enabled || !hooked) return enabled ? '（診斷掛勾等待渲染器就緒…）' : '';
    return formatLines(snapshot()).join('\n');
  }

  /* Console：perfReport(60) 印出並複製過去 N 秒的逐秒表格。 */
  function report(seconds) {
    var n = Math.max(5, Math.min(HISTORY_CAP, Number(seconds) || 60));
    var rows = history.slice(-n);
    var cols = [
      ['t', function (r, r0) { return f0((r.at - r0.at) / 1000); }],
      ['fps', function (r) { return f1(r.fps); }], ['敵', function (r) { return r.ent; }],
      ['特效', function (r) { return r.eff; }], ['粒子', function (r) { return r.parts; }],
      ['節點/幀', function (r) { return f0(r.nodes); }], ['間隔avg', function (r) { return f0(r.ivAvg); }],
      ['間隔max', function (r) { return f0(r.ivMax); }], ['tick', function (r) { return f1(r.tick); }],
      ['透視', function (r) { return f1(r.persp); }], ['送出', function (r) { return f1(r.draw); }],
      ['core', function (r) { return f1(r.core); }], ['空檔', function (r) { return f0(r.gap); }],
      ['draw', function (r) { return f0(r.draws); }], ['上傳/s', function (r) { return f0(r.uploads); }],
      ['到達/s', function (r) { return f0(r.arrive); }], ['播出/s', function (r) { return f0(r.plays); }],
      ['處理/s', function (r) { return f0(r.processed); }], ['佇列', function (r) { return r.queue; }],
      ['模擬x', function (r) { return r.sim == null ? '' : f1(r.sim); }],
      ['LoAF數', function (r) { return r.loafN; }], ['LoAF最長', function (r) { return f0(r.loafMax); }],
      ['腳本', function (r) { return f0(r.loafScripts); }], ['渲染', function (r) { return f0(r.loafRender); }]
    ];
    var lines2 = [cols.map(function (c) { return c[0]; }).join('\t')];
    rows.forEach(function (r) { lines2.push(cols.map(function (c) { return c[1](r, rows[0]); }).join('\t')); });
    // 這段時間內播放次數最多的 preset（整段加總）
    var sum = Object.create(null);
    rows.forEach(function (r) { Object.keys(r.playsAll || {}).forEach(function (k) { sum[k] = (sum[k] || 0) + r.playsAll[k]; }); });
    lines2.push('');
    lines2.push('播出 Top（' + rows.length + ' 秒合計）：' + topOf(sum, 10).map(function (e) { return e[0] + '×' + e[1]; }).join('  '));
    if (worst) lines2.push('本次最低 FPS：' + f1(worst.fps) + '（敵 ' + worst.ent + ' 特效 ' + worst.eff + ' 節點/幀 ' + f0(worst.nodes) + ' 空檔 ' + f0(worst.gap) + 'ms）');
    var env = readEnv();
    lines2.push('GPU ' + gpuName + '  畫布 ' + (env.w || 0) + 'x' + (env.h || 0) + ' @' + (env.res != null ? f1(env.res) : '?') +
      '  旗標 ' + (env.flags || '無') + '  網址 ' + (typeof location !== 'undefined' ? location.search : ''));
    var text = lines2.join('\n');
    if (typeof console !== 'undefined') console.log(text);
    try { if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {}); } catch (err) { /* 沒有剪貼簿權限 */ }
    return text;
  }

  var api = {
    attach: attach,
    lines: lines,
    report: report,
    noteArrival: noteArrival,
    noteFlush: noteFlush,
    get active() { return enabled && hooked; },
    get enabled() { return enabled; },
    /* 測試用 */
    _summarize: summarize,
    _formatLines: formatLines,
    _hook: hook,
    _snapshot: snapshot,
    _state: function () { return { acc: acc, gl: GL, plays: plays, arrivals: arrivals, flushes: flushes, frames: windowFrames() }; }
  };

  install();
  return api;
})();

if (typeof window !== 'undefined') window.perfReport = function (s) { return BattlePerf.report(s); };
if (typeof module !== 'undefined' && module.exports) module.exports = BattlePerf;
