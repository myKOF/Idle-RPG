/* ONE-TIME MIGRATION: legacySkillRemovalV1（2026-09-29）
   舊版技能系統（SKILLS 表、融合技、魔法卷軸、舊傳奇特效）整批移除後，舊存檔讀入時：
   清掉已學等級／解鎖紀錄／融合技、卸下裝載欄裡的舊技能、移除魔法卷軸、
   任務進度索引平移、已下架的傳奇特效自裝備剝除。登錄見 ONE_TIME_MIGRATIONS.md。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMigrationContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    localStorage: {
      getItem() { return null; }, setItem() {}, removeItem() {}, key() { return null; }, length: 0
    },
    location: { reload() {} },
    window: {},
    document: { addEventListener() {} },
    UI: { dirty: {} }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js',
    'js/skills.js', 'js/talents.js', 'js/player.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

/* 遷移前的存檔＝沒有完成旗標，並帶著舊版技能欄位。 */
function legacySave(context, mutate) {
  const data = context.newGameState();
  delete data.legacySkillRemovalV1;
  data.player.skills = { powerSlash: 3, arcaneBurst: 5, manaBarrier: 2, meditation: 1 };
  data.player.skillUnlocks = { powerSlash: true, arcaneBurst: true, manaBarrier: true, ironSkin: true };
  data.player.fusions = [{ id: 'fusion_a', name: '融合甲', components: ['powerSlash', 'iceLance'], seed: 7, algo: 2 }];
  data.player.magicScroll = 12;
  data.player.loadout = ['powerSlash', 'sg:thrust', 'arcaneBurst', 'potential:velocityForce', 'fusion_a'];
  if (mutate) mutate(data);
  return data;
}

test('舊技能、解鎖紀錄、融合技與魔法卷軸整批刪除', () => {
  const c = loadMigrationContext();
  const data = legacySave(c);
  c.migrateSave(data);
  assert.equal(data.player.skills, undefined);
  assert.equal(data.player.skillUnlocks, undefined);
  assert.equal(data.player.fusions, undefined);
  assert.equal(data.player.magicScroll, undefined);
  assert.equal(data.legacySkillRemovalV1, true);
});

test('裝載欄：舊技能與融合技被卸下，新版技能群組與潛力技能原位保留', () => {
  const c = loadMigrationContext();
  const data = legacySave(c);
  c.migrateSave(data);
  assert.deepEqual(data.player.loadout, [null, 'sg:thrust', null, 'potential:velocityForce']);
});

test('裝載欄尾端的舊技能卸下後不留空洞（與 unequip 慣例一致）', () => {
  const c = loadMigrationContext();
  const data = legacySave(c, (d) => { d.player.loadout = ['sg:thrust', 'powerSlash', 'fusion_a']; });
  c.migrateSave(data);
  assert.deepEqual(data.player.loadout, ['sg:thrust']);
});

test('公告統計：清除幾個舊技能、幾個融合技、卸下幾個、幾張卷軸', () => {
  const c = loadMigrationContext();
  const data = legacySave(c);
  c.migrateSave(data);
  assert.deepEqual(JSON.parse(JSON.stringify(data._legacySkillRemoval)),
    { skills: 4, fusions: 1, equipped: 3, scrolls: 12 });
});

test('技能點自動退還：已投入只剩潛力技能', () => {
  const c = loadMigrationContext();
  const data = legacySave(c, (d) => {
    d.player.reincarnations = 3;
    d.player.talents = { levels: {}, potentialLevels: { velocityForce: 2 } };
  });
  c.migrateSave(data);
  c.G = data;
  assert.equal(c.spentSkillPoints(), 2);
  assert.equal(c.availableSkillPoints(), c.totalSkillPoints() - 2);
});

