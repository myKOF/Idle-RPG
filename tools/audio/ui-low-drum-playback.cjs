'use strict';
// 保留原鼓聲PCM，新增足夠播放器辨識時長的單擊與重複試聽版本。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const SOURCE = 'audio/ui-preview/low-drum-v1';
const TARGET = 'audio/ui-preview/low-drum-playback-v2';
const LIBRARY = 'codex-authored/ui-low-drum-playback-20261105-v2';
const RATE = 48000, FRAME = 4;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function pack(seconds, hits) {
  const result = Buffer.alloc(44 + Math.round(seconds * RATE) * FRAME);
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(2, 22);
  result.writeUInt32LE(RATE, 24); result.writeUInt32LE(RATE * FRAME, 28);
  result.writeUInt16LE(FRAME, 32); result.writeUInt16LE(16, 34);
  result.write('data', 36); result.writeUInt32LE(result.length - 44, 40);
  for (const hit of hits) {
    const start = 44 + Math.round(hit.at * RATE) * FRAME;
    assert(start + hit.pcm.length <= result.length);
    hit.pcm.copy(result, start);
    assert(result.subarray(start, start + hit.pcm.length).equals(hit.pcm));
  }
  return result;
}
function main() {
  const mode = process.argv[2] || '--check';
  assert(['--apply', '--check'].includes(mode), 'Use --apply or --check');
  const source = path.join(REPO_ROOT, SOURCE), target = path.join(REPO_ROOT, TARGET);
  const library = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, LIBRARY);
  const original = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
  const entries = original.files.filter(f => /^D[1-5]$/.test(f.id)); assert.equal(entries.length, 5);
  const files = [], metadata = [], comparisonHits = [];
  for (const [i, clip] of entries.entries()) {
    const data = fs.readFileSync(path.join(source, clip.file)); assert.equal(hash(data), clip.sha256);
    assert.equal(data.toString('ascii', 0, 4), 'RIFF'); assert.equal(data.toString('ascii', 8, 12), 'WAVE');
    assert.equal(data.readUInt16LE(20), 1); assert.equal(data.readUInt16LE(22), 2);
    assert.equal(data.readUInt32LE(24), RATE); assert.equal(data.readUInt16LE(34), 16);
    assert.equal(data.toString('ascii', 36, 40), 'data'); assert.equal(data.readUInt32LE(40), data.length - 44);
    const pcm = data.subarray(44);
    for (const [suffix, seconds, times] of [['single', 1.2, [0.15]], ['preview', 3, [0.2, 0.85, 1.5, 2.15]]]) {
      const file = clip.id + '-' + suffix + '.wav', bytes = pack(seconds, times.map(at => ({ at, pcm })));
      files.push([file, bytes]);
      metadata.push({ id: clip.id, name: clip.name, file, seconds, hitSeconds: clip.seconds, hitTimes: times,
        originalSha256: clip.sha256, sha256: hash(bytes) });
    }
    for (const at of [0.3 + i * 2, 1 + i * 2]) comparisonHits.push({ id: clip.id, at, pcm });
  }
  const comparison = pack(10.5, comparisonHits);
  files.push(['comparison.wav', comparison]);
  metadata.push({ file: 'comparison.wav', seconds: 10.5,
    hits: comparisonHits.map(({ id, at }) => ({ id, at })), sha256: hash(comparison) });
  const readme = `# 低沉鼓聲播放修正版\n\n原鼓聲只有32～55ms；本版保留原PCM與音量，只補上靜音與重複試聽容器。\n\n- D1 短底鼓、D2 悶手鼓、D3 低音通鼓、D4 厚實重咚、D5 極短乾鼓。\n- D1～D5-single.wav：每檔1.2秒，0.15秒處敲擊一次，適合單獨點播。\n- D1～D5-preview.wav：每檔3秒，0.2／0.85／1.5／2.15秒各敲擊一次。\n- comparison.wav：10.5秒，依D1～D5各兩次。\n- WAV格式：48kHz／16-bit PCM／立體聲置中。\n\n全部原創程序鼓聲，無外部素材；來源為${SOURCE}，沒有拉長鼓聲、混響或變更音色。\n\n重產：node tools/audio/ui-low-drum-playback.cjs --apply\n驗證：node tools/audio/ui-low-drum-playback.cjs --check\n素材庫相對目錄：${LIBRARY}。尚未接入遊戲。\n`;
  files.push(['README.md', Buffer.from(readme)]);
  files.push(['manifest.json', Buffer.from(JSON.stringify({ version: 2, status: 'preview-only', source: SOURCE,
    generator: 'tools/audio/ui-low-drum-playback.cjs', generatorSha256: hash(fs.readFileSync(__filename)),
    libraryRelativePath: LIBRARY, sampleRate: RATE, bits: 16, channels: 2, files: metadata }, null, 2) + '\n')]);
  if (mode === '--apply') {
    fs.mkdirSync(library, { recursive: true }); fs.mkdirSync(target, { recursive: true });
    for (const [file, bytes] of files) {
      fs.writeFileSync(path.join(library, file), bytes);
      fs.copyFileSync(path.join(library, file), path.join(target, file));
    }
    fs.copyFileSync(__filename, path.join(library, 'ui-low-drum-playback.cjs'));
  }
  for (const dir of [target, library]) for (const [file, bytes] of files)
    assert.equal(hash(fs.readFileSync(path.join(dir, file))), hash(bytes), file + ' mismatch');
  assert.equal(hash(fs.readFileSync(path.join(library, 'ui-low-drum-playback.cjs'))), hash(fs.readFileSync(__filename)));
  console.log(JSON.stringify({ ok: true, mode, files: metadata.map(f => ({ file: f.file, seconds: f.seconds })) }));
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
