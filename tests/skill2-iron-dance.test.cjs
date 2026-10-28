const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const table = require('./helpers/skill-table.cjs');

function setup(lv = 10) {
  const c = { console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {} };
  c.window = c;
  vm.createContext(c);
  for (const name of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2', 'legendary']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + name + '.js'), 'utf8'), c, { filename: name });
  }
  const levels = [1, 0, 0, 0, lv, 0, 0];
  c.G = { player: { skillMastery: { level: 480, xp: 0 }, gold: 0, skills2: { levels: { dualdance: levels } }, loadout: [] }, stage: { current: 1 } };
  const st = { atk: 100, matk: 9999, hp: 10000, mp: 10000, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, passives: {}, elemAtk: null,
    elemDmgPct: 0, elemDmgUp: {}, totalDmgPct: 0, globalDmgRed: 0 };
  const p = { hp: 10000, mp: 10000, shield: 5000, shieldMax: 5000, skillCds: {}, buffs: {}, dots: [], effects: {}, pos: { x: 0, y: 0 } };
  c.FIELD = { player: p };
  c.getStats = () => st;
  c.bfPlayerPos = () => p.pos;
  c.enemyEventFloatTarget = e => e.name;
  c.sgLegend = () => ({});
  c.sgUlt = () => null;
  c.sgHitOne = () => ({ dmg: 0, miss: false, killed: false });
  const events = [];
  c.playCombatVfx = event => events.push(event);
  c.chance = () => false;
  c.GT = 0;
  c.resetSkill2RT();
  function enemy(maxHp = 10000, x = 30) {
    return { name: 'E', hp: maxHp, maxHp, def: 999, mdef: 999, level: 10,
      effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0, pos: { x, y: 0 } };
  }
  function cast(pool) {
    c.sgCastDualdance(p, st, c.SKILLS2.dualdance, levels, pool, pool[0], 'mv-float', { dmg: 0, killed: false }, false);
  }
  return { c, p, st, levels, events, enemy, cast };
}
const bleed = e => e.dots.find(d => d.sid === 'sgIronBleed');
const jump = e => bleed(e).dps * bleed(e).interval;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('鐵血：來源、升級步幅與滿級說明同步，備註算例不進入說明', () => {
  const { c } = setup();
  assert.deepEqual(JSON.parse(table.row('dualdance', 5)['效果參數(JSON)']),
    { pct: 100, pctPer: 10, enemyPct: 50, enemyPctPer: 5, sec: 3 });
  assert.equal(c.sgVal(c.SKILLS2.dualdance.tiers[4].fx, 'pct', 10), 200);
  assert.equal(c.sgVal(c.SKILLS2.dualdance.tiers[4].fx, 'enemyPct', 10), 100);
  assert.equal(c.describeSkill2Tier('dualdance', 4, 10),
    '施放雙刀亂舞時使你流血：每 0.35 秒造成 200% 物理傷害並持續 3 秒，附近的敵人也會受到你 100% 的流血效果。');
  assert.doesNotMatch(c.describeSkill2Tier('dualdance', 4, 10), /最大生命|200%\*|備註/);
  assert.equal(c.STATUS.sgIronBleed.dmgSource, 'skill');
  assert.equal(c.STATUS.sgIronBleed.dmg, 100);
  for (let lv = 1; lv < 10; lv++) {
    const fx = c.SKILLS2.dualdance.tiers[4].fx;
    assert.equal(c.sgVal(fx, 'pct', lv + 1) - c.sgVal(fx, 'pct', lv), 10);
    assert.equal(c.sgVal(fx, 'enemyPct', lv + 1) - c.sgVal(fx, 'enemyPct', lv), 5);
  }
});

for (const [lv, own, foe] of [[1, 110, 60.5], [5, 150, 112.5], [10, 200, 200]]) {
  test(`鐵血Lv.${lv}：敵方比例乘自身物攻流血基準`, () => {
    const h = setup(lv), e = h.enemy(); h.cast([e]);
    close(jump(h.p), own); close(jump(e), foe);
    for (const ent of [h.p, e]) {
      assert.equal(bleed(ent).interval, .35);
      assert.equal(bleed(ent).until, 3);
      assert.equal(bleed(ent).sourceKey, 'skill2:dualdance');
      const ui = h.c.statusEntries(ent).find(s => s.sid === 'sgIronBleed');
      close(ui.dps, bleed(ent).dps);
      assert.equal(ui.remain, 3);
    }
  });
}

