/* 模擬策略的技能計畫（player_strategy.md §4）。

   守的是「靜默失效」：技能指令送錯只會被遊戲回一句「需達到 N 級」「金幣不足」，
   模擬照跑、報表照出，只是角色全程只用普攻。（實際發生過：技能系統改版後
   策略用到的技能指令是 0 條，而且沒有任何東西會提醒。） */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPolicy } = require('../scripts/sim/policy.js');
const { createEngine } = require('../scripts/sim/engine.js');

const SKILLS_CFG = {
  panel: 'panels.skill', gold: 'view.gold',
  elemPool: ['fire', 'lightning'], elemCount: 2,
  survival: ['rockarmor', 'counter'], survivalSlots: 1,
  maxLearnsPerDecision: 6, switchMinSec: 1000, switchGoldMult: 2,
  gear: { equippedRarities: 'panels.inv.equipmentRarities', minRarity: 4, coverage: 1 },
  ult: { default: 0, byGroup: { thrust: { farm: 2, boss: 1, tower: 0 } } }
};

function policy(over) {
  return createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: {},
    skills: Object.assign({}, SKILLS_CFG, over || {}),
    rules: [{ id: 'sp', cmd: 'skill2.learn', skillPlan: true }]
  });
}

/* 假的技能面板。tiers 每階 { lv, cost, unlocked, prevOk, maxed }。 */
function tiers(spec) {
  return spec.map((t) => Object.assign({ lv: 0, cost: 100, unlocked: true, prevOk: true, maxed: false, unlockLv: 1 }, t));
}
function group(kind, elem, tierSpec, extra) {
  return Object.assign({
    name: 'x', kind, elem: elem || null, passive: false, castable: !!(tierSpec[0] && tierSpec[0].lv >= 1),
    tiers: tiers(tierSpec), ult: null
  }, extra || {});
}
const SEVEN = (lv0) => [{ lv: lv0 }, {}, {}, {}, {}, {}, {}];

function state(groups, opts) {
  opts = opts || {};
  return {
    gameTimeSec: opts.t || 100, seed: opts.seed === undefined ? 1 : opts.seed, view: { gold: opts.gold === undefined ? 1e6 : opts.gold },
    ctx: opts.ctx,
    panels: {
      skill: { loadoutSize: opts.size || 4, loadout: opts.loadout || [], prefix: 'sg:', tierMax: 10, groups },
      inv: { equipmentRarities: opts.rar || {} },
      tower: { tower: { active: !!opts.tower } }
    }
  };
}
const names = (cmds, n) => cmds.filter((c) => c.name === n).map((c) => c.args.group || c.args.id);

test('組合：同 seed 必得同組合，且整組同一類別', () => {
  const G = () => ({
    thrust: group('phys', null, SEVEN(1)), cleave: group('phys', null, SEVEN(1)), knife: group('phys', null, SEVEN(0)),
    fireball: group('magic', 'fire', SEVEN(1)), firepillar: group('magic', 'fire', SEVEN(0)),
    chainlightning: group('magic', 'lightning', SEVEN(0)), thunderorb: group('magic', 'lightning', SEVEN(0))
  });
  const a = policy({ mode: 'phys' }).decide(state(G(), { seed: 7 }));
  const b = policy({ mode: 'phys' }).decide(state(G(), { seed: 7 }));
  assert.deepEqual(a, b, '同 seed、同狀態，指令必須完全相同（決定論）');

  const cmds = policy({ mode: 'magic' }).decide(state(G(), { seed: 3, size: 4 }));
  const eq = names(cmds, 'skill.equipLoadout');
  assert.ok(eq.every((g) => /^sg:(fireball|firepillar|chainlightning|thunderorb)$/.test(g)),
    '魔法組只能裝魔法群組，實際：' + eq.join(','));
  assert.ok(eq.includes('sg:fireball'), '備用成員：主力還沒學的時候，已學會的同類別群組要先補上');
});

test('群組連第 1 階都有等級門檻：還沒開放的不挑，改挑現在學得起的', () => {
  const groups = {
    thrust: group('phys', null, SEVEN(1)),
    knife: group('phys', null, [{ lv: 0, unlocked: false, unlockLv: 50 }, {}, {}, {}, {}, {}, {}]),
    gale: group('phys', null, [{ lv: 0, unlocked: true, unlockLv: 1 }, {}, {}, {}, {}, {}, {}])
  };
  const cmds = policy({ mode: 'phys' }).decide(state(groups, { size: 4 }));
  const learned = cmds.filter((c) => c.name === 'skill2.learn' && c.args.tier === 0).map((c) => c.args.group);
  assert.ok(!learned.includes('knife'), '飛刀 50 級才開放，送了只會被回「需達到 50 級」');
  assert.ok(learned.includes('gale'));
});

