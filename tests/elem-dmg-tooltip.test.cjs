/* 頂欄物傷/魔傷浮動面板最大屬性提升/對屬性敵最大加成計算測試 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadGameContext() {
  const elements = {};
  const createMock = (id) => ({
    id,
    textContent: '',
    style: {},
    parentNode: {
      setAttribute: (attr, val) => {
        elements[id + ':' + attr] = val;
      },
      removeAttribute: () => {}
    }
  });

  const domMap = {
    'r-phys-absorb': createMock('r-phys-absorb'),
    'r-magic-absorb': createMock('r-magic-absorb'),
    'r-phys-dmg': createMock('r-phys-dmg'),
    'r-magic-dmg': createMock('r-magic-dmg')
  };

  const context = {
    console,
    location: { hostname: 'localhost' },
    UI: { dirty: {} },
    elements,
    document: {
      getElementById: (id) => domMap[id] || null,
      querySelector: () => null,
      querySelectorAll: () => []
    }
  };

  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  return context;
}

test('頂欄物傷與魔傷浮動提示正確讀取 st.elemDmgUp 與 st.dmgVsElem 的 6 系最大值', () => {
  const ctx = loadGameContext();

  const st = {
    atk: 1000,
    matk: 2000,
    critDmg: 200,
    totalDmgPct: 0,
    normalDmg: 0,
    eliteDmg: 0,
    bossDmg: 0,
    dmgVsElem: { fire: 60, ice: 0, lightning: 0, poison: 0, light: 0, dark: 0 },
    elemDmgUp: { fire: 233, ice: 0, lightning: 0, poison: 0, light: 0, dark: 0 }
  };

  ctx.uiHeaderPanelSnapshot = () => ({ stats: st });
  ctx.uiBattlePanelSnapshot = () => ({ field: {} });

  ctx.updateDmgAbsorb();

  const physDesc = ctx.elements['r-phys-dmg:data-tt-desc'];
  const magicDesc = ctx.elements['r-magic-dmg:data-tt-desc'];

  assert.ok(physDesc, '物傷應有 data-tt-desc');
  assert.ok(magicDesc, '魔傷應有 data-tt-desc');

  assert.match(physDesc, /對屬性敵最大加成：<\/span>60\.0%/);
  assert.match(physDesc, /屬性傷害最大提升：<\/span>233\.0%/);

  assert.match(magicDesc, /對屬性敵最大加成：<\/span>60\.0%/);
  assert.match(magicDesc, /屬性傷害最大提升：<\/span>233\.0%/);
});

test('refreshOpenStatTooltip 在提示開啟時能實時刷新物傷、魔傷、物承、魔承 Tooltip 內容', () => {
  const createMockParentNode = () => {
    const attrs = {};
    return {
      hasAttribute: (attr) => attr in attrs,
      getAttribute: (attr) => attrs[attr] || null,
      setAttribute: (attr, val) => { attrs[attr] = val; },
      removeAttribute: (attr) => { delete attrs[attr]; },
      classList: { contains: () => false }
    };
  };

  const physAnchor = createMockParentNode();
  const magicAnchor = createMockParentNode();
  const physDmgAnchor = createMockParentNode();
  const magicDmgAnchor = createMockParentNode();

  const skTooltip = {
    id: 'sk-tooltip',
    style: { display: 'block' },
    innerHTML: ''
  };

  const domMap = {
    'sk-tooltip': skTooltip,
    'r-phys-absorb': { parentNode: physAnchor },
    'r-magic-absorb': { parentNode: magicAnchor },
    'r-phys-dmg': { parentNode: physDmgAnchor },
    'r-magic-dmg': { parentNode: magicDmgAnchor }
  };

  const ctx = {
    console,
    location: { hostname: 'localhost' },
    UI: { dirty: {}, tooltipAnchor: physAnchor },
    document: {
      getElementById: (id) => domMap[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { contains: () => true }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  });

  ctx.UI.tooltipAnchor = physAnchor;

  let currentHp = 1000;
  ctx.uiHeaderPanelSnapshot = () => ({ stats: { hp: 10000, atk: 100, def: 50, level: 1 } });
  ctx.uiBattlePanelSnapshot = () => ({ field: { player: { hp: currentHp, shield: 200 } } });

  // 第一次算：當前血量 1,000
  ctx.updateDmgAbsorb();
  ctx.refreshOpenStatTooltip();

  assert.ok(skTooltip.innerHTML.includes('1,000'), '內文應包含當前血量 1,000');
  assert.ok(skTooltip.innerHTML.includes('200'), '內文應包含當前護盾 200');

  // 戰鬥扣血變 500
  currentHp = 500;
  ctx.updateDmgAbsorb();
  ctx.refreshOpenStatTooltip();

  // 驗證內文實時刷新為 500
  assert.ok(skTooltip.innerHTML.includes('500'), '內文應實時刷新為當前血量 500');
});