test('主線任務索引：被移除的兩個任務（原索引 6、16）之後的已領取進度平移', () => {
  const c = loadMigrationContext();
  const cases = [
    { idx: 0, want: 0 }, { idx: 6, want: 6 }, { idx: 7, want: 6 },
    { idx: 16, want: 15 }, { idx: 17, want: 15 }, { idx: 30, want: 28 }
  ];
  cases.forEach(({ idx, want }) => {
    const data = legacySave(c, (d) => { d.taskState = { idx }; });
    c.migrateSave(data);
    assert.equal(data.taskState.idx, want, '舊索引 ' + idx);
  });
});

test('已領完全部任務的玩家仍是「全部領完」', () => {
  const c = loadMigrationContext();
  const data = legacySave(c, (d) => { d.taskState = { idx: c.TASKS.length + 2 }; });
  c.migrateSave(data);
  assert.equal(data.taskState.idx, c.TASKS.length);
});

test('重複讀檔冪等：旗標寫入後不再平移任務索引、不再公告', () => {
  const c = loadMigrationContext();
  const data = legacySave(c, (d) => { d.taskState = { idx: 20 }; });
  c.migrateSave(data);
  assert.equal(data.taskState.idx, 18);
  delete data._legacySkillRemoval;
  c.migrateSave(data);
  assert.equal(data.taskState.idx, 18);
  assert.equal(data._legacySkillRemoval, undefined);
});

test('新帳號不觸發：newGameState 預帶完成旗標，也沒有舊技能欄位', () => {
  const c = loadMigrationContext();
  const fresh = c.newGameState();
  assert.equal(fresh.legacySkillRemovalV1, true);
  assert.equal(fresh.player.skills, undefined);
  assert.equal(fresh.player.fusions, undefined);
  assert.equal(fresh.player.magicScroll, undefined);
  assert.deepEqual(Array.from(fresh.player.loadout), []);
  fresh.taskState = { idx: 20 };
  c.migrateSave(fresh);
  assert.equal(fresh.taskState.idx, 20);
  assert.equal(fresh._legacySkillRemoval, undefined);
});

test('沒有任何舊技能資料的舊存檔：不產生公告', () => {
  const c = loadMigrationContext();
  const data = legacySave(c, (d) => {
    d.player.skills = {}; d.player.fusions = []; d.player.magicScroll = 0; d.player.loadout = ['sg:thrust'];
  });
  c.migrateSave(data);
  assert.equal(data._legacySkillRemoval, undefined);
  assert.deepEqual(data.player.loadout, ['sg:thrust']);
});

test('已下架的傳奇特效自裝備剝除；仍存在的特效與詞條不動', () => {
  const c = loadMigrationContext();
  const data = legacySave(c, (d) => {
    const gone = c.makeEquipment(100, { rarity: 5, level: 100, slot: 'weapon' });
    const kept = c.makeEquipment(100, { rarity: 5, level: 100, slot: 'weapon' });
    gone.passive = { key: 'skyfallMeteor' };
    kept.passive = { key: 'mountainSunderer' };
    d.inventory = [gone, kept];
  });
  c.migrateSave(data);
  assert.equal(data.inventory[0].passive, undefined);
  assert.equal(data.inventory[1].passive.key, 'mountainSunderer');
});

test('PASSIVE_POOL 已無舊技能專屬傳奇特效，也沒有任何 triggerSkill', () => {
  const c = loadMigrationContext();
  const removed = ['whirlwindRift', 'whirlwindBleed', 'frostSpike', 'stormSigilChain', 'skyfallMeteor', 'manaExplosion',
    'judgmentArrival', 'holyImpact', 'shadowAnnihilation', 'voidFate', 'shadowRipper', 'deathDomain', 'lightningLeap',
    'auroraStaff', 'iceShriek', 'venomMist', 'oathOfCondemnation', 'manaGuard'];
  removed.forEach((key) => assert.equal(c.PASSIVE_POOL[key], undefined, key));
  Object.keys(c.PASSIVE_POOL).forEach((key) => {
    assert.equal(c.PASSIVE_POOL[key].triggerSkill, undefined, key + ' 不應再有 triggerSkill');
  });
});
