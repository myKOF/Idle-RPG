'use strict';
// 原創程序音效：固定亂數、音調／噪音／包絡／短回聲；不引用外部錄音或音色庫。
// 只產生待試聽WAV，不被遊戲載入。母檔先存素材庫，再原樣匯出遊戲候選目錄。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const RATE = 48000;
const LIBRARY_REL = 'codex-authored/ui-sound-preview-20261104';
const GAME_REL = 'audio/ui-preview';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const TAU = 2 * Math.PI;

function canvas(seconds, seed) {
  const length = Math.ceil(seconds * RATE);
  const left = new Float64Array(length), right = new Float64Array(length);
  let randomState = seed >>> 0;
  function random() {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 2147483648 - 1;
  }
  function put(index, value, pan) {
    if (index < 0 || index >= length) return;
    left[index] += value * Math.sqrt((1 - pan) / 2);
    right[index] += value * Math.sqrt((1 + pan) / 2);
  }
  function tone(at, duration, frequency, endFrequency, gain, decay, pan = 0, ratios = [1]) {
    let phase = 0;
    const count = Math.ceil(duration * RATE), start = Math.round(at * RATE);
    for (let i = 0; i < count; i++) {
      const t = i / RATE, u = t / duration;
      const freq = frequency * Math.pow(endFrequency / frequency, u);
      phase += TAU * freq / RATE;
      const attack = Math.min(1, t / 0.004);
      const tail = Math.min(1, (duration - t) / 0.025);
      let wave = 0;
      ratios.forEach((ratio, n) => { wave += Math.sin(phase * ratio) / Math.pow(n + 1, 1.65); });
      put(start + i, gain * wave * attack * tail * Math.exp(-decay * t), pan);
    }
  }
  function noise(at, duration, gain, cutoff, decay, pan = 0) {
    const start = Math.round(at * RATE), count = Math.ceil(duration * RATE);
    const alpha = 1 - Math.exp(-TAU * cutoff / RATE);
    let filtered = 0;
    for (let i = 0; i < count; i++) {
      const t = i / RATE;
      filtered += alpha * (random() - filtered);
      const envelope = Math.min(1, t / 0.003) * Math.min(1, (duration - t) / 0.025) * Math.exp(-decay * t);
      put(start + i, filtered * gain * envelope, pan);
    }
  }
  function bell(at, freq, gain, duration = 0.45, pan = 0) {
    tone(at, duration, freq, freq * 0.999, gain, 9, pan, [1, 2.756, 5.404]);
  }
  function echo(delay, amount) {
    const offset = Math.round(delay * RATE);
    // 從尾端反向複製，避免把回聲再次寫回回聲，尾巴保持有限長度。
    for (let i = length - 1; i >= offset; i--) {
      left[i] += right[i - offset] * amount;
      right[i] += left[i - offset] * amount;
    }
  }
  return { left, right, tone, noise, bell, echo };
}

function encode(sound) {
  const length = sound.left.length, data = Buffer.alloc(44 + length * 4);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 4, 28);
  data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(length * 4, 40);
  for (let i = 0; i < length; i++) {
    const fade = Math.min(1, i / (RATE * 0.002), (length - 1 - i) / (RATE * 0.025));
    [sound.left[i], sound.right[i]].forEach((value, channel) => {
      const sample = Math.round(Math.tanh(value) * fade * 32767);
      data.writeInt16LE(sample, 44 + i * 4 + channel * 2);
    });
  }
  return data;
}

function createSounds() {
  const specs = [
    { id: '01-hover', name: '觸碰／懸停', seconds: 0.18, make(s) {
      s.tone(0, 0.08, 1080, 820, 0.13, 35);
      s.noise(0, 0.045, 0.13, 4300, 65);
    } },
    { id: '02-click', name: '點擊／確認', seconds: 0.24, make(s) {
      s.tone(0, 0.1, 390, 210, 0.35, 32, 0, [1, 2.3]);
      s.noise(0, 0.065, 0.33, 3600, 65);
      s.bell(0.012, 1320, 0.08, 0.16);
    } },
    { id: '03-reroll', name: '洗煉', seconds: 1.1, make(s) {
      s.noise(0, 0.4, 0.24, 2300, 5);
      s.tone(0.02, 0.38, 230, 780, 0.13, 3, -0.3);
      [660, 880, 1174.66, 1567.98].forEach((freq, i) => s.bell(0.09 + i * 0.085, freq, 0.17, 0.48, (i - 1.5) * 0.18));
      s.bell(0.39, 880, 0.12, 0.52);
      s.echo(0.067, 0.18);
    } },
    { id: '04-divine-forge', name: '神鑄', seconds: 1.85, make(s) {
      [0, 0.28, 0.58].forEach((at, i) => {
        s.tone(at, 0.25, 145 + i * 12, 65, 0.43, 19, 0, [1, 1.47, 2.09]);
        s.noise(at, 0.11, 0.4, 4500, 30);
        s.bell(at + 0.008, 640 + i * 90, 0.16, 0.35, i % 2 ? 0.2 : -0.2);
      });
      s.tone(0.18, 0.64, 140, 560, 0.1, 1.5);
      [293.66, 440, 587.33, 880].forEach((freq, i) => s.bell(0.76 + i * 0.028, freq, 0.18, 0.85, (i - 1.5) * 0.15));
      s.echo(0.091, 0.18);
    } },
    { id: '05-success', name: '成功', seconds: 1.15, make(s) {
      [587.33, 739.99, 880, 1174.66].forEach((freq, i) => s.bell(i * 0.085, freq, 0.23, 0.65, (i - 1.5) * 0.12));
      s.tone(0.255, 0.6, 293.66, 293.66, 0.1, 6);
      s.echo(0.078, 0.2);
    } },
    { id: '06-failure', name: '失敗／無法執行', seconds: 0.65, make(s) {
      s.tone(0, 0.22, 330, 280, 0.23, 12, -0.1, [1, 2]);
      s.tone(0.15, 0.32, 246.94, 196, 0.27, 12, 0.1, [1, 2]);
      s.noise(0.15, 0.09, 0.12, 1600, 35);
    } }
  ];
  const clips = specs.map((spec, i) => {
    const sound = canvas(spec.seconds, 73191 + i);
    spec.make(sound);
    return { id: spec.id, name: spec.name, data: encode(sound) };
  });
  const sequence = [0, 0, 0, 1, 1, 1, 2, 3, 4, 5];
  const gap = 0.45, lead = 0.35;
  const total = lead + sequence.reduce((sum, i) => sum + (clips[i].data.length - 44) / (RATE * 4) + gap, 0);
  const combined = canvas(total, 1);
  let position = Math.round(lead * RATE);
  const timeline = [];
  sequence.forEach(i => {
    const clip = clips[i], frames = (clip.data.length - 44) / 4;
    timeline.push({ id: clip.id, atSeconds: Number((position / RATE).toFixed(3)) });
    for (let j = 0; j < frames; j++) {
      combined.left[position + j] = clip.data.readInt16LE(44 + j * 4) / 32767;
      combined.right[position + j] = clip.data.readInt16LE(46 + j * 4) / 32767;
    }
    position += frames + Math.round(gap * RATE);
  });
  // 合輯直接複製PCM，保留與各單音相同的音量，不再經第二次非線性處理。
  const combinedData = encode(canvas(total, 1));
  for (let i = 0; i < combined.left.length; i++) {
    combinedData.writeInt16LE(Math.round(combined.left[i] * 32767), 44 + i * 4);
    combinedData.writeInt16LE(Math.round(combined.right[i] * 32767), 46 + i * 4);
  }
  clips.push({ id: '00-all-preview', name: '依序試聽合輯', data: combinedData });
  return { clips, timeline };
}

