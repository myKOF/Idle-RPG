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
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js'].forEach((file) => {
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

test('same-name skills keep independent damage buckets and display level suffixes', () => {
  const context = loadCombatContext();
  context.G = { stage: { current: 1 } };
  const skillName = '\u706b\u7403\u8853';
  context.RUN_STATS = {
    runCount: 1,
    maxStage: 1,
    skills: {}
  };
  context.recordRunDamage(skillName, 100, 'skill:0:fireball-a:300', 300);
  context.recordRunDamage(skillName, 50, 'skill:1:fireball-b:300', 300);

  const html = context.generateSummaryHtml(true);
  assert.match(html, /\u706b\u7403\u8853\(300\u7d1a\)1/);
  assert.match(html, /\u706b\u7403\u8853\(300\u7d1a\)2/);
  assert.match(html, /100/);
  assert.match(html, /50/);
});

test('傷害統計不限制技能筆數，超過 11 筆仍全部輸出', () => {
  const context = loadCombatContext();
  context.G = { stage: { current: 1 } };
  context.RUN_STATS = { runCount: 1, maxStage: 1, skills: {} };

  for (let i = 0; i < 20; i += 1) {
    context.recordRunDamage('測試技能' + i, i + 1, 'skill:' + i, 1);
  }

  const html = context.generateSummaryHtml(true);
  for (let i = 0; i < 20; i += 1) assert.match(html, new RegExp('測試技能' + i));
});

test('傷害統計按傷害由高至低排序且傷害數字使用簡寫', () => {
  const context = loadCombatContext();
  context.G = { stage: { current: 1 } };
  context.RUN_STATS = { runCount: 1, maxStage: 1, skills: {} };

  context.recordRunDamage('低傷害技能', 500, 'skill:low', 1);
  context.recordRunDamage('高傷害技能', 1500000000, 'skill:high', 1);
  context.recordRunDamage('中傷害技能', 2000000, 'skill:mid', 1);

  const html = context.generateSummaryHtml(true);
  // 高傷害 (1.5B) -> 中傷害 (2M) -> 低傷害 (500)
  const posHigh = html.indexOf('高傷害技能');
  const posMid = html.indexOf('中傷害技能');
  const posLow = html.indexOf('低傷害技能');

  assert.ok(posHigh !== -1 && posMid !== -1 && posLow !== -1, '所有技能應在 HTML 中');
  assert.ok(posHigh < posMid, '高傷害技能應在 mid 上方');
  assert.ok(posMid < posLow, '中傷害技能應在 low 上方');

  // 簡寫驗證：1.50B, 2.00M, 500
  assert.match(html, /傷害 1\.50B/);
  assert.match(html, /傷害 2\.00M/);
  assert.match(html, /傷害 500/);
});
