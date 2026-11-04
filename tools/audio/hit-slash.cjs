'use strict';
// 原創程序音效：普攻命中用的三個斬擊／劍擊音。固定亂數、噪音＋掃頻濾波＋金屬泛音；不引用外部錄音或音色庫。
// 音色方向參考 RPG Maker 的 Slash2／Slash10／Sword4（只聽感參考，沒有取用任何取樣或波形）。
// 產生待試聽 WAV 到 audio/hit-preview（單聲道 16-bit 44.1kHz）。用法：node tools/audio/hit-slash.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const RATE = 44100, TAU = 2 * Math.PI;
const OUT = path.join(__dirname, '..', '..', 'audio', 'hit-preview');

function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2147483648 - 1; };
}
// 狀態變數帶通濾波，中心頻率可隨時間變
function bandNoise(buf, rng, at, dur, f0, f1, q, gain, attack, decay) {
  let low = 0, band = 0;
  const n = Math.round(dur * RATE), start = Math.round(at * RATE);
  for (let i = 0; i < n; i++) {
    const t = i / RATE, u = i / n;
    const fc = f0 * Math.pow(f1 / f0, u);
    const f = 2 * Math.sin(Math.PI * fc / RATE);
    const x = rng();
    low += f * band;
    const high = x - low - band / q;
    band += f * high;
    const env = Math.min(1, t / attack) * Math.exp(-decay * t);
    if (start + i < buf.length) buf[start + i] += band * gain * env;
  }
}
function highNoise(buf, rng, at, dur, cutoff, gain, decay) {
  let prev = 0, prevOut = 0;
  const a = Math.exp(-TAU * cutoff / RATE);
  const n = Math.round(dur * RATE), start = Math.round(at * RATE);
  for (let i = 0; i < n; i++) {
    const x = rng();
    prevOut = a * (prevOut + x - prev); prev = x;
    if (start + i < buf.length) buf[start + i] += prevOut * gain * Math.exp(-decay * i / RATE) * Math.min(1, i / (RATE * 0.0008));
  }
}
function ring(buf, at, freq, partials, gain, decay) {
  const start = Math.round(at * RATE), n = buf.length - start;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = 0;
    partials.forEach(([ratio, amp, dec]) => { v += amp * Math.sin(TAU * freq * ratio * t) * Math.exp(-(decay * (dec || 1)) * t); });
    buf[start + i] += v * gain * Math.min(1, t / 0.0006);
  }
}
function thump(buf, at, f0, f1, dur, gain, decay) {
  const start = Math.round(at * RATE), n = Math.round(dur * RATE);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, f = f0 * Math.pow(f1 / f0, i / n);
    ph += TAU * f / RATE;
    buf[start + i] += Math.sin(ph) * gain * Math.exp(-decay * t) * Math.min(1, t / 0.001);
  }
}
function finish(buf, peak) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  const k = peak / (max || 1);
  const fade = Math.round(0.02 * RATE);
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let v = buf[i] * k;
    const tail = buf.length - i;
    if (tail < fade) v *= tail / fade;
    out[i] = Math.max(-32767, Math.min(32767, Math.round(Math.tanh(v * 1.1) / Math.tanh(1.1) * 32767)));
  }
  return out;
}
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// 折線插值：points = [[t, v], ...]；mode 'log' 用對數內插（頻率），'lin' 用線性（音量）
function curve(points, t, mode) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i][0]) {
      const [t0, v0] = points[i - 1], [t1, v1] = points[i];
      const u = (t - t0) / (t1 - t0 || 1);
      return mode === 'log' ? v0 * Math.pow(v1 / v0, u) : v0 + (v1 - v0) * u;
    }
  }
  return points[points.length - 1][1];
}
// 寬頻噪音過帶通，中心頻率與音量都依折線變化。
// 量測原聲的頻譜走向後（只取「哪個頻段何時有多少能量」這種聽感資料），自己重新合成。
function sweepNoise(buf, rng, at, dur, freqs, q, levels, gain) {
  let low = 0, band = 0;
  const n = Math.round(dur * RATE), start = Math.round(at * RATE);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = 2 * Math.sin(Math.PI * curve(freqs, t, 'log') / RATE);
    low += f * band;
    const high = rng() - low - band / q;
    band += f * high;
    if (start + i < buf.length) buf[start + i] += band * gain * curve(levels, t, 'lin');
  }
}

const SOUNDS = {
  // 斬擊A：約 0.2 秒的一道短揮（原本 0.4 秒，使用者要求縮短一半）。起手立刻就響，噪音從中高頻（約 3kHz）一路降到低頻（約 350Hz），音量大致持平，尾端快速收掉並留一記小短擊。
  'hit-slash-a': () => {
    const b = new Float64Array(Math.ceil(0.21 * RATE)), r = makeRng(0x51a5);
    sweepNoise(b, r, 0, 0.17, [[0, 3000], [0.04, 2000], [0.07, 1000], [0.10, 500], [0.13, 250], [0.17, 140]], 1.1,
      [[0, 0.45], [0.02, 1], [0.09, 0.9], [0.14, 1.3], [0.162, 1.1], [0.17, 0]], 1.0);
    thump(b, 0.11, 150, 55, 0.08, 0.5, 22);
    return finish(b, 0.63);
  },
  // 斬擊B：約 0.3 秒的短揮。先降到低頻，約 0.1 秒處再回升，形成「嗖——嗡」的一下起伏，之後乾脆收掉。
  'hit-slash-b': () => {
    const b = new Float64Array(Math.ceil(0.31 * RATE)), r = makeRng(0x5ca7);
    sweepNoise(b, r, 0, 0.24, [[0, 2700], [0.05, 2800], [0.08, 1800], [0.10, 520], [0.14, 780], [0.17, 1700], [0.20, 2700], [0.235, 2200]], 0.9,
      [[0, 0.8], [0.06, 1], [0.12, 0.7], [0.20, 0.8], [0.22, 0.5], [0.24, 0]], 1.0);
    return finish(b, 0.63);
  },
  // 劍擊：約 1 秒。0.1 秒內衝到最亮（約 5kHz 以上的高頻噪音），維持到 0.2 秒後快速掉下，只剩約 3kHz 的細長金屬餘響慢慢消失。
  'hit-sword': () => {
    const b = new Float64Array(Math.ceil(1.0 * RATE)), r = makeRng(0x5d04);
    sweepNoise(b, r, 0, 0.26, [[0, 3500], [0.06, 4900], [0.10, 5700], [0.16, 3700], [0.20, 4300], [0.26, 3900]], 0.9,
      [[0, 0.06], [0.04, 0.22], [0.08, 0.85], [0.10, 1], [0.18, 0.9], [0.21, 0.3], [0.23, 0.12], [0.26, 0]], 1.0);
    ring(b, 0.09, 2950, [[0.9, 0.5, 1], [1, 0.6, 0.9], [1.12, 0.4, 1.1], [0.78, 0.25, 1.3]], 0.30, 5.2);
    return finish(b, 0.63);
  }
};

fs.mkdirSync(OUT, { recursive: true });
const manifest = {};
Object.keys(SOUNDS).forEach(name => {
  const buf = wav(SOUNDS[name]());
  fs.writeFileSync(path.join(OUT, name + '.wav'), buf);
  manifest[name] = { bytes: buf.length, seconds: +((buf.length - 44) / 2 / RATE).toFixed(3), sha256: crypto.createHash('sha256').update(buf).digest('hex') };
});
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(manifest);
