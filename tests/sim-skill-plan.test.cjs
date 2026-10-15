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

/* ---- 三套裝備（player_strategy.md §7）---- */

const SET_BUILD = { id: 'b', cmd: 'item.equip', equipSetBuild: { panel: 'panels.equipSets', maxPerDecision: 4, gear: { minRarity: 4, coverage: 0.85, minFilled: 2 } } };
const SET_SWITCH = { id: 's', cmd: 'player.switchEquipSet', equipSetSwitch: {
  panel: 'panels.equipSets', stage: 'view.stage', towerActive: 'panels.tower.tower.active', home: 0, minFilled: 1,
  tower: { set: 1 }, boss: { every: 50, ahead: 3, set: 1 }, elite: { every: 10, ahead: 3, set: 2 } } };

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

function switchTo(stage, o) {
  o = o || {};
  const filled = (n) => { const s = {}; for (let i = 0; i < n; i++) s['k' + i] = brief('i' + i, 4); return { slots: s, blocked: {} }; };
  const P = setsPanel({ active: o.active || 0, sets: [filled(5), filled(o.filled1 === undefined ? 5 : o.filled1), filled(5)], unlocked: o.unlocked || [true, true, true] });
  const st = setState(P, { view: { stage }, ctx: { pushing: o.pushing !== false } });
  if (o.tower) st.panels.tower.tower.active = true;
  const pol = setPolicy(SET_SWITCH);
  let cmds = pol.decide(st);
  if (!cmds.length && !o.once) cmds = pol.decide(Object.assign({}, st, { gameTimeSec: st.gameTimeSec + 60 }));   // 遲滯：連續第二個決策點才換
  return cmds.length ? cmds[0].args.index : (o.active || 0);
}

test('裝備組切換：推關時在抵達菁英／BOSS 關之前先換好', () => {
  assert.equal(switchTo(25), 0, '離菁英關還遠＝第 1 套');
  assert.equal(switchTo(30), 2, '30 關本身就是菁英關');
  assert.equal(switchTo(37), 2, '37 關：離 40 關菁英只剩 3 關＝第 3 套');
  assert.equal(switchTo(40), 2, '菁英關當下');
  assert.equal(switchTo(41), 0, '過了菁英關換回第 1 套');
  assert.equal(switchTo(47), 1, '47 關：離 50 關 BOSS 只剩 3 關＝第 2 套（BOSS 優先於菁英）');
  assert.equal(switchTo(50), 1);
});

test('裝備組切換：掛機（沒在推關）一律第 1 套；封魔塔用第 2 套', () => {
  assert.equal(switchTo(59, { pushing: false, active: 2 }), 0, '安全區間 51~59 剛好落在菁英窗口，但沒在推關就不該換');
  assert.equal(switchTo(30, { tower: true }), 1, '封魔塔＝第 2 套');
});

test('裝備組切換：沒建好或沒解鎖的套不切', () => {
  assert.equal(switchTo(47, { filled1: 0 }), 0, '第 2 套是空的，穿上去等於裸裝上場');
  assert.equal(switchTo(47, { unlocked: [true, false, false] }), 0);
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
  assert.deepEqual(JSON.parse(JSON.stringify(P.unlocked)), [true, false, false], '新角色只有第 1 套（第 2 套 500 級、第 3 套 500 級＋1 轉）');
});

test('裝備組切換：遲滯——單一決策點想換不動，連續兩個才換；換回第 1 套立刻', () => {
  const filled = () => { const x = {}; for (let i = 0; i < 5; i++) x['k' + i] = brief('i' + i, 4); return { slots: x, blocked: {} }; };
  const P = (active) => setsPanel({ active, sets: [filled(), filled(), filled()] });
  const pol = setPolicy(SET_SWITCH);
  const at = (t, stage, active, pushing) => pol.decide(setState(P(active), { gameTimeSec: t, view: { stage }, ctx: { pushing } }));

  assert.deepEqual(at(60, 47, 0, true), [], '第一個決策點：還不換（可能只是掛機邏輯抖了一下）');
  assert.equal(at(120, 47, 0, true)[0].args.index, 1, '連續第二個才換');
  assert.equal(at(180, 30, 1, false)[0].args.index, 0, '回第 1 套不用等');
  at(240, 47, 0, true);                                               // streak=1
  at(300, 30, 0, false);                                              // 中斷，歸零
  assert.deepEqual(at(360, 47, 0, true), [], '中途斷過就要重新累計，不是累計總次數');
});
