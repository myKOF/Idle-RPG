const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('Incomplete function: ' + name);
}

function enemy(name, x = 100) {
  return { name, hp: 1e9, maxHp: 1e9, level: 1, pos: { x, y: 0 },
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0 };
}

function load(lv = 1) {
  const events = [], hits = [], bolts = [], casts = [];
  const c = { console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {},
    floatEnemyEvent() {}, floatPlayerEvent() {}, _diag() {}, SHIM_DIAG: { ui: 0 } };
  c.window = c;
  vm.createContext(c);
  for (const name of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2']) {
    vm.runInContext(read('js/' + name + '.js'), c, { filename: name });
  }
  // 使用者稍後才按BAT：僅在測試記憶體套用本任務佇列，正式配置不先改寫。
  const option = c.SKILLS2.chainlightning.ult.find(u => u.id === 'skyThunderArray');
  if (option.fx.sec !== undefined) {
    const queue = path.join(root, 'config/param-patches');
    const requests = fs.readdirSync(queue).filter(name => name.endsWith('.json'))
      .map(name => JSON.parse(fs.readFileSync(path.join(queue, name), 'utf8')))
      .filter(request => request.task === 'INFINITE-LIGHTNING-20261020');
    assert.equal(requests.length, 1, '新配置尚未套用時必須保留唯一的待套用請求');
    const cells = new Map(requests[0].changes.filter(change =>
      change.key['群組ID'] === 'chainlightning' && change.key['超神ID'] === 'skyThunderArray')
      .map(change => [change.column, change.after]));
    assert.equal(cells.size, 4);
    option.fx = require('../tools/skills2-geometry.cjs').apply('chainlightning', 'skyThunderArray',
      JSON.parse(cells.get('效果參數(JSON)')), column => cells.get(column) || '').fx;
    option.desc = cells.get('效果說明模板');
  }
  c.G = { player: { skills2: { levels: { chainlightning: [10, 10, 10, 10, 10, 10, 10] },
    ult: { chainlightning: { pick: c.sgUltIndexOfId('chainlightning', 'skyThunderArray'), lv } } },
    loadout: ['sg:chainlightning'] }, stage: { current: 1 } };
  const p = { hp: 1000, mp: 0, effects: {}, buffs: {}, dots: [], skillCds: { 'sg:chainlightning': 9 } };
  const st = { hp: 1000, mp: 1000, atk: 1000, matk: 500, level: 10, cdr: 0,
    passives: {}, legendaryEffects: {}, legendaryEffectMults: {}, elemDmgUp: {} };
  c.getStats = () => st;
  c.Math.random = () => .999;
  c.GT = 0;
  c.enemyEventFloatTarget = e => e.name;
  c.playerEventFloatTarget = sel => sel;
  c.shimPushEvent = (kind, spec) => events.push({ at: c.GT, spec });
  vm.runInContext(extractFunction(read('js/worker/shim.js'), 'playCombatVfx'), c);
  c.resolveHit = (attacker, target, cfg) => {
    hits.push({ at: c.GT, target, cfg });
    return { dmg: 100, crit: false, miss: false, killed: false };
  };
  c.applySkillFinalDamageMultiplier = () => {};
  const bolt = c.sgChainlightningBolt;
  c.sgChainlightningBolt = (...args) => { bolts.push(args[2]); return bolt(...args); };
  const cast = c.castSkill2;
  c.castSkill2 = (...args) => { casts.push({ at: c.GT, opts: args[4] }); return cast(...args); };
  let pool = [enemy('a')];
  const ctx = { pEnt: p, getEnemies: () => pool, floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
  function auto(at, dt = .01) { c.GT = at; c.sgTickInfiniteLightning(ctx, dt); }
  function settle() {
    let guard = 0;
    while (c.SKILL2_RT.meteors.length && guard++ < 3000) {
      c.GT += .01; c.sgTickMeteors(ctx);
    }
    assert.ok(guard < 3000, '有限雷鏈必須結束');
  }
  return { c, p, st, ctx, events, hits, bolts, casts, auto, settle,
    setPool(next) { pool = next; }, get pool() { return pool; } };
}

test('無限閃電：間隔及升級說明共用表格，裝配後首拍才發射', () => {
  for (const [lv, gap] of [[1, .94], [5, .7], [10, .4]]) {
    const h = load(lv), option = h.c.SKILLS2.chainlightning.ult.find(u => u.id === 'skyThunderArray');
    assert.deepEqual(JSON.parse(JSON.stringify(option.fx)), { gap: 1, gapPer: -.06 });
    assert.ok(Math.abs(h.c.sgInfiniteLightningGap() - gap) < 1e-9);
    assert.match(h.c.describeSkill2Ult('chainlightning', 0, lv), new RegExp(String(gap) + ' 秒'));
    h.c.tickSkill2(.01, h.ctx);
    h.auto(gap - .001); assert.equal(h.bolts.length, 0);
    h.c.GT = gap; h.c.tickSkill2(.001, h.ctx); assert.equal(h.bolts.length, 1);
  }
  const h = load();
  h.c.SKILLS2.chainlightning.ult[0].fx = { gap: .8, gapPer: -.02 };
  assert.ok(Math.abs(h.c.sgInfiniteLightningGap() - .78) < 1e-9, '調表後不寫死節拍');
});

test('無限閃電：不需先施放、持續自動發射，零法力與既有冷卻均不阻擋', () => {
  const h = load();
  let hooks = 0; h.c.rwOnSkillCast = h.c.recordRunSkillCast = () => hooks++;
  h.auto(0);
  for (let i = 0; i < 8; i++) h.auto(h.c.SKILL2_RT.infiniteLightningAt);
  assert.equal(h.bolts.length, 8, '跨過舊持續時間仍發射');
  assert.equal(h.p.mp, 0); assert.equal(h.p.skillCds['sg:chainlightning'], 9);
  assert.equal(hooks, 0, '免費自動鏈不觸發付費施法連鎖');
  assert.ok(h.casts.every(x => x.opts.repeat && x.opts.singleChain));
  assert.equal(h.c.SKILL2_RT.ultRepeat.chainlightning, undefined);
});

test('無限閃電：同一條鏈保留1～7階傷害、彈射、雷鳴與靜電，不會分裂', () => {
  const h = load(), t = h.c.SKILLS2.chainlightning.tiers;
  t[6].fx.chance = 100;
  h.setPool(Array.from({ length: 8 }, (_, i) => enemy('e' + i, 60 + i * 20)));
  h.auto(0); h.auto(.94); h.settle();
  assert.equal(h.bolts.length, 1, '即使T7必定觸發也不能增生另一條鏈');
  const cfg = h.bolts[0];
  assert.equal(cfg.dmgVal, 3500); assert.equal(cfg.links, 7);
  assert.equal(cfg.extraHits, 2); assert.equal(cfg.splashPct, 50);
  assert.equal(cfg.splashCount, 1); assert.equal(cfg.splashPx, 60);
  assert.equal(h.hits.length, 27, '7次命中各附2次雷鳴，6次彈射各1次靜電');
  assert.equal(h.hits.filter(x => x.cfg.atk === 3500).length, 21);
  assert.equal(h.hits.filter(x => x.cfg.atk === 1750).length, 6);
  const travel = h.events.filter(x => x.spec.variant === 'lightning-chain');
  assert.equal(travel.length, 7); assert.equal(new Set(travel.map(x => x.spec.area.chainId)).size, 1);
  assert.equal(h.c.SG_CHAIN_ACTIVE, 0);
});

test('無限閃電：傳奇多道不突破自動單鏈限制，普通付費施放仍可多道', () => {
  const h = load();
  h.c.sgLegend = gid => gid === 'chainlightning' ? { chainBoltProc: { chance: 50, count: 2 } } : {};
  h.c.chance = () => true;
  h.auto(0); h.auto(.94); assert.equal(h.bolts.length, 1);
  h.settle(); h.bolts.length = 0;
  h.p.mp = 100000;
  h.c.SKILLS2.chainlightning.tiers[6].fx.chance = 0;
  const out = h.c.castSkill2(h.p, h.pool, 'chainlightning', 'mv-float');
  assert.ok(out); assert.equal(h.bolts.length, 4, 'T7兩道加傳奇兩道');
  assert.equal(h.p.mp, 90000); assert.ok(h.p.skillCds['sg:chainlightning'] > 0);
  assert.equal(h.c.SKILL2_RT.ultRepeat.chainlightning, undefined, '手動施放不啟動舊重施');
});

test('無限閃電：死亡暫停剩餘時間，暈眩／空場錯過不補發', () => {
  const h = load(); h.auto(0);
  h.p.hp = 0; h.c.GT = 2; h.c.tickSkill2(2, h.ctx);
  assert.ok(Math.abs(h.c.SKILL2_RT.infiniteLightningAt - 2.94) < 1e-9);
  h.p.hp = 1000; h.auto(2.939); assert.equal(h.bolts.length, 0);
  h.c.effectActive = (p, key) => key === 'stun';
  h.auto(2.94); assert.equal(h.bolts.length, 0);
  h.c.effectActive = () => false;
  h.setPool([]); h.auto(h.c.SKILL2_RT.infiniteLightningAt);
  h.setPool([enemy('a')]); h.auto(h.c.GT + .001); assert.equal(h.bolts.length, 0);
  h.auto(h.c.SKILL2_RT.infiniteLightningAt); assert.equal(h.bolts.length, 1);
  h.auto(100); assert.equal(h.bolts.length, 2, '大步長最多發射一拍，不爆量補發');
});

test('無限閃電：射程外不發射，卸下／換超神／重置後重新計時', () => {
  for (const mode of ['unequip', 'otherUlt', 'reset']) {
    const h = load(); h.auto(0);
    if (mode === 'unequip') h.c.G.player.loadout = [];
    if (mode === 'otherUlt') h.c.G.player.skills2.ult.chainlightning.pick = 1;
    if (mode === 'reset') h.c.resetSkill2RT();
    if (mode !== 'reset') { h.auto(.2); assert.equal(h.c.SKILL2_RT.infiniteLightningAt, 0); }
    h.c.G.player.loadout = ['sg:chainlightning']; h.c.G.player.skills2.ult.chainlightning.pick = 0;
    h.auto(.3); assert.ok(Math.abs(h.c.SKILL2_RT.infiniteLightningAt - 1.24) < 1e-9);
    h.auto(.94); assert.equal(h.bolts.length, 0);
    h.auto(1.24); assert.equal(h.bolts.length, 1);
  }
  const h = load(); h.setPool([enemy('far', 10000)]); h.auto(0); h.auto(.94);
  assert.equal(h.bolts.length, 0);
  h.c.SKILL2_RT.ultRepeat.chainlightning = { until: 100, nextAt: 1, gap: 1 };
  h.c.sgTickUltRepeat(h.ctx, .01);
  assert.equal(h.c.SKILL2_RT.ultRepeat.chainlightning, undefined, '熱套用撤除舊短期節拍');
});

test('無限閃電：真Worker事件經Renderer／Runtime／Core顯示單道，抵達才傷害', () => {
  const h = load(), nodes = [], wire = [], renderer = read('js/battle-renderer.js');
  h.setPool([enemy('a', 200)]);
  const points = { a: { x: 200, y: 0 }, 'mv-float': { x: 0, y: 0 } };
  const backend = { createNode(spec) { const node = { spec, frames: [] }; nodes.push(node); return node; },
    updateNode(node, t) { node.frames.push({ ...t }); }, destroyNode() {}, destroy() {} };
  const adapter = require('../js/vfx-runtime.js').create({ core: require('../js/vfx-core.js'),
    resolver: { has: () => true, resolve: id => '/' + id }, fxBackend: backend, billboardBackend: backend,
    ctx: { posOf: id => points[id], footOf: id => points[id], playerPos: () => points['mv-float'], chainPoint: id => points[id] } });
  adapter.registerPresets(['bolt-chain-travel-bluewhite-08', 'hit-lightning-08'].map(id => JSON.parse(read('vfx/presets/' + id + '.json'))));
  const r = { S: { ready: true, entities: { a: { state: 'idle', data: { hp: 1e9 } } },
    player: { dead: false }, vfxrt: adapter }, normalizeTowerVfxIds() {}, documentHidden: () => false };
  vm.createContext(r);
  for (const name of ['chainTargetAlive', 'isTargetBoundThunderVfx', 'vfxTargetLiveForSpec', 'vfxTargetsLive', 'fxGate', 'onVfx']) {
    vm.runInContext(extractFunction(renderer, name), r);
  }
  h.c.shimPushEvent = (kind, spec) => { wire.push({ at: h.c.GT, spec }); r.onVfx(spec); };
  try {
    h.auto(0); h.auto(.94);
    const travel = wire.filter(x => x.spec.variant === 'lightning-chain');
    assert.equal(travel.length, 1); assert.equal(travel[0].spec.count, 1);
    assert.equal(travel[0].spec.vfx.projectile, 'bolt-chain-travel-bluewhite-08');
    assert.equal(travel[0].spec.area.homingSpeed, 1200);
    assert.ok(Math.abs(travel[0].spec.travelMs[0] - 200 / 1200 * 1000) < 1e-9);
    assert.equal(h.hits.length, 0);
    adapter.update(.05);
    assert.ok(nodes.some(n => n.frames.some(t => t.visible !== false && t.alpha > 0 && t.scaleX > 0 && t.scaleY > 0)), '正式紫雷素材在飛行中可見');
    h.c.GT = 1.04; h.c.sgTickMeteors(h.ctx); assert.equal(h.hits.length, 0);
    h.c.GT = .94 + 200 / 1200 + 1e-9; h.c.sgTickMeteors(h.ctx);
    assert.equal(h.hits.length, 1);
    assert.ok(wire.some(x => x.spec.variant === 'lightning-chain-hit' && x.spec.vfx.hit === 'hit-lightning-08'));
    assert.equal(new Set(wire.filter(x => x.spec.variant === 'lightning-chain').map(x => x.spec.area.chainId)).size, 1);
  } finally { adapter.destroy(); }
});
