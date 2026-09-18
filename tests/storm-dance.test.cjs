const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(tower) {
  const c = { console, Math, UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {},
    setTimeout() {}, clearTimeout() {}, document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  c.window = c;
  vm.createContext(c);
  for (const f of ['util','data','status','formula','battlefield','combat','skills','skills2','tower'])
    vm.runInContext(fs.readFileSync('js/' + f + '.js', 'utf8'), c);
  const st = { hp: 10000, mp: 10000, atk: 100, matk: 0, aspd: 2, level: 1000,
    hpRegen: 0, mpRegen: 0, moveSpeed: 0, passives: {}, skillTriggers: {}, cdr: 0, critRate: 0, critDmg: 150, hit: 100 };
  c.getStats = () => st;
  c.G = { player: { gold: 0, skills2: { levels: { dualdance: [1,1,1,1,1,1,1] } }, loadout: ['sg:dualdance'] },
    stage: { current: 1, best: 1, kills: 0, zone: 'desert' }, tower: { active: tower } };
  const p = c.newPlayerEntity(st);
  const m = { name: '目標', hp: 1e9, maxHp: 1e9, pos: { x: 20, y: 0 }, _enterCd: 0,
    atkCd: 1000, aspd: 1, effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0, def: 0, mdef: 0, level: 1 };
  c.FIELD = { player: p, monster: m, monsters: [m], spawnCd: Infinity, reviveCd: 0,
    dpsWindow: [], mapComplete: true, stageKills: 0, quotaStage: 1, stageQuota: 999 };
  c.TOWER = { player: p, boss: m, floor: 1, elapsed: 0, dmgDealt: 0, bossDmgDealt: 0, specialCd: 1000 };
  c.bfTickPlayer = () => {};
  c.bfTickApproach = () => [];
  c.bfPlayerCanReach = () => true;
  c.fieldMonsterAttack = () => false;
  c.pickAndCastSkill = () => null;
  c.tickLegendaryEffects = () => null;
  c.playerHpRegenPerSec = c.playerMpRegenPerSec = () => 0;
  c.towerTimeLimitWithTalents = () => 1000;
  c.chance = () => false;
  const hits = [];
  c.doPlayerAttack = () => { hits.push(c.GT); return { dmg: 1, killed: false }; };
  c.GT = 0;
  c.castSkill2(p, [m], 'dualdance', 'mv-float');
  assert.ok(c.skill2StormActive());
  let auto = 0;
  const cast = c.castSkill2;
  c.castSkill2 = (...args) => { if (args[4]?.storm) auto++; return cast(...args); };
  c.tickSkillSchedulers = (dt, ctx) => c.tickSkill2(dt, ctx);
  return { c, p, m, hits, auto: () => auto, tick: dt => tower ? c.towerTick(dt) : c.fieldTick(dt) };
}

for (const tower of [false, true]) test((tower ? '高塔' : '野外') + '：化身期間普攻與自動施放並行，暈眩仍禁止出手', () => {
  const s = setup(tower);
  for (let i = 1; i <= 20; i++) { s.c.GT = i * 0.1; s.tick(0.1); }
  assert.ok(s.hits.length >= 3 && s.hits.length <= 5, '兩秒內維持原有每秒兩次普攻');
  assert.ok(s.auto() >= 5, '化身每0.35秒仍自動施放');
  for (let i = 1; i < s.hits.length; i++) assert.ok(s.hits[i] - s.hits[i-1] >= 0.49);
  const before = s.hits.length;
  s.p.effects.stun = 10;
  s.c.GT = 2.1; s.tick(0.1);
  assert.equal(s.hits.length, before);
  delete s.p.effects.stun;
  s.c.GT = 4; s.tick(0.1);
  assert.equal(s.c.skill2StormActive(), false);
});

test('暴風光圈由狀態表接線，圓周半徑10米、升高3米，粒子局部跟隨且有預算上限', () => {
  const s = setup(false);
  assert.equal(s.c.statusVfxPreset('sgStorm', 'aura'), 'ground-storm-dance');
  const p = JSON.parse(fs.readFileSync('vfx/presets/ground-storm-dance.json', 'utf8'));
  assert.ok(require('../js/vfx-core.js').validatePreset(p).ok);
  assert.equal(p.loop, true);
  const particles = p.layers.filter(l => l.type === 'particle');
  assert.equal(particles.length, 12);
  const centerY = p.layers.find(l => l.id === 'floor-green-rim-front').position.y;
  const radius = particles[0].position.x;
  assert.equal(p.sizing.widthM, 20);
  for (const l of particles) {
    assert.ok(Math.abs(Math.hypot(l.position.x, (l.position.y - centerY) / 0.38) - radius) < 0.01);
    assert.ok(Math.abs(l.speed * l.lifetime / radius - 0.3) < 0.001);
    assert.equal(l.worldSpace, false);
  }
  assert.equal(particles.reduce((n,l) => n + l.maxParticles, 0), 300);
  const cones = p.layers.filter(l => l.id.startsWith('tapered-cone-'));
  assert.equal(cones.length, 8);
  assert.ok(cones.every(l => Math.abs(l.rotation - Math.PI) < 0.0001));
  const front = p.layers.find(l => l.id === 'floor-green-rim-front');
  const back = p.layers.find(l => l.id === 'floor-green-rim-back');
  assert.ok(front.alpha > back.alpha);
  assert.ok(front.scale.y < 0 && back.scale.y > 0);
  assert.equal(front.sheet.count, 1);
});

test('光錐24秒沿地板繞行，首尾閉合且保持直立', () => {
  const p = JSON.parse(fs.readFileSync('vfx/presets/ground-storm-dance.json', 'utf8'));
  assert.equal(p.duration, 24);
  const cones = p.layers.filter(l => l.id.startsWith('tapered-cone-'));
  const cy = cones.reduce((sum, l) => sum + l.position.y, 0) / cones.length;
  for (const l of cones) {
    const radius = Math.hypot(l.position.x, (l.position.y - cy) / 0.38);
    assert.equal(l.rotation, Math.PI);
    for (const curve of [l.offsetXOverLife, l.offsetYOverLife]) {
      assert.deepEqual(curve[0], [0, 0]);
      assert.deepEqual(curve.at(-1), [1, 0]);
      assert.ok(curve.some(pt => Math.abs(pt[1]) > 20));
    }
    for (let i = 0; i < l.offsetXOverLife.length; i++) {
      const x = l.position.x + l.offsetXOverLife[i][1];
      const y = l.position.y + l.offsetYOverLife[i][1];
      assert.ok(Math.abs(Math.hypot(x, (y - cy) / 0.38) - radius) < 0.001);
    }
  }
});
