const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadWorker() {
  const context = {
    console,
    performance: { now: () => 0 },
    location: { search: '' },
    setInterval: () => 0,
    clearInterval,
    Date, Math, JSON, URL, URLSearchParams
  };
  context.self = { postMessage() {} };
  context.window = context;
  context.document = {};
  context.importScripts = (...files) => files.forEach((file) => {
    /* ⚠️ 真正的 importScripts 收的是 URL：遊戲會掛快取破壞用的查詢字串
       （例如 '../player.js?v=20260804-xp-settle'），瀏覽器那邊 HTTP server
       照樣送同一個檔。這裡是 readFileSync，不去掉 `?v=...` 就會 ENOENT。
       同一個坑也炸過 scripts/sim/engine.js 的墊片，見那裡的註解。 */
    const clean = String(file).split('#')[0].split('?')[0];
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'worker', clean), 'utf8'), context, { filename: clean });
  });
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'worker', 'sim.worker.js'), 'utf8'), context, { filename: 'sim.worker.js' });
  return context;
}

function item(id, rarity, level = 1, locked = false, ancient = 0) {
  return {
    id, rarity, level, locked, slot: 'weapon', sockets: [],
    affixes: Array.from({ length: ancient }, () => ({ ancient: true }))
  };
}

function runSalvage(inventory, args) {
  const context = loadWorker();
  context.G = context.newGameState();
  context.G.inventory = inventory;
  context.manualSave = () => null;
  const salvaged = [];
  context.doSalvage = (it) => { salvaged.push(it.id); return { scrap: 1 }; };
  const result = context.COMMAND_IMPL['item.salvageBulk'](args);
  return { context, result, salvaged };
}

test('Worker item.salvageBulk 保留神話/創世與鎖定裝備', () => {
  const r = runSalvage([
    item('common', 0), item('legendary', 5), item('mythic', 6),
    item('genesis', 7), item('locked-rare', 2, 1, true)
  ], { maxRarity: 5 });
  assert.deepEqual(r.salvaged, ['common', 'legendary']);
  assert.deepEqual(Array.from(r.context.G.inventory, (it) => it.id), ['mythic', 'genesis', 'locked-rare']);
});

test('Worker item.salvageBulk 支援等級門檻', () => {
  const r = runSalvage([
    item('lv50-epic', 4, 50), item('lv58-legendary', 5, 58),
    item('lv60-rare', 2, 60), item('lv50-locked', 1, 50, true)
  ], { maxRarity: -1, maxLevel: 58 });
  assert.deepEqual(r.salvaged, ['lv50-epic', 'lv58-legendary']);
  assert.deepEqual(Array.from(r.context.G.inventory, (it) => it.id), ['lv60-rare', 'lv50-locked']);
});

test('Worker item.salvageBulk 同時套用品質與等級門檻', () => {
  const r = runSalvage([
    item('item-50-epic', 4, 50), item('item-58-rare', 2, 58),
    item('item-50-legendary', 5, 50), item('item-60-epic', 4, 60),
    item('item-50-locked-rare', 2, 50, true)
  ], { maxRarity: 4, maxLevel: 58 });
  assert.deepEqual(r.salvaged, ['item-50-epic', 'item-58-rare']);
  assert.deepEqual(Array.from(r.context.G.inventory, (it) => it.id), ['item-50-legendary', 'item-60-epic', 'item-50-locked-rare']);
});

test('Worker item.salvageBulk 支援太古數量門檻', () => {
  const r = runSalvage([
    item('0-ancient', 4, 50, false, 0),
    item('1-ancient', 4, 50, false, 1),
    item('2-ancient', 4, 50, false, 2)
  ], { maxRarity: -1, maxAncient: 1 });
  assert.deepEqual(r.salvaged, ['0-ancient', '1-ancient']);
  assert.deepEqual(Array.from(r.context.G.inventory, (it) => it.id), ['2-ancient']);
});
