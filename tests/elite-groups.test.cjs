'use strict';
/* ============================================================
   elite-groups.test.cjs — 高級敵人出怪（js/combat.js spawnEliteWave／野外 BOSS、js/formula.js planEliteWave）

   規則（文件 docs/elite_monster_affixes_guide.md、使用者 2026-10-13）：
     菁英     體型 1.6 倍、2 個隨機技能
     高級菁英  體型 2.2 倍、3 個隨機技能
     野外 BOSS 體型 3.4 倍、1 個專屬技能＋3 個隨機技能
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
      assert.ok(g.length >= 1 && g.length <= 4);
      assert.ok(g.some((e) => e.elite), '每一群至少有一隻菁英');
    });
    assert.ok(wave.every((e) => !e.isBoss));
  }
});

test('ELITE-GROUP-2 全員菁英或「菁英帶小兵」；技能只在菁英身上，各自依 NPC 表配（菁英 2 個、高級菁英 3 個隨機）', () => {
  const c = loadEliteEnv();
  run(c, 'ELITE_GROUP.advChance = [50, 50];');
  let pure = 0, mixed = 0, adv = 0, normalElite = 0;
  for (let i = 0; i < 400; i++) {
    const wave = spawnAt(c, 10, 'swamp');
    groupsOf(wave).forEach((g) => {
      const elites = g.filter((e) => e.elite);
      const minions = g.filter((e) => !e.elite);
      if (minions.length === 0) pure++; else mixed++;
      assert.ok(elites.length >= 1);
      elites.forEach((e) => {
        const want = e._tier === 'elite_adv' ? 3 : 2;
        assert.ok(e._tier === 'elite' || e._tier === 'elite_adv', '菁英的類型：' + e._tier);
        assert.ok(Array.isArray(e.affixes) && e.affixes.length === want, e._tier + ' 應有 ' + want + ' 個技能，實際 ' + e.affixes.length);
        assert.equal(new Set(e.affixes).size, e.affixes.length, '技能不重複');
        e.affixes.forEach((id) => assert.ok(c.ELITE_AFFIXES[id], '未知技能 ' + id));
        assert.ok(e._el && e._fx, '技能引擎狀態');
        if (e._tier === 'elite_adv') adv++; else normalElite++;
      });
      minions.forEach((e) => {
        assert.equal(e.affixes, undefined, '小兵沒有技能');
        assert.equal(e.elite, false);
        assert.equal(e._tier, undefined);
      });
    });
  }
  assert.ok(pure > 0 && mixed > 0, '兩種型態都該出現（純菁英 ' + pure + '／帶小兵 ' + mixed + '）');
  assert.ok(adv > 0 && normalElite > 0, '兩種等級都該出現（高級 ' + adv + '／一般 ' + normalElite + '）');
});

test('ELITE-GROUP-3 高級菁英機率吃參數（普通關／菁英關各一個）；0＝完全不出現、100＝全是高級', () => {
  const c = loadEliteEnv();
  run(c, 'ELITE_GROUP.advChance = [0, 0];');
  for (let i = 0; i < 60; i++) spawnAt(c, 10).filter((e) => e.elite).forEach((e) => assert.equal(e._tier, 'elite'));
  run(c, 'ELITE_GROUP.advChance = [0, 100];');
  for (let i = 0; i < 60; i++) spawnAt(c, 10).filter((e) => e.elite).forEach((e) => assert.equal(e._tier, 'elite_adv', '菁英關機率 100%'));
  // 普通關（19 不是 10 的倍數）：把出菁英群的機率調到 100，用普通關那一格
  run(c, 'ELITE_GROUP.advChance = [100, 0]; ELITE_GROUP.normalChance = { desert: [[1, 9999, 100]], other: [[1, 9999, 100]] };');
  for (let i = 0; i < 60; i++) spawnAt(c, 19).filter((e) => e.elite).forEach((e) => assert.equal(e._tier, 'elite_adv', '普通關機率 100%'));
});

test('ELITE-GROUP-4 體型與數值：菁英 1.6、高級菁英 2.2；高級菁英的生命／攻擊倍率吃參數', () => {
  const c = loadEliteEnv();
  run(c, 'ELITE_GROUP.advChance = [0, 50];');
  const sizes = new Set();
  let eliteHp = 0, advHp = 0, eliteAtk = 0, advAtk = 0;
  for (let i = 0; i < 300 && (!eliteHp || !advHp); i++) {
    spawnAt(c, 10, 'desert').filter((e) => e.elite).forEach((e) => {
      sizes.add(e._tier + ':' + e._size);
      /* 同一張地圖同一階段：血量只差階級倍率與 NPC 自己的 hpMult，所以用 maxHp ÷ 該 NPC 的 hpMult 比較 */
      const hp = e.maxHp / (c.NPC_CONFIG_TABLE[e.npcId].hpMult || 1);
      if ((e.affixes || []).indexOf('e_vitality') >= 0) return;   // 強命技能本身 +50% 生命，抽到的不能拿來比階級倍率
      if (e._tier === 'elite') { eliteHp = hp; eliteAtk = e.atk / (c.NPC_CONFIG_TABLE[e.npcId].atkMult || 1); }
      else { advHp = hp; advAtk = e.atk / (c.NPC_CONFIG_TABLE[e.npcId].atkMult || 1); }
      assert.equal(e._bodyR, c.bfBodyRadius() * e._size, '碰撞半徑＝基本半徑 × 體型');
      assert.ok(e._elColor, '光暈顏色');
    });
  }
  assert.ok(sizes.has('elite:1.6') && sizes.has('elite_adv:2.2'), Array.from(sizes).join(','));
  const g = run(c, 'ELITE_GROUP');
  assert.ok(Math.abs(advHp / eliteHp - g.advHp / c.FIELD_ELITE.hpMult) < 0.001, '高級菁英生命＝普通怪 × advHp');
  assert.ok(Math.abs(advAtk / eliteAtk - g.advAtk / c.FIELD_ELITE.atkMult) < 0.001, '高級菁英攻擊＝普通怪 × advAtk');
});

