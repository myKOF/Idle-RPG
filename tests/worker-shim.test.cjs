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

/* ---- 緊急視覺佇列滿了的取捨
   2026-10-01 無限冰裂：36 支發射事件被逐拍刷新擠掉。
   2026-10-05 臨界雷劫＋高密度敵人：場域的「第一則事件」偶爾被擠掉，剛裝上的技能看起來沒特效。 ---- */

const auraEvent = (id, variant) => ({ fxKind: 'aura', variant: variant || 'ice-arrow-homing', area: { id, x: 1, y: 2, r: 15 } });
const launchEvent = (n) => ({ fxKind: 'projectile', variant: 'ice-arrow-pierce', angle: n });

/* 先讓這些場域「已經存在」（送過一批並清掉），之後再來的就是逐拍刷新而不是誕生。 */
function registerFields(context, ids, variant) {
  for (const id of ids) context.shimPushEvent('vfx', auraEvent(id, variant));
  context.shimDrainUrgentVisualEvents();
}

test('緊急佇列滿了：一次性事件擠掉最舊的持續刷新，而不是被後來的刷新擠掉', () => {
  const context = loadShim();
  const cap = context.SHIM_URGENT_VISUAL_CAP;
  const ids = Array.from({ length: cap * 2 }, (_, i) => 'sg-ground-' + i);
  registerFields(context, ids);
  // 同一步：先是 36 支發射事件（排在最前面＝最舊），後面接大量場域逐拍刷新
  for (let i = 0; i < 36; i++) context.shimPushEvent('vfx', launchEvent(i));
  for (const id of ids) context.shimPushEvent('vfx', auraEvent(id));
  const out = plain(context.shimDrainUrgentVisualEvents());
  assert.equal(out.length, cap, '上限仍然有效');
  assert.equal(out.filter((e) => e.variant === 'ice-arrow-pierce').length, 36, '36 支發射事件一支都沒掉');
});

test('緊急佇列滿了：進來的是刷新就直接丟它；進來的是一次性事件就擠掉最舊的刷新', () => {
  const context = loadShim();
  const cap = context.SHIM_URGENT_VISUAL_CAP;
  const ids = Array.from({ length: cap }, (_, i) => 'a' + i).concat(['late']);
  registerFields(context, ids);
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

test('場域的第一則事件（誕生）比刷新值錢：滿了也擠得進來，而且不會被後來的刷新擠掉', () => {
  const context = loadShim();
  const cap = context.SHIM_URGENT_VISUAL_CAP;
  const ids = Array.from({ length: cap }, (_, i) => 'old' + i);
  registerFields(context, ids, 'thunder-orb');
  for (const id of ids) context.shimPushEvent('vfx', auraEvent(id, 'thunder-orb'));   // 佇列塞滿刷新
  context.shimPushEvent('vfx', auraEvent('brand-new', 'thunder-orb'));                // 新場域的第一則
  context.shimPushEvent('vfx', auraEvent('old0', 'thunder-orb'));                     // 之後的刷新（滿了：丟它）
  const out = plain(context.shimDrainUrgentVisualEvents());
  assert.equal(out.length, cap);
  assert.ok(out.some((e) => e.area.id === 'brand-new'), '誕生事件進得了佇列');
  assert.ok(!out.some((e) => e.area.id === 'old0'), '最舊的刷新讓出位置');
});

test('誕生事件之間滿了：互相擠時維持丟最舊，但不會因此去擠一次性事件以外的東西', () => {
  const context = loadShim();
  const cap = context.SHIM_URGENT_VISUAL_CAP;
  for (let i = 0; i < cap + 3; i++) context.shimPushEvent('vfx', auraEvent('n' + i, 'thunder-orb'));  // 全是誕生
  const out = plain(context.shimDrainUrgentVisualEvents());
  assert.equal(out.length, cap);
  assert.equal(out[0].area.id, 'n3', '沒有刷新可讓，丟最舊的 3 件');
});

test('誕生事件永遠進得來：佇列全是一次性事件時，讓位的是最舊的那一件', () => {
  const context = loadShim();
  const cap = context.SHIM_URGENT_VISUAL_CAP;
  for (let i = 0; i < cap; i++) context.shimPushEvent('vfx', launchEvent(i));      // 佇列全是一次性事件
  context.shimPushEvent('vfx', auraEvent('x'));                                    // 場域誕生
  const out = plain(context.shimDrainUrgentVisualEvents());
  assert.equal(out.length, cap);
  assert.ok(out.some((e) => e.area && e.area.id === 'x'), '誕生事件進來了');
  assert.equal(out[0].angle, 1, '最舊的一次性事件讓位');
});

test('場域沉默夠久之後再出現，重新算誕生；持續有刷新的不算', () => {
  const context = loadShim();
  const ev = auraEvent('f1');
  context.shimPushEvent('vfx', Object.assign({}, ev));
  context.shimDrainUrgentVisualEvents();
  assert.equal(context.shimIsSustainBirth(ev), false, '剛送過');
  for (let i = 0; i < context.SHIM_SUSTAIN_REBIRTH_STEPS + 1; i++) context.shimDrainUrgentVisualEvents();
  assert.equal(context.shimIsSustainBirth(ev), true, '沉默超過門檻');
});

test('緊急佇列裡沒有持續刷新可讓時，維持原本的丟最舊（行為不變）', () => {
  const context = loadShim();
  const cap = context.SHIM_URGENT_VISUAL_CAP;
  for (let i = 0; i < cap + 3; i++) context.shimPushEvent('vfx', launchEvent(i));
  const out = plain(context.shimDrainUrgentVisualEvents());
  assert.equal(out.length, cap);
  assert.equal(out[0].angle, 3, '最舊的 3 件被丟');
});

test('緊急佇列上限是 512：引擎實測 600 隻敵人一步最多 465 件', () => {
  const context = loadShim();
  assert.equal(context.SHIM_URGENT_VISUAL_CAP, 512);
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
