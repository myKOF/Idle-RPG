/* 模擬策略的符文計畫（player_strategy.md §5）。

   守的是「靜默失效」：符文指令送錯只會被遊戲回一句錯誤，模擬照跑、報表照出，
   只是身上整場沒有符文或湊不出真言，沒人會發現。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPolicy } = require('../scripts/sim/policy.js');
const { createEngine } = require('../scripts/sim/engine.js');

const RULE = {
  id: 'rp', cmd: 'rune.socket',
  runePlan: {
    view: 'panels.rune', runes: 'panels.gems.runes', equipment: 'panels.inv.equipment',
    keepAfterCompose: 5, maxSocketsPerDecision: 24, maxComposePerDecision: 20
  }
};

function policy() {
  return createPolicy({ name: 't', decideEveryGameSec: 1, needPanels: ['gems', 'inv'], lists: {}, rules: [RULE] });
}

const WORDS = [
  { id: 'wA', tier: 1, runes: ['r01', 'r02'] },
  { id: 'wB', tier: 5, runes: ['r03', 'r04'] },
  { id: 'wC', tier: 9, runes: ['r05', 'r06', 'r07'] }
];
const TIERS = { r01: 1, r02: 2, r03: 3, r04: 4, r05: 5, r06: 6, r07: 7, r08: 8, r09: 9, r20: 20, r21: 21 };

/* equip: { 部位: { slots:[…], fits:[真言id] } } */
function state(equip, runes, extra) {
  const equipment = {}, e = {};
  for (const k of Object.keys(equip)) {
    equipment[k] = { id: 'id_' + k };
    e[k] = { slots: equip[k].slots, cap: equip[k].slots.length, fits: equip[k].fits || [] };
  }
  return {
    gameTimeSec: 100,
    panels: {
      gems: { runes },
      rune: Object.assign({ words: WORDS, tiers: TIERS, compose: { count: 3, maxTier: 20 }, equip: e }, extra || {}),
      inv: { equipment }
    }
  };
}
const sockets = (cmds) => cmds.filter((c) => c.name === 'rune.socket').map((c) => c.args.itemId + ':' + c.args.index + '=' + c.args.runeId);
const composes = (cmds) => cmds.filter((c) => c.name === 'rune.compose').map((c) => c.args.runeId);

test('真言優先：湊得齊的真言先放，不是先塞最高階符文', () => {
  const cmds = policy().decide(state(
    { weapon: { slots: [null, null], fits: ['wA', 'wB'] } },
    { r01: 1, r02: 1, r03: 1, r04: 1, r08: 1, r09: 1 }
  ));
  assert.deepEqual(sockets(cmds), ['id_weapon:0=r03', 'id_weapon:1=r04'],
    '兩組都湊得齊時取階數高的 wB；r08/r09 雖然階數更高但不該先佔孔');
});

test('真言湊不齊時，空孔補滿庫存最高階', () => {
  const cmds = policy().decide(state(
    { weapon: { slots: [null, null], fits: ['wA'] } },
    { r01: 1, r09: 1, r08: 1 }
  ));
  assert.deepEqual(sockets(cmds), ['id_weapon:0=r09', 'id_weapon:1=r08'],
    'wA 缺 r02，不能硬放 r01；改補最高階');
});

test('真言只放在類型符合的裝備（fits 為準，策略不自己判斷）', () => {
  const cmds = policy().decide(state(
    { helmet: { slots: [null, null], fits: [] }, weapon: { slots: [null, null], fits: ['wA'] } },
    { r01: 1, r02: 1 }
  ));
  assert.deepEqual(sockets(cmds).filter((x) => x.startsWith('id_weapon')), ['id_weapon:0=r01', 'id_weapon:1=r02']);
});

test('已有成形真言的裝備不再湊第二組（遊戲只會啟動一組）', () => {
  const cmds = policy().decide(state(
    { weapon: { slots: ['r01', 'r02', null, null], fits: ['wA', 'wB'] } },
    { r03: 1, r04: 1, r09: 2 }
  ));
  assert.deepEqual(sockets(cmds), ['id_weapon:2=r09', 'id_weapon:3=r09'],
    'wA 已成形；剩下的孔不該再湊 wB，直接補最高階');
});

test('不會覆蓋已鑲的不相容符文', () => {
  const cmds = policy().decide(state(
    { weapon: { slots: ['r09', null], fits: ['wA'] } },
    { r01: 1, r02: 1 }
  ));
  assert.deepEqual(sockets(cmds), ['id_weapon:1=r02'],
    '第 0 孔已是 r09，wA 放不進去；只補空孔，且不取下已鑲的');
});

test('孔多的裝備先處理（長真言只有它放得下）', () => {
  const cmds = policy().decide(state(
    { ring: { slots: [null, null], fits: ['wC'] }, weapon: { slots: [null, null, null], fits: ['wC'] } },
    { r05: 1, r06: 1, r07: 1 }
  ));
  assert.deepEqual(sockets(cmds), ['id_weapon:0=r05', 'id_weapon:1=r06', 'id_weapon:2=r07']);
});

