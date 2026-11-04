'use strict';
/* ============ 音效播放（Sfx） ============
   目前只有升級音效。資料來源是 assets/audio/ 下的檔案，註冊在 SFX_FILES。
   WebAudio 預先解碼（播放零延遲）；瀏覽器要求先有使用者操作才能發聲，
   所以在第一次點擊／按鍵時 resume。任何失敗都靜默略過——音效不能影響遊戲。 */
var SFX_FILES = {
  levelUp: { url: 'assets/audio/level-up.wav?v=1', volume: 0.8 },   // 原檔只留前 1.5 秒
  /* 普攻命中音（自製，tools/audio/hit-slash.cjs 產生）：音量 0.6＝使用者要求比原本降低 40%（檔案本身另已降 30%） */
  hitSlashA: { url: 'assets/audio/hit-slash-a.wav?v=1', volume: 0.6 },
  hitSlashB: { url: 'assets/audio/hit-slash-b.wav?v=1', volume: 0.6 },
  hitSword:  { url: 'assets/audio/hit-sword.wav?v=1', volume: 0.6 }
};
/* 音效群組：從 names 隨機挑一個（不連續兩次同一個）。
   高攻速時每秒會有很多下，所以有兩道限流，超過直接丟掉、不排隊補播（補播只會讓聲音黏成一團）：
   minGapMs＝同一群組兩次發聲的最短間隔；maxVoices＝同一群組同時最多幾個聲音還在播。 */
var SFX_GROUPS = {
  basicHit: { names: ['hitSlashA', 'hitSlashB', 'hitSword'], minGapMs: 90, maxVoices: 3 }
};

var Sfx = (function () {
  var ctx = null, buffers = {}, loading = {}, unlocked = false;

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
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (type) {
      document.addEventListener(type, unlock, { capture: true, passive: true });
    });
  }

  function play(name, onEnd) {
    var def = SFX_FILES[name];
    var c = context();
    if (!def || !c) return false;
    try {
      if (c.state === 'suspended') c.resume();
      var buf = buffers[name];
      if (!buf) { load(name); return false; }
      var src = c.createBufferSource(), gain = c.createGain();
      src.buffer = buf;
      gain.gain.value = def.volume == null ? 1 : def.volume;
      src.connect(gain); gain.connect(c.destination);
      if (onEnd) src.onended = onEnd;
      src.start(0);
      return true;
    } catch (e) { return false; }
  }

  var groupState = {};   // 群組名 → { last: 上次發聲時間, voices: 還在播的數量, lastName: 上次挑到的音 }
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function fireGroup(group) {
    var def = SFX_GROUPS[group];
    if (!def || (typeof document !== 'undefined' && document.hidden)) return false;
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
  function playGroup(group, delayMs) {
    var d = Math.max(0, Math.min(2000, Number(delayMs) || 0));
    if (d < 1) return fireGroup(group);
    setTimeout(function () { fireGroup(group); }, d);
    return true;
  }

  return { play: play, playGroup: playGroup, preload: function () { unlock(); } };
})();
