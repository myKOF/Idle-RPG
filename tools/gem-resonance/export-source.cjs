'use strict';
// 沿既有 UI 素材匯出流程，原樣保留使用者確認的母圖與透明 alpha。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const mode = process.argv[2] || '--check';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function main() {
  if (!['--apply', '--check'].includes(mode)) throw new Error('用法：export-source.cjs [--apply|--check]');
  const root = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'codex-authored/gem-resonance');
  const original = path.join(root, 'originals/hex-backplate.png');
  const target = path.join(REPO_ROOT, 'images/ui/gem-resonance/hex-backplate.png');
  const record = JSON.parse(fs.readFileSync(path.join(root, 'exports.json'), 'utf8'));
  if (hash(original) !== record.originalSha256) throw new Error('素材庫母圖已變更，請先確認匯出紀錄');
  if (mode === '--apply') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(original, target);
  }
  if (hash(target) !== record.originalSha256) throw new Error('遊戲底板與素材庫母圖不一致');
  console.log('共鳴底板母圖／匯出紀錄／遊戲 SHA256 一致：' + record.originalSha256);
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
