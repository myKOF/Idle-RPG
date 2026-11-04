'use strict';
/* ============ 音效播放（Sfx） ============
   目前只有升級音效。資料來源是 assets/audio/ 下的檔案，註冊在 SFX_FILES。
   WebAudio 預先解碼（播放零延遲）；瀏覽器要求先有使用者操作才能發聲，
   所以在第一次點擊／按鍵時 resume。任何失敗都靜默略過——音效不能影響遊戲。 */
var SFX_FILES = {
  levelUp: { url: 'assets/audio/level-up.wav?v=1', volume: 0.8 }   // 原檔只留前 1.5 秒
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

  function play(name) {
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
      src.start(0);
      return true;
    } catch (e) { return false; }
  }

  return { play: play, preload: function () { unlock(); } };
})();
