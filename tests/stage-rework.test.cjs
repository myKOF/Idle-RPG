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
  const c = load(['js/util.js', 'js/data.js', 'js/formula.js']);
  assert.deepEqual(JSON.parse(JSON.stringify(c.ZONE_LIST)), [
    'plains', 'desert', 'swamp', 'undead_mountains',
    'god_battlefield', 'god_chaos', 'god_sanctuary'
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.ZONE_LIST.map((z) => c.ZONES[z].maxStage))), [200, 300, 400, 500, 600, 700, 800]);
  assert.equal(c.ZONES.undead_mountains.name, '亡靈山脈');
  assert.equal(c.ZONES.god_battlefield.reqReincarnation, 11);
});

test('地圖解鎖需要前圖通關，神界地圖另需 11 轉', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/formula.js']);
  c.G = {
    player: { reincarnations: 0 },
    stage: { zone: 'plains', best: 200 },
    zoneProgress: { plains: { best: 200 } }
  };
  assert.equal(c.isZoneUnlocked('desert'), true);
  assert.equal(c.isZoneUnlocked('swamp'), false);
  c.G.zoneProgress.desert = { best: 300 };
  assert.equal(c.isZoneUnlocked('swamp'), true);
  c.G.zoneProgress.swamp = { best: 400 };
  c.G.zoneProgress.undead_mountains = { best: 500 };
  assert.equal(c.isZoneUnlocked('god_battlefield'), false);
  c.G.player.reincarnations = 11;
  assert.equal(c.isZoneUnlocked('god_battlefield'), true);
});

test('NPC 配置表與地圖權重表可選出亡靈山脈指定 NPC', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js']);
  c.G = { player: { reincarnations: 0 }, stage: { current: 1, best: 1, zone: 'undead_mountains' }, tower: { active: false } };
  c.FIELD.player = { _lockTarget: null };
  c.Math.random = () => 0;
  c.spawnFieldMonster();
  assert.equal(c.FIELD.monsters[0].npcId, 'undead_skeleton');
  assert.equal(c.FIELD.monsters[0].appearance, 'skeleton');
  assert.equal(c.FIELD.monsters[0].attr, 'dark');
  assert.ok(c.NPC_CONFIG_TABLE.undead_dragon);
});

test('NPC CSV 集中所有地圖的基本資料，不重複存放公式倍率', () => {
  const lines = fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  assert.equal(lines.length, 81);
  assert.equal(lines[0], 'NPC識別碼,NPC名稱,所屬地圖識別碼,屬性,外觀,魔法型（1是／0否）,出現權重');
  assert.ok(lines.some((line) => line.startsWith('plains_1,史萊姆,plains,')));
  assert.ok(lines.some((line) => line.startsWith('god_sanctuary_12,永恒神王,god_sanctuary,')));
  assert.equal(Object.keys(load(['js/util.js', 'js/data.js']).NPC_CONFIG_TABLE).length, 80);
});

test('地圖表承接場景專屬倍率與所有地圖的分段掉落資料', () => {
  const zones = fs.readFileSync(path.join(root, 'config/CSV/Zones.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const drops = fs.readFileSync(path.join(root, 'config/CSV/Zone_Stage_Drops.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  assert.equal(zones[0], '順序,地圖識別碼,地圖名稱,位面,關卡上限,前置地圖識別碼,前置通關關卡,最低轉生次數,生命倍率,攻擊倍率,防禦倍率,攻速倍率,經驗金幣獎勵倍率');
  assert.match(zones.find((line) => line.includes(',undead_mountains,')), /,6\.5,3\.8,3\.2,1\.8,2\.25$/);
  // origin/develop 的 Zone_Stage_Drops.csv 現在包含 32 列資料，另加標題列。
  assert.equal(drops.length, 33);
  assert.ok(drops.some((line) => line.startsWith('god_sanctuary,601,800,')));
});

test('掉落配置依地圖與關卡區間查表，且支援材料欄位', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/formula.js']);
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
  const c = load(['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js']);
  c.G = {
    player: { reincarnations: 0 },
    stage: { current: 199, best: 199, kills: 0, autoAdvance: true, zone: 'plains' },
    zoneProgress: { plains: { current: 199, best: 199, cleared: 198 } },
    tower: { active: false }
  };
  c.FIELD.player = null;                 // 略過過關回血，本測試只看關卡紀錄
  const clearOneWave = () => { c.FIELD._waveClearPending = true; c.completeFieldWave({ hp: 100, moveSpeed: 0 }); };

  clearOneWave();                        // 打贏第 199 關
  assert.equal(c.G.stage.best, 200);
  assert.equal(c.G.stage.current, 200);
  assert.equal(c.zoneClearedStage('plains'), 199);

  // 關閉自動推進，讓本測試專注驗證最後一關的 best 夾限與 cleared 記錄；
  // 自動推進跨場景的行為由 multi-enemy.test.cjs 覆蓋。
  c.G.stage.autoAdvance = false;
  clearOneWave();                        // 打贏第 200 關（＝草原上限）
  assert.equal(c.G.stage.best, 200, 'best 被 maxStage 夾住，不會變成 201');
  assert.equal(c.zoneClearedStage('plains'), 200, 'cleared 記下真正打贏的最後一關');
});

test('切換場景會把 cleared 一起帶進 zoneProgress，不被整包覆寫清掉', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js']);
  c.G = {
    player: { reincarnations: 0 },
    stage: { current: 200, best: 200, kills: 0, autoAdvance: true, zone: 'plains' },
    zoneProgress: { plains: { current: 200, best: 200, cleared: 200 }, desert: { current: 1, best: 1, cleared: 0 } },
    tower: { active: false }
  };
  c.switchZone('desert');
  assert.equal(c.G.stage.zone, 'desert');
  assert.equal(c.G.zoneProgress.plains.cleared, 200);
  assert.equal(c.zoneClearedStage('plains'), 200);
});
