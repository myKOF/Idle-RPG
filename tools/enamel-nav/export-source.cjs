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
    // AI母圖的格心可能偏移幾個像素；在名目分界附近找透明縫，避免切到金框尖端。
    // alpha<=16只作裁切邊界判斷，原像素／alpha不重寫；保留兩像素透明邊緣。
    const cuts = [0];
    for (let column = 1; column < 5; column++) {
      const expected = Math.round(column * info.width / 5);
      const search = Math.max(8, Math.round(info.width / 100));
      const bands = [];
      let start = -1;
      for (let x = expected - search; x <= expected + search + 1; x++) {
        let maxAlpha = 255;
        if (x <= expected + search) {
          maxAlpha = 0;
          for (let y = 0; y < info.height; y++) maxAlpha = Math.max(maxAlpha, data[(y * info.width + x) * 4 + 3]);
        }
        if (maxAlpha <= 16 && start < 0) start = x;
        if (maxAlpha > 16 && start >= 0) { bands.push(Math.round((start + x - 1) / 2)); start = -1; }
      }
      bands.sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected));
      if (!bands.length) throw new Error('第' + column + '欄之間沒有透明縫，需重新整理母圖');
      cuts.push(bands[0]);
    }
    cuts.push(info.width);
    const records = [];
    fs.mkdirSync(path.join(sourceRoot, 'icons'), { recursive: true });
    for (let i = 0; i < names.length; i++) {
      let original = sheet, pixels = data, rasterWidth = info.width;
      let x0 = cuts[i % 5], x1 = cuts[i % 5 + 1];
      let y0 = Math.round(Math.floor(i / 5) * info.height / 2);
      let y1 = Math.round((Math.floor(i / 5) + 1) * info.height / 2);
      // 核定後獨立重製的單圖同樣由素材庫母圖匯出，不回退到舊整組圖案。
      const override = path.join(sourceRoot, 'originals', names[i] + '.png');
      if (fs.existsSync(override)) {
        original = override;
        const single = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        pixels = single.data; rasterWidth = single.info.width;
        x0 = 0; y0 = 0; x1 = single.info.width; y1 = single.info.height;
      }
      let left = x1, top = y1, right = -1, bottom = -1, transparent = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const alpha = pixels[(y * rasterWidth + x) * 4 + 3];
        if (!alpha) transparent++;
        if (alpha > 16) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
      }
      if (!transparent || right < left) throw new Error(names[i] + '缺少透明背景或沒有圖案');
      if (left <= x0 || right >= x1 - 1 || top <= y0 || bottom >= y1 - 1) throw new Error(names[i] + '圖案碰到分格邊緣，需重新整理母圖');
      left = Math.max(x0, left - 2); right = Math.min(x1 - 1, right + 2);
      top = Math.max(y0, top - 2); bottom = Math.min(y1 - 1, bottom + 2);
      const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
      const output = path.join(sourceRoot, 'icons', names[i] + '.png');
      await sharp(original).extract(crop).resize(120, 120, { fit: 'contain', background: '#00000000' })
        .extend({ top: 4, bottom: 4, left: 4, right: 4, background: '#00000000' }).png().toFile(output);
      const record = { name: names[i], crop, sha256: hash(output) };
      if (original !== sheet) { record.original = 'originals/' + names[i] + '.png'; record.originalSha256 = hash(original); }
      records.push(record);
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
    const originalRel = 'originals/' + name + '.png';
    const original = path.join(sourceRoot, originalRel);
    if (record.original && (record.original !== originalRel || !fs.existsSync(original) || hash(original) !== record.originalSha256)) throw new Error(name + '獨立母圖變更，請先--make-icons');
    if (!record.original && fs.existsSync(original)) throw new Error(name + '新增獨立母圖，請先--make-icons');
    if (mode === '--apply') fs.copyFileSync(source, target);
    if (hash(source) !== hash(target)) throw new Error(name + '素材庫與遊戲匯出不同');
  }
  console.log('10張徽章的素材庫／匯出紀錄／遊戲SHA256一致。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
