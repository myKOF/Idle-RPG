const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function setup(aoeDmg = 0) {
  const events = [], floats = [], tracked = [], records = [];
  const c = { console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {},
    trackDps(n) { tracked.push(n); }, recordRunDamage(...args) { records.push(args); } };
  c.window = c;
  vm.createContext(c);
  for (const f of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), c, { filename: f });
  }
  c.G = { player: { level: 1000, reincarnations: 0, gold: 0, skillMastery: { level: 1000, xp: 0 },
    skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  const st = { atk: 1000, matk: 1000, hp: 1e6, mp: 1e6, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, shieldEff: 0, comboHits: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: {}, eliteDmg: 0, bossDmg: 0,
    normalDmg: 0, totalDmgPct: 0, dmgVsElem: null, aoeDmg, globalDmgRed: 0 };
  c.getStats = () => st;
  c.trackDps = n => tracked.push(n);
  c.recordRunDamage = (...args) => records.push(args);
  c.Math.random = () => 0.5;
  c.GT = 0;
  c.playCombatVfx = e => events.push(e);
  c.enemyEventFloatTarget = e => e.name;
  c.playerEventFloatTarget = () => 'player';
  c.floatEnemyEvent = (ent, sel, text, cls, amount) => floats.push({ ent, amount });
  const p = { hp: 1e6, mp: 1e6, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {} };
  return { c, st, p, events, floats, tracked, records };
}
function enemy(x = 20, y = 0) {
  return { name: `enemy-${x}-${y}`, hp: 1e9, maxHp: 1e9, level: 10, def: 0, mdef: 0,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0, pos: { x, y } };
}
function ctx(env, enemies) {
  return { pEnt: env.p, floatSel: 'mv-float', getEnemies: () => enemies, onDamage() {}, onDeaths() {} };
}
function run(env, enemies, sec = 3) {
  for (let i = 1; i <= Math.round(sec / 0.05); i++) {
    env.c.GT = i * 0.05;
    env.c.tickSkill2(0.05, ctx(env, enemies));
  }
}
function cast(gid, aoe, levels = [1, 0, 0, 0, 0, 0, 0], count = 1, noPos = false) {
  const e = setup(aoe);
  const enemies = Array.from({ length: count }, (_, i) => enemy(20 + i * 20));
  if (noPos) enemies.forEach(x => delete x.pos);
  e.c.G.player.skills2.levels[gid] = levels;
  e.c.G.player.loadout = [e.c.SG_PREFIX + gid];
  const result = e.c.castSkill2(e.p, enemies, gid, 'mv-float');
  assert.ok(result, gid + ' must cast');
  run(e, enemies);
  return { ...e, enemies, damage: enemies.map(x => 1e9 - x.hp) };
}

for (const gid of ['frostnova', 'thrust', 'cleave', 'gale', 'fireball', 'firepillar', 'waterball', 'thunderorb', 'windblade', 'vacuumslash']) {
  test(gid + ': actual area damage doubles with +100%, including one target', () => {
    const a = cast(gid, 0), b = cast(gid, 100);
    assert.ok(a.damage[0] > 0, gid + ' should hit');
    assert.ok(Math.abs(b.damage[0] - a.damage[0] * 2) <= 2, `${gid}: ${a.damage} -> ${b.damage}`);
  });
}

test('frostnova: +100% doubles every target, no sharing, floats/statistics match HP', () => {
  for (const count of [1, 3]) {
    for (const [pct, expected] of [[0, 825], [50, 1238], [100, 1650], [1000, 9075]]) {
      const e = cast('frostnova', pct, undefined, count);
      assert.deepEqual(e.damage, Array(count).fill(expected));
      assert.equal(e.tracked.reduce((a, b) => a + b, 0), expected * count);
      assert.equal(e.records.reduce((n, args) => n + args[1], 0), expected * count);
      assert.equal(e.floats.reduce((n, f) => n + (f.amount || 0), 0), expected * count);
      const vfx = e.events.find(x => x.variant === 'frost-nova');
      assert.ok(vfx && vfx.area.r > 0);
      const base = cast('frostnova', 0, undefined, count);
      assert.equal(vfx.area.r, base.events.find(x => x.variant === 'frost-nova').area.r);
    }
  }
});

for (const gid of ['bloodblade', 'dualdance', 'knife', 'icearrow', 'thunderstrike', 'chainlightning']) {
  test(gid + ': single strikes/bounces do not gain area damage', () => {
    const a = cast(gid, 0), b = cast(gid, 100);
    assert.ok(a.damage[0] > 0);
    assert.deepEqual(b.damage, a.damage);
  });
}

test('piercing ice arrow gains area damage even in a coordinate-free scene', () => {
  for (const noPos of [false, true]) {
    const levels = [1, 1, 1, 1, 0, 0, 0];
    const a = cast('icearrow', 0, levels, 1, noPos), b = cast('icearrow', 100, levels, 1, noPos);
    assert.ok(a.damage[0] > 0);
    assert.ok(Math.abs(b.damage[0] - 2 * a.damage[0]) <= 2);
  }
});

test('independent area multiplier includes flat elemental damage and stacks multiplicatively with total damage', () => {
  const e = setup(100), target = enemy(), out = { dmg: 0 };
  e.st.totalDmgPct = 50;
  e.st.elemAtk = { fire: 100 };
  const hit = e.c.sgAreaHitOne(e.p, e.st, target, 1000, 'thrust', 'mv-float', out, 0);
  assert.equal(hit.dmg, 3300);
  assert.equal(out.dmg, 3300);
});

test('ordinary basic attack and single counter do not gain area damage', () => {
  for (const attack of ['basic', 'counter']) {
    const damage = [];
    for (const pct of [0, 100]) {
      const e = setup(pct), target = enemy(), out = { dmg: 0 };
      if (attack === 'basic') e.c.doPlayerAttack(e.p, target, 'mv-float');
      else e.c.sgCounterStrike(e.p, e.st, target, 100, 'mv-float', out, 0);
      damage.push(1e9 - target.hp);
    }
    assert.ok(damage[0] > 0);
    assert.equal(damage[1], damage[0]);
  }
});

test('mire area DoTs snapshot one multiplier, refresh does not compound', () => {
  const values = [];
  for (const pct of [0, 100]) {
    const e = setup(pct), target = enemy();
    const levels = [1, 1, 1, 1, 1, 1, 1];
    e.c.G.player.skills2.levels.mire = levels;
    const spec = e.c.sgMireSpec(e.c.SKILLS2.mire, levels, e.st);
    const field = { st: e.st, mire: spec };
    e.c.sgMireGroundTick(field, [target], ctx(e, [target]));
    const before = target.dots.map(d => ({ sid: d.sid, dps: d.dps }));
    e.c.sgMireGroundTick(field, [target], ctx(e, [target]));
    assert.deepEqual(target.dots.map(d => ({ sid: d.sid, dps: d.dps })), before);
    assert.equal(spec.poisonDps, 550, 'raw spec must stay unboosted for reuse');
    values.push(before);
  }
  assert.ok(values[0].length >= 2);
  assert.deepEqual(values[1], values[0].map(d => ({ sid: d.sid, dps: d.dps * 2 })));
});

test('spread from an already boosted thrust hit inherits area bonus once', () => {
  const e = setup(100), source = enemy(20), victim = enemy(50), out = { dmg: 0 };
  const hit = e.c.sgAreaHitOne(e.p, e.st, source, 1000, 'thrust', 'mv-float', out, 0);
  e.c.sgDerivedHit(victim, hit.dmg * 0.5, 'thrust', 'mv-float', out, '', 0);
  assert.equal(1e9 - source.hp, 2000);
  assert.equal(1e9 - victim.hp, 1000);
});

test('raw overload explosion gains area bonus but primary chain does not', () => {
  const e = setup(100), source = enemy(), victim = enemy(50), out = { dmg: 0 };
  e.c.sgChainOverload({ st: e.st, overload: { hits: 1 }, overloadDmg: 1000,
    overloadPx: 100, floatSel: 'mv-float', out }, source, [source, victim], 0);
  assert.ok(out.dmg > 0);
  assert.equal(1e9 - victim.hp, 2000);
});

test('undefined/negative/nonfinite area stats are neutral', () => {
  for (const value of [undefined, -100, NaN, Infinity]) {
    const e = setup(value), target = enemy(), out = { dmg: 0 };
    assert.equal(e.c.sgAreaHitOne(e.p, e.st, target, 1000, 'thrust', 'mv-float', out, 0).dmg, 1000);
  }
  const e = setup();
  for (const v of [undefined, 0, -100, NaN, Infinity]) assert.equal(e.c.areaDamageMultiplier(v), 1);
  e.st.aoeDmg = 1000;
  const victim = enemy(), out = { dmg: 0 };
  e.c.sgDerivedHit(victim, 500, 'fireball', 'mv-float', out, '', 0, undefined, { fixedPct: true });
  assert.equal(1e9 - victim.hp, 500);
});


test('area damage keeps geometry, impact timing and visual hit counts unchanged', () => {
  for (const gid of ['fireball', 'waterball', 'cleave', 'frostnova']) {
    const a = cast(gid, 0), b = cast(gid, 100);
    assert.deepEqual(JSON.parse(JSON.stringify(b.events)), JSON.parse(JSON.stringify(a.events)), gid);
    assert.deepEqual(b.floats.map(f => f.amount), a.floats.map(f => f.amount * 2), gid);
  }
  const fireball = cast('fireball', 100);
  const impact = fireball.events.find(e => e.variant === 'fire-explosion');
  assert.equal(impact.area.r, 60, 'impact VFX uses actual six-meter blast radius from projectile');
});

test('meteor scope follows blast radius; damage happens only at impact and covers current victims', () => {
  for (const radius of [0, 60]) {
    const e = setup(100), target = enemy(20), moved = enemy(30), entering = enemy(1000), out = { dmg: 0 };
    const enemies = [target, moved, entering];
    e.c.sgQueueMeteor(e.p, e.st, 1000, target, enemies, radius, null, 'mv-float', out, 1,
      { gid: 'thunderstrike', variant: 'test-meteor' });
    e.c.GT = 0.99; e.c.sgTickMeteors(ctx(e, enemies));
    assert.equal(out.dmg, 0);
    moved.pos.x = 1000; entering.pos.x = 30;
    e.c.GT = 1; e.c.sgTickMeteors(ctx(e, enemies));
    assert.equal(1e9 - target.hp, radius ? 2000 : 1000);
    assert.equal(1e9 - moved.hp, 0);
    assert.equal(1e9 - entering.hp, radius ? 2000 : 0);
    assert.equal(e.tracked.reduce((a, b) => a + b, 0), out.dmg);
  }
});

test('counter holy orb is area even against one target; normal counter remains single', () => {
  const e = setup(100), target = enemy();
  e.c.sgResolveCounterHolyOrb({ pEnt: e.p, st: e.st, target, dmgVal: 1000,
    area: { x: 20, y: 0, r: 100 }, floatSel: 'mv-float', roles: {} }, ctx(e, [target]));
  assert.equal(1e9 - target.hp, 2000);
});

test('fixed-percent starfall does not gain area damage', () => {
  const values = [];
  for (const pct of [0, 1000]) {
    const e = setup(pct), target = enemy();
    e.c.sgStarfallImpact(ctx(e, [target]), { lv: 1, def: { fx: { normal: 10, elite: 5, boss: 1 } } });
    values.push(1e9 - target.hp);
  }
  assert.deepEqual(values, [1e8, 1e8]);
});

test('equipped affix aggregation feeds the area skill pipeline', () => {
  const e = setup();
  e.c.G.equipment = { ring: { level: 100, rarity: 4, upgrade: 0,
    affixes: [{ key: 'aoeDmg', roll: 100 }] } };
  vm.runInContext(fs.readFileSync(path.join(root, 'js/item.js'), 'utf8'), e.c, { filename: 'item' });
  const stats = e.c.computeStats();
  assert.ok(stats.aoeDmg > 0);
  const target = enemy(), out = { dmg: 0 };
  const hit = e.c.sgAreaHitOne(e.p, stats, target, 1000, 'thrust', 'mv-float', out, 0);
  const single = e.c.sgHitOne(e.p, { ...stats, aoeDmg: 0 }, enemy(), 1000, 'thrust', 'mv-float', { dmg: 0 }, 0);
  assert.equal(hit.dmg, Math.round(single.dmg * (1 + stats.aoeDmg / 100)));
  assert.ok(hit.dmg > single.dmg);
});


test('cleave single-target spin proc does not inherit its parent area scope', () => {
  const values = [];
  for (const pct of [0, 100]) {
    const e = setup(pct), target = enemy(), out = { dmg: 0 };
    e.c.sgCleaveSpinHit({ pEnt: e.p, st: e.st, out, floatSel: 'mv-float', vacuum: { pct: 100, gap: 0.2 } },
      target, ctx(e, [target]), 0.2);
    values.push(1e9 - target.hp);
  }
  assert.deepEqual(values, [1000, 1000]);
});


test('raw disintegrate and burn explosions each gain one area multiplier', () => {
  for (const kind of ['disintegrate', 'burn']) {
    const values = [];
    for (const pct of [0, 100]) {
      const e = setup(pct), source = enemy(20), victim = enemy(50);
      const out = { dmg: 0 };
      if (kind === 'disintegrate') {
        e.c.sgDisintegrate(source, 'sgBleed', { dps: 100 }, 2,
          { lv: 1, def: { fx: { pct: 100, m: 10 } } },
          { enemies: [source, victim], floatSel: 'mv-float', out });
      } else {
        e.c.G.player.skills2.levels.fireball = [1, 1, 1, 1, 1, 0, 0];
        source._sgBurnWatch = { dps: 100, dur: 2, until: 0 };
        e.c.sgBurnBlast(source, [source, victim], ctx(e, [source, victim]));
      }
      values.push(1e9 - victim.hp);
      assert.equal(source.hp, 1e9, 'explosion must exclude its original source');
    }
    assert.ok(values[0] > 0, kind);
    assert.equal(values[1], values[0] * 2, kind);
  }
});

test('mire area DoT ticks consume the boosted snapshot without multiplying again', () => {
  const values = [];
  for (const pct of [0, 100]) {
    const e = setup(pct), target = enemy(), levels = [1, 1, 1, 0, 0, 0, 0];
    e.c.G.player.skills2.levels.mire = levels;
    e.c.FIELD.player = e.p;
    const spec = e.c.sgMireSpec(e.c.SKILLS2.mire, levels, e.st);
    e.c.sgMireGroundTick({ st: e.st, mire: spec }, [target], ctx(e, [target]));
    e.c.GT = 0.5;
    e.c.tickStatuses(target, 0.5);
    values.push(1e9 - target.hp);
  }
  assert.deepEqual(values, [275, 550]);
});

test('fireball area blast and its single-target split use distinct damage scopes', () => {
  const e = setup(100), blastTarget = enemy(20), splitTarget = enemy(50), out = { dmg: 0 };
  const projectile = { pEnt: e.p, st: e.st, dmgVal: 1000, floatSel: 'mv-float', out,
    blastRadius: 60, victims: [blastTarget] };
  e.c.sgFireballProjectileHit(projectile, blastTarget, ctx(e, [blastTarget, splitTarget]));
  e.c.sgFireballSplitProjectileHit(projectile, splitTarget, ctx(e, [blastTarget, splitTarget]));
  assert.equal(1e9 - blastTarget.hp, 2000);
  assert.equal(1e9 - splitTarget.hp, 1000);
});

test('main thread and Worker load matching formula and skill cache versions', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
  for (const name of ['formula', 'skills2']) {
    const re = new RegExp(name + String.raw`\.js\?v=([^'"\s]+)`);
    assert.equal(html.match(re)[1], worker.match(re)[1]);
  }
});
