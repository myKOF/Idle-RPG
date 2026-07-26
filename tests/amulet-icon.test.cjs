const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadSlotInfo() {
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8'), context, { filename: 'js/data.js' });
  return context.SLOT_INFO;
}

test('項鏈使用專用透明圖示，不再誤用寶石資源圖', () => {
  const slotInfo = loadSlotInfo();
  assert.equal(slotInfo.amulet.icon, 'icon_amulet.png');
  assert.notEqual(slotInfo.amulet.icon, 'icon_gems.png');

  const iconPath = path.join(root, 'images', slotInfo.amulet.icon);
  assert.equal(fs.existsSync(iconPath), true);
  const png = fs.readFileSync(iconPath);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png[25], 6, '項鏈圖示必須是 RGBA PNG');
});
