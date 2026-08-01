const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dataSource = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

const weaponTypes = [
  'sword1h', 'dagger1h', 'wand1h', 'magicSword1h',
  'greatsword2h', 'axe2h', 'staff2h', 'magicSword2h',
  'shield', 'focus', 'spellbook', 'orb'
];

test('每種武器類型都有獨立圖示素材與資料映射', () => {
  for (const type of weaponTypes) {
    const filename = type === 'magicSword1h'
      ? 'icon_weapon_magic_sword1h.png'
      : type === 'magicSword2h'
        ? 'icon_weapon_magic_sword2h.png'
        : `icon_weapon_${type}.png`;
    const filePath = path.join(root, 'images', filename);
    assert.equal(fs.existsSync(filePath), true, `missing ${filename}`);
    const signature = fs.readFileSync(filePath).subarray(0, 8).toString('hex');
    assert.equal(signature, '89504e470d0a1a0a', `${filename} is not a PNG`);
    assert.match(dataSource, new RegExp(`${type}: ['"]${filename.replace('.', '\\.')}`));
  }
});

test('裝備欄、背包與神鑄素材槽共用武器類型圖示選擇器', () => {
  assert.match(uiSource, /function itemIconFile\(it, info\)/);
  assert.equal((uiSource.match(/itemIconFile\(it, info\)/g) || []).length >= 4, true);
  assert.match(uiSource, /var weaponIcon = \(typeof weaponIconForItem === 'function'\)/);
});
