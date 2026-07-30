const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const logs = [];
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {},
    clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog(message, cls, category) { logs.push({ message, cls, category }); },
    floatText() {},
    trackDps() {},
    recordRunDamage() {},
    logs
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: {}, stage: { current: 1 } };
  return context;
}

test('中毒致死會留下來源與傷害日誌', () => {
  const c = loadContext();
  const enemy = {
    name: '測試怪', maxHp: 100, hp: 5, poisonDps: 100, poisonUntil: 10,
    effects: {}, buffs: {}, dots: []
  };
  c.GT = 0;

  assert.equal(c.tickPoison(enemy, 0.1), true);
  assert.equal(enemy.hp, 0);
  assert.deepEqual(c.logs, [{
    message: '☠️ 測試怪 受到中毒，10 傷害（擊殺）。',
    cls: 'log-player-skill',
    category: 'combat'
  }]);
});

test('多種 DoT 會合併數值但保留各 DoT 名稱', () => {
  const c = loadContext();
  const enemy = {
    name: '測試怪', maxHp: 1000, hp: 1000, poisonDps: 0, poisonUntil: 0,
    effects: {}, buffs: {},
    dots: [
      { name: '流血', dps: 10, until: 10 },
      { name: '燃燒', dps: 20, until: 10 }
    ]
  };
  c.GT = 0;

  assert.equal(c.tickDots(enemy, 0.5), false);
  assert.equal(enemy.hp, 985);
  assert.equal(c.logs.length, 1);
  assert.match(c.logs[0].message, /持續傷害（流血、燃燒）/);
  assert.match(c.logs[0].message, /15 傷害/);
});

test('玩家承受 DoT 不會被誤記為玩家輸出', () => {
  const c = loadContext();
  const player = {
    hp: 100, poisonDps: 10, poisonUntil: 10, effects: {}, buffs: {}, dots: []
  };
  c.GT = 0;

  assert.equal(c.tickPoison(player, 1), false);
  assert.equal(player.hp, 90);
  assert.equal(c.logs.length, 0);
});
