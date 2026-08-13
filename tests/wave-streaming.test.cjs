/* 波次串流（2026-08 戰鬥改造）
   敵人改成「每隔幾秒補一波，不等場上清空」，清不完就會愈積愈多，撐不住被打死退關。
   連帶改變的是推進判定：從「整波清空」改為「殺滿本關配額」。
   本檔鎖住這四件事：串流補波、棋盤上限、BOSS 關不串流、間隔可由參數表依地圖／關卡調整。 */
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

/* 同時上限是難度的煞車：沒有它，清不完的怪會一路堆到棋盤滿格，
   新角色在前幾關就會被打死到完全推不動（headless 模擬實測全程卡在復活倒數）。 */
test('同時上限可依地圖與關卡區分，且不會超過棋盤格數', () => {
  const context = loadCombatContext();
  context.ZONE_STAGE_WAVE_PROFILES = {
    desert: [[1, 49, 2, 4], [50, 9999, 2, 12]],
    swamp: [[1, 9999, 2, 999]]
  };
  assert.equal(context.fieldMaxLiveEnemiesFor(10, 'desert'), 4);
  assert.equal(context.fieldMaxLiveEnemiesFor(50, 'desert'), 12);
  // 填超過棋盤格數也不會真的生出那麼多——放不下的本來就會被丟掉
  assert.equal(context.fieldMaxLiveEnemiesFor(1, 'swamp'), context.bfCellCount());
  // 沒列到的地圖 → 預設常數
  assert.equal(context.fieldMaxLiveEnemiesFor(1, 'Icefield'),
    Math.min(context.FIELD_MAX_LIVE_ENEMIES, context.bfCellCount()));
  /* 填 0 或缺欄位＝不額外限制（＝棋盤格數）。這條很重要：把棋盤放大之後，
     這一欄若還留著改版前的舊數字，敵人會卡在那個數字上不再增加。 */
  context.ZONE_STAGE_WAVE_PROFILES = { desert: [[1, 9999, 2, 0]] };
  assert.equal(context.fieldMaxLiveEnemiesFor(1, 'desert'), context.bfCellCount());
  context.ZONE_STAGE_WAVE_PROFILES = { desert: [[1, 9999, 2]] };
  assert.equal(context.fieldMaxLiveEnemiesFor(1, 'desert'),
    Math.min(context.FIELD_MAX_LIVE_ENEMIES, context.bfCellCount()));
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

test('波次間隔可依地圖與關卡區分，且表壞掉時退回預設值', () => {
  const context = loadCombatContext();
  // 表本體由 config/Excel/Zone_Stage_Waves.xlsx 管理，這裡只驗查表行為
  context.ZONE_STAGE_WAVE_PROFILES = {
    desert: [[1, 49, 3, 8], [50, 9999, 1.5, 8]],
    swamp: [[1, 9999, 0.8, 8]]
  };
  assert.equal(context.fieldWaveIntervalFor(10, 'desert'), 3);
  assert.equal(context.fieldWaveIntervalFor(50, 'desert'), 1.5);
  assert.equal(context.fieldWaveIntervalFor(1, 'swamp'), 0.8);
  // 沒有列到的地圖 → 預設值
  assert.equal(context.fieldWaveIntervalFor(1, 'Icefield'), context.FIELD_WAVE_SPAWN_INTERVAL);
  // 關卡落在區間外 → 預設值
  context.ZONE_STAGE_WAVE_PROFILES = { desert: [[1, 10, 3]] };
  assert.equal(context.fieldWaveIntervalFor(99, 'desert'), context.FIELD_WAVE_SPAWN_INTERVAL);
  // 表填 0 或負數 → 夾住，不得變成每個 tick 都出怪
  context.ZONE_STAGE_WAVE_PROFILES = { desert: [[1, 9999, 0]] };
  assert.ok(context.fieldWaveIntervalFor(1, 'desert') >= 0.2);
});

test('出怪間隔分兩段：同關內用參數 a、切換關卡後用參數 b', () => {
  const context = loadCombatContext();
  /* 同一關內：一波出完，下一波隔 fieldWaveIntervalFor（表填 0 就退回參數 a）。 */
  context.ZONE_STAGE_WAVE_PROFILES = { desert: [[1, 9999, 0, 0]] };
  assert.equal(context.fieldWaveIntervalFor(1, 'desert'), context.FIELD_WAVE_SPAWN_INTERVAL,
    '地圖表填 0＝沿用參數表的 a');
  /* 切換關卡：改用參數 b，且不清場。 */
  context.holdFieldSpawn(context.FIELD_STAGE_SWITCH_DELAY);
  assert.equal(context.FIELD.spawnCd, context.FIELD_STAGE_SWITCH_DELAY);
  assert.notEqual(context.FIELD_STAGE_SWITCH_DELAY, context.FIELD_WAVE_SPAWN_INTERVAL,
    '兩段間隔是各自獨立的參數，預設值不該相同');
});

test('出怪間隔不再受移動速度影響（純定值）', () => {
  /* 舊公式是「a 秒 × (1-移動速度%)」。移動速度多寡都不該改變出怪節奏。 */
  const context = loadCombatContext();
  assert.equal(typeof context.RESPAWN_DELAY, 'undefined', '舊的 RESPAWN_DELAY 已移除');
  const src = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '..', 'js', 'combat.js'), 'utf8');
  assert.equal(/moveSpeed/.test(src), false, 'combat.js 不該再有任何 moveSpeed 參與出怪計時');
});

test('參數表預設值涵蓋所有地圖，數值合理', () => {
  const context = loadCombatContext();
  const zones = ['desert', 'Icefield', 'swamp', 'undead_mountains',
    'god_battlefield', 'god_chaos', 'god_sanctuary'];
  zones.forEach((zone) => {
    const rows = context.ZONE_STAGE_WAVE_PROFILES[zone];
    assert.ok(Array.isArray(rows) && rows.length, '缺少地圖：' + zone);
    rows.forEach((row) => {
      assert.equal(row.length, 4, zone + ' 每列必須是 [最低關卡, 最高關卡, 間隔秒數, 同時上限隻數]');
      assert.ok(row[0] >= 1 && row[1] >= row[0], zone + ' 關卡區間不合法');
      /* 0＝沿用參數表「出怪間隔」的 a（與同時上限隻數的 0＝不額外限制同一慣例）。 */
      assert.ok(row[2] >= 0 && row[2] <= 60, zone + ' 間隔秒數超出合理範圍（0＝沿用參數表預設值）');
      assert.ok(row[3] >= 0 && row[3] <= 999, zone + ' 同時上限隻數超出合理範圍（0＝不額外限制）');
    });
  });
});