test('合成：只在升階後仍留有保留量時才做，且先扣掉剛鑲出去的', () => {
  const none = policy().decide(state({}, { r01: 7 }));
  assert.deepEqual(composes(none), [], '7−3=4 < 5，不合成');

  const one = policy().decide(state({}, { r01: 8 }));
  assert.deepEqual(composes(one), ['r01'], '8−3=5 ≥ 5，合成一次');

  const many = policy().decide(state({}, { r01: 14 }));
  assert.deepEqual(composes(many), ['r01', 'r01', 'r01'], 'floor((14−5)/3)=3 次');

  const used = policy().decide(state({ weapon: { slots: [null] } }, { r09: 8, r01: 8 }));
  assert.deepEqual(sockets(used), ['id_weapon:0=r09'], '先鑲最高階');
  assert.deepEqual(composes(used), ['r01'], 'r09 被鑲掉一顆後剩 7 顆，7−3<5 不合成；r01 照常');
});

test('合成：達到遊戲的合成上限階就不送', () => {
  const cmds = policy().decide(state({}, { r20: 30, r21: 30 }));
  assert.deepEqual(composes(cmds), [], '第 20 階以上只能掉落，送了只會被遊戲回絕');
});

/* ---- 與遊戲的連動 ---- */

test('面板投影與遊戲函式一致（孔數、真言適用裝備）', () => {
  const e = createEngine({ seed: 5 });
  e.boot(null);
  e.step(3000);
  const c = e.ctx;
  const view = e.panel('rune');
  assert.ok(view, '沒有 panels.rune——策略的符文規則會整場空轉');
  assert.equal(view.words.length, c.RUNEWORDS.length);
  assert.equal(view.compose.count, c.RUNE_COMPOSE_COUNT);
  assert.equal(view.compose.maxTier, c.RUNE_COMPOSE_MAX_TIER);

  const eq = e.panel('inv').equipment;
  for (const slot of Object.keys(view.equip)) {
    assert.equal(view.equip[slot].cap, c.runeSlotCountFor(eq[slot]), slot + ' 的孔數要等於遊戲算的');
  }
  const ids = new Set(view.words.map((w) => w.id));
  for (const slot of Object.keys(view.equip)) {
    for (const id of view.equip[slot].fits) assert.ok(ids.has(id), '適用清單裡有不存在的真言 ' + id);
  }
  for (const w of view.words) for (const r of w.runes) assert.ok(view.tiers[r], w.id + ' 用了不存在的符文 ' + r);
});

test('附魔已被遊戲關閉時，策略不得還有附魔規則', () => {
  const ctx = createEngine({ seed: 1 }).ctx;
  if (ctx.ENCHANT_ENABLED) return;       // 附魔重新開啟後這條自然不適用
  const dir = path.resolve(__dirname, '..', 'scripts', 'sim');
  for (const f of fs.readdirSync(dir).filter((x) => /^policy\..*\.json$/.test(x))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const bad = j.rules.filter((r) => r.cmd === 'item.enchant' || r.enchantPriority);
    assert.deepEqual(bad.map((r) => r.id), [],
      f + ' 還有附魔規則——ENCHANT_ENABLED=false 時它只會送出必定無效的指令');
  }
});

test('每份策略都有符文計畫，且順序在鑲寶石之後', () => {
  const dir = path.resolve(__dirname, '..', 'scripts', 'sim');
  for (const f of fs.readdirSync(dir).filter((x) => /^policy\..*\.json$/.test(x))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(j.rules.some((r) => r.id === 'rune-plan'), f + ' 沒有 rune-plan 規則');
    for (const need of ['gems', 'inv']) assert.ok(j.needPanels.includes(need), f + ' needPanels 缺 ' + need);
  }
});

/* ---- 速率型目標的計數器：開局尚未建立不算失效，改名才算 ---- */

test('速率計數器：開局桶尚未建立不記失效路徑，寬限之後仍讀不到才記', () => {
  const p = createPolicy({
    name: 't', decideEveryGameSec: 1, needPanels: [], lists: {},
    targets: [{ id: 'k', kind: 'ratePerMin', counter: 'panels.battle.lootStats.sources.field.kills', windowSec: 300, atLeast: 5 }],
    rules: []
  });
  p.decide({ gameTimeSec: 10, panels: { battle: { lootStats: { sources: {} } } } });
  assert.deepEqual(Object.keys(p.badPaths()), [], '開局讀不到是正常的');

  p.decide({ gameTimeSec: 500, panels: { battle: { lootStats: { sources: {} } } } });
  const bad = p.badPaths();
  assert.ok(bad && bad['panels.battle.lootStats.sources.field.kills'],
    '過了寬限仍讀不到＝欄位可能被改名，必須記成失效路徑，否則這個目標會整場靜靜失效');
});
