const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EQUIPMENT_ICONS = [
  'icon_weapon.png',
  'icon_helmet.png',
  'icon_shoulder.png',
  'icon_chest.png',
  'icon_belt.png',
  'icon_gloves.png',
  'icon_wrist.png',
  'icon_legs_armor.png',
  'icon_legs.png',
  'icon_ring.png',
];

function pngColorType(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${filePath} 必須是 PNG`);
  assert.equal(buffer.readUInt32BE(8), 13, `${filePath} 的 IHDR 長度不正確`);
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR', `${filePath} 缺少 IHDR`);
  return buffer[25];
}

for (const fileName of EQUIPMENT_ICONS) {
  const filePath = path.join(ROOT, 'images', fileName);
  assert.equal(pngColorType(filePath), 6, `${fileName} 必須使用 RGBA PNG 以保存透明背景`);
}
