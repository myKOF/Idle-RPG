const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

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
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { stage: { current: 1 }, tower: { active: false } };
  context.currentZoneDef = () => ({
    pool: [{ name: '測試怪', emoji: '👾', magic: false }],
    hpMult: 1, atkMult: 1, defMult: 1, rewardMult: 1
  });
  return context;
}

/* 數量由權重表決定，期望值一律由表推導——寫死數字的話，
   每次在參數表調權重就會誤報成測試失敗（詳見 tests/enemy-hit.test.cjs 的同款教訓）。 */
function weightedRange(table) {
  const live = table.filter(([, w]) => w > 0).map(([n]) => n);
  return { min: Math.min(...live), max: Math.max(...live) };
}

test('每波數量依權重表擲骰：權重 0 不會被抽中，且不超過棋盤格數', () => {
  const context = loadFormulaContext();
  const range = weightedRange(context.FIELD_ENEMY_COUNT_TABLE);
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(context.rollFieldEnemyCount('normal'));
  seen.forEach((n) => {
    assert.ok(n >= range.min && n <= range.max, n + ' 不在權重表的有效範圍內');
    assert.ok(n <= context.bfCellCount(), '不得超過棋盤格數');
    const w = context.FIELD_ENEMY_COUNT_TABLE.find(([c]) => c === n);
    assert.ok(w && w[1] > 0, n + ' 的權重是 0，不該被抽中');
  });
});

test('小怪／菁英／BOSS 各用自己的權重表（菁英不會跟著小怪出一大群）', () => {
  const context = loadFormulaContext();
  // 三張表必須是各自獨立的來源
  assert.notEqual(context.FIELD_ELITE_COUNT_TABLE, context.FIELD_ENEMY_COUNT_TABLE);
  assert.notEqual(context.FIELD_BOSS_COUNT_TABLE, context.FIELD_ENEMY_COUNT_TABLE);

  const eliteMax = weightedRange(context.FIELD_ELITE_COUNT_TABLE).max;
  const normalMax = weightedRange(context.FIELD_ENEMY_COUNT_TABLE).max;
  assert.ok(eliteMax < normalMax, '菁英上限應低於小怪——菁英出一大群根本打不動');

  for (let i = 0; i < 3000; i++) {
    assert.ok(context.rollFieldEnemyCount('elite') <= eliteMax, '菁英數量超出自己的表');
    assert.ok(context.rollFieldEnemyCount('boss') <= weightedRange(context.FIELD_BOSS_COUNT_TABLE).max,
      'BOSS 數量超出自己的表');
  }
  // 未指定敵種時沿用小怪表（既有呼叫端不受影響）
  assert.equal(context.fieldCountTableFor(), context.FIELD_ENEMY_COUNT_TABLE);
  assert.equal(context.fieldCountTableFor('elite'), context.FIELD_ELITE_COUNT_TABLE);
  assert.equal(context.fieldCountTableFor('boss'), context.FIELD_BOSS_COUNT_TABLE);
});

test('草原前 100 關每 20 關套用小怪分段表，菁英固定 1 隻，100 關後恢復正常', () => {
  const context = loadFormulaContext();
  const ranges = [1, 20, 21, 40, 41, 60, 61, 80, 81, 100];
  ranges.forEach((stage) => {
    const index = Math.floor((stage - 1) / 20);
    assert.equal(context.fieldCountTableFor('normal', stage, 'plains'),
      context.FIELD_PLAINS_EARLY_ENEMY_COUNT_TABLES[index], '草原第 ' + stage + ' 關小怪分段');
    assert.deepEqual(JSON.parse(JSON.stringify(context.fieldCountTableFor('elite', stage, 'plains'))), [[1, 1]],
      '草原第 ' + stage + ' 關菁英應固定 1 隻');
  });
  assert.equal(context.fieldCountTableFor('normal', 101, 'plains'), context.FIELD_ENEMY_COUNT_TABLE);
  assert.equal(context.fieldCountTableFor('elite', 101, 'plains'), context.FIELD_ELITE_COUNT_TABLE);
  assert.equal(context.fieldCountTableFor('normal', 1, 'desert'), context.FIELD_ENEMY_COUNT_TABLE);
  assert.equal(context.fieldCountTableFor('elite', 1, 'desert'), context.FIELD_ELITE_COUNT_TABLE);

  const combat = loadCombatContext();
  [1, 21, 41, 61, 81].forEach((stage) => {
    combat.G.stage.current = stage;
    combat.G.stage.zone = 'plains';
    combat.spawnFieldMonster();
    const table = combat.FIELD_PLAINS_EARLY_ENEMY_COUNT_TABLES[Math.floor((stage - 1) / 20)];
    const range = weightedRange(table);
    assert.ok(combat.FIELD.monsters.length >= range.min && combat.FIELD.monsters.length <= range.max,
      '實際出怪未套用草原第 ' + stage + ' 關分段表');
  });
  combat.G.stage.current = 10;
  combat.spawnFieldMonster();
  assert.equal(combat.FIELD.monsters.length, 1, '實際出怪的草原菁英應固定 1 隻');
  combat.G.stage.current = 101;
  combat.spawnFieldMonster();
  const normalRange = weightedRange(combat.FIELD_ENEMY_COUNT_TABLE);
  assert.ok(combat.FIELD.monsters.length >= normalRange.min && combat.FIELD.monsters.length <= normalRange.max,
    '草原第 101 關應恢復一般小怪表');
});