function inspect(data) {
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE' ||
      data.readUInt32LE(24) !== RATE || data.readUInt16LE(22) !== 2 || data.readUInt16LE(34) !== 16 ||
      data.readUInt32LE(4) !== data.length - 8 || data.readUInt32LE(40) !== data.length - 44) throw new Error('Invalid PCM WAV');
  let peak = 0, sum = 0;
  for (let offset = 44; offset < data.length; offset += 2) {
    const value = data.readInt16LE(offset) / 32768;
    peak = Math.max(peak, Math.abs(value)); sum += value * value;
  }
  if (peak < 0.01 || peak > 0.95) throw new Error('Silent or overloaded preview');
  if ([44, 46, data.length - 4, data.length - 2].some(offset => data.readInt16LE(offset) !== 0)) throw new Error('Missing edge fade');
  return { seconds: (data.length - 44) / (RATE * 4), peakDbFS: Number((20 * Math.log10(peak)).toFixed(2)),
    rmsDbFS: Number((10 * Math.log10(sum / ((data.length - 44) / 2))).toFixed(2)) };
}

function main() {
  const mode = process.argv[2] || '--check';
  if (!['--apply', '--check'].includes(mode)) throw new Error('Usage: ui-preview.cjs [--apply|--check]');
  const library = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, LIBRARY_REL);
  const target = path.join(REPO_ROOT, GAME_REL);
  const { clips, timeline } = createSounds();
  const manifest = { version: 1, status: 'preview-only-awaiting-user-review', sampleRate: RATE, channels: 2, bits: 16,
    origin: 'Original procedural synthesis by Codex; no external recordings, references, sample libraries or generated third-party audio.',
    libraryRelativePath: LIBRARY_REL, source: 'tools/audio/ui-preview.cjs', sourceSha256: hash(fs.readFileSync(__filename)), timeline,
    files: clips.map(clip => ({ file: clip.id + '.wav', name: clip.name, sha256: hash(clip.data), ...inspect(clip.data) })) };
  if (mode === '--apply') {
    fs.mkdirSync(library, { recursive: true }); fs.mkdirSync(target, { recursive: true });
    for (const clip of clips) fs.writeFileSync(path.join(library, clip.id + '.wav'), clip.data);
    fs.copyFileSync(__filename, path.join(library, 'ui-preview.cjs'));
    const readme = fs.readFileSync(path.join(target, 'README.md'));
    fs.writeFileSync(path.join(library, 'README.md'), readme);
    fs.writeFileSync(path.join(library, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const name of [...clips.map(clip => clip.id + '.wav'), 'manifest.json']) {
      fs.copyFileSync(path.join(library, name), path.join(target, name));
    }
  }
  for (const clip of clips) {
    for (const dir of [library, target]) {
      if (hash(fs.readFileSync(path.join(dir, clip.id + '.wav'))) !== hash(clip.data)) throw new Error('Preview hash mismatch: ' + dir + '/' + clip.id);
    }
  }
  for (const dir of [library, target]) {
    if (fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8') !== JSON.stringify(manifest, null, 2) + '\n') throw new Error('Stale manifest');
  }
  if (hash(fs.readFileSync(path.join(library, 'ui-preview.cjs'))) !== manifest.sourceSha256) throw new Error('Library source mismatch');
  if (hash(fs.readFileSync(path.join(library, 'README.md'))) !== hash(fs.readFileSync(path.join(target, 'README.md')))) throw new Error('Library documentation mismatch');
  console.log(JSON.stringify({ ok: true, mode, files: manifest.files }, null, 2));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