test('鐵血：血量、魔攻、敵方防禦與BOSS最大生命減幅不改基值；物攻等比例成長', () => {
  const h = setup();
  const normal = h.enemy(10000), boss = h.enemy(1e12); boss.isBoss = true;
  h.c.bossPctHpFactor = () => .001;
  h.cast([normal, boss]);
  close(jump(normal), 200); close(jump(boss), 200);
  h.st.hp = 1e9; h.st.matk = 1; h.st.atk = 250;
  h.cast([normal, boss]);
  close(jump(h.p), 500); close(jump(normal), 500); close(jump(boss), 500);
});

test('鐵血：狂戰士減損與敵傷分別套用，減損至零仍可傷敵', () => {
  for (const cut of [25, 100]) {
    const h = setup(), e = h.enemy();
    h.c.sgLegend = () => ({ danceIronAmp: { pct: 25, reducePct: cut } });
    h.cast([e]);
    close(jump(h.p), cut === 25 ? 150 : 0);
    close(jump(e), 250);
  }
});

test('鐵血：正式施放入口在滿級套用雙方200%物理流血', () => {
  const h = setup(), e = h.enemy();
  h.levels.fill(10, 0, 4);
  assert.ok(h.c.castSkill2(h.p, [e], 'dualdance', 'mv-float'));
  close(jump(h.p), 200); close(jump(e), 200);
  assert.ok(h.p.mp < 10000);
});

test('鐵血：範圍、未習得、重施刷新與自身直扣生命保留', () => {
  const h = setup(), near = h.enemy(10000, 30), far = h.enemy(10000, 200), dead = h.enemy(0);
  h.cast([near, far, dead]);
  assert.ok(bleed(near)); assert.equal(bleed(far), undefined); assert.equal(bleed(dead), undefined);
  h.c.GT = .34; h.c.tickStatuses(h.p, .34);
  assert.equal(h.p.hp, 10000);
  h.c.GT = .35; h.c.tickStatuses(h.p, .01);
  close(h.p.hp, 9800); assert.equal(h.p.shield, 5000);
  h.c.GT = 1; h.cast([near]);
  assert.equal(h.p.dots.length, 1); assert.equal(near.dots.length, 1);
  assert.equal(bleed(h.p).until, 4);
  h.levels[4] = 0; h.p.dots = []; near.dots = []; h.cast([near]);
  assert.equal(h.p.dots.length, 0); assert.equal(near.dots.length, 0);
});

test('鐵血：正式DOT逐跳結算、到期移除、狀態特效與主體特效來源保持', () => {
  const h = setup(), e = h.enemy(); h.cast([e]);
  assert.ok(h.events.length > 0);
  assert.ok(h.events.every(s => s.vfx.attack === table.vfx('dualdance', 1, '攻擊特效')));
  h.c.GT = .35; h.c.tickStatuses(e, .35); close(e.hp, 9800);
  const before = h.p.hp;
  h.c.GT = 3; h.c.tickStatuses(h.p, 0);
  assert.equal(h.p.dots.length, 0); assert.equal(h.p.hp, before);
  assert.equal(h.c.statusEntries(h.p).find(s => s.sid === 'sgIronBleed'), undefined);
});

test('鐵血：原生Worker載入同一配置並轉送施放視覺事件，狀態投影與計算一致', () => {
  const { createEngine } = require('../scripts/sim/engine.js');
  const engine = createEngine({ seed: 42 }).boot();
  const c = engine.ctx, p = c.FIELD.player;
  c.G.player.level = 1000;
  c.G.player.skills2.levels.dualdance = [10, 10, 10, 10, 10, 0, 0];
  const st = { ...c.getStats(), atk: 100, hp: 10000, mp: 10000, critRate: 0, totalDmgPct: 0 };
  c.getStats = () => st;
  p.hp = 10000; p.mp = 10000;
  const e = { name: 'worker-target', hp: 1e9, maxHp: 1e9, level: 1, def: 0, mdef: 0,
    effects: {}, buffs: {}, dots: [], resist: {}, pos: { x: 30, y: 0 } };
  c.bfPlayerPos = () => ({ x: 0, y: 0 });
  assert.ok(c.castSkill2(p, [e], 'dualdance', 'mv-float'));
  close(jump(p), 200); close(jump(e), 200);
  const ownUI = c.statusEntries(p).find(s => s.sid === 'sgIronBleed');
  close(ownUI.dps * .35, 200);
  assert.equal(ownUI.remain, 3);
  const vfx = c.shimDrainUrgentVisualEvents().filter(s => s.kind === 'vfx' && s.variant === 'dual-slash');
  assert.ok(vfx.length >= 2);
  assert.ok(vfx.every(s => s.vfx.attack === table.vfx('dualdance', 1, '攻擊特效')));
  assert.equal(engine.outbox().filter(s => s.type === 'ERROR').length, 0);
});
