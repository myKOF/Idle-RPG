const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function setup() {
  const ids = {}, nodes = [], documentEvents = {};
  let now = 0, timerId = 0;
  const timers = new Map();
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = end;
  }
  let document;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {};
      this.style = { setProperty(key, value) { this[key] = value; } }; this.hidden = false; this.disabled = false; this.isConnected = true; this.textContent = '';
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
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, bottom: 100, width: 1000, height: 600 }; }
    get clientWidth() { return 1000; }
    get clientHeight() { return 600; }
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
    querySelector: selector => nodes.find(n => selector === '[data-world-zone="' + n.getAttribute('data-world-zone') + '"]'),
    addEventListener(type, fn) { (documentEvents[type] ||= []).push(fn); } };
  const c = { console, document, esc: s => String(s), zoneIconHtml: () => '', peekUiPanelData: name => panels[name],
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    nodePendingKey: name => name, requestPanelData() {}, isUiCommandPending: () => inFlight,
    uiCommandResultError: result => result && result.error, reportUiCommandFailure() {},
    sendUiCommand: (...args) => { commands.push(args); inFlight = true; return new Promise((resolve, reject) => { resolveCommand = resolve; rejectCommand = reject; }); } };
  c.window = c; c.addEventListener = (type, fn) => { (documentEvents[type] ||= []).push(fn); }; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/util.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/strings_data.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/strings.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), c);
  const panels = { header: { player: { reincarnations: 0 }, stage: { zone: 'desert', current: 15, best: 35 } },
    battle: { zoneProgress: {}, zones: c.ZONE_LIST.map(key => ({ key, maxStage: c.ZONES[key].maxStage, unlocked: ['desert', 'Icefield'].includes(key),
      best: key === 'Icefield' ? 20 : 1, current: key === 'Icefield' ? 12 : 1 })) } };
  const commands = [];
  let inFlight = false, resolveCommand, rejectCommand;
  vm.runInContext(fs.readFileSync(path.join(root, 'js/ui-world-map.js'), 'utf8'), c);
  c.WorldMapUI.init();
  return { c, ids, panels, nodes, commands, document, documentEvents, advance,
    button: key => nodes.find(n => n.getAttribute('data-world-zone') === key),
    ack: async () => { resolveCommand({}); await Promise.resolve(); },
    reject: async () => { inFlight = false; rejectCommand(new Error('test rejection')); await Promise.resolve(); await Promise.resolve(); },
    finish: key => { inFlight = false; panels.header.stage = { zone: key, current: 12, best: 20 }; c.WorldMapUI.refresh(); } };
}
test('地圖僅綁定一次；hover顯示權威進度，點選才顯示前進且離開後保持選取', () => {
  const t = setup(); t.c.WorldMapUI.init();
  assert.equal(t.document.querySelectorAll('[data-world-zone]').length, 10);
  t.c.WorldMapUI.open();
  assert.equal(t.ids['world-map-level-desert'].textContent, '(35/100)');
  assert.equal(t.ids['world-map-level-Icefield'].textContent, '(20/150)');
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
  assert.equal(t.ids['world-map-level-swamp'].textContent, '(40/300)');
  t.button('swamp').dispatch('click');
  assert.equal(t.ids['world-map-progress'].textContent, '推進關卡　40 / 300');
  row.best = 900; t.c.WorldMapUI.refresh();
  assert.equal(t.ids['world-map-level-swamp'].textContent, '(300/300)');
  t.ids['world-map-modal'].dispatch('click', {target:t.ids['world-map-human']});
  assert.equal(t.ids['world-map-info'].hidden, true);
  assert.equal(t.ids['world-map-modal'].hidden, false);
  const god = t.panels.battle.zones.find(row => row.key === 'god_battlefield');
  god.unlocked = true; god.current = 3; god.best = 8;
  t.c.WorldMapUI.refresh();
  assert.equal(t.ids['world-map-level-god_battlefield'].textContent, '(8/450)');
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
  t.ids['world-map-realm-god'].dispatch('click'); t.advance(2500);
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

test('最高到達關卡不因目前退關、切圖或重開地圖下降，名稱與無障礙進度一致', () => {
  const t = setup(); t.c.WorldMapUI.open();
  t.panels.header.stage.current = 1;
  t.panels.header.stage.best = 60;
  t.c.WorldMapUI.refresh();
  assert.equal(t.ids['world-map-level-desert'].textContent, '(60/100)');
  assert.match(t.button('desert').getAttribute('aria-label'), /\(60\/100\)/);
  t.panels.battle.zones.find(row => row.key === 'desert').best = 60;
  t.panels.header.stage = { zone: 'Icefield', current: 2, best: 20 };
  t.c.WorldMapUI.refresh();
  assert.equal(t.ids['world-map-level-desert'].textContent, '(60/100)');
  t.c.WorldMapUI.close(); t.c.WorldMapUI.open();
  assert.equal(t.ids['world-map-level-desert'].textContent, '(60/100)');
});

test('兩界大地圖提示皆固定名稱下方，選取及縮放不改相對位置', () => {
  const t = setup(); t.c.WorldMapUI.open();
  for (const key of t.c.REALMS.human.zones) {
    t.button(key).dispatch('click');
    const anchor = t.button(key).style;
    assert.equal(t.ids['world-map-info'].style.top, 'calc(' + anchor.top + ' + max(2.6cqw, 20px))');
    assert.ok(t.ids['world-map-info'].style.left.includes(anchor.left));
  }
  t.ids['world-map-realm-god'].dispatch('click'); t.advance(2500);
  for (const key of t.c.REALMS.god.zones) {
    const node = t.button(key);
    node.dispatch('click');
    const expected = 'calc(' + node.style.top + ' + max(2.6cqw, 20px))';
    assert.equal(t.ids['world-map-info'].style.top, expected);
    assert.ok(t.ids['world-map-info'].style.left.includes(node.style.left));
    t.documentEvents.resize[0]();
    assert.equal(t.ids['world-map-info'].style.top, expected);
  }
});

test('神界底圖／三處熱區同人界進度規則，兩端傳送門只切頁並移交鍵盤焦點', () => {
  const t = setup();
  const row = t.panels.battle.zones.find(z => z.key === 'undead_mountains');
  row.unlocked = true;
  t.panels.battle.zoneProgress.undead_mountains = { cleared: 400 };
  t.c.WorldMapUI.open();
  t.ids['world-map-god-portal'].dispatch('click'); t.advance(2500);
  assert.equal(t.ids['world-map-god'].hidden, false);
  assert.equal(t.ids['world-map-modal'].getAttribute('data-world-realm'), 'god');
  assert.equal(t.ids['world-map-title'].textContent, '神界');
  assert.equal(t.document.activeElement, t.ids['world-map-human-portal']);
  assert.equal(t.ids['world-map-god-image'].getAttribute('src'), 'images/world-map/god-realm.png?v=2');
  for (const key of t.c.REALMS.god.zones) {
    assert.equal(t.button(key).parent, t.ids['world-map-god-zones']);
    assert.equal(t.button(key).className, 'world-map-hotspot');
    assert.equal(t.ids['world-map-level-' + key].hidden, true, '鎖定場景隱藏進度');
    assert.ok(!t.button(key).innerHTML.includes('label-cover-'), '神界圖已去字不需人界覆片');
  }
  const god = t.panels.battle.zones.find(z => z.key === 'god_battlefield');
  god.unlocked = true; god.best = 123; god.current = 20;
  t.panels.header.stage = { zone: 'god_battlefield', current: 20, best: 123 };
  t.c.WorldMapUI.refresh();
  assert.equal(t.ids['world-map-level-god_battlefield'].textContent, '(123/450)');
  assert.equal(t.ids['world-map-god-marker'].hidden, false);
  assert.equal(t.ids['world-map-marker'].hidden, true);
  assert.equal(t.ids['world-map-god-marker'].style.left, t.button('god_battlefield').style.left);
  t.button('god_chaos').dispatch('click');
  assert.equal(t.ids['world-map-go'].disabled, true);
  assert.match(t.ids['world-map-scene-status'].textContent, /太古戰場.*450/);
  t.ids['world-map-human-portal'].dispatch('click'); t.advance(2500);
  assert.equal(t.ids['world-map-human'].hidden, false);
  assert.equal(t.ids['world-map-info'].hidden, true);
  assert.equal(t.document.activeElement, t.ids['world-map-god-portal']);
  assert.equal(t.panels.header.stage.zone, 'god_battlefield');
  assert.equal(t.commands.length, 0);
});

test('神界底圖載入錯誤可提示與恢復，避免更改人界圖片提示', () => {
  const t = setup();
  t.ids['world-map-god-image'].dispatch('error');
  assert.equal(t.ids['world-map-god-image-error'].hidden, false);
  assert.equal(t.ids['world-map-image-error'].hidden, true);
  t.ids['world-map-god-image'].dispatch('load');
  assert.equal(t.ids['world-map-god-image-error'].hidden, true);
});

test('人界最高地圖須真正通關才出現傳送門，入口不受轉生數影響但不授予場景權限', () => {
  const t = setup(); t.c.WorldMapUI.open();
  const portal = t.ids['world-map-god-portal'];
  const row = t.panels.battle.zones.find(row => row.key === 'undead_mountains');
  row.unlocked = true; row.best = row.maxStage; row.current = row.maxStage;
  t.panels.battle.zoneProgress.undead_mountains = { cleared: row.maxStage - 1 };
  t.c.WorldMapUI.refresh();
  assert.equal(portal.hidden, true);
  portal.dispatch('click'); assert.equal(t.ids['world-map-god'].hidden, true);
  t.panels.battle.zoneProgress.undead_mountains.cleared = row.maxStage;
  t.c.WorldMapUI.refresh();
  assert.equal(portal.hidden, false);
  portal.dispatch('click'); t.advance(2500);
  assert.equal(t.ids['world-map-god'].hidden, false);
  assert.equal(t.ids['world-map-realm-human'].hidden, false);
  assert.equal(t.commands.length, 0);
  t.button('god_battlefield').dispatch('click');
  assert.equal(t.ids['world-map-go'].disabled, true);
  assert.match(t.ids['world-map-scene-status'].textContent, /亡靈山脈.*400/);
  assert.doesNotMatch(t.ids['world-map-scene-status'].textContent, /轉/);
  t.ids['world-map-go'].dispatch('click'); assert.equal(t.commands.length, 0);
  t.ids['world-map-realm-human'].dispatch('click'); t.advance(2500);
  assert.equal(t.ids['world-map-human'].hidden, false);
  delete t.panels.battle.zoneProgress; t.c.WorldMapUI.refresh();
  assert.equal(portal.hidden, true);
});

test('最高人界依地圖配置決定，新增／調高其他地圖後不沿用亡靈山脈判斷', () => {
  const t = setup();
  t.panels.battle.zoneProgress.undead_mountains = { cleared: 400 };
  t.c.ZONES.future_human = { name: '未來地圖', realm: 'human', maxStage: 700 };
  t.panels.battle.zones.push({ key: 'future_human', maxStage: 700, unlocked: true, current: 700, best: 700 });
  t.c.WorldMapUI.open();
  assert.equal(t.ids['world-map-god-portal'].hidden, true);
  t.panels.battle.zoneProgress.future_human = { cleared: 699 };
  t.c.WorldMapUI.refresh(); assert.equal(t.ids['world-map-god-portal'].hidden, true);
  t.panels.battle.zoneProgress.future_human.cleared = 700;
  t.c.WorldMapUI.refresh(); assert.equal(t.ids['world-map-god-portal'].hidden, false);
  // 神界上限更高不參與人界最高值；沒有權威地圖快照時不顯示。
  t.panels.battle.zones = [];
  t.c.WorldMapUI.refresh(); assert.equal(t.ids['world-map-god-portal'].hidden, true);
});

test('兩方向轉場皆2.5秒，中點才換圖，期間防連點／頁籤／前進且不送Worker命令', () => {
  const t = setup();
  t.panels.battle.zones.find(z => z.key === 'undead_mountains').unlocked = true;
  t.panels.battle.zoneProgress.undead_mountains = { cleared: 400 };
  t.c.WorldMapUI.open();
  const before = JSON.stringify(t.panels.header.stage);
  for (const [trigger, destination, sourceId, destinationId] of [
    ['world-map-god-portal', 'god', 'world-map-human', 'world-map-god'],
    ['world-map-human-portal', 'human', 'world-map-god', 'world-map-human']
  ]) {
    t.ids[trigger].dispatch('click');
    const layer = t.ids['world-map-transition'];
    assert.equal(layer.hidden, false);
    assert.equal(layer.getAttribute('data-destination'), destination);
    assert.equal(layer.style['--wm-transit-duration'], '2500ms');
    assert.equal(t.ids['world-map-modal'].getAttribute('aria-busy'), 'true');
    assert.equal(t.document.activeElement, t.ids['world-map-close']);
    for (const id of ['world-map-god-portal', 'world-map-human-portal', 'world-map-realm-god', 'world-map-realm-human']) {
      assert.equal(t.ids[id].disabled, true, id);
      t.ids[id].dispatch('click'); // fake事件刻意穿過disabled，仍須有邏輯防重入。
    }
    assert.equal(t.button('Icefield').disabled, true);
    t.button('Icefield').dispatch('click');
    t.ids['world-map-go'].dispatch('click');
    assert.equal(t.commands.length, 0);
    t.advance(1249);
    assert.equal(t.ids[sourceId].hidden, false);
    assert.equal(t.ids[destinationId].hidden, true);
    t.advance(1);
    assert.equal(t.ids[sourceId].hidden, true);
    assert.equal(t.ids[destinationId].hidden, false);
    assert.equal(layer.hidden, false);
    t.advance(1249);
    assert.equal(t.ids[trigger].disabled, true);
    t.advance(1);
    assert.equal(layer.hidden, true);
    assert.equal(t.ids['world-map-modal'].getAttribute('aria-busy'), 'false');
    assert.equal(t.ids[trigger].disabled, false);
    assert.equal(t.button('Icefield').disabled, false);
    assert.equal(t.document.activeElement, t.ids[destination === 'god' ? 'world-map-human-portal' : 'world-map-god-portal']);
    assert.equal(JSON.stringify(t.panels.header.stage), before);
    assert.equal(t.commands.length, 0);
  }
});

test('轉場關閉／Esc取消舊回呼，重開與新轉場不被遲到回呼切走或復活', () => {
  for (const elapsed of [300, 1500]) {
    const t = setup();
    t.panels.battle.zones.find(z => z.key === 'undead_mountains').unlocked = true;
    t.panels.battle.zoneProgress.undead_mountains = { cleared: 400 };
    t.c.WorldMapUI.open();
    t.ids['world-map-god-portal'].dispatch('click');
    t.advance(elapsed);
    if (elapsed === 300) t.ids['world-map-close'].dispatch('click');
    else t.documentEvents.keydown[0]({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(t.ids['world-map-modal'].hidden, true);
    assert.equal(t.ids['world-map-transition'].hidden, true);
    assert.equal(t.document.activeElement, t.ids['btn-world-map']);
    t.advance(5000);
    assert.equal(t.ids['world-map-modal'].hidden, true);
    t.c.WorldMapUI.open();
    assert.equal(t.ids['world-map-human'].hidden, false);
    assert.equal(t.ids['world-map-human-portal'].disabled, false);
    t.ids['world-map-realm-god'].dispatch('click');
    t.advance(2500);
    assert.equal(t.ids['world-map-god'].hidden, false);
    assert.equal(t.ids['world-map-transition'].hidden, true);
    assert.equal(t.commands.length, 0);
  }
});

test('目標圖預載，門洞光芒起點取實際門位置；已在相同界不重播轉場', () => {
  const t = setup();
  t.panels.battle.zoneProgress.undead_mountains = { cleared: 400 };
  t.panels.battle.zones.find(z => z.key === 'undead_mountains').unlocked = true;
  t.c.WorldMapUI.open();
  t.ids['world-map-realm-human'].dispatch('click');
  assert.equal(t.ids['world-map-transition'].hidden, true);
  t.ids['world-map-canvas'].rect = { left: 100, top: 200, width: 1000, height: 600 };
  t.ids['world-map-god-portal'].rect = { left: 200, top: 260, width: 100, height: 120 };
  t.ids['world-map-god-portal'].dispatch('click');
  assert.equal(t.ids['world-map-transition'].style['--wm-portal-x'], '15%');
  assert.equal(t.ids['world-map-transition'].style['--wm-portal-y'], '20%');
  assert.equal(t.ids['world-map-god-image'].getAttribute('loading'), 'eager');
});
