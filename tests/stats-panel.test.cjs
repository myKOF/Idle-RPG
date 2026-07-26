const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadStatsContext() {
  const context = { console, Math: Object.create(Math), UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/stats.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('掉落統計可累計戰鬥場次、殺敵、金幣、裝備、材料與寶石', () => {
  const context = loadStatsContext();
  context.recordLootBattle();
  context.recordLootBattle();
  context.recordLootKill();
  context.recordLootKill(2);
  context.recordLootDeath();
  context.recordLootDeath(2);
  context.recordLootGold(100);
  context.recordLootGold(50);
  context.recordLootEquip(1);
  context.recordLootEquip(1);
  context.recordLootEquip(5, 3);
  context.recordLootMat('scrap', 7);
  context.recordLootMat('essence', 2);
  context.recordLootMat('scrap', 3);
  context.recordLootGem('topaz', 1, 1);
  context.recordLootGem('topaz', 1, 2);
  context.recordLootGem('amethyst', 2, 1);

  const st = context.LOOT_STATS;
  assert.equal(st.battles, 2);
  assert.equal(st.kills, 3);
  assert.equal(st.deaths, 3);
  assert.equal(st.gold, 150);
  assert.equal(st.equip[1], 2);
  assert.equal(st.equip[5], 3);
  assert.equal(st.mats.scrap, 10);
  assert.equal(st.mats.essence, 2);
  assert.equal(st.gems['topaz:1'], 3);
  assert.equal(st.gems['amethyst:2'], 1);
});

test('清理統計後全部歸零並重設起始時間', () => {
  const context = loadStatsContext();
  const beforeReset = context.LOOT_STATS;
  context.recordLootBattle();
  context.recordLootKill(5);
  context.recordLootDeath(2);
  context.recordLootGold(999);
  context.recordLootEquip(3);
  context.recordLootMat('dust', 1);
  context.recordLootGem('ruby', 1, 1);
  context.resetLootStats();

  const st = context.LOOT_STATS;
  assert.notEqual(st, beforeReset);
  assert.equal(st.battles, 0);
  assert.equal(st.kills, 0);
  assert.equal(st.deaths, 0);
  assert.equal(st.gold, 0);
  assert.equal(Object.keys(st.equip).length, 0);
  assert.equal(Object.keys(st.mats).length, 0);
  assert.equal(Object.keys(st.gems).length, 0);
  assert.ok(Date.now() - st.start < 5000);
});

test('掉落統計會分開記錄野外與其他來源', () => {
  const context = loadStatsContext();
  context.recordLootBattle('field');
  context.recordLootKill(undefined, 'field');
  context.recordLootDeath('field');
  context.recordLootGem('ruby', 1, 3, 'field');
  context.recordLootEquip(5, 2, 'field');
  context.recordLootMat('book', 4, 'field');
  context.recordLootDrop('field');
  context.recordLootBattle('tower');
  context.recordLootKill(undefined, 'tower');
  context.recordLootDeath(2, 'tower');
  context.recordLootGem('ruby', 1, 99, 'tower');

  assert.equal(context.LOOT_STATS.battles, 2);
  assert.equal(context.LOOT_STATS.kills, 2);
  assert.equal(context.LOOT_STATS.deaths, 3);
  assert.equal(context.LOOT_STATS.dropRolls, 1);
  assert.equal(context.LOOT_STATS.gems['ruby:1'], 102);
  assert.equal(context.LOOT_STATS.sources.field.battles, 1);
  assert.equal(context.LOOT_STATS.sources.field.kills, 1);
  assert.equal(context.LOOT_STATS.sources.field.deaths, 1);
  assert.equal(context.LOOT_STATS.sources.field.dropRolls, 1);
  assert.equal(context.LOOT_STATS.sources.field.gems['ruby:1'], 3);
  assert.equal(context.LOOT_STATS.sources.field.equip[5], 2);
  assert.equal(context.LOOT_STATS.sources.field.mats.book, 4);
  assert.equal(context.LOOT_STATS.sources.tower.deaths, 2);
  assert.equal(context.LOOT_STATS.sources.tower.gems['ruby:1'], 99);
});

test('野外統計 HTML 會顯示擊殺數與掉落結算次數', () => {
  const context = loadStatsContext();
  context.recordLootBattle('field');
  context.recordLootKill(undefined, 'field');
  context.recordLootDrop('field');
  const html = context.statsFieldBasicHtml();
  assert.match(html, /野外統計/);
  assert.match(html, /戰鬥場次/);
  assert.match(html, /殺敵數/);
  assert.match(html, /掉落結算/);
});

test('統計時間格式為 X時X分X秒', () => {
  const context = loadStatsContext();
  assert.equal(context.statsDurationStr(0), '0時0分0秒');
  assert.equal(context.statsDurationStr(59 * 1000), '0時0分59秒');
  assert.equal(context.statsDurationStr((3600 + 62) * 1000), '1時1分2秒');
  assert.equal(context.statsDurationStr((25 * 3600 + 30 * 60 + 9) * 1000), '25時30分9秒');
});

test('基本統計 HTML 含統計時間、戰鬥場次與殺敵數', () => {
  const context = loadStatsContext();
  context.recordLootBattle();
  context.recordLootKill(12);
  context.recordLootDeath(3);
  const html = context.statsBasicHtml();
  assert.match(html, /基本統計/);
  assert.match(html, /統計時間/);
  assert.match(html, /\d+時\d+分\d+秒/);
  assert.match(html, /戰鬥場次/);
  assert.match(html, /殺敵數/);
  assert.match(html, /死亡數/);
  assert.ok(html.indexOf('殺敵數') < html.indexOf('死亡數'));
  assert.match(html, /12/);
  assert.match(html, /3/);
});

test('掉落統計 HTML：品質分行上色、材料含圖示、寶石逐行、金幣完整數字', () => {
  const context = loadStatsContext();
  context.recordLootEquip(1, 100);
  context.recordLootEquip(5, 20);
  context.recordLootMat('scrap', 9999);
  context.recordLootMat('essence', 100);
  context.recordLootMat('dust', 3);
  context.recordLootGem('topaz', 1, 50);
  context.recordLootGem('amethyst', 2, 100);
  context.recordLootGold(1616660452785902000000);

  const html = context.statsLootHtml();
  assert.match(html, /掉落物統計/);
  // 品質裝備各自一行且使用品質色
  assert.match(html, new RegExp(context.RARITIES[1].color + '[^<]*">精良裝備'));
  assert.match(html, new RegExp(context.RARITIES[5].color + '[^<]*">傳說裝備'));
  assert.doesNotMatch(html, /普通裝備/); // 未取得的品質不顯示
  // 材料：有專用圖示者加圖示
  assert.match(html, /icon_scrap\.png[^>]*>[^<]*<[^>]*>裝備碎片/);
  assert.match(html, /icon_essence\.png[^>]*>[^<]*<[^>]*>附魔精華/);
  assert.match(html, /💫[^<]*<[^>]*>魔塵/);
  // 寶石：emoji＋階級＋名稱
  assert.match(html, /🟡<span[^>]*>一級黃玉/);
  assert.match(html, /🟣<span[^>]*>二級紫水晶/);
  // 金幣使用完整數字（千分位），不用 K/M 簡寫
  assert.match(html, /icon_gold\.png/);
  assert.match(html, /1,616,660,452,785,90/);
  assert.doesNotMatch(html, /金幣<\/span>：[\d.]+[KMBT]/);
});

test('野外戰鬥、高塔、分解與技能已掛上統計記錄', () => {
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  assert.match(combat, /window\.recordLootGold/);
  assert.match(combat, /window\.recordLootKill/);
  assert.match(combat, /window\.recordLootBattle/);
  assert.match(combat, /window\.recordLootEquip/);
  assert.match(combat, /window\.recordLootGem/);
  assert.match(combat, /window\.recordLootMat/);
  assert.match(combat, /window\.recordLootDeath/);
  assert.match(combat, /recordLootDeath\('field'\)/);
  assert.match(combat, /recordLootDrop\('field'\)/);
  assert.match(combat, /recordLootGem\([^;]*'field'\)/);

  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  assert.match(tower, /window\.recordLootBattle/);
  assert.match(tower, /window\.recordLootKill/);
  assert.match(tower, /window\.recordLootGold/);
  assert.match(tower, /window\.recordLootEquip/);
  assert.match(tower, /window\.recordLootDeath/);
  assert.match(tower, /recordLootDeath\('tower'\)/);
  assert.match(tower, /recordLootGem\([^;]*'tower'\)/);

  const factory = fs.readFileSync(path.join(root, 'js/factory.js'), 'utf8');
  assert.match(factory, /window\.recordLootMat/);
  assert.match(factory, /window\.recordLootGold/);
  assert.match(factory, /recordLootMat\([^;]*'factory'\)/);

  const skills = fs.readFileSync(path.join(root, 'js/skills.js'), 'utf8');
  assert.match(skills, /window\.recordLootGold/);
  assert.match(skills, /recordLootGold\([^;]*'skill'\)/);
});

test('統計面板 UI：標題、三區塊與每秒即時更新', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /統計面板/);
  assert.match(html, /id="stats-basic-card"/);
  assert.match(html, /id="stats-source-card"/);
  assert.match(html, /id="stats-loot-card"/);
  assert.match(html, /js\/stats\.js/);

  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /renderStatsPanel/);
  assert.match(ui, /statsSourceHtml/);
  assert.match(ui, /setInterval\(renderStatsPanel, 1000\)/);
  assert.match(ui, /resetLootStats/);
});
