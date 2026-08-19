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
    lineLength: 182.8, lineWidth: 27.6, laneOffsets: [-13.8, 0, 13.8], directionCount: 8
  });
  assert.deepEqual(plain(context.shimDrainUrgentVisualEvents()), [{
    kind: 'vfx', fxKind: 'slash',
    targets: [], cells: null, area: null, count: 7,
    travelMs: null, elem: null, cat: null, variant: 'thrust-octagonal', delayMs: 0,
    projectile: true, lineLength: 182.8, lineWidth: 27.6,
    laneOffsets: [-13.8, 0, 13.8], directionCount: 8, angle: null
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
