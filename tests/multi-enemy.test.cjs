const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js'].forEach((file) => {
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
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js'].forEach((file) => {
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
  // 未指定敵種時沿用小怪表（既有呼叫端不受影響）；菁英未指定地圖時走預設地圖那張
  assert.equal(context.fieldCountTableFor(), context.FIELD_ENEMY_COUNT_TABLE);
  assert.equal(context.fieldCountTableFor('elite'), context.FIELD_ELITE_COUNT_TABLE_BY_ZONE.desert);
  assert.equal(context.fieldCountTableFor('boss'), context.FIELD_BOSS_COUNT_TABLE);
});

/* 菁英數量逐張地圖分開（參數表「4-敵人數量」的菁英各列）。
   這裡只釘「哪一張地圖用哪一張表」的對應關係；數量期望值一律由表推導，
   權重被調整時不該誤報成測試失敗。 */
test('菁英數量表逐張地圖選用，未列出的地圖走 500 關之後那張', () => {
  const context = loadFormulaContext();
  const byZone = context.FIELD_ELITE_COUNT_TABLE_BY_ZONE;
  ['desert', 'Icefield', 'swamp', 'undead_mountains'].forEach((zone) => {
    assert.ok(byZone[zone], zone + ' 缺少菁英數量表');
    assert.equal(context.fieldCountTableFor('elite', 10, zone), byZone[zone], zone + ' 應用自己的菁英表');
  });
  ['god_battlefield', 'god_chaos', 'god_sanctuary'].forEach((zone) => {
    assert.equal(context.fieldCountTableFor('elite', 10, zone), context.FIELD_ELITE_COUNT_TABLE,
      zone + ' 未單獨列出，應走「500關之後」那張');
  });
  // 每張地圖的上限只增不減：越後面的地圖菁英同時湧上來的越多
  const maxes = ['desert', 'Icefield', 'swamp', 'undead_mountains'].map((z) => weightedRange(byZone[z]).max)
    .concat(weightedRange(context.FIELD_ELITE_COUNT_TABLE).max);
  for (let i = 1; i < maxes.length; i++) {
    assert.ok(maxes[i] >= maxes[i - 1], '菁英數量上限不應在後面的地圖變少：' + JSON.stringify(maxes));
  }
  // 菁英上限仍必須低於小怪，否則整波菁英根本打不動
  assert.ok(maxes[maxes.length - 1] < weightedRange(context.FIELD_ENEMY_COUNT_TABLE).max);
});

