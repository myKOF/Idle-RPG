'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const iconFiles = [
  'icon_weapon_sword1h.png', 'icon_weapon_dagger1h.png', 'icon_weapon_wand1h.png',
  'icon_weapon_magic_sword1h.png', 'icon_weapon_greatsword2h.png', 'icon_weapon_axe2h.png',
  'icon_weapon_staff2h.png', 'icon_weapon_magic_sword2h.png', 'icon_weapon_shield.png',
  'icon_weapon_focus.png', 'icon_weapon_spellbook.png', 'icon_weapon_orb.png'
];

test('所有武器圖示都是帶 alpha 通道的 RGBA PNG', () => {
  for (const filename of iconFiles) {
    const bytes = fs.readFileSync(path.join(root, 'images', filename));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${filename} is not a PNG`);
    // PNG IHDR 的 color type 6 代表 RGBA，確保背景可以透明而不是純 RGB 黑底。
    assert.equal(bytes[25], 6, `${filename} does not expose an alpha channel`);
  }
});
