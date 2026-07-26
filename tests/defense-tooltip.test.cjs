const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function statRow(context, labelText) {
  const defense = context.STAT_GROUPS.find((group) => group.title === '防禦屬性');
  assert.ok(defense);
  return defense.rows.find((row) => row[0].includes(labelText));
}

test('物理與魔法防禦 tooltip 底部以黃色顯示目前同級減傷率', () => {
  const context = loadContext();
  const st = {
    level: 10,
    def: 1000,
    mdef: 500,
    base: { def: 100, mdef: 50 },
    A: { defFlat: 0, mdefFlat: 0, defPct: 0 }
  };

  const physicalHtml = statRow(context, '物理防禦')[2](st);
  const magicHtml = statRow(context, '魔法防禦')[2](st);

  assert.match(physicalHtml, /color:#ffd700/);
  assert.match(physicalHtml, /目前同級減傷率：87\.7192%/);
  assert.match(magicHtml, /color:#ffd700/);
  assert.match(magicHtml, /目前同級減傷率：78\.1250%/);
});

test('防禦 tooltip 減傷率截斷到小數四位且不會進位成 100%', () => {
  const context = loadContext();
  const st = {
    level: 1174,
    def: 2260000000,
    mdef: 2260000000,
    base: { def: 77400000, mdef: 77400000 },
    A: { defFlat: 0, mdefFlat: 0, defPct: 2823.9 }
  };

  const physicalHtml = statRow(context, '物理防禦')[2](st);

  assert.match(physicalHtml, /目前同級減傷率：99\.9995%/);
  assert.doesNotMatch(physicalHtml, /目前同級減傷率：100(?:\.0000)?%/);
});
