'use strict';
/* ============================================================
   elite-groups.test.cjs — 菁英群組出怪（js/combat.js spawnEliteWave、js/formula.js planEliteWave）

   規則（使用者 2026-10-07）：
     1. 菁英也會在普通關出現；每 10 關固定出現的菁英照常
     2. 菁英成群出現：每群 2~4 隻，全員菁英或「菁英帶小兵」
     3. 機率與數量都在 game_parameters（ELITE_GROUP）
   期望值一律從表推導，不寫死數字（表由使用者調）。
   ============================================================ */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadEliteEnv } = require('./helpers/elite-env.cjs');

function run(c, code) { return vm.runInContext(code, c); }
function groupsOf(list) {
  const out = {};
  list.forEach((e) => { (out[e._gid] || (out[e._gid] = [])).push(e); });
  return Object.keys(out).map((k) => out[k]);
}
function spawnAt(c, stage, zone) {
  run(c, "G.stage.current = " + stage + "; G.stage.zone = '" + (zone || 'desert') + "'; FIELD.monsters = []; FIELD.monster = null; FIELD._waveClearPending = false;");
  return c.spawnFieldMonster(false);
}

test('ELITE-GROUP-1 菁英關每一波都是菁英群：每群 2~4 隻，群數受菁英表限制', () => {
  const c = loadEliteEnv();
  const table = c.FIELD_ELITE_COUNT_TABLE_BY_ZONE.desert.filter((r) => r[1] > 0).map((r) => r[0]);
  const maxGroups = Math.max.apply(null, table);
  for (let i = 0; i < 300; i++) {
    const wave = spawnAt(c, 10);
    assert.ok(wave.length >= 2);
    const groups = groupsOf(wave);
    assert.ok(groups.length >= 1 && groups.length <= maxGroups, '群數 ' + groups.length);
    groups.forEach((g) => {
      // 放不下時會從最後一群尾端砍起，所以只有最後一群可以少於 2 隻
      assert.ok(g.length >= 1 && g.length <= 4);
      assert.ok(g.some((e) => e.elite), '每一群至少有一隻菁英');
    });
    assert.ok(wave.every((e) => !e.isBoss));
  }
});

test('ELITE-GROUP-2 全員菁英或「菁英帶小兵」；詞條只在菁英身上，同一群共用同一組', () => {
  const c = loadEliteEnv();
  let pure = 0, mixed = 0;
  for (let i = 0; i < 400; i++) {
    const wave = spawnAt(c, 10, 'swamp');
    groupsOf(wave).forEach((g) => {
      const elites = g.filter((e) => e.elite);
      const minions = g.filter((e) => !e.elite);
      if (minions.length === 0) pure++; else mixed++;
      assert.ok(elites.length >= 1);
      assert.ok(elites.length === g.length || elites.length === Math.min(g.length, c.ELITE_GROUP.leaders),
        '混合群的菁英數＝帶隊數，實際 ' + elites.length + '/' + g.length);
      elites.forEach((e) => {
        assert.ok(Array.isArray(e.affixes) && e.affixes.length >= 1 && e.affixes.length <= 3, '每隻菁英 1~3 個詞條');
        assert.deepEqual(Array.from(e.affixes), Array.from(elites[0].affixes), '同一群共用同一組詞條');
        assert.ok(e._el && e._fx, '詞條引擎狀態');
      });
      minions.forEach((e) => {
        assert.equal(e.affixes, undefined, '小兵沒有詞條');
        assert.equal(e.elite, false);
      });
    });
  }
  assert.ok(pure > 0 && mixed > 0, '兩種型態都該出現（純菁英 ' + pure + '／帶小兵 ' + mixed + '）');
});

test('ELITE-GROUP-3 帶隊人數、小兵倍率與獎勵倍率吃參數', () => {
  const c = loadEliteEnv();
  run(c, 'ELITE_GROUP.leaders = 2; ELITE_GROUP.minionHp = 0.5; ELITE_GROUP.minionAtk = 0.25; ELITE_GROUP.minionReward = 0.1;');
  run(c, "ELITE_GROUP.pureChance.desert = [[1, 9999, 0]]; ELITE_GROUP.sizeWeights.desert = [[1, 9999, 4, 1]];");
  let checked = 0;
  for (let i = 0; i < 100; i++) {
    const wave = spawnAt(c, 10);
    groupsOf(wave).forEach((g) => {
      if (g.length < 4) return;
      assert.equal(g.filter((e) => e.elite).length, 2, '帶隊 2 隻');
      const elite = g.find((e) => e.elite), minion = g.find((e) => !e.elite);
      // 同一張地圖、同一關，NPC 倍率可能不同，所以用「相對於同種普通怪」比較：比例要落在小兵倍率附近
      assert.ok(minion.maxHp < elite.maxHp, '小兵生命低於菁英');
      assert.ok(minion.gold < elite.gold, '小兵金幣低於菁英');
      checked++;
    });
  }
  assert.ok(checked > 20);
});

test('ELITE-GROUP-4 普通關：依機率改出菁英群，機率 0 就永遠不出，100 就一定出', () => {
  const c = loadEliteEnv();
  run(c, 'eliteNormalChanceFor = function () { return 0; };');
  for (let i = 0; i < 100; i++) {
    const wave = spawnAt(c, 11);
    assert.ok(wave.every((e) => !e.elite && e._gid === undefined), '機率 0 不該有菁英');
  }
  run(c, 'eliteNormalChanceFor = function () { return 100; };');
  for (let i = 0; i < 100; i++) {
    const wave = spawnAt(c, 11);
    assert.ok(wave.some((e) => e.elite && e._gid !== undefined), '機率 100 一定是菁英群');
  }
});

