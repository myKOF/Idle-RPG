const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function load(files) {
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {} },
    blog() {},
    document: { getElementById() { return null; } }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  return context;
}

test('七張地圖依序排列並使用 200 起跳、每張增加 100 的有限上限', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js']);
  assert.deepEqual(JSON.parse(JSON.stringify(c.ZONE_LIST)), [
    'desert', 'Icefield', 'swamp', 'undead_mountains',
    'god_battlefield', 'god_chaos', 'god_sanctuary'
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.ZONE_LIST.map((z) => c.ZONES[z].maxStage))), [200, 300, 400, 500, 600, 700, 800]);
  assert.equal(c.ZONES.undead_mountains.name, '亡靈山脈');
  assert.equal(c.ZONES.god_battlefield.reqReincarnation, 11);
});

test('地圖解鎖需要前圖通關，神界地圖另需 11 轉', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js']);
  c.G = {
    player: { reincarnations: 0 },
    stage: { zone: 'desert', best: 200 },
    zoneProgress: { desert: { best: 200, cleared: 199 } }
  };
  assert.equal(c.isZoneUnlocked('Icefield'), false);
  c.G.zoneProgress.desert.cleared = 200;
  assert.equal(c.isZoneUnlocked('Icefield'), true);
  assert.equal(c.isZoneUnlocked('swamp'), false);
  c.G.zoneProgress.Icefield = { best: 300, cleared: 299 };
  assert.equal(c.isZoneUnlocked('swamp'), false);
  c.G.zoneProgress.Icefield.cleared = 300;
  assert.equal(c.isZoneUnlocked('swamp'), true);
  c.G.zoneProgress.swamp = { best: 400, cleared: 400 };
  c.G.zoneProgress.undead_mountains = { best: 500, cleared: 499 };
  assert.equal(c.isZoneUnlocked('god_battlefield'), false);
  c.G.zoneProgress.undead_mountains.cleared = 500;
  c.G.player.reincarnations = 11;
  assert.equal(c.isZoneUnlocked('god_battlefield'), true);
});

test('NPC 配置表與地圖權重表可選出亡靈山脈指定 NPC', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js']);
  c.G = { player: { reincarnations: 0 }, stage: { current: 1, best: 1, zone: 'undead_mountains' }, tower: { active: false } };
  c.FIELD.player = { _lockTarget: null };
  c.Math.random = () => 0;
  c.spawnFieldMonster();
  assert.equal(c.FIELD.monsters[0].npcId, 'undead_1');
  assert.equal(c.FIELD.monsters[0].appearance, 'skeleton');
  assert.equal(c.FIELD.monsters[0].attr, 'dark');
  assert.ok(c.NPC_CONFIG_TABLE.undead_12);
});

test('NPC CSV 集中所有地圖的基本資料，不重複存放公式倍率', () => {
  const lines = fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  // 亡靈山脈 2026-08-07 從 8 隻補齊為 12 隻，與其他地圖一致：7 張圖 × 12 隻＋標題列。
  assert.equal(lines.length, 85);
  assert.equal(lines[0], 'NPC識別碼,NPC名稱,所屬地圖識別碼,屬性,外觀,魔法型（1是／0否）,出現權重');
  assert.ok(lines.some((line) => line.startsWith('desert_1,史萊姆,desert,')));
  assert.ok(lines.some((line) => line.startsWith('god_sanctuary_12,神聖執法官,god_sanctuary,')));
  assert.equal(Object.keys(load(['js/util.js', 'js/data.js']).NPC_CONFIG_TABLE).length, 84);
});

