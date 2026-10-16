'use strict';
// 透明母圖只做標準縮小匯出；保留完整構圖與 alpha，不裁切或重畫雕刻。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const root = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'codex-authored/battle-hud');
const original = path.join(root, 'originals/orb-carving.png');
const exported = path.join(root, 'exports/orb-carving.png');
const manifest = path.join(root, 'exports.json');
const target = path.join(REPO_ROOT, 'images/ui/battle-hud/orb-carving.png');
const mode = process.argv[2] || '--check';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  if (!['--make-export', '--apply', '--check'].includes(mode)) throw new Error('用法：export-source.cjs [--make-export|--apply|--check]');
  if (mode === '--make-export') {
    const sharp = require('sharp');
    const meta = await sharp(original).metadata();
    if (!meta.hasAlpha) throw new Error('母圖必須保留透明 alpha');
    fs.mkdirSync(path.dirname(exported), { recursive: true });
    await sharp(original).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).png().toFile(exported);
    fs.writeFileSync(manifest, JSON.stringify({ originalSha256: hash(original), exportSha256: hash(exported), width: 512, height: 512 }, null, 2) + '\n');
    console.log('透明雕飾母圖已標準縮小匯出。');
    return;
  }
  const record = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (record.originalSha256 !== hash(original) || record.exportSha256 !== hash(exported)) throw new Error('素材庫母圖或匯出已變更，請先 --make-export');
  if (mode === '--apply') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(exported, target);
  }
  if (hash(target) !== record.exportSha256) throw new Error('遊戲雕飾與素材庫匯出不一致');
  console.log('雕飾母圖／匯出紀錄／遊戲 SHA256 一致。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
