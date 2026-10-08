'use strict';
/* 「命中 N/s」的計數口徑：resolveHit（玩家攻擊，含未命中）＋ applyEnemyHpDamage（衍生等直接傷害），兩者不重複；
   敵人打玩家（aCfg 不是 isPlayer）不算。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { createEngine } = require(path.join(path.resolve(__dirname, '..'), 'scripts/sim/engine'));

function setup() {
  const eng = createEngine({ seed: 7 }).boot(null);
  const gm = (l) => eng.cmd('gm.exec', { line: l });
  ['level 700', 'MP_lock', 'god 1'].forEach(gm);
  gm('spawn 1 small 1000000');
  const read = (e) => vm.runInContext(e, eng.ctx);
  return { eng, read, m: read('FIELD.monsters[0]') };
}

test('HIT-1 直接傷害（applyEnemyHpDamage）只加 HIT_DIRECT，一次一計', () => {
  const { read, m, eng } = setup();
  const c0 = read('HIT_CALLS'), d0 = read('HIT_DIRECT');
  eng.ctx.applyEnemyHpDamage(m, 5);
  eng.ctx.applyEnemyHpDamage(m, 5);
  assert.equal(read('HIT_DIRECT') - d0, 2);
  assert.equal(read('HIT_CALLS') - c0, 0);
});

test('HIT-2 玩家的 resolveHit 只加 HIT_CALLS（未命中也算）；非玩家攻擊不算', () => {
  const { read, m, eng } = setup();
  const p = read('FIELD.player');
  const c0 = read('HIT_CALLS'), d0 = read('HIT_DIRECT');
  const cfg = { atk: 100, dmgType: 'phys', level: 1, hit: 0, isPlayer: true };
  const dcfg = { def: 0, dodge: 100, isPlayer: false };
  eng.ctx.resolveHit(p, m, cfg, dcfg);                       // 玩家出手（閃避 100，大概率未命中，仍算一次）
  assert.equal(read('HIT_CALLS') - c0, 1);
  eng.ctx.resolveHit(m, p, { atk: 1, dmgType: 'phys', level: 1, hit: 0 }, { def: 0, dodge: 100, isPlayer: true });
  assert.equal(read('HIT_CALLS') - c0, 1, '敵人打玩家不算');
  assert.equal(read('HIT_DIRECT') - d0, 0, 'resolveHit 不得同時計入直接傷害');
});

test('HIT-3 連鎖閃電真的施放後，玩家傷害計數持續增加', () => {
  const { read, eng } = setup();
  const gm = (l) => eng.cmd('gm.exec', { line: l });
  gm('spawn 8 small 1000000');
  ['sglv chainlightning max', 'sgult chainlightning 1'].forEach(gm);
  eng.state().player.loadout = ['sg:chainlightning'];
  const c0 = read('HIT_CALLS');
  eng.step(Math.round(1 / eng.dt) * 8);
  assert.ok(read('HIT_CALLS') - c0 > 20, 'delta=' + (read('HIT_CALLS') - c0));
});
