'use strict';
// 核定球框母圖只做標準縮小；不裁切、不重畫，保留圓孔與外側裝飾。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const root = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root,
  'codex-authored/battle-hud/runic-frames');
const manifest = path.join(root, 'frames.json');
const names = ['health', 'mana'];
const mode = process.argv[2] || '--check';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = name => ({
  original: path.join(root, 'originals', 'orb-frame-' + name + '.png'),
  exported: path.join(root, 'exports', 'orb-frame-' + name + '.png'),
  target: path.join(REPO_ROOT, 'images/ui/battle-hud', 'orb-frame-' + name + '.png')
});

function checkPng(file, width, height) {
  const data = fs.readFileSync(file);
  if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
      data.readUInt32BE(16) !== width || data.readUInt32BE(20) !== height || data[25] !== 6) {
    throw new Error(path.basename(file) + ' 必須為指定尺寸的 RGBA PNG');
  }
}

async function main() {
  if (!['--make-export', '--apply', '--check'].includes(mode)) {
    throw new Error('用法：export-frames.cjs [--make-export|--apply|--check]');
  }
  if (mode === '--make-export') {
    const sharp = require('sharp');
    const record = {
      layout: { frameToGlass: 1.9, centerX: 0.599, centerY: 0.518 },
      frames: {}
    };
    fs.mkdirSync(path.join(root, 'exports'), { recursive: true });
    for (const name of names) {
      const f = files(name);
      const meta = await sharp(f.original).metadata();
      if (!meta.hasAlpha || !meta.width || meta.width !== meta.height) {
        throw new Error(name + ' 母圖必須為正方形透明 PNG');
      }
      const center = await sharp(f.original).extract({
        left: Math.round(meta.width * record.layout.centerX),
        top: Math.round(meta.height * record.layout.centerY), width: 1, height: 1
      }).ensureAlpha().raw().toBuffer();
      if (center[3] !== 0) throw new Error(name + ' 圓孔中心必須完全透明');
      await sharp(f.original).resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .png({ palette: false }).toFile(f.exported);
      checkPng(f.exported, 512, 512);
      record.frames[name] = {
        originalSha256: hash(f.original), exportSha256: hash(f.exported),
        originalWidth: meta.width, originalHeight: meta.height, width: 512, height: 512
      };
    }
    fs.writeFileSync(manifest, JSON.stringify(record, null, 2) + '\n');
    console.log('紅／藍球框母圖已標準縮小匯出，透明圓孔保留。');
    return;
  }
  const record = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const name of names) {
    const f = files(name), r = record.frames[name];
    checkPng(f.original, r.originalWidth, r.originalHeight);
    checkPng(f.exported, r.width, r.height);
    if (hash(f.original) !== r.originalSha256 || hash(f.exported) !== r.exportSha256) {
      throw new Error(name + ' 母圖或匯出已變更，請先 --make-export');
    }
  }
  // 兩色都驗證完才覆寫遊戲副本，避免第二張有問題時只更新一半。
  for (const name of names) {
    const f = files(name), r = record.frames[name];
    if (mode === '--apply') {
      fs.mkdirSync(path.dirname(f.target), { recursive: true });
      fs.copyFileSync(f.exported, f.target);
    }
    if (hash(f.target) !== r.exportSha256) throw new Error(name + ' 遊戲貼圖與素材庫匯出不一致');
  }
  console.log('紅／藍球框母圖／匯出紀錄／遊戲 SHA256 一致。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
