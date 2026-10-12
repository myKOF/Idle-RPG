/* 角色面板置頂區「攻擊」與「堅韌」綜合數值及 Tooltip 測試 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadGameContext() {
  const elements = {};
  const createMock = (id) => {
    const el = {
      id,
      textContent: '',
      style: {},
      children: [],
      classList: {
        contains: () => false,
        add: () => {},
        remove: () => {},
        toggle: () => {}
      },
      attributes: {},
      setAttribute: (attr, val) => {
        el.attributes[attr] = val;
        elements[id + ':' + attr] = val;
      },
      getAttribute: (attr) => el.attributes[attr] || null,
      removeAttribute: (attr) => {
        delete el.attributes[attr];
        delete elements[id + ':' + attr];
      }
    };
    return el;
  };

  const charCore = createMock('char-core');
  const atkTile = createMock('char-core-atk');
  const atkVal = createMock('char-core-atk-val');
  const toughnessTile = createMock('char-core-toughness');
  const toughnessVal = createMock('char-core-toughness-val');
  const attrPanel = createMock('attr-panel');

  atkVal.parentNode = atkTile;
  toughnessVal.parentNode = toughnessTile;

  const domMap = {
    'char-core': charCore,
    'char-core-atk': atkTile,
    'char-core-atk-val': atkVal,
    'char-core-toughness': toughnessTile,
    'char-core-toughness-val': toughnessVal,
    'attr-panel': attrPanel,
    'r-phys-absorb': createMock('r-phys-absorb'),
    'r-magic-absorb': createMock('r-magic-absorb'),
    'r-phys-dmg': createMock('r-phys-dmg'),
    'r-magic-dmg': createMock('r-magic-dmg')
  };

  const context = {
    console,
    location: { hostname: 'localhost' },
    UI: { dirty: {}, tab: 'char' },
    elements,
    document: {
      getElementById: (id) => domMap[id] || null,
      querySelector: (sel) => {
        if (sel === '#char-core [data-core="0"]') return atkVal;
        if (sel === '#char-core [data-core="1"]') return toughnessVal;
        return null;
      },
      querySelectorAll: () => []
    }
  };

  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  return { ctx: context, charCore, atkTile, atkVal, toughnessTile, toughnessVal };
}

test('buildCharCoreTiles 正確生成「攻擊」與「堅韌」兩個置頂方塊', () => {
  const { ctx, charCore } = loadGameContext();

  ctx.buildCharCoreTiles();

  assert.ok(charCore.innerHTML.includes('char-core-atk'), '應包含 char-core-atk');
  assert.ok(charCore.innerHTML.includes('char-core-toughness'), '應包含 char-core-toughness');
  assert.ok(charCore.innerHTML.includes('⚔️ 攻擊'), '應包含 ⚔️ 攻擊 標題');
  assert.ok(charCore.innerHTML.includes('🛡️ 堅韌'), '應包含 🛡️ 堅韌 標題');
});

test('updateCharCoreSummary 正確計算 (物傷+魔傷)/2 與 (物承+魔承)/2 並設定專用 Tips', () => {
  const { ctx, atkTile, atkVal, toughnessTile, toughnessVal } = loadGameContext();

  const st = {
    atk: 1000,
    matk: 2000,
    critDmg: 200,
    totalDmgPct: 0,
    normalDmg: 0,
    eliteDmg: 0,
    bossDmg: 0,
    hp: 10000,
    def: 50,
    mdef: 50,
    pRes: 0,
    mRes: 0,
    level: 1,
    dmgVsElem: { fire: 0, ice: 0, lightning: 0, poison: 0, light: 0, dark: 0, earth: 0 },
    elemDmgUp: { fire: 0, ice: 0, lightning: 0, poison: 0, light: 0, dark: 0, earth: 0 }
  };

  ctx.uiHeaderPanelSnapshot = () => ({ stats: st });
  ctx.uiBattlePanelSnapshot = () => ({ field: { player: { hp: 10000, shield: 0 } } });

  ctx.buildCharCoreTiles();
  ctx.updateCharCoreSummary(st);

  // 1. 驗證攻擊：物傷=1000*2=2000，魔傷=2000*2=4000，平均=(2000+4000)/2=3000
  assert.equal(atkVal.textContent, '3.00K', '攻擊應顯示為 3.00K');
  assert.equal(atkTile.attributes['data-tt-title'], '綜合攻擊力 (攻擊)');
  const atkDesc = atkTile.attributes['data-tt-desc'];
  assert.ok(atkDesc.includes('角色的綜合攻擊能力，包含了物理、魔法、攻速、暴擊及元素等綜合的攻擊強度評價'));
  assert.ok(!atkDesc.includes('計算公式：'), '攻擊 Tips 不應包含計算公式行');

  // 2. 驗證堅韌：減傷後承傷平均值
  assert.ok(toughnessVal.textContent.length > 0, '堅韌應有顯示值');
  assert.equal(toughnessTile.attributes['data-tt-title'], '綜合生存能力 (堅韌)');
  const toughnessDesc = toughnessTile.attributes['data-tt-desc'];
  assert.ok(toughnessDesc.includes('角色的綜合生存能力，包含了物防、法防、生命及各類抗性、減傷的綜合評價'));
  assert.ok(!toughnessDesc.includes('計算公式：'), '堅韌 Tips 不應包含計算公式行');
});

test('戰鬥扣血時 updateCharCoreSummary 能動態實時更新堅韌值', () => {
  const { ctx, toughnessVal } = loadGameContext();

  const st = {
    atk: 1000,
    matk: 2000,
    hp: 10000,
    def: 0,
    mdef: 0,
    level: 1
  };

  let currentHp = 10000;
  ctx.uiHeaderPanelSnapshot = () => ({ stats: st });
  ctx.uiBattlePanelSnapshot = () => ({ field: { player: { hp: currentHp, shield: 0 } } });

  ctx.buildCharCoreTiles();
  ctx.updateCharCoreSummary(st);
  const fullHpToughness = toughnessVal.textContent;

  // 受傷扣血
  currentHp = 5000;
  ctx.updateCharCoreSummary(st);
  const halfHpToughness = toughnessVal.textContent;

  assert.notEqual(fullHpToughness, halfHpToughness, '血量變化時堅韌值應動態更新');
});
