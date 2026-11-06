const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function headerResources(player) {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const start = ui.indexOf('function renderHeader() {');
  const end = ui.indexOf('  renderBattleResourceOrbs();', start);
  const ids = ['r-gold', 'r-scrap', 'r-essence', 'r-dust', 'r-ancient-essence', 'r-soul-origin', 'r-demon-seed'];
  const nodes = Object.fromEntries(ids.map(id => [id, { parentNode: { style: {} } }]));
  const context = {
    uiHeaderPanelSnapshot: () => ({ player, stats: {} }),
    updateTalentTabVisibility() {}, setAttrIfChanged() {}, removeAttrIfPresent() {}, setTextIfChanged() {},
    $id: id => nodes[id], STR: () => '', fmt: String, fmtFull: String,
    document: { querySelector: () => null },
    peekUiPanelData: () => ({ forge: { unlocked: false } })
  };
  vm.runInNewContext(ui.slice(start, end) + '}\nrenderHeader();', context);
  return ids.filter(id => nodes[id].parentNode.style.display !== 'none');
}

const basic = ['r-gold', 'r-scrap', 'r-essence'];
test('initial header shows the three basic resources even at zero or with legacy missing fields', () => {
  assert.deepEqual(headerResources({ gold: 0, scrap: 0, essence: 0, dust: 0, ancientEssence: 0, shownRes: {} }), basic);
  assert.deepEqual(headerResources({}), basic);
});

test('dust and ancient essence follow current inventory independently of acquisition flags', () => {
  const player = { dust: 1, ancientEssence: 0, shownRes: {} };
  assert.deepEqual(headerResources(player), [...basic, 'r-dust']);
  player.ancientEssence = 2;
  assert.deepEqual(headerResources(player), [...basic, 'r-dust', 'r-ancient-essence']);
  player.dust = 0;
  player.shownRes = { 'r-dust': true, 'r-ancient-essence': true };
  assert.deepEqual(headerResources(player), [...basic, 'r-ancient-essence']);
  player.ancientEssence = 0;
  assert.deepEqual(headerResources(player), basic);
  assert.deepEqual(player.shownRes, { 'r-dust': true, 'r-ancient-essence': true });
});

test('other late resources retain existing acquisition visibility and no optional resource flashes before boot', () => {
  assert.deepEqual(headerResources({ shownRes: { 'r-soul-origin': true, 'r-demon-seed': true } }),
    [...basic, 'r-soul-origin', 'r-demon-seed']);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const header = html.slice(html.indexOf('<header id="topbar"'), html.indexOf('</header>'));
  for (const id of ['r-dust', 'r-ancient-essence', 'r-soul-origin', 'r-demon-seed']) {
    assert.match(header, new RegExp('<span class="res" style="display:none"[^\\n]*id="' + id + '"'));
  }
});

test('game branding is consistent in header, document titles, welcome and battle headings', () => {
  const context = { console };
  vm.createContext(context);
  for (const file of ['strings_data.js', 'strings.js'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context);
  assert.equal(context.STR(48), '神力之巔：無限征途');
  assert.equal(context.STR(50), '⚔️ 神力之巔');
  assert.equal(context.STR(51), '無限征途');
  assert.equal(context.STR(90), '⚔️ 歡迎來到《神力之巔：無限征途》！');
  assert.equal(context.STR(2412), '無限征途');
  assert.equal(context.STR(181, 'Lv.1'), 'Lv.1｜神力之巔');
  assert.equal(context.STR(565), '神力之巔');
  assert.equal(context.STR(2066), '神力之巔：戰況監控');
});
