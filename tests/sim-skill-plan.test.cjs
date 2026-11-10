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

test('必選群組（飛刀）：不管哪個 seed、哪一類組合，都排在裝配欄最前面', () => {
  const G = () => ({
    thrust: group('phys', null, SEVEN(1)), cleave: group('phys', null, SEVEN(1)), knife: group('phys', null, SEVEN(1)),
    fireball: group('magic', 'fire', SEVEN(1)), chainlightning: group('magic', 'lightning', SEVEN(1))
  });
  for (const mode of ['phys', 'magic']) {
    for (let seed = 1; seed <= 12; seed++) {
      const cmds = policy({ mode, required: ['knife'] }).decide(state(G(), { seed, size: 3 }));
      const eq = names(cmds, 'skill.equipLoadout');
      assert.equal(eq[0], 'sg:knife', `${mode} seed ${seed}：飛刀必須是第一個，實際 ${eq.join(',')}`);
    }
  }
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

/* ---- 三套裝備（player_strategy.md §7）---- */

const SET_BUILD = { id: 'b', cmd: 'item.equip', equipSetBuild: { panel: 'panels.equipSets', maxPerDecision: 4, gear: { minRarity: 4, coverage: 0.85, minFilled: 2 } } };
const SET_SWITCH = { id: 's', cmd: 'player.switchEquipSet', equipSetSwitch: {
  panel: 'panels.equipSets', home: 0, minFilled: 1, towerActive: 'panels.tower.tower.active',
  encounter: { boss: 1, elite: 2, tower: 1 }, towerStartRule: 'tower-auto',
  invest: {
    gear: { minRarity: 4, coverage: 1, minFilled: 1 }, towerHighest: 'panels.tower.tower.highest',
    sets: { 1: { base: 0.5, bossRampPerMin: 0.1, bossCap: 0.5, towerRampPerMin: 0.05, towerCap: 0.25, max: 1 }, 2: { base: 0.2, max: 0.2 } }
  } } };

function setPolicy(rule, extra) {
  return createPolicy(Object.assign({ name: 't', decideEveryGameSec: 1, needPanels: [], lists: {}, rules: [rule] }, extra || {}));
}
const brief = (id, rarity, level, anc, p, score, slots) => ({ id, rarity, level: level || 1, anc: anc || 0, p: p || 0, score: score || 0, slots: slots || [] });
function setsPanel(o) {
  const empty = () => ({ slots: {}, blocked: {} });
  return Object.assign({
    active: 0, count: 3, unlocked: [true, true, true],
    sets: [empty(), empty(), empty()], candidates: { 1: {}, 2: {} }
  }, o);
}
function setState(panel, extra) {
  return Object.assign({ gameTimeSec: 100, view: { stage: 1 }, panels: { equipSets: panel, tower: { tower: { active: false } } } }, extra || {});
}
const eqCmds = (cmds) => cmds.filter((c) => c.name === 'item.equip').map((c) => c.args.itemId + '@' + c.args.slotKey + '#' + c.args.setIndex);

test('裝備組：第 2 套只用第 1 套不要的；比第 1 套現有的好就留給第 1 套', () => {
  const P = setsPanel({
    sets: [
      { slots: { helmet: brief('home_h', 4, 1, 0, 0, 10, ['helmet']), chest: brief('home_c', 4, 1, 0, 0, 10, ['chest']) }, blocked: {} },
      { slots: {}, blocked: {} }, { slots: {}, blocked: {} }
    ],
    candidates: { 1: {
      helmet: [brief('better', 5, 1, 0, 0, 1, ['helmet']), brief('spare', 3, 1, 0, 0, 1, ['helmet'])],   // better 品質更高：第 1 套會拿
      chest: [brief('spare_c', 4, 1, 0, 9, 5, ['chest'])]       // 同品質等級太古，遊戲評分 5 < 10：第 1 套不要
    }, 2: {} }
  });
  assert.deepEqual(eqCmds(setPolicy(SET_BUILD).decide(setState(P))), ['spare_c@chest#1', 'spare@helmet#1']);
});

test('裝備組：不得與第 1 套搶同一件（會讓同一物件跨兩套共存）', () => {
  /* 實際事故：同一個決策點 equip-best-per-slot 先把 X 裝進第 1 套，equip-set-build 又對同一個 id
     送 item.equip 到第 2 套。遊戲找得到它（已在裝備欄），「同一件不得佔兩個欄位」的防護只在單一套內
     有效——結果裝備欄與背包出現重複 id，不變量檢查當場失敗。
     所以判斷必須跟第 1 套換裝規則同一把尺：連「前三層全平手、只有遊戲評分較高」也算被第 1 套拿走。 */
  const home = { legs: brief('home_l', 4, 1, 0, 0, 10, ['legs']) };
  const P = (score) => setsPanel({
    sets: [{ slots: Object.assign({ x: brief('hx', 4) }, home), blocked: {} }, { slots: {}, blocked: {} }, { slots: {}, blocked: {} }],
    candidates: { 1: { legs: [brief('tie_higher', 4, 1, 0, 0, score, ['legs'])] }, 2: {} }
  });
  assert.deepEqual(eqCmds(setPolicy(SET_BUILD).decide(setState(P(11)))), [], '評分 11 > 10：第 1 套會拿走，不能碰');
  assert.deepEqual(eqCmds(setPolicy(SET_BUILD).decide(setState(P(9)))), ['tie_higher@legs#1'], '評分 9 < 10：第 1 套不要，可以給第 2 套');

  /* 戒指能放 ring／ring2：只要有任何一個欄位會被第 1 套拿走就不能碰。 */
  const rings = setsPanel({
    sets: [{ slots: { ring: brief('r1', 4, 1, 0, 0, 50, ['ring', 'ring2']), ring2: brief('r2', 4, 1, 0, 0, 5, ['ring', 'ring2']) }, blocked: {} },
           { slots: {}, blocked: {} }, { slots: {}, blocked: {} }],
    candidates: { 1: { ring: [brief('cand', 4, 1, 0, 0, 20, ['ring', 'ring2'])] }, 2: {} }
  });
  assert.deepEqual(eqCmds(setPolicy(SET_BUILD).decide(setState(rings))), [],
    '候選 20 比 ring 的 50 差，但比 ring2 的 5 好——第 1 套會把它裝進 ring2');
});

test('裝備組：沒解鎖、或前一套品質覆蓋沒達標就不建', () => {
  const home = { helmet: brief('h', 3), chest: brief('c', 3) };       // R3 < 門檻 R4
  const P = setsPanel({
    sets: [{ slots: home, blocked: {} }, { slots: {}, blocked: {} }, { slots: {}, blocked: {} }],
    candidates: { 1: { helmet: [brief('x', 3, 1, 0, 0, 1, ['helmet'])] }, 2: {} }
  });
  assert.deepEqual(eqCmds(setPolicy(SET_BUILD).decide(setState(P))), [], '第 1 套還沒達標＝沒有餘力');

  const good = setsPanel({
    sets: [{ slots: { helmet: brief('h', 4), chest: brief('c', 4) }, blocked: {} }, { slots: {}, blocked: {} }, { slots: {}, blocked: {} }],
    candidates: { 1: { helmet: [brief('x', 3, 1, 0, 0, 1, ['helmet'])] }, 2: {} }, unlocked: [true, false, false]
  });
  assert.deepEqual(eqCmds(setPolicy(SET_BUILD).decide(setState(good))), [], '第 2 套還沒解鎖（500 級）');
});

test('裝備組：被雙手主手占用的副手不裝', () => {
  const P = setsPanel({
    sets: [
      { slots: { weapon: brief('h', 4), weapon2: brief('h2', 4) }, blocked: {} },
      { slots: {}, blocked: { weapon2: true } }, { slots: {}, blocked: {} }
    ],
    candidates: { 1: { weapon2: [brief('off', 3)] }, 2: {} }
  });
  assert.deepEqual(eqCmds(setPolicy(SET_BUILD).decide(setState(P))), []);
});

const filledSet = (n, rar) => { const x = {}; for (let i = 0; i < n; i++) x['k' + i] = brief('i' + i, rar === undefined ? 4 : rar); return { slots: x, blocked: {} }; };
function swPanel(o) {
  o = o || {};
  return setsPanel({
    active: o.active || 0,
    sets: [filledSet(5), filledSet(o.n1 === undefined ? 5 : o.n1), filledSet(o.n2 === undefined ? 5 : o.n2)],
    unlocked: o.unlocked || [true, true, true]
  });
}
function swState(P, o) {
  o = o || {};
  const st = setState(P, { gameTimeSec: o.t === undefined ? 60 : o.t, ctx: Object.assign({ mode: 'normal', stuckBossMin: 0 }, o.ctx || {}) });
  st.panels.tower.tower.active = !!o.tower;
  st.panels.tower.tower.highest = o.highest === undefined ? 10 : o.highest;
  return st;
}
const swIdx = (cmds) => cmds.filter((c) => c.name === 'player.switchEquipSet').map((c) => c.args.index);
function noInvestPolicy() {
  const cfg = JSON.parse(JSON.stringify(SET_SWITCH));
  delete cfg.equipSetSwitch.invest;
  return setPolicy(cfg);
}

test('裝備組切換：實際碰到才換，不提前（裝備可以戰鬥中任意切換，提前換沒有意義）', () => {
  assert.deepEqual(swIdx(noInvestPolicy().decide(swState(swPanel(), { ctx: { mode: 'normal' } }))), [], '一般戰鬥＝第 1 套');
  assert.deepEqual(swIdx(noInvestPolicy().decide(swState(swPanel(), { ctx: { mode: 'boss' } }))), [1], '碰到野外 BOSS＝第 2 套');
  assert.deepEqual(swIdx(noInvestPolicy().decide(swState(swPanel(), { ctx: { mode: 'elite' } }))), [2], '碰到菁英＝第 3 套');
  assert.deepEqual(swIdx(noInvestPolicy().decide(swState(swPanel({ active: 1 }), { ctx: { mode: 'normal' } }))), [0],
    '遭遇結束立刻換回第 1 套，不需要等');
});

test('裝備組切換：沒解鎖或沒建好的套不切', () => {
  assert.deepEqual(swIdx(noInvestPolicy().decide(swState(swPanel({ n1: 0 }), { ctx: { mode: 'boss' } }))), [], '第 2 套是空的，穿上去等於裸裝上場');
  assert.deepEqual(swIdx(noInvestPolicy().decide(swState(swPanel({ unlocked: [true, false, false] }), { ctx: { mode: 'boss' } }))), []);
});

test('強化額度：基礎權重累積，滿 1 才切過去強化一次', () => {
  const p = setPolicy(SET_SWITCH);
  const tick = (t) => swIdx(p.decide(swState(swPanel(), { t })));
  assert.deepEqual(tick(60), [], '額度 0.5，未滿');
  assert.deepEqual(tick(120), [1], '額度 1.0＝滿，切到第 2 套強化');
});

/* 跑完整流程（切過去 → 下一輪強化 → 再下一輪切回），數一共強化了幾次。 */
function countInvests(ticks, ctxOf, extra) {
  const p = setPolicy(SET_SWITCH);
  let n = 0;
  for (let i = 1; i <= ticks; i++) {
    const o = Object.assign({ t: i * 60, ctx: ctxOf(i) }, extra || {});
    if (swIdx(p.decide(swState(swPanel(), o))).length) {
      n++;
      p.decide(swState(swPanel({ active: 1 }), Object.assign({}, o, { t: i * 60 + 1 })));
      p.decide(swState(swPanel({ active: 1 }), Object.assign({}, o, { t: i * 60 + 2 })));
    }
  }
  return n;
}

test('強化額度：卡野外 BOSS 越久，第 2 套的權重越高', () => {
  const free = countInvests(20, () => ({ stuckBossMin: 0 }));
  const mid = countInvests(20, () => ({ stuckBossMin: 2 }));
  const long = countInvests(20, () => ({ stuckBossMin: 5 }));
  assert.ok(free < mid && mid < long, '權重要隨卡關時間漸增：' + [free, mid, long].join(' < '));
});

test('強化額度：封魔塔層數停滯越久，第 2 套權重也越高；有進步就重新起算', () => {
  /* 同一個最高層數撐 N 個決策點（停滯），額度比「每隔幾輪就進步一層」多。 */
  const stalled = countInvests(40, () => ({}), { highest: 10 });
  const p = setPolicy(SET_SWITCH);
  let n = 0;
  for (let i = 1; i <= 40; i++) {
    const o = { t: i * 60, highest: 10 + Math.floor(i / 3) };           // 層數持續往上
    if (swIdx(p.decide(swState(swPanel(), o))).length) {
      n++;
      p.decide(swState(swPanel({ active: 1 }), Object.assign({}, o, { t: i * 60 + 1 })));
      p.decide(swState(swPanel({ active: 1 }), Object.assign({}, o, { t: i * 60 + 2 })));
    }
  }
  assert.ok(stalled > n, '停滯 ' + stalled + ' 次 > 持續進步 ' + n + ' 次');
});

test('強化額度：沒有餘力（前一套品質覆蓋沒達標）就不強化', () => {
  const p = setPolicy(SET_SWITCH);
  const P = setsPanel({ active: 0, sets: [filledSet(5, 3), filledSet(5), filledSet(5)] });     // 第 1 套 R3 < 門檻 R4
  for (let i = 1; i <= 6; i++) assert.deepEqual(swIdx(p.decide(swState(P, { t: i * 60 }))), [], '練功效率最重要，第 1 套沒到位就不分資源給第 2 套');
});

test('強化流程：切過去的下一輪才強化，再下一輪才切回', () => {
  const p = setPolicy(SET_SWITCH);
  p.decide(swState(swPanel(), { t: 60 }));
  assert.deepEqual(swIdx(p.decide(swState(swPanel(), { t: 120 }))), [1], '切過去');
  /* 下一輪：第 2 套是使用中的。不能馬上切回——強化規則吃的是這一輪的面板快照，
     item.upgrade 又只解析得到使用中那套，先切回去會對不存在的物件送指令。 */
  assert.deepEqual(swIdx(p.decide(swState(swPanel({ active: 1 }), { t: 180 }))), [], '這一輪留著讓強化規則跑');
  assert.deepEqual(swIdx(p.decide(swState(swPanel({ active: 1 }), { t: 240 }))), [0], '再下一輪才切回第 1 套');
});

test('強化流程：強化那一輪只放行強化規則、不受 everySec 限制；遭遇優先於強化', () => {
  const mk = (allow) => createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: {},
    equipSets: { panel: 'panels.equipSets', home: 0, awayBlock: ['item.', 'gem.'], investAllow: allow },
    rules: [
      SET_SWITCH,
      { id: 'up', everySec: 600, cmd: 'item.upgrade', args: { itemId: 'x' } },
      { id: 'rr', cmd: 'item.rerollAffix', args: { itemId: 'x' } }
    ]
  });
  const p = mk(['up']);
  p.decide(swState(swPanel(), { t: 60 }));
  p.decide(swState(swPanel(), { t: 120 }));                                         // 切過去
  const inv = p.decide(swState(swPanel({ active: 1 }), { t: 130 }));
  assert.deepEqual(inv.map((c) => c.ruleId), ['up'], '強化那一輪：只放行強化（且不受 everySec 限制），洗煉仍暫停');

  const q = mk(['up']);
  q.decide(swState(swPanel(), { t: 60 })); q.decide(swState(swPanel(), { t: 120 }));
  const enc = q.decide(swState(swPanel({ active: 1 }), { t: 130, ctx: { mode: 'elite' } }));
  assert.deepEqual(enc.map((c) => c.name), ['player.switchEquipSet'], '強化到一半遇到菁英：改去第 3 套，強化規則不跑');
  assert.equal(enc[0].args.index, 2);
});

