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
