'use strict';
/* ============================================================
   skill2-chainlightning-active-cap.test.cjs — 閃電鏈的「表演」上限（2026-10-08）

   使用者定案的原則：特效上限只決定前端的表演，傷害照樣要算。
   雷電暴風「每次彈射 20% 生成新鏈」的繁殖係數大於 1，天地雷鎖陣又每秒重施，
   150 隻打不死的敵人下同時在飛的鏈可達 170~250 條，前端畫不了那麼多。
   做法：同時存活超過 SG_CHAIN_VISIBLE_MAX（96）之後出生的鏈變成「靜默鏈」——
   照常彈射、照常算傷害、照常擲骰，只是不送飛行與命中的特效事件。
   所以：傷害與亂數序列和沒有這個上限完全相同；只有特效事件變少。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const { createEngine } = require(path.join(root, 'scripts/sim/engine'));

function scenario(seconds, visibleMax, enemies) {
  const eng = createEngine({ seed: 20261008 }).boot(null);
  const gm = (l) => eng.cmd('gm.exec', { line: l });
  ['level 700', 'MP_lock', 'sglv chainlightning max', 'sgult chainlightning 1', 'god 1'].forEach(gm);
  eng.state().player.loadout = ['sg:chainlightning'];
  vm.runInContext("gmArenaSpawn(" + enemies + ",'small',1000000)", eng.ctx);
  if (visibleMax !== undefined) vm.runInContext('SG_CHAIN_VISIBLE_MAX = ' + visibleMax, eng.ctx);
  const ctx = eng.ctx;
  const counts = { travel: 0, hit: 0, end: 0 };
  const origEmit = ctx.sgEmitVfx;
  ctx.sgEmitVfx = function (gid, targets, sel, spec) {
    if (gid === 'chainlightning' && spec) {
      if (spec.variant === 'lightning-chain') counts.travel++;
      else if (spec.variant === 'lightning-chain-hit') counts.hit++;
      else if (spec.variant === 'lightning-chain-end') counts.end++;
    }
    return origEmit.apply(this, arguments);
  };
  const per = Math.round(1 / eng.dt);
  let peak = 0;
  for (let s = 0; s < seconds; s++) {
    for (let i = 0; i < per; i++) {
      eng.step(1);
      peak = Math.max(peak, vm.runInContext('SG_CHAIN_ACTIVE', ctx));
    }
  }
  const read = (e) => vm.runInContext(e, ctx);
  return { peak, counts, read, hp: read('FIELD.monsters.map(function(m){return m.hp}).join(",")'),
           serial: read('SG_CHAIN_SERIAL'), dmg: read('G.player.totalDamage||0') };
}

test('CHAIN-VIS-1 預設表演上限 96；情境確實把鏈堆到遠超 96', () => {
  const r = scenario(12, undefined, 150);
  assert.equal(r.read('SG_CHAIN_VISIBLE_MAX'), 96);
  assert.ok(r.peak > 140, 'peak=' + r.peak);
});

test('CHAIN-VIS-2 傷害照算：表演上限 96 與不設上限，敵人血量與鏈的總數逐位元一致', () => {
  const capped = scenario(12, 96, 150), open = scenario(12, 1e9, 150);
  assert.equal(capped.hp, open.hp, '表演上限不得影響傷害');
  assert.equal(capped.serial, open.serial, '鏈的總數（繁殖）不得受表演上限影響');
});

test('CHAIN-VIS-3 表演上限只減少特效事件：飛行與命中事件變少，結束事件跟著少', () => {
  const capped = scenario(12, 96, 150), open = scenario(12, 1e9, 150);
  assert.ok(capped.counts.travel < open.counts.travel * 0.8, capped.counts.travel + ' vs ' + open.counts.travel);
  assert.ok(capped.counts.hit < open.counts.hit * 0.8, capped.counts.hit + ' vs ' + open.counts.hit);
  assert.ok(capped.counts.end < open.counts.end * 0.8, capped.counts.end + ' vs ' + open.counts.end);
});

test('CHAIN-VIS-4 敵人少、鏈堆不到上限時完全沒有靜默鏈：特效事件數與不設上限一致', () => {
  const a = scenario(8, 96, 3), b = scenario(8, 1e9, 3);
  assert.ok(a.peak < 96, 'peak=' + a.peak);
  assert.deepEqual(a.counts, b.counts);
  assert.equal(a.hp, b.hp);
});

test('CHAIN-VIS-5 重設技能狀態時計數歸零（排程被清掉就沒有結束回呼）', () => {
  const r = scenario(6, undefined, 150);
  assert.ok(r.read('SG_CHAIN_ACTIVE') > 0);
  r.read('resetSkill2RT()');
  assert.equal(r.read('SG_CHAIN_ACTIVE'), 0);
});
