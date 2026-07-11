const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('神鑄時間依裝備品質與寶石階級符合規格', () => {
  const dataJs = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  const context = {
    FORGE_EQUIP_DURATION: { 5: 3, 6: 5, 7: 8 },
    FORGE_GEM_DURATION: { 5: 2, 6: 3, 7: 4, 8: 5, 9: 6 }
  };
  assert.match(dataJs, /FORGE_EQUIP_DURATION\s*=\s*\{\s*5:\s*3,\s*6:\s*5,\s*7:\s*8\s*\}/);
  assert.match(dataJs, /FORGE_GEM_DURATION\s*=\s*\{\s*5:\s*2,\s*6:\s*3,\s*7:\s*4,\s*8:\s*5,\s*9:\s*6\s*\}/);
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/forge.js'), 'utf8'), context, { filename: 'js/forge.js' });

  assert.equal(context.forgeDurationSeconds('equip', 5), 3);
  assert.equal(context.forgeDurationSeconds('equip', 6), 5);
  assert.equal(context.forgeDurationSeconds('equip', 7), 8);
  assert.equal(context.forgeDurationSeconds('gem', 5), 2);
  assert.equal(context.forgeDurationSeconds('gem', 9), 6);
});

test('神鑄使用可保存的鑄造狀態並由主迴圈完成結算', () => {
  const forgeJs = fs.readFileSync(path.join(root, 'js/forge.js'), 'utf8');
  const mainJs = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(forgeJs, /f\.crafting\s*=/);
  assert.match(forgeJs, /function forgeTick\(/);
  assert.match(mainJs, /forgeTick\(/);
  assert.match(uiJs, /function renderForgeProgress\(/);
  assert.match(uiJs, /forge-progress-countdown/);
  assert.match(html, /id="forge-autoforge"/);
  assert.match(html, /id="forge-progress"/);
});
