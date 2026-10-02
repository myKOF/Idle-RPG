'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');

function setup(lv = 1) {
  const c = { console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {} };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2', 'legendary']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + file + '.js'), 'utf8'), c);
  }
  c.G = { player: { skills2: { levels: { waterball: [10,10,10,10,10,10,10] },
    ult: { waterball: { pick: c.sgUltIndexOfId('waterball', 'abyssBurial'), lv } } },
    loadout: [c.SG_PREFIX + 'waterball'] }, stage: { current: 1 } };
  c.getStats = () => ({ atk: 100, matk: 100, hp: 1000, mp: 1000, level: 1, cdr: 0,
    legendaryEffects: {}, legendaryEffectMults: {}, passives: {} });
  c.GT = 0;
  c.rnd = () => 1;
  c.chance = pct => pct >= 100;
  const p = { hp: 1000, mp: 1000, effects: {}, buffs: {}, dots: [], skillCds: {} };
  c.FIELD.player = p;
  const es = [];
  const ctx = { pEnt: p, getEnemies: () => es, floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
  const tick = (dt = .05) => { c.GT += dt; c.sgTickAbyssDomain(ctx, dt); };
  return { c, p, es, ctx, tick };
}
function enemy(x, y = 0, extra = {}) {
  return { hp: 1e6, maxHp: 1e6, pos: { x, y }, buffs: {}, effects: {}, dots: [],
    level: 1, def: 0, mdef: 0, resist: {}, ctrlRes: 0, atkRange: 1000, ...extra };
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`); }

test('ABYSS: configuration and level descriptions use the shared domain values', () => {
  const { c } = setup();
  const u = c.sgUlt('waterball', 'abyssBurial');
  assert.deepEqual({ ...u.def.fx }, { stacks: 10, stacksPer: 1, vuln: 50, vulnPer: 5,
    pullSpeed: 3, pullStopM: 8, pullExtraM: 10, gap: .35, m: 30 });
  const one = c.describeSkill2Ult('waterball', u.idx, 1);
  const ten = c.describeSkill2Ult('waterball', u.idx, 10);
  assert.match(one, /30 米.*寒冰領域.*0.35 秒/);
  assert.match(one, /11 層.*55%/);
  assert.match(ten, /20 層.*100%/);
  assert.doesNotMatch(one, /40 米|pullExtraM|吸入範圍/);
});

test('ABYSS: continuous 3m/s pull stops at the 8m body edge and follows the player', () => {
  for (const dt of [.05, .2, 1]) {
    const { c, es, tick } = setup();
    es.push(enemy(300));
    for (let t = 0; t < 1 - 1e-9; t += dt) tick(dt);
    close(es[0].pos.x, 270);
    tick(100);
    close(c.bfEntityDistance(es[0]), 80);
    const stopped = es[0].pos.x;
    tick(1); close(es[0].pos.x, stopped);
    c.BF_PLAYER.x = -100;
    tick(1); close(es[0].pos.x, stopped - 30);
  }
});

test('ABYSS: 30m frost/vulnerability and 40m pull boundaries stay separate', () => {
  const { c, es, tick } = setup();
  const inside = enemy(320), pullOnly = enemy(-400), outside = enemy(0, 420.1);
  es.push(inside, pullOnly, outside);
  assert.equal(c.sgAbyssOverStacks(inside), 11);
  assert.equal(c.skill2AbyssDamageTakenMultiplier(inside), 1.55);
  assert.equal(c.sgAbyssOverStacks(pullOnly), 0);
  assert.equal(c.skill2AbyssDamageTakenMultiplier(pullOnly), 1);
  tick(0);
  c.GT = .35; c.sgTickAbyssDomain({ pEnt: c.FIELD.player, getEnemies: () => es }, 0);
  assert.equal(inside.buffs.sgFrost.stacks, 1);
  assert.equal(pullOnly.buffs.sgFrost, undefined);
  tick(.05); close(pullOnly.pos.x, -398.5); close(outside.pos.y, 420.1);
  inside.pos.x = 321;
  assert.equal(c.sgAbyssOverStacks(inside), 0);
  assert.equal(c.skill2AbyssDamageTakenMultiplier(inside), 1);
});

test('ABYSS: crowded enemies remain still across repeated pull and separation ticks', () => {
  const { c, es, tick } = setup();
  for (let x = 100; x <= 380; x += 40) es.push(enemy(x));
  const before = es.map(e => ({ ...e.pos }));
  for (let i = 0; i < 300; i++) { tick(.05); c.bfTickApproach(es, .05); }
  assert.deepEqual(es.map(e => ({ ...e.pos })), before, '沒有空位不能製造持續推擠');
  es[0].hp = 0;
  tick(.1); close(es[1].pos.x, 137);
});

test('ABYSS: swept circle collision cannot tunnel through mobs, bosses or entering enemies', () => {
  for (const obstacle of [enemy(100), enemy(132, 0, { isBoss: true }), enemy(130, 0, { _enterCd: 1 })]) {
    const { c, es, tick } = setup();
    const moving = enemy(300);
    es.push(moving, obstacle);
    const old = { ...obstacle.pos };
    tick(100);
    close(moving.pos.x, old.x + c.bfEntityRadius(obstacle) + 20 + .0001);
    close(obstacle.pos.x, old.x);
    assert.ok(c.bfEntityGap(moving, obstacle) >= 0);
  }
  const { c } = setup();
  const touching = [enemy(100), enemy(140)];
  assert.equal(c.bfPullEnemies(touching, 400, 80, 0).length, 0);
  const instant = enemy(300);
  c.bfPullEnemies([instant], 400, 80);
  assert.equal(instant.pos.x, 80, '原有瞬間拉近的呼叫保持原語意');
});

test('ABYSS: death, revival, unequip, entering and positionless tower behavior', () => {
  const { c, p, es, tick } = setup();
  const e = enemy(200), entering = enemy(-200, 0, { _enterCd: 1 });
  es.push(e, entering); tick(0);
  p.hp = 0; tick(1); close(e.pos.x, 200);
  assert.equal(c.skill2AbyssDamageTakenMultiplier(e), 1);
  assert.equal(c.sgAbyssOverStacks(e), 0);
  p.hp = 1000; c.SKILL2_RT.earthguardRevival = { endAt: 5 }; tick(1); close(e.pos.x, 200);
  c.SKILL2_RT.earthguardRevival = null; tick(1); close(e.pos.x, 170); close(entering.pos.x, -200);
  assert.equal(c.skill2AbyssDamageTakenMultiplier(entering), 1);
  const tower = enemy(0, 0, { pos: undefined, towerBoss: true });
  assert.equal(c.skill2AbyssDamageTakenMultiplier(tower), 1.55);
  c.G.player.loadout = [];
  assert.equal(c.skill2AbyssDamageTakenMultiplier(e), 1);
  tick(1); close(e.pos.x, 170);
  assert.equal(p.buffs.sgAbyssDomain, undefined);
  assert.equal(c.SKILL2_RT.abyssOwner, null);
});

test('ABYSS: physical/magic hits, direct damage and DoT amplify once; player and boss cap stay intact', () => {
  for (const dmgType of ['physical', 'magic']) {
    const { c, es, tick } = setup();
    const e = enemy(100); es.push(e); tick(0);
    const cfg = { atk: 100, matk: 100, dmgType, hit: 10000, level: 1, isPlayer: true };
    const def = { def: 0, mdef: 0, level: 1, dodge: 0, pRes: 0, mRes: 0, resist: {} };
    assert.equal(c.resolveHit(c.FIELD.player, e, cfg, def).dmg, 155);
    assert.equal(c.applyEnemyHpDamage(e, 100), 155);
    e.dots = [{ dps: 100, interval: 1, acc: 0, until: 10, name: '流血' }];
    const before = e.hp; c.tickStatuses(e, 1); close(before - e.hp, 155);
    assert.equal(c.applyEnemyHpDamage(c.FIELD.player, 100), 100);
    e.towerBoss = true; e.maxHp = 1000; e.hp = 1000;
    assert.equal(c.applyEnemyHpDamage(e, 1000), 200, '易傷不能突破高塔單次扣血上限');
    assert.equal(c.resolveHit(c.FIELD.player, e, { ...cfg, atk: 1000, matk: 1000 }, def).hpDamage, 200);
  }
});

test('ABYSS: vulnerability increments each level and shared frost cap reaches 16/25 layers', () => {
  for (const [lv, amp, cap] of [[1,1.55,16], [10,2,25]]) {
    const { c, es, tick } = setup(lv);
    const e = enemy(100); es.push(e);
    for (let i = 0; i < 60; i++) tick(.35);
    assert.equal(e.buffs.sgFrost.stacks, cap);
    assert.equal(c.skill2AbyssDamageTakenMultiplier(e), amp);
    const other = c.sgFrostSpec(c.SKILLS2.frostnova, [1,0,0,0,0,0,0], 0, 100);
    const another = enemy(-100);
    assert.ok(c.sgApplyFrost(another, other) > 0);
    for (let i = 0; i < 30; i++) c.sgApplyFrost(another, other);
    assert.equal(another.buffs.sgFrost.stacks, cap, '其他技能的寒霜也吃共用額外上限');
    assert.equal(c.sgAbyssOverStacks(e), lv === 1 ? 11 : 20);
  }
});

test('ABYSS: serialized status radius drives real Runtime size and tracks the moving centre', () => {
  const { c, p, tick } = setup(); tick(0);
  const projection = JSON.parse(JSON.stringify(c.statusEntries(p)));
  const domain = projection.find(s => s.sid === 'sgAbyssDomain');
  assert.equal(domain.vfxR, 300, '僅投影寒冰判定圈，不投影吸入外圈');
  const nodes = [], backend = { createNode(spec) { const n = { spec }; nodes.push(n); return n; },
    updateNode(n, t) { n.t = { ...t }; }, destroyNode(n) { n.t = null; } };
  const old = global.statusVfxPreset;
  global.statusVfxPreset = c.statusVfxPreset;
  const rt = Runtime.create({ core: Core, resolver: { resolve: id => id }, zoneBackend: backend,
    fxBackend: backend, ctx: { playerPos: () => c.BF_PLAYER, posOf: () => c.BF_PLAYER, footOf: () => c.BF_PLAYER } });
  try {
    // 固定單位測試素材：避開使用者正在編輯的正式Preset，驗證權威半徑傳到真正Runtime。
    rt.registerPresets([{ schemaVersion: 1, id: c.statusVfxPreset('sgAbyssDomain', 'aura'),
      sizing: { shape: 'circle', radiusM: 6, authored: { radius: 100 } },
      duration: 1, loop: true, layers: [{ id: 'ring', type: 'sprite', assetId: 'test-ring.png' }] }]);
    rt.syncStatuses([{ key: 'p', sids: ['sgAbyssDomain'], radii: { sgAbyssDomain: domain.vfxR } }]);
    rt.update(.1);
    const node = nodes.find(n => n.t?.visible); assert.ok(node);
    const first = { ...node.t }; c.BF_PLAYER.x = 25; c.BF_PLAYER.y = 40; rt.update(.1);
    close(node.t.x - first.x, 25); close(node.t.y - first.y, 40);
    close(node.t.scaleX * 200, 600, '領域畫面直徑應為60米');
    close(node.t.scaleY * 200, 600);
    rt.syncStatuses([]); rt.update(.1);
    assert.equal(rt.stats().auras, 0);
  } finally { rt.destroy(); global.statusVfxPreset = old; }
});
