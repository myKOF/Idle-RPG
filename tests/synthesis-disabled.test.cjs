const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    setTimeout() {},
    clearTimeout() {},
    document: { addEventListener() {} },
    UI: { dirty: {} }
  };
  context.window = context;
  vm.createContext(context);

  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/player.js', 'js/factory.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  return context;
}

function baseState(context) {
  context.G = context.newGameState();
  context.G.factory.filter.actions = Array(8).fill('keep');
  context.G.factory.installed = { salvage: [], synth: [] };
  context.G.factory.parts = [];
  context.G.factory.conveyor = [];
  context.G.factory.synthBuffer = [];
  context.flog = () => {};
  context.blog = () => {};
}

test('合成系統關閉且預設不啟用', () => {
  const context = loadGameContext();
  assert.equal(context.SYNTHESIS_ENABLED, false);
  assert.equal(context.newGameState().factory.synth.enabled, false);
  // 熔爐合併版：舊生產線分頁（含合成節點標記）已自 index.html 整段移除
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!/id="synthesis-node"/.test(html), '合成節點標記應隨舊生產線頁移除');
});

test('關閉時合成零件不會生成', () => {
  const context = loadGameContext();
  const part = context.makePart(5, 'synth');
  assert.equal(part, null);
  const randomPart = context.makePart(5);
  assert.notEqual(randomPart, null);
  assert.notEqual(context.PART_TYPES[randomPart.key].node, 'synth');
});

test('關閉時合成素材不會進入合成暫存區', () => {
  const context = loadGameContext();
  baseState(context);
  context.G.factory.filter.actions[2] = 'synth';
  context.G.factory.conveyor.push({ id: 'item-1', rarity: 2, level: 1, slot: 'weapon', sockets: [], affixes: [] });
  context.processOneConveyorItem();
  assert.equal(context.G.factory.synthBuffer.length, 0);
  assert.equal(context.G.inventory.length, 1);
});