test('地圖表承接場景專屬倍率與所有地圖的分段掉落資料', () => {
  const zones = fs.readFileSync(path.join(root, 'config/CSV/Zones.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const drops = fs.readFileSync(path.join(root, 'config/CSV/Zone_Stage_Drops.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  assert.equal(zones[0], '順序,地圖識別碼,地圖名稱,位面,關卡上限,前置地圖識別碼,前置通關關卡,最低轉生次數,生命倍率,攻擊倍率,防禦倍率,攻速倍率,經驗金幣獎勵倍率');
  /* 期望值＝Zones.csv 目前的設定。場景倍率 2026-08-10 從主參數表撥離到這張表之後，
     這裡是唯一來源；js/data.js 的 ZONES 由 apply_params 依此表回寫。
     測試釘住數值是刻意的（AI_RULES.md 9.1 的例外）：倍率被調整時這條會紅，
     讓「數值改了」變成一個需要有人明確同意的動作。
     荒漠是基準圖，五個倍率恆為 1，一併盯著——它若被改動代表整張表對錯了欄。 */
  assert.match(zones.find((line) => line.includes(',desert,')), /,1,1,1,1,1$/);
  assert.match(zones.find((line) => line.includes(',undead_mountains,')), /,10,5\.5,3\.2,1\.8,2\.25$/);
  assert.match(zones.find((line) => line.includes(',god_sanctuary,')), /,150,40,20,2\.5,24$/);
  // origin/develop 的 Zone_Stage_Drops.csv 現在包含 32 列資料，另加標題列。
  assert.equal(drops.length, 33);
  assert.ok(drops.some((line) => line.startsWith('god_sanctuary,601,800,')));
});

test('掉落配置依地圖與關卡區間查表，且支援材料欄位', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js']);
  const early = c.zoneStageDropConfigFor('undead_mountains', 100);
  const late = c.zoneStageDropConfigFor('undead_mountains', 400);
  // 亡靈山脈的新版分段為 1~199 與 400~449；數值由集中掉落表決定。
  assert.equal(early.max, 199);
  assert.equal(late.min, 400);
  assert.equal(late.materials.bookRate, 4);
  assert.equal(c.fieldDropRatesFor(400, 400, 'undead_mountains')[6], 0.3);
});

/* 打贏地圖最後一關時 best 會被 maxStage 夾住，光看 best 分不出「打贏最後一關」與
   「只打到倒數第二關」。zoneProgress[zone].cleared 專門補這一段，主線任務的
   stageClear 讀它（js/tasks.js）。 */
test('通關關卡另記 cleared：最後一關打贏後 best 卡在上限，cleared 才前進', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js']);
  c.G = {
    player: { reincarnations: 0 },
    stage: { current: 199, best: 199, kills: 0, autoAdvance: true, zone: 'desert' },
    zoneProgress: { desert: { current: 199, best: 199, cleared: 198 } },
    tower: { active: false }
  };
  c.FIELD.player = null;                 // 略過過關回血，本測試只看關卡紀錄
  const clearOneWave = () => { c.FIELD._waveClearPending = true; c.completeFieldWave({ hp: 100, moveSpeed: 0 }); };

  clearOneWave();                        // 打贏第 199 關
  assert.equal(c.G.stage.best, 200);
  assert.equal(c.G.stage.current, 200);
  assert.equal(c.zoneClearedStage('desert'), 199);

  // 關閉自動推進，讓本測試專注驗證最後一關的 best 夾限與 cleared 記錄；
  // 自動推進跨場景的行為由 multi-enemy.test.cjs 覆蓋。
  c.G.stage.autoAdvance = false;
  clearOneWave();                        // 打贏第 200 關（＝荒漠上限）
  assert.equal(c.G.stage.best, 200, 'best 被 maxStage 夾住，不會變成 201');
  assert.equal(c.zoneClearedStage('desert'), 200, 'cleared 記下真正打贏的最後一關');
});

/* 野外 BOSS 每張地圖只能打一次：BOSS 階通關後不再出 BOSS，退回既有菁英規則。
   「打過了沒」直接讀 zoneProgress[zone].cleared，不另存 BOSS 擊殺記錄（data.js
   isFieldBossDefeated）。 */
function bossRuleContext(zoneProgress) {
  const c = load(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js']);
  c.G = {
    player: { reincarnations: 0 },
    stage: { current: 1, best: 1, kills: 0, autoAdvance: false, zone: 'desert' },
    zoneProgress: zoneProgress,
    tower: { active: false }
  };
  c.FIELD.player = { _lockTarget: null };
  c.Math.random = () => 0;
  return c;
}
function spawnAt(c, zone, stage) {
  c.G.stage.zone = zone;
  c.G.stage.current = stage;
  c.spawnFieldMonster();
  return c.FIELD.monsters[0];
}

test('野外 BOSS 只能打一次：該關通關後同一階退回菁英', () => {
  const bossStage = 50;
  assert.equal(bossRuleContext({}).isFieldBossStage(bossStage), true, '前提：測試用的關卡是 BOSS 階');

  const pending = bossRuleContext({ desert: { current: bossStage, best: bossStage, cleared: bossStage - 1 } });
  const boss = spawnAt(pending, 'desert', bossStage);
  assert.equal(boss.isBoss, true, '沒打過就照常出 BOSS');
  assert.equal(boss.elite, false);

  const defeated = bossRuleContext({ desert: { current: bossStage, best: bossStage + 1, cleared: bossStage } });
  const after = spawnAt(defeated, 'desert', bossStage);
  assert.equal(after.isBoss, false, '打過的 BOSS 不再出現');
  assert.equal(after.elite, true, 'BOSS 消失後由菁英規則接手（BOSS 階必同時是菁英階）');
});

test('野外 BOSS 一次性判定逐張地圖獨立，且不影響菁英階', () => {
  const bossStage = 50;
  const c = bossRuleContext({
    desert: { current: bossStage, best: bossStage + 1, cleared: bossStage },
    Icefield: { current: bossStage, best: bossStage, cleared: bossStage - 1 }
  });
  assert.equal(c.isFieldBossDefeated('desert', bossStage), true);
  assert.equal(c.isFieldBossDefeated('Icefield', bossStage), false);
  assert.equal(spawnAt(c, 'Icefield', bossStage).isBoss, true, '別張地圖的同一階仍要出 BOSS');

  // 菁英規則不受本次改動影響：非 BOSS 階的菁英關，通關後照樣出菁英
  const eliteStage = 10;
  assert.equal(c.isEliteStage(eliteStage), true);
  assert.equal(spawnAt(c, 'desert', eliteStage).elite, true, '打過的菁英關仍是菁英');
});

test('切換場景會把 cleared 一起帶進 zoneProgress，不被整包覆寫清掉', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js']);
  c.G = {
    player: { reincarnations: 0 },
    stage: { current: 200, best: 200, kills: 0, autoAdvance: true, zone: 'desert' },
    zoneProgress: { desert: { current: 200, best: 200, cleared: 200 }, Icefield: { current: 1, best: 1, cleared: 0 } },
    tower: { active: false }
  };
  c.switchZone('Icefield');
  assert.equal(c.G.stage.zone, 'Icefield');
  assert.equal(c.G.zoneProgress.desert.cleared, 200);
  assert.equal(c.zoneClearedStage('desert'), 200);
});
