const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function fixture(ult, legendary, noPositions) {
  const hits = [], events = [];
  const c = { console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {} };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), c);
  }
  c.G = { player: { level: 800, gold: 1e15, skills2: { levels: { thrust: Array(7).fill(10) }, ult: {} }, loadout: ['sg:thrust'] }, stage: { current: 1 } };
  c.GT = 0;
  c.getStats = () => ({ atk: 1000, matk: 0, hp: 1000, mp: 10000, level: 800, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, passives: {}, legendaryEffects: {}, legendaryEffectMults: {},
    elemDmgUp: {}, elemDmgPct: 0, totalDmgPct: 0, aoeDmg: 0 });
  c.chance = () => false;
  c.resolveHit = (_, target) => {
    hits.push(target); target.hp -= 100;
    return { dmg: 100, crit: false, miss: false, blocked: false, killed: false };
  };
  c.trackDps = c.recordRunDamage = c.applySkillFinalDamageMultiplier = () => {};
  c.playCombatVfx = e => events.push(e);
  c.enemyEventFloatTarget = e => e.name;
  if (ult) c.G.player.skills2.ult.thrust = { pick: c.sgUltIndexOfId('thrust', ult), lv: 10 };
  if (legendary) c.sgLegend = () => ({ octaToSingle: true });
  const p = { hp: 1000, mp: 10000, skillCds: {}, buffs: {}, dots: [], effects: {}, shield: 0 };
  c.FIELD = { player: p };
  const targets = Array.from({ length: 8 }, (_, i) => ({ name: '方向' + i, hp: 1e9, maxHp: 1e9,
    def: 0, mdef: 0, level: 1, effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    pos: { x: Math.cos(i * Math.PI / 4) * 120, y: Math.sin(i * Math.PI / 4) * 120 } }));
  // 更近的斜向主目標仍在近戰施法距離內，卻在四向線寬之外。
  const diagonal = { ...targets[1], name: '斜向主目標', pos: { x: 49.4, y: 49.4 }, buffs: {}, effects: {}, dots: [] };
  p._lockTarget = diagonal;
  const pool = [diagonal, ...targets];
  if (noPositions) pool.forEach(t => delete t.pos);
  const out = c.castSkill2(p, pool, 'thrust', 'mv-float');
  assert.ok(out, '正式施放應成功（fixture 提供足夠 MP）');
  const waves = events.filter(e => e.variant === 'thrust-octagonal' || e.variant === 'thrust-pierce');
  return { c, p, pool, targets, diagonal, hits, waves };
}

function advance(f, seconds = 2) {
  for (let i = 0; i < seconds * 20; i++) {
    f.c.GT += 0.05;
    f.c.tickSkill2(0.05, { pEnt: f.p, getEnemies: () => f.pool, floatSel: 'mv-float', onDeaths() {} });
  }
}

test('四方突刺：固定上下左右，斜向主目標不旋轉方向、不強制命中', () => {
  const f = fixture();
  assert.equal(f.c.SKILLS2.thrust.tiers[6].name, '四方突刺');
  assert.equal(f.c.SKILLS2.thrust.tiers[6].fx.directions, 4);
  assert.equal(f.waves.length, 4);
  assert.ok(f.waves.every(w => w.angle === 0 && w.directionCount === 4 && w.laneOffsets.length === 3));
  const ps = f.c.SKILL2_RT.projectiles;
  assert.equal(ps.length, 48, '四波 × 四向 × 三平行道');
  for (let wave = 0; wave < 4; wave++) {
    assert.equal(f.waves[wave].delayMs || 0, wave * 200);
    assert.ok(ps.slice(wave * 12, (wave + 1) * 12).every(p => Math.abs(p.beginAt - wave * 0.2) < 1e-9));
  }
  advance(f);
  f.targets.forEach((target, i) => assert.equal(f.hits.includes(target), i % 2 === 0, target.name));
  assert.equal(f.hits.includes(f.diagonal), false, '斜向主目標不能因鎖定被補入直線命中');
});

