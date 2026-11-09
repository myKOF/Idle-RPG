'use strict';
/* ============ 技能合成音效配方（SfxSynth） ============
   2026-11-06 使用者試聽核准（第 3 輪試聽頁，見 docs/BATTLE_SOUND.md）。全部以 Web Audio 程式合成，
   沒有任何外部錄音或音色庫。這裡只有「聲音長什麼樣」；哪個技能、哪個時機播哪個音，
   由 Skills2 表的音效欄決定（docs/BATTLE_SOUND.md「技能音效」）。

   RECIPES[id]：
     fn(ac, out, t, R, dur)  在 BaseAudioContext ac 的時間 t 起，把聲音接到 out。
                             R(a,b)＝這一次的隨機微調值；dur＝飛行／循環音效的長度（秒）。
     kind      'oneshot' 單次；'flight' 長度＝飛行時間；'loop' 持續到場域消失
     gain      響度補償（依實測 RMS 校正，讓各音效聽感大小接近；循環音效刻意壓低）。渲染前套用，會經過壓縮器
     level     播放音量倍率（Sfx 播放時線性套用，不改音色）。預設 LEVEL＝0.65；本來就很小聲的填 1
     minGapMs  同一個音效兩次發聲的最短間隔（超過就丟掉，不補播）
     maxVoices 同一個音效同時最多幾個聲音在播
     retrigger 地板／持續場域每次續命（定時作用）都重播；預設只在場域出生時播一次
     castSec   循環音效掛在「施放音效」時播放的秒數（施放沒有場域壽命可循）

   Sfx（js/sfx.js）呼叫 render() 預先離線算成 AudioBuffer，播放時零延遲。 */
