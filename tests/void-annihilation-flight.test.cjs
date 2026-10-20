const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/battle-scene.cjs');
const geometry = require('../tools/skills2-geometry.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function enemy(name, x, y = 20) {
  return { name, hp: 1e9, maxHp: 1e9, level: 1, pos: { x, y },
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0 };
}

function load(lv = 1, roll = .999) {
  const events = [], hits = [];
  const c = { console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {},
    floatEnemyEvent() {}, floatPlayerEvent() {}, _diag() {}, SHIM_DIAG: { ui: 0 } };
  c.window = c; vm.createContext(c);
  for (const name of ['util', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2']) {
    vm.runInContext(read('js/' + name + '.js'), c, { filename: name });
  }
  const g = c.SKILLS2.vacuumslash, option = g.ult.find(u => u.id === 'voidAnnihilation');
  if (option.fx.count === undefined) {
    // 使用者稍後BAT；只在測試記憶體套用已保存的正式差異與幾何接線。
    const dir = path.join(root, 'config/param-patches');
    const requests = fs.readdirSync(dir).filter(n => n.endsWith('.json'))
      .map(n => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')))
      .filter(p => p.task === 'VOID-ANNIHILATION-FLIGHT-20261020');
    assert.equal(requests.length, 1);
    const cells = new Map(requests[0].changes.filter(x => x.key['超神ID'] === 'voidAnnihilation')
      .map(x => [x.column, x.after]));
    option.fx = geometry.apply('vacuumslash', 'voidAnnihilation', JSON.parse(cells.get('效果參數(JSON)')),
      column => cells.get(column) || '').fx;
    option.desc = cells.get('效果說明模板');
    option.triggerVfx = { projectile: cells.get('觸發子彈'), hit: cells.get('觸發命中特效') };
  }
  c.G = { player: { level: 1000, skills2: { levels: { vacuumslash: Array(7).fill(10) },
    ult: { vacuumslash: { pick: c.sgUltIndexOfId('vacuumslash', 'voidAnnihilation'), lv } } },
    loadout: ['sg:vacuumslash'] }, tower: { highest: 100 }, stage: { current: 1 } };
  const p = { hp: 1000, mp: 0, pos: { x: 30, y: 20 }, effects: {}, buffs: {}, dots: [],
    skillCds: { 'sg:vacuumslash': 9 } };
  const st = { atk: 1000, matk: 500, hp: 1000, mp: 1000, level: 1000, cdr: 0,
    passives: {}, legendaryEffects: {}, legendaryEffectMults: {}, elemDmgUp: {} };
  c.FIELD.player = p; c.bfPlayerPos = () => p.pos;
  c.getStats = () => st; c.GT = 0; c.Math.random = () => roll;
  c.enemyEventFloatTarget = e => e.name; c.playerEventFloatTarget = sel => sel;
  c.shimPushEvent = (kind, spec) => events.push({ at: c.GT, spec });
  vm.runInContext(extractFunction(read('js/worker/shim.js'), 'playCombatVfx'), c);
  c.resolveHit = (attacker, target, cfg) => {
    hits.push({ at: c.GT, target, cfg }); target.hp -= 100;
    return { dmg: 100, crit: false, miss: false, killed: false };
  };
  c.applySkillFinalDamageMultiplier = () => {};
  let pool = [];
  const ctx = { pEnt: p, getEnemies: () => pool, floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
  function auto(at, dt = .01) { c.GT = at; c.sgTickVoidAnnihilation(ctx, dt); }
  function tick(at, dt = .01) { c.GT = at; c.sgTickFlyingProjectiles(dt, ctx); }
  function spawnOne(angle = 0) {
    c.Math.random = () => angle / (Math.PI * 2);
    const spec = c.sgVoidAnnihilationFlightSpec(c.sgUlt('vacuumslash', 'voidAnnihilation'));
    c.sgSpawnVoidFlights(p, st, g, c.skills2Levels('vacuumslash'), 'mv-float', { ...spec, count: 1 });
    return c.SKILL2_RT.projectiles.at(-1);
  }
  return { c, p, st, g, option, ctx, events, hits, auto, tick, spawnOne, setPool(v) { pool = v; } };
}

test('虛空滅界：半秒首拍與每批數量成長，空場零法力仍持續發射', () => {
  for (const [lv, roll, count] of [[1, .999, 2], [1, 0, 3], [5, .999, 3], [10, .999, 4]]) {
    const h = load(lv, roll);
    assert.deepEqual(JSON.parse(JSON.stringify(h.option.fx)), { count: 2, countPer: .2, gap: .5, flyM: 60, speed: 12 });
    h.c.tickSkill2(.01, h.ctx);
    h.auto(.499); assert.equal(h.c.SKILL2_RT.projectiles.length, 0);
    h.c.GT = .5; h.c.tickSkill2(.001, h.ctx);
    assert.equal(h.c.SKILL2_RT.projectiles.length, count);
    h.auto(1); assert.equal(h.c.SKILL2_RT.projectiles.length, count * 2);
    assert.equal(h.c.SKILL2_RT.orbits.length, 0);
    assert.equal(h.p.mp, 0); assert.equal(h.p.skillCds['sg:vacuumslash'], 9);
    assert.match(h.c.describeSkill2Ult('vacuumslash', 1, lv), /每 0.5 秒.*12 米.*60 米/);
  }
});

test('虛空滅界：每個獨立360度取向，不讀敵人或鎖定方位', () => {
  for (const pool of [[], [enemy('right', 300)], [enemy('left', -300), enemy('up', 0, -500)]]) {
    const h = load(10), rolls = [0, .25, .5, .75];
    h.setPool(pool); h.p._lockTarget = pool[0]; h.c.Math.random = () => rolls.shift();
    h.auto(0); h.auto(.5);
    const shots = h.c.SKILL2_RT.projectiles;
    assert.equal(shots.length, 4);
    shots.forEach((s, i) => { near(s.angle, i * Math.PI / 2); near(s.length, 600); near(s.speed, 120); });
    assert.equal(new Set(h.events.map(e => e.spec.area.id)).size, 4);
  }
});

test('虛空滅界：固定起點與直線，12米每秒前進，滿60米／五秒精確回收', () => {
  const h = load(), shot = h.spawnOne();
  near(shot.endAt - shot.startAt, 5); near(shot.halfWidthPx, 60);
  h.p.pos = { x: 1000, y: -1000 };
  h.tick(1); near(shot.lastDistance, 120); near(shot.origin.x, 30); near(shot.origin.y, 20);
  h.tick(4.999); near(shot.lastDistance, 599.88); assert.equal(h.c.SKILL2_RT.projectiles.length, 1);
  h.tick(5); near(shot.lastDistance, 600); assert.equal(h.c.SKILL2_RT.projectiles.length, 0);
  assert.equal(shot.out._pendingProjectiles, 0);
});

test('虛空滅界：依移動掃掠接觸才命中，可貫穿但同一敵人只打一次', () => {
  const h = load(), a = enemy('a', 330), b = enemy('b', 500), far = enemy('far', 900), side = enemy('side', 330, 200);
  h.setPool([a, b, far, side]); const shot = h.spawnOne();
  const reach = 300 - shot.halfWidthPx - h.c.bfEntityRadius(a);
  h.tick((reach - .01) / 120); assert.equal(h.hits.length, 0);
  h.tick((reach + .01) / 120); assert.deepEqual(h.hits.map(x => x.target.name), ['a']);
  h.tick(4.9); assert.deepEqual(h.hits.map(x => x.target.name), ['a', 'b'], '大步長也掃到中間敵人');
  h.tick(5); assert.equal(h.hits.length, 2);
  assert.ok(h.hits.every(x => x.cfg.atk === 4000), '沿第7階表定傷害，移除舊超神額外增傷');
  assert.equal(h.events.filter(x => x.spec.variant === 'void-disc-flight-hit').length, 2);
  const moved = load(); const e = enemy('moved', 300); moved.setPool([e]); const s = moved.spawnOne();
  e.pos.y = 1000; moved.tick(5); assert.equal(moved.hits.length, 0); near(s.angle, 0);
});

test('虛空滅界：死亡取消在途批次並暫停下一拍，暈眩跳過、卸下與重置清除計時', () => {
  const h = load(); h.auto(0); h.auto(.5);
  const shots = [...h.c.SKILL2_RT.projectiles];
  h.p.hp = 0; h.c.GT = .7; h.c.tickSkill2(.2, h.ctx);
  assert.equal(h.c.SKILL2_RT.projectiles.length, 0); near(h.c.SKILL2_RT.voidAnnihilateAt, 1.2);
  assert.ok(shots.every(s => s.out._pendingProjectiles === 0));
  h.p.hp = 1000; h.auto(1.199); assert.equal(h.c.SKILL2_RT.projectiles.length, 0);
  h.c.effectActive = (p, key) => key === 'stun'; h.auto(1.2); assert.equal(h.c.SKILL2_RT.projectiles.length, 0);
  h.c.effectActive = () => false; h.auto(1.7); assert.equal(h.c.SKILL2_RT.projectiles.length, 2);
  h.c.G.player.loadout = []; h.auto(2); assert.equal(h.c.SKILL2_RT.voidAnnihilateAt, 0);
  h.c.G.player.loadout = ['sg:vacuumslash']; h.auto(2.1); near(h.c.SKILL2_RT.voidAnnihilateAt, 2.6);
  h.c.resetSkill2RT(); assert.equal(h.c.SKILL2_RT.projectiles.length, 0); assert.equal(h.c.SKILL2_RT.voidAnnihilateAt, 0);
});

test('虛空滅界：普通第7階仍環繞四道，其他技能借用形態與傷害覆寫不變', () => {
  const h = load(); h.c.sgSpawnVoidDiscs(h.p, h.st, h.g, h.c.skills2Levels('vacuumslash'), 'mv-float', .3);
  assert.equal(h.c.SKILL2_RT.orbits.length, 4); assert.equal(h.c.SKILL2_RT.projectiles.length, 0);
  const snapshot = h.c.SKILL2_RT.orbits.map(f => ({ dmg: f.dmgVal, grow: f.growPxPerSec, rings: f.rings }));
  assert.ok(snapshot.every(f => f.dmg === 4000 && f.grow === 40));
  h.c.resetSkill2RT();
  h.c.sgSpawnVoidDiscs(h.p, h.st, h.g, [1, 1, 1, 1, 1, 1, 1], 'mv-float', .3,
    { plain: true, gid: 'stormbarrier', dmgVal: 123, keyPrefix: 'borrowed-', vfxUlt: 'myriadPhenomena' });
  assert.equal(h.c.SKILL2_RT.orbits.length, 4);
  assert.ok(h.c.SKILL2_RT.orbits.every(f => f.gid === 'stormbarrier' && f.dmgVal === 123));
  const zero = load(); zero.option.fx.count = zero.option.fx.countPer = 0; zero.auto(0); zero.auto(.5);
  assert.equal(zero.c.SKILL2_RT.orbits.length + zero.c.SKILL2_RT.projectiles.length, 0, '零數量不能退回舊單道');
});

test('虛空滅界：間隔／速度／飛行距離各自接表，不會當成傷害或環繞範圍', () => {
  const cells = { [geometry.labels.gap]: '.5', [geometry.labels.speed]: '12', [geometry.labels.travel]: '60' };
  const fx = geometry.apply('vacuumslash', 'voidAnnihilation', { count: 2, countPer: .2 }, col => cells[col] || '').fx;
  assert.deepEqual(fx, { count: 2, countPer: .2, gap: .5, flyM: 60, speed: 12 });
  const h = load(); h.option.fx = { count: 1, gap: .25, speed: 6, flyM: 18 };
  h.auto(0); h.auto(.25); const s = h.c.SKILL2_RT.projectiles[0];
  near(s.speed, 60); near(s.length, 180); near(s.endAt - s.startAt, 3);
  const empty = load(); empty.option.triggerVfx = {}; empty.g.tiers[6].fx.bodyM = 8;
  const body = empty.spawnOne(), event = empty.events.find(e => e.spec.variant === 'void-disc-flight').spec;
  near(body.halfWidthPx, 40); near(event.lineWidth, 80);
  assert.equal(event.vfx.projectile, undefined, '超神觸發欄留白不能回退第七階素材');
});

test('虛空滅界：正式Worker→Renderer→Runtime→Core在空場也顯示四向直線與五秒消失', () => {
  const Core = require('../js/vfx-core.js'), Runtime = require('../js/vfx-runtime.js');
  const preset = JSON.parse(read('vfx/presets/orb-void-disc.json'));
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const h = load(), nodes = [], backend = {
      createNode(spec) { const n = { spec, frames: [] }; nodes.push(n); return n; },
      updateNode(n, t) { n.t = { ...t }; n.frames.push(n.t); }, destroyNode(n) { n.dead = true; }, destroy() {} };
    const rt = Runtime.create({ core: Core, resolver: { has: () => true, resolve: id => id },
      fxBackend: backend, airBackend: backend, groundScale: .5,
      ctx: { playerPos: () => ({ x: 1000, y: 1000 }), posOf: () => ({ x: -1000, y: -1000 }) } });
    rt.registerPresets([preset]);
    const renderer = read('js/battle-renderer.js'), pending = [];
    const r = { S: { ready: true, entities: {}, player: { dead: false }, vfxrt: rt },
      POS_BUFFER_MS: Number(/var POS_BUFFER_MS = (\d+)/.exec(renderer)[1]),
      normalizeTowerVfxIds() {}, documentHidden: () => false,
      laterFrame(fn, ms) { pending.push({ fn, ms }); } };
    vm.createContext(r);
    for (const name of ['isTargetBoundThunderVfx', 'vfxTargetLiveForSpec', 'vfxTargetsLive', 'fxGate', 'onVfx']) {
      vm.runInContext(extractFunction(renderer, name), r);
    }
    try {
      h.spawnOne(angle); const e = h.events.find(x => x.spec.variant === 'void-disc-flight').spec;
      assert.equal(e.targets.length, 0); assert.equal(e.vfx.projectile, 'orb-void-disc');
      assert.equal(e.travelMs[0], 5000); assert.equal(e.lineWidth, 120);
      r.onVfx(e); assert.equal(nodes.length, 0, '沿一般方向型飛行物的既有位置緩衝');
      assert.equal(pending.length, 1); assert.equal(pending[0].ms, r.POS_BUFFER_MS);
      pending.shift().fn(); rt.update(.25);
      const visible = nodes.find(n => n.t && n.t.visible !== false && n.t.alpha > 0);
      assert.ok(visible, '正式素材飛行中必須可見');
      near(visible.t.x, 30 + Math.cos(angle) * 30); near(visible.t.y, (20 + Math.sin(angle) * 30) * .5);
      rt.update(4.749); assert.ok(nodes.some(n => !n.dead && n.t?.visible !== false && n.t?.alpha > 0), '五秒前仍可見');
      rt.update(.001);
      assert.equal(rt.stats().projectiles, 0, '五秒整走滿60米後回收飛行狀態');
      assert.equal(rt.stats().air.activeEffects + rt.stats().fx.activeEffects, 0);
      assert.ok(nodes.every(n => n.dead || n.t?.visible === false), '回收節點隱藏入池，不殘留循環圓盤');
    } finally { rt.destroy(); }
  }
});
