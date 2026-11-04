'use strict';
// 五款原創極短低沉鼓敲擊音；獨立試聽候選。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const RATE = 48000, TAU = Math.PI * 2;
const GAME_REL = 'audio/ui-preview/low-drum-v1';
const LIBRARY_REL = 'codex-authored/ui-low-drum-20261105-v1';
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
      phase += TAU * (to + (from - to) * Math.exp(-8 * u)) / RATE;
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
    { id: 'D1', name: '短底鼓', seconds: 0.045, make(s) {
      s.tone(0, 0.045, 165, 68, 1, 95);
      s.tone(0, 0.018, 290, 155, 0.10, 210);
      s.noise(0, 0.009, 0.16, 1400, 180, 290);
    } },
    { id: 'D2', name: '悶手鼓', seconds: 0.038, make(s) {
      s.tone(0, 0.038, 145, 100, 0.85, 125);
      s.tone(0, 0.028, 245, 170, 0.32, 150);
      s.tone(0.001, 0.017, 360, 280, 0.09, 210);
      s.noise(0, 0.012, 0.32, 1300, 260, 225);
    } },
    { id: 'D3', name: '低音通鼓', seconds: 0.050, make(s) {
      s.tone(0, 0.050, 125, 82, 0.9, 85);
      s.tone(0.001, 0.032, 205, 135, 0.42, 125);
      s.tone(0, 0.022, 298, 220, 0.16, 190);
      s.noise(0, 0.007, 0.15, 1700, 300, 300);
    } },
    { id: 'D4', name: '厚實重咚', seconds: 0.055, make(s) {
      s.tone(0, 0.055, 135, 55, 1, 78);
      s.tone(0.001, 0.035, 195, 110, 0.26, 115);
      s.noise(0, 0.014, 0.22, 900, 110, 185);
    } },
    { id: 'D5', name: '極短乾鼓', seconds: 0.032, make(s) {
      s.tone(0, 0.032, 180, 95, 1, 165);
      s.tone(0, 0.020, 310, 160, 0.2, 210);
      s.noise(0, 0.008, 0.25, 1200, 220, 340);
    } }
  ];
  const clips = specs.map((spec, i) => {
    const s = canvas(spec.seconds, 855171 + i * 991); spec.make(s);
    const samples = s.finish(0.18, 0.60);
    return { id: spec.id, name: spec.name, file: spec.id + '.wav', samples, data: wav(samples) };
  });
  const lead = Math.round(0.35 * RATE), repeatGap = Math.round(0.24 * RATE), itemGap = Math.round(0.65 * RATE);
  const samples = new Float64Array(lead + clips.reduce((sum, clip) => sum + clip.samples.length * 2 + repeatGap + itemGap, 0));
  let position = lead; const timeline = [];
  for (const clip of clips) {
    timeline.push({ id: clip.id, firstAtSeconds: position / RATE, secondAtSeconds: (position + clip.samples.length + repeatGap) / RATE });
    samples.set(clip.samples, position); position += clip.samples.length + repeatGap;
    samples.set(clip.samples, position); position += clip.samples.length + itemGap;
  }
  clips.push({ id: 'comparison', name: 'D1到D5各兩次', file: 'comparison.wav', data: wav(samples) });
  return { clips, timeline };
}
function main() {
  const mode = process.argv[2] || '--check';
  if (!['--apply', '--check'].includes(mode)) throw new Error('Usage: ui-low-drum.cjs [--apply|--check]');
  const target = path.join(REPO_ROOT, GAME_REL);
  const library = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, LIBRARY_REL);
  const { clips, timeline } = makeClips();
  const manifest = { version: 1, status: 'preview-only-awaiting-user-selection', sampleRate: RATE, channels: 2, bits: 16,
    origin: 'Original procedural ultra-short low drum hits: seeded filtered noise and rapidly damped oscillators; no external recordings, reference files or sample libraries.',
    source: 'tools/audio/ui-low-drum.cjs', sourceSha256: hash(fs.readFileSync(__filename)), libraryRelativePath: LIBRARY_REL, timeline,
    files: clips.map(clip => ({ id: clip.id, name: clip.name, file: clip.file, sha256: hash(clip.data), ...inspect(clip.data) })) };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  if (mode === '--apply') {
    fs.mkdirSync(library, { recursive: true }); fs.mkdirSync(target, { recursive: true });
    for (const clip of clips) fs.writeFileSync(path.join(library, clip.file), clip.data);
    fs.copyFileSync(__filename, path.join(library, 'ui-low-drum.cjs'));
    fs.copyFileSync(path.join(target, 'README.md'), path.join(library, 'README.md'));
    fs.writeFileSync(path.join(library, 'manifest.json'), bytes);
    for (const file of [...clips.map(clip => clip.file), 'manifest.json']) fs.copyFileSync(path.join(library, file), path.join(target, file));
  }
  for (const dir of [target, library]) {
    for (const clip of clips) if (hash(fs.readFileSync(path.join(dir, clip.file))) !== hash(clip.data)) throw new Error('Audio mismatch: ' + clip.file);
    if (hash(fs.readFileSync(path.join(dir, 'manifest.json'))) !== hash(bytes)) throw new Error('Manifest mismatch');
  }
  if (hash(fs.readFileSync(path.join(library, 'ui-low-drum.cjs'))) !== manifest.sourceSha256) throw new Error('Source mirror mismatch');
  if (hash(fs.readFileSync(path.join(library, 'README.md'))) !== hash(fs.readFileSync(path.join(target, 'README.md')))) throw new Error('README mismatch');
  console.log(JSON.stringify({ ok: true, mode, files: manifest.files }, null, 2));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
