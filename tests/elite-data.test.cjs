'use strict';
/* ============================================================
   elite-data.test.cjs — 敵人專用技能的資料接線（Skills2「類別＝enemy」→ ENEMY_SKILLS2 → ELITE_AFFIXES）
   對照文件：docs/elite_monster_affixes_guide.md（17 個隨機技能的冷卻、數量、距離、持續時間都逐項核對）
   ============================================================ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadEliteEnv } = require('./helpers/elite-env.cjs');

const root = path.resolve(__dirname, '..');
const PRESETS = new Set(fs.readdirSync(path.join(root, 'vfx/presets')).map((f) => f.replace(/\.json$/i, '')));

/* 文件列出的 17 個隨機技能 */
const RANDOM_POOL = ['e_firechain', 'e_arcane', 'e_molten', 'e_plague', 'e_electrified', 'e_poisoncross', 'e_frostburst',
  'e_frostpulse', 'e_mortar', 'e_walls', 'e_vortex', 'e_shield', 'e_vitality', 'e_avenger', 'e_summon', 'e_missile', 'e_thunderstorm'];

test('ELITE-DATA-1 敵人技能都在 ELITE_AFFIXES 裡，arch 接得上引擎', () => {
  const c = loadEliteEnv();
  const ids = c.ELITE_AFFIX_ORDER;
  assert.ok(ids.length >= 50, '技能數 ' + ids.length);
  assert.equal(Object.keys(c.ENEMY_SKILLS2).length, ids.length);
  const casters = Object.keys(c.ELITE_CASTERS);
  ids.forEach((id) => {
    const d = c.ELITE_AFFIXES[id];
    assert.match(id, /^e_/, id);
    assert.ok(d.name && d.emoji && d.desc, id + ' 要有名稱、圖示、說明');
    assert.ok(d.kind === 'active' || d.kind === 'passive', id + ' kind');
    if (d.kind === 'active') {
      assert.ok(casters.indexOf(d.arch) >= 0, id + ' 的主動 arch「' + d.arch + '」沒有施放函式');
      assert.ok(d.cd[0] > 0 && d.cd[1] >= d.cd[0], id + ' 主動技能要有冷卻');
    } else {
      assert.ok(Array.from(c.ELITE_PASSIVE_ARCHS).indexOf(d.arch) >= 0, id + ' 的被動 arch「' + d.arch + '」未登記');
    }
    assert.ok(d.pool === 'random' || d.pool === 'exclusive', id + ' pool');
  });
});

test('ELITE-DATA-2 隨機技能池剛好是文件的 17 種', () => {
  const c = loadEliteEnv();
  assert.deepEqual(Array.from(c.eliteSkillIds('random')).sort(), RANDOM_POOL.slice().sort());
});

test('ELITE-DATA-3 文件規則逐項核對（冷卻、數量、距離、持續）', () => {
  const c = loadEliteEnv();
  const A = c.ELITE_AFFIXES;
  const cd = (id) => Array.from(A[id].cd);
  assert.deepEqual(cd('e_arcane'), [3, 10]);
  assert.deepEqual(cd('e_poisoncross'), [3, 10]);
  assert.deepEqual(cd('e_frostburst'), [3, 6]);
  assert.deepEqual(cd('e_frostpulse'), [4, 7]);
  assert.deepEqual(cd('e_mortar'), [5, 10]);
  assert.deepEqual(cd('e_walls'), [6, 10]);
  assert.deepEqual(cd('e_vortex'), [7, 12]);
  assert.deepEqual(cd('e_shield'), [8, 12]);
  assert.deepEqual(cd('e_summon'), [10, 15]);
  assert.deepEqual(cd('e_missile'), [5, 8]);
  assert.deepEqual(cd('e_thunderstorm'), [6, 10]);
  assert.deepEqual(cd('e_plague'), [3, 6]);
  assert.deepEqual(cd('e_firechain'), [3, 6]);
  // 距離單位：表上是米，載入後 ×10 變座標單位
  assert.equal(A.e_arcane.throwRange, 180, '秘法棒丟到玩家 18 米內');
  assert.equal(A.e_arcane.dur, 6, '秘法棒持續 6 秒');
  assert.equal(A.e_poisoncross.dur, 6, '毒水球持續 6 秒');
  assert.deepEqual(Array.from(A.e_frostburst.grow), [2, 3].map((v) => v), '冰晶膨脹 2~3 秒');
  assert.equal(A.e_mortar.minRange, 140, '迫擊最小射程 14 米');
  assert.equal(A.e_vortex.speed, 600, '漩渦拉扯速度 60 米/秒');
  assert.equal(A.e_vortex.arcH, 30, '漩渦拋物線高度約 3 米');
  assert.equal(A.e_shield.dur, 3, '護盾持續 3 秒');
  assert.equal(A.e_vitality.hp, 1.5, '強命 +50% 生命');
  assert.equal(A.e_avenger.size, 0.2); assert.equal(A.e_avenger.atk, 0.2); assert.equal(A.e_avenger.aspd, 0.2);
  assert.equal(A.e_plague.life, 20, '毒水窪持續 20 秒');
  assert.equal(A.e_molten.life, 10, '火徑持續 10 秒');
  assert.equal(A.e_molten.coreDelay, 3, '熔岩核心約 3 秒後自爆');
  assert.deepEqual(Array.from(A.e_summon.n), [2, 4], '召喚每次 2~4 隻');
  assert.equal(A.e_summon.hpCut, 0.9, '召喚者死後小怪最大生命 −90%');
  assert.deepEqual(Array.from(A.e_missile.n), [3, 5], '飛彈每次 3~5 枚');
  assert.deepEqual(Array.from(A.e_thunderstorm.n), [2, 3], '落雷每次 2~3 下');
  assert.equal(A.e_thunderstorm.spread, 60, '落雷在玩家周圍 6 米內');
  assert.equal(A.e_thunderstorm.r, 80, '落雷傷害半徑 8 米');
  assert.deepEqual(Array.from(A.e_electrified.n), [2, 4], '每次被擊中散出 2~4 個電火花');
});

