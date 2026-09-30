/* 寒冰箭命中壓力重播：把「每秒 N 個冰箭事件」灌進遊戲自己的視覺事件佇列
   （走 ui.js 的 queueWorkerVisualEvent → flush 4ms 預算 → BattleRenderer.onVfx），
   與真實 Worker 送來的事件走同一條路，因此佇列上限、每幀預算都算數。
   用法（頁面 Console，需先 spawn 敵人）：
     await __replay({ rate: 172, warm: 4, sec: 10 })   → 逐 2 秒的疊層快照＋整體中位數
   事件範本取自實機 2026-09-30 擷取的 ice-arrow；hit 用使用者場景裡的 burst-icearrow-crystal。 */
(function () {
  function make(id, travel) {
    return {
      kind: 'vfx', fxKind: 'projectile', glyph: '❄️', color: '#8ea2ff', targets: [id], cells: null, area: null,
      dur: 0.5, count: 1, travelMs: [travel], elem: 'ice', cat: 'magic', variant: 'ice-arrow', delayMs: 0,
      projectile: false, lineLength: 60, lineWidth: null, laneOffsets: null, directionCount: null, rangeScale: 1,
      directionRanges: null, angle: -2.5, sizeMult: 0, vfx: { projectile: 'proj-icearrow-frost', hit: 'burst-icearrow-crystal' }
    };
  }
  function med(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[a.length >> 1]; }
  window.__replay = async function (o) {
    o = o || {};
    var rate = o.rate || 172, warm = o.warm || 4, sec = o.sec || 10;
    var app = BattleRenderer._app(), fpsEl = document.getElementById('battle-fps');
    var ids = BattleRenderer._debug().entities.map(function (e) { return e.id; });
    if (!ids.length) throw new Error('場上沒有敵人');
    var acc = 0, last = 0, lastTxt = 0, n = 0, lastSnap = 0, t0 = performance.now(), rows = [], sent = 0;
    await new Promise(function (resolve) {
      var mc = new MessageChannel(); function y() { mc.port2.postMessage(0); }
      mc.port1.onmessage = function () {
        var now = performance.now();
        if (now - t0 > (warm + sec) * 1000) { mc.port1.onmessage = null; resolve(); return; }
        if (now - last < 16.7) { y(); return; }
        var dtSec = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now; n++;
        acc += rate * dtSec;                       // 依真實經過時間灌事件（掉幀時一次灌多一點，跟 Worker 一樣不等畫面）
        while (acc >= 1) {
          acc -= 1;
          queueWorkerVisualEvent(make(ids[(Math.random() * ids.length) | 0], 100 + Math.random() * 200));
          sent++;
        }
        UI_WORKER_VISUAL_FLUSH_HANDLE = 0; flushWorkerVisualEvents();
        PIXI.Ticker.shared.update(now); app.ticker.update(now);
        if (now - lastTxt >= 500) { lastTxt = now; fpsEl.textContent = 'FPS: ' + Math.round(n * 2) + '\n' + BattlePerf.lines(); n = 0; }
        if (now - lastSnap >= 2000) {
          lastSnap = now;
          var s = BattlePerf._snapshot();
          rows.push({
            t: Math.round((now - t0) / 1000), fps: +s.fps.toFixed(1), iv: Math.round(s.interval.avg), eff: s.env.eff, parts: s.env.parts,
            nodes: Math.round(s.nodes.avg), draws: Math.round(s.draws.avg), tick: +s.tick.avg.toFixed(1), persp: +s.persp.avg.toFixed(1),
            draw: +s.draw.avg.toFixed(1), core: +s.core.avg.toFixed(1), busy: Math.round(s.busy * 100), queue: s.env.queue,
            q: s.env.quality == null ? null : +s.env.quality.toFixed(2), K: s.env.hitCap,
            capped: Math.round(s.env.cappedRate || 0), thinned: Math.round(s.env.thinnedRate || 0), plays: Math.round(s.plays)
          });
        }
        y();
      };
      y();
    });
    var m = rows.filter(function (r) { return r.t > warm + 1; });
    function col(k) { return m.map(function (r) { return r[k]; }); }
    return { sent: sent, rows: rows,
      median: { fps: med(col('fps')), iv: med(col('iv')), eff: med(col('eff')), parts: med(col('parts')), nodes: med(col('nodes')), draws: med(col('draws')),
        tick: med(col('tick')), persp: med(col('persp')), draw: med(col('draw')), core: med(col('core')), busy: med(col('busy')), queue: med(col('queue')), plays: med(col('plays')) },
      last: fpsEl.textContent };
  };
})();