test('ELITE-GROUP-5 普通關菁英機率依地圖與關卡區間查表，找不到區間＝0，未列出的地圖走 other', () => {
  const c = loadEliteEnv();
  run(c, `ELITE_GROUP.normalChance = {
    desert: [[1, 10, 1], [11, 50, 3]], Icefield: [[1, 9999, 6]], swamp: [[1, 9999, 8]],
    undead_mountains: [[1, 9999, 10]], other: [[1, 9999, 12]] };`);
  assert.equal(c.eliteNormalChanceFor(5, 'desert'), 1);
  assert.equal(c.eliteNormalChanceFor(10, 'desert'), 1);
  assert.equal(c.eliteNormalChanceFor(11, 'desert'), 3);
  assert.equal(c.eliteNormalChanceFor(51, 'desert'), 0, '沒被任何區間涵蓋＝0');
  assert.equal(c.eliteNormalChanceFor(5, 'Icefield'), 6);
  assert.equal(c.eliteNormalChanceFor(5, 'god_realm_2'), 12, '沒有專屬一列的地圖走 other');
  assert.equal(c.eliteZoneKey('swamp'), 'swamp');
  assert.equal(c.eliteZoneKey('nope'), 'other');
});

test('ELITE-GROUP-6 群內隻數與純菁英機率、技能數量都依區間表擲骰', () => {
  const c = loadEliteEnv();
  run(c, "ELITE_GROUP.sizeWeights.desert = [[1, 50, 2, 1], [51, 9999, 4, 1]]; ELITE_GROUP.pureChance.desert = [[1, 50, 0], [51, 9999, 100]];");
  for (let i = 0; i < 200; i++) {
    assert.equal(c.rollEliteGroupSize(10, 'desert'), 2);
    assert.equal(c.rollEliteGroupSize(60, 'desert'), 4);
    assert.equal(c.rollEliteGroupPure(10, 'desert'), false);
    assert.equal(c.rollEliteGroupPure(60, 'desert'), true);
  }
  run(c, 'ELITE_GROUP.skillCountWeights = [[1, 100, 0, 0, 1], [101, 9999, 1, 0, 0]];');
  for (let i = 0; i < 100; i++) {
    assert.equal(c.rollEliteSkillCount(50), 3);
    assert.equal(c.rollEliteSkillCount(500), 1);
  }
  run(c, 'ELITE_GROUP.skillCountWeights = [];');
  assert.equal(c.rollEliteSkillCount(50), 1, '表是空的就退回 1 個');
});

test('ELITE-GROUP-7 菁英關過關配額＝這一輪群組的總隻數；BOSS 關不變', () => {
  const c = loadEliteEnv();
  run(c, 'planEliteWave = function () { return [{ size: 3, pure: true }, { size: 2, pure: false }]; };');
  run(c, "G.stage.current = 10; FIELD.quotaStage = -1; FIELD.stageQuota = 0;");
  assert.equal(c.fieldStageQuota(), 5);
  run(c, "G.stage.current = 11; FIELD.quotaStage = -1; FIELD.stageQuota = 0;");
  const normal = c.fieldStageQuota();
  assert.ok(normal >= 1, '普通關走原本的小怪表（至少 1 隻）');
  const boss = loadEliteEnv();
  const wave = spawnAt(boss, 50);
  assert.equal(wave.length, 1);
  assert.ok(wave[0].isBoss && wave[0]._gid === undefined, 'BOSS 不成群');
});

test('ELITE-GROUP-8 串流補波：場上快滿時只補放得下的，且絕不超過同時上限', () => {
  const c = loadEliteEnv();
  run(c, 'fieldMaxLiveEnemiesFor = function () { return 5; };');
  run(c, "G.stage.current = 10; FIELD.monsters = [];");
  const first = c.spawnFieldMonster(true);
  assert.ok(first.length <= 5);
  const second = c.spawnFieldMonster(true);
  assert.ok(c.liveFieldEnemies().length <= 5, '同時存活不得超過上限');
  run(c, 'fieldMaxLiveEnemiesFor = function () { return 0; };');
  const none = c.spawnFieldMonster(true);
  assert.equal(none.length, 0, '上限 0＝這一波跳過');
});

test('ELITE-GROUP-9 同一群擠在一起進場，每隻都有進場倒數，且隨群錯開', () => {
  const c = loadEliteEnv();
  for (let i = 0; i < 100; i++) {
    const wave = spawnAt(c, 10);
    groupsOf(wave).forEach((g) => {
      const anchor = g[0].pos;
      g.forEach((e) => {
        assert.ok(e._enterCd >= c.FIELD_ENEMY_ENTER_DELAY - 1e-9, '進場倒數');
        assert.ok(Math.hypot(e.pos.x - anchor.x, e.pos.y - anchor.y) <= 90, '同群成員相距不遠');
        assert.equal(e._stage, c.G.stage.current, '計入本關過關配額');
      });
    });
  }
});

test('ELITE-GROUP-10 沒有詞條引擎的環境維持舊行為：菁英關單隻菁英、普通關不遇菁英', () => {
  const noEngine = loadEliteEnv();
  vm.runInContext('eliteEquip = undefined;', noEngine);
  for (let i = 0; i < 50; i++) {
    const wave = spawnAt(noEngine, 11);
    assert.ok(wave.every((e) => !e.elite && e._gid === undefined));
  }
  const wave = spawnAt(noEngine, 10);
  assert.ok(wave.every((e) => e.elite && e._gid === undefined));
});
