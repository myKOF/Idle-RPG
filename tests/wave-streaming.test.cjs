/* 波次串流（2026-08 戰鬥改造）
   敵人改成「每隔幾秒補一波，不等場上清空」，清不完就會愈積愈多，撐不住被打死退關。
   連帶改變的是推進判定：從「整波清空」改為「殺滿本關配額」。
   本檔鎖住這四件事：串流補波、棋盤上限、BOSS 關不串流、全部關卡直接使用主參數表。 */
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
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: { gold: 0 },
    stage: { current: 5, best: 5, kills: 0, autoAdvance: true, zone: 'desert' },
    tower: { active: false },
    zoneProgress: {}
  };
  context.currentZoneDef = () => ({
    pool: [{ name: '測試怪', emoji: '👾', magic: false }],
    hpMult: 1, atkMult: 1, defMult: 1, rewardMult: 1, aspdMult: 1
  });
  return context;
}

test('補波不會動到既有敵人的座標，新怪各自生在生成圓上', () => {
  const context = loadCombatContext();
  context.spawnFieldMonster();                       // 整批出一波（原行為）
  const firstWave = context.FIELD.monsters.slice();
  assert.ok(firstWave.length >= 1);
  const before = firstWave.map((m) => `${m.floatSel}@${Math.round(m.pos.x)},${Math.round(m.pos.y)}`);

  const added = context.spawnFieldMonster(true);     // 串流補一波
  const after = firstWave.map((m) => `${m.floatSel}@${Math.round(m.pos.x)},${Math.round(m.pos.y)}`);
  assert.deepEqual(after, before, '既有敵人的座標不得因為補波而改變');
  assert.equal(context.FIELD.monsters.length, firstWave.length + added.length);

  // 新怪一律生在生成圓上（之後才朝我方逼近）
  added.forEach((m) => {
    const d = Math.sqrt(m.pos.x * m.pos.x + m.pos.y * m.pos.y);
    assert.ok(Math.abs(d - context.BF_SPAWN_DIST) <= context.BF_SPAWN_DIST * 0.1,
      '新怪應生在生成圓上，實際距離 ' + Math.round(d));
  });
});

test('場上達到同時上限後補波直接跳過，不會憑空產生放不下的敵人', () => {
  const context = loadCombatContext();
  const cap = context.fieldMaxLiveEnemiesFor(context.G.stage.current, context.G.stage.zone);
  assert.ok(cap >= 1 && cap <= context.bfCellCount(), '同時上限必須落在 1~棋盤格數之間');
  // 每波只補幾隻，棋盤格數可由參數表放大（10×10＝100 格），迴圈上限要夠寬
  let guard = 0;
  while (context.liveFieldEnemies().length < cap && guard++ < 500) {
    if (!context.spawnFieldMonster(true).length) break;
  }
  assert.equal(context.liveFieldEnemies().length, cap, '應該補到同時上限為止');
  const full = context.FIELD.monsters.length;
  // 陣列來自 vm 沙箱，原型不同，不能用 deepEqual 比對；看長度即可
  assert.equal(context.spawnFieldMonster(true).length, 0, '滿場時補波必須什麼都不生');
  assert.equal(context.FIELD.monsters.length, full, '滿場時不得增加任何敵人');
});

test('全部地圖與關卡的同時上限直接跟隨參數表棋盤容量', () => {
  const context = loadCombatContext();
  for (const [cols, rows, cap] of [[10, 10, 100], [3, 7, 21], [1, 1, 1]]) {
    context.BF_COLS = cols;
    context.BF_ROWS = rows;
    for (const zone of context.ZONE_LIST) for (const stage of [1, 50, 9999]) {
      context.G.stage.zone = zone;
      context.G.stage.current = stage;
      assert.equal(context.fieldMaxLiveEnemiesFor(), cap, zone + ' ' + stage);
    }
  }
});

test('fieldTick 每隔一個波次間隔補一波，不等場上清空', () => {
  const context = loadCombatContext();
  context.FIELD.player = context.newPlayerEntity({ hp: 1e9, mp: 0, aspd: 0.0001 });
  context.getStats = () => ({ hp: 1e9, mp: 0, goldBonus: 0, xpBonus: 0, moveSpeed: 0, passives: {} });
  context.tickSkillCds = () => {};
  context.healPlayer = () => {};
  context.pickAndCastSkill = () => false;    // 技能層（skills.js）不在本測試的載入清單內
  context.doPlayerAttack = () => false;      // 玩家不出手：只觀察出怪
  context.fieldMonsterAttack = () => false;  // 敵人不出手：不受傷害流程干擾
  /* 間隔釘成單一值：參數表可以填候選陣列（每波隨機抽），那樣這支測試量到的
     interval 與模擬層下一波實際用的值會是不同的抽樣，時序假設就不成立。 */
  context.FIELD_WAVE_SPAWN_INTERVAL = 2;

  const interval = context.fieldWaveIntervalFor(context.G.stage.current, context.G.stage.zone);
  assert.ok(interval > 0);

  context.fieldTick(0.1);                    // 第一波（空場時立刻出）
  const afterFirst = context.liveFieldEnemies().length;
  assert.ok(afterFirst >= 1, '第一波應該要出怪');

  context.fieldTick(interval * 0.4);          // 還沒到間隔
  assert.equal(context.liveFieldEnemies().length, afterFirst, '未達間隔不得補波');

  context.fieldTick(interval);                // 跨過間隔
  assert.ok(context.liveFieldEnemies().length > afterFirst,
    '達到間隔就要補波，即使上一波一隻都沒死');
});