test('學習：先把裝配欄各群組學起來，再依離超神進化的遠近升級', () => {
  const near = SEVEN(1); near.forEach((t, i) => { if (i < 6) { t.lv = 10; t.maxed = true; t.cost = null; } });
  const far = SEVEN(1);
  const groups = {
    thrust: group('phys', null, far),
    cleave: group('phys', null, near)
  };
  const cmds = policy({ mode: 'phys' }).decide(state(groups, { size: 4, gold: 1e9 }));
  const learn = cmds.filter((c) => c.name === 'skill2.learn');
  assert.equal(learn[0].args.group, 'cleave', '只差最後一階就能進超神進化的先升');
  assert.equal(learn[0].args.tier, 6);
});

test('學習：付不起的不送，且同一輪的金幣要扣掉已花的', () => {
  const groups = {
    thrust: group('phys', null, SEVEN(1)),
    cleave: group('phys', null, SEVEN(1))
  };
  const cmds = policy({ mode: 'phys' }).decide(state(groups, { size: 4, gold: 150 }));
  assert.equal(cmds.filter((c) => c.name === 'skill2.learn').length, 1,
    '每階 100，只有 150 金幣：只能送一條（後一條會被遊戲回「金幣不足」）');
});

test('生存率不足時，末幾格換成生存類群組', () => {
  const groups = {
    thrust: group('phys', null, SEVEN(1)), cleave: group('phys', null, SEVEN(1)),
    knife: group('phys', null, SEVEN(1)), gale: group('phys', null, SEVEN(1)),
    counter: group('phys', null, SEVEN(1), { passive: true })
  };
  const loadout = ['sg:thrust', 'sg:cleave', 'sg:knife', 'sg:gale'];
  const normal = policy({ mode: 'phys' }).decide(state(groups, { loadout, ctx: { desperate: false } }));
  assert.deepEqual(names(normal, 'skill.unequipLoadout'), [], '平時不動');

  const cmds = policy({ mode: 'phys' }).decide(state(groups, { loadout, ctx: { desperate: true } }));
  assert.deepEqual(names(cmds, 'skill.equipLoadout'), ['sg:counter']);
  assert.equal(names(cmds, 'skill.unequipLoadout').length, 1, '欄位滿了要先卸一個才裝得進去');
});

test('超神進化：7 階全滿且還沒選，依情境挑；已選的繼續升', () => {
  const full = SEVEN(10).map((t) => Object.assign(t, { lv: 10, maxed: true, cost: null }));
  const mk = (ult) => ({ thrust: group('phys', null, full, { ult }) });
  const base = { options: 3, unlocked: true, pick: -1, lv: 0, nextCost: null, optCosts: [500, 500, 500] };

  const farm = policy({ mode: 'phys' }).decide(state(mk(base), { gold: 1e6 }));
  assert.deepEqual(farm.filter((c) => c.name === 'skill2.ultPick').map((c) => c.args.opt), [2], '平時＝farm 選項');

  const tower = policy({ mode: 'phys' }).decide(state(mk(base), { gold: 1e6, tower: true }));
  assert.deepEqual(tower.filter((c) => c.name === 'skill2.ultPick').map((c) => c.args.opt), [0], '封魔塔中＝tower 選項');

  const picked = Object.assign({}, base, { pick: 2, lv: 3, nextCost: 800 });
  const up = policy({ mode: 'phys' }).decide(state(mk(picked), { gold: 1e6 }));
  const l = up.filter((c) => c.name === 'skill2.learn');
  assert.equal(l.length, 1);
  assert.equal(l[0].args.tier, 7, '超神進化階的索引是 7（第 8 格）');
});

test('超神進化切換：裝備未到位、金幣沒餘裕、剛切過都不切', () => {
  const full = SEVEN(10).map((t) => Object.assign(t, { lv: 10, maxed: true, cost: null }));
  const groups = { thrust: group('phys', null, full, { ult: { options: 3, unlocked: true, pick: 2, lv: 4, nextCost: null, optCosts: [500, 500, 500] } }) };
  const st = (o) => state(groups, Object.assign({ tower: true, t: 5000 }, o));       // 塔中想要 opt 0，目前是 2
  const sw = (cmds) => cmds.filter((c) => c.name === 'skill2.ultSwitch');

  assert.equal(sw(policy({ mode: 'phys' }).decide(st({ gold: 1e6, rar: { a: 3 } }))).length, 0, '品質覆蓋沒到門檻');
  assert.equal(sw(policy({ mode: 'phys' }).decide(st({ gold: 900, rar: { a: 4 } }))).length, 0, '金幣不到費用的 2 倍');
  const ok = sw(policy({ mode: 'phys' }).decide(st({ gold: 1e6, rar: { a: 4 } })));
  assert.equal(ok.length, 1);
  assert.deepEqual([ok[0].args.opt, ok[0].args.fromOpt, ok[0].args.fromLv, ok[0].args.cost], [0, 2, 4, 500]);

  const p = policy({ mode: 'phys' });
  p.decide(st({ gold: 1e6, rar: { a: 4 } }));
  assert.equal(sw(p.decide(st({ gold: 1e6, rar: { a: 4 }, t: 5100 }))).length, 0, '距離上次切換不到 switchMinSec');
});