var SfxSynth = (function () {
  var SR = 32000;   // 最高的成分（冰晶、嘶嘶）約 9kHz，32k 取樣已足夠，記憶體比 44.1k 少約三成
  var flatHold = false;   // 循環音效離線渲染時為 true：持續段不衰減，才接得成無縫循環

  /* ═════════ 基礎工具 ═════════ */
  var noiseCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function noiseBuf(ac, brown) {
    var key = brown ? 'b' : 'w';
    var slot = noiseCache && noiseCache.get(ac);
    if (!slot) { slot = {}; if (noiseCache) noiseCache.set(ac, slot); }
    if (slot[key]) return slot[key];
    var len = Math.min(ac.length || ac.sampleRate * 4, ac.sampleRate * 4);
    len = Math.max(len, ac.sampleRate);
    var b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) {
      if (brown) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      else d[i] = Math.random() * 2 - 1;
    }
    slot[key] = b;
    return b;
  }
  function src(ac, brown, t, dur) {
    var s = ac.createBufferSource(), buf = noiseBuf(ac, brown);
    s.buffer = buf; s.loop = true;
    s.start(t, Math.random() * buf.duration * 0.75); s.stop(t + dur + 0.05);
    return s;
  }
  function noise(ac, t, dur) { return src(ac, false, t, dur); }    // 白噪音
  function bnoise(ac, t, dur) { return src(ac, true, t, dur); }    // 棕噪音（低沉）
  function osc(ac, type, t, dur) { var o = ac.createOscillator(); o.type = type; o.start(t); o.stop(t + dur); return o; }
  function env(ac, t, attack, peak, decay) {
    var g = ac.createGain(), p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(peak, t + attack);
    p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }
  function envHold(ac, t, attack, peak, hold, decay) {
    var g = ac.createGain(), p = g.gain, h = Math.max(0.001, hold);
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(peak, t + attack);
    p.linearRampToValueAtTime(flatHold ? peak : peak * 0.75, t + attack + h);
    p.exponentialRampToValueAtTime(0.0001, t + attack + h + decay);
    return g;
  }
  function filt(ac, type, f, q) { var b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q == null ? 0.7 : q; return b; }
  function sweep(param, t, pts) {
    param.setValueAtTime(pts[0][1], t + pts[0][0]);
    for (var i = 1; i < pts.length; i++) param.exponentialRampToValueAtTime(pts[i][1], t + pts[i][0]);
  }
  function flutter(param, t, dur, lo, hi, s0, s1) {
    s0 = s0 == null ? 0.03 : s0; s1 = s1 == null ? 0.08 : s1;
    param.setValueAtTime((lo + hi) / 2, t);
    var tt = t;
    while (tt < t + dur) { tt += s0 + Math.random() * (s1 - s0); param.linearRampToValueAtTime(lo + Math.random() * (hi - lo), tt); }
  }
  function stutter(param, t, dur, onProb, s0, s1, fadeOut) {
    param.setValueAtTime(0, t);
    var tt = t;
    while (tt < t + dur) {
      var lvl = Math.random() < onProb ? (fadeOut ? 1 - (tt - t) / dur * 0.6 : 1) * (0.6 + Math.random() * 0.4) : 0;
      param.setValueAtTime(lvl, tt);
      tt += s0 + Math.random() * (s1 - s0);
    }
    param.setValueAtTime(0, tt);
  }
  var shaperCurves = {};
  function shaper(ac, drive) {
    var w = ac.createWaveShaper(), c = shaperCurves[drive];
    if (!c) {
      c = new Float32Array(1024);
      for (var i = 0; i < 1024; i++) { var x = i / 1023 * 2 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
      shaperCurves[drive] = c;
    }
    w.curve = c; w.oversample = '2x';
    return w;
  }
  function gain(ac, v) { var g = ac.createGain(); g.gain.value = v; return g; }
  function pan(ac, v) { var p = ac.createStereoPanner(); p.pan.value = v; return p; }
  function chain() { for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); return arguments[arguments.length - 1]; }
  /* pts：[[時間偏移, 值, 線性?]]，第一點是起始值 */
  function rampGain(ac, t, pts) {
    var g = ac.createGain();
    g.gain.setValueAtTime(pts[0][1], t + pts[0][0]);
    for (var i = 1; i < pts.length; i++) {
      if (pts[i][2]) g.gain.linearRampToValueAtTime(pts[i][1], t + pts[i][0]);
      else g.gain.exponentialRampToValueAtTime(pts[i][1], t + pts[i][0]);
    }
    return g;
  }
  function opt(o, k, d) { return o && o[k] != null ? o[k] : d; }

  /* ═════════ 聲音積木 ═════════ */
  // 細碎劈啪（火星／電花／碎石／纖維）
  function crackles(ac, out, t, span, count, amp, o) {
    var fLo = opt(o, 'fLo', 1500), fHi = opt(o, 'fHi', 5500), q = opt(o, 'q', 2), dMin = opt(o, 'dMin', 0.008), dMax = opt(o, 'dMax', 0.028);
    var bias = opt(o, 'bias', 1.6), spread = opt(o, 'spread', 0.6), rise = opt(o, 'rise', false);
    for (var i = 0; i < count; i++) {
      var tt = t + Math.pow(Math.random(), bias) * span, u = (tt - t) / span;
      var fade = rise ? 0.3 + 0.7 * u : 1 - u * 0.7;
      chain(noise(ac, tt, 0.08), filt(ac, 'bandpass', fLo + Math.random() * (fHi - fLo), q),
        env(ac, tt, 0.001, Math.max(0.02, amp * fade * (0.4 + Math.random() * 0.6)), dMin + Math.random() * (dMax - dMin)),
        pan(ac, (Math.random() * 2 - 1) * spread), out);
    }
  }
  // 泛音共振（金屬／冰晶／木頭／肉）：partials＝[[頻率倍數, 音量, 衰減加速]]
  function ring(ac, out, t, f, partials, decay, amp, pn) {
    for (var i = 0; i < partials.length; i++) {
      var ratio = partials[i][0], a = partials[i][1], dm = partials[i][2] || 1;
      var o = osc(ac, 'sine', t, decay / dm + 0.05); o.frequency.value = f * ratio;
      chain(o, env(ac, t, 0.0008, amp * a, decay / dm), pan(ac, pn || 0), out);
    }
  }
  // 帶通噪音呼嘯：頻率 f0→f1（峰值時刻）→f2
  function whoosh(ac, out, t, len, o) {
    var peakAt = opt(o, 'peakAt', 0.5);
    var bp = filt(ac, 'bandpass', o.f0, opt(o, 'q', 2));
    sweep(bp.frequency, t, [[0, o.f0], [len * peakAt, o.f1], [len, o.f2]]);
    var p = ac.createStereoPanner();
    p.pan.setValueAtTime(opt(o, 'p0', 0), t); p.pan.linearRampToValueAtTime(opt(o, 'p1', 0), t + len);
    chain(opt(o, 'white', true) ? noise(ac, t, len + 0.05) : bnoise(ac, t, len + 0.05), bp,
      rampGain(ac, t, [[0, 0.0001], [len * peakAt, o.peak], [len, 0.0001]]), p, out);
  }
  function boom(ac, out, t, f0, f1, len, peak) { var o = osc(ac, 'sine', t, len + 0.05); sweep(o.frequency, t, [[0, f0], [len * 0.6, f1]]); chain(o, env(ac, t, 0.004, peak, len), out); }
  function rumble(ac, out, t, dur, cut, peak, attack) { chain(bnoise(ac, t, dur + 0.05), filt(ac, 'lowpass', cut, 0.7), env(ac, t, attack == null ? 0.03 : attack, peak, dur), out); }
  function burstNoise(ac, out, t, type, f, q, attack, peak, dur, drive) {
    var n = chain(noise(ac, t, dur + 0.05), filt(ac, type, f, q)), g = env(ac, t, attack, peak, dur);
    if (drive) chain(n, shaper(ac, drive), g, out); else chain(n, g, out);
  }
  function bubble(ac, out, t, f, len, amp, pn) { var o = osc(ac, 'sine', t, len + 0.02); sweep(o.frequency, t, [[0, f], [len, f * 2.2]]); chain(o, env(ac, t, 0.003, amp, len), pan(ac, pn || 0), out); }
  function tinkles(ac, out, t, span, count, amp, fLo, fHi) {
    fLo = fLo || 2500; fHi = fHi || 7500;
    for (var i = 0; i < count; i++) {
      var tt = t + Math.pow(Math.random(), 1.4) * span, fade = 1 - (tt - t) / span * 0.6;
      var o = osc(ac, 'sine', tt, 0.4); o.frequency.value = fLo + Math.random() * (fHi - fLo);
      chain(o, env(ac, tt, 0.001, amp * fade * (0.4 + Math.random() * 0.6), 0.05 + Math.random() * 0.2), pan(ac, Math.random() * 1.2 - 0.6), out);
    }
  }
  function chord(ac, out, t, freqs, attack, dur, amp) {
    for (var i = 0; i < freqs.length; i++) {
      var f = freqs[i], o = osc(ac, 'sine', t, attack + dur + 0.1); o.frequency.value = f;
      var v = osc(ac, 'sine', t, attack + dur + 0.1); v.frequency.value = 4 + Math.random() * 2; chain(v, gain(ac, f * 0.004), o.frequency);
      chain(o, env(ac, t, attack, amp, dur), out);
    }
  }
  function squelch(ac, out, ti, k, amt, f0, f1, len) {
    f0 = f0 || 2200; f1 = f1 || 600; len = len || 0.09;
    var bp = filt(ac, 'bandpass', f0, 6); sweep(bp.frequency, ti, [[0, f0 * k], [len, f1 * k]]);
    chain(noise(ac, ti, len + 0.05), bp, env(ac, ti, 0.003, amt, len), out);
  }
  function flame(ac, out, t, o) {
    var s = o.white ? noise(ac, t, o.dur + 0.1) : bnoise(ac, t, o.dur + 0.1);
    var f = filt(ac, o.type || 'lowpass', (o.cutLo + o.cutHi) / 2, o.q || 0.9);
    flutter(f.frequency, t, o.dur, o.cutLo, o.cutHi, o.rate[0], o.rate[1]);
    var fl = ac.createGain(); flutter(fl.gain, t, o.dur, o.flick[0], o.flick[1], o.rate[0], o.rate[1]);
    chain(s, f, fl, envHold(ac, t, o.attack, o.peak, o.dur - o.attack - o.decay, o.decay), pan(ac, o.pan || 0), out);
  }
  function thump(ac, out, t, k, peak) { boom(ac, out, t, 130 * k, 45 * k, 0.22, peak); chain(noise(ac, t, 0.08), filt(ac, 'lowpass', 1800), env(ac, t, 0.002, peak * 0.6, 0.06), out); }
  // 電弧劈啪：使用者指定的「電流聲」（第 1 輪雷球 A 被拆掉的那一層）
  function arcCrackle(ac, out, t, dur, lvl, fadeOut) {
    var gate = ac.createGain(); stutter(gate.gain, t, dur, 0.55, 0.006, 0.024, fadeOut !== false);
    chain(noise(ac, t, dur + 0.05), filt(ac, 'highpass', 3000), gate, gain(ac, lvl), out);
  }
  function thunderCrack(ac, out, t, amp) { chain(noise(ac, t, 0.1), filt(ac, 'highpass', 1800), shaper(ac, 4), env(ac, t, 0.0008, amp == null ? 0.9 : amp, 0.07), out); }
  function thunderRumble(ac, out, t, dur, amp) {
    dur = dur || 1.3; amp = amp || 1.2;
    var lp = filt(ac, 'lowpass', 600, 0.8); sweep(lp.frequency, t, [[0, 600], [dur * 0.9, 90]]);
    chain(bnoise(ac, t + 0.02, dur + 0.3), lp, env(ac, t + 0.02, 0.06, amp, dur), out);
  }
  function loopEnv(ac, t, dur, peak) { return envHold(ac, t, 0.25, peak == null ? 1 : peak, dur - 0.65, 0.4); }

  /* ═════════ 物理 ═════════ */
  function knife(ac, out, t, R) {   // 2026-11-08 使用者從 5 個候選選定「鏗鏘」：像打在盔甲上
    var k = R(0.95, 1.07);
    whoosh(ac, out, t, 0.09, { f0: 2500 * k, f1: 6000 * k, f2: 3500 * k, q: 2.5, peak: 0.3, p0: 0.4, p1: -0.2, peakAt: 0.8 });
    var ti = t + 0.08;
    burstNoise(ac, out, ti, 'highpass', 4000, 0.7, 0.0004, 0.8, 0.02, 3);                    // 撞擊瞬間
    ring(ac, out, ti, 2950 * k, [[1, 0.6], [1.006, 0.4], [2.41, 0.35, 1.5], [3.88, 0.2, 2.2], [5.3, 0.12, 3]], 0.32, 0.22);   // 清脆「叮——」
    crackles(ac, out, ti + 0.005, 0.12, 9, 0.6, { fLo: 4000, fHi: 8000, q: 3, dMin: 0.003, dMax: 0.008, bias: 1.3, spread: 0.7 });   // 濺出的火花
  }
  function thrust(ac, out, t, R) {   // 2026-11-08 使用者從 5 個候選選定「疾風一刺」
    var k = R(0.93, 1.08), len = 0.13, ti = t + len;
    var bp = filt(ac, 'bandpass', 800, 2.2);
    sweep(bp.frequency, t, [[0, 800 * k], [len * 0.5, 1600 * k], [len, 7000 * k]]);              // 破風一路加速往上衝
    chain(noise(ac, t, len + 0.05), bp, rampGain(ac, t, [[0, 0.0001], [len * 0.5, 0.15], [len, 0.75], [len + 0.012, 0.0001]]), out);
    squelch(ac, out, ti, k, 1, 2400, 700, 0.08);                                                  // 「噗嗤」
    ring(ac, out, ti, 165 * k, [[1, 0.9], [2.3, 0.45, 1.5]], 0.08, 0.75);
    burstNoise(ac, out, ti, 'bandpass', 1600 * k, 1, 0.0006, 0.5, 0.03);
  }
  function cleave(ac, out, t, R) { var k = R(0.92, 1.1), len = 0.5;
    var bp = filt(ac, 'bandpass', 600, 2.2);
    sweep(bp.frequency, t, [[0, 500 * k], [0.12, 2600 * k], [0.25, 900 * k], [0.38, 2400 * k], [len, 700 * k]]);
    var p = ac.createStereoPanner(); p.pan.setValueAtTime(-0.8, t); p.pan.linearRampToValueAtTime(0.8, t + 0.18); p.pan.linearRampToValueAtTime(-0.6, t + 0.36); p.pan.linearRampToValueAtTime(0.3, t + len);
    chain(noise(ac, t, len + 0.05), bp, rampGain(ac, t, [[0, 0.0001], [0.1, 0.8], [0.24, 0.45, 1], [0.36, 0.75, 1], [len, 0.0001]]), p, out);
    whoosh(ac, out, t, len, { f0: 180, f1: 420, f2: 160, q: 1.2, peak: 0.5, white: false, peakAt: 0.35 });   // 低沉迴旋
    burstNoise(ac, out, t + 0.12, 'bandpass', 4800 * k, 6, 0.001, 0.45, 0.15);                         // 刀鋒「鏘」
  }
  function gale(ac, out, t, R) {   // 2026-11-08 使用者改成重擊砸地方向，從 5 個候選選定「落錘震波」
    var k = R(0.93, 1.07);
    boom(ac, out, t, 75 * k, 30, 0.6, 1);                                                    // 重錘落地的悶響
    burstNoise(ac, out, t, 'lowpass', 700, 0.8, 0.002, 0.8, 0.1, 3);
    whoosh(ac, out, t + 0.01, 0.7, { f0: 200, f1: 900, f2: 250, q: 0.9, peak: 0.7, peakAt: 0.12, white: false });   // 空氣震波往外推
    whoosh(ac, out, t + 0.01, 0.55, { f0: 1800, f1: 1200, f2: 400, q: 0.7, peak: 0.35, peakAt: 0.1 });
    crackles(ac, out, t + 0.05, 0.4, 10, 0.35, { fLo: 300, fHi: 1200, q: 2.5, dMin: 0.02, dMax: 0.05, bias: 1.5, spread: 0.8 });   // 碎屑
    rumble(ac, out, t + 0.03, 0.9, 120, 0.6, 0.08);                                         // 餘震
  }
  function bloodblade(ac, out, t, R) { var k = R(0.92, 1.1);
    whoosh(ac, out, t, 0.13, { f0: 700 * k, f1: 3500 * k, f2: 2500 * k, q: 2.5, peak: 0.5, peakAt: 0.85 });
    var ti = t + 0.12;
    ring(ac, out, ti, 170 * k, [[1, 1], [2.3, 0.5, 1.5]], 0.09, 0.7);
    squelch(ac, out, ti, k, 1.0, 2400, 500, 0.1);
    squelch(ac, out, ti + 0.05, k * 0.8, 0.6, 1800, 400, 0.12);
    var bp = filt(ac, 'bandpass', 1800, 1.5); flutter(bp.frequency, ti + 0.03, 0.25, 1200, 2600, 0.01, 0.03);
    chain(noise(ac, ti + 0.03, 0.3), bp, env(ac, ti + 0.03, 0.01, 0.35, 0.25), out);   // 血噴「嘶」
  }
  function poisonDrop(ac, out, t, R) { var k = R(0.9, 1.1);
    bubble(ac, out, t, 420 * k, 0.06, 0.6); bubble(ac, out, t + 0.05, 650 * k, 0.05, 0.35, 0.3);
    squelch(ac, out, t, k, 0.5, 1500, 600, 0.08);
    var bp = filt(ac, 'bandpass', 5000, 1); flutter(bp.frequency, t + 0.04, 0.6, 3500, 7000, 0.02, 0.05);
    var fl = ac.createGain(); flutter(fl.gain, t + 0.04, 0.6, 0.3, 1, 0.01, 0.04);
    chain(noise(ac, t + 0.04, 0.6), bp, fl, envHold(ac, t + 0.04, 0.05, 0.25, 0.25, 0.3), out);   // 腐蝕嘶嘶
    for (var i = 0; i < 4; i++) bubble(ac, out, t + 0.1 + Math.random() * 0.4, (500 + Math.random() * 700) * k, 0.04, 0.15, Math.random() - 0.5);
  }
  function bloodBurst(ac, out, t, R) { var k = R(0.9, 1.1);
    boom(ac, out, t, 110 * k, 40, 0.3, 0.8);
    squelch(ac, out, t, k, 1.2, 1000, 200, 0.18);
    burstNoise(ac, out, t, 'lowpass', 1500, 0.7, 0.002, 0.6, 0.25, 2);
    crackles(ac, out, t + 0.03, 0.5, 18, 0.6, { fLo: 400, fHi: 1800, q: 2.5, dMin: 0.02, dMax: 0.06, bias: 1.5 });   // 血肉飛濺
    for (var i = 0; i < 5; i++) squelch(ac, out, t + 0.15 + Math.random() * 0.5, k * (0.7 + Math.random() * 0.6), 0.25, 1600, 600, 0.05);   // 落地滴濺
  }
  function dualdance(ac, out, t, R) { var k = R(0.92, 1.1);
    for (var i = 0; i < 4; i++) {
      var tt = t + i * 0.085, kk = k * (i % 2 ? 1.15 : 0.95);
      whoosh(ac, out, tt, 0.08, { f0: 1000 * kk, f1: 5200 * kk, f2: 2500 * kk, q: 2.2, peak: 0.5, p0: i % 2 ? 0.6 : -0.6, p1: i % 2 ? -0.4 : 0.4, peakAt: 0.75 });
      burstNoise(ac, out, tt + 0.065, 'bandpass', 3200 * kk, 1.4, 0.0006, 0.55, 0.03);
      ring(ac, out, tt + 0.065, 2300 * kk, [[1, 0.4], [2.6, 0.25, 1.6]], 0.09, 0.18);
    }
  }
  function counter(ac, out, t, R) {   // 2026-11-08 使用者看了 5 輪 25 個候選，選定「弓掌拍」：手掌微彎拍在厚毯上
    var k = R(0.93, 1.07);
    chain(noise(ac, t, 0.055), filt(ac, 'bandpass', 1200 * k, 0.9), filt(ac, 'lowpass', 2160 * k), env(ac, t, 0.0008, 0.35, 0.025), out);   // 被布吃掉的短促掌聲
    var o = osc(ac, 'sine', t, 0.12); sweep(o.frequency, t, [[0, 190 * k], [0.08, 120 * k]]);
    chain(o, env(ac, t, 0.002, 0.6, 0.09), out);                                                              // 掌心空氣被擠出的「啵」
    chain(noise(ac, t, 0.1), filt(ac, 'bandpass', 220 * k, 4), gain(ac, 3), env(ac, t, 0.002, 0.6, 0.08), out);
    var ti = t + 0.003, lp = filt(ac, 'lowpass', 420 * k, 0.9);                                               // 厚毯的悶響
    sweep(lp.frequency, ti, [[0, 420 * k], [0.1, 147 * k]]);
    chain(noise(ac, ti, 0.15), lp, env(ac, ti, 0.002, 0.6, 0.1), out);
    boom(ac, out, ti, 90 * k, 54 * k, 0.11, 0.48);
  }
  function holyBurst(ac, out, t, R) { var k = R(0.97, 1.03);
    whoosh(ac, out, t, 0.35, { f0: 400, f1: 3500, f2: 5000, q: 1, peak: 0.25, peakAt: 0.9 });
    chord(ac, out, t + 0.25, [523 * k, 659 * k, 784 * k, 1047 * k], 0.02, 1.4, 0.12);
    tinkles(ac, out, t + 0.25, 0.8, 14, 0.12, 2000, 6000);
    boom(ac, out, t + 0.25, 180, 90, 0.5, 0.3);
  }
  function bloodrage(ac, out, t, R) { var k = R(0.92, 1.08);
    whoosh(ac, out, t, 0.12, { f0: 200, f1: 900, f2: 400, q: 1, peak: 0.5, white: false, peakAt: 0.9 });   // 蓄力拳風
    var ti = t + 0.11;
    boom(ac, out, ti, 95 * k, 32, 0.55, 1.0);
    burstNoise(ac, out, ti, 'lowpass', 2500, 0.7, 0.001, 0.9, 0.12, 4);                                     // 重拳炸裂
    whoosh(ac, out, ti, 0.5, { f0: 900, f1: 300, f2: 120, q: 1.5, peak: 0.5, white: false, peakAt: 0.05 });  // 暗紅震波
    rumble(ac, out, ti + 0.02, 0.7, 200, 0.6);
  }

  /* ═════════ 火 ═════════ */
  function fireball(ac, out, t, R) {   // 第 2 輪「烈焰翻騰」：燃燒聲為主，爆開聲壓小
    var k = R(0.9, 1.1);
    thump(ac, out, t, k, 0.22);
    flame(ac, out, t, { dur: 1.35, attack: 0.07, peak: 1.0, decay: 0.6, cutLo: 450 * k, cutHi: 1500 * k, rate: [0.03, 0.09], flick: [0.35, 1] });
    flame(ac, out, t + 0.02, { dur: 1.3, attack: 0.12, peak: 0.9, decay: 0.6, cutLo: 120, cutHi: 320, rate: [0.06, 0.14], flick: [0.5, 1] });
    flame(ac, out, t + 0.03, { white: true, type: 'highpass', dur: 1.1, attack: 0.08, peak: 0.06, decay: 0.5, cutLo: 3500, cutHi: 5500, rate: [0.02, 0.05], flick: [0.2, 1] });
    crackles(ac, out, t + 0.05, 1.1, 14, 0.55, { bias: 1.2 });
  }
  function meteorFly(ac, out, t, R, dur) { var k = R(0.92, 1.08); dur = dur || 1;
    var lp = filt(ac, 'lowpass', 300, 1); sweep(lp.frequency, t, [[0, 250], [dur, 1600 * k]]);
    var fl = ac.createGain(); flutter(fl.gain, t, dur, 0.5, 1, 0.03, 0.07);
    chain(bnoise(ac, t, dur + 0.1), lp, fl, rampGain(ac, t, [[0, 0.0001], [dur, 1.0], [dur + 0.05, 0.0001, 1]]), out);       // 火焰轟鳴由遠而近
    var bp = filt(ac, 'bandpass', 1500, 1); sweep(bp.frequency, t, [[0, 800], [dur, 3000]]);
    chain(noise(ac, t, dur + 0.1), bp, rampGain(ac, t, [[0, 0.0001], [dur, 0.35], [dur + 0.05, 0.0001, 1]]), out);            // 破空氣流
    var o = osc(ac, 'sine', t, dur + 0.05); sweep(o.frequency, t, [[0, 1400 * k], [dur, 700 * k]]);
    chain(o, rampGain(ac, t, [[0, 0.0001], [dur * 0.9, 0.05], [dur + 0.03, 0.0001, 1]]), out);                                 // 尖嘯（都卜勒下降）
    crackles(ac, out, t + dur * 0.3, dur * 0.7, Math.round(dur * 14), 0.4, { bias: 0.6 });
  }
  function meteorImpact(ac, out, t, R, scale) { scale = scale || 1; var k = R(0.92, 1.08) / Math.sqrt(scale);
    boom(ac, out, t, 75 * k, 28 * k, 0.9 * scale, 1.0);
    burstNoise(ac, out, t, 'lowpass', 3000, 0.7, 0.001, 1.0, 0.25 * scale, 3);                     // 撞擊爆裂
    var lp = filt(ac, 'lowpass', 1500, 0.7); sweep(lp.frequency, t, [[0, 1800], [1.2 * scale, 120]]);
    chain(bnoise(ac, t, 1.4 * scale), lp, shaper(ac, 2), env(ac, t, 0.01, 0.9, 1.3 * scale), out);  // 爆炸翻滾
    rumble(ac, out, t + 0.05, 1.6 * scale, 140, 0.8, 0.08);
    crackles(ac, out, t + 0.05, 0.9 * scale, Math.round(22 * scale), 0.6, { fLo: 300, fHi: 1500, q: 2.5, dMin: 0.02, dMax: 0.06, bias: 1.4, spread: 0.9 });   // 碎石
    flame(ac, out, t + 0.1, { dur: 1.0 * scale, attack: 0.1, peak: 0.35, decay: 0.5, cutLo: 400, cutHi: 1300, rate: [0.03, 0.08], flick: [0.4, 1] });
  }
  function starfallFly(ac, out, t, R, dur) { meteorFly(ac, out, t, function (a, b) { return R(a, b) * 0.7; }, dur || 1.6); }
  function starfallImpact(ac, out, t, R) { meteorImpact(ac, out, t, R, 1.6); }
  function dragonDevour(ac, out, t, R) { var k = R(0.9, 1.1), dur = 1.2;
    var o = osc(ac, 'sawtooth', t, dur + 0.05), o2 = osc(ac, 'sawtooth', t, dur + 0.05);
    sweep(o.frequency, t, [[0, 70 * k], [0.35, 105 * k], [dur, 60 * k]]); sweep(o2.frequency, t, [[0, 72 * k], [0.35, 108 * k], [dur, 61 * k]]);
    var pre = gain(ac, 0.5); o.connect(pre); o2.connect(pre);
    chain(noise(ac, t, dur + 0.05), filt(ac, 'lowpass', 2000), gain(ac, 0.2), pre);                // 氣息
    var f1 = filt(ac, 'bandpass', 600, 3), f2 = filt(ac, 'bandpass', 1200, 4), sum = gain(ac, 1);
    sweep(f1.frequency, t, [[0, 400], [0.35, 750], [dur, 450]]); sweep(f2.frequency, t, [[0, 900], [0.35, 1500], [dur, 1000]]);
    chain(pre, f1, sum); chain(pre, f2, gain(ac, 0.7), sum);                                         // 喉音共振峰
    var trem = gain(ac, 0.6), lfo = osc(ac, 'sine', t, dur + 0.05); lfo.frequency.value = 22; chain(lfo, gain(ac, 0.4), trem.gain);   // 低吼顫動
    chain(sum, shaper(ac, 3), trem, envHold(ac, t, 0.12, 0.9, dur - 0.5, 0.38), out);
    flame(ac, out, t + 0.05, { dur: dur, attack: 0.15, peak: 0.6, decay: 0.5, cutLo: 400, cutHi: 1400, rate: [0.03, 0.08], flick: [0.4, 1] });
  }
  function fireShockwave(ac, out, t, R) { var k = R(0.92, 1.08);
    boom(ac, out, t, 120 * k, 45, 0.35, 0.6);
    whoosh(ac, out, t, 0.7, { f0: 250 * k, f1: 1800 * k, f2: 400 * k, q: 0.8, peak: 0.8, peakAt: 0.15 });
    flame(ac, out, t + 0.05, { dur: 0.7, attack: 0.05, peak: 0.5, decay: 0.4, cutLo: 500, cutHi: 1600, rate: [0.03, 0.07], flick: [0.4, 1] });
    crackles(ac, out, t + 0.05, 0.5, 8, 0.5);
  }
  function fireTornado(ac, out, t, R, dur) {   // 第 2 輪「柴火劈啪」改成循環
    var k = R(0.95, 1.05); dur = dur || 3;
    flame(ac, out, t, { dur: dur, attack: 0.25, peak: 0.7, decay: 0.4, cutLo: 350 * k, cutHi: 1100 * k, rate: [0.04, 0.1], flick: [0.4, 1] });
    crackles(ac, out, t + 0.05, dur - 0.4, Math.round(dur * 27), 0.85, { bias: 1, dMax: 0.02 });
    crackles(ac, out, t + 0.1, dur - 0.4, Math.round(dur * 5), 0.9, { fLo: 500, fHi: 1400, q: 3, dMin: 0.025, dMax: 0.05, bias: 1 });
  }
  function lavaPool(ac, out, t, R, dur) { dur = dur || 3;
    var lp = filt(ac, 'lowpass', 200, 1); flutter(lp.frequency, t, dur, 120, 300, 0.1, 0.25);
    chain(bnoise(ac, t, dur + 0.05), lp, loopEnv(ac, t, dur, 0.8), out);                            // 岩漿低沉翻湧
    for (var i = 0; i < Math.round(dur * 7); i++) {
      var tt = t + 0.2 + Math.random() * (dur - 0.6), f = 90 + Math.random() * 130;
      bubble(ac, out, tt, f, 0.08 + Math.random() * 0.07, 0.5, Math.random() * 0.8 - 0.4);            // 「啵囉」大氣泡
      chain(noise(ac, tt + 0.06, 0.05), filt(ac, 'lowpass', 700), env(ac, tt + 0.06, 0.002, 0.25, 0.04), out);
    }
    var fl = ac.createGain(); flutter(fl.gain, t, dur, 0.1, 1, 0.03, 0.08);
    chain(noise(ac, t, dur + 0.05), filt(ac, 'highpass', 4000), fl, loopEnv(ac, t, dur, 0.06), out);  // 嘶嘶
  }
  function firehunt(ac, out, t, R) { var k = R(0.9, 1.12);
    boom(ac, out, t, 170 * k, 65, 0.14, 0.45);
    var bp = filt(ac, 'bandpass', 1800, 0.9); sweep(bp.frequency, t, [[0, 2000 * k], [0.25, 450]]);
    chain(noise(ac, t, 0.35), bp, shaper(ac, 2.5), env(ac, t, 0.002, 0.7, 0.28), out);
    flame(ac, out, t + 0.02, { dur: 0.45, attack: 0.03, peak: 0.4, decay: 0.3, cutLo: 500, cutHi: 1500, rate: [0.02, 0.05], flick: [0.4, 1] });
    crackles(ac, out, t + 0.02, 0.3, 5, 0.6);
  }
  function solarRingFly(ac, out, t, R, dur) { var k = R(0.92, 1.08); dur = dur || 0.6;
    var bp = filt(ac, 'bandpass', 600, 1.2); sweep(bp.frequency, t, [[0, 500 * k], [dur * 0.5, 1600 * k], [dur, 700 * k]]);
    var fl = ac.createGain(); flutter(fl.gain, t, dur, 0.5, 1, 0.02, 0.05);
    var p = ac.createStereoPanner(); p.pan.setValueAtTime(-0.8, t); p.pan.linearRampToValueAtTime(0.8, t + dur);
    chain(noise(ac, t, dur + 0.05), bp, fl, rampGain(ac, t, [[0, 0.0001], [dur * 0.5, 0.9], [dur, 0.0001]]), p, out);
    flame(ac, out, t, { dur: dur, attack: dur * 0.4, peak: 0.5, decay: dur * 0.45, cutLo: 150, cutHi: 400, rate: [0.03, 0.06], flick: [0.5, 1] });
  }

  /* ═════════ 土 ═════════ */
  function rockarmor(ac, out, t, R) { var k = R(0.92, 1.08);
    rumble(ac, out, t, 0.6, 160, 0.7, 0.08);
    crackles(ac, out, t, 0.4, 26, 0.9, { fLo: 250, fHi: 1300, q: 2.5, dMin: 0.02, dMax: 0.06, bias: 0.9, spread: 0.8 });   // 岩石聚攏摩擦
    var ti = t + 0.42;
    boom(ac, out, ti, 140 * k, 60, 0.18, 0.6);
    ring(ac, out, ti, 480 * k, [[1, 0.7], [1.9, 0.5, 1.4], [3.1, 0.3, 2]], 0.1, 0.5);   // 岩甲合上「喀」
    burstNoise(ac, out, ti, 'bandpass', 900, 1.5, 0.001, 0.6, 0.06);
  }
  function rockSpike(ac, out, t, R) { var k = R(0.92, 1.08);
    rumble(ac, out, t, 0.25, 200, 0.5, 0.15);                                       // 地底預兆
    var ti = t + 0.12;
    boom(ac, out, ti, 160 * k, 50, 0.3, 0.8);
    burstNoise(ac, out, ti, 'highpass', 1500, 0.7, 0.0006, 0.8, 0.06, 3);            // 破土「喀啦」
    crackles(ac, out, ti, 0.35, 20, 0.8, { fLo: 300, fHi: 2200, q: 2, dMin: 0.015, dMax: 0.05, bias: 1.6, spread: 0.7 });
    ring(ac, out, ti, 380 * k, [[1, 0.6], [2.1, 0.4, 1.5]], 0.12, 0.4);
  }
  function gravityBurst(ac, out, t, R) { var k = R(0.95, 1.05);
    var lp = filt(ac, 'lowpass', 200, 1); sweep(lp.frequency, t, [[0, 200], [0.45, 1200]]);
    chain(noise(ac, t, 0.5), lp, rampGain(ac, t, [[0, 0.0001], [0.45, 0.7], [0.47, 0.0001, 1]]), out);   // 空間被吸入
    var ti = t + 0.46;
    boom(ac, out, ti, 60 * k, 22, 1.2, 1.0);
    var o = osc(ac, 'sawtooth', ti, 1.25); sweep(o.frequency, ti, [[0, 55 * k], [1.1, 30 * k]]);
    chain(o, filt(ac, 'lowpass', 300), shaper(ac, 3), env(ac, ti, 0.01, 0.35, 1.1), out);               // 重力嗡鳴
    rumble(ac, out, ti, 1.3, 120, 0.7);
  }
  function petrify(ac, out, t, R) { var k = R(0.92, 1.08);
    crackles(ac, out, t, 0.5, 34, 0.7, { fLo: 1500, fHi: 5000, q: 2.5, dMin: 0.004, dMax: 0.012, bias: 0.8, rise: true });   // 龜裂聲越來越密
    rumble(ac, out, t, 0.6, 250, 0.35, 0.3);
    var ti = t + 0.5;
    boom(ac, out, ti, 130 * k, 60, 0.2, 0.6);
    ring(ac, out, ti, 520 * k, [[1, 0.6], [1.7, 0.5, 1.4], [2.9, 0.3, 2]], 0.12, 0.5);   // 凝固「喀」
  }
  function mire(ac, out, t, R) { var k = R(0.9, 1.1);
    squelch(ac, out, t, k, 1.0, 900, 250, 0.15);                                   // 泥漿濺開
    burstNoise(ac, out, t, 'lowpass', 700, 1, 0.005, 0.6, 0.2);
    boom(ac, out, t, 90 * k, 45, 0.2, 0.4);
    rumble(ac, out, t, 1.2, 180, 0.3, 0.1);
    for (var i = 0; i < 9; i++) {
      var tt = t + 0.15 + Math.random() * 1.0;
      bubble(ac, out, tt, (110 + Math.random() * 180) * k, 0.07 + Math.random() * 0.06, 0.45 * (1 - (tt - t) / 1.4), Math.random() * 0.8 - 0.4);   // 咕嚕
      squelch(ac, out, tt, k, 0.12, 700, 300, 0.05);
    }
  }
  function earthguard(ac, out, t, R) { var k = R(0.98, 1.02);
    boom(ac, out, t, 110, 70, 0.6, 0.35);
    chord(ac, out, t, [220 * k, 277 * k, 330 * k, 440 * k], 0.12, 1.3, 0.1);       // 溫暖和弦
    whoosh(ac, out, t, 0.8, { f0: 300, f1: 2500, f2: 4000, q: 0.9, peak: 0.18, peakAt: 0.6 });
    tinkles(ac, out, t + 0.3, 0.9, 12, 0.08, 1500, 4500);
  }
  function lightPillar(ac, out, t, R) { var k = R(0.97, 1.03);
    whoosh(ac, out, t, 0.25, { f0: 6000, f1: 2500, f2: 600, q: 0.9, peak: 0.5, peakAt: 0.3 });   // 光柱降下
    boom(ac, out, t + 0.18, 200, 80, 0.4, 0.4);
    chord(ac, out, t + 0.18, [659 * k, 988 * k, 1319 * k, 1976 * k], 0.01, 1.2, 0.1);
    tinkles(ac, out, t + 0.2, 0.7, 16, 0.1, 2500, 7000);
  }

  /* ═════════ 雷 ═════════ */
  function chainLightning(ac, out, t, R) { var k = R(0.9, 1.1);
    thunderCrack(ac, out, t, 0.7);
    arcCrackle(ac, out, t, 0.22, 0.55);
    var bp = filt(ac, 'bandpass', 3000 * k, 1.2); sweep(bp.frequency, t, [[0, 5000 * k], [0.2, 2000 * k]]);
    chain(noise(ac, t, 0.25), bp, env(ac, t, 0.003, 0.4, 0.2), out);              // 電流竄過的嘶聲
  }
  function thunderstrike(ac, out, t, R) { var k = R(0.9, 1.1);   // 第 1 輪雷球 A 去掉「電流亂竄」那一層
    thunderCrack(ac, out, t);
    arcCrackle(ac, out, t, 0.55, 0.35);
    thunderRumble(ac, out, t);
    boom(ac, out, t, 90 * k, 40, 0.45, 0.6);
  }
  function thunderOrb(ac, out, t) { arcCrackle(ac, out, t, 0.55, 0.35); }   // 使用者指定的電流聲
  function thunderCurtain(ac, out, t, R, dur) { dur = dur || 3;
    var gate = ac.createGain(); stutter(gate.gain, t, dur, 0.6, 0.006, 0.024, false);
    chain(noise(ac, t, dur + 0.05), filt(ac, 'highpass', 2800), gate, gain(ac, 0.35), loopEnv(ac, t, dur), out);
    var o = osc(ac, 'sawtooth', t, dur + 0.05); flutter(o.frequency, t, dur, 95, 105, 0.05, 0.1);
    chain(o, filt(ac, 'bandpass', 800, 1.5), gain(ac, 0.15), loopEnv(ac, t, dur), out);                // 電幕嗡鳴
    for (var i = 0; i < Math.round(dur * 2.5); i++) thunderCrack(ac, out, t + 0.2 + Math.random() * (dur - 0.6), 0.3 + Math.random() * 0.3);   // 偶發霹靂
  }
  function flyingThunder(ac, out, t, R, dur) { dur = dur || 3;
    var gate = ac.createGain(); stutter(gate.gain, t, dur, 0.75, 0.004, 0.016, false);
    chain(noise(ac, t, dur + 0.05), filt(ac, 'highpass', 3200), gate, gain(ac, 0.3), loopEnv(ac, t, dur), out);
    var o = osc(ac, 'sawtooth', t, dur + 0.05), o2 = osc(ac, 'square', t, dur + 0.05);
    flutter(o.frequency, t, dur, 150, 175, 0.03, 0.06); flutter(o2.frequency, t, dur, 300, 340, 0.03, 0.06);
    var m = gain(ac, 0.5); o.connect(m); o2.connect(m);
    chain(m, filt(ac, 'bandpass', 1400, 1.2), shaper(ac, 3), gain(ac, 0.12), loopEnv(ac, t, dur), out);   // 雷光束高頻嗡鳴
  }
  function thunderfallFly(ac, out, t, R, dur) { dur = dur || 1;
    var gate = ac.createGain(); stutter(gate.gain, t, dur, 0.6, 0.006, 0.02, false);
    chain(noise(ac, t, dur + 0.05), filt(ac, 'highpass', 2500), gate, rampGain(ac, t, [[0, 0.0001], [dur, 0.5], [dur + 0.03, 0.0001, 1]]), out);   // 電流越來越密
    var o = osc(ac, 'sawtooth', t, dur + 0.05); sweep(o.frequency, t, [[0, 60], [dur, 180]]);
    chain(o, filt(ac, 'lowpass', 900), shaper(ac, 3), rampGain(ac, t, [[0, 0.0001], [dur, 0.3], [dur + 0.03, 0.0001, 1]]), out);               // 嗡鳴升高
    var lp = filt(ac, 'lowpass', 300, 1); sweep(lp.frequency, t, [[0, 250], [dur, 1200]]);
    chain(bnoise(ac, t, dur + 0.1), lp, rampGain(ac, t, [[0, 0.0001], [dur, 0.6], [dur + 0.05, 0.0001, 1]]), out);                              // 下墜氣流
  }
  function thunderfallImpact(ac, out, t, R) { var k = R(0.92, 1.08);
    thunderCrack(ac, out, t, 1.0);
    boom(ac, out, t, 70 * k, 25, 1.0, 1.0);
    arcCrackle(ac, out, t, 0.9, 0.5);
    thunderRumble(ac, out, t, 1.8, 1.4);
    crackles(ac, out, t, 0.6, 20, 0.7, { fLo: 3000, fHi: 7000, q: 2, dMin: 0.004, dMax: 0.012, bias: 1.5, spread: 0.9 });
  }

  /* ═════════ 冰 ═════════ */
  function icearrow(ac, out, t, R) { var k = R(0.92, 1.1);
    burstNoise(ac, out, t, 'highpass', 3500, 0.7, 0.0005, 0.8, 0.03, 2);                     // 冰碎「喀」
    ring(ac, out, t, 2600 * k, [[1, 0.5], [1.73, 0.4, 1.3], [2.91, 0.3, 1.8]], 0.25, 0.18);
    tinkles(ac, out, t + 0.005, 0.25, 10, 0.18, 3000, 8000);
    chain(noise(ac, t, 0.35), filt(ac, 'bandpass', 6000, 1), env(ac, t, 0.01, 0.15, 0.3), out);   // 寒氣
    ring(ac, out, t, 200 * k, [[1, 0.6]], 0.06, 0.4);
  }
  function iceCrystalBurst(ac, out, t, R) { var k = R(0.92, 1.08);
    boom(ac, out, t, 140 * k, 60, 0.25, 0.5);
    burstNoise(ac, out, t, 'highpass', 2500, 0.7, 0.0005, 1.0, 0.08, 3);
    burstNoise(ac, out, t, 'bandpass', 4500, 0.8, 0.001, 0.6, 0.35);                         // 玻璃崩落
    tinkles(ac, out, t, 0.6, 32, 0.22, 2500, 9000);
    ring(ac, out, t + 0.02, 1800 * k, [[1, 0.3], [1.5, 0.25, 1.2], [2.24, 0.2, 1.5]], 0.9, 0.12);
  }
  function waterball(ac, out, t, R) { var k = R(0.9, 1.1);
    boom(ac, out, t, 130 * k, 70, 0.12, 0.4);
    var bp = filt(ac, 'bandpass', 900, 1); sweep(bp.frequency, t, [[0, 700 * k], [0.04, 2600 * k], [0.35, 700 * k]]);
    var fl = ac.createGain(); flutter(fl.gain, t, 0.4, 0.5, 1, 0.01, 0.03);
    chain(noise(ac, t, 0.45), bp, fl, env(ac, t, 0.004, 0.9, 0.38), out);                   // 「嘩」
    for (var i = 0; i < 7; i++) bubble(ac, out, t + 0.03 + Math.random() * 0.35, (500 + Math.random() * 1300) * k, 0.03 + Math.random() * 0.04, 0.2, Math.random() * 1.2 - 0.6);   // 水花
  }
  function abyssVortex(ac, out, t, R) {   // 海淵葬界領域每拍：水被往下捲的「咻嚕——」（2026-11-08 使用者從第 2 輪候選選定）
    var k = R(0.94, 1.06), len = 0.45;
    var bp = filt(ac, 'bandpass', 1500, 2.5); sweep(bp.frequency, t, [[0, 2200 * k], [len, 350 * k]]);
    var fl = ac.createGain(); flutter(fl.gain, t, len, 0.4, 1, 0.015, 0.04);
    var p = ac.createStereoPanner(), lfo = osc(ac, 'sine', t, len + 0.05); lfo.frequency.value = 3; chain(lfo, gain(ac, 0.6), p.pan);   // 水流繞一圈
    chain(noise(ac, t, len + 0.05), bp, fl, rampGain(ac, t, [[0, 0.0001], [0.06, 0.7], [len, 0.0001]]), p, out);
    for (var i = 0; i < 5; i++) bubble(ac, out, t + 0.1 + i * 0.06 + Math.random() * 0.03, (420 - i * 45) * k, 0.05, 0.18, Math.random() * 0.8 - 0.4);   // 咕嚕
  }
  function waterTornado(ac, out, t, R, dur) { dur = dur || 3;
    var bp = filt(ac, 'bandpass', 800, 1.2); flutter(bp.frequency, t, dur, 450, 1500, 0.06, 0.15);
    var p = ac.createStereoPanner(), lfo = osc(ac, 'sine', t, dur + 0.05); lfo.frequency.value = 0.8; chain(lfo, gain(ac, 0.6), p.pan);
    chain(noise(ac, t, dur + 0.05), bp, loopEnv(ac, t, dur, 0.6), p, out);                  // 水流旋轉
    flame(ac, out, t, { dur: dur, attack: 0.25, peak: 0.6, decay: 0.4, cutLo: 150, cutHi: 350, rate: [0.06, 0.14], flick: [0.5, 1] });   // 低沉水勢
    for (var i = 0; i < Math.round(dur * 8); i++) bubble(ac, out, t + 0.2 + Math.random() * (dur - 0.6), 200 + Math.random() * 400, 0.04 + Math.random() * 0.05, 0.2, Math.random() * 1.2 - 0.6);
  }
  function tideColumn(ac, out, t, R) { var k = R(0.95, 1.05);
    var lp = filt(ac, 'lowpass', 300, 0.8); sweep(lp.frequency, t, [[0, 300], [0.6, 3000]]);
    chain(noise(ac, t, 0.7), lp, rampGain(ac, t, [[0, 0.0001], [0.6, 0.6], [0.65, 0.2, 1]]), out);   // 海浪湧起
    var ti = t + 0.62;
    boom(ac, out, ti, 80 * k, 35, 0.7, 0.9);
    burstNoise(ac, out, ti, 'lowpass', 5000, 0.5, 0.005, 1.0, 1.4);                           // 轟然拍下
    var fl = ac.createGain(); flutter(fl.gain, ti, 1.2, 0.4, 1, 0.02, 0.05);
    chain(noise(ac, ti, 1.3), filt(ac, 'highpass', 3000), fl, env(ac, ti, 0.02, 0.3, 1.2), out);   // 浪花飛沫
    rumble(ac, out, ti, 1.5, 180, 0.7);
    for (var i = 0; i < 12; i++) bubble(ac, out, ti + 0.1 + Math.random() * 1.0, (300 + Math.random() * 900) * k, 0.04 + Math.random() * 0.05, 0.18, Math.random() * 1.4 - 0.7);
  }
  function frostnova(ac, out, t, R) { var k = R(0.92, 1.08);
    boom(ac, out, t, 120 * k, 50, 0.3, 0.6);
    var bp = filt(ac, 'bandpass', 3000, 1.2); sweep(bp.frequency, t, [[0, 4500 * k], [0.7, 900 * k]]);
    var fl = ac.createGain(); flutter(fl.gain, t, 0.8, 0.5, 1, 0.02, 0.05);
    chain(noise(ac, t, 0.85), bp, fl, env(ac, t, 0.01, 0.8, 0.75), out);                   // 寒氣向外擴散
    crackles(ac, out, t + 0.05, 0.5, 24, 0.6, { fLo: 3000, fHi: 8000, q: 3, dMin: 0.004, dMax: 0.012, bias: 0.7, rise: true });   // 結凍聲漸密
    tinkles(ac, out, t + 0.1, 0.6, 14, 0.12, 3000, 8000);
    burstNoise(ac, out, t + 0.55, 'highpass', 3000, 0.7, 0.0005, 0.6, 0.04, 3);            // 凍結「喀」
    ring(ac, out, t + 0.55, 2200 * k, [[1, 0.4], [1.6, 0.3, 1.3]], 0.3, 0.15);
  }
  function blizzard(ac, out, t, R, dur) { dur = dur || 3;
    var layers = [[300, 700, 6, 1.0, -0.4], [500, 1100, 8, 0.7, 0.4]];
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i], bp = filt(ac, 'bandpass', 500, L[2]); flutter(bp.frequency, t, dur, L[0], L[1], 0.15, 0.35);
      var fl = ac.createGain(); flutter(fl.gain, t, dur, 0.4, 1, 0.1, 0.3);
      chain(noise(ac, t, dur + 0.05), bp, fl, gain(ac, L[3]), loopEnv(ac, t, dur), pan(ac, L[4]), out);   // 風在「嗚——」
    }
    var fl2 = ac.createGain(); flutter(fl2.gain, t, dur, 0.3, 1, 0.05, 0.15);
    chain(noise(ac, t, dur + 0.05), filt(ac, 'highpass', 5000), fl2, loopEnv(ac, t, dur, 0.12), out);      // 冰雪顆粒沙沙
    tinkles(ac, out, t + 0.2, dur - 0.6, Math.round(dur * 4), 0.05, 3000, 8000);
  }
  function iceSpike(ac, out, t, R) { var k = R(0.92, 1.08);
    boom(ac, out, t, 150 * k, 60, 0.2, 0.6);
    burstNoise(ac, out, t, 'highpass', 2000, 0.7, 0.0005, 0.9, 0.06, 3);                    // 冰刺破地
    crackles(ac, out, t, 0.15, 14, 0.7, { fLo: 2000, fHi: 6000, q: 3, dMin: 0.005, dMax: 0.02, bias: 1.5 });
    ring(ac, out, t, 1500 * k, [[1, 0.4], [1.41, 0.3, 1.2], [2.3, 0.25, 1.6]], 0.4, 0.15);
    tinkles(ac, out, t + 0.03, 0.35, 10, 0.15);
  }

  /* ═════════ 風 ═════════ */
  // 刀風：低沉「呼」＋高頻「咻」兩層，音量在砍中前一刻到頂
  function bladeSwish(ac, out, t, len, k) {
    whoosh(ac, out, t, len, { f0: 500 * k, f1: 1600 * k, f2: 700 * k, q: 1.5, peak: 0.42, p0: -0.6, p1: 0.5, peakAt: 0.75 });
    whoosh(ac, out, t, len, { f0: 2000 * k, f1: 6500 * k, f2: 3500 * k, q: 3.5, peak: 0.7, p0: -0.6, p1: 0.5, peakAt: 0.78 });
  }
  // 砍中：脆裂瞬音＋木質／肉質共振＋纖維斷裂＋汁液
  function chopImpact(ac, out, ti, k, o) {
    var body = opt(o, 'body', 1), wet = opt(o, 'wet', 0.6), fiber = opt(o, 'fiber', 0.8), f = opt(o, 'f', 210), dec = opt(o, 'dec', 0.11);
    burstNoise(ac, out, ti, 'bandpass', 2800 * k, 0.9, 0.0004, 1.0 * body, 0.025, 2);                                  // 「喀」
    ring(ac, out, ti, f * k, [[1, 0.9], [2.27, 0.6, 1.5], [3.6, 0.45, 2.2], [5.3, 0.3, 3]], dec, 0.55 * body);          // 共振「篤」
    crackles(ac, out, ti + 0.004, 0.05, 18, 0.8 * fiber, { fLo: 1800, fHi: 5500, q: 2, dMin: 0.003, dMax: 0.008, bias: 1.2, spread: 0.3 });   // 纖維
    squelch(ac, out, ti + 0.008, k, wet, 2600, 1000, 0.06);                                                            // 汁液
  }
  function windblade(ac, out, t, R) { var k = R(0.92, 1.1), len = 0.2, ti = t + len * 0.8;   // 砍芭蕉樹
    bladeSwish(ac, out, t, len, k);
    chopImpact(ac, out, ti, k);
    whoosh(ac, out, ti, 0.35, { f0: 1800, f1: 900, f2: 400, q: 0.8, peak: 0.2, peakAt: 0.15 });   // 刀風餘勁
  }
  function windbladeFlesh(ac, out, t, R) { var k = R(0.92, 1.1), len = 0.2, ti = t + len * 0.8;   // 砍肉
    bladeSwish(ac, out, t, len, k);
    chopImpact(ac, out, ti, k, { body: 1.2, wet: 1.1, fiber: 0.25, f: 150, dec: 0.08 });
    whoosh(ac, out, ti, 0.35, { f0: 1800, f1: 900, f2: 400, q: 0.8, peak: 0.2, peakAt: 0.15 });
  }
  function windBurst(ac, out, t, R) { var k = R(0.9, 1.1);
    boom(ac, out, t, 100 * k, 50, 0.25, 0.5);
    whoosh(ac, out, t, 0.6, { f0: 2500 * k, f1: 1500 * k, f2: 350 * k, q: 0.7, peak: 0.9, peakAt: 0.06 });
    whoosh(ac, out, t, 0.5, { f0: 600, f1: 400, f2: 200, q: 1, peak: 0.5, white: false, peakAt: 0.1 });
  }
  function vacuumslash(ac, out, t, R) { var k = R(0.92, 1.1);
    var lp = filt(ac, 'lowpass', 300, 1.5); sweep(lp.frequency, t, [[0, 200], [0.12, 900]]);
    chain(noise(ac, t, 0.15), lp, rampGain(ac, t, [[0, 0.0001], [0.12, 0.5], [0.13, 0.0001, 1]]), out);   // 空氣被抽走
    var ti = t + 0.12;
    whoosh(ac, out, ti, 0.25, { f0: 1500 * k, f1: 7500 * k, f2: 3000 * k, q: 6, peak: 0.9, p0: -0.6, p1: 0.6, peakAt: 0.2 });   // 銳利真空刃
    ring(ac, out, ti + 0.03, 3300 * k, [[1, 0.4], [1.5, 0.2, 1.3]], 0.3, 0.12);
    boom(ac, out, ti, 110 * k, 45, 0.2, 0.6);
    burstNoise(ac, out, ti, 'highpass', 3000, 0.7, 0.0005, 0.7, 0.03, 2);
  }
  function vacuumShockwave(ac, out, t, R) { var k = R(0.95, 1.05);
    var lp = filt(ac, 'lowpass', 200, 1.5); sweep(lp.frequency, t, [[0, 150], [0.35, 2500]]);
    chain(noise(ac, t, 0.4), lp, rampGain(ac, t, [[0, 0.0001], [0.35, 0.7], [0.36, 0.0001, 1]]), out);   // 吸入
    var ti = t + 0.36;
    boom(ac, out, ti, 80 * k, 30, 0.6, 1.0);
    burstNoise(ac, out, ti, 'lowpass', 3000, 0.7, 0.001, 0.8, 0.15, 3);                                 // 爆開
    whoosh(ac, out, ti, 0.7, { f0: 2500, f1: 1200, f2: 300, q: 0.7, peak: 0.6, peakAt: 0.05 });
  }
  function voidDisc(ac, out, t, R, dur) { dur = dur || 3;
    var o = osc(ac, 'sawtooth', t, dur + 0.05); o.frequency.value = 85;
    chain(o, filt(ac, 'bandpass', 500, 2), gain(ac, 0.3), loopEnv(ac, t, dur), out);                   // 圓盤嗡鳴
    var am = gain(ac, 0.5), lfo = osc(ac, 'sine', t, dur + 0.05); lfo.frequency.value = 9; chain(lfo, gain(ac, 0.5), am.gain);
    var p = ac.createStereoPanner(), plfo = osc(ac, 'sine', t, dur + 0.05); plfo.frequency.value = 1.2; chain(plfo, gain(ac, 0.5), p.pan);
    chain(noise(ac, t, dur + 0.05), filt(ac, 'bandpass', 2500, 2.5), am, loopEnv(ac, t, dur, 0.8), p, out);   // 每圈一次破風
  }
  function stormBarrier(ac, out, t, R, dur) { dur = dur || 3;
    var layers = [[250, 600, 4, 0.9, -0.3], [400, 900, 5, 0.7, 0.3]];
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i], bp = filt(ac, 'bandpass', 400, L[2]); flutter(bp.frequency, t, dur, L[0], L[1], 0.12, 0.3);
      var fl = ac.createGain(); flutter(fl.gain, t, dur, 0.5, 1, 0.08, 0.2);
      chain(noise(ac, t, dur + 0.05), bp, fl, gain(ac, L[3]), loopEnv(ac, t, dur), pan(ac, L[4]), out);   // 風嘯
    }
    for (var tt = t + 0.15, n = 0; tt < t + dur - 0.4; tt += 0.32 + Math.random() * 0.08, n++)              // 環繞呼呼聲
      whoosh(ac, out, tt, 0.35, { f0: 400, f1: 1400, f2: 500, q: 1.2, peak: 0.35, p0: n % 2 ? 0.7 : -0.7, p1: n % 2 ? -0.7 : 0.7, peakAt: 0.5 });
    chain(bnoise(ac, t, dur + 0.05), filt(ac, 'lowpass', 200), loopEnv(ac, t, dur, 0.5), out);
  }
  function stormRip(ac, out, t, R) { var k = R(0.92, 1.08);
    whoosh(ac, out, t, 0.6, { f0: 800 * k, f1: 4000 * k, f2: 1200 * k, q: 1.2, peak: 0.8, peakAt: 0.25, p0: -0.5, p1: 0.5 });
    crackles(ac, out, t + 0.1, 0.4, 30, 0.6, { fLo: 600, fHi: 3000, q: 1.5, dMin: 0.005, dMax: 0.02, bias: 1 });   // 撕裂
    boom(ac, out, t + 0.12, 120 * k, 50, 0.25, 0.5);
  }

  /* ═════════ 登記表（Skills2 音效欄填的就是這裡的 id） ═════════ */
  /* 2026-11-10 使用者要求音效整體縮成 65%；本來就很小聲的（反擊、突刺、深淵漩渦）維持 level 1 不縮 */
  var LEVEL = 0.65;
  function d(fn, gainV, extra) { var o = { fn: fn, kind: 'oneshot', gain: gainV, level: LEVEL }; for (var k in extra) o[k] = extra[k]; return o; }
  var LOOP = { kind: 'loop' }, FLIGHT = { kind: 'flight' }, KEEP = { level: 1 };
  var RECIPES = {
    // 物理
    'knife':              d(knife, 1.8),
    'thrust':             d(thrust, 0.52, KEEP),
    'cleave':             d(cleave, 1.1),
    'gale':               d(gale, 0.65),
    'bloodblade':         d(bloodblade, 1.15),
    'poison-drop':        d(poisonDrop, 1.4),
    'blood-burst':        d(bloodBurst, 1.4),
    'dualdance':          d(dualdance, 2.0, { minGapMs: 450 }),      // 一則事件就是四連斬，連續事件不疊播
    'counter':            d(counter, 1.9, KEEP),     // 2026-11-08 使用者要求比原本大聲 50%
    'holy-burst':         d(holyBurst, 1),
    'bloodrage':          d(bloodrage, 0.75, { minGapMs: 300 }),     // 狂怒期間每次普攻都爆一次，高攻速不連環重拳
    // 火
    'fireball':           d(fireball, 0.7),
    'meteor-fly':         d(meteorFly, 1, FLIGHT),
    'meteor-impact':      d(meteorImpact, 0.9),
    'starfall-fly':       d(starfallFly, 1.1, FLIGHT),
    'starfall-impact':    d(starfallImpact, 0.9),
    'dragon-devour':      d(dragonDevour, 0.75),
    'fire-shockwave':     d(fireShockwave, 1),
    'firepillar':         d(fireTornado, 0.85, LOOP),        // 不叫 fire-tornado：那是 VFX Preset 的名字，表上會混淆
    'lava-pool':          d(lavaPool, 0.4, LOOP),
    'firehunt':           d(firehunt, 1.4),
    'solar-ring-fly':     d(solarRingFly, 1.6, FLIGHT),
    // 土
    'rockarmor':          d(rockarmor, 1),
    'rock-spike':         d(rockSpike, 1),
    'gravity-burst':      d(gravityBurst, 0.75),
    'petrify':            d(petrify, 1.1),
    'mire':               d(mire, 1.5, { retrigger: true, minGapMs: 600 }),   // 沼澤是場域，每拍作用都響（敵人身上的毒才是 debuff）
    'earthguard':         d(earthguard, 1.1),
    'light-pillar':       d(lightPillar, 1),
    // 雷
    'chain-lightning':    d(chainLightning, 0.55),
    'flying-thunder':     d(flyingThunder, 0.5, LOOP),
    'thunderstrike':      d(thunderstrike, 0.85),
    'thunder-curtain':    d(thunderCurtain, 0.55, LOOP),
    'thunder-orb':        d(thunderOrb, 1, { retrigger: true, minGapMs: 450 }),   // 雷球每次放電都劈啪一下（場域定時作用，不是中毒那類狀態每跳）
    'thunderfall-fly':    d(thunderfallFly, 0.7, FLIGHT),
    'thunderfall-impact': d(thunderfallImpact, 0.75),
    // 冰
    'icearrow':           d(icearrow, 2.0),
    'ice-crystal-burst':  d(iceCrystalBurst, 1.6),
    'waterball':          d(waterball, 1.6),
    'water-tornado':      d(waterTornado, 0.7, LOOP),
    'tide-column':        d(tideColumn, 0.95),
    'abyss-vortex':       d(abyssVortex, 1.73, KEEP),       // 領域每拍都響，刻意比水流彈命中小聲約三成
    'frostnova':          d(frostnova, 1.3),
    'blizzard':           d(blizzard, 1.1, LOOP),
    'ice-spike':          d(iceSpike, 2.0),
    // 風
    'windblade':          d(windblade, 1.4),
    'windblade-flesh':    d(windbladeFlesh, 1.4),
    'wind-burst':         d(windBurst, 1.5),
    'vacuumslash':        d(vacuumslash, 1),
    'vacuum-shockwave':   d(vacuumShockwave, 0.8),
    'void-disc':          d(voidDisc, 0.95, LOOP),
    'storm-barrier':      d(stormBarrier, 0.65, { kind: 'loop', castSec: 4 }),
    'storm-rip':          d(stormRip, 0.85, { retrigger: true, minGapMs: 800 })   // 屏障每次作用都響
  };

  /* ═════════ 離線渲染 ═════════ */
  var LOOP_SEC = 4, LOOP_XFADE = 0.4, LOOP_PREROLL = 0.5;
  function masterChain(ac, g) {
    var in1 = ac.createGain(); in1.gain.value = g;
    var c = ac.createDynamicsCompressor();
    c.threshold.value = -10; c.knee.value = 6; c.ratio.value = 4; c.attack.value = 0.002; c.release.value = 0.15;
    in1.connect(c); c.connect(ac.destination);
    return in1;
  }
  function trimTail(buf, ctxFactory) {
    var L = buf.getChannelData(0), Rr = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, end = L.length - 1;
    while (end > 0 && Math.abs(L[end]) < 0.0005 && Math.abs(Rr[end]) < 0.0005) end--;
    var len = Math.max(1, end + 1), out = ctxFactory(len);
    for (var ch = 0; ch < buf.numberOfChannels; ch++) out.getChannelData(ch).set(buf.getChannelData(ch).subarray(0, len));
    return out;
  }
  /* 循環：取持續段 LOOP_SEC 秒，開頭 LOOP_XFADE 秒與尾巴交叉淡化，首尾相接沒有斷點 */
  function makeLoop(buf, ctxFactory) {
    var sr = buf.sampleRate, s0 = Math.round(LOOP_PREROLL * sr), T = Math.round(LOOP_SEC * sr), X = Math.round(LOOP_XFADE * sr);
    var out = ctxFactory(T);
    for (var ch = 0; ch < buf.numberOfChannels; ch++) {
      var a = buf.getChannelData(ch), o = out.getChannelData(ch);
      for (var i = 0; i < T; i++) {
        var v = a[s0 + i];
        if (i < X) { var w = i / X; v = v * w + a[s0 + T + i] * (1 - w); }
        o[i] = v;
      }
    }
    return out;
  }
  /* render(id, { dur, OfflineCtx }) → Promise<AudioBuffer>
     oneshot：整段（去掉尾端靜音）；flight：長度＝dur；loop：可直接 loop=true 播放的循環段 */
  function render(id, o) {
    var def = RECIPES[id], OAC = o && o.OfflineCtx;
    if (!def || !OAC) return Promise.reject(new Error('sfx synth unavailable: ' + id));
    var kind = def.kind, dur = Math.max(0.1, Number(o && o.dur) || 0), seconds;
    if (kind === 'loop') { dur = LOOP_PREROLL + LOOP_SEC + LOOP_XFADE + 0.7; seconds = dur + 0.1; }
    else if (kind === 'flight') seconds = dur + 0.4;
    else seconds = def.maxSec || 3.4;
    var ac = new OAC(2, Math.ceil(seconds * SR), SR);
    var R = function (a, b) { return a + Math.random() * (b - a); };
    flatHold = kind === 'loop';
    try { def.fn(ac, masterChain(ac, def.gain || 1), 0, R, kind === 'oneshot' ? undefined : dur); }
    finally { flatHold = false; }
    return ac.startRendering().then(function (buf) {
      var make = function (len) { return ac.createBuffer(buf.numberOfChannels, len, buf.sampleRate); };
      return kind === 'loop' ? makeLoop(buf, make) : trimTail(buf, make);
    });
  }

  return {
    recipes: RECIPES,
    ids: function () { return Object.keys(RECIPES); },
    def: function (id) { return RECIPES[id] || null; },
    render: render
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SfxSynth;