test('ELITE-DATA-4 特效：每個引用的 Preset 都存在，而且全是敵人專用（en- 開頭），不與玩家技能共用', () => {
  const c = loadEliteEnv();
  const used = new Set();
  c.ELITE_AFFIX_ORDER.forEach((id) => {
    const d = c.ELITE_AFFIXES[id];
    Object.keys(d.v).forEach((role) => { used.add(d.v[role]); });
    (d.presets || []).forEach((p) => used.add(p));
  });
  assert.ok(used.size > 40);
  used.forEach((p) => {
    assert.ok(PRESETS.has(p), 'vfx/presets 缺 ' + p);
    assert.match(p, /^en-/, p + ' 不是敵人專用 Preset（使用者規則：敵人技能的特效不要和玩家技能一樣）');
  });
  // 玩家技能與狀態表用到的 Preset 一個都不能出現在敵人技能裡
  const player = new Set();
  Object.keys(c.SKILLS2).forEach((g) => {
    const grp = c.SKILLS2[g];
    (grp.tiers || []).concat(grp.ult || []).forEach((t) => {
      [t.vfx, t.triggerVfx].forEach((v) => { if (v) Object.keys(v).forEach((k) => player.add(v[k])); });
    });
  });
  used.forEach((p) => assert.ok(!player.has(p), p + ' 也被玩家技能使用'));
});

