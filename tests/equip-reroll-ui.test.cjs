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
  c.clock = 0;
  c.performance = { now: () => c.clock };
  c.advance = (ms) => { c.clock += ms; };
  c.window = c;
  vm.createContext(c);
  ['util', 'data', 'runeword_data', 'status', 'formula', 'item', 'runeword', 'ui'].forEach((name) => {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), c, { filename: name + '.js' });
  });
  c.it = { id: 'gear', name: '測試劍', slot: 'weapon', rarity: 5, level: 50, affixes: [
    { key: 'atkFlat', roll: 1 }, { key: 'str', roll: 1, ancient: true }
  ], sockets: [null], enchants: [{ key: 'fire', gemLv: 1 }], upgrade: 0 };
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
      if (selector.includes('data-socket-pick')) return null;
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
  c.advance(1000);
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

test('切回強化只退出模式，切換符文恢復完整詳情', () => {
  for (const action of ['upgrade', 'toggle-rune']) {
    const c = mount();
    c.click('toggle-reroll');
    c.click(action);
    assert.equal(c.UI.equipRerollMode, null);
    assert.equal(c.commands.length, 0);
    assert.match(c.elements['detail-pane'].innerHTML, /it-sockets/);
    assert.match(c.elements['detail-pane'].innerHTML, /it-runes/);
    assert.doesNotMatch(c.elements['detail-pane'].innerHTML, /it-enchant/, '附魔功能已關閉');
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
  c.advance(1000);
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

test('切入洗煉後完整1秒只提示不送指令，選屬性／重繪／重點不延長冷卻', () => {
  const c = mount();
  c.advance(5000);
  c.click('toggle-reroll');
  const deadline = c.UI.equipActionCooldown.until;
  c.click('reroll-affix');
  c.advance(500);
  c.click(null, 1);
  c.renderDetail();
  c.click('reroll-affix');
  c.advance(499);
  c.detailAction('reroll-affix', {});
  assert.equal(c.UI.equipActionCooldown.until, deadline);
  assert.equal(c.commands.length, 0);
  assert.deepEqual(c.floats, Array(3).fill('冷卻中無法使用'));
  assert.equal(c.player.gold, 1e12);
  assert.equal(c.player.essence, 1e12);
  assert.doesNotMatch(c.elements['equip-action-bar'].innerHTML, /data-act="reroll-affix"[^>]* disabled/);
  c.advance(1);
  c.click('reroll-affix');
  assert.deepEqual(c.commands.map((x) => [x.name, x.args]), [['item.rerollAffix', { itemId: 'gear', affixKey: 'str' }]]);
  c.pending.clear();
  c.renderDetail();
  c.click('reroll-affix');
  assert.equal(c.commands.length, 2, '冷卻只擋切頁，不在每次洗煉後再加1秒');
});

test('洗煉／鑲嵌／符文切回強化只切頁，第二次點擊也需等待1秒', () => {
  for (const from of ['toggle-reroll', 'toggle-socket', 'toggle-rune']) {
    const c = mount();
    c.advance(10000);
    c.click(from);
    c.click('upgrade');
    assert.equal(c.UI.equipRerollMode, null);
    assert.equal(c.UI.equipMatMode, null);
    assert.equal(c.commands.length, 0);
    c.advance(999);
    c.click('upgrade');
    assert.deepEqual(c.floats, ['冷卻中無法使用']);
    assert.equal(c.commands.length, 0);
    assert.equal(c.UI._upgradingItemId, undefined);
    c.advance(1);
    c.click('upgrade');
    assert.deepEqual(c.commands.map((x) => [x.name, x.args]), [['item.upgrade', { itemId: 'gear' }]]);
  }
});

test('初次顯示與切換裝備重設強化冷卻，同頁刷新不重設；冷卻提示優先於材料不足', () => {
  const c = mount();
  c.player.gold = c.player.scrap = 0;
  c.click('upgrade');
  c.advance(500);
  c.renderDetail();
  assert.equal(c.UI.equipActionCooldown.until, 1000);
  c.advance(500);
  c.click('upgrade');
  assert.deepEqual(c.floats, ['冷卻中無法使用', '材料不足']);
  c.it.id = c.UI.sel.id = 'new-gear';
  c.UI.sel.source = 'equip';
  c.renderDetail();
  assert.equal(c.UI.equipActionCooldown.until, 2000);
  c.click('upgrade');
  assert.equal(c.floats[2], '冷卻中無法使用');
  assert.equal(c.commands.length, 0);
});

test('快速離開再切入洗煉重新計時，鑲嵌／符文切頁與鎖定不被冷卻阻擋', () => {
  const c = mount();
  c.click('toggle-reroll');
  c.advance(900);
  c.click('toggle-socket');
  assert.equal(c.UI.equipMatMode.mode, 'socket');
  c.click('toggle-rune');
  assert.equal(c.UI.equipMatMode.mode, 'rune');
  c.click('toggle-reroll');
  c.advance(100);
  c.click('reroll-affix');
  assert.equal(c.commands.length, 0);
  assert.deepEqual(c.floats, ['冷卻中無法使用']);
  c.detailAction('lock', {});
  assert.equal(c.commands[0].name, 'item.setLock');
});

test('同件裝備等待詳情快照不延長冷卻，取消選取後重新選取會重算', () => {
  const c = mount();
  const item = c.it, selection = c.UI.sel;
  c.advance(500);
  c.it = null;
  c.renderDetail();
  c.advance(600);
  c.it = item;
  c.renderDetail();
  assert.equal(c.UI.equipActionCooldown.until, 1000);
  c.UI.sel = null;
  c.it = null;
  c.renderDetail();
  assert.equal(c.UI.equipActionCooldown, null);
  c.UI.sel = selection;
  c.it = item;
  c.renderDetail();
  assert.equal(c.UI.equipActionCooldown.until, 2100);
  c.click('upgrade');
  assert.equal(c.commands.length, 0);
  assert.deepEqual(c.floats, ['冷卻中無法使用']);
});
