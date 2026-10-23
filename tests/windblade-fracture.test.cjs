const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/battle-scene.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

function enemy(name = 'target', x = 120, y = 0) {
  return { name, hp: 1e9, maxHp: 1e9, level: 1, pos: { x, y },
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0 };
}

function load(lv = 1) {
  const events = [], hits = [];
  const c = { console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {},
    floatEnemyEvent() {}, floatPlayerEvent() {}, _diag() {}, SHIM_DIAG: { ui: 0 } };
  c.window = c; vm.createContext(c);
  for (const name of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2']) {
    vm.runInContext(read('js/' + name + '.js'), c, { filename: name });
  }
  const g = c.SKILLS2.windblade;
  if (g.tiers[5].fx.movePer === undefined) {
    // 正式配置依使用者安排稍後BAT；測試只在記憶體讀取本任務待套用提案。
    const queue = path.join(root, 'config/param-patches');
    const requests = fs.readdirSync(queue).filter(n => n.endsWith('.json'))
      .map(n => JSON.parse(fs.readFileSync(path.join(queue, n), 'utf8')))
      .filter(p => p.task === 'WINDBLADE-FRACTURE-SLOW-20261020');
    assert.equal(requests.length, 1);
    const cells = requests[0].changes;
    const fx = cells.find(x => x.workbook === 'Skills2.xlsx' && x.column === '效果參數(JSON)');
    g.tiers[5].fx = JSON.parse(fx.after);
    g.tiers[5].desc = cells.find(x => x.column === '效果說明模板').after;
    c.STATUS.sgWindSlow.val = cells.find(x => x.workbook === 'Status.xlsx' && x.column === '效果數值').after;
    c.STATUS.sgWindSlow.desc = cells.find(x => x.workbook === 'Status.xlsx' && x.column === '說明').after;
  }
  const levels = [1, 1, 1, 1, 1, lv, 0];
  c.G = { player: { level: 1000, skills2: { levels: { windblade: levels }, ult: {} },
    loadout: ['sg:windblade'] }, tower: { highest: 100 }, stage: { current: 1 } };
  const p = { hp: 1000, mp: 1e6, pos: { x: 0, y: 0 }, effects: {}, buffs: {}, dots: [], skillCds: {} };
  const st = { atk: 1000, matk: 500, hp: 1000, mp: 1e6, level: 1000, cdr: 0,
    passives: {}, legendaryEffects: {}, legendaryEffectMults: {}, elemDmgUp: {} };
  c.getStats = () => st;
  c.FIELD.player = p; c.bfPlayerPos = () => p.pos;
  c.Math.random = () => .999;
  c.GT = 0;
  c.enemyEventFloatTarget = e => e.name; c.playerEventFloatTarget = sel => sel;
  c.shimPushEvent = (kind, spec) => events.push({ at: c.GT, spec });
  vm.runInContext(extractFunction(read('js/worker/shim.js'), 'playCombatVfx'), c);
  c.resolveHit = (attacker, target, cfg) => {
    hits.push({ at: c.GT, target, cfg });
    const mode = target.mode;
    if (mode === 'kill') target.hp = 0;
    return { dmg: mode === 'miss' || mode === 'invuln' ? 0 : 100,
      miss: mode === 'miss', invuln: mode === 'invuln', killed: mode === 'kill', crit: false };
  };
  c.applySkillFinalDamageMultiplier = () => {};
  // 隔離正常大型風刃；小刃／追擊的共用入口另外測，不讓多道命中干擾時序。
  g.tiers[3].fx.pct = g.tiers[3].fx.pctPer = 0;
  let pool = [enemy()];
  const ctx = { pEnt: p, getEnemies: () => pool, floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
  function run(seconds) {
    for (let i = 0; i < Math.round(seconds * 100); i++) { c.GT += .01; c.tickSkill2(.01, ctx); }
  }
  function launch(small = false, gid = 'windblade') {
    const geom = c.sgWindbladeGeom(g, c.skills2Levels('windblade'), {});
    c.sgLaunchWindBlade(p, st, gid, { geom, angle: 0, dmgVal: 500, pool, geomOk: true,
      fallback: [pool[0]], small }, 'mv-float', { dmg: 0, killed: false });
  }
  return { c, g, p, st, events, hits, ctx, run, launch, get pool() { return pool; }, setPool(v) { pool = v; } };
}

test('狂風碎裂：Lv1／5／10雙緩速為22／30／40%，抵達前不附加', () => {
  for (const [lv, value] of [[1, 22], [5, 30], [10, 40]]) {
    const h = load(lv), e = h.pool[0];
    h.launch(); assert.equal(h.c.buffVal(e, 'sgWindSlow'), 0);
    h.run(.1); assert.equal(h.c.buffVal(e, 'sgWindSlow'), 0);
    h.run(.7); assert.equal(h.c.buffVal(e, 'sgWindSlow'), value);
    near(h.c.bfEnemySpeedFactor(e), 1 - value / 100);
    near(h.c.slowFactor(e), 1 - value / 100);
    near(h.c.skill2SlowAspdFactor(e), 1 - value / 100);
    assert.match(h.c.describeSkill2Tier('windblade', 5, lv), new RegExp(`移動速度 -${value}%、攻速 -${value}%`));
  }
});

test('狂風碎裂：大小直射與追擊風刃均附加同一個雙緩速，跨樹借用不附加', () => {
  for (const mode of ['big', 'small', 'chaser', 'bigChaser', 'borrowed']) {
    const h = load();
    if (mode === 'chaser' || mode === 'bigChaser') {
      const geom = h.c.sgWindbladeGeom(h.g, h.c.skills2Levels('windblade'), {});
      h.c.sgSpawnWindChaser(h.p, h.st, h.g, h.c.skills2Levels('windblade'), 0, 500, geom, 'mv-float',
        mode === 'bigChaser' ? { radius: geom.halfWidthPx } : {});
    } else h.launch(mode === 'small', mode === 'borrowed' ? 'vacuumslash' : 'windblade');
    h.run(1.2);
    assert.ok(h.hits.length, mode);
    assert.equal(h.c.buffVal(h.pool[0], 'sgWindSlow'), mode === 'borrowed' ? 0 : 22, mode);
    assert.ok(h.events.every(x => !['wind-burst', 'wind-burst-hit'].includes(x.spec.variant)), mode);
  }
});

test('狂風碎裂：普通施放／暴風萬刃／天穹被動小刃皆不再產生周圍脈衝', () => {
  for (const ult of [null, 'stormMyriad', 'skyCollapse', 'stormMountain']) {
    const h = load(10);
    h.g.tiers[5].fx = { ...h.g.tiers[5].fx, pct: 50, gap: .1, m: 30 }; // 殘留舊欄也不能重啟傷害。
    if (ult) {
      h.c.G.player.skills2.levels.windblade = [10, 10, 10, 10, 10, 10, 10];
      h.c.G.player.skills2.ult.windblade = { pick: h.c.sgUltIndexOfId('windblade', ult), lv: 1 };
      assert.ok(h.c.sgUlt('windblade', ult));
    }
    if (ult === 'skyCollapse') {
      h.g.tiers[3].fx.pct = 30; h.g.tiers[3].fx.pctPer = 3;
      h.c.Math.random = () => 0;
      h.c.sgSkyCollapseOnPlayerDamaged(h.pool[0], h.p, 'mv-float');
    } else assert.ok(h.c.castSkill2(h.p, h.pool, 'windblade', 'mv-float'));
    const bodies = [...h.c.SKILL2_RT.projectiles, ...h.c.SKILL2_RT.grounds];
    assert.ok(bodies.length, String(ult));
    assert.ok(bodies.every(x => x.pulseDmg === 0 && x.pulseGap === 0), String(ult));
    h.run(1.2);
    assert.ok(h.hits.length, String(ult));
    assert.equal(h.c.buffVal(h.pool[0], 'sgWindSlow'), 40, String(ult));
    assert.ok(h.events.every(x => !['wind-burst', 'wind-burst-hit'].includes(x.spec.variant)), String(ult));
  }
});

test('狂風碎裂：MISS／無敵／致死不附加，未學本階不附加', () => {
  for (const mode of ['miss', 'invuln', 'kill', 'unlearned']) {
    const h = load(mode === 'unlearned' ? 0 : 1);
    h.pool[0].mode = mode; h.launch(); h.run(1);
    assert.ok(h.hits.length);
    assert.equal(h.c.buffVal(h.pool[0], 'sgWindSlow'), 0, mode);
    assert.equal(h.c.slowFactor(h.pool[0]), 1, mode);
  }
});

test('狂風碎裂：刷新沿三秒原持續時間，狀態列數值與描述一致，到期恢復', () => {
  const h = load(), e = h.pool[0]; h.launch(); h.run(.8);
  const first = e.buffs.sgWindSlow.until;
  const entry = h.c.statusEntries(e).find(x => x.sid === 'sgWindSlow');
  assert.equal(entry.val, 22); assert.equal(entry.dur, 3); assert.equal(entry.stacks, 1);
  assert.match(h.c.STATUS.sgWindSlow.desc, /移動速度與攻速/);
  h.launch(); h.run(.8); assert.ok(e.buffs.sgWindSlow.until > first);
  assert.equal(e.buffs.sgWindSlow.stacks, 1);
  h.c.GT = e.buffs.sgWindSlow.until + .001;
  near(h.c.bfEnemySpeedFactor(e), 1); near(h.c.slowFactor(e), 1);
  assert.ok(!h.c.statusEntries(e).some(x => x.sid === 'sgWindSlow'));
});

test('狂風碎裂：攻速與移速控場分開遞減，Boss沿既有規則免疫攻速控制', () => {
  const h = load(), e = h.pool[0]; e._spawnAt = 0; h.launch(); h.run(.8);
  assert.equal(e.ccDr.aspd.n, 1); assert.equal(e.ccDr.move.n, 1);
  e.ccLock.aspd = h.c.GT - .01;
  near(h.c.slowFactor(e), 1); near(h.c.bfEnemySpeedFactor(e), .78);
  h.launch(); h.run(.8);
  assert.equal(e.ccDr.aspd.n, 2); assert.equal(e.ccDr.move.n, 1, '未到期的移速類不重複計次');
  assert.ok(e.ccLock.aspd < e.ccLock.move, '第二次攻速類持續時間獨立遞減');
  e.ccLock.move = h.c.GT - .01;
  near(h.c.bfEnemySpeedFactor(e), 1);
  const boss = load(); boss.pool[0].isBoss = true; boss.launch(); boss.run(.8);
  assert.equal(boss.c.buffVal(boss.pool[0], 'sgWindSlow'), 22);
  near(boss.c.slowFactor(boss.pool[0]), 1); near(boss.c.bfEnemySpeedFactor(boss.pool[0]), .78);
});

test('狂風碎裂：移除周圍傷害後不影響本體傷害／幾何與Worker本體命中事件', () => {
  const run = lv => {
    const h = load(lv); h.setPool([enemy('target'), enemy('nearby', 120, 90)]);
    assert.ok(h.c.castSkill2(h.p, h.pool, 'windblade', 'mv-float'));
    h.run(2);
    return h;
  };
  const off = run(0), on = run(1);
  assert.deepEqual(on.hits.map(x => [x.target.name, x.cfg.atk]), off.hits.map(x => [x.target.name, x.cfg.atk]));
  assert.ok(on.hits.every(x => x.target.name === 'target'), '附近但不在刃路徑上的敵人不受傷');
  const body = h => h.events.filter(x => x.spec.variant === 'wind-blade' && x.spec.fxKind === 'projectile')
    .map(x => [x.spec.lineLength, x.spec.lineWidth, ...x.spec.travelMs]);
  assert.deepEqual(body(on), body(off));
  assert.ok(on.events.some(x => x.spec.fxKind === 'projectile' && x.spec.vfx.projectile === 'proj-wind-crescent'));
  assert.ok(on.events.some(x => x.spec.fxKind === 'impact' && x.spec.vfx.hit === 'hit-wind'));
  assert.equal(on.c.statusEntries(on.pool[1]).length, 0, '周圍未命中者也不附加減益');
});