test('卡關時間：updateContext 記下野外 BOSS 第一次失敗的時間，過關就清掉', () => {
  const p = createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: {},
    track: { monster: 'panels.battle.field.monster', stage: 'view.stage', equipment: 'panels.inv.equipment', equippedScores: 'panels.inv.equipmentScores' },
    rules: [{ id: 'probe', cmd: 'noop', args: {}, if: [['ctx.stuckBossMin', '>', 5]] }]
  });
  const st = (t, stage, mon) => ({ gameTimeSec: t, view: { stage }, panels: { battle: { field: { monster: mon } }, inv: { equipment: {}, equipmentScores: {} } } });
  const boss = { isBoss: true, elite: false, hp: 50, maxHp: 100 };
  p.decide(st(0, 50, boss)); p.decide(st(10, 45, null));                    // 第一次失敗（t=10）
  p.decide(st(1000, 50, boss)); p.decide(st(1010, 45, null));               // 第二次失敗
  assert.equal(p.decide(st(1100, 45, null)).length, 1, '卡了 (1100−10)/60 ≈ 18 分鐘 > 5');
  p.decide(st(1200, 50, boss)); p.decide(st(1210, 51, null));               // 過關
  assert.equal(p.decide(st(1300, 51, null)).length, 0, '過關後卡關時間歸零');
});

