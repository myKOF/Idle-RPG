const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const shimPath = path.join(root, 'js/worker/shim.js');
const shimAvailable = fs.existsSync(shimPath);

function loadShim() {
  const context = {};
  context.self = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(shimPath, 'utf8'), context, { filename: shimPath });
  return context;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('blog 與 flog 只寫入事件佇列，不呼叫 DOM 或 postMessage', {
  skip: shimAvailable ? false : '等待 Claude 交付 js/worker/shim.js'
}, () => {
  const context = loadShim();

  context.blog('battle message', 'warn', 'combat');
  context.flog('factory message', 'good');

  assert.deepEqual(plain(context.shimDrainEvents()), [
    { kind: 'log', msg: 'battle message', cls: 'warn', cat: 'combat' },
    { kind: 'flog', msg: 'factory message', cls: 'good' }
  ]);
  assert.deepEqual(plain(context.shimDiagSnapshot().dom), {});
  assert.deepEqual(plain(context.shimDiagSnapshot().ui), { blog: 1, flog: 1 });
  assert.equal(typeof context.postMessage, 'undefined');
});

test('shimDrainEvents 會原子清空目前事件批次', {
  skip: shimAvailable ? false : '等待 Claude 交付 js/worker/shim.js'
}, () => {
  const context = loadShim();

  context.blog('first');
  const first = plain(context.shimDrainEvents());
  context.flog('second');
  const second = plain(context.shimDrainEvents());

  assert.deepEqual(first, [{ kind: 'log', msg: 'first' }]);
  assert.deepEqual(second, [{ kind: 'flog', msg: 'second' }]);
  assert.deepEqual(plain(context.shimDrainEvents()), []);
});

test('recordLoot shim 也合批進事件佇列', {
  skip: shimAvailable ? false : '等待 Claude 交付 js/worker/shim.js'
}, () => {
  const context = loadShim();

  context.recordLootGold(123, 'factory');
  assert.deepEqual(plain(context.shimDrainEvents()), [
    { kind: 'loot', fn: 'recordLootGold', args: [123, 'factory'] }
  ]);
  assert.deepEqual(plain(context.shimDiagSnapshot().ui), { recordLootGold: 1 });
});

test('shim 傳遞突刺光槍的長度、方向與飛行物欄位', () => {
  const context = loadShim();
  context.playCombatVfx({
    fxKind: 'slash', variant: 'thrust-octagonal', count: 7, projectile: true,
    lineLength: 182.8, lineWidth: 27.6, laneOffsets: [-13.8, 0, 13.8], directionCount: 8,
    rangeScale: 1.3, directionRanges: [182.8, 50, 50, 50]
  });
  assert.deepEqual(plain(context.shimDrainUrgentVisualEvents()), [{
    kind: 'vfx', fxKind: 'slash',
    targets: [], cells: null, area: null, count: 7,
    travelMs: null, elem: null, cat: null, variant: 'thrust-octagonal', delayMs: 0,
    projectile: true, lineLength: 182.8, lineWidth: 27.6,
    laneOffsets: [-13.8, 0, 13.8], directionCount: 8,
    rangeScale: 1.3, directionRanges: [182.8, 50, 50, 50], angle: null,
    sizeMult: 0
  }]);
});

test('shim 保留敵人攻擊的來源與命中欄位', () => {
  const context = loadShim();
  context.playCombatVfx({
    fxKind: 'enemy-attack', variant: 'enemy-projectile', cat: 'enemy',
    sourceId: 'mv-float-4', targets: ['pv-float'], travelMs: [260], hit: false
  });
  const event = plain(context.shimDrainUrgentVisualEvents())[0];
  assert.equal(event.kind, 'vfx');
  assert.equal(event.sourceId, 'mv-float-4');
  assert.equal(event.hit, false);
  assert.deepEqual(event.travelMs, [260]);
});

