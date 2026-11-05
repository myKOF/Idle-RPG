'use strict';
// 原創程序音樂／聲景；無外部取樣，固定種子可逐位元重產。
const fs = require('node:fs');
const path = require('node:path');
const { resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');
const RATE = 24000, SECONDS = 30, TAU = Math.PI * 2;
const folder = 'codex-authored/intro-dark-fantasy-20261105';

function render() {
  const music = new Float64Array(RATE * SECONDS), sfx = new Float64Array(music.length);
  function add(dst, at, dur, fn, amplitude) {
    const count = Math.round(dur * RATE), begin = Math.round(at * RATE);
    for (let n = 0; n < count && begin + n < dst.length; n++) {
      const t = n / RATE, edge = Math.min(1, t / .025, (dur - t) / .08);
      dst[begin + n] += fn(t, t / dur) * amplitude * Math.max(0, edge);
    }
  }
  function orchestra(at, dur, notes, level) {
    notes.forEach((f, j) => add(music, at, dur, (t, u) => {
      const vibrato = .003 * Math.sin(TAU * 4.3 * t);
      let tone = 0;
      for (let h = 1; h <= 5; h++) tone += Math.sin(TAU * (f * h * t + vibrato)) / (h * h);
      const bloom = Math.min(1, t / 1.4, (dur - t) / 1.5);
      return tone * Math.max(0, bloom) * (.8 + .2 * Math.sin(Math.PI * u));
    }, level / notes.length * (j ? .8 : 1)));
  }
  orchestra(0, 7, [82.4069, 123.4708, 164.8138, 195.9977], .28);
  orchestra(5.6, 7.7, [73.4162, 110, 146.8324, 174.6141], .31);
  orchestra(12.6, 9.2, [65.4064, 97.9989, 130.8128, 155.5635], .16);
  orchestra(20.7, 5.7, [82.4069, 123.4708, 164.8138, 195.9977], .25);
  orchestra(25.3, 4.7, [82.4069, 123.4708, 164.8138, 207.6523, 246.9417], .38);
  // 低鼓脈動；荒漠段留出安靜空間。
  [1.8, 3.8, 5.7, 7.8, 9.8, 11.8, 26, 27.8].forEach(at =>
    add(music, at, .65, t => Math.sin(TAU * (46 * t + 2.8 * (1 - Math.exp(-t * 25)))) * Math.exp(-t * 9), .22));
  function bell(at, f, amp) {
    [1, 2.01, 2.756, 4.07].forEach((ratio, i) =>
      add(sfx, at, 4.2, t => Math.sin(TAU * f * ratio * t) * Math.exp(-t * (1.15 + i * .5)), amp / (i + 1)));
  }
  bell(.65, 103.8262, .3); bell(3.6, 82.4069, .22);
  bell(21.7, 659.2551, .1); bell(26.2, 329.6276, .14);
  let seed = 0x20261105;
  function noise() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; }
  function wind(at, dur, level, decay) {
    let low = 0;
    add(sfx, at, dur, (t, u) => {
      low += (noise() - low) * .035;
      return low * (decay ? Math.exp(-t * decay) : Math.sin(Math.PI * u));
    }, level);
  }
  wind(1.7, 4.2, .55, .6); // 崩裂／雷鳴
  wind(6.05, 2.1, .9, 1.5); // 魔爪擊中
  wind(6.5, 6, .6, 0); // 墜落風壓
  wind(12.2, 3, 1.5, 1.9); // 落地及沙塵
  add(sfx, 12.2, 1.2, t => Math.sin(TAU * (38 * t + 2 * (1 - Math.exp(-t * 18)))) * Math.exp(-t * 4), .35);
  wind(13.1, 8, .2, 0);
  // 以共鳴泛音合成遠方悲鳴，不使用人聲樣本。
  add(sfx, 14.2, 4.5, (t, u) => Math.sin(TAU * (290 * t - 7 * t * t + .08 * Math.sin(t * 4))) * Math.sin(Math.PI * u), .035);
  add(sfx, 25.65, .55, t => (Math.sin(TAU * 1760 * t) + .35 * Math.sin(TAU * 2743 * t)) * Math.exp(-t * 8), .09);
  function wav(samples) {
    const b = Buffer.alloc(44 + samples.length * 2);
    b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28);
    b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
    samples.forEach((v, i) => {
      const t = i / RATE, fade = Math.max(0, Math.min(1, t / .1, (SECONDS - t) / 1));
      if (Math.abs(v) >= .95) throw new Error('音訊削波');
      b.writeInt16LE(Math.round(v * fade * 32767), 44 + i * 2);
    });
    return b;
  }
  return { 'prologue-music.wav': wav(music), 'prologue-sfx.wav': wav(sfx) };
}
if (require.main === module) {
  const mode = process.argv[2] || '--check';
  if (!['--apply', '--check'].includes(mode)) throw new Error('使用 --apply 或 --check');
  const lib = path.join(resolveLibraryRoot({}).root, folder, 'audio');
  if (mode === '--apply') fs.mkdirSync(lib, { recursive: true });
  for (const [name, data] of Object.entries(render())) {
    const file = path.join(lib, name);
    if (mode === '--apply') fs.writeFileSync(file, data);
    if (!data.equals(fs.readFileSync(file))) throw new Error('程序聲景與來源不同：' + name);
  }
  console.log('30秒原創配樂／聲景：確定性PCM核對通過');
}
module.exports = { render };
