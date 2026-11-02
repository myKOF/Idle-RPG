'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function setup(hostname = 'localhost') {
  const c = { console, Math: Object.create(Math), location: { hostname }, UI: { dirty: {} },
    document: { addEventListener() {}, getElementById() { return null; } }, setTimeout() {}, clearTimeout() {},
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {} };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2', 'gm_exec']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), c, { filename: file });
  }
  c.G = { player: { level: 1000, skills2: { levels: {}, ult: {} }, loadout: [] }, stage: { current: 1, zone: 'desert' } };
  c.Math.random = () => 0.01;
  return c;
}
const enemy = (maxHp = 1000) => ({ hp: maxHp, maxHp, shield: 0, buffs: {}, dots: [], effects: {}, _alerted: false });
const attack = (extra = {}) => ({ isPlayer: true, atk: 700, hit: 100, level: 100, dmgType: 'phys', critRate: 100, critDmg: 900, totalDmgPct: 500, ...extra });
const defense = (extra = {}) => ({ level: 100, def: 10000, mdef: 10000, blockRate: 100, blockDmgRed: 90, globalDmgRed: 90, ...extra });
function hit(c, target, a = {}, d = {}) { return c.resolveHit({ hp: 1000 }, target, attack(a), defense(d)); }

test('damage：固定／小數／百分比／零／解除；不改玩家與存檔狀態', () => {
  const c = setup(), before = JSON.stringify(c.G);
  for (const [command, mode, value] of [['90', 'fixed', 90], ['90.5', 'fixed', 90.5], ['10%', 'percent', 10], ['2.5%', 'percent', 2.5], ['0', 'fixed', 0], ['100%', 'percent', 100]]) {
    assert.equal(c.executeGMCommand('damage ' + command).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(c.GM_TEST.damageOverride)), { mode, value });
  }
  for (const off of ['off', 'clear']) {
    assert.equal(c.executeGMCommand('damage ' + off).ok, true);
    assert.equal(c.GM_TEST.damageOverride, null);
  }
  assert.equal(JSON.stringify(c.G), before);
  assert.equal(setup().GM_TEST.damageOverride, null, '新執行環境清除旗標');
});

test('damage：錯誤參數與外部hostname不能修改既有設定', () => {
  const c = setup(); c.executeGMCommand('damage 90');
  const before = JSON.stringify(c.GM_TEST);
  for (const input of ['', '-1', 'NaN', 'Infinity', '1e999', '101%', '-5%', '%', '10%%', '10%oops', '90 junk', 'off junk', '90 10']) {
    assert.equal(c.executeGMCommand('damage ' + input).ok, false, input);
    assert.equal(JSON.stringify(c.GM_TEST), before, input);
  }
  const external = setup('example.com');
  assert.equal(external.executeGMCommand('damage 90').ok, false);
  assert.equal(external.GM_TEST.damageOverride, null);
});

test('damage 90：普攻／物理與魔法技能最終皆90，不乘暴擊或減傷、不扣盾、不吃高塔上限', () => {
  const c = setup(); c.executeGMCommand('damage 90');
  for (const a of [{}, { isSkill: true }, { isSkill: true, dmgType: 'magic' }, { isSkill: true, dmgType: 'both', matk: 900 }]) {
    const target = enemy(100); target.towerBoss = true; target.shield = 999;
    const res = hit(c, target, a);
    assert.equal(res.dmg, 90); assert.equal(res.hpDamage, 90);
    assert.equal(res.absorbed, 0); assert.equal(target.hp, 10); assert.equal(target.shield, 999);
    assert.equal(target._alerted, true);
  }
});

test('damage 10%：各目標最大生命基準，受傷後仍扣同額；BOSS無額外折減', () => {
  const c = setup(); c.executeGMCommand('damage 10%');
  for (const maxHp of [1000, 2300, 75]) {
    const target = enemy(maxHp); target.isBoss = target.towerBoss = true;
    for (let i = 1; i <= 3; i++) {
      const res = hit(c, target);
      assert.equal(res.dmg, maxHp * 0.1);
      assert.ok(Math.abs(target.hp - maxHp * (1 - 0.1 * i)) < 1e-9);
    }
  }
});

