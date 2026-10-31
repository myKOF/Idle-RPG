'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine.js');
const ui = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
function source(name) {
  const start = ui.indexOf('function ' + name + '('), open = ui.indexOf('{', start);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = open; i < ui.length; i++) {
    if (ui[i] === '{') depth++;
    if (ui[i] === '}' && --depth === 0) return ui.slice(start, i + 1);
  }
  throw Error('unterminated ' + name);
}
function setup(stones = 7, owned = 1000) {
  const c = createEngine({ seed:1031 }).boot(null).ctx;
  c.G.player.reincarnations = 5; c.G.player.dust = owned;
  c.forgeSetOperation('ancient');
  const item = c.makeEquipment(100, { rarity:6 });
  c.G.inventory.push(item); c.forgePlaceItem(item.id); c.forgeSetStones(stones);
  let now = 0, nextId = 1, pending = false;
  const timers = new Map(), sent = [];
  function node() {
    const handlers = {};
    return { disabled:false, handlers, hidden:false, textContent:'', lastElementChild:{ textContent:'' },
      addEventListener(name, fn) { (handlers[name] ||= []).push(fn); },
      emit(name, event = {}) { for (const fn of handlers[name] || []) fn({ detail:1, pointerId:1, button:0, preventDefault() {}, ...event }); },
      setAttribute() {}, setPointerCapture() {}, hasPointerCapture() { return false; } };
  }
  const nodes = Object.fromEntries(['minus','plus','value','center','popover'].map(k => ['forge-stone-' + k, node()]));
  for (const id of ['forge-rate','forge-dust-own']) nodes[id] = node();
  const doc = node(), win = node();
  Object.assign(c, { UI:{ tab:'forge', forgeStoneOpen:true, dirty:{} }, document:doc, window:win,
    $id:id => nodes[id], performance:{ now:() => now },
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { at:now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    uiForgePanelSnapshot:() => ({ forge:c.G.forge }), uiHeaderPanelSnapshot:() => ({ player:c.G.player }),
    isUiCommandPending:() => pending, nodePendingKey:key => key,
    setTextIfChanged(el, value) { el.textContent = String(value); }
  });
  for (const name of ['forgeViewItemCount','forgeViewSlots','forgeViewState','forgeViewRate','forgeStonePickerRate','updateForgeStonePicker','stageHoldNow','finishForgeStoneHold','bindForgeStoneControls','closeForgeStonePicker']) vm.runInContext(source(name), c);
  c.bindForgeStoneControls(count => { sent.push(count); assert.equal(c.forgeSetStones(count), null); });
  c.updateForgeStonePicker(c.G.forge, c.G.player, false);
  return { c, nodes, doc, win, timers, sent,
    down(key = 'plus', event) { nodes['forge-stone-' + key].emit('pointerdown', event); },
    up(key = 'plus') { doc.emit('pointerup'); nodes['forge-stone-' + key].emit('click'); },
    advance(ms) { const end = now + ms; while (true) { const due = [...timers].filter(([, t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0]; if (!due) break; now = due[1].at; timers.delete(due[0]); due[1].fn(); } now = end; },
    setPending(value) { pending = value; }
  };
}
test('短按只增減一次，499ms仍未啟動連續調整', () => {
  const s = setup(); s.down(); s.advance(499);
  assert.equal(s.nodes['forge-stone-value'].textContent, '7'); assert.deepEqual(s.sent, []);
  s.up(); assert.deepEqual(s.sent, [8]); s.advance(1000); assert.equal(s.timers.size, 0);
  s.down('minus'); s.up('minus'); assert.deepEqual(s.sent, [8,7]);
});
test('500ms開始、之後每秒20次；放開只送最終值，尾隨click不重加', () => {
  const s = setup(); s.down(); s.advance(500); assert.equal(s.nodes['forge-stone-value'].textContent, '8');
  s.advance(1000); assert.equal(s.nodes['forge-stone-value'].textContent, '28');
  assert.equal(s.c.G.forge.stones, 7); assert.deepEqual(s.sent, []);
  s.up(); assert.deepEqual(s.sent, [28]); s.advance(1000); assert.equal(s.c.G.forge.stones, 28); assert.equal(s.timers.size, 0);
  s.down('minus'); s.advance(500); s.advance(1000); assert.equal(s.nodes['forge-stone-value'].textContent, '7');
  s.up('minus'); assert.deepEqual(s.sent, [28,7]);
});
test('預覽成功率隨數量更新，顯示只有持有量與總成功率', () => {
  const s = setup(); s.down(); s.advance(500);
  assert.equal(s.nodes['forge-rate'].textContent, '成功率 48%');
  assert.equal(s.nodes['forge-dust-own'].textContent, '神性之石：持有 1.00K');
  assert.equal(s.nodes['forge-stone-center'].lastElementChild.textContent, '8');
});
test('放開後等待Worker回覆期間維持最後數量，回覆後恢復權威顯示', () => {
  const s = setup(); s.down(); s.advance(650);
  s.c.UI.forgeStoneHold.send = count => { s.sent.push(count); s.setPending(true); };
  s.up(); s.c.updateForgeStonePicker(s.c.G.forge,s.c.G.player,true);
  assert.equal(s.nodes['forge-stone-value'].textContent,'11');
  assert.equal(s.c.G.forge.stones,7);
  s.c.forgeSetStones(11); s.setPending(false); s.c.updateForgeStonePicker(s.c.G.forge,s.c.G.player,false);
  assert.equal(s.nodes['forge-stone-value'].textContent,'11');
  assert.equal(s.c.UI.forgeStoneHold.submittedCount,null);
});
test('長按受庫存、投入上限與零限制，到邊界不再排Timer', () => {
  for (const [start, owned, key, target] of [[7,9,'plus',9],[59,1000,'plus',60],[2,1000,'minus',0]]) {
    const s = setup(start,owned); s.down(key); s.advance(3000);
    assert.equal(Number(s.nodes['forge-stone-value'].textContent),target); assert.equal(s.timers.size,0);
    s.up(key); assert.equal(s.c.G.forge.stones,target); assert.deepEqual(s.sent,[target]);
  }
});
test('放開、觸控取消、失焦、隱藏及關閉提示停止並提交已選數量', () => {
  for (const stop of [s=>s.doc.emit('pointerup'),s=>s.doc.emit('pointercancel'),s=>s.win.emit('blur'),s=>{s.doc.hidden=true;s.doc.emit('visibilitychange');},s=>s.c.closeForgeStonePicker()]) {
    const s = setup(); s.down(); s.advance(650); stop(s); s.advance(2000);
    assert.deepEqual(s.sent,[11]); assert.equal(s.timers.size,0); assert.equal(s.c.UI.forgeStoneHold.pointerId,null);
  }
});
test('處理中、鑄造中與非主鍵不啟動；其他指標放開不打斷；鍵盤點擊保留', () => {
  const s = setup(); s.setPending(true); s.down(); assert.equal(s.timers.size,0);
  s.setPending(false); s.c.G.forge.crafting={}; s.down(); assert.equal(s.timers.size,0); delete s.c.G.forge.crafting;
  s.down('plus',{button:2}); assert.equal(s.timers.size,0);
  s.down(); s.doc.emit('pointerup',{pointerId:2}); s.advance(500); assert.equal(s.nodes['forge-stone-value'].textContent,'8');
  s.up(); s.nodes['forge-stone-plus'].emit('click',{detail:0}); assert.deepEqual(s.sent,[8,9]);
});
