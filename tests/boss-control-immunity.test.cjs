const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('高塔BOSS免疫會改變攻擊頻率的控制效果，但保留傷害類減益', () => {
  const context = vm.createContext({
    GT: 0,
    console,
    window: {},
    isBossControlImmune: (ent) => !!(ent && ent.isBoss),
    isAttackFrequencyControlKey: (key) => ['stun', 'slow', 'aspdDown', 'attackSpeedDown'].includes(key)
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'combat.js'), 'utf8'), context);

  const boss = { isBoss: true, effects: {}, buffs: {} };
  assert.equal(context.applyEffect(boss, 'stun', 1), false);
  assert.equal(context.applyEffect(boss, 'slow', 3), false);
  assert.equal(context.applyBuff(boss, 'aspdDown', 30, 3), false);
  assert.equal(context.applyBuff(boss, 'atkDown', 30, 3), true);
  assert.equal(context.applyBuff(boss, 'defDown', 30, 3), true);
  assert.deepEqual(Object.keys(boss.effects), []);
  assert.deepEqual(Object.keys(boss.buffs).sort(), ['atkDown', 'defDown']);
});

test('技能施放與被動控制都會排除高塔BOSS', () => {
  const combat = fs.readFileSync(path.join(root, 'js', 'combat.js'), 'utf8');
  const skills = fs.readFileSync(path.join(root, 'js', 'skills.js'), 'utf8');
  const tower = fs.readFileSync(path.join(root, 'js', 'tower.js'), 'utf8');
  assert.match(combat, /!isBossControlImmune\(mEnt\)[\s\S]*?applyEffect\(mEnt, 'stun'/);
  assert.match(combat, /!isBossControlImmune\(mEnt\)[\s\S]*?applyEffect\(mEnt, 'slow'/);
  assert.match(skills, /fx\.stunDur && !isBossControlImmune\(effectTarget\)/);
  assert.match(skills, /fx\.slowDur && !isBossControlImmune\(effectTarget\)/);
  assert.match(skills, /if \(applyBuff\(target, debuff\.key/);
  assert.match(tower, /控制免疫：暈眩、緩速/);
});
