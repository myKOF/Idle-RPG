/* 主線任務：開啟寶箱與獲得遺物（2026-11-12）
   1. chestOpenCount：chestOpen 累計開啟個數（一次開 N 個計 N），失敗不計
   2. relicCount：累計獲得遺物件數由存檔現況推回（解鎖 1 件＋各級升級數量＋手上件數），升級不倒退
   3. 任務表確實用到這兩個類型
   4. ONE-TIME MIGRATION taskInsertChestRelicV1：舊存檔的任務索引依兩個插入點平移、冪等、新局不觸發
   數值從表上讀，不寫死任務序號以外的表內容。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = { console, UI: { dirty: {} }, GT: 0 };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/runeword_data.js', 'js/relic_data.js', 'js/relic.js',
   'js/chest_data.js', 'js/chest.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js', 'js/runeword.js',
   'js/skills.js', 'js/skills2.js', 'js/talents.js', 'js/player.js', 'js/factory.js', 'js/newforge.js', 'js/save.js', 'js/tasks.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.blog = () => {};
  context.flog = () => {};
  context.addLog = () => {};
  context.FIELD = { player: null, monster: null, monsters: [] };
  context.G = context.newGameState();
  return context;
}

test('chestOpenCount：一次開 N 個計 N，開箱失敗不計；新局從 0 起算', () => {
  const c = loadContext();
  const goal = { type: 'chestOpenCount', count: 10 };
  assert.equal(c.G.factory.stats.chestOpened, 0);
  assert.equal(c.taskProgressFor(goal), 0);
  const def = c.CHESTS.find((d) => d.init);
  assert.equal(typeof c.chestOpen(def.id, 1), 'string', '沒有寶箱時開箱失敗');
  assert.equal(c.taskProgressFor(goal), 0, '失敗不計');
  c.chestState(def.id).n = 7;
  assert.equal(c.chestOpen(def.id, 3).opened, 3);
  assert.equal(c.taskProgressFor(goal), 3);
  assert.equal(c.chestOpen(def.id, 99).opened, 4, '超過持有數時開到持有數');
  assert.equal(c.taskProgressFor(goal), 7);
});

test('relicCount：解鎖 1 件＋各級升級數量＋手上件數；升級不讓進度倒退', () => {
  const c = loadContext();
  const goal = { type: 'relicCount', count: 3 };
  assert.equal(c.taskProgressFor(goal), 0);
  const a = c.RELICS[0], b = c.RELICS[1];
  c.relicGrant(a.id, 1);
  assert.equal(c.taskProgressFor(goal), 1, '第一件解鎖 Lv.1');
  c.relicGrant(b.id, 1);
  assert.equal(c.taskProgressFor(goal), 2, '不同遺物各算一件');
  const cost = c.relicNextCost(a.id);
  assert.ok(cost > 0);
  c.relicGrant(a.id, cost);
  assert.equal(c.taskProgressFor(goal), 2 + cost, '重複件也算');
  assert.equal(c.relicUpgrade(a.id), null);
  assert.equal(c.relicLevel(a.id), 2);
  assert.equal(c.taskProgressFor(goal), 2 + cost, '升級用掉的件數不扣回');
});

test('任務表：開啟寶箱與獲得遺物兩個任務使用新類型、有目標數量', () => {
  const c = loadContext();
  const chest = c.TASKS.find((t) => t.type === 'chestOpenCount');
  const relic = c.TASKS.find((t) => t.type === 'relicCount');
  assert.ok(chest && chest.count > 0, '任務表要有 chestOpenCount 任務');
  assert.ok(relic && relic.count > 0, '任務表要有 relicCount 任務');
  // 遷移寫死了兩個插入點的索引：表上的位置一變，遷移就要跟著改
  assert.equal(c.TASKS.indexOf(chest), 16, '遷移 taskInsertChestRelicV1 假設開寶箱任務在索引 16');
  assert.equal(c.TASKS.indexOf(relic), 32, '遷移 taskInsertChestRelicV1 假設遺物任務在索引 32');
});

/* 遷移前的存檔＝沒有完成旗標；其餘遷移旗標保留，只測這一支。 */
function oldSave(c, idx) {
  const data = c.newGameState();
  delete data.taskInsertChestRelicV1;
  data.taskState = { idx };
  return data;
}

test('taskInsertChestRelicV1：未走到插入點的接著做新任務，走過的索引 +1', () => {
  const c = loadContext();
  const cases = [
    { idx: 0, want: 0 }, { idx: 16, want: 16 },   // 下一個就是插入點：先做開寶箱任務
    { idx: 17, want: 18 }, { idx: 31, want: 32 },  // 下一個是第二個插入點：接著做遺物任務
    { idx: 32, want: 34 }, { idx: 38, want: 40 }   // 38＝舊表全部領完 → 新表全部領完
  ];
  cases.forEach(({ idx, want }) => {
    const data = c.migrateSave(oldSave(c, idx));
    assert.equal(data.taskState.idx, want, '舊索引 ' + idx);
    assert.equal(data.taskInsertChestRelicV1, true);
  });
  assert.equal(c.TASKS.length, 40);
});

test('taskInsertChestRelicV1：重複讀檔不再平移；新局不觸發', () => {
  const c = loadContext();
  const data = c.migrateSave(oldSave(c, 20));
  assert.equal(data.taskState.idx, 21);
  c.migrateSave(data);
  assert.equal(data.taskState.idx, 21);
  const fresh = c.newGameState();
  assert.equal(fresh.taskInsertChestRelicV1, true);
  fresh.taskState = { idx: 20 };
  c.migrateSave(fresh);
  assert.equal(fresh.taskState.idx, 20);
});