test('BOSS 還活著時不補波（避免每個間隔多冒一隻 BOSS）', () => {
  const context = loadCombatContext();
  context.G.stage.current = context.FIELD_BOSS_STAGE_INTERVAL; // BOSS 關
  context.FIELD.player = context.newPlayerEntity({ hp: 1e9, mp: 0, aspd: 0.0001 });
  context.getStats = () => ({ hp: 1e9, mp: 0, goldBonus: 0, xpBonus: 0, moveSpeed: 0, passives: {} });
  context.tickSkillCds = () => {};
  context.healPlayer = () => {};
  context.pickAndCastSkill = () => false;
  context.doPlayerAttack = () => false;
  context.fieldMonsterAttack = () => false;

  context.fieldTick(0.1);
  const bossWave = context.liveFieldEnemies();
  assert.equal(bossWave.length, 1);
  assert.equal(bossWave[0].isBoss, true);
  assert.equal(context.hasLiveFieldBoss(), true);

  const interval = context.fieldWaveIntervalFor(context.G.stage.current, context.G.stage.zone);
  context.fieldTick(interval * 3);
  assert.equal(context.liveFieldEnemies().length, 1, 'BOSS 戰期間不得補波');
});

test('過關配額只認本關生出來的敵人（否則 BOSS 關會被殘留怪推過去）', () => {
  /* 2026-08-13 的實際 bug：換關之後不再清場（設計如此），上一關的殘留會留在場上。
     BOSS 關的配額只有 1，而 BOSS 要等切換後的間隔才生出來——玩家在那幾秒內
     順手清掉一隻殘留，配額就滿了，關卡直接跳過，BOSS 從頭到尾沒出現過。 */
  const context = loadCombatContext();
  context.getStats = () => ({ hp: 100, goldBonus: 0, xpBonus: 0, moveSpeed: 0, passives: {} });
  context.gainXp = () => {};
  context.rollFieldDrops = () => [];
  context.G.stage.current = 49;
  context.G.stage.best = 49;
  context.G.zoneProgress = { desert: { current: 49, best: 49, cleared: 48 } };

  context.spawnFieldMonster();                       // 第 49 關的一波
  const leftovers = context.FIELD.monsters.slice();
  assert.ok(leftovers.length >= 1);
  leftovers.forEach((m) => assert.equal(m._stage, 49, '敵人要記得自己屬於哪一關'));

  context.G.stage.current = 50;                      // 推進到 BOSS 關（殘留照舊留在場上）
  context.FIELD.quotaStage = null;
  assert.equal(context.fieldStageQuota(), context.rollFieldEnemyCount('boss', 50, 'desert'));

  leftovers.forEach((m) => { m.hp = 0; context.onFieldKill(m); });
  assert.equal(context.FIELD._waveClearPending, false, '殺殘留不該推進 BOSS 關');
  assert.equal(context.FIELD.stageKills, 0);

  /* 這一關自己生出來的（BOSS）死掉才算數。 */
  const boss = context.spawnFieldMonster(true)[0];
  assert.equal(boss._stage, 50);
  assert.ok(boss.isBoss, '第 50 關第一波應該是 BOSS');
  boss.hp = 0;
  context.onFieldKill(boss);
  assert.equal(context.FIELD._waveClearPending, true, '打死 BOSS 才過關');
});

test('推進改由擊殺配額觸發：殺滿才過關，沒殺滿不過關', () => {
  const context = loadCombatContext();
  context.FIELD.player = context.newPlayerEntity({ hp: 100, mp: 0, aspd: 1 });
  context.getStats = () => ({ hp: 100, goldBonus: 0, xpBonus: 0, moveSpeed: 0, passives: {} });
  context.healPlayer = () => {};
  context.gainXp = () => {};
  context.rollFieldDrops = () => [];
  context.spawnFieldMonster = () => [];
  context.tickSkillCds = () => {};
  context.FIELD.quotaStage = context.G.stage.current;
  context.FIELD.stageQuota = 3;
  context.FIELD.stageKills = 0;

  const mob = () => ({ name: '甲', hp: 0, maxHp: 10, gold: 1, xp: 1, elite: false, cell: null });
  const startStage = context.G.stage.current;

  context.FIELD.monsters = [mob(), mob()];
  context.onFieldKill(context.FIELD.monsters[0]);
  context.onFieldKill(context.FIELD.monsters[1]);
  context.fieldTick(0.1);
  assert.equal(context.G.stage.current, startStage, '只殺 2/3 不得推進');

  const third = mob();
  context.FIELD.monsters = context.FIELD.monsters.concat([third]);
  context.onFieldKill(third);
  context.fieldTick(0.1);
  assert.equal(context.G.stage.current, startStage + 1, '殺滿 3/3 應推進一關');
  assert.equal(context.FIELD.stageKills, 0, '推進後配額計數要歸零');
});

