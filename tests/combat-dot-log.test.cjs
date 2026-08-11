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
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: {}, stage: { current: 1 } };
  return context;
}

/* 2026-08-11 技能及狀態改造：中毒不再是獨立的一套（poisonDps/poisonUntil 已移除），
   它就是狀態表的 poison，與其他持續傷害走同一條 dots 索引與同一支 tickStatuses。 */
test('中毒致死會留下來源與傷害日誌', () => {
  const c = loadContext();
  const enemy = { name: '測試怪', maxHp: 100, hp: 5, effects: {}, buffs: {}, dots: [] };
  c.GT = 0;
  c.applyPoison(enemy, 100, 10);

  // 作用間隔 1 秒（狀態表 poison）：滿一個間隔才跳一次傷害
  assert.equal(c.tickStatuses(enemy, 0.5), false);
  assert.equal(enemy.hp, 5, '未滿一次作用間隔不跳傷');
  assert.equal(c.tickStatuses(enemy, 0.5), true);
  assert.equal(enemy.hp, 0);
  assert.deepEqual(c.logs, [{
    message: '☠️ 測試怪 受到中毒，100 傷害（擊殺）。',
    cls: 'log-player-skill',
    category: 'combat'
  }]);
});

test('多種 DoT 會合併數值但保留各 DoT 名稱', () => {
  const c = loadContext();
  const enemy = { name: '測試怪', maxHp: 1000, hp: 1000, effects: {}, buffs: {}, dots: [] };
  c.GT = 0;
  c.applyDot(enemy, 10, 10, '流血');
  c.applyDot(enemy, 20, 10, '燃燒');

  // 兩者作用間隔皆 1 秒：同一次跳動合併成一行日誌
  assert.equal(c.tickStatuses(enemy, 1), false);
  assert.equal(enemy.hp, 970);
  assert.equal(c.logs.length, 1);
  assert.match(c.logs[0].message, /持續傷害（流血、燃燒）/);
  assert.match(c.logs[0].message, /30 傷害/);
});

/* 作用間隔只改變跳傷節奏，不改變總量：到期時會把不足一次間隔的餘額補跳。 */
test('持續傷害總量＝每秒傷害 × 持續時間（作用間隔不影響總量）', () => {
  const c = loadContext();
  const enemy = { name: '測試怪', maxHp: 10000, hp: 10000, effects: {}, buffs: {}, dots: [] };
  c.GT = 0;
  c.applyDot(enemy, 100, 4.5, '燃燒');
  for (let i = 0; i < 60; i++) { c.GT += 0.1; c.tickStatuses(enemy, 0.1); }
  // 容差＝一幀的量：遊戲時鐘是累加浮點數，最後一幀落在到期前或到期後會差一幀（改造前的連續結算同此）
  const dealt = 10000 - enemy.hp;
  assert.ok(Math.abs(dealt - 450) <= 10, '總傷害應約為 100 × 4.5 秒，實得 ' + dealt);
  assert.equal(enemy.dots.length, 0, '到期後應移除');
});

test('玩家承受 DoT 不會被誤記為玩家輸出', () => {
  const c = loadContext();
  const player = { hp: 100, effects: {}, buffs: {}, dots: [] };
  c.GT = 0;
  c.applyPoison(player, 10, 10);

  assert.equal(c.tickStatuses(player, 1), false);
  assert.equal(player.hp, 90);
  assert.equal(c.logs.length, 0);
});