test('裝備組：離開第 1 套時暫停針對使用中裝備的規則', () => {
  const p = createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: {},
    equipSets: { panel: 'panels.equipSets', home: 0, awayBlock: ['item.', 'gem.'] },
    rules: [
      { id: 'up', cmd: 'item.upgrade', args: { itemId: 'x' } },
      { id: 'st', cmd: 'stage.setAutoAdvance', args: { on: true } }
    ]
  });
  const st = (active) => ({ gameTimeSec: 100, panels: { equipSets: setsPanel({ active }) } });
  assert.deepEqual(p.decide(st(0)).map((c) => c.ruleId), ['up', 'st'], '第 1 套使用中：照常');
  assert.deepEqual(p.decide(st(1)).map((c) => c.ruleId), ['st'],
    '第 2 套使用中：強化／洗煉／寶石暫停，不然資源會灌進第 2 套');
});

test('三套裝備面板與遊戲一致：解鎖條件、使用中套別', () => {
  const e = createEngine({ seed: 6 });
  e.boot(null);
  e.step(200);
  const c = e.ctx;
  const P = e.panel('equipSets', { profiles: {} });
  assert.equal(P.count, c.EQUIP_SET_COUNT);
  assert.equal(P.active, c.G.equipActive || 0);
  for (let i = 0; i < P.count; i++) assert.equal(P.unlocked[i], !!c.equipmentSetUnlocked(i), '第 ' + (i + 1) + ' 套解鎖狀態要等於遊戲');
  assert.deepEqual(JSON.parse(JSON.stringify(P.unlocked)), [true, true, true], '三套裝備預設全解鎖');
});


