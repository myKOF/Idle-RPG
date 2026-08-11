const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadGameContext(initialZoneProgress) {
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {} },
    blog() {},
    document: { getElementById() { return null; } }
  };
  context.window = context;
  vm.createContext(context);
  const files = ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/player.js', 'js/battlefield.js', 'js/combat.js', 'js/tasks.js', 'js/save.js'];
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }

  context.G = {
    player: { reincarnations: 0, gold: 0 },
    stage: { current: 1, best: 1, kills: 0, autoAdvance: true, zone: 'desert' },
    zoneProgress: initialZoneProgress || { desert: { current: 1, best: 1, cleared: 0 } },
    tower: { active: false }
  };
  context.FIELD.player = { hp: 100, _lockTarget: null };
  return context;
}

test('驗證 1: 第一次到 50 關出 BOSS、打贏推進至 51；手動退回 50 關出菁英怪（骷髏頭圖示、非 2x2）', () => {
  const c = loadGameContext({ desert: { current: 50, best: 50, cleared: 49 } });
  c.G.stage.current = 50;
  c.G.stage.best = 50;
  
  // 第一次到 50 關
  c.spawnFieldMonster();
  const m1 = c.FIELD.monsters[0];
  assert.equal(m1.isBoss, true, '第一次進入 50 關應出 BOSS');
  assert.equal(m1.elite, false);
  assert.equal(c.bfEntitySize(m1).w, 2, 'BOSS 為 2x2');
  assert.equal(c.bfEntitySize(m1).h, 2);

  // 打贏 50 關 BOSS
  c.FIELD._waveClearPending = true;
  c.completeFieldWave({ hp: 100, moveSpeed: 0 });

  assert.equal(c.G.stage.current, 51, '打贏後自動推進到 51');
  assert.equal(c.zoneClearedStage('desert'), 50, 'cleared 紀錄為 50');

  // 手動退回 50 關
  c.G.stage.current = 50;
  c.spawnFieldMonster();
  const m2 = c.FIELD.monsters[0];
  assert.equal(m2.isBoss, false, '手動退回 50 關不應再出 BOSS');
  assert.equal(m2.elite, true, '應出菁英怪');
  assert.notEqual(c.bfEntitySize(m2).w, 2, '菁英怪非 2x2');
});

test('驗證 2: 50 關 BOSS 戰中死亡退階 -> 回到 50 關時 BOSS 仍在', () => {
  const c = loadGameContext({ desert: { current: 50, best: 50, cleared: 49 } });
  c.G.stage.current = 50;
  c.spawnFieldMonster();
  assert.equal(c.FIELD.monsters[0].isBoss, true);

  // 死亡退階（退至 40 關）
  c.onPlayerFieldDeath();
  assert.equal(c.G.stage.current, 40);
  assert.equal(c.zoneClearedStage('desert'), 49, 'cleared 仍為 49');

  // 再次推進回到 50 關
  c.G.stage.current = 50;
  c.spawnFieldMonster();
  assert.equal(c.FIELD.monsters[0].isBoss, true, '死亡退階後重新挑戰 50 關 BOSS 仍在');
});

test('驗證 3: 換圖：冰原第 50 關仍出 BOSS（逐圖獨立進度）', () => {
  const c = loadGameContext({
    desert: { current: 51, best: 51, cleared: 50 },
    Icefield: { current: 1, best: 1, cleared: 0 }
  });

  // 荒漠 50 關已通關
  assert.equal(c.isFieldBossDefeated('desert', 50), true);

  // 切換至冰原 50 關
  c.G.stage.zone = 'Icefield';
  c.G.stage.current = 50;
  c.G.stage.best = 50;
  c.spawnFieldMonster();

  assert.equal(c.isFieldBossDefeated('Icefield', 50), false);
  assert.equal(c.FIELD.monsters[0].isBoss, true, '冰原第 50 關仍獨立出 BOSS');
});

test('驗證 4: 主線任務「挑戰荒漠第 50/100 關 BOSS 成功」仍能正常完成', () => {
  const c = loadGameContext({ desert: { current: 50, best: 50, cleared: 49 } });
  c.G.stage.current = 50;
  const taskDef = { type: 'stageClear', param: 'desert', count: 50 };

  assert.equal(c.taskProgressFor(taskDef), 49, '未打贏 BOSS 前進度為 49');

  // 打贏 50 關 BOSS
  c.FIELD._waveClearPending = true;
  c.completeFieldWave({ hp: 100, moveSpeed: 0 });

  assert.equal(c.taskProgressFor(taskDef), 50, '打贏 BOSS 後任務進度達 50/50 成功完成');
});

test('驗證 5: 舊存檔（已推過 100 關）載入後，50/100 關直接出菁英，不跳錯誤', () => {
  const c = loadGameContext();
  const legacySaveData = {
    player: { reincarnations: 0 },
    stage: { zone: 'desert', current: 105, best: 105 },
    zoneProgress: { desert: { current: 105, best: 105 } }
  };

  // 載入舊存檔 (舊存檔中無 cleared 欄位，由 migrateSave 補全為 best - 1 = 104)
  c.G = c.migrateSave(legacySaveData);

  assert.equal(c.zoneClearedStage('desert'), 104);

  // 檢查 50 關
  c.G.stage.current = 50;
  c.spawnFieldMonster();
  assert.equal(c.FIELD.monsters[0].isBoss, false, '50 關直接出菁英');
  assert.equal(c.FIELD.monsters[0].elite, true);

  // 檢查 100 關
  c.G.stage.current = 100;
  c.spawnFieldMonster();
  assert.equal(c.FIELD.monsters[0].isBoss, false, '100 關直接出菁英');
  assert.equal(c.FIELD.monsters[0].elite, true);
});
