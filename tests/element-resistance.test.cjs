const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.chance = (pct) => Number(pct) >= 100;
  context.rnd = () => 1;
  return context;
}

function hit(context, dCfg, aCfg = {}) {
  const defender = { hp: 100000, shield: 0, effects: {}, dots: [] };
  const result = context.resolveHit({}, defender, {
    atk: 0,
    dmgType: 'magic',
    level: 1,
    hit: 100,
    elemAtk: { fire: 100 },
    ...aCfg
  }, Object.assign({ dodge: 0, mdef: 0, mRes: 0, resist: {} }, dCfg));
  return result.dmg;
}

test('physical and magic resistance convert percentage points before applying curve', () => {
  /* 要驗的是「抗性值以百分點原值進曲線」與「各自帶對的曲線參數」，
     不是「等於某個特定小數」。

     ⚠️ 期望值一律由遊戲自己的通用曲線 resistanceReduction() 搭配遊戲自己的常數算出。
     寫死小數的話，參數表「3-戰鬥核心／物理抗性減傷」一被調整這裡就紅——
     而紅的不是 bug，只是數值換了。實際發生過：指數 1.8→1.5、base 10→20 之後，
     這個測試立刻失敗，但轉換邏輯完全正常。 */
  const context = loadFormulaContext();
  const level = 71;

  const expectedPhys = 1 - context.PHYSICAL_RESISTANCE_A /
    (1 + Math.pow((46.6 / 100) / context.PHYSICAL_RESISTANCE_B, context.PHYSICAL_RESISTANCE_C));
  const expectedMagic = 1 - context.MAGIC_RESISTANCE_A /
    (1 + Math.pow((38.8 / 100) / context.MAGIC_RESISTANCE_B, context.MAGIC_RESISTANCE_C));

  assert.equal(context.physicalResistanceReduction(46.6, level), expectedPhys);
  assert.equal(context.magicResistanceReduction(38.8, level), expectedMagic);

  const screenshotValue = context.physicalResistanceReduction(141.45);
  const expectedScreenshotValue = 1 - context.PHYSICAL_RESISTANCE_A /
    (1 + Math.pow((141.45 / 100) / context.PHYSICAL_RESISTANCE_B, context.PHYSICAL_RESISTANCE_C));
  assert.equal(screenshotValue, expectedScreenshotValue);

  /* 單位：46.6 代表 46.6 個百分點，不是 0.466。兩者不能給出同一個結果，
     否則就是某處多除或少除了 100。 */
  assert.notEqual(context.physicalResistanceReduction(46.6, level),
                  context.physicalResistanceReduction(0.466, level));
  assert.ok(context.physicalResistanceReduction(46.6, level) >
            context.physicalResistanceReduction(0.466, level),
    '抗性值愈大減傷應愈多——若相反代表輸入被當成小數比例了');
});

test('元素抗性會減免對應的元素附傷', () => {
  const context = loadFormulaContext();
  assert.equal(hit(context, {}), 100);
  const expected = 100 * (1 - context.elementalResistanceReduction(50, 1));
  assert.equal(hit(context, { resist: { fire: 50 } }), Math.round(expected));
});

test('魔法抗性不會重複減免元素附傷', () => {
  const context = loadFormulaContext();
  assert.equal(hit(context, { mRes: 60 }), 100);
  assert.ok(context.magicResistanceReduction(60, 1) > 0);
});

test('物理、魔法與元素抗性均不再套用上限，且各自使用獨立曲線參數', () => {
  const context = loadFormulaContext();
  const highResistance = 1000;
  const expected = Math.max(1, Math.round(100 * (1 - context.physicalResistanceReduction(highResistance, 1))));
  assert.equal(hit(context, { pRes: highResistance }, { dmgType: 'phys', atk: 100, elemAtk: {} }), expected);
  assert.equal(context.physicalResistanceReduction(1000, 1), context.magicResistanceReduction(1000, 1));
  assert.equal(context.elementalResistanceReduction(1000, 1), context.physicalResistanceReduction(1000, 1));
  context.PHYSICAL_RESISTANCE_B = 18;
  context.MAGIC_RESISTANCE_B = 100;
  assert.notEqual(context.physicalResistanceReduction(60, 1), context.magicResistanceReduction(60, 1));
});
