/* 量測用具：搭配 scratch/_perf_probe.html。載入後可用
     await __H.scenario({...})   擺情境（GM 指令＋裝技能）
     __H.wrap()                  把 ticker 的三個階段包上 CPU／GPU 計時
     await __H.drive(sec)        以真實時間逐幀驅動，回傳每幀紀錄
     __H.summ(frames)            統計（中位／p90／最大）
   幀由 MessageChannel 自旋推進，避開 Windows 計時器粒度；不靠 rAF（窗格不合成畫格時 rAF 不跑）。 */
(function () {
  var H = window.__H = {};
  var cur = { rec: null }, pending = [];
  var gl, ext;

  function unlockVisibility() {
    Object.defineProperty(document, 'hidden', { get: function () { return false; }, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: function () { return 'visible'; }, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  H.wrap = function () {
    var app = BattleRenderer._app();
    gl = app.renderer.gl; ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    function wrapOne(l, key, useGpu) {
      if (l.__wrapped) return; l.__wrapped = true;
      var f = l._fn;
      l._fn = function () {
        var s = performance.now(), q = null;
        if (useGpu && ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
        var r = f.apply(this, arguments);
        if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ q: q, key: key, rec: cur.rec }); }
        if (cur.rec) cur.rec[key] = (cur.rec[key] || 0) + (performance.now() - s);
        return r;
      };
    }
    var l = app.ticker._head;
    while (l) {
      var n = l._fn && l._fn.name;
      if (n === 'tickWorld') wrapOne(l, 'tickWorld', false);
      else if (n === 'renderPerspectiveScene') wrapOne(l, 'persp', true);
      else if (n === 'render') wrapOne(l, 'render', true);
      l = l.next;
    }
    return 'wrapped';
  };

  function collect() {
    for (var i = pending.length - 1; i >= 0; i--) {
      var p = pending[i];
      if (gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) {
        var ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT);
        if (p.rec) p.rec['gpu_' + p.key] = ns / 1e6;
        gl.deleteQuery(p.q); pending.splice(i, 1);
      }
    }
  }

  H.scenario = async function (o) {
    unlockVisibility();
    var out = [];
    async function g(l) { var x = await WorkerBridge.send('gm.exec', { line: l }); out.push(l + ' => ' + (x && x.ok)); }
    await g('level 500');
    (o.skills || []).forEach(function () {});
    for (var i = 0; i < (o.skills || []).length; i++) {
      var s = o.skills[i];
      await g('sglv ' + s.g + ' max');
      if (s.ult) await g('sgult ' + s.g + ' ' + s.ult);
    }
    await g('god 1');
    await g('spawn ' + (o.count || 32) + ' small ' + (o.hp || 1000000));
    for (var j = 0; j < (o.skills || []).length; j++) {
      try { await sendUiCommand('skill.equipLoadout', { id: 'sg:' + o.skills[j].g }, { silentResultError: true }); } catch (e) {}
    }
    await new Promise(function (r) { setTimeout(r, 2000); });
    return out.join('\n') + '\nent=' + BattleRenderer.status().entities;
  };

  var CALLS = ['drawElements', 'drawArrays', 'bindTexture', 'texImage2D', 'texSubImage2D', 'bufferData', 'bufferSubData',
    'useProgram', 'bindFramebuffer', 'blendFunc', 'blendFuncSeparate', 'blitFramebuffer'];

  H.drive = function (seconds, tag) {
    return new Promise(function (resolve) {
      var app = BattleRenderer._app();
      var frames = [], T = window.__T, t0 = performance.now(), last = 0;
      var mc = new MessageChannel();
      function yieldNow() { mc.port2.postMessage(0); }
      function snap() { return { core: T.core, backend: T.backend, nodes: T.nodeUpdates, calls: Object.assign({}, T.calls) }; }
      function step() {
        var now = performance.now();
        if (now - t0 > seconds * 1000) {
          mc.port1.onmessage = null;
          setTimeout(function () { collect(); resolve(frames); }, 400);
          return;
        }
        if (now - last < 16.7) { yieldNow(); return; }
        var interval = last ? now - last : 0; last = now;
        var rec = { interval: interval }; cur.rec = rec; var s0 = snap();
        var a = performance.now();
        UI_WORKER_VISUAL_FLUSH_HANDLE = 0; flushWorkerVisualEvents(); rec.flush = performance.now() - a;
        a = performance.now();
        PIXI.Ticker.shared.update(now); app.ticker.update(now);
        rec.total = performance.now() - a;
        var s1 = snap();
        rec.core = s1.core - s0.core; rec.backend = s1.backend - s0.backend; rec.nodes = s1.nodes - s0.nodes;
        CALLS.forEach(function (k) { rec['c_' + k] = (s1.calls[k] || 0) - (s0.calls[k] || 0); });
        var st = BattleRenderer.status(); rec.ent = st.entities; rec.floats = st.floats; rec.legacyFx = st.fx;
        var p = st.preset;
        rec.eff = p.fx.activeEffects + p.zone.activeEffects + p.air.activeEffects + p.billboard.activeEffects;
        rec.parts = p.fx.activeParticles + p.zone.activeParticles + p.air.activeParticles + p.billboard.activeParticles;
        frames.push(rec); collect();
        yieldNow();
      }
      mc.port1.onmessage = step; yieldNow();
    });
  };

  /* ---- 單一 preset 隔離量測 ----
     在遊戲頁面裡另開一個 Pixi backend＋Core runtime，把 preset 播 N 份，畫進離屏 MSAA 貼圖，
     每幀用 1px 回讀強迫 GPU 做完，量「Core＋後端」與「送出＋GPU」各花多久。
     不動遊戲本身的場景，也不需要 rAF。 */
  var benchState = null;
  H.benchInit = async function () {
    var app = BattleRenderer._app();
    var shipped = await (await fetch('vfx/shipped-assets.json', { cache: 'no-store' })).json();
    var resolver = VFXCore.createIndexResolver(shipped, shipped.baseUrl || 'images/vfx/assets');
    var W = 670, H2 = 643;
    var rt = PIXI.RenderTexture.create({ width: W, height: H2, antialias: true });
    benchState = { app: app, resolver: resolver, rt: rt, W: W, H: H2, presets: {} };
    return 'ok';
  };
  H.benchPreset = async function (id, N, frames, opts) {
    opts = opts || {};
    var B = benchState, app = B.app;
    var json = B.presets[id] || (B.presets[id] = await (await fetch('vfx/presets/' + id + '.json', { cache: 'no-store' })).json());
    var container = new PIXI.Container();
    var backend = VFXPixiBackend.createBackend({ container: container });
    var rt = VFXCore.createRuntime({ backend: backend, resolver: B.resolver,
      budget: { maxActiveEffects: 4096, maxParticles: 64000, perEffectParticleLimit: 2000 } });
    rt.registerPreset(json);
    var rng = VFXCore.makeRng(99), handles = [];
    function spawnAll() {
      for (var i = 0; i < N; i++) {
        var h = rt.play(id, { seed: 100 + i * 31, loop: json.loop });
        if (h === null) continue;
        var s = opts.scale || 1;
        rt.setTransform(h, { position: { x: B.W / 2 + (rng() - 0.5) * (opts.spread || 300), y: B.H / 2 + (rng() - 0.5) * (opts.spread || 300) * 0.6 }, scale: s });
        handles.push(h);
      }
    }
    spawnAll();
    // 先預熱（貼圖載入、著色器編譯）
    for (var w = 0; w < 40; w++) { rt.update(1 / 60); app.renderer.render({ container: container, target: B.rt, clear: true }); }
    await new Promise(function (r) { setTimeout(r, 300); });
    var cpu = [], gpu = [], draws = [], nodes = [];
    var T = window.__T;
    for (var f = 0; f < frames; f++) {
      // 非循環 preset 播完就補新的，維持 N 份同時存在
      if (!json.loop && f % Math.max(1, Math.round((json.duration || 1) * 60)) === 0 && f > 0) spawnAll();
      var d0 = (T.calls.drawElements || 0), n0 = T.nodeUpdates;
      var t0 = performance.now();
      rt.update(1 / 60);
      var t1 = performance.now();
      app.renderer.render({ container: container, target: B.rt, clear: true });
      await app.renderer.extract.pixels({ target: B.rt, frame: new PIXI.Rectangle(0, 0, 1, 1), resolution: 1 });
      var t2 = performance.now();
      cpu.push(t1 - t0); gpu.push(t2 - t1);
      draws.push((T.calls.drawElements || 0) - d0); nodes.push(T.nodeUpdates - n0);
    }
    var st = rt.stats();
    rt.destroy();
    container.destroy({ children: true });
    function med(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[a.length >> 1]; }
    return { id: id, N: N, cpuMs: +med(cpu).toFixed(3), gpuMs: +med(gpu).toFixed(3), draws: med(draws), nodes: med(nodes) };
  };

  H.summ = function (frames) {
    var f = frames.filter(function (x) { return x.interval > 0; });
    function q(arr, p) { var a = arr.slice().sort(function (x, y) { return x - y; }); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; }
    var o = { frames: f.length };
    ['interval', 'total', 'flush', 'tickWorld', 'persp', 'render', 'gpu_persp', 'gpu_render', 'core', 'backend', 'nodes',
      'c_drawElements', 'c_bindTexture', 'c_texImage2D', 'c_texSubImage2D', 'c_bufferData', 'c_bufferSubData', 'c_useProgram',
      'c_blendFunc', 'c_blendFuncSeparate', 'eff', 'parts', 'ent', 'floats', 'legacyFx'].forEach(function (k) {
      var c = f.map(function (x) { return x[k] || 0; });
      o[k] = [+q(c, 0.5).toFixed(2), +q(c, 0.9).toFixed(2), +Math.max.apply(null, c).toFixed(2)];   // [中位, p90, 最大]
    });
    return o;
  };
})();