test('出怪依階段敵種選用對應的數量表', () => {
  const context = loadCombatContext();
  const eliteMax = weightedRange(context.FIELD_ELITE_COUNT_TABLE).max;

  context.G.stage.current = 1;   // 小怪
  for (let i = 0; i < 60; i++) {
    context.spawnFieldMonster();
    assert.ok(context.FIELD.monsters.every((e) => !e.elite && !e.isBoss));
    assert.ok(context.FIELD.monsters.length >= 1);
  }

  context.G.stage.current = 10;  // 菁英（10 的倍數）
  for (let i = 0; i < 60; i++) {
    context.spawnFieldMonster();
    assert.ok(context.FIELD.monsters.every((e) => e.elite), '第 10 階應為菁英');
    assert.ok(context.FIELD.monsters.length <= eliteMax,
      '菁英數量應受菁英表限制，實際 ' + context.FIELD.monsters.length);
  }

  context.G.stage.current = 50;  // BOSS（50 的倍數，優先於菁英）
  for (let i = 0; i < 30; i++) {
    context.spawnFieldMonster();
    assert.ok(context.FIELD.monsters.every((e) => e.isBoss), '第 50 階應為 BOSS');
    assert.ok(context.FIELD.monsters.length <= weightedRange(context.FIELD_BOSS_COUNT_TABLE).max);
  }
});

test('多敵人逐一擊殺時各自結算經驗與掉落，全部擊殺後才推進', () => {
  const context = loadCombatContext();
  const xp = [];
  context.G = {
    player: { gold: 0 },
    stage: { current: 1, best: 1, kills: 0, autoAdvance: true },
    tower: { active: false }
  };
  context.FIELD.player = context.newPlayerEntity({ hp: 100, mp: 0, aspd: 1 });
  context.getStats = () => ({ hp: 100, goldBonus: 0, xpBonus: 0, moveSpeed: 0, passives: {} });
  context.healPlayer = () => {};
  context.gainXp = (amount) => xp.push(amount);
  context.rollFieldDrops = (enemy) => ['掉落' + enemy.name];
  const first = { name: '甲', hp: 0, maxHp: 10, gold: 10, xp: 20, elite: false };
  const second = { name: '乙', hp: 10, maxHp: 10, gold: 30, xp: 40, elite: false };
  context.FIELD.monsters = [first, second];
  context.FIELD.monster = first;
  context.tickSkillCds = () => {};

  context.onFieldKill(first);
  assert.equal(context.G.player.gold, 10);
  assert.deepEqual(xp, [20]);
  assert.equal(context.FIELD.monsters.length, 2);
  assert.equal(context.FIELD.monsters[0], first);
  assert.equal(first._deathClearCd, context.FIELD_ENEMY_DEATH_CLEAR_DELAY);
  assert.equal(context.liveFieldEnemies().length, 1);
  assert.equal(context.visibleFieldEnemies().length, 2);
  assert.equal(context.G.stage.current, 1);
  assert.equal(context.G.stage.kills, 0);

  context.tickFieldDeathClears(context.FIELD_ENEMY_DEATH_CLEAR_DELAY - 0.01);
  assert.equal(context.FIELD.monsters.length, 2);
  context.tickFieldDeathClears(0.02);
  assert.equal(context.FIELD.monsters.length, 1);
  assert.equal(context.FIELD.monsters[0], second);

  second.hp = 0;
  context.onFieldKill(second);
  assert.equal(context.G.player.gold, 40);
  assert.deepEqual(xp, [20, 40]);
  assert.equal(context.FIELD.monsters.length, 1);
  assert.equal(context.visibleFieldEnemies().length, 1);
  assert.equal(context.G.stage.current, 1);
  assert.equal(context.G.stage.kills, 0);

  context.fieldTick(context.FIELD_ENEMY_DEATH_CLEAR_DELAY - 0.01);
  assert.equal(context.FIELD.monsters.length, 1);
  assert.equal(context.G.stage.current, 1);
  context.fieldTick(0.02);
  assert.equal(context.FIELD.monsters.length, 0);
  assert.equal(context.G.stage.current, 2);
  assert.equal(context.G.stage.best, 2);
  assert.equal(context.G.stage.kills, 1);
});