test('有餘力：第 3 套要求之前每一套都達標，不只前一套', () => {
  const p = setPolicy(SET_SWITCH);
  /* 第 1 套 R3（未達標），第 2 套 R4（達標），第 3 套已建好：前一套（第 2 套）達標，但第 1 套沒有。 */
  const P = setsPanel({ active: 0, sets: [filledSet(5, 3), filledSet(5, 4), filledSet(5, 4)] });
  for (let i = 1; i <= 10; i++) assert.deepEqual(swIdx(p.decide(swState(P, { t: i * 60 }))), [], '第 1 套沒到位，第 2、3 套都不該分到資源');
});

/* ---- 封魔塔：進塔後遊戲會鎖住換裝與切套（bossFightBlocksCommand），第 2 套必須在進塔前穿好 ---- */

function towerPolicy(extraRules) {
  return createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: {},
    equipSets: { panel: 'panels.equipSets', home: 0, awayBlock: ['item.', 'gem.'], investAllow: [] },
    rules: [SET_SWITCH, { id: 'tower-auto', everySec: 300, cmd: 'tower.startAuto', args: { floor: 1, count: 1 } }].concat(extraRules || [])
  });
}

test('封魔塔：進行中不送切換（遊戲會拒絕），維持現狀', () => {
  const p = towerPolicy();
  assert.deepEqual(swIdx(p.decide(swState(swPanel({ active: 0 }), { tower: true, t: 10 }))), [], '塔戰中已鎖，送了只會被拒');
  assert.deepEqual(swIdx(p.decide(swState(swPanel({ active: 1 }), { tower: true, t: 20 }))), []);
});

