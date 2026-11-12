'use strict';
/* ============ 音效播放（Sfx） ============
   兩種來源：assets/audio/ 下的檔案（升級、普攻命中，註冊在 SFX_FILES），
   以及技能合成音效（js/sfx-synth.js 的配方，由 Skills2 表的音效欄指定，見檔案後段）。
   WebAudio 預先解碼（播放零延遲）；瀏覽器要求先有使用者操作才能發聲，
   所以在第一次點擊／按鍵時 resume。任何失敗都靜默略過——音效不能影響遊戲。 */
var SFX_FILES = {
  /* 2026-11-10 使用者要求遊戲音效整體縮成 65%：levelUp 0.8→0.52、普攻命中 0.6→0.39 */
  levelUp: { url: 'assets/audio/level-up.wav?v=1', volume: 0.52 },   // 原檔只留前 1.5 秒
  /* 普攻命中音（自製，tools/audio/hit-slash.cjs 產生）：0.6＝使用者要求比原本降低 40%（檔案本身另已降 30%），再 ×0.65 */
  hitSlashA: { url: 'assets/audio/hit-slash-a.wav?v=1', volume: 0.39 },
  hitSlashB: { url: 'assets/audio/hit-slash-b.wav?v=1', volume: 0.39 },
  hitSword:  { url: 'assets/audio/hit-sword.wav?v=1', volume: 0.39 }
};
/* 音效群組：從 names 隨機挑一個（不連續兩次同一個）。
   高攻速時每秒會有很多下，所以有兩道限流，超過直接丟掉、不排隊補播（補播只會讓聲音黏成一團）：
   minGapMs＝同一群組兩次發聲的最短間隔；maxVoices＝同一群組同時最多幾個聲音還在播。 */
var SFX_GROUPS = {
  basicHit: { names: ['hitSlashA', 'hitSlashB', 'hitSword'], minGapMs: 90, maxVoices: 3 }
};