test('荒漠小怪分段表由列名帶區間，區間外恢復後備表', () => {
  /* 分段不再是「固定 20 關一段」：每一列自帶 [最低關卡, 最高關卡, 權重表]，
     所以 101~150 這種寬度不同的區間也表達得出來（見 data.js 該常數的說明）。 */
  const context = loadFormulaContext();
  const rows = context.FIELD_DESERT_EARLY_ENEMY_COUNT_TABLES;
  const tableOfStage = (stage) => {
    const row = rows.find((r) => stage >= r[0] && stage <= r[1]);
    return row ? row[2] : null;
  };
  /* 每一段的頭尾都要對到自己那張表 */
  rows.forEach((r) => {
    [r[0], r[1]].forEach((stage) => {
      assert.equal(context.fieldCountTableFor('normal', stage, 'desert'), r[2],
        '荒漠第 ' + stage + ' 關小怪分段');
      assert.equal(context.fieldCountTableFor('elite', stage, 'desert'),
        context.FIELD_ELITE_COUNT_TABLE_BY_ZONE.desert, '荒漠第 ' + stage + ' 關菁英應走荒漠菁英表');
    });
  });
  /* 區間必須連續、不重疊，否則中間那段會靜默掉到後備表 */
  rows.forEach((r, i) => {
    assert.ok(r[0] <= r[1], '區間反向：' + JSON.stringify(r.slice(0, 2)));
    if (i > 0) assert.equal(r[0], rows[i - 1][1] + 1, '分段必須連續：' + rows[i - 1][1] + ' → ' + r[0]);
  });
  const lastEnd = rows[rows.length - 1][1];
  assert.equal(context.fieldCountTableFor('normal', lastEnd + 1, 'desert'), context.FIELD_ENEMY_COUNT_TABLE);
  assert.equal(context.fieldCountTableFor('elite', lastEnd + 1, 'desert'), context.FIELD_ELITE_COUNT_TABLE_BY_ZONE.desert);
  assert.equal(context.fieldCountTableFor('normal', 1, 'Icefield'), context.FIELD_ENEMY_COUNT_TABLE);
  assert.equal(context.fieldCountTableFor('elite', 1, 'Icefield'), context.FIELD_ELITE_COUNT_TABLE_BY_ZONE.Icefield);

  const combat = loadCombatContext();
  rows.map((r) => r[0]).forEach((stage) => {
    combat.G.stage.current = stage;
    combat.G.stage.zone = 'desert';
    combat.spawnFieldMonster();
    const table = tableOfStage(stage);
    const range = weightedRange(table);
    assert.ok(combat.FIELD.monsters.length >= range.min && combat.FIELD.monsters.length <= range.max,
      '實際出怪未套用荒漠第 ' + stage + ' 關分段表');
  });
  combat.G.stage.current = 10;
  combat.spawnFieldMonster();
  const desertEliteRange = weightedRange(combat.FIELD_ELITE_COUNT_TABLE_BY_ZONE.desert);
  assert.ok(combat.FIELD.monsters.length >= desertEliteRange.min && combat.FIELD.monsters.length <= desertEliteRange.max,
    '實際出怪的荒漠菁英應落在荒漠菁英表的範圍內');
  combat.G.stage.current = 101;
  combat.spawnFieldMonster();
  const normalRange = weightedRange(combat.FIELD_ENEMY_COUNT_TABLE);
  assert.ok(combat.FIELD.monsters.length >= normalRange.min && combat.FIELD.monsters.length <= normalRange.max,
    '荒漠第 101 關應恢復一般小怪表');
});

