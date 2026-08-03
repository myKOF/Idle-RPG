const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadContext() {
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(read(file), context, { filename: file });
  });
  return context;
}

function resolveWithRandomRoll(context, randomFraction) {
  const rolls = [0.01, randomFraction, 0.01];
  context.Math.random = () => rolls.shift() ?? 0;
  return context.resolveHit(
    { hp: 1000 },
    { def: 0, mdef: 0, pRes: 0, mRes: 0, dodge: 0, tenacity: 0, resist: {} },
    { atk: 100, dmgType: 'phys', level: 1, hit: 100, pen: 0, sunder: 0, critRate: 100, critDmg: 150 },
    { def: 0, mdef: 0, pRes: 0, mRes: 0, dodge: 0, tenacity: 0, resist: {} }
  );
}

test('共用傷害浮動範圍為 80%～120%', () => {
  const context = loadContext();
  const low = resolveWithRandomRoll(context, 0);
  const high = resolveWithRandomRoll(context, 0.999999);
  assert.equal(low.randomDamageMultiplier, 0.8);
  assert.ok(high.randomDamageMultiplier < 1.2);
  assert.ok(high.randomDamageMultiplier > 1.199);
});

test('暴擊隨機倍率達 119.5% 才標記高倍率暴擊', () => {
  const context = loadContext();
  const justBelow = resolveWithRandomRoll(context, 0.9874); // 1.19496
  const atThreshold = resolveWithRandomRoll(context, 0.9875); // 1.195
  assert.equal(justBelow.crit, true);
  assert.equal(justBelow.highCritRandomRoll, false);
  assert.equal(atThreshold.crit, true);
  assert.ok(Math.abs(atThreshold.randomDamageMultiplier - 1.195) < 1e-12);
  assert.equal(atThreshold.highCritRandomRoll, true);
});

test('高倍率暴擊飄字會讀取加倍後的 CSS 存在時間', () => {
  const ui = read('js/ui.js');
  assert.ok(ui.includes('var calcMatch = raw.match(/^calc\\('));
  assert.ok(ui.includes("return (calcMatch[2].toLowerCase() === 'ms' ? baseValue : baseValue * 1000) * multiplier;"));
});
