'use strict';
/* 把 BOSS5 的 VFX 素材（素材庫 claude-authored/boss5-oni-mask-20261113/vfx/*.png）登記進 vfx/asset-index.json。
   素材庫目前有 RPG Maker_MV 兩個子資料夾產生重複 assetId，整庫掃描會被擋下（exit 2，與本任務無關），
   所以只掃描這個資料夾（暫存成一個只含它的根目錄），用掃描器同一支 scanLibrary 產生記錄再併入索引。
   用法：node tools/boss5/add-vfx-assets.cjs   （已登記且內容相同則不變動） */
const fs = require('fs'), path = require('path'), os = require('os');
const scanner = require('../vfx/asset-scanner.cjs');
const { resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');
const repo = path.resolve(__dirname, '../..');
const rel = 'claude-authored/boss5-oni-mask-20261113/vfx';
const src = path.join(resolveLibraryRoot().root, rel);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b5-assets-'));
fs.mkdirSync(path.join(tmp, rel), { recursive: true });
for (const f of fs.readdirSync(src)) if (/\.png$/i.test(f)) fs.copyFileSync(path.join(src, f), path.join(tmp, rel, f));
const scan = scanner.scanLibrary(tmp, {});
fs.rmSync(tmp, { recursive: true, force: true });
const file = path.join(repo, 'vfx/asset-index.json');
const index = JSON.parse(fs.readFileSync(file, 'utf8'));
let changed = 0;
for (const a of scan.assets) {
  const i = index.assets.findIndex(x => x.assetId === a.assetId);
  if (i < 0) { index.assets.push(a); changed++; }
  else if (JSON.stringify(index.assets[i]) !== JSON.stringify(a)) { index.assets[i] = a; changed++; }
}
index.assetCount = index.assets.length;
if (changed) fs.writeFileSync(file, scanner.serialise(index));
console.log('BOSS5 VFX assets:', scan.assets.map(a => a.assetId).join(', '), changed ? '(updated)' : '(unchanged)');
