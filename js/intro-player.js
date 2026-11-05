if (typeof STR !== 'function') { var STR = function (id) { return '[#' + id + ']'; }; } // STR 安全網：單檔載入時的備援，真正的實作在 js/strings.js
/* =============================================================================
   intro-player.js — 開頭動畫播放器（時間軸資料見 js/intro-data.js）
   -----------------------------------------------------------------------------
   一層疊在 Loading 黑幕上方的 DOM 舞台。圖層用 Web Animations 播放，只動
   transform 與 opacity：這兩種屬性由合成器執行，開機時主執行緒忙著 initUI、
   建 Worker、建場景，動畫也不會跟著卡（另開 Pixi 會跟戰場搶主執行緒與 GPU）。

   與開機流程的關係（js/main.js waitForStartupUi、js/bridge.js 開機等待）：
     - 存檔來源確認通過、Worker 開機之前，bridge.js 呼叫 startupBegin()，
       由 chooseStartupTimeline() 決定要不要播、播哪一條。
     - 播放中暫停開機等待的逾時保險；否則動畫一長，戰鬥就在動畫後面開打，
       視覺事件堆在佇列裡，揭幕時一次播出（23dd33ac 修過的問題）。
     - main.js 揭幕前呼叫 whenIdle()：動畫播完或被略過才收黑幕、放行戰鬥。
       UI 先準備好就等動畫；動畫先播完就露出底下的 Loading 繼續等 UI。
     - 任何收掉 Loading 的路徑（Worker 失效、分頁鎖被搶）都會呼叫 abort()，
       讓失效通知與遮罩不被動畫蓋住（index.html 的 hideLoadingScreen）。

   停在標題等載入（holdAt）：開機播放時，時間軸可以指定停格點。播到那裡 UI 還沒準備好，
     就整個畫面停住、顯示載入圓點，等 main.js 呼叫 release() 才播完收尾；UI 先準備好則
     不停直接播完。標題開場因此能蓋住整段載入、一路接到遊戲畫面，不會先退回「Loading」。
     停格超過 HOLD_MAX_MS 自動放行（退回底下的 Loading 繼續等），不讓動畫把開機卡死。
     GM 指令預覽不停格。

   略過：點擊畫面、Esc、Space、Enter，或略過按鈕。
   減少動態偏好：只保留淡入淡出，不位移不縮放。
   分頁隱藏：所有動畫一起暫停，回來從原處繼續。
   除錯：IntroPlayer.seek(毫秒) 停在指定時間點（預覽窗格隱藏時動畫不走，用這個取景）。
   ============================================================================= */
