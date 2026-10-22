'use strict';
// 原創 icearrow-renew 的切面座標，另製完全中性的飛彈底圖供白／藍／紫／黃共用。
// SVG 本身無藍色、無濾鏡；色調由 Preset tint 統一控制，原冰箭 PNG 保持。
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ASSET = 'codex-authored/missile-salvo/crystal-neutral.svg';
function svg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<path d="M491 256 143 209 83 231 49 267 139 305Z" fill="#929292"/>
<path d="M491 256 143 209 180 249Z" fill="#f0f0f0"/>
<path d="M491 256 180 249 139 305Z" fill="#a8a8a8"/>
<path d="M143 209 83 231 180 249Z" fill="#d5d5d5"/>
<path d="M83 231 49 267 180 249Z" fill="#747474"/>
<path d="M49 267 139 305 180 249Z" fill="#b8b8b8"/>
<path d="M491 256 202 262 180 249Z" fill="#ffffff"/>
<path d="M139 305 238 279 180 249Z" fill="#d2d2d2"/>
<path d="M49 267 180 249 491 256" fill="none" stroke="#ffffff" stroke-opacity=".85" stroke-width="2"/>
<path d="M118 224 185 249 151 287M202 239 243 255 216 282" fill="none" stroke="#eeeeee" stroke-opacity=".65"/>
</svg>\n`;
}
function bake(register = true) {
  const root = path.resolve(__dirname, '../../../..');
  const library = require('../../vfx-library-root.cjs').resolveLibraryRoot({}).root;
  const buf = Buffer.from(svg());
  for (const base of [path.join(root, 'images/vfx/assets'), library]) {
    const dest = path.join(base, ASSET); fs.mkdirSync(path.dirname(dest), { recursive:true }); fs.writeFileSync(dest, buf);
  }
  if (register) {
    const file = path.join(root, 'vfx/asset-index.json'), index = JSON.parse(fs.readFileSync(file));
    const entry = { assetId:ASSET, package:'codex-authored', relativePath:ASSET, format:'svg', fileSize:buf.length,
      contentHash:'sha256:'+crypto.createHash('sha256').update(buf).digest('hex'),
      facts:{ dimensions:{width:512,height:512}, hasAlpha:true } };
    const at = index.assets.findIndex(a => a.assetId === ASSET);
    if (at < 0) index.assets.push(entry); else index.assets[at] = entry;
    index.assetCount = index.assets.length; fs.writeFileSync(file, JSON.stringify(index, null, 2)+'\n');
  }
}
module.exports = { ASSET, svg, bake };
if (require.main === module) bake();
