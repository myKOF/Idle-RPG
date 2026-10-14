'use strict';
// 素材庫保留核定圖稿／透明母圖，遊戲只載入128px匯出；沿共用Root解析流程。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const names = ['char', 'equip', 'skills', 'newforge', 'gems', 'runes', 'tower', 'talents', 'forge', 'settings'];
const sourceRoot = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'codex-authored/enamel-nav');
const targetRoot = path.join(REPO_ROOT, 'images/ui/enamel-nav');
const mode = process.argv[2] || '--check';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  if (!['--check', '--apply', '--make-icons'].includes(mode)) throw new Error('用法：node tools/enamel-nav/export-source.cjs [--make-icons|--apply|--check]');
  if (mode === '--make-icons') {
    // 標準匯出只依透明邊界裁切並等比縮小，不重畫或修改AI圖案／alpha。
    const sharp = require('sharp');
    const sheet = path.join(sourceRoot, 'originals/badges.png');
    const { data, info } = await sharp(sheet).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const records = [];
    fs.mkdirSync(path.join(sourceRoot, 'icons'), { recursive: true });
    for (let i = 0; i < names.length; i++) {
      const x0 = Math.round((i % 5) * info.width / 5);
      const x1 = Math.round((i % 5 + 1) * info.width / 5);
      const y0 = Math.round(Math.floor(i / 5) * info.height / 2);
      const y1 = Math.round((Math.floor(i / 5) + 1) * info.height / 2);
      let left = x1, top = y1, right = -1, bottom = -1, transparent = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const alpha = data[(y * info.width + x) * 4 + 3];
        if (!alpha) transparent++;
        if (alpha > 4) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
      }
      if (!transparent || right < left) throw new Error(names[i] + '缺少透明背景或沒有圖案');
      if (left <= x0 || right >= x1 - 1 || top <= y0 || bottom >= y1 - 1) throw new Error(names[i] + '圖案碰到分格邊緣，需重新整理母圖');
      const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
      const output = path.join(sourceRoot, 'icons', names[i] + '.png');
      await sharp(sheet).extract(crop).resize(120, 120, { fit: 'contain', background: '#00000000' })
        .extend({ top: 4, bottom: 4, left: 4, right: 4, background: '#00000000' }).png().toFile(output);
      records.push({ name: names[i], crop, sha256: hash(output) });
    }
    fs.writeFileSync(path.join(sourceRoot, 'exports.json'), JSON.stringify({ sourceSha256: hash(sheet), size: 128, icons: records }, null, 2) + '\n');
    console.log('10張透明徽章已匯出到素材庫（128×128）。');
    return;
  }
  const records = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'exports.json'), 'utf8'));
  if (records.sourceSha256 !== hash(path.join(sourceRoot, 'originals/badges.png'))) throw new Error('母圖變更，請先--make-icons');
  if (mode === '--apply') fs.mkdirSync(targetRoot, { recursive: true });
  for (const name of names) {
    const source = path.join(sourceRoot, 'icons', name + '.png');
    const target = path.join(targetRoot, name + '.png');
    const record = records.icons.find(icon => icon.name === name);
    if (!record || record.sha256 !== hash(source)) throw new Error(name + '素材與匯出紀錄不同');
    if (mode === '--apply') fs.copyFileSync(source, target);
    if (hash(source) !== hash(target)) throw new Error(name + '素材庫與遊戲匯出不同');
  }
  console.log('10張徽章的素材庫／匯出紀錄／遊戲SHA256一致。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