test('damage：零傷害／溢出擊殺／連擊逐擊與off恢復原傷害', () => {
  const c = setup();
  const baseline = hit(c, enemy()).dmg;
  c.executeGMCommand('damage 90');
  const combo = enemy(); for (let i = 0; i < 3; i++) assert.equal(hit(c, combo).dmg, 90);
  assert.equal(combo.hp, 730);
  const weak = enemy(50), killed = hit(c, weak);
  assert.equal(killed.dmg, 90); assert.equal(killed.killed, true); assert.equal(weak.hp, 0);
  c.executeGMCommand('damage 0'); const zero = enemy();
  assert.equal(hit(c, zero).dmg, 0); assert.equal(zero.hp, 1000);
  c.executeGMCommand('damage off'); assert.equal(hit(c, enemy()).dmg, baseline);
});

test('damage：MISS／無敵仍有效，敵人傷害與玩家扣血不受影響', () => {
  const c = setup();
  const incoming = () => c.resolveHit(enemy(), { hp: 1000 }, attack({ isPlayer: false }), defense({ isPlayer: true }));
  const normal = incoming().dmg;
  c.executeGMCommand('damage 90');
  assert.equal(incoming().dmg, normal);
  const player = { hp: 1000 }; assert.equal(c.applyEnemyHpDamage(player, 7), 7); assert.equal(player.hp, 993);
  const invuln = enemy(); assert.equal(hit(c, invuln, {}, { invuln: true }).dmg, 0); assert.equal(invuln.hp, 1000);
  c.Math.random = () => 0.99;
  const missed = enemy(); assert.equal(hit(c, missed, { hit: 0 }).miss, true); assert.equal(missed.hp, 1000);
});

test('damage：衍生與持續合批每跳各覆寫；回傳、浮字、統計使用實際扣血量', () => {
  const c = setup(); c.executeGMCommand('damage 90');
  const target = enemy();
  assert.equal(c.applyEnemyHpDamage(target, 999, 3), 270); assert.equal(target.hp, 730);
  c.executeGMCommand('damage 10%');
  const boss = enemy(2000); boss.towerBoss = true;
  assert.equal(c.applyEnemyHpDamage(boss, 1, 4), 800); assert.equal(boss.hp, 1200);
  c.executeGMCommand('damage 90');
  const floats = [], stats = [], dps = [];
  c.floatEnemyEvent = (...args) => floats.push(args);
  c.recordRunDamage = (...args) => stats.push(args);
  c.trackDps = amount => dps.push(amount);
  const result = { dmg: 0 };
  assert.equal(c.sgDerivedHit(enemy(), 999, 'thrust', 'mv-float', result), 90);
  assert.equal(result.dmg, 90); assert.equal(floats[0][4], 90); assert.equal(stats[0][1], 90); assert.equal(dps[0], 90);
});

test('damage：真實技能與DoT入口逐擊／逐跳結算，數字與統計一致', () => {
  const c = setup(); c.executeGMCommand('damage 90');
  const st = { hp: 10000, mp: 10000, atk: 100, matk: 100, level: 1000, hit: 100, critRate: 0, critDmg: 150,
    passives: {}, resist: {}, elemAtk: null, elemDmgUp: {}, globalDmgRed: 0 };
  c.getStats = () => st;
  const player = { hp: 10000, mp: 10000, shield: 0, effects: {}, buffs: {}, dots: [], skillCds: {} };
  c.FIELD.player = player;
  const floats = [], dps = [];
  c.floatEnemyEvent = (...args) => floats.push(args);
  c.trackDps = value => dps.push(value);
  const target = enemy(10000); target.resist = {};
  const skill = c.sgHitOne(player, st, target, 700, 'cleave', 'mv-float', { dmg: 0 });
  assert.equal(skill.dmg, 90); assert.equal(target.hp, 9910);
  assert.equal(floats[0][4], 90); assert.equal(dps[0], 90);
  target.dots = [{ dps: 10, interval: 0.5, acc: 0, until: 10 }, { dps: 30, interval: 0.3, acc: 0, until: 10 }];
  c.GT = 0; c.tickStatuses(target, 1);
  assert.equal(target.hp, 9460, '兩跳與三跳合批扣五次90');
  const immune = enemy(); immune.affixes = []; immune._el = { invulnUntil: 10 };
  c.eliteIncomingDamage = () => 0;
  assert.equal(c.applyEnemyHpDamage(immune, 700), 0);
  assert.equal(hit(c, immune).dmg, 0); assert.equal(immune.hp, 1000);
});