test('技能施放飄字走低延遲佇列，一般傷害字仍走 tick 批次', () => {
  const context = loadShim();
  context.floatText('pv-float', '🔥 技能 10', 'skill-cast skill-cast-total', 10);
  context.floatText('mv-float-0', '10', 'enemy-skill', 10);

  assert.deepEqual(plain(context.shimDrainUrgentVisualEvents()), [{
    kind: 'float', elId: 'pv-float', text: '🔥 技能 10',
    cls: 'skill-cast skill-cast-total', damageValue: 10, delayMs: 0
  }]);
  assert.deepEqual(plain(context.shimDrainEvents()), [{
    kind: 'float', elId: 'mv-float-0', text: '10', cls: 'enemy-skill',
    damageValue: 10, delayMs: 0
  }]);
});

/* ---- 緊急視覺佇列滿了的取捨（2026-10-01 無限冰裂：36 支發射事件被逐拍刷新擠掉）---- */

const auraEvent = (id) => ({ fxKind: 'aura', variant: 'ice-arrow-homing', area: { id, x: 1, y: 2, r: 15 } });
const launchEvent = (n) => ({ fxKind: 'projectile', variant: 'ice-arrow-pierce', angle: n });

test('緊急佇列滿了：一次性事件擠掉最舊的持續刷新，而不是被後來的刷新擠掉', () => {
  const context = loadShim();
  const cap = context.SHIM_URGENT_VISUAL_CAP;
  // 同一步：先是 36 支發射事件（排在最前面＝最舊），後面接大量場域逐拍刷新
  for (let i = 0; i < 36; i++) context.shimPushEvent('vfx', launchEvent(i));
  for (let i = 0; i < cap * 2; i++) context.shimPushEvent('vfx', auraEvent('sg-ground-' + i));
  const out = plain(context.shimDrainUrgentVisualEvents());
  assert.equal(out.length, cap, '上限仍然有效');
  assert.equal(out.filter((e) => e.variant === 'ice-arrow-pierce').length, 36, '36 支發射事件一支都沒掉');
});

test('緊急佇列滿了：進來的是持續刷新就直接丟它；進來的是一次性事件就擠掉最舊的刷新', () => {
  const context = loadShim();
  const cap = context.SHIM_URGENT_VISUAL_CAP;
  for (let i = 0; i < cap; i++) context.shimPushEvent('vfx', auraEvent('a' + i));
  context.shimPushEvent('vfx', auraEvent('late'));                 // 滿了又來一個刷新：丟它
  context.shimPushEvent('vfx', launchEvent(1));                    // 一次性事件：擠掉最舊的刷新 a0
  const out = plain(context.shimDrainUrgentVisualEvents());
  assert.equal(out.length, cap);
  assert.ok(!out.some((e) => e.area && e.area.id === 'late'), '後到的刷新被丟');
  assert.ok(!out.some((e) => e.area && e.area.id === 'a0'), '最舊的刷新被擠掉');
  assert.ok(out.some((e) => e.area && e.area.id === 'a1'), '其餘刷新保留');
  assert.equal(out[out.length - 1].variant, 'ice-arrow-pierce');
});

test('緊急佇列裡沒有持續刷新可讓時，維持原本的丟最舊（行為不變）', () => {
  const context = loadShim();
  const cap = context.SHIM_URGENT_VISUAL_CAP;
  for (let i = 0; i < cap + 3; i++) context.shimPushEvent('vfx', launchEvent(i));
  const out = plain(context.shimDrainUrgentVisualEvents());
  assert.equal(out.length, cap);
  assert.equal(out[0].angle, 3, '最舊的 3 件被丟');
});

test('只有「aura 且帶 area.id」才算持續刷新：沒有 id 的光環與其他型態都是一次性事件', () => {
  const context = loadShim();
  assert.equal(context.shimIsSustainVisualEvent({ kind: 'vfx', fxKind: 'aura', area: { id: 'x' } }), true);
  assert.equal(context.shimIsSustainVisualEvent({ kind: 'vfx', fxKind: 'aura', area: { x: 1 } }), false);
  assert.equal(context.shimIsSustainVisualEvent({ kind: 'vfx', fxKind: 'aura', area: null }), false);
  assert.equal(context.shimIsSustainVisualEvent({ kind: 'vfx', fxKind: 'burst', area: { id: 'x' } }), false);
  assert.equal(context.shimIsSustainVisualEvent({ kind: 'act', fxKind: 'aura', area: { id: 'x' } }), false);
  assert.equal(context.shimIsSustainVisualEvent(null), false);
});
