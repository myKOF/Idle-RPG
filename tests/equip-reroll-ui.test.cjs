'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

function mount() {
  const elements = Object.fromEntries(['detail-pane', 'equip-action-bar', 'equip-material-panel'].map((id) => [id, {
    innerHTML: '', style: {}, classList: { add() {}, remove() {} }
  }]));
  const c = { console, document: { addEventListener() {}, querySelectorAll() { return []; }, getElementById(id) { return elements[id] || null; } } };
  c.window = c;
  vm.createContext(c);
  ['util', 'data', 'status', 'formula', 'item', 'ui'].forEach((name) => {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), c, { filename: name + '.js' });
  });
  c.it = { id: 'gear', name: '測試劍', slot: 'weapon', rarity: 5, level: 50, affixes: [
    { key: 'atkFlat', roll: 1 }, { key: 'str', roll: 1, ancient: true }
  ], sockets: [null], enchants: [], upgrade: 0 };
  c.player = { gold: 1e12, essence: 1e12, scrap: 1e12 };
  c.findSelItem = () => c.it;
  c.uiHeaderPanelSnapshot = () => ({ player: c.player });
  c.uiInventoryPanelSnapshot = () => ({ details: { gear: c.it } });
  c.uiGemsPanelSnapshot = () => null;
  c.hideAffixPool = c.updateSelectionUI = c.hideTooltip = () => {};
  c.UI.sel = { id: 'gear', source: 'equip' };
  c.pending = new Set();
  c.isUiCommandPending = (key) => c.pending.has(key);
  c.commands = [];
  c.sendUiCommand = (name, args, options) => {
    c.commands.push({ name, args: JSON.parse(JSON.stringify(args)), options });
    options.keys.forEach((key) => c.pending.add(key));
    c.renderDetail();
    return new Promise(() => {});
  };
  c.floats = [];
  c.showFloatingText = (_btn, text) => c.floats.push(text);
  // 執行正式事件委派中這個功能的分支，避免為單一流程重建整個 initUI DOM。
  const start = ui.indexOf('    // 洗煉模式：點詞條');
  const end = ui.indexOf('    // 寶石鑲嵌 / 取下', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext('function clickRerollArea(e) {\n' + ui.slice(start, end) + '\n}', c);
  c.click = (act, pick) => {
    const tag = elements['equip-action-bar'].innerHTML.match(new RegExp('<button[^>]*data-act="' + act + '"[^>]*>'));
    const button = { disabled: !!(tag && /\sdisabled/.test(tag[0])), getAttribute(name) { return name === 'data-act' ? act : null; } };
    c.clickRerollArea({ target: { closest(selector) {
      if (selector.includes('data-reroll-pick')) return pick === undefined ? null : { getAttribute() { return String(pick); } };
      return pick === undefined ? button : null;
    } } });
  };
  c.elements = elements;
  c.renderDetail();
  return c;
}

test('首次進入與選取不送洗煉指令，下方按鈕洗當前詞條且阻止等待中連送', () => {
  const c = mount();
  c.UI.equipMatMode = { itemId: 'gear', mode: 'socket' };
  c.click('toggle-reroll');
  assert.equal(c.commands.length, 0);
  assert.equal(c.UI.equipRerollMode.selIdx, 0);
  assert.equal(c.UI.equipMatMode, null);
  assert.match(c.elements['detail-pane'].innerHTML, /is-reroll-selected/);
  assert.doesNotMatch(c.elements['detail-pane'].innerHTML, /it-sockets|it-enchant|🎲/);
  assert.match(c.elements['equip-action-bar'].innerHTML, /btn-primary act-btn-tooltip" data-act="reroll-affix"/);
  c.click(null, 1);
  assert.equal(c.commands.length, 0);
  assert.equal(c.UI.equipRerollMode.selIdx, 1);
  c.click('reroll-affix');
  assert.deepEqual(c.commands.map((x) => [x.name, x.args]), [['item.rerollAffix', { itemId: 'gear', affixKey: 'str' }]]);
  assert.match(c.elements['equip-action-bar'].innerHTML, /data-act="reroll-affix"[^>]* disabled/);
  c.click('reroll-affix');
  c.detailAction('reroll-affix', {});
  assert.equal(c.commands.length, 1);
  // Worker 回覆替換了種類，UI 索引不變；下一次必須使用新種類。
  c.it.affixes[1].key = 'vit';
  c.pending.clear();
  c.renderDetail();
  assert.equal(c.UI.equipRerollMode.selIdx, 1);
  c.click('reroll-affix');
  assert.equal(c.commands[1].args.affixKey, 'vit');
});

test('切回強化只退出模式，鑲嵌或附魔恢復完整詳情', () => {
  for (const action of ['upgrade', 'toggle-socket', 'toggle-enchant']) {
    const c = mount();
    c.click('toggle-reroll');
    c.click(action);
    assert.equal(c.UI.equipRerollMode, null);
    assert.equal(c.commands.length, 0);
    assert.match(c.elements['detail-pane'].innerHTML, /it-sockets/);
    assert.match(c.elements['detail-pane'].innerHTML, /it-enchant/);
    assert.doesNotMatch(c.elements['detail-pane'].innerHTML, /is-reroll-mode/);
    assert.match(c.elements['equip-action-bar'].innerHTML, /data-act="toggle-reroll"/);
  }
});

test('洗煉按鈕保留普通／太古說明、費用與不足提示；未知餘額不標紅', () => {
  const c = mount();
  c.click('toggle-reroll');
  const rich = c.elements['equip-action-bar'].innerHTML;
  assert.match(rich, /需要：/);
  assert.match(rich, /改變種類與數值/);
  assert.doesNotMatch(rich, /fca5a5/);
  c.click(null, 1);
  assert.match(c.elements['equip-action-bar'].innerHTML, /太古位置與滿值保留/);
  c.player.gold = c.player.essence = 0;
  c.renderDetail();
  assert.match(c.elements['equip-action-bar'].innerHTML, /fca5a5/);
  c.click('reroll-affix');
  assert.equal(c.commands.length, 0);
  assert.deepEqual(c.floats, ['材料不足']);
  c.uiHeaderPanelSnapshot = () => null;
  c.renderDetail();
  assert.doesNotMatch(c.elements['equip-action-bar'].innerHTML, /fca5a5/);
});

test('沒有可洗詞條禁用按鈕，下架詞條會改選有效位置，換件不能使用舊選取', () => {
  const c = mount();
  c.it.affixes = [{ key: 'removed-affix', roll: 1 }];
  c.click('toggle-reroll');
  assert.equal(c.UI.equipRerollMode.selIdx, -1);
  assert.match(c.elements['equip-action-bar'].innerHTML, /data-act="reroll-affix" disabled/);
  c.click('reroll-affix');
  assert.equal(c.commands.length, 0);
  c.it.affixes.push({ key: 'str', roll: 1 });
  c.renderDetail();
  assert.equal(c.UI.equipRerollMode.selIdx, 1);
  c.it.id = 'other-gear';
  c.renderDetail();
  c.detailAction('reroll-affix', {});
  assert.equal(c.commands.length, 0);
  assert.match(c.elements['equip-action-bar'].innerHTML, /data-act="toggle-reroll"/);
});
