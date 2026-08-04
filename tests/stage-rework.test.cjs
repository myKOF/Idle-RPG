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

test('掉落配置依地圖與關卡區間查表，且支援材料欄位', () => {
  const c = load(['js/util.js', 'js/data.js', 'js/formula.js']);
  const early = c.zoneStageDropConfigFor('undead_mountains', 100);
  const late = c.zoneStageDropConfigFor('undead_mountains', 400);
  assert.equal(early.max, 125);
  assert.equal(late.min, 376);
  assert.equal(late.materials.bookRate, 10);
  assert.equal(c.fieldDropRatesFor(400, 400, 'undead_mountains')[6], 0.25);
});