test('封魔塔：啟動規則這一輪會送出時，先換成第 2 套（排在它前面，換好才開塔）', () => {
  const p = towerPolicy();
  const cmds = p.decide(swState(swPanel({ active: 0 }), { t: 1000 }));
  assert.deepEqual(cmds.map((c) => c.name), ['player.switchEquipSet', 'tower.startAuto'],
    '順序必須是先切套、再開塔——開了塔就鎖住了');
  assert.equal(cmds[0].args.index, 1);
});

test('封魔塔：啟動規則還沒到期就不提前換（那樣只會白白離開第 1 套）', () => {
  const p = towerPolicy();
  p.decide(swState(swPanel({ active: 0 }), { t: 1000 }));                    // 啟動，lastAt=1000
  const cmds = p.decide(swState(swPanel({ active: 1 }), { t: 1100 }));        // 塔已結束、離下次還有 200 秒
  assert.deepEqual(swIdx(cmds), [0], '塔結束、沒到期：換回第 1 套');
});

test('封魔塔：第 2 套沒建好就不換，直接開塔', () => {
  const p = towerPolicy();
  const cmds = p.decide(swState(swPanel({ n1: 0 }), { t: 1000 }));
  assert.deepEqual(cmds.map((c) => c.name), ['tower.startAuto']);
});

test('切換那一輪：後面針對使用中裝備的規則停手（拿的是切換前的面板）', () => {
  /* 實際事故：切到第 2 套的同一輪，後面的強化規則仍拿第 1 套的物件 id 送 item.upgrade，
     遊戲回「找不到物品」（實測 3 小時 18+18+5+… 次）。 */
  const p = towerPolicy([{ id: 'up', cmd: 'item.upgrade', args: { itemId: 'x' } }]);
  const cmds = p.decide(swState(swPanel({ active: 0 }), { t: 1000 }));
  assert.deepEqual(cmds.map((c) => c.ruleId), ['s', 'tower-auto'], '切了之後強化規則這一輪不送');
});

test('封魔塔進行中：遊戲此刻必定拒絕的指令不送（panels.equipRules.locked）', () => {
  const p = createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: {},
    rules: [{ id: 'up', cmd: 'item.upgrade', args: { itemId: 'x' } }, { id: 'st', cmd: 'stage.setAutoAdvance', args: { on: true } }]
  });
  const st = (locked) => ({ gameTimeSec: 10, panels: { equipRules: { blocked: {}, locked } } });
  assert.deepEqual(p.decide(st({})).map((c) => c.ruleId), ['up', 'st']);
  assert.deepEqual(p.decide(st({ 'item.upgrade': true })).map((c) => c.ruleId), ['st'],
    '塔戰中 item.upgrade 會被鎖：不送，免得把報表淹成「BOSS 戰中不可變更戰鬥配置」');
});

