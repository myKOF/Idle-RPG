'use strict';
/* 遊戲演出與背景工作的可暫停時鐘；I/O／連線看門狗仍使用真實時間。 */
var GameClock = (function (host) {
  var nativeSet = host.setTimeout.bind(host), nativeClear = host.clearTimeout.bind(host);
  var nativeRaf = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : null;
  var nativeCancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : nativeClear;
  var paused = false, pausedAt = 0, pausedWall = 0, offset = 0, serial = 0;
  var jobs = new Map(), tickers = [], animations = [], canvases = [];
  function rawNow() { return host.performance && host.performance.now ? host.performance.now() : Date.now(); }
  function now() { return (paused ? pausedAt : rawNow()) - offset; }
  function dateNow() { return (paused ? pausedWall : Date.now()) - offset; }
  function cancelNative(job) {
    if (job.native == null) return;
    if (job.raf && nativeRaf) nativeCancel(job.native); else nativeClear(job.native);
    job.native = null;
  }
  function schedule(job) {
    if (paused) return;
    var run = function () {
      job.native = null;
      if (paused || !jobs.has(job.id)) return;
      if (!job.interval) jobs.delete(job.id);
      try { job.fn(job.raf ? now() : undefined); }
      finally {
        if (job.interval && jobs.has(job.id)) { job.due = now() + job.interval; schedule(job); }
      }
    };
    job.native = job.raf && nativeRaf ? nativeRaf(run) : nativeSet(run, Math.max(0, job.due - now()));
  }
  function add(fn, delay, interval, raf) {
    var job = { id: ++serial, fn: fn, due: now() + Math.max(0, Number(delay) || 0), interval: interval, raf: raf, native: null };
    jobs.set(job.id, job); schedule(job); return job.id;
  }
  function clear(id) { var job = jobs.get(id); if (job) { cancelNative(job); jobs.delete(id); } }
  function trackTicker(ticker) {
    if (!ticker || tickers.some(function (entry) { return entry.ticker === ticker; })) return;
    var entry = { ticker: ticker, start: ticker.start, stop: ticker.stop, wanted: !!ticker.started };
    tickers.push(entry);
    ticker.start = function () { entry.wanted = true; if (!paused) entry.start.call(ticker); };
    ticker.stop = function () { entry.wanted = false; entry.stop.call(ticker); };
    if (paused) entry.stop.call(ticker);
  }
  function freezeCanvas(entry) {
    var canvas = entry.canvas;
    if (!canvas.parentNode || entry.frame) return;
    // WebGL不保留合成後的drawing buffer；只停ticker會黑屏，暫停時複製一幀即可。
    try {
      entry.render();
      var frame = document.createElement('canvas');
      frame.width = canvas.width; frame.height = canvas.height;
      frame.className = canvas.className;
      frame.style.cssText = canvas.style.cssText;
      frame.style.pointerEvents = 'none';
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('data-game-pause-frame', '');
      frame.getContext('2d').drawImage(canvas, 0, 0);
      canvas.parentNode.insertBefore(frame, canvas.nextSibling);
      entry.frame = frame; entry.visibility = canvas.style.visibility;
      canvas.style.visibility = 'hidden';
    } catch (error) { /* 畫布遺失context時，仍須完成遊戲暫停。 */ }
  }
  function trackCanvas(canvas, render) {
    if (!canvas || canvases.some(function (entry) { return entry.canvas === canvas; })) return;
    var entry = { canvas: canvas, render: render, frame: null, visibility: '' };
    canvases.push(entry); if (paused) freezeCanvas(entry);
  }
  function setPaused(value) {
    value = !!value; if (value === paused) return;
    if (value) {
      pausedAt = rawNow(); pausedWall = Date.now(); paused = true;
      jobs.forEach(cancelNative);
      tickers = tickers.filter(function (entry) { return !entry.ticker.destroyed && entry.ticker._head !== null; });
      tickers.forEach(function (entry) { entry.stop.call(entry.ticker); });
      canvases = canvases.filter(function (entry) { return !!entry.canvas.parentNode; });
      canvases.forEach(freezeCanvas);
      if (typeof document !== 'undefined' && document.getAnimations) {
        animations = document.getAnimations().filter(function (animation) {
          var target = animation.effect && animation.effect.target;
          return animation.playState === 'running' && target && target.closest && target.closest('#ui-shell, .quest-fly-reward, .fly-trail-particle, .game-floating-text');
        });
        animations.forEach(function (animation) { animation.pause(); });
      }
    } else {
      offset += rawNow() - pausedAt; paused = false;
      canvases.forEach(function (entry) {
        if (entry.frame) { entry.frame.remove(); entry.frame = null; entry.canvas.style.visibility = entry.visibility; }
      });
      jobs.forEach(schedule);
      tickers = tickers.filter(function (entry) { return !entry.ticker.destroyed && entry.ticker._head !== null; });
      tickers.forEach(function (entry) {
        if (entry.wanted) { entry.ticker.lastTime = rawNow(); entry.start.call(entry.ticker); }
      });
      animations.forEach(function (animation) { if (animation.playState === 'paused') animation.play(); });
      animations = [];
    }
  }
  return { now: now, dateNow: dateNow, wallNow: function () { return paused ? pausedWall : Date.now(); },
    isPaused: function () { return paused; }, setPaused: setPaused, trackTicker: trackTicker, trackCanvas: trackCanvas,
    setTimeout: function (fn, ms) { return add(fn, ms, 0, false); }, clearTimeout: clear,
    setInterval: function (fn, ms) { var n = Math.max(1, Number(ms) || 0); return add(fn, n, n, false); }, clearInterval: clear,
    requestAnimationFrame: function (fn) { return add(fn, 16, 0, true); }, cancelAnimationFrame: clear };
})(globalThis);