test('ELITE-DATA-5 preset id 不寫在引擎程式裡（特效一律由 Skills2 表填入）', () => {
  ['js/elite.js', 'js/elite_data.js', 'js/battle-elite.js'].forEach((f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const hits = (src.match(/['"](en-[a-z0-9-]+|mark-red|burst-[a-z-]+|hit-[a-z-]+|proj-[a-z-]+|ground-[a-z-]+)['"]/g) || []);
    assert.deepEqual(hits, [], f + ' 內不得出現寫死的 preset id：' + hits.join(','));
  });
});

test('ELITE-DATA-6 技能 id 的說明、顏色、表上欄位完整；被動技能沒有冷卻', () => {
  const c = loadEliteEnv();
  c.ELITE_AFFIX_ORDER.forEach((id) => {
    const d = c.ELITE_AFFIXES[id];
    assert.match(d.color, /^#[0-9a-fA-F]{6}$/, id + ' color');
    assert.ok(d.desc.length >= 8, id + ' 說明太短');
    if (d.kind === 'passive') assert.deepEqual(Array.from(d.cd), [0, 0], id + ' 被動技能沒有冷卻');
  });
});

test('ELITE-DATA-7 要同伴才有意義的技能（火鏈、復仇…）有標 needs，單獨一隻抽不到', () => {
  const c = loadEliteEnv();
  assert.equal(c.ELITE_AFFIXES.e_firechain.needs, 'group');
  assert.equal(c.ELITE_AFFIXES.e_avenger.needs, 'group');
  const picked = new Set();
  for (let i = 0; i < 400; i++) {
    c.eliteRollSkills({ skills: { elite: { rnd: [6, 6] } } }, 'elite', { stage: 50, group: 1, tower: false, atkRange: 60 }).forEach((id) => picked.add(id));
  }
  assert.ok(!picked.has('e_firechain') && !picked.has('e_avenger'), '單獨一隻不該抽到需要同伴的技能');
  assert.ok(!picked.has('e_mortar'), '射程 6 米的近戰怪抽不到最小射程 14 米的迫擊');
  const withGroup = new Set();
  for (let i = 0; i < 400; i++) {
    c.eliteRollSkills({ skills: { elite: { rnd: [6, 6] } } }, 'elite', { stage: 50, group: 3, tower: false, atkRange: 240 }).forEach((id) => withGroup.add(id));
  }
  assert.ok(withGroup.has('e_firechain') && withGroup.has('e_avenger') && withGroup.has('e_mortar'), '同群、遠程怪抽得到');
  const tower = new Set();
  for (let i = 0; i < 400; i++) {
    c.eliteRollSkills({ skills: { rnd: [6, 6] } }, 'tower', { stage: 50, group: 1, tower: true, atkRange: 0 }).forEach((id) => tower.add(id));
  }
  assert.ok(!tower.has('e_summon'), '封魔塔只有 BOSS 一隻，不抽召喚');
});

test('ELITE-DATA-8 護盾的光罩整份標 perspective:false（走 billboard 層，不受視角方向與 FOV 影響）', () => {
  const c = loadEliteEnv();
  const id = c.STATUS.eInvuln.vfx.aura;
  const p = JSON.parse(fs.readFileSync(path.join(root, 'vfx/presets', id + '.json'), 'utf8'));
  assert.ok(p.layers.length > 0);
  p.layers.forEach((l) => assert.equal(l.perspective, false, id + ' 的圖層 ' + l.id));
});

test('ELITE-DATA-9 狀態型特效都在 Status 表：護盾／庇護光環／不死鳥掛無敵護罩，狂暴、復仇／血祭、再生、詛咒各有狀態與特效', () => {
  const c = loadEliteEnv();
  const A = c.ELITE_AFFIXES, S = c.STATUS;
  const self = (id) => Array.from((A[id].status && A[id].status.self || []).map((e) => e.id));
  assert.deepEqual(self('e_shield'), ['eInvuln']);
  assert.deepEqual(self('e_invulnaura'), ['eInvuln']);
  assert.deepEqual(self('e_phoenix'), ['eInvuln']);
  assert.deepEqual(self('e_enrage'), ['eEnrage']);
  assert.deepEqual(self('e_avenger'), ['eRage']);
  assert.deepEqual(self('e_bloodsac'), ['eRage']);
  assert.deepEqual(self('e_regen'), ['eRegen']);
  assert.deepEqual(Array.from((A.e_curse.status.enemy || []).map((e) => e.id)), ['eCurse'], '詛咒掛在玩家身上');
  // 這些技能不再在 Skills2 的特效欄填「狀態的畫面」（上身／持續／作用都只在 Status 表）
  assert.equal(A.e_shield.v.field, undefined, '護盾的光罩不是持續場域');
  assert.equal(A.e_enrage.v.attack, undefined);
  assert.equal(A.e_regen.v.attack, undefined);
  assert.equal(A.e_curse.v.hit, undefined);
  assert.equal(S.eInvuln.vfx.aura, 'en-gold-dome');
  assert.equal(S.eEnrage.vfx.aura, 'en-aura-enrage');
  assert.equal(S.eEnrage.vfx.apply, 'en-burst-blood');
  assert.equal(S.eRage.vfx.aura, 'en-aura-rage');
  assert.equal(S.eRage.vfx.apply, 'en-rage-burst');
  assert.equal(S.eRegen.vfx.tick, 'en-burst-holy');
  assert.equal(S.eCurse.vfx.apply, 'en-curse-dark');
  ['eInvuln', 'eEnrage', 'eRage', 'eRegen', 'eCurse'].forEach((id) => {
    ['apply', 'aura', 'tick'].forEach((role) => {
      const p = S[id].vfx && S[id].vfx[role];
      if (p) assert.ok(PRESETS.has(p), id + ' 的 ' + role + ' 特效不存在：' + p);
    });
  });
});