test('幻影八方陣：同波八方向、保留三道平行與絕對閃避', () => {
  const f = fixture('phantomOcta');
  assert.equal(f.c.SKILLS2.thrust.ult[0].fx.directions, 8);
  assert.ok(f.waves.every(w => w.angle === 0 && w.directionCount === 8 && w.vfx.attack === 'slash-thrust-scatter-blue'));
  assert.equal(f.c.SKILL2_RT.projectiles.length, 96);
  assert.equal(f.c.buffVal(f.p, 'sgPhantomDodge'), 30);
  const angles = f.c.SKILL2_RT.projectiles.slice(0, 24).map(p => p.angle);
  assert.equal(new Set(angles.map(a => a.toFixed(6))).size, 8);
  advance(f);
  assert.ok(f.targets.every(t => f.hits.includes(t)), '八向敵人皆由突刺本體命中');
  assert.ok(f.hits.includes(f.diagonal));
  advance(f, 1);
  assert.equal(f.c.buffVal(f.p, 'sgPhantomDodge'), 0);
});

test('幻影八方陣：命中傷害全額擴散，距離外目標不吃全額擴散', () => {
  const f = fixture('phantomOcta');
  const near = { ...f.targets[0], name: '附近', pos: { x: 120, y: 50 }, buffs: {}, effects: {}, dots: [] };
  const far = { ...near, name: '遠方', pos: { x: 1000, y: 1000 } };
  f.pool.push(near, far);
  const derived = [];
  f.c.sgDerivedHit = (target, dmg) => { derived.push({ target, dmg }); return { dmg, killed: false }; };
  advance(f);
  assert.ok(derived.some(h => h.target === near && h.dmg === 100));
  assert.equal(derived.some(h => h.target === far && h.dmg === 100), false);
});

test('高塔缺少幾何座標時，多向事件仍明確傳固定世界方位', () => {
  for (const ult of [null, 'phantomOcta']) {
    const f = fixture(ult, false, true);
    assert.ok(f.waves.every(w => w.angle === 0 && w.directionCount === (ult ? 8 : 4)));
  }
});

for (const [ult, legendary] of [[null, true], ['oneStrikeKill', false], ['phantomOcta', true], ['shadowExecutioner', false]]) {
  test('突刺方向改寫相容：' + (ult || '貫日之刺') + (legendary && ult ? '＋貫日之刺' : ''), () => {
    const f = fixture(ult, legendary);
    const single = legendary || ult === 'oneStrikeKill';
    assert.ok(f.waves.every(w => w.directionCount === (single ? 1 : 4)));
    assert.ok(f.waves.every(w => Math.abs(w.angle - (single ? Math.PI / 4 : 0)) < 1e-9));
  });
}

test('DOM 突刺遵守事件方位，舊事件缺方位／null 時才朝目標', () => {
  const angles = [];
  const c = { console, document: { hidden: false, addEventListener() {} }, setTimeout() {}, clearTimeout() {} };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/vfx.js'), 'utf8'), c);
  c._vfxEnabled = true;
  c.vfxLayer = () => ({});
  c.vfxPointOf = () => ({ x: 45, y: 45 });
  c.vfxOriginPoint = () => ({ x: 0, y: 0 });
  c.vfxStagger = () => 0;
  c.vfxThrustLine = (...args) => angles.push(args[8]);
  const spec = { fxKind: 'slash', variant: 'thrust-octagonal', projectile: true, targets: ['diagonal'],
    count: 1, lineLength: 240, lineWidth: 60, laneOffsets: [0], directionCount: 4 };
  c.renderCombatVfx({ ...spec, angle: 0 });
  assert.deepEqual(angles, [0, Math.PI / 2, Math.PI, Math.PI * 1.5]);
  for (const angle of [undefined, null]) {
    angles.length = 0;
    c.renderCombatVfx({ ...spec, angle });
    assert.equal(angles[0], Math.PI / 4);
  }
});