var Sfx = (function () {
  var ctx = null, buffers = {}, loading = {}, unlocked = false;
  var introActive = false, playbackEpoch = 0, activeVoices = new Set();

  function setIntroActive(value) {
    if (introActive === value) return;
    introActive = value;
    if (!value) return;
    playbackEpoch++;
    // 取消循環與仍在排程／解碼的聲音，收起序章後只接受新事件。
    loops = {};
    fieldSeen = {};
    groupState = {};
    synthState = {};
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    activeVoices.forEach(function (source) {
      try { source.disconnect(); source.stop(); } catch (_) {}
    });
    activeVoices.clear();
  }

  function startVoice(source, gain, when, offset, onEnd) {
    activeVoices.add(source);
    source.onended = function (event) {
      activeVoices.delete(source);
      source.disconnect();
      gain.disconnect();
      if (onEnd) onEnd.call(source, event);
    };
    try { source.start(when, offset); }
    catch (error) {
      activeVoices.delete(source);
      source.disconnect();
      gain.disconnect();
      throw error;
    }
  }

  function context() {
    if (ctx) return ctx;
    var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; }
    return ctx;
  }

  function load(name) {
    var def = SFX_FILES[name];
    var c = context();
    if (!def || !c || buffers[name] || loading[name]) return;
    loading[name] = true;
    fetch(def.url).then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return new Promise(function (ok, bad) { c.decodeAudioData(ab, ok, bad); }); })
      .then(function (buf) { buffers[name] = buf; })
      .catch(function () {})
      .then(function () { loading[name] = false; });
  }

  function unlock() {
    if (unlocked) return;
    var c = context();
    if (!c) return;
    unlocked = true;
    try { if (c.state === 'suspended') c.resume(); } catch (e) {}
    for (var name in SFX_FILES) load(name);
    setTimeout(preloadLoadout, 500);   // 技能音效：先把技能列上技能會用到的聲音算好
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (type) {
      document.addEventListener(type, unlock, { capture: true, passive: true });
    });
  }

  function play(name, onEnd) {
    if (introActive) return false;
    var def = SFX_FILES[name];
    var c = context();
    if (!def || !c) return false;
    var master = (typeof GameSettings !== 'undefined') ? GameSettings.sfxGain() : 1;   // 設置→音訊：全體靜音／音效音量
    if (master <= 0) return false;
    try {
      if (c.state === 'suspended') c.resume();
      var buf = buffers[name];
      if (!buf) { load(name); return false; }
      var src = c.createBufferSource(), gain = c.createGain();
      src.buffer = buf;
      gain.gain.value = (def.volume == null ? 1 : def.volume) * master;
      src.connect(gain); gain.connect(c.destination);
      startVoice(src, gain, 0, 0, onEnd);
      return true;
    } catch (e) { return false; }
  }

  var groupState = {};   // 群組名 → { last: 上次發聲時間, voices: 還在播的數量, lastName: 上次挑到的音 }
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  /* side：'ally'／'enemy'＝這個聲音是誰的攻擊，對應設置→音訊的「我方／敵方攻擊音效」；不填就不受這兩個開關管。 */
  function sideAllowed(side) {
    if (typeof GameSettings === 'undefined') return true;
    if (side === 'ally') return GameSettings.get('allyAttackSfx');
    if (side === 'enemy') return GameSettings.get('enemyAttackSfx');
    return true;
  }
  function fireGroup(group, side) {
    var def = SFX_GROUPS[group];
    if (!def || (typeof document !== 'undefined' && document.hidden) || !sideAllowed(side)) return false;
    var st = groupState[group] || (groupState[group] = { last: -1e9, voices: 0, lastName: null });
    var t = nowMs();
    if (t - st.last < def.minGapMs || st.voices >= def.maxVoices) return false;
    var ready = def.names.filter(function (n) { return buffers[n]; });
    if (!ready.length) { def.names.forEach(load); return false; }
    var pool = ready.length > 1 ? ready.filter(function (n) { return n !== st.lastName; }) : ready;
    var name = pool[Math.floor(Math.random() * pool.length)];
    st.voices++;
    var ok = play(name, function () { st.voices = Math.max(0, st.voices - 1); });
    if (!ok) { st.voices = Math.max(0, st.voices - 1); return false; }
    st.last = t; st.lastName = name;
    return true;
  }
  /* 播放群組裡的隨機一個音；delayMs＝多久之後才播（動作的「砍到」那一幀）。限流在真正要播的那一刻才判斷。 */
  function playGroup(group, delayMs, side) {
    if (introActive) return false;
    var d = Math.max(0, Math.min(2000, Number(delayMs) || 0));
    if (d < 1) return fireGroup(group, side);
    var epoch = playbackEpoch;
    setTimeout(function () { if (epoch === playbackEpoch) fireGroup(group, side); }, d);
    return true;
  }

  /* ============ 技能合成音效（2026-11-06，配方見 js/sfx-synth.js） ============
     名稱來自 Skills2 表的音效欄，模擬層解析後放在特效事件的 spec.sfx（角色 → 音效 id），
     由 VFX Runtime 在該角色真正播放的那一刻呼叫 skillRole；「施放音效」跟著施法動作（act）走。
     聲音先用 OfflineAudioContext 算成 AudioBuffer（單次音效每個備 3 種隨機變化輪流播），
     之後播放零延遲。全部失敗都靜默略過。 */
  var SYNTH_VOLUME = 0.8;          // 合成音效整體音量（再乘各配方的 level 與設置→音訊的音效音量）
  var SYNTH_VARIANTS = 3;
  var SYNTH_LATE_SEC = 0.15;       // 第一次播放要先算聲音；算好時已經晚超過這麼多就不播
  var LOOP_MAX = 6, LOOP_FADE_IN = 0.15, LOOP_FADE_OUT = 0.35;
  var synthBuffers = {}, synthLoading = {}, flightBuffers = {}, flightOrder = [];
  var synthState = {}, fieldSeen = {}, loops = {}, loopTimer = null, synthBusNode = null;

  function synthDef(id) { return (typeof SfxSynth !== 'undefined' && id) ? SfxSynth.def(id) : null; }
  function offlineCtor() { return (typeof window !== 'undefined') && (window.OfflineAudioContext || window.webkitOfflineAudioContext); }
  function masterGain() { return (typeof GameSettings !== 'undefined') ? GameSettings.sfxGain() : 1; }
  /* 播放音量＝整體 × 配方的 level（sfx-synth.js；播放端的線性倍率，不經過渲染時的壓縮器） */
  function synthVolume(def) { return SYNTH_VOLUME * (def && def.level != null ? def.level : 1) * masterGain(); }
  function synthBus(c) {
    if (synthBusNode && synthBusNode.context === c) return synthBusNode;
    var g = c.createGain(), lim = c.createDynamicsCompressor();
    // 多個技能音同時響時的保護：只壓超過 -6dB 的峰值，平常不改變音色
    lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 8; lim.attack.value = 0.003; lim.release.value = 0.2;
    g.connect(lim); lim.connect(c.destination);
    synthBusNode = g;
    return g;
  }
  function renderOne(id, dur) {
    var OAC = offlineCtor();
    if (!OAC || typeof SfxSynth === 'undefined') return Promise.reject(new Error('no offline audio'));
    return SfxSynth.render(id, { dur: dur, OfflineCtx: OAC });
  }
  /* 單次／循環：先算第一個變化就能播，其餘在背景補齊 */
  function loadSynth(id) {
    var def = synthDef(id);
    if (!def || def.kind === 'flight') return Promise.resolve(null);
    if (synthBuffers[id] && synthBuffers[id].length) return Promise.resolve(synthBuffers[id]);
    if (synthLoading[id]) return synthLoading[id];
    var want = def.kind === 'loop' ? 1 : SYNTH_VARIANTS;
    synthLoading[id] = renderOne(id).then(function (buf) {
      synthBuffers[id] = [buf];
      (function more(n) {
        if (n >= want) return;
        renderOne(id).then(function (b) { synthBuffers[id].push(b); more(n + 1); }, function () {});
      })(1);
      return synthBuffers[id];
    }).catch(function () { return null; }).then(function (r) { delete synthLoading[id]; return r; });
    return synthLoading[id];
  }
  /* 飛行：長度跟著實際飛行時間，以 0.05 秒為一格快取最近用過的 24 種長度 */
  function flightKey(id, dur) { return id + '@' + (Math.max(0.2, Math.min(4, Math.round(dur * 20) / 20))).toFixed(2); }
  function loadFlight(id, dur) {
    var key = flightKey(id, dur);
    if (flightBuffers[key]) return Promise.resolve(flightBuffers[key]);
    var d = Number(key.split('@')[1]);
    return renderOne(id, d).then(function (buf) {
      flightBuffers[key] = buf; flightOrder.push(key);
      while (flightOrder.length > 24) delete flightBuffers[flightOrder.shift()];
      return buf;
    }).catch(function () { return null; });
  }
  function startBuffer(c, buf, when, offset, vol, onEnd, loop) {
    var s = c.createBufferSource(), g = c.createGain();
    s.buffer = buf; s.loop = !!loop;
    g.gain.value = vol;
    s.connect(g); g.connect(synthBus(c));
    startVoice(s, g, Math.max(c.currentTime, when), Math.max(0, offset || 0), onEnd);
    return { src: s, gain: g };
  }
  /* 限流在「預定發聲時刻」判斷：minGapMs 內同一個音效只響一次；同時在播的數量不超過 maxVoices */
  function synthThrottle(id, def, plannedMs) {
    var st = synthState[id] || (synthState[id] = { last: -1e9, voices: 0, lastIdx: -1 });
    if (plannedMs - st.last < (def.minGapMs || 70) || st.voices >= (def.maxVoices || 3)) return null;
    st.last = plannedMs;
    return st;
  }
  function synthCanPlay(side) {
    return !(typeof document !== 'undefined' && document.hidden) && sideAllowed(side) && masterGain() > 0;
  }
  /* 播放一個技能音：opts＝{ delaySec, durSec（飛行）, side } */
  function playSynth(id, opts) {
    if (introActive) return false;
    var def = synthDef(id), c = context();
    opts = opts || {};
    if (!def || !c || def.kind === 'loop' || !synthCanPlay(opts.side)) return false;
    try { if (c.state === 'suspended') c.resume(); } catch (e) {}
    var delay = Math.max(0, Math.min(4, Number(opts.delaySec) || 0));
    var st = synthThrottle(id, def, nowMs() + delay * 1000);
    if (!st) return false;
    var target = c.currentTime + delay;
    var epoch = playbackEpoch;
    st.voices++;
    var done = function () { st.voices = Math.max(0, st.voices - 1); };
    var fire = function (buf) {
      if (!buf || epoch !== playbackEpoch) { done(); return; }
      var late = c.currentTime - target;
      if (late > SYNTH_LATE_SEC && def.kind !== 'flight') { done(); return; }
      // 飛行音效晚算好就從中段接著播，落地那一刻仍然對齊
      try { startBuffer(c, buf, target, late > 0 && def.kind === 'flight' ? late : 0, synthVolume(def), done); }
      catch (_) { done(); }
    };
    if (def.kind === 'flight') {
      var dur = Number(opts.durSec) > 0 ? Number(opts.durSec) : 1;
      var cached = flightBuffers[flightKey(id, dur)];
      if (cached) fire(cached); else loadFlight(id, dur).then(fire);
      return true;
    }
    var list = synthBuffers[id];
    var pick = function (arr) {
      if (!arr || !arr.length) return null;
      var i = Math.floor(Math.random() * arr.length);
      if (arr.length > 1 && i === st.lastIdx) i = (i + 1) % arr.length;   // 不連續兩次同一個變化
      st.lastIdx = i;
      return arr[i];
    };
    if (list && list.length) fire(pick(list)); else loadSynth(id).then(function (arr) { fire(pick(arr)); });
    return true;
  }

  /* 循環音效：key＝哪一個場域；每次續命延長 until，過期就淡出停止 */
  function loopTick() {
    var c = context(), t = nowMs(), hidden = typeof document !== 'undefined' && document.hidden, any = false;
    for (var key in loops) {
      var L = loops[key];
      if (hidden || t >= L.until || masterGain() <= 0) stopLoop(key); else any = true;
    }
    if (!any && loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    return c;
  }
  function stopLoop(key) {
    var L = loops[key], c = context();
    if (!L) return;
    delete loops[key];
    if (!L.node || !c) { L.cancelled = true; return; }
    try {
      var now = c.currentTime, g = L.node.gain.gain;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + LOOP_FADE_OUT);
      L.node.src.stop(now + LOOP_FADE_OUT + 0.05);
    } catch (e) {}
  }
  function loopTouch(key, id, keepSec, side) {
    var def = synthDef(id), c = context();
    if (!def || def.kind !== 'loop' || !c || !synthCanPlay(side)) return false;
    var until = nowMs() + Math.max(0.3, Math.min(60, Number(keepSec) || 1)) * 1000;
    var cur = loops[key];
    if (cur && cur.id === id) { cur.until = Math.max(cur.until, until); return true; }
    if (cur) stopLoop(key);
    var sameId = 0, total = 0;
    for (var k in loops) { total++; if (loops[k].id === id) sameId++; }
    if (total >= LOOP_MAX || sameId >= 2) return false;   // 同一種循環最多兩條，再多只是更吵
    var L = loops[key] = { id: id, until: until, node: null };
    var begin = function (arr) {
      if (L.cancelled || loops[key] !== L || !arr || !arr.length) { if (loops[key] === L) delete loops[key]; return; }
      try {
        if (c.state === 'suspended') c.resume();
        L.node = startBuffer(c, arr[0], c.currentTime, Math.random() * arr[0].duration, 0, null, true);
        var g = L.node.gain.gain;
        g.setValueAtTime(0, c.currentTime); g.linearRampToValueAtTime(synthVolume(def), c.currentTime + LOOP_FADE_IN);
      } catch (e) { delete loops[key]; }
    };
    var ready = synthBuffers[id];
    if (ready && ready.length) begin(ready); else loadSynth(id).then(begin);
    if (!loopTimer) loopTimer = setInterval(loopTick, 200);
    return true;
  }

  /* 技能事件的某個角色剛播放（由 VFX Runtime 呼叫）。
     地板／持續場域：循環音效跟著場域續命；單次音效只在場域出生時播（retrigger 的每次作用都播，例如雷球放電）。
     飛行：長度＝這一則事件的飛行時間。 */
  function skillRole(spec, role, delaySec, travelSec, keepSec) {
    if (introActive) return false;
    var id = spec && spec.sfx && spec.sfx[role], def = synthDef(id);
    if (!def) return false;
    var side = spec.cat === 'enemy' ? 'enemy' : 'ally';
    var delay = Math.max(0, Number(delaySec) || 0);
    if (role === 'field' || role === 'ground' || def.kind === 'loop') {
      var areaId = spec.area && spec.area.id != null ? String(spec.area.id).replace(/-column-\d+$/, '') : (spec.variant || '') + '@' + id;
      var key = role + ':' + areaId;
      // 壽命由 VFX Runtime 依場域續命規則給（keepSec）；循環至少留 0.6 秒，逐拍事件的間隔抖動才不會斷斷續續
      var keep = Number(keepSec) > 0 ? Number(keepSec) : Math.max(0.35, (Number(spec.dur) || 0.5) * 2.5);
      if (def.kind === 'loop') keep = Math.max(0.6, keep);
      if (def.kind === 'loop') return loopTouch(key, id, keep + delay, side);
      var t = nowMs(), seen = fieldSeen[key];
      fieldSeen[key] = t + (keep + delay) * 1000;
      if (seen && seen > t && !def.retrigger) return false;
      for (var k in fieldSeen) if (fieldSeen[k] <= t) delete fieldSeen[k];
      return playSynth(id, { delaySec: delay, side: side });
    }
    return playSynth(id, { delaySec: delay, durSec: travelSec, side: side });
  }
  /* 施放音效：跟著施法動作走，在硬直結束（技能放出去）那一刻響 */
  function playCast(id, delaySec) {
    if (introActive) return false;
    var def = synthDef(id);
    if (!def) return false;
    if (def.kind === 'loop') {
      var d = Math.max(0, Number(delaySec) || 0) * 1000;
      var epoch = playbackEpoch;
      setTimeout(function () {
        if (epoch === playbackEpoch) loopTouch('cast:' + id, id, def.castSec || 3, 'ally');
      }, d);
      return true;
    }
    return playSynth(id, { delaySec: delaySec, side: 'ally' });
  }

  /* 預載：技能列上的技能可能用到的所有音效（各階、超神、觸發欄），在背景一個一個先算好，
     第一次施放就有聲音。每 10 秒看一次技能列有沒有換；飛行音效長度要等實際事件才知道，不預載。 */
  var preloadQueue = [], preloadSeen = {}, preloadBusy = false, preloadTimer = null;
  function sfxIdsOfGroup(gid) {
    var g = (typeof SKILLS2 !== 'undefined') && SKILLS2[gid], out = [];
    if (!g) return out;
    var rows = (g.tiers || []).concat(g.ult || []);
    rows.forEach(function (row) {
      [row.sfx, row.triggerSfx].forEach(function (table) {
        for (var role in (table || {})) if (table[role]) out.push(table[role]);
      });
    });
    return out;
  }
  function preloadNext() {
    if (preloadBusy) return;
    var id = preloadQueue.shift();
    if (!id) return;
    preloadBusy = true;
    loadSynth(id).then(function () { preloadBusy = false; setTimeout(preloadNext, 50); });
  }
  function preloadLoadout() {
    if (!unlocked || typeof uiHeaderPanelSnapshot !== 'function') return;
    var snap = uiHeaderPanelSnapshot(), lo = (snap && snap.player && snap.player.loadout) || [];
    lo.forEach(function (entry) {
      if (typeof entry !== 'string' || entry.indexOf('sg:') !== 0) return;
      sfxIdsOfGroup(entry.slice(3)).forEach(function (id) {
        var def = synthDef(id);
        if (!def || def.kind === 'flight' || preloadSeen[id]) return;
        preloadSeen[id] = true; preloadQueue.push(id);
      });
    });
    preloadNext();
  }
  if (typeof setInterval === 'function' && typeof window !== 'undefined') {
    preloadTimer = setInterval(preloadLoadout, 10000);
  }

  return {
    play: play, playGroup: playGroup, preload: function () { unlock(); },
    setIntroActive: setIntroActive,
    playSynth: playSynth, skillRole: skillRole, playCast: playCast,
    loopStop: function (key) { stopLoop(key); },
    preloadSynth: function (ids) { (ids || []).forEach(function (id) { loadSynth(id); }); },
    preloadLoadout: preloadLoadout
  };
})();