/* ---- 與遊戲的連動 ---- */

test('技能面板與遊戲一致：解鎖判斷、費用、第 1 階開放等級', () => {
  const e = createEngine({ seed: 4 });
  e.boot(null);
  e.step(200);
  const c = e.ctx;
  const P = e.panel('skill');
  assert.equal(Object.keys(P.groups).length, Object.keys(c.SKILLS2).length, '群組數要與遊戲一致');
  assert.equal(P.loadoutSize, c.loadoutSize());

  c.G.player.gold = 1e12;
  for (const gid of Object.keys(P.groups)) {
    const g = P.groups[gid];
    const t0 = g.tiers[0];
    assert.equal(t0.cost, c.skills2UpgradeCost(gid, 0, t0.lv), gid + ' 第 1 階費用要等於遊戲算的');
    assert.equal(t0.unlockLv, c.SKILLS2[gid].tiers[0].unlock.lv);
    if (g.castable) continue;
    const reply = c.skills2Learn(gid, 0);
    if (t0.unlocked) assert.equal(reply, null, gid + ' 面板說可學，遊戲卻回：' + reply);
    else assert.ok(/需達到/.test(String(reply)), gid + ' 面板說未開放，遊戲回：' + reply);
    if (reply === null) c.skills2Downgrade(gid, 0);            // 還原，避免影響後面的群組
  }
});

/* ---- 任務（player_strategy.md §6）---- */

function taskPolicy() {
  return createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: {},
    rules: [
      { id: 'claim', cmd: 'task.claim', claimTask: { panel: 'panels.taskGoal' } },
      { id: 'assist', cmd: 'newforge.upgradePart', taskAssist: {
        panel: 'panels.taskGoal', levels: 'panels.newforge.partLevels', costs: 'panels.newforge.partUpgradeCosts', gold: 'view.gold', spareMult: 2 } }
    ]
  });
}
function taskState(goal, gold) {
  return {
    gameTimeSec: 100, view: { gold },
    panels: {
      taskGoal: goal,
      newforge: { partLevels: { a: 2, b: 3, c: 1 }, partUpgradeCosts: { a: 100, b: 400, c: 50 } }
    }
  };
}

test('任務：目前任務達成就領，沒達成不送', () => {
  const p = taskPolicy();
  const done = p.decide(taskState({ done: false, ready: true, type: 'upgradeCount', count: 10, prog: 10 }, 0));
  assert.deepEqual(done.map((c) => c.name), ['task.claim']);
  const not = p.decide(taskState({ done: false, ready: false, type: 'upgradeCount', count: 10, prog: 3 }, 1e9));
  assert.deepEqual(not.map((c) => c.name), [], '還沒達成就不領（遊戲只會回「任務尚未完成」）');
  const all = p.decide(taskState({ done: true, ready: false, type: null }, 1e9));
  assert.deepEqual(all, [], '所有任務都完成了');
});

test('任務順手：升級熔爐零件只在付完仍有 2 倍餘裕時做，且集中升等級最高的', () => {
  const goal = { done: false, ready: false, type: 'forgePartLevel', count: 4, prog: 3 };
  const up = (gold) => taskPolicy().decide(taskState(goal, gold)).filter((c) => c.name === 'newforge.upgradePart').map((c) => c.args.partKey);

  assert.deepEqual(up(1200), ['b'], '1200−400=800 ≥ 2×400：等級最高的 b 可以升');
  assert.deepEqual(up(1199), ['a'], 'b 的餘裕不夠，退到下一個等級最高且付得起的 a（1199−100 ≥ 200）');
  assert.deepEqual(up(120), [], '連最便宜的 c 都沒有 2 倍餘裕（120−50 < 100）——不為任務犧牲練功');
});

test('任務順手：只處理需要額外動作的任務類型', () => {
  const other = { done: false, ready: false, type: 'upgradeCount', count: 30, prog: 3 };
  const cmds = taskPolicy().decide(taskState(other, 1e12));
  assert.deepEqual(cmds, [], '強化次數之類是練功自然會做的事，不為它另外花錢');
});
