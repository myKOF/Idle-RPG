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
    setTimeout() {},
    clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog() {},
    floatText() {},
    trackDps() {},
    recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/skills2.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  context.getStats = () => ({
    atk: 1000, matk: 0, hp: 1000, mp: 100, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: 0,
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  return context;
}

function enemy(hp, x, y, name) {
  return {
    name, maxHp: hp, hp, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    pos: { x, y }
  };
}

function playerEnt() {
  return { hp: 1000, mp: 100, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}

test('飛刀彈射：每段只會跳向 20 米內的敵人', () => {
  const c = loadContext();
  const calls = [];
  c.resolveHit = (attacker, defender) => {
    calls.push(defender);
    return { dmg: 100, crit: false, miss: false, blocked: false, killed: false };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  c.chance = () => false;
  c.bfTravelSeconds = () => 0.1;
  c.G.player.skills2.levels.knife = [1, 1, 1, 0, 0, 0, 0];
  c.SKILLS2.knife.tiers[2].fx.count = 2;
  const p = playerEnt();
  const a = enemy(1e9, 40, 0, 'A');
  const b = enemy(1e9, 180, 0, 'B');
  const far = enemy(1e9, 500, 0, 'C');
  const vfx = [];
  c.enemyEventFloatTarget = (ent) => ent.name;
  c.playCombatVfx = (spec) => vfx.push(spec);

  c.castSkill2(p, [a, b, far], 'knife', 'mv-float');

  const chain = vfx.filter((spec) => spec.variant === 'knife-bounce');
  assert.ok(chain.some((spec) => spec.targets[0] === 'A' && spec.targets[1] === 'B'),
    '20 米內的目標應可彈射');
  assert.ok(chain.every((spec) => !spec.targets.includes('C')),
    '超過 20 米的目標不得成為彈射目標');
  assert.equal(c.SKILLS2.knife.tiers[2].fx.m, 20,
    '彈射距離應由技能表的 m=20 定義');
  assert.ok(calls.includes(b), '近距離目標應實際受到彈射傷害');
});
