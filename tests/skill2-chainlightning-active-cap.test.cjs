'use strict';
/* ============================================================
   skill2-chainlightning-active-cap.test.cjs — 閃電鏈的全場同時存活上限（2026-10-08）

   使用者畫面：「模擬落後 14 分鐘且持續增加」，Worker 單步 0.7~3.6 秒。無畫面引擎量測
   （Lv.700、連鎖閃電超神【天地雷鎖陣】、150 隻打不死的敵人）：雷電暴風「每次彈射 20% 生成新鏈」
   的繁殖係數大於 1，天地雷鎖陣又每秒重施，每秒新增約 110 條鏈、同時在飛約 170~250 條，
   每步 130~260ms，超過一步 100ms 的現實時間，遊戲時間追不上現實。
   做法與臨界雷劫雷球相同：全場硬上限 SG_CHAIN_MAX_ACTIVE（96）；檢查在擲骰之前，
   所以未達上限時行為（含亂數消耗）與沒有上限完全相同；每次施放的第一條鏈永遠放行。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const { createEngine } = require(path.join(root, 'scripts/sim/engine'));

function scenario(seconds, cap, enemies) {
  const eng = createEngine({ seed: 20261008 }).boot(null);
  const gm = (l) => eng.cmd('gm.exec', { line: l });
  ['level 700', 'MP_lock', 'sglv chainlightning max', 'sgult chainlightning 1', 'god 1'].forEach(gm);
  eng.state().player.loadout = ['sg:chainlightning'];
  vm.runInContext("gmArenaSpawn(" + enemies + ",'small',1000000)", eng.ctx);
  if (cap !== undefined) vm.runInContext('SG_CHAIN_MAX_ACTIVE = ' + cap, eng.ctx);
  const per = Math.round(1 / eng.dt);
  let peak = 0;
  for (let s = 0; s < seconds; s++) {
    for (let i = 0; i < per; i++) {
      eng.step(1);
      peak = Math.max(peak, vm.runInContext('SG_CHAIN_ACTIVE', eng.ctx));
    }
  }
  return { eng, peak, read: (e) => vm.runInContext(e, eng.ctx) };
}

test('CHAIN-CAP-1 預設上限 96；同時存活的鏈不會越過它太多（每次施放的第一條永遠放行）', () => {
  const r = scenario(12, undefined, 150);
  assert.equal(r.read('SG_CHAIN_MAX_ACTIVE'), 96);
  assert.ok(r.peak >= 60, '情境要真的把鏈堆起來才算測到上限，peak=' + r.peak);
  assert.ok(r.peak <= 96 + 8, '同時存活鏈數 ' + r.peak + ' 超過上限太多');
});

test('CHAIN-CAP-2 沒有上限時同一情境會堆到遠超 96（證明上限真的在咬）', () => {
  const r = scenario(12, 1e9, 150);
  assert.ok(r.peak > 140, 'peak=' + r.peak);
});

test('CHAIN-CAP-3 上限以下行為完全相同：敵人少、鏈堆不到上限時，有無上限的結果逐位元一致', () => {
  const hp = (r) => r.read('FIELD.monsters.map(function(m){return m.hp}).join(",")');
  const a = scenario(8, undefined, 3), b = scenario(8, 1e9, 3);
  assert.ok(a.peak < 96, 'peak=' + a.peak);
  assert.equal(hp(a), hp(b));
});

test('CHAIN-CAP-4 重設技能狀態時計數歸零（排程被清掉就沒有結束回呼）', () => {
  const r = scenario(6, undefined, 150);
  assert.ok(r.read('SG_CHAIN_ACTIVE') > 0);
  r.read('resetSkill2RT()');
  assert.equal(r.read('SG_CHAIN_ACTIVE'), 0);
});