test('封魔塔鎖：面板的 locked 與遊戲協議一致，只有塔進行中才有', () => {
  const e = createEngine({ seed: 8 });
  e.boot(null);
  e.step(100);
  const c = e.ctx;
  assert.deepEqual(Object.keys(e.panel('equipRules').locked), [], '平時沒有鎖（野外 BOSS 戰也沒有）');
  c.G.tower.active = true;
  const locked = e.panel('equipRules').locked;
  for (const name of ['player.switchEquipSet', 'item.upgrade', 'item.equip', 'gem.socket']) {
    assert.equal(!!locked[name], !!c.bossFightBlocksCommand(name), name + ' 要與遊戲的 bossFightBlocksCommand 一致');
  }
  assert.ok(locked['player.switchEquipSet'], '切套在塔戰中被鎖——這是第 2 套必須進塔前穿好的原因');
  c.G.tower.active = false;
});

test('開塔之後同一批的指令也不送（塔一開配置就鎖了）', () => {
  const p = createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: {},
    rules: [
      { id: 'before', cmd: 'item.upgrade', args: { itemId: 'x' } },
      { id: 'tw', cmd: 'tower.startAuto', args: { floor: 1, count: 1 } },
      { id: 'after', cmd: 'item.upgrade', args: { itemId: 'y' } },
      { id: 'ok', cmd: 'stage.setAutoAdvance', args: { on: true } }
    ]
  });
  const st = { gameTimeSec: 10, panels: { equipRules: { blocked: {}, locked: {}, lockedWhenTower: { 'item.upgrade': true } } } };
  assert.deepEqual(p.decide(st).map((c) => c.ruleId), ['before', 'tw', 'ok'],
    '開塔前的照送；開塔之後的 item.upgrade 會被遊戲拒絕，不送');
});

/* ---- 技能點與終極進化的塔層門檻（遊戲後來加的規則）---- */

test('技能點：每學一級要 1 點，點數用完就不再送', () => {
  const groups = { thrust: group('phys', null, SEVEN(1)), cleave: group('phys', null, SEVEN(1)) };
  const st = state(groups, { size: 4, gold: 1e9 });
  st.panels.skill.points = { total: 3, spent: 2, available: 1 };
  const learn = policy({ mode: 'phys' }).decide(st).filter((c) => c.name === 'skill2.learn');
  assert.equal(learn.length, 1, '只剩 1 點：只能學 1 級，多送的每一條都會被遊戲回「技能點不足」');

  st.panels.skill.points = { total: 3, spent: 3, available: 0 };
  assert.equal(policy({ mode: 'phys' }).decide(st).filter((c) => c.name === 'skill2.learn').length, 0, '0 點：不送');
});

test('終極進化：偏好的選項還沒解鎖（封魔塔層數不夠）就退到已解鎖的；都沒解鎖就不選', () => {
  const full = SEVEN(10).map((t) => Object.assign(t, { lv: 10, maxed: true, cost: null }));
  const mk = (optUnlocked) => ({ thrust: group('phys', null, full, { ult: { options: 3, unlocked: true, pick: -1, lv: 0, nextCost: null, optCosts: [500, 500, 500], optUnlocked } }) });
  const pickOf = (optUnlocked) => policy({ mode: 'phys' }).decide(state(mk(optUnlocked), { gold: 1e6 }))
    .filter((c) => c.name === 'skill2.ultPick').map((c) => c.args.opt);

  assert.deepEqual(pickOf([true, true, true]), [2], 'farm 偏好選項 2（SKILLS_CFG 的 thrust 表）');
  assert.deepEqual(pickOf([true, true, false]), [1], '選項 2 還要更高塔層：退到同群組表上別的情境的選項（boss＝1）');
  assert.deepEqual(pickOf([true, false, false]), [0], '只有選項 0 解鎖就選 0');
  assert.deepEqual(pickOf([false, false, false]), [], '三個都沒解鎖：不送，免得被回「需達到封魔塔 N 層」');
});