test('出怪依階段敵種選用對應的數量表', () => {
  const context = loadCombatContext();
  // 這個 context 沒指定地圖＝預設地圖，菁英數量看的是該地圖那張表
  const eliteMax = weightedRange(context.FIELD_ELITE_COUNT_TABLE_BY_ZONE.desert).max;

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

/* 2026-08 進場判定：新怪要先走進畫面（_enterCd）才能攻擊或被攻擊，
   所以「至少完成一次攻擊」的保證從「生成當輪」移到「抵達當輪」——
   進場期間打不到牠，牠一定活得到抵達那一刻。 */
test('敵人走進畫面前不參戰，抵達當輪立即出手，即使被玩家秒殺也至少完成一次攻擊', () => {
  const context = loadCombatContext();
  const events = [];
  context.G = {
    player: { gold: 0 },
    stage: { current: 1, best: 1, kills: 0, autoAdvance: true, zone: 'desert' },
    tower: { active: false }
  };
  context.FIELD = {
    player: context.newPlayerEntity({ hp: 100, mp: 0, aspd: 1 }),
    monster: null,
    monsters: [],
    spawnCd: 0,
    reviveCd: 0,
    dpsWindow: [],
    _waveClearPending: false,
    mapComplete: false
  };
  context.FIELD.player.atkCd = 0;
  context.getStats = () => ({
    hp: 100, mp: 0, aspd: 1, moveSpeed: 0,
    passives: {}, skillTriggers: {}
  });
  context.playerHpRegenPerSec = () => 0;
  context.playerMpRegenPerSec = () => 0;
  context.tickSkillCds = () => {};
  context.pickAndCastSkill = () => null;
  context.rollFieldEnemyCount = () => 1;
  context.isFieldBossStage = () => false;
  context.isFieldBossDefeated = () => false;
  context.isEliteStage = () => false;
  context.monsterStatsFor = () => ({
    level: 1, hp: 10, atk: 10, def: 0, mdef: 0, aspd: 100, dodge: 0, hit: 100, gold: 0, xp: 0
  });
  context.currentZoneDef = () => ({
    pool: [{ name: '測試怪', emoji: '👾', id: 'test', magic: false, aspdMult: 1 }],
    enemyTable: [], hpMult: 1, atkMult: 1, defMult: 1, aspdMult: 1, rewardMult: 1
  });
  context.doMonsterAttack = (enemy, player) => {
    events.push('enemy');
    player.hp -= 1;
    return { dmg: 1 };
  };
  context.doPlayerAttack = (player, enemy) => {
    events.push('player');
    enemy.hp = 0;
    return { killed: true };
  };
  // 避免本測試進入完整掉落結算；只保留「玩家已在同一輪擊殺敵人」的狀態。
  context.onFieldDeaths = () => {
    context.FIELD.monsters.forEach((enemy) => { if (enemy.hp <= 0) enemy._rewarded = true; });
  };

  // 生成當輪：敵人在生成圓上，離我方還很遠，雙方都打不到對方
  context.fieldTick(0.1);
  assert.deepEqual(events, [], '還沒走近的敵人不得攻擊，也不得被攻擊');
  assert.equal(context.FIELD.player.hp, 100, '遠處的敵人不該打到玩家');
  assert.equal(context.FIELD.monsters.length, 1);
  const mob = context.FIELD.monsters[0];
  assert.ok(Math.sqrt(mob.pos.x * mob.pos.x + mob.pos.y * mob.pos.y) > context.BF_MELEE_RANGE,
    '生成時應該在攻擊距離之外');
  assert.equal(mob.hp, 10, '走不到面前的敵人不該被玩家打到');

  /* 讓牠一路走進來。踏進攻擊距離的那一輪：敵人先出手，再被玩家擊殺。
     這條保證要綁在「剛進入射程」，因為雙方射程相同而玩家的回合在前——
     不特別處理的話高 DPS 玩家永遠不會吃到傷害。 */
  for (let i = 0; i < 200 && !events.length; i++) context.fieldTick(0.1);
  assert.deepEqual(events, ['enemy', 'player'], '進入射程的那一輪應先攻擊，再被玩家擊殺');
  assert.equal(context.FIELD.player.hp, 99, '即使敵人被秒殺，玩家仍應承受首擊');
});

/* 2026-08 波次串流改版：敵人改成每隔幾秒補一波、不等場上清空，
   推進判定因此從「整波清空」改為「殺滿本關配額」（fieldStageQuota）。
   本測試改測新語意：逐一擊殺各自結算，殺滿配額後的下一個 tick 推進。 */
test('多敵人逐一擊殺時各自結算經驗與掉落，殺滿本關配額才推進', () => {
  const context = loadCombatContext();
  const xp = [];
  context.G = {
    player: { gold: 0 },
    stage: { current: 1, best: 1, kills: 0, autoAdvance: true },
    tower: { active: false }
  };
  // 配額寫死成 2，才不會因為參數表調整權重就誤報失敗
  context.FIELD.quotaStage = 1;
  context.FIELD.stageQuota = 2;
  context.FIELD.stageKills = 0;
  // 這裡要測的是擊殺結算與推進，不是補怪；補怪另有 wave-streaming.test.cjs
  context.spawnFieldMonster = () => [];
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

  // 殺滿配額（2 隻）→ 下一個 tick 就推進，不必等屍體淡出
  context.fieldTick(context.FIELD_ENEMY_DEATH_CLEAR_DELAY - 0.01);
  assert.equal(context.G.stage.current, 2);
  assert.equal(context.G.stage.best, 2);
  assert.equal(context.G.stage.kills, 1);
  assert.equal(context.FIELD.monsters.length, 1); // 屍體仍在淡出
  context.fieldTick(0.02);
  assert.equal(context.FIELD.monsters.length, 0); // 屍體清除
});

test('關閉自動推進時完成關卡仍解鎖下一關，但留在目前關卡', () => {
  const context = loadCombatContext();
  context.G = {
    player: { gold: 0 },
    stage: { current: 40, best: 40, kills: 0, autoAdvance: false, zone: 'desert' },
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
    stage: { current: 200, best: 200, kills: 0, autoAdvance: true, zone: 'desert' },
    zoneProgress: { desert: { current: 200, best: 200, cleared: 199 } },
    tower: { active: false }
  };
  context.FIELD.player = context.newPlayerEntity({ hp: 100, mp: 0, aspd: 1 });
  context.getStats = () => ({ hp: 100, moveSpeed: 0, passives: {} });
  context.healPlayer = () => {};
  context.FIELD._waveClearPending = true;

  assert.equal(context.isZoneUnlocked('Icefield'), false);
  assert.equal(context.nextAutoAdvanceZone('desert'), null);
  context.completeFieldWave(context.getStats());

  assert.equal(context.G.stage.zone, 'Icefield');
  assert.equal(context.G.stage.current, 1);
  assert.equal(context.G.stage.best, 1);
  assert.equal(context.G.zoneProgress.desert.cleared, 200);
  assert.equal(context.FIELD.mapComplete, false);
  assert.equal(context.FIELD.monsters.length, 0);
});

test('後續地圖尚未解鎖時，亡靈山脈 500 關通關後留在 500 關重複挑戰', () => {
  const context = loadCombatContext();
  context.G = {
    player: { gold: 0, reincarnations: 10 },
    stage: { current: 500, best: 500, kills: 0, autoAdvance: true, zone: 'undead_mountains' },
    zoneProgress: { undead_mountains: { current: 500, best: 500, cleared: 499 } },
    tower: { active: false }
  };
  context.FIELD.player = context.newPlayerEntity({ hp: 100, mp: 0, aspd: 1 });
  context.getStats = () => ({ hp: 100, moveSpeed: 0, passives: {} });
  context.healPlayer = () => {};
  context.FIELD._waveClearPending = true;

  assert.equal(context.isZoneUnlocked('god_battlefield'), false);
  assert.equal(context.nextAutoAdvanceZone('undead_mountains'), null);
  assert.equal(context.hasConfiguredHigherZone('undead_mountains'), true);
  context.completeFieldWave(context.getStats());

  assert.equal(context.G.stage.zone, 'undead_mountains');
  assert.equal(context.G.stage.current, 500);
  assert.equal(context.G.stage.best, 500);
  assert.equal(context.G.zoneProgress.undead_mountains.cleared, 500);
  assert.equal(context.FIELD.mapComplete, false);
  /* 過關之後下一波要隔 FIELD_STAGE_SWITCH_DELAY（參數表「出怪間隔」的 b）才出現，
     場上既有的敵人照樣留著。出怪只看 spawnCd 一個計時器。 */
  assert.equal(context.FIELD.spawnCd, context.FIELD_STAGE_SWITCH_DELAY);
});

test('真正最後一張地圖通關後仍標記完成並停止出怪', () => {
  const context = loadCombatContext();
  context.G = {
    player: { gold: 0, reincarnations: 11 },
    stage: { current: 800, best: 800, kills: 0, autoAdvance: true, zone: 'god_sanctuary' },
    zoneProgress: { god_sanctuary: { current: 800, best: 800, cleared: 799 } },
    tower: { active: false }
  };
  context.FIELD.player = context.newPlayerEntity({ hp: 100, mp: 0, aspd: 1 });
  context.getStats = () => ({ hp: 100, moveSpeed: 0, passives: {} });
  context.healPlayer = () => {};
  context.FIELD._waveClearPending = true;

  assert.equal(context.hasConfiguredHigherZone('god_sanctuary'), false);
  context.completeFieldWave(context.getStats());

  assert.equal(context.G.stage.current, 800);
  assert.equal(context.G.zoneProgress.god_sanctuary.cleared, 800);
  assert.equal(context.FIELD.mapComplete, true);
  assert.equal(context.FIELD.spawnCd, Infinity, '整張地圖打完就停止出怪');
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
