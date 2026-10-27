const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(misses = []) {
  const c = { console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {} };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + file + '.js'), 'utf8'), c, { filename: file });
  }
  c.G = { player: { gold: 0, skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  const st = { atk: 1000, matk: 500, hp: 1000, mp: 1000, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, passives: {}, elemAtk: null,
    elemDmgPct: 0, elemDmgUp: {}, eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, aoeDmg: 0 };
  const p = { hp: 1000, mp: 1000, shield: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, pos: { x: 0, y: 0 } };
  const pool = Array.from({ length: 6 }, (_, i) => ({ name: 'E' + i, hp: 100000, maxHp: 100000,
    def: 0, mdef: 0, level: 1, effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    pos: { x: 30 + i * 60, y: 0 } }));
  const events = [], hits = [], floats = [], out = { dmg: 0 };
  const nativeResolveHit = c.resolveHit, nativeChance = c.chance;
  c.getStats = () => st;
  c.bfPlayerPos = () => p.pos;
  c.enemyEventFloatTarget = e => e.name;
  c.playerEventFloatTarget = () => 'player';
  c.floatEnemyEvent = (...args) => floats.push(args);
  c.playCombatVfx = spec => events.push(spec);
  c.applySkillFinalDamageMultiplier = () => {};
  c.Math.random = () => 0;
  c.chance = () => false;
  c.resolveHit = (attacker, target) => {
    const miss = misses === 'all' || misses.includes(hits.length);
    hits.push({ target, miss, at: c.GT });
    if (!miss) target.hp -= 100;
    return { dmg: miss ? 0 : 100, crit: false, miss, killed: false };
  };
  c.GT = 0;
  c.resetSkill2RT();
  const ctx = { pEnt: p, getEnemies: () => pool, onDeaths() {}, onDamage() {} };
  function tick() {
    c.GT += .05;
    c.sgTickFlyingProjectiles(.05, ctx);
    c.sgTickMeteors(ctx);
    c.sgTickWaterballs(ctx);
  }
  function settle(pendingOut = out) {
    let guard = 0;
    while (c.SKILL2_RT.projectiles.length || c.SKILL2_RT.meteors.length || c.SKILL2_RT.waterballs.length) {
      assert.ok(guard++ < 2000, '有限彈射佇列必須清空');
      tick();
    }
    assert.equal(pendingOut._pendingProjectiles, 0, '待結算計數必須歸零');
  }
  function levels(gid, values) { c.G.player.skills2.levels[gid] = values; return values; }
  function knife() {
    const lvs = levels('knife', [1, 0, 1, 0, 0, 0, 0]);
    c.SKILLS2.knife.tiers[0].fx.count = 1;
    c.SKILLS2.knife.tiers[2].fx.count = 3;
    c.sgCastKnife(p, st, c.SKILLS2.knife, lvs, pool, pool[0], 'mv-float', out);
  }
  return { c, p, st, pool, events, hits, floats, out, ctx, tick, settle, levels, knife, nativeResolveHit, nativeChance };
}

for (const [label, misses] of [['首擊', [0]], ['中途', [1]], ['全程', 'all']]) {
  test('飛刀' + label + '閃避仍完成三次彈射，閃避消耗次數且不提前結算', () => {
    const h = setup(misses);
    h.knife();
    assert.equal(h.hits.length, 0);
    h.settle();
    assert.equal(h.hits.length, 4);
    assert.equal(h.out.dmg, misses === 'all' ? 0 : 300);
    assert.equal(h.events.filter(e => e.variant === 'knife-bounce').length, 3);
    assert.equal(h.events.filter(e => e.variant === 'knife-strike').length, misses === 'all' ? 0 : 3);
    assert.equal(h.floats.filter(f => f[2] === 'MISS').length, misses === 'all' ? 4 : 1);
    for (const e of h.events.filter(e => e.variant === 'knife-bounce')) {
      assert.equal(e.hit, false);
      assert.ok(e.travelMs[1] > 0);
      assert.notEqual(e.targets[0], e.targets[1]);
      assert.ok(Number.isFinite(e.area.sourceX));
    }
  });
  test('連鎖閃電' + label + '閃避仍完成四段並送出正常結束事件', () => {
    const h = setup(misses), lvs = h.levels('chainlightning', [1, 0, 0, 0, 0, 0, 0]);
    h.c.SKILLS2.chainlightning.tiers[0].fx.count = 4;
    h.c.sgCastChainlightning(h.p, h.st, h.c.SKILLS2.chainlightning, lvs, h.pool, h.pool[0], 'mv-float', h.out);
    assert.equal(h.hits.length, 0);
    h.settle();
    assert.equal(h.hits.length, 4);
    assert.equal(h.out.dmg, misses === 'all' ? 0 : 300);
    const flights = h.events.filter(e => e.variant === 'lightning-chain');
    assert.equal(flights.length, 4);
    assert.ok(flights.every(e => e.hit === false && e.travelMs.at(-1) > 0));
    assert.deepEqual(Array.from(flights[1].targets), [h.hits[0].target.name, h.hits[1].target.name]);
    assert.equal(h.events.filter(e => e.variant === 'lightning-chain-end').length, 1);
    assert.equal(h.c.SG_CHAIN_ACTIVE, 0);
  });
  test('連鎖雷爆' + label + '閃避仍消耗四段，後續電弧從上一落點出發', () => {
    const h = setup(misses);
    h.c.chance = () => true;
    h.c.sgThunderorbBurst(h.p, h.st, 'mv-float', { chance: 100, bounces: 4, dmgVal: 100, px: 300, speedPx: 300 },
      h.pool[0], h.pool, h.out);
    assert.equal(h.hits.length, 1, '只有原地起手一段立即結算');
    h.settle();
    assert.equal(h.hits.length, 4);
    assert.equal(h.out.dmg, misses === 'all' ? 0 : 300);
    const flights = h.events.filter(e => e.variant === 'lightning-chain');
    assert.equal(flights.length, 3);
    assert.equal(flights[0].area.sourceX, h.pool[0].pos.x);
    assert.ok(flights.every(e => e.hit === false && e.travelMs[1] > 0));
    assert.equal(h.events.filter(e => e.variant === 'lightning-chain-end').length, 1);
  });
  test('水流彈' + label + '閃避仍完成三次落地彈射', () => {
    const h = setup(misses);
    h.levels('waterball', [1, 0, 0, 1, 0, 0, 0]);
    h.c.sgWaterballShot(h.p, h.st, h.c.SKILLS2.waterball, [], h.pool, h.pool[0], 'mv-float', h.out,
      { delayMs: 0, bounces: 3, burstR: 1, bounceSpeed: 1, bouncesEnabled: true, dmgVal: 100 });
    assert.equal(h.hits.length, 0);
    h.settle();
    assert.equal(h.hits.length, 4);
    assert.equal(h.out.dmg, misses === 'all' ? 0 : 300);
    const flights = h.events.filter(e => e.variant === 'waterball');
    assert.equal(flights.length, 4);
    assert.ok(flights.every(e => e.hit === false && e.travelMs[0] > 0));
    assert.equal(flights[1].area.sourceX, flights[0].area.x);
  });
}

test('真實resolveHit絕對閃避：飛刀首擊無傷害，後續仍抵達並造成傷害', () => {
  const h = setup(), originalDef = h.c.monsterDefCfg;
  h.c.chance = h.nativeChance;
  h.c.Math.random = () => .5;
  h.c.monsterDefCfg = target => ({ ...originalDef(target), absDodge: target === h.pool[0] ? 100 : 0, dodge: 0 });
  h.c.resolveHit = (a, target, ac, dc) => {
    const result = h.nativeResolveHit(a, target, ac, dc);
    h.hits.push({ target, miss: result.miss });
    return result;
  };
  h.knife(); h.settle();
  assert.equal(h.hits.length, 4);
  assert.equal(h.hits[0].miss, true);
  assert.equal(h.pool[0].hp, 100000);
  assert.ok(h.out.dmg > 0);
  assert.equal(h.events.filter(e => e.variant === 'knife-bounce').length, 3);
});

test('分裂飛刀全程閃避仍用完彈射，不觸發爆擊、擊殺或額外連鎖', () => {
  const h = setup('all');
  const cfg = { pEnt: h.p, st: h.st, pool: h.pool, floatSel: 'mv-float', out: h.out, dmgVal: 100,
    execPct: 0, pathPct: 0, bounceRangePx: 200, split: { count: 1, pct: 50, bounces: 2 },
    onCrit() { assert.fail('閃避不能觸發爆擊'); } };
  h.c.sgKnifeSplit(cfg, h.pool[0], 0);
  h.settle();
  assert.equal(h.hits.length, 3);
  assert.equal(h.out.dmg, 0);
  assert.equal(h.events.filter(e => e.variant === 'knife-bounce').length, 3);
  h.c.chance = () => assert.fail('閃避不能觸發命中追加彈射');
  h.c.sgKnifeBounceChain(cfg, h.pool[0], 100, 0, 2, 10, 100, false);
  h.settle();
  assert.equal(h.hits.length, 5);
});

test('飛刀首擊被閃避時，無候選或超出彈射範圍仍正常結束', () => {
  for (const far of [false, true]) {
    const h = setup('all');
    h.pool.splice(far ? 2 : 1);
    if (far) h.pool[1].pos.x = 1000;
    h.knife(); h.settle();
    assert.equal(h.hits.length, 1);
    assert.equal(h.events.filter(e => e.variant === 'knife-bounce').length, 0);
  }
});

test('無限追魂刃連續閃避仍追擊，依原期限結束並清空佇列', () => {
  const h = setup('all');
  h.levels('knife', [1, 0, 1, 0, 0, 0, 0]);
  const cfg = { pEnt: h.p, st: h.st, pool: h.pool, floatSel: 'mv-float', out: h.out,
    dmgVal: 100, execPct: 0, pathPct: 0, bounceRangePx: 200 };
  const def = h.c.SKILLS2.knife.ult.find(u => u.id === 'soulhunterBlade');
  h.c.sgKnifeSoulhunter(cfg, { def, lv: 1 });
  h.settle();
  assert.ok(h.hits.length > 3);
  assert.ok(h.hits.every(hit => hit.miss));
  assert.equal(h.out.dmg, 0);
  assert.ok(h.events.filter(e => e.variant === 'knife-soulhunter' && e.area?.soulMode === 'flight').length > 3);
  assert.equal(h.events.at(-1).area.soulMode, 'stop');
});

test('永恒超導體連續閃避仍往返玩家，卸下後正常收束', () => {
  const h = setup('all');
  h.levels('chainlightning', [10, 10, 10, 10, 10, 10, 10]);
  h.c.G.player.skills2.ult = { chainlightning: { pick: h.c.sgUltIndexOfId('chainlightning', 'eternalSuperconductor'), lv: 1 } };
  h.c.sgChainSuperconductor(h.p, h.st, { pEnt: h.p, st: h.st, out: h.out, dmgVal: 100, speedPx: 300 },
    h.pool, 'mv-float', h.out);
  for (let i = 0; i < 50; i++) { h.tick(); h.c.sgTickSuperconduct(h.ctx); }
  assert.ok(h.hits.length > 3);
  assert.equal(h.out.dmg, 0);
  assert.ok(h.events.filter(e => e.variant === 'lightning-chain' && e.targets[0] === 'player').length > 3);
  delete h.c.G.player.skills2.ult.chainlightning;
  h.c.sgTickSuperconduct(h.ctx);
  assert.equal(h.c.SKILL2_RT.superconductFlight, null);
  assert.equal(h.events.at(-1).variant, 'lightning-chain-end');
});

test('無限閃電自動施放的單鏈全程閃避仍用完表定次數', () => {
  const h = setup('all');
  h.levels('chainlightning', [10, 10, 10, 10, 10, 10, 10]);
  h.c.SKILLS2.chainlightning.tiers[0].fx.count = 4;
  for (const [tier, key] of [[2, 'add'], [3, 'add'], [4, 'pct'], [6, 'add']]) {
    h.c.SKILLS2.chainlightning.tiers[tier].fx[key] = 0;
    h.c.SKILLS2.chainlightning.tiers[tier].fx[key + 'Per'] = 0;
  }
  h.c.G.player.loadout = [h.c.SG_PREFIX + 'chainlightning'];
  h.c.G.player.skills2.ult = { chainlightning: { pick: h.c.sgUltIndexOfId('chainlightning', 'skyThunderArray'), lv: 1 } };
  h.p.mp = 100000;
  let autoOut;
  const cast = h.c.castSkill2;
  h.c.castSkill2 = (...args) => (autoOut = cast(...args));
  h.c.FIELD.player = h.p;
  h.c.sgTickInfiniteLightning(h.ctx, .05);
  h.c.GT = h.c.SKILL2_RT.infiniteLightningAt;
  h.c.sgTickInfiniteLightning(h.ctx, .05);
  assert.ok(h.c.SKILL2_RT.meteors.length > 0);
  h.settle(autoOut);
  assert.equal(h.hits.length, 4);
  assert.equal(h.events.filter(e => e.variant === 'lightning-chain').length, 4);
  assert.equal(autoOut.dmg, 0);
  assert.ok(h.p.mp < 100000, '保留自動施放的原耗魔規則');
});

test('閃避後已排出的飛刀彈射在玩家死亡時取消，不於復活後補傷害', () => {
  const h = setup('all');
  h.knife();
  for (let i = 0; !h.hits.length && i < 100; i++) h.tick();
  assert.equal(h.hits.length, 1);
  assert.ok(h.c.SKILL2_RT.projectiles.length > 0);
  h.p.hp = 0; h.settle();
  h.p.hp = 1000; h.tick();
  assert.equal(h.hits.length, 1);
});

test('全程閃避的飛刀續段穿過Worker白名單後，Runtime仍按權威曲線與時長播放', () => {
  const h = setup('all');
  h.knife(); h.settle();
  const shim = {};
  shim.self = shim;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/worker/shim.js'), 'utf8'), shim);
  const flights = h.events.filter(e => e.variant === 'knife' || e.variant === 'knife-bounce');
  for (const event of flights) shim.playCombatVfx(event);
  const forwarded = shim.shimDrainUrgentVisualEvents().filter(e => e.kind === 'vfx');
  assert.equal(forwarded.length, 4);
  const Core = require('../js/vfx-core.js'), Runtime = require('../js/vfx-runtime.js');
  for (const [i, event] of forwarded.entries()) {
    assert.deepEqual(JSON.parse(JSON.stringify(event.area)), JSON.parse(JSON.stringify(flights[i].area)));
    assert.deepEqual(Array.from(event.travelMs), Array.from(flights[i].travelMs));
    assert.equal(event.hit, false);
    const frames = [], backend = { createNode: () => ({}), updateNode: (n, t) => frames.push({ ...t }), destroyNode() {} };
    const rt = Runtime.create({ core: Core, resolver: { has: () => true, resolve: x => x },
      fxBackend: backend, zoneBackend: backend, ctx: { playerPos: () => h.p.pos,
        posOf: id => h.pool.find(e => e.name === id)?.pos, chainPoint: id => h.pool.find(e => e.name === id)?.pos } });
    rt.registerPresets([JSON.parse(fs.readFileSync(path.join(__dirname, '../vfx/presets/' + event.vfx.projectile + '.json'), 'utf8'))]);
    assert.equal(rt.tryPlay(event), true);
    const duration = event.travelMs.at(-1) / 1000, area = event.area;
    rt.update(duration / 2);
    const x = area.controlX == null ? (area.sourceX + area.x) / 2 : (area.sourceX + 2 * area.controlX + area.x) / 4;
    const y = area.controlY == null ? (area.sourceY + area.y) / 2 : (area.sourceY + 2 * area.controlY + area.y) / 4;
    assert.ok(frames.some(f => Math.abs(f.x - x) < 1e-6 && Math.abs(f.y - y) < 1e-6));
    assert.equal(rt.stats().projectiles, 1);
    rt.update(duration / 2 + .001);
    assert.equal(rt.stats().projectiles, 0);
    rt.clear();
  }
});