test('關閉自動推進時完成關卡仍解鎖下一關，但留在目前關卡', () => {
  const context = loadCombatContext();
  context.G = {
    player: { gold: 0 },
    stage: { current: 40, best: 40, kills: 0, autoAdvance: false, zone: 'plains' },
    tower: { active: false }
  };
  context.FIELD.player = context.newPlayerEntity({ hp: 100, mp: 0, aspd: 1 });
  context.getStats = () => ({ hp: 100, moveSpeed: 0, passives: {} });
  context.healPlayer = () => {};
  context.FIELD._waveClearPending = true;

  context.completeFieldWave(context.getStats());

  assert.equal(context.G.stage.current, 40);
  assert.equal(context.G.stage.best, 41);
});

test('自動推進打通地圖上限後切到下一張地圖第 1 關', () => {
  const context = loadCombatContext();
  context.G = {
    player: { gold: 0, reincarnations: 0 },
    stage: { current: 200, best: 200, kills: 0, autoAdvance: true, zone: 'plains' },
    zoneProgress: { plains: { current: 200, best: 200, cleared: 199 } },
    tower: { active: false }
  };
  context.FIELD.player = context.newPlayerEntity({ hp: 100, mp: 0, aspd: 1 });
  context.getStats = () => ({ hp: 100, moveSpeed: 0, passives: {} });
  context.healPlayer = () => {};
  context.FIELD._waveClearPending = true;

  context.completeFieldWave(context.getStats());

  assert.equal(context.G.stage.zone, 'desert');
  assert.equal(context.G.stage.current, 1);
  assert.equal(context.G.stage.best, 1);
  assert.equal(context.G.zoneProgress.plains.cleared, 200);
  assert.equal(context.FIELD.mapComplete, false);
  assert.equal(context.FIELD.monsters.length, 0);
});

test('普攻擊殺後換目標至少間隔技能 GCD 0.4 秒', () => {
  const context = loadCombatContext();
  const player = { atkCd: 1 / 4.7 };

  context.applyBasicAttackKillGap(player, 1);
  assert.equal(player.atkCd, 0.4);

  // 若原本計時器更長，擊殺間隔不能把它縮短。
  player.atkCd = 0.6;
  context.applyBasicAttackKillGap(player, 1);
  assert.equal(player.atkCd, 0.6);
});

test('戰鬥畫面與敵方 tooltip 使用可見敵人列表，保留死亡待清除敵人資訊', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const data = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(ui, /currentCombatEnemyEntity[\s\S]*battle && battle\.field/);
  assert.match(ui, /renderBattle[\s\S]*battleSnapshot\.field/);
  assert.match(ui, /enemy\.hp > 0 \|\| \(enemy\._rewarded && Number\(enemy\._deathClearCd\) > 0\)/);
  assert.match(ui, /card\.classList\.toggle\('is-dead', liveEnemy\.hp <= 0\)/);
  assert.match(css, /\.enemy-card\.is-dead\s*>\s*:not\(\.float-layer\)\s*\{[\s\S]*animation:\s*enemyDeathFade 2s linear forwards/);
  assert.match(css, /@keyframes enemyDeathFade\s*\{[\s\S]*opacity:\s*1[\s\S]*opacity:\s*0\.1/);

  const floatLifetime = Number(ui.match(/var FLOAT_TEXT_LIFETIME_MS = (\d+)/)?.[1]);
  const deathDelaySeconds = Number(data.match(/var FIELD_ENEMY_DEATH_CLEAR_DELAY = ([\d.]+)/)?.[1]);
  assert.ok(Number.isFinite(floatLifetime));
  assert.ok(Number.isFinite(deathDelaySeconds));
  assert.ok(deathDelaySeconds * 1000 > floatLifetime, '死亡保留時間必須長於傷害飄字動畫');
});

test('可直接前進到目前場景最高階段', () => {
  const context = loadCombatContext();
  context.G.stage.current = 61;
  context.G.stage.best = 280;
  context.G.stage.kills = 7;
  context.stageGoMax();
  assert.equal(context.G.stage.current, 200);
  assert.equal(context.G.stage.kills, 0);
  assert.equal(context.FIELD.monsters.length, 0);
});

test('敵人集合暫時為空時仍能以目前目標提供畫面資料', () => {
  const context = loadCombatContext();
  const activeEnemy = { name: '目前目標', hp: 100, maxHp: 100 };
  context.FIELD.monsters = [];
  context.FIELD.monster = activeEnemy;
  assert.equal(context.fieldEnemyList().length, 1);
  assert.equal(context.fieldEnemyList()[0].name, '目前目標');
});
