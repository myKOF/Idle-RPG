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
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/worker/protocol.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  context.mockBox = mockBox;
  context.mockTip = mockTip;
  return context;
}

test('地圖切頁 Tips 正確加入主要敵人屬性圖示與文字 (沼澤: 🟢 毒屬性 (50%) 🟣 暗屬性 (46.7%))', () => {
  const ctx = loadGameContext();
  ctx.UI_WORKER_STATE.panels.header = { stage: { zone: 'swamp', current: 1 } };
  ctx.activeRealm = () => 'human';
  ctx.zoneBestOf = () => 100;

  ctx.renderSceneTabs();

  const html = ctx.mockBox.innerHTML;
  assert.match(html, /主要敵人屬性：🟢 毒屬性 \(\d+(\.\d+)?%\)/);
  assert.match(html, /🟣 暗屬性 \(\d+(\.\d+)?%\)/);
});

test('敵人情報 Tips 置頂區顯示屬性標籤，下方不再重複顯示 🌌 屬性：', () => {
  const ctx = loadGameContext();
  ctx.UI_WORKER_STATE.panels.header = { stage: { zone: 'swamp', current: 1 } };
  ctx.UI_WORKER_STATE.panels.battle = {
    field: {
      monster: { name: '劇毒蛙', attr: 'poison', atk: 100, aspd: 1, def: 50, mdef: 50, maxHp: 1000, hit: 100, dodge: 0 }
    }
  };

  const dummyTarget = { id: 'btn-enemy-tip', getBoundingClientRect: () => ({ left: 0, right: 10, top: 0, bottom: 10 }) };
  ctx.showEnemyTooltip(dummyTarget);

  const showContent = ctx.mockTip.innerHTML;
  assert.ok(showContent, '應有 Tooltip 內容');
  assert.match(showContent, /【敵人情報】.*🟢 毒屬性/s);
  assert.doesNotMatch(showContent, /🌌 屬性：/);
});

test('renderZoneBar Tips 也包含主要敵人屬性，且前圖 Boss 未擊敗時後續場景為鎖定狀態', () => {
  const ctx = loadGameContext();
  ctx.UI_WORKER_STATE.panels.header = { stage: { zone: 'swamp', current: 400, best: 400 } };
  ctx.UI_WORKER_STATE.panels.battle = {
    zoneProgress: { desert: { best: 200, cleared: 200 }, Icefield: { best: 300, cleared: 300 }, swamp: { current: 400, best: 400, cleared: 399 } }
  };
  ctx.$id = (id) => (id === 'zone-bar' ? ctx.mockBox : null);

  ctx.renderZoneBar();

  const html = ctx.mockBox.innerHTML;
  // 1. 驗證 renderZoneBar 按鈕 Tips 包含主要敵人屬性與百分佔比
  assert.match(html, /主要敵人屬性：🟢 毒屬性 \(\d+(\.\d+)?%\)/);

  // 2. 驗證進入 400 關尚未打敗 Boss (cleared = 399) 時，亡靈山脈為鎖定狀態
  assert.match(html, /class="zone-btn locked"[^>]*data-zone="undead_mountains"/);
  assert.match(html, /🔒 解鎖條件：需通關【沼澤】第 400 階段/);

  // 3. 打敗 Boss 400 (cleared = 400) 後解鎖亡靈山脈
  ctx.UI.zoneBarSignature = null;
  ctx.UI_WORKER_STATE.panels.battle = {
    zoneProgress: { desert: { best: 200, cleared: 200 }, Icefield: { best: 300, cleared: 300 }, swamp: { current: 400, best: 400, cleared: 400 } }
  };
  ctx.renderZoneBar();
  const htmlUnlocked = ctx.mockBox.innerHTML;
  assert.match(htmlUnlocked, /class="zone-btn"[^>]*data-zone="undead_mountains"/);
  assert.doesNotMatch(htmlUnlocked, /class="zone-btn locked"[^>]*data-zone="undead_mountains"/);
});

