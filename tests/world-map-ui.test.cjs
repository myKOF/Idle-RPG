const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function setup() {
  const ids = {}, nodes = [], documentEvents = {};
  let document;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {};
      this.style = {}; this.hidden = false; this.disabled = false; this.isConnected = true; this.textContent = '';
      this.classes = new Set();
      this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name),
        toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name), contains: name => this.classes.has(name) };
      nodes.push(this);
    }
    setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'id') { this.id = value; ids[value] = this; } }
    getAttribute(key) { return this.attrs[key] ?? null; }
    appendChild(node) { this.children.push(node); node.parent = this; return node; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, event = {}) { for (const fn of this.listeners[type] || []) fn.call(this, { target: this, ...event }); }
    focus() { document.activeElement = this; }
    getClientRects() { for (let p = this; p; p = p.parent) if (p.hidden) return []; return [{}]; }
    querySelectorAll(selector) {
      const all = [];
      const walk = node => { for (const child of node.children) { if (selector === 'button' && child.tagName === 'button') all.push(child); walk(child); } };
      walk(this); return all;
    }
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const modal = html.slice(html.indexOf('  <div id="world-map-modal"'), html.indexOf('  <div id="offline-modal"'));
  const stack = [];
  for (const match of modal.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>/g)) {
    const [, closing, tag, attrs] = match;
    if (closing) { stack.pop(); continue; }
    const node = new Element(tag);
    for (const attr of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(attr[1], attr[2]);
    node.hidden = /(?:^|\s)hidden(?:\s|$)/.test(attrs);
    if (stack.length) stack[stack.length - 1].appendChild(node);
    if (!['img', 'br', 'input'].includes(tag)) stack.push(node);
  }
  ids['btn-world-map'] = new Element('button');
  document = { body: new Element('body'), activeElement: ids['btn-world-map'], getElementById: id => ids[id],
    createElement: tag => new Element(tag),
    querySelectorAll: selector => selector === '[data-world-zone]' ? nodes.filter(n => n.getAttribute('data-world-zone')) : [],
    addEventListener(type, fn) { (documentEvents[type] ||= []).push(fn); } };
  const c = { console, document, esc: s => String(s), zoneIconHtml: () => '', peekUiPanelData: name => panels[name],
    nodePendingKey: name => name, requestPanelData() {}, isUiCommandPending: () => inFlight,
    uiCommandResultError: result => result && result.error, reportUiCommandFailure() {},
    sendUiCommand: (...args) => { commands.push(args); inFlight = true; return new Promise((resolve, reject) => { resolveCommand = resolve; rejectCommand = reject; }); } };
  c.window = c; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/util.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/strings_data.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/strings.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), c);
  const panels = { header: { player: { reincarnations: 0 }, stage: { zone: 'desert', current: 15, best: 35 } },
    battle: { zones: c.ZONE_LIST.map(key => ({ key, maxStage: c.ZONES[key].maxStage, unlocked: ['desert', 'Icefield'].includes(key),
      best: key === 'Icefield' ? 20 : 1, current: key === 'Icefield' ? 12 : 1 })) } };
  const commands = [];
  let inFlight = false, resolveCommand, rejectCommand;
  vm.runInContext(fs.readFileSync(path.join(root, 'js/ui-world-map.js'), 'utf8'), c);
  c.WorldMapUI.init();
  return { c, ids, panels, nodes, commands, document, documentEvents,
    button: key => nodes.find(n => n.getAttribute('data-world-zone') === key),
    ack: async () => { resolveCommand({}); await Promise.resolve(); },
    reject: async () => { inFlight = false; rejectCommand(new Error('test rejection')); await Promise.resolve(); await Promise.resolve(); },
    finish: key => { inFlight = false; panels.header.stage = { zone: key, current: 12, best: 20 }; c.WorldMapUI.refresh(); } };
}
test('地圖僅綁定一次；hover顯示權威進度，點選才顯示前進且離開後保持選取', () => {
  const t = setup(); t.c.WorldMapUI.init();
  assert.equal(t.document.querySelectorAll('[data-world-zone]').length, 10);
  t.c.WorldMapUI.open();
  assert.equal(t.ids['world-map-level-desert'].textContent, '(15/100)');
  assert.equal(t.ids['world-map-level-Icefield'].textContent, '(12/150)');
  assert.equal(t.ids['world-map-level-Icefield'].hidden, false);
  t.button('Icefield').dispatch('pointerenter');
  assert.equal(t.ids['world-map-scene-name'].textContent, '冰原');
  assert.equal(t.ids['world-map-progress'].textContent, '推進關卡　20 / 150');
  assert.equal(t.ids['world-map-go'].hidden, true);
  t.button('Icefield').dispatch('click');
  t.button('Icefield').dispatch('pointerleave');
  assert.equal(t.ids['world-map-info'].hidden, false);
  assert.equal(t.ids['world-map-go'].hidden, false);
  assert.equal(t.ids['world-map-go'].disabled, false);
  t.button('swamp').dispatch('pointerenter');
  assert.equal(t.ids['world-map-scene-name'].textContent, '冰原');
});
test('鎖定場景與目前場景可檢視，但不得前進；沒收到Worker資料時不自行解鎖', () => {
  const t = setup(); t.c.WorldMapUI.open();
  t.button('swamp').dispatch('click');
  assert.equal(t.ids['world-map-go'].disabled, true);
  assert.equal(t.ids['world-map-progress'].textContent, '推進關卡　0 / 300');
  assert.match(t.button('swamp').getAttribute('aria-label'), /推進 0 \/ 300/);
  assert.equal(t.c.WorldMapUI.zoneState('swamp').current, 0);
  assert.equal(t.ids['world-map-level-swamp'].hidden, true);
  assert.equal(t.ids['world-map-level-swamp'].textContent, '');
  assert.match(t.ids['world-map-scene-status'].textContent, /熔岩山第 250 關/);
  t.ids['world-map-go'].dispatch('click'); assert.equal(t.commands.length, 0);
  t.button('desert').dispatch('click');
  assert.equal(t.ids['world-map-go'].disabled, true);
  assert.equal(t.ids['world-map-progress'].textContent, '推進關卡　35 / 100');
  delete t.panels.battle.zones;
  t.button('Icefield').dispatch('click');
  assert.equal(t.ids['world-map-go'].disabled, true);
  assert.match(t.ids['world-map-progress'].textContent, /讀取/);
  assert.equal(t.ids['world-map-level-Icefield'].hidden, true);
});
test('解鎖及關卡快照更新同步名稱狀態與等級；底圖不接收事件後仍可取消選取', () => {
  const t = setup(); t.c.WorldMapUI.open();
  const row = t.panels.battle.zones.find(row => row.key === 'swamp');
  row.unlocked = true; row.current = 24; row.best = 40;
  t.c.WorldMapUI.refresh();
  assert.equal(t.button('swamp').classList.contains('is-locked'), false);
  assert.equal(t.ids['world-map-level-swamp'].hidden, false);
  assert.equal(t.ids['world-map-level-swamp'].textContent, '(24/300)');
  t.button('swamp').dispatch('click');
  assert.equal(t.ids['world-map-progress'].textContent, '推進關卡　40 / 300');
  row.current = 900; t.c.WorldMapUI.refresh();
  assert.equal(t.ids['world-map-level-swamp'].textContent, '(300/300)');
  t.ids['world-map-modal'].dispatch('click', {target:t.ids['world-map-human']});
  assert.equal(t.ids['world-map-info'].hidden, true);
  assert.equal(t.ids['world-map-modal'].hidden, false);
  const god = t.panels.battle.zones.find(row => row.key === 'god_battlefield');
  god.unlocked = true; god.current = 3;
  t.c.WorldMapUI.refresh();
  assert.equal(t.ids['world-map-level-god_battlefield'].textContent, '(3/450)');
});
test('點選場景不切換；前進只送一次既有指令，等快照確認成功再關閉並歸還焦點', async () => {
  const t = setup(); t.c.WorldMapUI.open(); t.button('Icefield').dispatch('click');
  assert.equal(t.commands.length, 0);
  t.ids['world-map-go'].dispatch('click'); t.ids['world-map-go'].dispatch('click');
  assert.equal(t.commands.length, 1);
  assert.equal(t.commands[0][0], 'stage.switchZone');
  assert.equal(t.commands[0][1].zoneKey, 'Icefield');
  assert.deepEqual(Array.from(t.commands[0][2].panels), ['battle', 'header']);
  await t.ack();
  assert.equal(t.ids['world-map-modal'].hidden, false);
  t.finish('Icefield');
  assert.equal(t.ids['world-map-modal'].hidden, true);
  assert.equal(t.document.activeElement, t.ids['btn-world-map']);
});
test('前進失敗保留地圖與可重試操作，晚到的回應不重開已關閉視窗', async () => {
  const t = setup(); t.c.WorldMapUI.open(); t.button('Icefield').dispatch('click');
  t.ids['world-map-go'].dispatch('click'); await t.reject();
  assert.equal(t.ids['world-map-modal'].hidden, false);
  assert.equal(t.ids['world-map-go'].disabled, false);
  assert.match(t.ids['world-map-scene-status'].textContent, /失敗/);
  t.ids['world-map-go'].dispatch('click'); t.c.WorldMapUI.close(); await t.ack();
  assert.equal(t.ids['world-map-modal'].hidden, true);
});
test('所在地圖示隨快照移動；神界瀏覽不自行傳送，仍須選取後前進', () => {
  const t = setup(); t.c.WorldMapUI.open();
  const marker = t.ids['world-map-marker'];
  assert.equal(marker.hidden, false); const oldX = marker.style.left;
  t.panels.header.stage.zone = 'swamp'; t.c.WorldMapUI.refresh();
  assert.notEqual(marker.style.left, oldX); assert.match(marker.getAttribute('aria-label'), /月影沼澤/);
  t.panels.header.player.reincarnations = 11; t.c.WorldMapUI.refresh();
  assert.equal(t.ids['world-map-realm-god'].hidden, false);
  t.ids['world-map-realm-god'].dispatch('click');
  assert.equal(t.ids['world-map-human'].hidden, true); assert.equal(marker.hidden, true);
  assert.equal(t.commands.length, 0);
});
test('Escape關閉且攔截遊戲選單／全螢幕快捷鍵；Tab留在地圖內', () => {
  const t = setup(); t.c.WorldMapUI.open();
  let stopped = 0, prevented = 0;
  const key = value => ({ key: value, preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; } });
  const handler = t.documentEvents.keydown[0];
  const all = t.ids['world-map-modal'].querySelectorAll('button').filter(n => !n.disabled && n.getClientRects().length);
  all[all.length - 1].focus(); handler(key('Tab'));
  assert.equal(t.document.activeElement, all[0]);
  handler(key('Escape'));
  assert.equal(t.ids['world-map-modal'].hidden, true); assert.equal(stopped, 1); assert.equal(prevented, 2);
});
