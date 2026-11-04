'use strict';
// 續作五款原創觸碰短音；只產生獨立試聽資產，不接入遊戲。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const RATE = 48000, TAU = Math.PI * 2;
const GAME_REL = 'audio/ui-preview/hover-options-v5';
const LIBRARY_REL = 'codex-authored/ui-hover-options-20261104-v5';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function canvas(seconds, seed) {
  const samples = new Float64Array(Math.round(seconds * RATE));
  let state = seed >>> 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2147483648 - 1; };
  function tone(at, duration, from, to, gain, decay, shape = 'sine') {
    let phase = 0;
    const count = Math.round(duration * RATE), start = Math.round(at * RATE);
    for (let i = 0; i < count && start + i < samples.length; i++) {
      const t = i / RATE, u = t / duration;
      phase += TAU * from * Math.pow(to / from, u) / RATE;
      const wave = shape === 'triangle' ? (Math.sin(phase) - Math.sin(phase * 3) / 9 + Math.sin(phase * 5) / 25) : Math.sin(phase);
      const envelope = Math.min(1, t / 0.0007) * Math.min(1, (duration - t) / 0.003) * Math.exp(-decay * t);
      samples[start + i] += wave * gain * envelope;
    }
  }
  function noise(at, duration, gain, high, low, decay) {
    let top = 0, bottom = 0;
    const a = 1 - Math.exp(-TAU * high / RATE), b = 1 - Math.exp(-TAU * low / RATE);
    const count = Math.round(duration * RATE), start = Math.round(at * RATE);
    for (let i = 0; i < count && start + i < samples.length; i++) {
      const t = i / RATE;
      top += a * (random() - top); bottom += b * (top - bottom);
      const envelope = Math.min(1, t / 0.0006) * Math.min(1, (duration - t) / 0.003) * Math.exp(-decay * t);
      samples[start + i] += (top - bottom) * gain * envelope;
    }
  }
  function finish(rmsTarget, peakLimit) {
    let dc = 0; for (const value of samples) dc += value; dc /= samples.length;
    let peak = 0, energy = 0;
    for (let i = 0; i < samples.length; i++) {
      samples[i] = (samples[i] - dc) * Math.min(1, i / (RATE * 0.0008), (samples.length - 1 - i) / (RATE * 0.004));
      peak = Math.max(peak, Math.abs(samples[i])); energy += samples[i] * samples[i];
    }
    const scale = Math.min(rmsTarget / Math.sqrt(energy / samples.length), peakLimit / peak);
    if (!Number.isFinite(scale)) throw new Error('Invalid synthesized sound');
    return samples.map(value => value * scale);
  }
  return { tone, noise, finish };
}
function wav(samples) {
  const data = Buffer.alloc(44 + samples.length * 4);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 4, 28);
  data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples.length * 4, 40);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.round(samples[i] * 32767);
    data.writeInt16LE(value, 44 + i * 4); data.writeInt16LE(value, 46 + i * 4);
  }
  return data;
}
function inspect(data) {
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE' ||
      data.readUInt32LE(24) !== RATE || data.readUInt16LE(22) !== 2 || data.readUInt16LE(34) !== 16 ||
      data.readUInt32LE(4) !== data.length - 8 || data.readUInt32LE(40) !== data.length - 44) throw new Error('Invalid PCM WAV');
  let peak = 0, sum = 0;
  for (let i = 44; i < data.length; i += 2) { const value = data.readInt16LE(i) / 32768; peak = Math.max(peak, Math.abs(value)); sum += value * value; }
  if (peak < 0.02 || peak > 0.8) throw new Error('Silent or overloaded sound');
  if ([44, 46, data.length - 4, data.length - 2].some(i => data.readInt16LE(i) !== 0)) throw new Error('Unfaded edges');
  return { seconds: (data.length - 44) / (RATE * 4), peakDbFS: Number((20 * Math.log10(peak)).toFixed(2)),
    rmsDbFS: Number((10 * Math.log10(sum / ((data.length - 44) / 2))).toFixed(2)) };
}
function makeClips() {
  const specs = [
    { id: 'H6', name: '輕巧滴答', group: 'hover', seconds: 0.047, make(s) {
      s.tone(0, 0.03, 1000, 820, 0.6, 85, 'triangle'); s.noise(0, 0.01, 0.2, 4000, 1300, 180);
    } },
    { id: 'H7', name: '柔亮撥音', group: 'hover', seconds: 0.058, make(s) {
      s.tone(0, 0.042, 620, 620, 0.65, 65, 'triangle'); s.tone(0.003, 0.038, 1480, 1120, 0.2, 100);
    } },
    { id: 'H8', name: '氣墊短噗', group: 'hover', seconds: 0.052, make(s) {
      s.noise(0, 0.035, 0.9, 2300, 130, 52); s.tone(0, 0.04, 300, 200, 0.15, 90);
    } },
    { id: 'H9', name: '微脆斷奏', group: 'hover', seconds: 0.045, make(s) {
      s.noise(0, 0.016, 0.9, 6800, 1600, 95); s.tone(0.002, 0.025, 620, 510, 0.12, 120);
    } },
    { id: 'H10', name: '上揚短啵', group: 'hover', seconds: 0.06, make(s) {
      s.tone(0, 0.043, 440, 940, 0.7, 38); s.noise(0, 0.008, 0.16, 2200, 700, 160);
    } }
  ];
  const clips = specs.map((spec, i) => {
    const s = canvas(spec.seconds, 552171 + i * 991); spec.make(s);
    const samples = s.finish(0.1, 0.5);
    return { id: spec.id, name: spec.name, group: spec.group, file: spec.id + '.wav', samples, data: wav(samples) };
  });
  const timelines = {};
  for (const group of ['hover']) {
    const parts = clips.filter(clip => clip.group === group), lead = Math.round(0.35 * RATE);
    const repeatGap = Math.round(0.24 * RATE), itemGap = Math.round(0.75 * RATE);
    const total = lead + parts.reduce((sum, clip) => sum + clip.samples.length * 2 + repeatGap + itemGap, 0);
    const samples = new Float64Array(total); let position = lead; const timeline = [];
    for (const clip of parts) {
      timeline.push({ id: clip.id, firstAtSeconds: Number((position / RATE).toFixed(3)), secondAtSeconds: Number(((position + clip.samples.length + repeatGap) / RATE).toFixed(3)) });
      samples.set(clip.samples, position); position += clip.samples.length + repeatGap;
      samples.set(clip.samples, position); position += clip.samples.length + itemGap;
    }
    timelines[group] = timeline;
    clips.push({ id: group + '-sampler', name: '觸碰H6到H10各兩次', group: 'sampler', file: group + '-sampler.wav', data: wav(samples) });
  }
  return { clips, timelines };
}
function main() {
  const mode = process.argv[2] || '--check';
  if (!['--apply', '--check'].includes(mode)) throw new Error('Usage: ui-hover-options.cjs [--apply|--check]');
  const target = path.join(REPO_ROOT, GAME_REL), library = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, LIBRARY_REL);
  const { clips, timelines } = makeClips();
  const manifest = { version: 5, status: 'preview-only-awaiting-user-selection', sampleRate: RATE, channels: 2, bits: 16,
    origin: 'Original procedural UI transients, filtered noise and damped oscillators. No external recordings, references or sample libraries.',
    source: 'tools/audio/ui-hover-options.cjs', sourceSha256: hash(fs.readFileSync(__filename)), libraryRelativePath: LIBRARY_REL, timelines,
    files: clips.map(clip => ({ id: clip.id, name: clip.name, group: clip.group, file: clip.file, sha256: hash(clip.data), ...inspect(clip.data) })) };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  if (mode === '--apply') {
    fs.mkdirSync(library, { recursive: true }); fs.mkdirSync(target, { recursive: true });
    for (const clip of clips) fs.writeFileSync(path.join(library, clip.file), clip.data);
    fs.copyFileSync(__filename, path.join(library, 'ui-hover-options.cjs'));
    fs.copyFileSync(path.join(target, 'README.md'), path.join(library, 'README.md'));
    fs.writeFileSync(path.join(library, 'manifest.json'), bytes);
    for (const file of [...clips.map(clip => clip.file), 'manifest.json']) fs.copyFileSync(path.join(library, file), path.join(target, file));
  }
  for (const dir of [target, library]) {
    for (const clip of clips) if (hash(fs.readFileSync(path.join(dir, clip.file))) !== hash(clip.data)) throw new Error('Audio mismatch: ' + clip.file);
    if (hash(fs.readFileSync(path.join(dir, 'manifest.json'))) !== hash(bytes)) throw new Error('Manifest mismatch');
  }
  if (hash(fs.readFileSync(path.join(library, 'ui-hover-options.cjs'))) !== manifest.sourceSha256) throw new Error('Source mirror mismatch');
  if (hash(fs.readFileSync(path.join(library, 'README.md'))) !== hash(fs.readFileSync(path.join(target, 'README.md')))) throw new Error('README mismatch');
  console.log(JSON.stringify({ ok: true, mode, files: manifest.files }, null, 2));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