var IntroPlayer = (function () {
  'use strict';

  var SKIP_STR = 2410;          // String 表：略過按鈕
  var SKIP_FADE_MS = 350;       // 略過時整層淡出的長度
  var FAILSAFE_EXTRA_MS = 5000; // 可見狀態下超過預定長度這麼久還沒結束，就強制收掉
  var HOLD_MAX_MS = 20000;      // 停格等載入的上限，與 bridge.js 開機等待的逾時同長
  var SKIP_KEYS = { Escape: 1, Esc: 1, ' ': 1, Spacebar: 1, Enter: 1 };

  var _cur = null;              // 播放中的狀態；null＝沒在播
  var _idleWaiters = [];

  /* ---------- 純函式（測試直接呼叫） ---------- */

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

  function transformOf(p) {
    p = p || {};
    var s = num(p.scale, 1);
    return 'translate(' + num(p.x, 0) + 'vw, ' + num(p.y, 0) + 'vh) ' +
      'scale(' + num(p.sx, s) + ', ' + num(p.sy, s) + ') rotate(' + num(p.rotate, 0) + 'deg)';
  }

  /* 圖層的淡入淡出關鍵影格。淡入＋淡出比持續時間長時等比壓縮，避免 offset 倒退。 */
  function opacityKeyframes(layer) {
    var dur = Math.max(1, num(layer.dur, 0));
    var fi = Math.max(0, num(layer.fadeIn, 400));
    var fo = Math.max(0, num(layer.fadeOut, 400));
    if (fi + fo > dur) { var k = dur / (fi + fo); fi *= k; fo *= k; }
    var frames = [];
    frames.push({ offset: 0, opacity: fi > 0 ? 0 : 1 });
    if (fi > 0) frames.push({ offset: fi / dur, opacity: 1 });
    if (fo > 0) frames.push({ offset: 1 - fo / dur, opacity: 1 });
    frames.push({ offset: 1, opacity: fo > 0 ? 0 : 1 });
    // 相鄰 offset 相同時（例如淡入淡出剛好佔滿）保留順序即可，WAAPI 接受非遞減序列
    return frames;
  }

  function motionKeyframes(layer) {
    if (!layer.from && !layer.to) return null;
    return [{ transform: transformOf(layer.from) }, { transform: transformOf(layer.to || layer.from) }];
  }

  function timelineDuration(tl) {
    if (tl && num(tl.duration, 0) > 0) return tl.duration;
    var end = 0;
    ((tl && tl.layers) || []).forEach(function (l) { end = Math.max(end, num(l.at, 0) + num(l.dur, 0)); });
    return end;
  }

  /* 回傳錯誤清單；空陣列＝可以播。資料寫錯寧可整段不播，也不要播一半卡住開機。 */
  function validateTimeline(tl) {
    var errs = [];
    if (!tl || !Array.isArray(tl.layers) || !tl.layers.length) { errs.push('沒有圖層'); return errs; }
    if (!(timelineDuration(tl) > 0)) errs.push('總長必須大於 0');
    tl.layers.forEach(function (l, i) {
      var tag = '圖層 ' + i + '：';
      if (l.kind !== 'text' && l.kind !== 'image' && l.kind !== 'shape' && l.kind !== 'motion') errs.push(tag + '未知的 kind ' + l.kind);
      if (l.kind === 'motion' && typeof IntroMotion === 'undefined') errs.push(tag + '未載入IntroMotion');
      if (!(num(l.at, -1) >= 0)) errs.push(tag + 'at 必須 ≥ 0');
      if (!(num(l.dur, 0) > 0)) errs.push(tag + 'dur 必須 > 0');
      if (l.kind === 'text' && !(l.str > 0)) errs.push(tag + 'text 需要 String 表編號 str');
      if (l.kind === 'image' && !l.src) errs.push(tag + 'image 需要 src');
    });
    return errs;
  }

  /* 開機時要播哪一條時間軸。回傳 INTRO_TIMELINES 的鍵，或 null＝不播。
     ctx.hasSave：本次開機是否讀到存檔（Task C 用來判斷新玩家）。
     網址 ?intro=<鍵> 強制播指定時間軸；?intro=0 或 ?intro=off 強制不播。
     新玩家（本次開機沒讀到存檔）且這台裝置沒看過序章 → 序章 prologue（時間軸存在才播）；
     其餘每次啟動播標題開場 title。決定論測試模式（?seed=，見 bridge.js）不播，
     那是自動化重現用的開機，多出的固定等待沒有意義。
     ctx.prologueSeen：這台裝置是否已看完過序章（localStorage，見 PROLOGUE_SEEN_KEY）。 */
  var DEFAULT_STARTUP_TIMELINE = 'title';
  var PROLOGUE_TIMELINE = 'prologue';
  /* 「看過序章」記在 localStorage 而不是存檔：不動存檔結構、不需要 Migration。
     用途只是避免新玩家在第一次自動存檔前重新整理又看一次；換裝置重看一次也合理。 */
  var PROLOGUE_SEEN_KEY = 'ir_intro_prologue_seen';
  function chooseStartupTimeline(ctx, search, timelines) {
    timelines = timelines || (typeof INTRO_TIMELINES !== 'undefined' ? INTRO_TIMELINES : {});
    var has = function (k) { return Object.prototype.hasOwnProperty.call(timelines, k); };
    search = search || '';
    var m = /[?&]intro=([^&#]*)/.exec(search);
    if (m) {
      var id = decodeURIComponent(m[1]);
      if (id === '0' || id === 'off') return null;
      return has(id) ? id : null;
    }
    if (/[?&]seed=\d+(&|#|$)/.test(search)) return null;
    if (ctx && ctx.hasSave === false && !ctx.prologueSeen && has(PROLOGUE_TIMELINE)) return PROLOGUE_TIMELINE;
    return has(DEFAULT_STARTUP_TIMELINE) ? DEFAULT_STARTUP_TIMELINE : null;
  }

  /* 設定「說明」頁的重播按鈕播哪一條：有序章就播序章，否則播標題開場。 */
  function replayTimelineId(timelines) {
    timelines = timelines || (typeof INTRO_TIMELINES !== 'undefined' ? INTRO_TIMELINES : {});
    var has = function (k) { return Object.prototype.hasOwnProperty.call(timelines, k); };
    if (has(PROLOGUE_TIMELINE)) return PROLOGUE_TIMELINE;
    return has(DEFAULT_STARTUP_TIMELINE) ? DEFAULT_STARTUP_TIMELINE : null;
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }

  /* ---------- DOM ---------- */

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  function supported() {
    return typeof document !== 'undefined' && !!document.body &&
      typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  }

  function buildLayer(layer) {
    var el;
    if (layer.kind === 'image') {
      el = document.createElement('img');
      el.src = layer.src;
      el.alt = '';
      el.draggable = false;
      el.decoding = 'async';
      // 提前解碼尚未入鏡的繪景，避免交叉淡化第一幀才開始解碼。
      if (typeof el.decode === 'function') el.decode().catch(function () {});
    } else {
      el = document.createElement('div');
      if (layer.kind === 'text') el.textContent = STR.apply(null, [layer.str].concat(layer.args || []));
    }
    var place = layer.place || (layer.kind === 'text' ? 'center' : 'full');
    el.className = 'intro-layer intro-place-' + place + (layer.cls ? ' ' + layer.cls : '');
    el.style.opacity = '0';   // 第一個動畫套上前不閃出來
    return el;
  }

  function animate(c, el, frames, opts) {
    var a = el.animate(frames, opts);
    c.anims.push(a);
    if (c.paused) a.pause();
    return a;
  }

  function onVisibility() {
    if (!_cur) return;
    if (document.hidden) pauseAll(_cur); else resumeAll(_cur);
  }

  function stopMotion(c) {
    if (c.motionFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(c.motionFrame);
    c.motionFrame = 0;
  }
  function paintMotion(c, force) {
    var t = num(c.clock && c.clock.currentTime, 0);
    c.motion.forEach(function (scene) { scene.render(t, force); });
  }
  function startMotion(c) {
    if (!c.motion.length || c.motionFrame || typeof requestAnimationFrame !== 'function') return;
    var frame = function () {
      c.motionFrame = 0;
      if (_cur !== c || c.paused || c.skipping) return;
      paintMotion(c, false);
      c.motionFrame = requestAnimationFrame(frame);
    };
    c.motionFrame = requestAnimationFrame(frame);
  }

  function pauseAll(c) {
    c.paused = true;
    stopMotion(c);
    if (c.audio) c.audio.pause();
    c.anims.forEach(function (a) { try { a.pause(); } catch (e) {} });
    clearTimeout(c.failsafe); c.failsafe = 0;
  }

  function resumeAll(c) {
    if (c.seeking) return;   // seek() 停住的畫面不因切回分頁而開始走
    if (c.hold && c.hold.holding) return;   // 停格等載入中，切回分頁也繼續停著
    c.paused = false;
    c.anims.forEach(function (a) { try { a.play(); } catch (e) {} });
    startMotion(c);
    if (c.audio && !c.skipping) c.audio.start();
    armFailsafe(c);
  }

  /* 播到停格點：還沒被放行就整個停住，等 release()。 */
  function reachHold(c) {
    if (_cur !== c || c.skipping || c.hold.released) return;
    c.hold.holding = true;
    c.root.className += ' is-holding';
    pauseAll(c);
    c.hold.maxTimer = setTimeout(function () {
      if (_cur === c && c.hold.holding) { console.warn('[intro] 停格等載入超過上限，放行'); release(); }
    }, HOLD_MAX_MS);
  }

  /* 放行停格：還沒播到停格點就記下來（到了也不停）；已經停住就接著播完。 */
  function release() {
    var c = _cur;
    if (!c || !c.hold || c.hold.released) return;
    c.hold.released = true;
    clearTimeout(c.hold.maxTimer);
    if (!c.hold.holding) return;
    c.hold.holding = false;
    c.root.className = c.root.className.replace(/\s*is-holding/g, '');
    if (!document.hidden) resumeAll(c);   // 隱藏中就等 visibilitychange 回來再播
  }

  function armFailsafe(c) {
    clearTimeout(c.failsafe);
    if (c.hold && c.hold.holding) return;
    var t = num(c.clock && c.clock.currentTime, 0);
    var remain = Math.max(0, c.duration - t) + FAILSAFE_EXTRA_MS;
    c.failsafe = setTimeout(function () {
      if (_cur === c) { console.warn('[intro] 超過預定長度仍未結束，強制收掉'); finish(c, 'failsafe'); }
    }, remain);
  }

  function onKey(e) {
    if (!_cur || !SKIP_KEYS[e.key]) return;
    e.preventDefault();
    e.stopPropagation();   // 不讓底下的遊戲快捷鍵（Esc 開選單等）同時觸發
    skip();
  }

  function finish(c, reason) {
    if (_cur !== c) return;
    _cur = null;
    stopMotion(c);
    c.motion.forEach(function (scene) { if (scene.dispose) scene.dispose(); });
    c.motion = [];
    if (c.audio) c.audio.dispose();
    clearTimeout(c.failsafe);
    clearTimeout(c.skipTimer);
    if (c.hold) clearTimeout(c.hold.maxTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('keydown', onKey, true);
    c.anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    if (c.root.parentNode) c.root.parentNode.removeChild(c.root);
    try { if (c.onDone) c.onDone(reason); } catch (e) { console.error('[intro] onDone 失敗', e); }
    var waiters = _idleWaiters; _idleWaiters = [];
    waiters.forEach(function (fn) { try { fn(reason); } catch (e) { console.error('[intro] whenIdle 回呼失敗', e); } });
  }

  /* 播放一條時間軸。回傳 true＝開始播；false＝沒播（資料錯、環境不支援、已在播），
     沒播時 onDone 不會被呼叫，呼叫端照常往下走。
     opts.hold：時間軸有 holdAt 時在那裡停格等 release()（只有開機播放才用）。 */
  function play(timeline, opts) {
    opts = opts || {};
    if (_cur) return false;
    var errs = validateTimeline(timeline);
    if (errs.length) { console.error('[intro] 時間軸有誤，不播放：' + errs.join('；')); return false; }
    if (!supported()) return false;

    var c = {
      id: opts.id || '', duration: timelineDuration(timeline), anims: [], paused: false, seeking: false,
      skipping: false, failsafe: 0, skipTimer: 0, onDone: opts.onDone || null,
      skippable: timeline.skippable !== false, reduced: reducedMotion(),
      hold: null, audio: null, motion: [], motionFrame: 0
    };
    var holdAt = num(timeline.holdAt, 0);
    if (opts.hold && holdAt > 0 && holdAt < c.duration) {
      c.hold = { at: holdAt, holding: false, released: false, maxTimer: 0 };
    }
    try {
      var root = document.createElement('div');
      root.className = 'intro-player' + (timeline.cinematic ? ' is-cinematic' : '') + (c.reduced ? ' is-reduced' : '');
      root.id = 'intro-player';
      root.setAttribute('role', 'presentation');
      var stage = document.createElement('div');
      stage.className = 'intro-stage';
      stage.setAttribute('aria-hidden', 'true');
      root.appendChild(stage);
      c.root = root;
      _cur = c;

      // 總時鐘：一個看不見的元素，跑完就是整段結束。不用 setTimeout 計時，分頁隱藏時才能跟著暫停。
      var clockEl = document.createElement('span');
      clockEl.className = 'intro-clock';
      root.appendChild(clockEl);

      timeline.layers.forEach(function (layer) {
        var el = buildLayer(layer);
        stage.appendChild(el);
        var timing = { delay: num(layer.at, 0), duration: num(layer.dur, 1), fill: 'both' };
        animate(c, el, opacityKeyframes(layer), timing);
        var motion = c.reduced ? null : motionKeyframes(layer);
        if (motion) {
          animate(c, el, motion, { delay: timing.delay, duration: timing.duration, fill: 'both', easing: layer.easing || 'ease-in-out' });
        }
        if (layer.kind === 'motion') {
          var scene = IntroMotion.build(layer, el, function (child, frames, options) { return animate(c, child, frames, options); }, c.reduced);
          if (scene && scene.render) c.motion.push(scene);
        }
      });

      if (c.hold) {
        // 停格時顯示的載入圓點（純 CSS，不含文字）；動畫由 CSS 自己循環，不受停格暫停影響
        var dots = document.createElement('div');
        dots.className = 'intro-hold-dots';
        dots.setAttribute('aria-hidden', 'true');
        for (var d = 0; d < 3; d++) dots.appendChild(document.createElement('span'));
        root.appendChild(dots);
      }

      if (c.skippable) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'intro-skip';
        btn.textContent = STR(SKIP_STR);
        btn.addEventListener('click', function (e) { e.stopPropagation(); skip(); });
        root.appendChild(btn);
        animate(c, btn, [{ opacity: 0 }, { opacity: 1 }],
          { delay: num(timeline.skipDelay, 500), duration: 300, fill: 'both' });
        root.addEventListener('click', function () { skip(); });
        window.addEventListener('keydown', onKey, true);
      }

      document.body.appendChild(root);
      if (btn) { try { btn.focus({ preventScroll: true }); } catch (e) {} }
      c.clock = animate(c, clockEl, [{ opacity: 0 }, { opacity: 0 }], { duration: c.duration, fill: 'forwards' });
      c.clock.onfinish = function () { if (!c.skipping) finish(c, 'end'); };
      // 視覺舞台與底色一起退去，時鐘和控制留在不透明的父層。
      // 不淡出root：Chromium可能停掉透明祖先下的零面積時鐘，卡住最後一秒。
      var revealMs = Math.min(c.duration, Math.max(0, num(timeline.revealDuration, 0)));
      if (revealMs) animate(c, stage, [{ opacity: 1 }, { opacity: 0 }],
        { delay: c.duration - revealMs, duration: revealMs, fill: 'both' });
      if (timeline.audio && typeof IntroAudio !== 'undefined') {
        c.audio = IntroAudio.create(timeline.audio, function () { return num(c.clock.currentTime, 0); });
      }
      if (c.hold) {
        var holdEl = document.createElement('span');
        holdEl.className = 'intro-clock';
        root.appendChild(holdEl);
        animate(c, holdEl, [{ opacity: 0 }, { opacity: 0 }], { duration: c.hold.at, fill: 'forwards' })
          .onfinish = function () { reachHold(c); };
      }
      document.addEventListener('visibilitychange', onVisibility);
      if (document.hidden) pauseAll(c);
      else { armFailsafe(c); startMotion(c); if (c.audio) c.audio.start(); }
      return true;
    } catch (e) {
      console.error('[intro] 播放失敗，直接略過', e);
      if (_cur === c) finish(c, 'error');
      return false;
    }
  }

  /* 玩家略過：整層淡出後結束。 */
  function skip() {
    var c = _cur;
    if (!c || c.skipping || !c.skippable) return;
    c.skipping = true;
    stopMotion(c);
    if (c.audio) c.audio.pause();
    clearTimeout(c.failsafe);
    var done = function () { finish(c, 'skip'); };
    try {
      // 收尾中略過，沿當下透明度淡出，不先閃回完整畫面。
      var opacity = typeof getComputedStyle === 'function' ? Number(getComputedStyle(c.root).opacity) : 1;
      var a = c.root.animate([{ opacity: isFinite(opacity) ? opacity : 1 }, { opacity: 0 }], { duration: SKIP_FADE_MS, fill: 'forwards' });
      a.onfinish = done;
    } catch (e) { done(); return; }
    // 分頁剛好被隱藏時動畫不會走完，用計時器保底
    c.skipTimer = setTimeout(done, SKIP_FADE_MS + 250);
  }

  /* 立即收掉，不淡出。Loading 被其他路徑收掉時用（見檔頭）。 */
  function abort(reason) {
    if (_cur) finish(_cur, reason || 'abort');
  }

  /* 沒在播就立刻呼叫；在播就等結束（播完、略過、中止都算）。 */
  function whenIdle(fn) {
    if (!_cur) { fn('idle'); return; }
    _idleWaiters.push(fn);
  }

  /* 除錯／驗證：停在第 ms 毫秒，並暫停在那裡。 */
  function seek(ms) {
    var c = _cur;
    if (!c) return false;
    pauseAll(c);
    c.seeking = true;
    c.anims.forEach(function (a) { try { a.currentTime = ms; } catch (e) {} });
    paintMotion(c, true);
    return true;
  }

  /* 開機進入點：bridge.js 在存檔來源確認通過、Worker 開機之前呼叫。 */
  function startupBegin(ctx) {
    ctx = ctx || {};
    var pick = { hasSave: ctx.hasSave, prologueSeen: storageGet(PROLOGUE_SEEN_KEY) === '1' };
    var id = chooseStartupTimeline(pick, (typeof location !== 'undefined' && location.search) || '');
    if (!id) return false;
    var bridge = (typeof WorkerBridge !== 'undefined') ? WorkerBridge : null;
    var started = play(INTRO_TIMELINES[id], {
      id: id, hold: true,
      onDone: function (reason) {
        // 看完或主動略過才算看過；Worker 失效、分頁鎖被搶等中止不算，下次開機再播
        if (id === PROLOGUE_TIMELINE && (reason === 'end' || reason === 'skip')) storageSet(PROLOGUE_SEEN_KEY, '1');
        if (bridge && bridge.resumeStartupHoldTimeout) bridge.resumeStartupHoldTimeout();
      }
    });
    if (started && bridge && bridge.suspendStartupHoldTimeout) bridge.suspendStartupHoldTimeout();
    return started;
  }

  /* 設定「說明」頁的重播按鈕。設定視窗留在底下不關：選單暫停照舊有效，
     看完回到原本的說明頁，焦點還給按鈕。不改「看過序章」紀錄。 */
  function replay() {
    var id = replayTimelineId();
    if (!id || _cur) return false;
    var btn = document.getElementById(REPLAY_BUTTON_ID);
    return play(INTRO_TIMELINES[id], {
      id: id,
      onDone: function () { if (btn) { try { btn.focus({ preventScroll: true }); } catch (e) {} } }
    });
  }

  var REPLAY_BUTTON_ID = 'btn-replay-intro';
  function bindReplayButton() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    var btn = document.getElementById(REPLAY_BUTTON_ID);
    if (!btn || btn._introBound) return;
    btn._introBound = true;
    btn.addEventListener('click', function (e) {
      // 不讓這次點擊冒泡到剛掛上的舞台，被當成「略過」
      if (e && e.stopPropagation) e.stopPropagation();
      replay();
    });
  }
  bindReplayButton();   // 本檔排在 body 最後載入，按鈕已在 DOM 裡

  function state() {
    var c = _cur;
    if (!c) return { playing: false };
    return {
      playing: true, id: c.id, duration: c.duration, paused: c.paused, skipping: c.skipping,
      reduced: c.reduced, time: num(c.clock && c.clock.currentTime, 0),
      holding: !!(c.hold && c.hold.holding), released: !!(c.hold && c.hold.released)
    };
  }

  return {
    play: play, skip: skip, abort: abort, whenIdle: whenIdle, seek: seek, release: release, replay: replay,
    startupBegin: startupBegin, state: state,
    isPlaying: function () { return !!_cur; },
    _internal: {
      opacityKeyframes: opacityKeyframes, motionKeyframes: motionKeyframes, transformOf: transformOf,
      timelineDuration: timelineDuration, validateTimeline: validateTimeline,
      chooseStartupTimeline: chooseStartupTimeline, replayTimelineId: replayTimelineId,
      PROLOGUE_SEEN_KEY: PROLOGUE_SEEN_KEY
    }
  };
})();