test('ELITE-GROUP-5 野外 BOSS：1 個專屬技能（NPC 表）＋3 個隨機技能，體型 3.4，會跑位', () => {
  const c = loadEliteEnv();
  const interval = run(c, 'FIELD_BOSS_STAGE_INTERVAL');
  let seen = 0;
  for (let i = 0; i < 40; i++) {
    const wave = spawnAt(c, interval, 'desert');
    const boss = wave.find((e) => e.isBoss);
    assert.ok(boss, 'BOSS 階要出 BOSS');
    seen++;
    assert.equal(boss._tier, 'boss');
    assert.equal(boss._size, run(c, 'ELITE_GROUP.sizeBoss'));
    const npc = c.NPC_CONFIG_TABLE[boss.npcId];
    const ex = (npc.skills && npc.skills.boss && npc.skills.boss.ex) || [];
    assert.ok(ex.length >= 1, 'NPC 表的 boss 列要有專屬技能：' + boss.npcId);
    ex.forEach((id) => assert.ok(boss.affixes.indexOf(id) >= 0, '專屬技能 ' + id + ' 一定在'));
    assert.equal(boss.affixes.length, ex.length + 3, '專屬 ' + ex.length + ' 個＋隨機 3 個');
    ex.forEach((id) => assert.equal(c.ELITE_AFFIXES[id].pool, 'exclusive'));
    boss.affixes.filter((id) => ex.indexOf(id) < 0).forEach((id) => assert.equal(c.ELITE_AFFIXES[id].pool, 'random'));
    assert.ok(boss._el && boss._bodyR === c.bfBodyRadius() * boss._size);
  }
  assert.ok(seen > 0);
});

test('ELITE-GROUP-6 普通關也會遇到菁英群；機率吃參數表（0＝不會遇到）', () => {
  const c = loadEliteEnv();
  run(c, "ELITE_GROUP.normalChance = { desert: [[1, 9999, 100]], other: [[1, 9999, 100]] };");
  const wave = spawnAt(c, 19);
  assert.ok(wave.some((e) => e.elite), '機率 100% 一定出菁英群');
  run(c, "ELITE_GROUP.normalChance = { desert: [[1, 9999, 0.0001]], other: [[1, 9999, 0.0001]] }; Math.random = function () { return 0.99; };");
  const wave2 = spawnAt(c, 19);
  assert.ok(wave2.every((e) => !e.elite), '機率近 0 不出菁英');
});

test('ELITE-GROUP-7 小兵倍率與獎勵倍率吃參數（沿用）', () => {
  const c = loadEliteEnv();
  run(c, 'ELITE_GROUP.leaders = 2; ELITE_GROUP.minionHp = 0.5; ELITE_GROUP.minionAtk = 0.25; ELITE_GROUP.minionReward = 0.1; ELITE_GROUP.advChance = [0, 0];');
  run(c, "ELITE_GROUP.pureChance.desert = [[1, 9999, 0]]; ELITE_GROUP.sizeWeights.desert = [[1, 9999, 4, 1]];");
  let checked = 0;
  for (let i = 0; i < 60; i++) {
    groupsOf(spawnAt(c, 10)).forEach((g) => {
      if (g.length < 4) return;
      assert.equal(g.filter((e) => e.elite).length, 2, '帶隊 2 隻');
      const base = c.monsterStatsFor(10, false, false);
      g.filter((e) => !e.elite).forEach((m) => {
        assert.ok(m.maxHp <= base.hp * c.currentZoneDef().hpMult * 0.5 * 2.5, '小兵血量打對折');
        assert.ok(m.gold <= base.gold * c.currentZoneDef().rewardMult * 0.1 * 1.01 + 0.01);
      });
      checked++;
    });
  }
  assert.ok(checked > 0);
});