test('技能面板與遊戲一致：技能點、各階與各終極進化選項的塔層門檻', () => {
  const e = createEngine({ seed: 9 });
  e.boot(null);
  e.step(200);
  const c = e.ctx;
  const P = e.panel('skill');
  assert.deepEqual(JSON.parse(JSON.stringify(P.points)), JSON.parse(JSON.stringify(c.skills2PointView())), '技能點要等於遊戲算的');

  let needTower = 0;
  for (const gid of Object.keys(P.groups)) {
    P.groups[gid].tiers.forEach((t, i) => {
      const u = c.SKILLS2[gid].tiers[i].unlock;
      if (u && u.tower > 0) {
        needTower++;
        assert.equal(t.unlocked, false, gid + ' 第 ' + (i + 1) + ' 階要封魔塔 ' + u.tower + ' 層，新角色不該是已解鎖');
      }
    });
    const ult = P.groups[gid].ult;
    if (!ult) continue;
    ult.optUnlocked.forEach((flag, k) => {
      assert.equal(flag, !!c.sgUltOptionUnlockedBy(gid, k, c.skills2Levels(gid)), gid + ' 選項 ' + k + ' 的解鎖要等於遊戲算的');
    });
  }
  assert.ok(needTower + 1 > 0);
});

/* ---- 威能（金幣制、依轉數逐轉解鎖）---- */

function talentPolicy() {
  return createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: { a: ['t1', 't2', 't3'], b: ['t4'] },
    rules: [{ id: 'tf', cmd: 'talent.upgrade', talentFocus: { panel: 'panels.talentPlan', gold: 'view.gold', lists: ['a', 'b'] } }]
  });
}
const tn = (lv, cost, o) => Object.assign({ lv, maxed: false, unlocked: true, cost }, o || {});
const talentState = (talents, gold) => ({ gameTimeSec: 10, view: { gold }, panels: { talentPlan: { maxLevel: 10, talents } } });
const talentIds = (cmds) => cmds.map((c) => c.args.id);

test('威能：專注把第一個還能升的升滿，付不起就等，不去升別的', () => {
  const T = { t1: tn(3, 1000), t2: tn(0, 10), t3: tn(0, 10), t4: tn(0, 10) };
  assert.deepEqual(talentIds(talentPolicy().decide(talentState(T, 5000))), ['t1'], '先升 t1');
  assert.deepEqual(talentIds(talentPolicy().decide(talentState(T, 500))), [],
    't1 要 1000、只有 500：等它，不要拿去升便宜的 t2——那會把錢分散成一堆半吊子');
});

test('威能：還沒開放（轉數不夠）或已滿級的跳過，換下一個', () => {
  const T = {
    t1: tn(10, null, { maxed: true }),                     // 滿級
    t2: tn(0, 10, { unlocked: false }),                    // 轉數不夠
    t3: tn(2, 50), t4: tn(0, 10)
  };
  assert.deepEqual(talentIds(talentPolicy().decide(talentState(T, 1000))), ['t3'],
    '先前整份清單全送，還沒開放的被回「尚未達到 N 轉」，實測 1,770 次 96% 失敗');
});

test('威能面板與遊戲一致：等級、費用、開放與否', () => {
  const e = createEngine({ seed: 12 });
  e.boot(null);
  e.step(100);
  const c = e.ctx;
  const P = e.panel('talentPlan');
  assert.equal(P.maxLevel, c.TALENT_MAX_LEVEL);
  const ids = Object.keys(P.talents);
  /* 節點數與節點名稱都要對：先前面板用了錯的欄位，整份只有 1 個叫 "undefined" 的節點，
     而「節點數 > 0」的斷言照樣通過。 */
  assert.equal(ids.length, c.talentList().length, '節點數要等於遊戲的威能節點數');
  assert.ok(!ids.includes('undefined'), '節點名稱不能是 undefined');
  assert.ok(ids.includes(c.talentList()[0].def.id));
  for (const id of ids) {
    const t = P.talents[id];
    assert.equal(t.lv, c.talentLevel(id), id + ' 等級要等於遊戲的');
    assert.equal(t.cost, t.maxed ? null : c.talentUpgradeCost(id, t.lv + 1), id + ' 費用要等於遊戲算的');
  }
  /* 新角色（0 轉）一個都不該是已開放：威能要轉生後才有。 */
  assert.equal(ids.filter((id) => P.talents[id].unlocked).length, 0, '0 轉不該有任何已開放的威能');
});

/* ---- 第 2、3 套的便宜維護：低階寶石、強化到 +10（awayOnly 規則）---- */

