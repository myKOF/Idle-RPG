const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    window: null,
    document: { addEventListener() {}, getElementById() { return null; } },
    UI: { dirty: {} },
    G: { tower: { active: false } },
    blog() {},
    floatText() {},
    floatEnemyEvent() {},
    floatPlayerEvent() {},
    playCombatVfx() {},
    trackDps() {},
    recordRunDamage() {},
    recordLootBattle() {},
    recordLootKill() {},
    recordLootDeath() {},
    chance: () => true,
    Date
  };
  context.window = context;
  vm.createContext(context);
  [
    'js/util.js',
    'js/data.js',
    'js/status.js',
    'js/formula.js',
    'js/battlefield.js',
    'js/combat.js'
  ].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function stats() {
  return {
    level: 1,
    hp: 1000,
    mp: 100,
    atk: 1,
    matk: 1,
    hit: 100,
    critRate: 0,
    critDmg: 150,
    pPen: 0,
    mPen: 0,
    def: 0,
    mdef: 0,
    evasion: 0,
    blockRate: 0,
    blockDmgRed: 0,
    pRes: 0,
    mRes: 0,
    resist: { ctrl: 0 },
    tenacity: 0,
    ccRed: 0,
    globalDmgRed: 0,
    normalDmgRed: 0,
    eliteDmgRed: 0,
    bossDmgRed: 0,
    resVsElem: {},
    elemDmgPct: {},
    elemDmgUp: {},
    eliteDmg: 0,
    bossDmg: 0,
    normalDmg: 0,
    totalDmgPct: 0,
    dmgVsElem: {},
    passives: { thorns: 100 }
  };
}

function enemy(magic) {
  return {
    name: '測試敵人', hp: 50, maxHp: 1000, atk: 1, level: 1, hit: 100,
    magic: !!magic, def: 0, mdef: 0, dodge: 0, resist: {},
    buffs: {}, effects: {}, dots: [], isBoss: false, elite: false
  };
}

function player() {
  return { hp: 1000, mp: 100, shield: 0, buffs: {}, effects: {}, dots: [] };
}

test('魔法投射物的反傷等到命中時間才結算', () => {
  const c = loadContext();
  c.getStats = stats;
  c.GT = 0;
  const callbacks = [];
  c.legendaryOnPlayerDamaged = () => callbacks.push('legendary');
  c.skills2OnPlayerDamaged = () => callbacks.push('skills2');
  const m = enemy(true);
  m.floatSel = 'mv-float-7';
  const p = player();
  const vfx = [];
  c.playCombatVfx = (spec) => vfx.push(spec);

  const res = c.doMonsterAttack(m, p, 'pv-float');
  assert.equal(res.thorns, 1000);
  assert.equal(vfx.length, 1);
  assert.equal(vfx[0].fxKind, 'enemy-attack');
  assert.equal(vfx[0].variant, 'enemy-projectile');
  assert.equal(vfx[0].sourceId, 'mv-float-7');
  assert.equal(vfx[0].travelMs.length, 1);
  assert.equal(vfx[0].travelMs[0], 260);
  assert.equal(vfx[0].hit, true);
  assert.equal(m.hp, 50, '子彈尚未命中前，反傷不得先扣敵人生命');
  assert.equal(c.DEFERRED_ENEMY_RETALIATIONS.length, 1);
  assert.deepEqual(callbacks, [], '受擊反擊掛點也要等到子彈命中');

  c.GT = 0.25;
  c.tickDeferredEnemyAttackRetaliations();
  assert.equal(m.hp, 50, '尚未到投射物命中時間');

  c.GT = 0.26;
  c.tickDeferredEnemyAttackRetaliations();
  assert.equal(m.hp, 0, '投射物命中後才套用反傷');
  assert.deepEqual(callbacks, ['legendary', 'skills2']);
});

test('近戰攻擊的反震仍在攻擊結算時立即生效', () => {
  const c = loadContext();
  c.getStats = stats;
  c.GT = 0;
  const m = enemy(false);
  m.floatSel = 'mv-float-2';
  const p = player();
  const vfx = [];
  c.playCombatVfx = (spec) => vfx.push(spec);

  c.doMonsterAttack(m, p, 'pv-float');
  assert.equal(vfx.length, 1);
  assert.equal(vfx[0].fxKind, 'enemy-attack');
  assert.equal(vfx[0].variant, 'enemy-melee');
  assert.equal(vfx[0].sourceId, 'mv-float-2');
  assert.equal(vfx[0].hit, true);
  assert.equal(m.hp, 0);
  assert.equal(c.DEFERRED_ENEMY_RETALIATIONS.length, 0);
});
