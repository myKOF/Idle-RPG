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

test('十張地圖依圖片順序與100～600有限上限', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js']);
  assert.deepEqual(JSON.parse(JSON.stringify(c.ZONE_LIST)), [
    'desert', 'Icefield', 'mist_forest', 'lava_mountain', 'swamp', 'thunder_peak', 'undead_mountains',
    'god_battlefield', 'god_chaos', 'god_sanctuary'
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.ZONE_LIST.map((z) => c.ZONES[z].maxStage))), [100, 150, 200, 250, 300, 350, 400, 450, 500, 600]);
  assert.equal(c.ZONES.undead_mountains.name, '亡靈山脈');
  assert.equal(c.ZONES.god_battlefield.reqReincarnation, 11);
});

test('地圖解鎖需要前圖最後一關真正通關，神界另需11轉', () => {
  const c=load(['js/util.js','js/data.js','js/status.js','js/formula.js']);
  c.G={player:{reincarnations:0},stage:{zone:'desert',best:1},zoneProgress:{}};
  for(let i=1;i<c.ZONE_LIST.length;i++){
    const prev=c.ZONE_LIST[i-1],next=c.ZONE_LIST[i],cap=c.ZONES[prev].maxStage;
    c.G.zoneProgress[prev]={best:cap,cleared:cap-1};assert.equal(c.isZoneUnlocked(next),false);
    c.G.zoneProgress[prev].cleared=cap;
    if(c.ZONES[next].realm==='god'){c.G.player.reincarnations=0;assert.equal(c.isZoneUnlocked(next),false);c.G.player.reincarnations=11;}
    assert.equal(c.isZoneUnlocked(next),true);
  }
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
  // 10 張圖 × 12 隻 × 4 種類型（normal／elite／elite_adv／boss，2026-10-13 起）＋封魔塔 BOSS 10 列＋標題列。
  assert.equal(lines.length, 491);
  assert.equal(lines[0].split(',').slice(0, 5).join(','), 'NPC識別碼,NPC名稱,所屬地圖識別碼,類型,屬性');
  assert.ok(lines.some((line) => line.startsWith('desert_1,史萊姆,desert,normal,')));
  assert.ok(lines.some((line) => line.startsWith('god_sanctuary_12,神聖執法官,god_sanctuary,boss,')));
  assert.ok(lines.some((line) => line.startsWith('tower_boss_1,烈焰魔君,tower,tower_boss,')));
  assert.equal(Object.keys(load(['js/util.js', 'js/data.js']).NPC_CONFIG_TABLE).length, 120);
});

test('地圖表承接場景專屬倍率與所有地圖的分段掉落資料', () => {
  const zones = fs.readFileSync(path.join(root, 'config/CSV/Zones.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const drops = fs.readFileSync(path.join(root, 'config/CSV/Zone_Stage_Drops.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  assert.equal(zones[0], '順序,地圖識別碼,地圖名稱,位面,關卡上限,前置地圖識別碼,前置通關關卡,最低轉生次數,生命倍率,攻擊倍率,防禦倍率,攻速倍率,經驗金幣獎勵倍率');
  /* 期望值＝Zones.csv 目前的設定。場景倍率 2026-08-10 從主參數表撥離到這張表之後，
     這裡是唯一來源；js/data.js 的 ZONES 由 apply_params 依此表回寫。
     測試釘住數值是刻意的（AI_RULES.md 9.1 的例外）：倍率被調整時這條會紅，
     讓「數值改了」變成一個需要有人明確同意的動作。
     2026-08-11（使用者確認）：荒漠不再是全 1 的基準圖，前兩個倍率調成 0.8。 */
  assert.match(zones.find((line) => line.includes(',desert,')), /,0\.8,0\.8,1,1,1$/);
  assert.match(zones.find((line) => line.includes(',undead_mountains,')), /,20,50,10,1\.8,2\.25$/);
  assert.match(zones.find((line) => line.includes(',god_sanctuary,')), /,500,8000,100,2\.5,24$/);
  // 十圖版 Zone_Stage_Drops.csv 包含 44 列資料，另加標題列。
  assert.equal(drops.length, 45);
  assert.ok(drops.some((line) => line.startsWith('god_sanctuary,451,600,')));
});

test('掉落配置依地圖與關卡區間查表，且支援材料欄位', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js']);
  const early = c.zoneStageDropConfigFor('undead_mountains', 100);
  const late = c.zoneStageDropConfigFor('undead_mountains', 330);
  // 亡靈山脈的新版分段為 1~159 與 320~359；數值由集中掉落表決定。
  assert.equal(early.max, 159);
  assert.equal(late.min, 320);
  assert.equal(late.materials.bookRate, 4);
  /* 2026-08-11（使用者確認）：神話（R6）掉落率 0.3 → 0.25。 */
  assert.equal(c.fieldDropRatesFor(330, 330, 'undead_mountains')[6], 0.25);
});

/* 打贏地圖最後一關時 best 會被 maxStage 夾住，光看 best 分不出「打贏最後一關」與
   「只打到倒數第二關」。zoneProgress[zone].cleared 專門補這一段，主線任務的
   stageClear 讀它（js/tasks.js）。 */
test('通關關卡另記 cleared：最後一關打贏後 best 卡在上限，cleared 才前進', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js']);
  c.G = {
    player: { reincarnations: 0 },
    stage: { current: 99, best: 99, kills: 0, autoAdvance: true, zone: 'desert' },
    zoneProgress: { desert: { current: 99, best: 99, cleared: 98 } },
    tower: { active: false }
  };
  c.FIELD.player = null;                 // 略過過關回血，本測試只看關卡紀錄
  const clearOneWave = () => { c.FIELD._waveClearPending = true; c.completeFieldWave({ hp: 100, moveSpeed: 0 }); };

  clearOneWave();                        // 打贏第 99 關
  assert.equal(c.G.stage.best, 100);
  assert.equal(c.G.stage.current, 100);
  assert.equal(c.zoneClearedStage('desert'), 99);

  // 關閉自動推進，讓本測試專注驗證最後一關的 best 夾限與 cleared 記錄；
  // 自動推進達上限不跨場景的行為由 multi-enemy.test.cjs 覆蓋。
  c.G.stage.autoAdvance = false;
  clearOneWave();                        // 打贏第 100 關（＝荒漠上限）
  assert.equal(c.G.stage.best, 100, 'best 被 maxStage 夾住，不會變成 101');
  assert.equal(c.zoneClearedStage('desert'), 100, 'cleared 記下真正打贏的最後一關');
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
