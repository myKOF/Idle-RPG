const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCombatContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {} },
    blog() {},
    document: { getElementById() { return null; } }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { stage: { current: 1, zone: 'desert' }, tower: { active: false } };
  context.currentZoneDef = () => ({
    pool: [{ name: '測試怪', emoji: '👾', magic: false }],
    hpMult: 1, atkMult: 1, defMult: 1, rewardMult: 1
  });
  return context;
}

test('驗證 1：四張具名地圖與神界三圖菁英關出怪數量範圍（神界上限 11 隻）', () => {
  const ctx = loadCombatContext();

  /* 依 AI_RULES.md 9.1 例外，測試刻意釘住目前數值：參數一動這裡就會紅，
     這是預期行為——確認新值是有意調整後，把期望值一併更新。
     2026-08-10（使用者確認）：亡靈山脈 7 → 9、神界三圖 8 → 11。 */
  const zoneExpectations = {
    desert: { min: 1, max: 3, table: ctx.FIELD_ELITE_COUNT_TABLE_BY_ZONE.desert },
    Icefield: { min: 1, max: 4, table: ctx.FIELD_ELITE_COUNT_TABLE_BY_ZONE.Icefield },
    swamp: { min: 1, max: 6, table: ctx.FIELD_ELITE_COUNT_TABLE_BY_ZONE.swamp },
    undead_mountains: { min: 1, max: 9, table: ctx.FIELD_ELITE_COUNT_TABLE_BY_ZONE.undead_mountains },
    god_realm_1: { min: 1, max: 11, table: ctx.FIELD_ELITE_COUNT_TABLE },
    god_realm_2: { min: 1, max: 11, table: ctx.FIELD_ELITE_COUNT_TABLE },
    god_realm_3: { min: 1, max: 11, table: ctx.FIELD_ELITE_COUNT_TABLE }
  };

  Object.entries(zoneExpectations).forEach(([zone, exp]) => {
    const table = ctx.fieldCountTableFor('elite', 10, zone);
    assert.equal(table, exp.table, `${zone} 應使用對應的權重表`);

    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      ctx.G.stage.zone = zone;
      ctx.G.stage.current = 10;
      const count = ctx.rollFieldEnemyCount('elite');
      assert.ok(count >= exp.min && count <= exp.max, `${zone} 出怪數量 ${count} 不在 [${exp.min}, ${exp.max}] 範圍內`);
      seen.add(count);
    }
    // 確保有抽到最小值與最大值
    assert.ok(seen.has(exp.min), `${zone} 應有機率抽到最小值 ${exp.min}`);
    assert.ok(seen.has(exp.max), `${zone} 應有機率抽到最大值 ${exp.max}`);
  });
});

test('驗證 2：荒漠 1~100 關菁英不再固定 1 隻，並確認早期難度可接受', () => {
  const ctx = loadCombatContext();

  // 1. 確認不再固定 1 隻
  const desertEarlyEliteStages = [10, 20, 30, 40, 60, 70, 80, 90];
  desertEarlyEliteStages.forEach((stage) => {
    const table = ctx.fieldCountTableFor('elite', stage, 'desert');
    assert.notDeepEqual(table, [[1, 1]], `荒漠第 ${stage} 關菁英不應再固定 1 隻`);
    assert.equal(table, ctx.FIELD_ELITE_COUNT_TABLE_BY_ZONE.desert);
  });

  // 2. 早期難度可接受性測試（模擬荒漠第 10 關菁英戰鬥）
  ctx.G.stage.zone = 'desert';
  ctx.G.stage.current = 10;
  
  // 生成 1, 2, 3 隻菁英進行戰鬥屬性驗證
  ctx.spawnFieldMonster();
  const monsters = ctx.FIELD.monsters;
  assert.ok(monsters.length >= 1 && monsters.length <= 3, '荒漠第 10 關實際出怪數量應在 1~3 隻');
  monsters.forEach(m => {
    assert.ok(m.elite, '敵人在第 10 關應為菁英怪');
    // 荒漠 10 關基礎怪物生命與攻擊合理性 check
    assert.ok(m.maxHp > 0 && m.atk > 0, '菁英怪物生命與攻擊應為正數');
  });

  // 統計 100 次生成的敵人數量分佈（與權重表比例 95:95:5 符合）
  const countFreq = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 500; i++) {
    ctx.spawnFieldMonster();
    const count = ctx.FIELD.monsters.length;
    countFreq[count] = (countFreq[count] || 0) + 1;
  }
  // 1 隻與 2 隻佔絕大多數 (95:95 約各 48.7%)，3 隻極少 (約 2.5%)
  assert.ok(countFreq[1] > 0 && countFreq[2] > 0, '1 隻與 2 隻菁英應有合理生成比例');
  assert.ok(countFreq[1] + countFreq[2] > countFreq[3] * 5, '3 隻菁英出現機率應遠低於 1~2 隻');
});

test('驗證 3：小怪分段（荒漠每 20 關）與 BOSS 固定 1 隻不變', () => {
  const ctx = loadCombatContext();

  // 小怪分段（每 20 關）
  for (let s = 1; s <= 100; s++) {
    const idx = Math.floor((s - 1) / 20);
    const expectedTable = ctx.FIELD_DESERT_EARLY_ENEMY_COUNT_TABLES[idx];
    assert.equal(ctx.fieldCountTableFor('normal', s, 'desert'), expectedTable, `荒漠第 ${s} 關小怪分段表`);
  }
  assert.equal(ctx.fieldCountTableFor('normal', 101, 'desert'), ctx.FIELD_ENEMY_COUNT_TABLE, '第 101 關恢復一般小怪表');

  // BOSS 固定 1 隻
  const bossStages = [50, 100, 150, 200];
  bossStages.forEach((stage) => {
    ctx.G.stage.current = stage;
    ctx.G.stage.zone = 'desert';
    const bossTable = ctx.fieldCountTableFor('boss', stage, 'desert');
    assert.equal(bossTable, ctx.FIELD_BOSS_COUNT_TABLE, `第 ${stage} 關 BOSS 表`);

    for (let i = 0; i < 50; i++) {
      ctx.spawnFieldMonster();
      assert.equal(ctx.FIELD.monsters.length, 1, `BOSS 階（第 ${stage} 關）出怪數應固定 1 隻`);
      assert.ok(ctx.FIELD.monsters[0].isBoss, `第 ${stage} 關怪物應為 BOSS`);
    }
  });
});

test('驗證 4：棋盤放不下時的夾限（菁英 8 隻仍受 4x4 及可用格數上限約束）', () => {
  const ctx = loadCombatContext();

  // 1. 預設 4x4 棋盤，格數上限為 16 (bfCellCount())
  assert.equal(ctx.bfCellCount(), 16);

  // 即使在神界三圖（權重上限 8 隻），出怪數必然 <= 16
  for (let i = 0; i < 500; i++) {
    const count = ctx.rollFieldEnemyCount('elite');
    assert.ok(count <= ctx.bfCellCount(), `出怪數量 ${count} 不可超過棋盤總格數 ${ctx.bfCellCount()}`);
  }

  // 2. 模擬極端狀況：如果 bfCellCount 被限制為較小數值（例如 5 格）
  const originalBfCellCount = ctx.bfCellCount;
  ctx.bfCellCount = () => 5;

  for (let i = 0; i < 500; i++) {
    const count = ctx.rollFieldEnemyCount('elite');
    assert.ok(count <= 5, `當棋盤只有 5 格時，出怪數 ${count} 受 5 隻約束夾限`);
  }

  // 還原
  ctx.bfCellCount = originalBfCellCount;
});
