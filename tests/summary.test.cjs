const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCombatContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, document: {}, Math: Object.create(Math) };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('結算摘要可產生目前戰鬥即時統計標記', () => {
  const context = loadCombatContext();
  context.G = { stage: { current: 144 } };
  context.RUN_STATS = {
    runCount: 3,
    maxStage: 144,
    skills: { 普攻: { count: 4, damage: 120000 } }
  };

  const html = context.generateSummaryHtml(true);
  assert.match(html, /目前戰鬥（即時統計）/);
  assert.match(html, /data-summary-current/);
  assert.match(html, /普攻/);
});
