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

function statRow(context, groupTitle, labelText) {
  const group = context.STAT_GROUPS.find((g) => g.title === groupTitle);
  assert.ok(group, `找不到屬性群組：${groupTitle}`);
  const row = group.rows.find((r) => r[0].includes(labelText));
  assert.ok(row, `找不到屬性列：${labelText}`);
  return row;
}

function descOf(row, st = {}) {
  return typeof row[2] === 'function' ? row[2](st) : row[2];
}

test('敏捷 tooltip 由派生係數產生，係數為 0 時不顯示該效果', () => {
  const context = loadContext();
  context.PRIMARY_STAT_EFFECTS.agiCritRate = 0.42;
  context.PRIMARY_STAT_EFFECTS.agiAspdPct = 0.15;
  context.PRIMARY_STAT_EFFECTS.agiEvasion = 0;

  const html = descOf(statRow(context, '基礎屬性', '敏捷'));

  assert.match(html, /0\.42% 暴擊率/);
  assert.match(html, /0\.15% 攻速/);
  assert.doesNotMatch(html, /閃避率/);
});

test('上限為 0 的屬性說明不顯示上限或無上限字樣', () => {
  const context = loadContext();

  const evasionHtml = descOf(statRow(context, '防禦屬性', '閃避率'));
  assert.doesNotMatch(evasionHtml, /上限|無上限/);

  context.STAT_CAPS.blockDmgRed = 0;
  const blockDmgHtml = descOf(statRow(context, '防禦屬性', '格擋減傷'));
  assert.doesNotMatch(blockDmgHtml, /上限|無上限/);

  context.GLOBAL_DMG_RED_CAP = 0;
  const globalHtml = descOf(statRow(context, '防禦屬性', '全局減傷'), { globalDmgRed: 100000 });
  assert.doesNotMatch(globalHtml, /上限|無上限/);
  assert.match(globalHtml, /目前實際減傷/);
});

test('格擋實戰結算與 tooltip 使用同一個格擋減傷上限', () => {
  const context = loadContext();

  context.STAT_CAPS.blockDmgRed = 50;
  assert.equal(context.blockDmgRedTotalCap(), 80);
  assert.equal(context.blockDmgReduction(999), 80);

  context.STAT_CAPS.blockDmgRed = 0;
  assert.equal(context.blockDmgRedTotalCap(), 0);
  assert.equal(context.blockDmgReduction(999), 1029);
});

test('屬性面板加寬且屬性列不換行', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(css, /#stats-sidebar\s*\{[\s\S]*width:\s*236px/);
  assert.match(css, /\.attr-group \.stat-row\s*\{[\s\S]*display:\s*grid/);
  assert.match(css, /\.attr-group \.stat-row\s*\{[\s\S]*grid-template-columns:\s*max-content\s+max-content/);
  assert.match(css, /\.attr-group \.stat-row\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /\.attr-group \.stat-row span,\s*[\s\S]*\.attr-group \.stat-row b\s*\{[\s\S]*white-space:\s*nowrap/);
});
