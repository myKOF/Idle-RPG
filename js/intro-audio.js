'use strict';
/* 序章聲景：兩條自製PCM軌，音樂／音效各自讀GameSettings。
   聲音跟隨IntroPlayer總時鐘；隱藏／停格／seek停止，回來只播當下位置。
   不搶UI／戰鬥音效的AudioContext，不記存檔，不繞過瀏覽器手勢限制。 */
var IntroAudio = (function () {
  var context = null, active = null, buffers = {}, loading = {};

  function level(kind) {
    if (typeof GameSettings === 'undefined') return 1;
    if (GameSettings.get('mute')) return 0;
    return kind === 'music' ? GameSettings.get('musicVolume') / 50 : GameSettings.sfxGain();
  }
  function load(url) {
    if (buffers[url]) return Promise.resolve(buffers[url]);
    if (loading[url]) return loading[url];
    loading[url] = fetch(url).then(function (response) {
      if (!response.ok) throw new Error('Intro audio HTTP ' + response.status);
      return response.arrayBuffer();
    }).then(function (data) { return context.decodeAudioData(data); }).then(function (buffer) {
      delete loading[url]; buffers[url] = buffer; return buffer;
    }).catch(function () { delete loading[url]; return null; });
    return loading[url];
  }
  function create(config, clock) {
    if (!config || typeof fetch !== 'function') return null;
    var disposed = false, wanted = false, epoch = 0, voices = [];
    function clear() {
      voices.forEach(function (v) {
        try { v.source.stop(); } catch (_) {}
        try { v.source.disconnect(); v.gain.disconnect(); } catch (_) {}
      });
      voices = [];
    }
    function update() {
      voices.forEach(function (v) { v.gain.gain.setTargetAtTime(level(v.kind), context.currentTime, .025); });
    }
    function pause() { wanted = false; epoch++; clear(); }
    function start() {
      if (disposed || wanted || document.hidden) return;
      wanted = true;
      var ticket = ++epoch;
      try {
        // 首次自動序章無手勢時保持安靜；設定頁重播是原生click，可正常解鎖。
        if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
        if (!context) {
          var Ctor = window.AudioContext || window.webkitAudioContext;
          if (!Ctor) return;
          context = new Ctor();
        }
        var ready = context.state === 'suspended' ? context.resume() : Promise.resolve();
        Promise.resolve(ready).then(function () {
          if (disposed || !wanted || epoch !== ticket || document.hidden || context.state !== 'running') return null;
          return Promise.all(['music', 'sfx'].map(function (kind) {
            return config[kind] ? load(config[kind]) : Promise.resolve(null);
          }));
        }).then(function (tracks) {
          if (!tracks || disposed || !wanted || epoch !== ticket || document.hidden || context.state !== 'running') return;
          var offset = Math.max(0, clock() / 1000);
          tracks.forEach(function (buffer, index) {
            if (!buffer || offset >= buffer.duration) return;
            var source = context.createBufferSource(), gain = context.createGain();
            var kind = index === 0 ? 'music' : 'sfx';
            voices.push({ source: source, gain: gain, kind: kind });
            source.buffer = buffer; gain.gain.value = level(kind);
            source.connect(gain); gain.connect(context.destination);
            source.start(0, offset);
          });
        }).catch(function () { if (epoch === ticket && !disposed) clear(); });
      } catch (_) { clear(); } // 裝置／解碼／播放失敗不影響動畫或開機。
    }
    var controller = {
      start: start, pause: pause,
      dispose: function () { disposed = true; pause(); if (active === controller) active = null; },
      update: update
    };
    if (active) active.dispose();
    active = controller;
    return controller;
  }
  if (typeof GameSettings !== 'undefined') GameSettings.subscribe(function () { if (active) active.update(); });
  return { create: create };
})();