test('全部地圖與1～9999關直接使用主參數間隔，修改主參數立即生效', () => {
  const context = loadCombatContext();
  for (const value of [2, 4.5, 0.01]) {
    context.FIELD_WAVE_SPAWN_INTERVAL = value;
    for (const zone of context.ZONE_LIST) for (const stage of [1, 49, 50, 9999]) {
      context.G.stage.zone = zone;
      context.G.stage.current = stage;
      assert.equal(context.fieldWaveIntervalFor(), Math.max(0.2, value));
    }
  }
});

test('出怪間隔分兩段：同關內用參數 a、切換關卡後用參數 b', () => {
  const context = loadCombatContext();
  /* 同一關內：一波出完，下一波直接使用參數 a。 */
  context.FIELD_WAVE_SPAWN_INTERVAL = 2.5;
  assert.equal(context.fieldWaveIntervalFor(), 2.5, '全部地圖直接使用參數表的 a');
  /* 切換關卡：改用參數 b，且不清場。 */
  context.holdFieldSpawn(context.FIELD_STAGE_SWITCH_DELAY);
  assert.equal(context.FIELD.spawnCd, context.FIELD_STAGE_SWITCH_DELAY);
  assert.notEqual(context.FIELD_STAGE_SWITCH_DELAY, context.FIELD_WAVE_SPAWN_INTERVAL,
    '兩段間隔是各自獨立的參數，預設值不該相同');
});

test('出怪間隔的 a 可以填一組候選值，每波等機率抽一個', () => {
  const context = loadCombatContext();
  context.FIELD_WAVE_SPAWN_INTERVAL = [1, 2, 3, 5, 7];

  /* 等機率＝把 [0,1) 均分成 N 段，第 k 段對到第 k 個值。
     用固定的 random 序列逐段驗，比統計分布穩定，也不會偶發性紅。 */
  const picks = [0.0, 0.19, 0.2, 0.39, 0.4, 0.59, 0.6, 0.79, 0.8, 0.999].map((r) => {
    context.Math.random = () => r;
    return context.fieldWaveIntervalFor(1, 'desert');
  });
  assert.deepEqual(picks, [1, 1, 2, 2, 3, 3, 5, 5, 7, 7]);

  /* 每一個值都抽得到，而且只會抽到表裡有的值。 */
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    context.Math.random = () => i / 400;
    seen.add(context.fieldWaveIntervalFor(1, 'desert'));
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 5, 7]);

  /* 重複候選值保留權重，不得去重。 */
  context.FIELD_WAVE_SPAWN_INTERVAL = [1, 2, 2, 5];
  const weighted = [0, 0.25, 0.5, 0.75].map((r) => {
    context.Math.random = () => r;
    return context.fieldWaveIntervalFor();
  });
  assert.deepEqual(weighted, [1, 2, 2, 5]);
});

test('候選值格式壞掉時退回安全值，不會變成每個 tick 出怪', () => {
  const context = loadCombatContext();
  [[], [0, -1], ['x'], null, 0, -1, NaN, Infinity].forEach((bad) => {
    context.FIELD_WAVE_SPAWN_INTERVAL = bad;
    const v = context.fieldWaveIntervalFor(1, 'desert');
    assert.ok(v >= 0.2, '壞值 ' + JSON.stringify(bad) + ' 應該退回安全值，實際 ' + v);
  });
});

test('出怪間隔不再受移動速度影響（純定值）', () => {
  /* 舊公式是「a 秒 × (1-移動速度%)」。移動速度多寡都不該改變出怪節奏。 */
  const context = loadCombatContext();
  assert.equal(typeof context.RESPAWN_DELAY, 'undefined', '舊的 RESPAWN_DELAY 已移除');
  const src = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '..', 'js', 'combat.js'), 'utf8');
  assert.equal(/moveSpeed/.test(src), false, 'combat.js 不該再有任何 moveSpeed 參與出怪計時');
});

test('刪除波次表後主參數仍涵蓋所有地圖，套用工具不再依賴該表', () => {
  const context = loadCombatContext();
  const root = path.resolve(__dirname, '..');
  for (const ext of ['xlsx', 'csv']) {
    const dir = ext === 'xlsx' ? 'Excel' : 'CSV';
    assert.equal(fs.existsSync(path.join(root, 'config', dir, 'Zone_Stage_Waves.' + ext)), false);
  }
  assert.equal(typeof context.ZONE_STAGE_WAVE_PROFILES, 'undefined');
  assert.equal(typeof context.fieldWaveProfileRow, 'undefined');
  assert.equal(typeof context.FIELD_MAX_LIVE_ENEMIES, 'undefined');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'tools/apply_params.cjs'), 'utf8'), /Zone_Stage_Waves|ZONE_STAGE_WAVE/);
  assert.ok(context.FIELD_WAVE_SPAWN_INTERVAL.every(v => v > 0));
  assert.equal(context.fieldMaxLiveEnemiesFor(), 100);
});
