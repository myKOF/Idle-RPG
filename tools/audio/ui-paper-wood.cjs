'use strict';
// 原創紙張／木質UI候選；獨立於正在使用的首版WAV，不改遊戲接線。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const RATE = 48000;
const GAME_REL = 'audio/ui-preview/paper-wood-v2';
const LIBRARY_REL = 'codex-authored/ui-paper-wood-preview-20261104';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const TAU = Math.PI * 2;

function noise(seed) {
  let state = seed >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2147483648 - 1; };
}
function lowpass(hz) {
  const alpha = 1 - Math.exp(-TAU * hz / RATE);
  let state = 0;
  return sample => { state += alpha * (sample - state); return state; };
}
function soften(samples, peak) {
  let dc = 0;
  for (const sample of samples) dc += sample;
  dc /= samples.length;
  let maximum = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (samples[i] - dc) * Math.min(1, i / (RATE * 0.002), (samples.length - 1 - i) / (RATE * 0.02));
    maximum = Math.max(maximum, Math.abs(samples[i]));
  }
  if (!maximum) throw new Error('Silent synthesis');
  return samples.map(sample => sample * peak / maximum);
}
function paper() {
  const samples = new Float64Array(Math.round(0.19 * RATE));
  const random = noise(202611041), upper = lowpass(3100), lower = lowpass(580), smooth = lowpass(3700);
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const band = upper(random());
    const fibers = band - lower(band);
    // 不均勻的短摩擦包絡，保留纖維顆粒；沒有音調、鈴聲或長尾回音。
    const swipes = 0.48 * Math.exp(-Math.pow((t - 0.027) / 0.019, 2)) +
      0.75 * Math.exp(-Math.pow((t - 0.065) / 0.027, 2)) +
      0.33 * Math.exp(-Math.pow((t - 0.105) / 0.022, 2));
    const grain = 0.78 + 0.14 * Math.sin(TAU * 43 * t) + 0.08 * Math.sin(TAU * 117 * t);
    samples[i] = smooth(fibers * swipes * grain);
  }
  return soften(samples, 0.045);
}
function wood() {
  const samples = new Float64Array(Math.round(0.17 * RATE));
  const random = noise(202611042), impact = lowpass(1250), body = lowpass(2000);
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    // 低中頻短促共鳴＋低通接觸噪音，快速阻尼；不使用舊版高頻晶體／金屬鈴。
    const knock = Math.sin(TAU * (270 * t - 180 * t * t)) * Math.exp(-78 * t) +
      0.28 * Math.sin(TAU * 430 * t) * Math.exp(-110 * t) +
      0.09 * Math.sin(TAU * 710 * t) * Math.exp(-160 * t);
    const contact = impact(random()) * Math.exp(-165 * t);
    const envelope = Math.min(1, t / 0.0018);
    samples[i] = body((knock + 0.55 * contact) * envelope);
  }
  return soften(samples, 0.11);
}
function wav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 4);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 4, 40);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.round(samples[i] * 32767);
    bytes.writeInt16LE(value, 44 + i * 4); bytes.writeInt16LE(value, 46 + i * 4);
  }
  return bytes;
}
function stats(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' ||
      bytes.readUInt32LE(24) !== RATE || bytes.readUInt16LE(22) !== 2 || bytes.readUInt16LE(34) !== 16 ||
      bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.readUInt32LE(40) !== bytes.length - 44) throw new Error('Invalid PCM WAV');
  let peak = 0, sum = 0;
  for (let i = 44; i < bytes.length; i += 2) {
    const sample = bytes.readInt16LE(i) / 32768;
    peak = Math.max(peak, Math.abs(sample)); sum += sample * sample;
  }
  if (peak < 0.01 || peak >= 0.95) throw new Error('Silent or clipped audio');
  if ([44, 46, bytes.length - 4, bytes.length - 2].some(i => bytes.readInt16LE(i) !== 0)) throw new Error('Audio edge is not silent');
  return { seconds: (bytes.length - 44) / (RATE * 4), peakDbFS: Number((20 * Math.log10(peak)).toFixed(2)),
    rmsDbFS: Number((10 * Math.log10(sum / ((bytes.length - 44) / 2))).toFixed(2)) };
}
function main() {
  const mode = process.argv[2] || '--check';
  if (!['--apply', '--check'].includes(mode)) throw new Error('Usage: ui-paper-wood.cjs [--apply|--check]');
  const target = path.join(REPO_ROOT, GAME_REL);
  const library = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, LIBRARY_REL);
  const parts = [{ file: 'paper-hover.wav', name: '輕微紙張摩擦觸碰', samples: paper() },
    { file: 'wood-click.wav', name: '較輕木質觸碰點擊', samples: wood() }];
  const lead = 0.3, gap = 0.42;
  const sequence = [0, 0, 0, 1, 1, 1], timeline = [];
  const frames = Math.round(RATE * lead) + sequence.reduce((n, i) => n + parts[i].samples.length + Math.round(RATE * gap), 0);
  const combined = new Float64Array(frames);
  let position = Math.round(RATE * lead);
  sequence.forEach(i => { timeline.push({ file: parts[i].file, atSeconds: Number((position / RATE).toFixed(3)) });
    combined.set(parts[i].samples, position); position += parts[i].samples.length + Math.round(RATE * gap); });
  parts.push({ file: 'comparison.wav', name: '紙張三次→木質三次', samples: combined });
  const clips = parts.map(part => ({ file: part.file, name: part.name, bytes: wav(part.samples) }));
  const originals = { '01-hover.wav': '411211856bdcc43ec4c1d534f29720eac208278872aa1fc71eb8e27dcd3b453c',
    '02-click.wav': 'c24a71c51bd241e59f8545b5c47fa3bd0dab6213fa84a619b17e27f6b4223608' };
  for (const [file, sha] of Object.entries(originals)) {
    if (hash(fs.readFileSync(path.join(REPO_ROOT, 'audio/ui-preview', file))) !== sha) throw new Error('Original changed: ' + file);
  }
  const manifest = { version: 2, status: 'preview-only-awaiting-user-review', sampleRate: RATE, channels: 2, bits: 16,
    origin: 'Original procedural filtered-noise paper friction and damped wooden impact; no external recordings, references or sample libraries.',
    source: 'tools/audio/ui-paper-wood.cjs', sourceSha256: hash(fs.readFileSync(__filename)), libraryRelativePath: LIBRARY_REL,
    unchangedOriginals: originals, timeline,
    files: clips.map(clip => ({ file: clip.file, name: clip.name, sha256: hash(clip.bytes), ...stats(clip.bytes) })) };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  if (mode === '--apply') {
    fs.mkdirSync(library, { recursive: true }); fs.mkdirSync(target, { recursive: true });
    for (const clip of clips) fs.writeFileSync(path.join(library, clip.file), clip.bytes);
    fs.copyFileSync(__filename, path.join(library, 'ui-paper-wood.cjs'));
    fs.copyFileSync(path.join(target, 'README.md'), path.join(library, 'README.md'));
    fs.writeFileSync(path.join(library, 'manifest.json'), manifestBytes);
    for (const file of [...clips.map(clip => clip.file), 'manifest.json']) fs.copyFileSync(path.join(library, file), path.join(target, file));
  }
  for (const dir of [library, target]) {
    for (const clip of clips) if (hash(fs.readFileSync(path.join(dir, clip.file))) !== hash(clip.bytes)) throw new Error('Audio mismatch: ' + dir + '/' + clip.file);
    if (hash(fs.readFileSync(path.join(dir, 'manifest.json'))) !== hash(manifestBytes)) throw new Error('Manifest mismatch');
  }
  if (hash(fs.readFileSync(path.join(library, 'ui-paper-wood.cjs'))) !== manifest.sourceSha256) throw new Error('Source mirror mismatch');
  if (hash(fs.readFileSync(path.join(library, 'README.md'))) !== hash(fs.readFileSync(path.join(target, 'README.md')))) throw new Error('README mismatch');
  console.log(JSON.stringify({ ok: true, mode, originalsPreserved: true, files: manifest.files }, null, 2));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
