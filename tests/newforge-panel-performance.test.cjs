const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'js', 'worker', 'sim.worker.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unterminated function ' + name);
}

test('熔爐面板只傳佇列摘要，不複製大量完整裝備物件', () => {
  const context = { NEW_FORGE_BELT_SHOW: 30 };
  vm.createContext(context);
  vm.runInContext(extractFunction(worker, 'newForgePanelView'), context);

  const item = { id: 'full-item', rarity: 2, slot: 'weapon', name: '保留名稱', affixes: [{ key: 'atkFlat', val: 999 }] };
  const view = context.newForgePanelView({
    queue: Array.from({ length: 8415 }, () => item),
    furnaces: [{
      id: 1,
      enabled: true,
      qualities: [true, false],
      parts: [{ key: 'speedGear', tier: 5 }],
      partSlots: 3,
      queue: Array.from({ length: 9999 }, () => item),
      belt: [item],
    }],
    stats: { salvaged: 12, kept: 3 },
    tabSeen: true,
    noticeShown: true,
    partLevels: { speedGear: 5 },
    ownedParts: { speedGear: 5 },
    partUpgradeCosts: { speedGear: 123 },
  });

  assert.equal(view.queueCount, 8415);
  assert.equal(view.furnaces[0].queueCount, 9999);
  assert.equal(JSON.stringify(view.furnaces[0].belt[0]), JSON.stringify({ rarity: 2, slot: 'weapon', name: '保留名稱' }));
  assert.equal(JSON.stringify(view.furnaces[0].parts), JSON.stringify([{ key: 'speedGear' }]));
  assert.equal(view.furnaces[0].belt[0].affixes, undefined);
  assert.equal(view.furnaces[0].queue, undefined);
  assert.equal(view.queue, undefined);
  assert.equal(view.partLevels, undefined,
    '零件等級不應從 newForge 物件投影；UI 應回退使用 factory.partLevels');
});

test('零件升級按鈕只在內容變更時重繪，保留 pending 的 disabled 狀態', () => {
  assert.match(ui, /setHtmlIfChanged\(upgradeBox, nfPartUpgradesHTML\(factory, player, nf\)\)/);
  assert.match(ui, /queueCount !== undefined/);
});
