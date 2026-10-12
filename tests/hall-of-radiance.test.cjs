'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createEngine } = require('../scripts/sim/engine');
const table = require('./helpers/skill-table.cjs');

function setup(level = 1) {
  const c = createEngine({ seed: 9 }).boot(null).ctx;
  c.G.player.level = 2000;
  c.G.player.skills2 = { levels: { earthguard: Array(7).fill(10) }, ult: { earthguard: { pick: 0, lv: level } } };
  c.G.player.loadout = ['sg:earthguard'];
  const st = { hp: 10000, mp: 2000, hpRegen: 100, mpRegen: 50, lifesteal: 20, manaSteal: 10, shieldEff: 0, legendaryEffects: {}, legendaryEffectMults: {} };
  c.getStats = () => st;
  const p = { hp: 1000, mp: 100, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {} };
  const ctx = { pEnt: p, getEnemies: () => [], floatSel: 'mv-float', onDeaths() {} };
  function tick(at) { c.GT = at; c.tickSkill2(0, ctx); }
  tick(0);
  return { c, p, st, tick };
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

test('光耀之堂：兩秒邊界才回復，空場持續生效且不扣魔／啟動施放冷卻', () => {
  const { p, tick } = setup();
  tick(1.999); assert.equal(p.hp, 1000); assert.equal(p.mp, 100);
  tick(2); near(p.hp, 1220); near(p.mp, 144);
  tick(3.999); near(p.hp, 1220); near(p.mp, 144);
  tick(4); near(p.hp, 1440); near(p.mp, 188);
  assert.deepEqual(p.skillCds, {});
});

test('光耀之堂：每級增加0.2%，每次按當下生命與法力上限計算', () => {
  for (const [level, hp, mp] of [[1, 220, 44], [5, 300, 60], [10, 400, 80]]) {
    const { p, st, tick } = setup(level);
    tick(2); near(p.hp, 1000 + hp); near(p.mp, 100 + mp);
    st.hp *= 2; st.mp *= 3;
    tick(4); near(p.hp, 1000 + hp * 3); near(p.mp, 100 + mp * 4);
  }
});

test('光耀之堂：僅溢出的生命與法力各轉25%護盾，不額外疊加一般治療溢出轉盾', () => {
  const { p, tick } = setup(10);
  p.hp = 9950; p.mp = 1990;
  tick(2);
  assert.equal(p.hp, 10000); assert.equal(p.mp, 2000); near(p.shield, 105);
  near(p.shieldMax, 105);
});

test('光耀之堂：所有等級的兩種資源溢出均固定25%，沿用共用護盾效率', () => {
  for (const level of [1, 5, 10]) {
    const { c, p, st } = setup(level);
    p.hp = st.hp; p.mp = st.mp;
    c.healPlayer(p, 100, st, { noShield: true }); near(p.shield, 25);
    c.gainPlayerMana(p, 100, st); near(p.shield, 50);
    st.shieldEff = 100;
    c.gainPlayerMana(p, 100, st); near(p.shield, 100);
  }
});

test('光耀之堂：每秒回復／吸血吸魔與Worker面板不再包含舊超神倍率', () => {
  const { c, st } = setup(10);
  const panel = JSON.stringify(c.playerPanelStats(st).passivePanel);
  const factors = ['hp', 'mp'].map(kind => [c.skill2RegenFactor(kind), c.skill2DrainFactor(kind)]);
  c.G.player.skills2.ult = {};
  assert.equal(JSON.stringify(c.playerPanelStats(st).passivePanel), panel);
  assert.deepEqual(['hp', 'mp'].map(kind => [c.skill2RegenFactor(kind), c.skill2DrainFactor(kind)]), factors);
  c.G.player.skills2.ult.earthguard = { pick: 0, lv: 10 };
  c.getViewStats = () => st;
  assert.equal(JSON.stringify(c.buildPanel('header').stats.passivePanel), panel);
});

test('光耀之堂：死亡與復甦不回復、不轉盾，恢復生效後重新等完整兩秒', () => {
  for (const revival of [false, true]) {
    const { c, p, tick } = setup();
    if (revival) p._sgRevival = true;
    else p.hp = 0;
    tick(2); assert.equal(p.mp, 100); assert.equal(p.shield, 0); assert.equal(c.SKILL2_RT.radianceAt, 0);
    if (!revival) assert.equal(p.hp, 0);
    delete p._sgRevival; p.hp = 1000;
    tick(10); tick(11.999); assert.equal(p.hp, 1000);
    tick(12); near(p.hp, 1220); near(p.mp, 144);
  }
});

test('光耀之堂：卸下、超神切換或前階降級均取消舊節拍', () => {
  for (const mode of ['unequip', 'switch', 'downgrade']) {
    const { c, p, tick } = setup();
    if (mode === 'unequip') c.G.player.loadout = [];
    if (mode === 'switch') c.G.player.skills2.ult.earthguard.pick = 1;
    if (mode === 'downgrade') c.G.player.skills2.levels.earthguard[6] = 9;
    tick(2); assert.equal(p.hp, 1000); assert.equal(p.mp, 100); assert.equal(c.SKILL2_RT.radianceAt, 0);
    c.G.player.loadout = ['sg:earthguard']; c.G.player.skills2.ult.earthguard.pick = 0; c.G.player.skills2.levels.earthguard[6] = 10;
    tick(10); tick(11.999); assert.equal(p.hp, 1000);
    tick(12); near(p.hp, 1220);
  }
});

test('光耀之堂：換場Runtime重置，暈眩不阻止被動回復', () => {
  const { c, p, tick } = setup();
  c.resetSkill2RT(); assert.equal(c.SKILL2_RT.radianceAt, 0);
  tick(20); tick(21.999); assert.equal(p.hp, 1000);
  c.applyStatus(p, 'stun', { dur: 10 });
  tick(22); near(p.hp, 1220); near(p.mp, 144);
});

test('光耀之堂：配置與技能顯示同源，只有回復比例隨等級提高，主端與Worker快取同步', () => {
  const { c } = setup();
  const row = table.row('earthguard', 'hallOfRadiance');
  assert.deepEqual(JSON.parse(row['效果參數(JSON)']), { pct: 2, pctPer: 0.2, conv: 25, sec: 2 });
  for (const [level, pct] of [[1, '2.2'], [10, '4']]) {
    const text = c.describeSkill2Ult('earthguard', 0, level).replace(/<[^>]+>/g, '');
    assert.match(text, new RegExp(`每2秒回復${pct.replace('.', '\\.')}%生命與法力`));
    assert.match(text, /25% 轉為你的生命護盾/);
    assert.doesNotMatch(text, /乘算|額外/);
  }
  const index = fs.readFileSync('index.html', 'utf8');
  table.versioned(index, 'js/skills2.js');
  table.versioned(index, 'js/bridge.js');
  const workerVersion = fs.readFileSync('js/bridge.js', 'utf8').match(/WORKER_ASSET_VERSION = '([^']+)'/)[1];
  assert.ok(fs.readFileSync('js/worker/sim.worker.js', 'utf8').includes('skills2.js?v=' + workerVersion));
});
