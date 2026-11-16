'use strict';
/* 封魔塔BOSS 3D 模型檔名與動作名稱統一（2026-11-16，使用者要求）
   node tools/meshy-pipeline/src/normalize-tower-boss-models.cjs --check   只列出會做的事
   node tools/meshy-pipeline/src/normalize-tower-boss-models.cjs --apply   實際改名＋改 GLB 內動作名，並同步素材庫的 exports 與 manifest

   檔名一律 bossN.glb／bossN_lv2.glb／bossN_lv3.glb（N＝第幾隻封魔塔BOSS）；
   動作名一律 Walk／Attack1／Attack2／Attack3／Die。只改 GLB 的 JSON 區塊（動畫名稱），二進位資料與貼圖原封不動。
   素材庫每個資產包的 manifest（source／project／sha256）一併更新，原有的 export-tower-*.cjs --check 仍然通過。 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot } = require('../../vfx/vfx-library-root.cjs');
const project = path.resolve(__dirname, '../../..');
const lib = path.join(resolveLibraryRoot().root, 'codex-authored');
const dir = path.join(project, 'images/models/npc3d');
const mode = process.argv[2] || '--check';
if (!['--check', '--apply'].includes(mode)) throw Error('Use --check or --apply');

const TREANT = { Unsteady_Walk: 'Walk', Weapon_Combo_2: 'Attack1', Attack: 'Attack2', Basic_Jump: 'Attack3', Shot_and_Fall_Forward: 'Die' };
const BOSS3 = { Running: 'Walk', Basic_Jump: 'Attack1', Right_Hand_Sword_Slash: 'Attack2', Shield_Push_Left: 'Attack3', Shot_and_Fall_Forward: 'Die' };
/* 舊檔名 → 新檔名、素材庫資產包（codex-authored 下）、動作改名表。boss1／boss2／boss3 原本是第1隻BOSS（骷髏王）的三階，動作名本來就對，只改檔名。 */
const PLAN = [
  { from: 'boss1', to: 'boss1', pkg: 'tower-boss1-3d-20261108-v3', clips: null },
  { from: 'boss2', to: 'boss1_lv2', pkg: 'tower-boss2-lv2-20261108', clips: null },
  { from: 'boss3', to: 'boss1_lv3', pkg: 'tower-boss3-lv3-20261108', clips: null },
  { from: 'treant', to: 'boss2', pkg: 'tower-treant-20261109', clips: TREANT },
  { from: 'treant_lv2', to: 'boss2_lv2', pkg: 'tower-treant-lv2-20261109', clips: TREANT },
  { from: 'treant_lv3', to: 'boss2_lv3', pkg: 'tower-treant-lv3-20261109', clips: TREANT },
  { from: 'boss3_character', to: 'boss3', pkg: 'tower-boss3-character-20261110', clips: BOSS3 },
  { from: 'boss3_character_lv2', to: 'boss3_lv2', pkg: 'tower-boss3-lv2-20261110', clips: BOSS3 },
  { from: 'boss3_character_lv3', to: 'boss3_lv3', pkg: 'tower-boss3-lv3-20261110', clips: BOSS3 }
];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function patchClips(bytes, map) {
  if (!map) return bytes;
  const jl = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jl).toString('utf8'));
  const names = json.animations.map((a) => a.name);
  for (const n of names) if (!(n in map)) throw Error('Unexpected animation name: ' + n);
  json.animations.forEach((a) => { a.name = map[a.name]; });
  if (new Set(json.animations.map((a) => a.name)).size !== json.animations.length) throw Error('Duplicate animation names after rename');
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += ' ';
  const jb = Buffer.from(text, 'utf8');
  const head = Buffer.alloc(20);
  bytes.copy(head, 0, 0, 12);
  head.writeUInt32LE(jb.length, 12);
  head.writeUInt32LE(0x4E4F534A, 16);
  const out = Buffer.concat([head, jb, bytes.subarray(20 + jl)]);
  out.writeUInt32LE(out.length, 8);
  return out;
}

const work = PLAN.map((p) => {
  const oldFile = path.join(dir, p.from + '.glb');
  if (!fs.existsSync(oldFile)) throw Error('Missing ' + oldFile + ' (already normalized?)');
  const oldBytes = fs.readFileSync(oldFile);
  const newBytes = patchClips(oldBytes, p.clips);
  const manifestFile = path.join(lib, p.pkg, 'manifest.json');
  const manifest = fs.readFileSync(manifestFile, 'utf8');
  const oldSha = sha(oldBytes);
  if (!manifest.includes(oldSha)) throw Error('Manifest does not hold the current hash of ' + p.from + ': ' + manifestFile);
  const entry = JSON.parse(manifest).files.find((f) => f.project === 'images/models/npc3d/' + p.from + '.glb');
  if (!entry) throw Error('Manifest has no entry for ' + p.from);
  return Object.assign({}, p, { oldFile, oldBytes, newBytes, oldSha, newSha: sha(newBytes), manifestFile, manifest, entry });
});
for (const w of work) console.log(w.from.padEnd(20), '→', (w.to + '.glb').padEnd(18), w.clips ? 'clips renamed' : 'name only    ', w.oldSha.slice(0, 8), '→', w.newSha.slice(0, 8), '(' + w.pkg + ')');
if (mode === '--check') process.exit(0);

// 1) project: remove every old file first (names are re-used: treant → boss2 while the old boss2 becomes boss1_lv2)
for (const w of work) fs.rmSync(w.oldFile);
for (const w of work) fs.writeFileSync(path.join(dir, w.to + '.glb'), w.newBytes);
// 2) library: exports file + manifest text
for (const w of work) {
  const libDir = path.join(lib, w.pkg);
  const oldExport = path.join(libDir, w.entry.source), newSource = path.posix.join(path.posix.dirname(w.entry.source), w.to + '.glb');
  if (!fs.existsSync(oldExport)) throw Error('Missing library export ' + oldExport);
  fs.rmSync(oldExport);
}
for (const w of work) {
  const libDir = path.join(lib, w.pkg);
  const newSource = path.posix.join(path.posix.dirname(w.entry.source), w.to + '.glb');
  fs.writeFileSync(path.join(libDir, newSource), w.newBytes);
  let text = w.manifest;
  const swap = (a, b) => { if (!text.includes(a)) throw Error('Manifest text lacks ' + a); text = text.split(a).join(b); };
  swap(JSON.stringify(w.entry.source).slice(1, -1), newSource);
  swap('images/models/npc3d/' + w.from + '.glb', 'images/models/npc3d/' + w.to + '.glb');
  if (w.newSha !== w.oldSha) swap(w.oldSha, w.newSha);
  fs.writeFileSync(w.manifestFile, text);
}
console.log('Normalized ' + work.length + ' models (project + library).');
