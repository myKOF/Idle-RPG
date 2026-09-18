const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const c = vm.createContext({ console, Math: Object.create(Math), UI: { dirty: {} },
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    setTimeout() {}, clearTimeout() {}, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {} });
  c.window = c;
  for (const f of ['util', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2']) {
    vm.runInContext(fs.readFileSync('js/' + f + '.js', 'utf8'), c, { filename: f });
  }
  c.G = { player: { skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  c.GT = 0; c.Math.random = () => 0.5;
  const st = { hp: 100000, mp: 100000, hpRegen: 0, mpRegen: 50, lifesteal: 1, manaSteal: 100,
    atk: 100, matk: 100, level: 1, aspd: 1, hit: 100, critRate: 0, critDmg: 150,
    passives: {}, elemDmgUp: {}, elemAtk: null, elemDmgPct: 0, globalDmgRed: 0, shieldEff: 0 };
  c.getStats = () => st;
  const p = { hp: 1000, mp: 0, shield: 0, buffs: {}, effects: {}, dots: [], skillCds: {} };
  c.FIELD.player = p;
  c.floatEnemyEvent = () => {};
  return { c, p, st };
}
function enemy(hp = 100000) { return { hp, maxHp: hp, def: 0, mdef: 0, level: 1,
  effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0 }; }
function hit(c, p, st, e) { return c.sgHitOne(p, st, e, 100, 'cleave', 'mv-float', { dmg: 0 }); }

test('新版範圍命中20敵人吸取20次；多段命中同敵人逐段吸取', () => {
  const { c, p, st } = setup();
  const hpOnce = c.lifestealHealAmount(st, st.lifesteal);
  for (let i = 0; i < 20; i++) hit(c, p, st, enemy());
  assert.equal(p.mp, 1000); assert.equal(p.hp, 1000 + 20 * hpOnce);
  const e = enemy();
  for (let i = 0; i < 3; i++) hit(c, p, st, e);
  assert.equal(p.mp, 1150); assert.equal(p.hp, 1000 + 23 * hpOnce);
});
test('普攻不重複汲取，傷害大小不影響單次回復', () => {
  const { c, p, st } = setup();
  c.doPlayerAttack(p, enemy(), 'mv-float', 0);
  assert.equal(p.mp, 50);
  assert.equal(p.hp, 1000 + c.lifestealHealAmount(st, st.lifesteal));
  c.applyEnemyHpDamage(enemy(), 1); c.applyEnemyHpDamage(enemy(), 10000);
  assert.equal(p.mp, 150);
});
test('MISS、無敵、零傷害、已死目標與預覽不吸取；致死命中仍吸取', () => {
  const { c, p, st } = setup();
  c.resolveHit(p, enemy(), { isPlayer: true, hit: 0 }, { dodge: 100 });
  c.resolveHit(p, enemy(), { isPlayer: true, hit: 100 }, { invuln: true });
  c.applyEnemyHpDamage(enemy(), 0);
  const dead = enemy(); dead.hp = 0; c.applyEnemyHpDamage(dead, 100);
  const preview = enemy(); preview._sgPreview = true; hit(c, p, st, preview);
  assert.equal(p.mp, 0);
  hit(c, p, st, enemy(1)); assert.equal(p.mp, 50);
});
test('持續傷害依狀態與實際跳數吸取：同幀2跳流血加3跳中毒等於5次', () => {
  const { c, p } = setup(), e = enemy();
  e.dots = [ { dps: 10, interval: 0.5, acc: 0, until: 10, name: '流血' },
    { dps: 10, interval: 0.3, acc: 0, until: 10, name: '中毒' } ];
  c.tickStatuses(e, 1);
  assert.equal(p.mp, 250);
  c.tickStatuses(e, 0.01); assert.equal(p.mp, 250);
  e.effects.invuln = 10;
  c.tickStatuses(e, 1); assert.equal(p.mp, 250);
  const self = p.mp;
  p.dots = [{ dps: 10, interval: 0.5, acc: 0, until: 10 }];
  c.tickStatuses(p, 0.5); assert.equal(p.mp, self, '玩家受到持續傷害不可吸取');
});
test('衍生傷害與延遲反震各計一次；大地守護倍率與資源上限仍生效', () => {
  const { c, p, st } = setup();
  c.sgDerivedHit(enemy(), 100, 'cleave', 'mv-float', { dmg: 0 }, 'test');
  assert.equal(p.mp, 50);
  const ev = { attacker: enemy(), target: p, result: { thorns: 10 }, defCfg: { isPlayer: true } };
  c.skills2OnPlayerDamaged = () => {};
  c.settleEnemyAttackRetaliation(ev); c.settleEnemyAttackRetaliation(ev);
  assert.equal(p.mp, 100);
  c.G.player.loadout = ['sg:earthguard']; c.G.player.skills2.levels.earthguard = [10, 10, 10, 10, 0, 0, 0];
  hit(c, p, st, enemy()); assert.equal(p.mp, 200);
  p.hp = st.hp - 1; p.mp = st.mp - 1;
  hit(c, p, st, enemy()); assert.equal(p.hp, st.hp); assert.equal(p.mp, st.mp); assert.equal(p.shield, 0);
});
test('零傷害 DoT 不混入其他狀態的汲取次數；同步反震只計一次', () => {
  const { c, p } = setup(), e = enemy();
  c.skill2DotElemFactor = (_, sid) => sid === 'zero' ? 0 : 1;
  e.dots = ['zero', 'positive'].map(sid => ({ sid, dps: 10, interval: 0.5, acc: 0, until: 10 }));
  c.tickStatuses(e, 0.5); assert.equal(p.mp, 50);
  c.resolveHit(enemy(), p, { hit: 100, atk: 10, critRate: 0 },
    { isPlayer: true, maxHp: 100000, thornsPct: 1 });
  assert.equal(p.mp, 100);
});
