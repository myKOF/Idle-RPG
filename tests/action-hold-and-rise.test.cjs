'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const skills = read('js/skills.js');
const combat = read('js/combat.js');
const tower = read('js/tower.js');

function loadHold() {
  const c = { Math, Number };
  vm.createContext(c);
  const start = skills.indexOf('var PLAYER_ATTACK_HOLD_MAX');
  const end = skills.indexOf('function skillCastJobFor');
  vm.runInContext(skills.slice(start, end), c);
  return c;
}

test('HOLD-1 普攻後站定到揮擊播完：夾在 [0.19, 1.55]，不縮短已有的站定', () => {
  const c = loadHold();
  let p = {};
  c.playerAttackHoldStart(p, 0.5);
  assert.equal(p._skillHold, 0.5);
  p = {}; c.playerAttackHoldStart(p, 0.05);
  assert.equal(p._skillHold, 0.19);
  p = {}; c.playerAttackHoldStart(p, 4);
  assert.equal(p._skillHold, 1.55);
  p = { _skillHold: 0.8 }; c.playerAttackHoldStart(p, 0.3);
  assert.equal(p._skillHold, 0.8);
});

test('HOLD-2 野外與高塔的普攻都呼叫站定', () => {
  assert.match(combat, /playerAttackHoldStart\(p, 1 \/ st\.aspd\)/);
  assert.match(tower, /playerAttackHoldStart\(p, 1 \/ st\.aspd\)/);
});

test('RISE-1 正常死亡：倒數結束才起身，起身（riseCd）播完戰鬥才恢復', () => {
  assert.match(combat, /FIELD\.riseCd = REVIVE_RISE_SEC;/);
  assert.match(combat, /if \(FIELD\.riseCd > 0\) \{[\s\S]*?FIELD\.riseCd -= dt;[\s\S]*?return;/);
  const reviveAt = combat.indexOf('if (FIELD.reviveCd > 0) {');
  const riseAt = combat.indexOf('if (FIELD.riseCd > 0) {');
  assert.ok(reviveAt > 0 && riseAt > reviveAt, '起身閘門接在復活倒數之後、任何戰鬥行為之前');
});
