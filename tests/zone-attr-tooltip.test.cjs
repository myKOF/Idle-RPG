/* 地圖切頁與敵人情報屬性標籤 Tips 顯示測試 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadGameContext() {
  const elements = {};
  const mockBox = {
    innerHTML: ''
  };
  const mockTip = {
    innerHTML: '',
    style: {},
    offsetWidth: 200,
    offsetHeight: 200
  };

  const context = {
    console,
    location: { hostname: 'localhost' },
    UI: { dirty: {} },
    elements,
    document: {
      getElementById: (id) => {
        if (id === 'zone-tabs') return mockBox;
        if (id === 'sk-tooltip') return mockTip;
        return null;
      },
      querySelector: () => null,
      querySelectorAll: () => []
    }
  };

  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  context.mockBox = mockBox;
  context.mockTip = mockTip;
  return context;
}

test('地圖切頁 Tips 正確加入主要敵人屬性圖示與文字 (沼澤: 🟢 毒屬性 🟣 暗屬性)', () => {
  const ctx = loadGameContext();
  ctx.uiHeaderPanelSnapshot = () => ({ stage: { zone: 'swamp', current: 1 } });
  ctx.activeRealm = () => 'human';
  ctx.zoneBestOf = () => 100;

  ctx.renderSceneTabs();

  const html = ctx.mockBox.innerHTML;
  assert.match(html, /主要敵人屬性：🟢 毒屬性 🟣 暗屬性/);
});

test('敵人情報 Tips 置頂區顯示屬性標籤，下方不再重複顯示 🌌 屬性：', () => {
  const ctx = loadGameContext();
  ctx.uiHeaderPanelSnapshot = () => ({ stage: { zone: 'swamp', current: 1 } });
  ctx.uiBattlePanelSnapshot = () => ({
    field: {
      monster: { name: '劇毒蛙', attr: 'poison', atk: 100, aspd: 1, def: 50, mdef: 50, maxHp: 1000, hit: 100, dodge: 0 }
    }
  });

  const dummyTarget = { id: 'btn-enemy-tip', getBoundingClientRect: () => ({ left: 0, right: 10, top: 0, bottom: 10 }) };
  ctx.showEnemyTooltip(dummyTarget);

  const showContent = ctx.mockTip.innerHTML;
  assert.ok(showContent, '應有 Tooltip 內容');
  assert.match(showContent, /【敵人情報】.*🟢 毒屬性/s);
  assert.doesNotMatch(showContent, /🌌 屬性：/);
});