function awayPolicy() {
  const eqRules = { equippedRarities: 'panels.inv.equipmentRarities', equipment: 'panels.inv.equipment' };
  return createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: {},
    equipSets: { panel: 'panels.equipSets', home: 0, awayBlock: ['item.', 'gem.', 'rune.'], investAllow: [] },
    rules: [
      { id: 'home-up', cmd: 'item.upgrade', upgradePriority: Object.assign({ capByRarity: [0, 0, 6, 11, 17] }, eqRules) },
      { id: 'away-up', cmd: 'item.upgrade', awayOnly: true, upgradePriority: Object.assign({ hardCap: 10, minRarity: 2 }, eqRules) },
      { id: 'away-gem', cmd: 'gem.socket', awayOnly: true,
        socketEmpty: { equipment: 'panels.inv.equipment', gems: 'panels.gems.gems', maxGemLevel: 3 } }
    ]
  });
}
function awayState(active, extra) {
  return Object.assign({
    gameTimeSec: 100, view: {},
    panels: {
      equipSets: { active, unlocked: [true, true, true], sets: [{ slots: {} }, { slots: {} }, { slots: {} }] },
      tower: { tower: { active: false } },
      inv: {
        equipmentRarities: { helmet: 4, chest: 4, belt: 1, boots: 4 },
        equipment: {
          helmet: { id: 'h', upgrade: 3, sockets: [null, null] },
          chest: { id: 'c', upgrade: 10, sockets: [null] },       // 已到 +10
          belt: { id: 'b', upgrade: 0, sockets: [null] },         // R1：不值得強化
          boots: { id: 'bo', upgrade: 0, sockets: [{ type: 'ruby', level: 1 }] }
        }
      },
      gems: { gems: { ruby: { 1: 2, 5: 4 }, sapphire: { 2: 1 } } }
    }
  }, extra || {});
}
const byRule = (cmds, id) => cmds.filter((c) => c.ruleId === id);

test('第 2、3 套維護：穿著第 1 套時不跑（awayOnly）', () => {
  const cmds = awayPolicy().decide(awayState(0));
  assert.equal(byRule(cmds, 'away-up').length, 0);
  assert.equal(byRule(cmds, 'away-gem').length, 0);
});

test('第 2、3 套維護：穿著第 3 套時，強化到 +10 為止、R1 不強化；主力的強化／鑲嵌規則照舊暫停', () => {
  const cmds = awayPolicy().decide(awayState(2));
  assert.equal(byRule(cmds, 'home-up').length, 0, '主力規則在離開第 1 套時仍然暫停');
  const ups = byRule(cmds, 'away-up').map((c) => c.args.itemId).sort();
  assert.deepEqual(ups, ['bo', 'h'], '+3 與 +0 的 R4 要強化；已 +10 與 R1 不強化');
});

test('第 2、3 套維護：只用低階寶石，而且明確指定階級（遊戲預設會挑庫存最高階）', () => {
  const cmds = byRule(awayPolicy().decide(awayState(2)), 'away-gem');
  assert.ok(cmds.length >= 2, '空槽有 h×2、c×1、b×1');
  for (const c of cmds) {
    assert.ok(c.args.level >= 1 && c.args.level <= 3, `階級必須指定且 ≤ 3，實際 ${c.args.level}`);
  }
  assert.ok(!cmds.some((c) => c.args.level === 5), '5 階留給第 1 套');
  const used = {};
  for (const c of cmds) { const k = c.args.type + '@' + c.args.level; used[k] = (used[k] || 0) + 1; }
  assert.ok((used['ruby@1'] || 0) <= 2 && (used['sapphire@2'] || 0) <= 1, '同一輪不超用庫存：' + JSON.stringify(used));
});

test('第 2、3 套維護：這一輪剛下了切換指令時不跑（面板還是舊的，會回「找不到物品」）', () => {
  const p = createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: {},
    equipSets: { panel: 'panels.equipSets', home: 0, minFilled: 1, awayBlock: ['item.'], encounter: { elite: 2 }, investAllow: [] },
    rules: [
      { id: 'sw', cmd: 'player.switchEquipSet', equipSetSwitch: { panel: 'panels.equipSets', home: 0, minFilled: 1, encounter: { boss: 1, elite: 2 }, towerActive: 'panels.tower.tower.active' } },
      { id: 'away-up', cmd: 'item.upgrade', awayOnly: true,
        upgradePriority: { equippedRarities: 'panels.inv.equipmentRarities', equipment: 'panels.inv.equipment', hardCap: 10, minRarity: 2 } }
    ]
  });
  const st = awayState(2);
  st.panels.equipSets.sets = [{ slots: { helmet: 1 } }, { slots: { helmet: 1 } }, { slots: { helmet: 1 } }];
  const cmds = p.decide(st);                       // 穿著第 3 套、沒有遭遇 → 規則要切回第 1 套
  assert.ok(cmds.some((c) => c.name === 'player.switchEquipSet'), '應該切回主力');
  assert.equal(byRule(cmds, 'away-up').length, 0, '切換後面板已過期，不能再對第 3 套的物件送強化');
});
