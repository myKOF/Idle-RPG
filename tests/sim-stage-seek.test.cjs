/* 推關手法（stage-seek）：真人的「手動 ±1 找剛好打得動的最高關，自動推進關著固定在那裡」。

   來源是真人 30 小時遊玩記錄（docs/REAL_PLAY_REFERENCE_2026-11-27.md）：stage.go 148 次裡 139 次是 ±1，
   變強了 +1（很輕鬆時一次 +5／+8／+13），死了或打不動就 −1。這裡不開遊戲引擎，合成 state 直接驅動策略層。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPolicy } = require('../scripts/sim/policy.js');

function seekPolicy(over) {
  return createPolicy({
    name: 'seek-test', decideEveryGameSec: 10, needPanels: [],
    targets: [{ id: 'killRate', kind: 'value', path: 'panels.m.kill', atLeast: 10 }],
    rules: [{
      id: 'seek', cmd: 'stage.go',
      stageSeek: Object.assign({
        zones: 'panels.gearTier', deaths: 'panels.battle.lootStats.sources.field.deaths',
        requireTargets: ['killRate'], killRateTarget: 'killRate',
        upEverySec: 120, stableSec: 120, downEverySec: 120, calmSec: 60,
        comfort: [{ killRateMult: 3, calmSec: 120, step: 10 }, { killRateMult: 2, calmSec: 300, step: 5 }],
        autoAdvanceCmd: 'stage.setAutoAdvance', kickAfterSec: 300, minStage: 1
      }, over || {})
    }]
  });
}
const st = (t, o) => {
  const x = Object.assign({ cur: 50, best: 60, kill: 12, deaths: 0, max: 100 }, o || {});
  return {
    gameTimeSec: t, view: {},
    panels: {
      m: { kill: x.kill },
      gearTier: { zone: 'desert', zones: [{ key: 'desert', index: 0, maxStage: x.max, current: x.cur, best: x.best, cleared: false }] },
      battle: { lootStats: { sources: { field: { deaths: x.deaths } } } }
    }
  };
};
const goes = (cmds) => cmds.filter((c) => c.name === 'stage.go').map((c) => c.args.delta);
const autos = (cmds) => cmds.filter((c) => c.name === 'stage.setAutoAdvance').map((c) => c.args.on);

test('推關：第一次決策就把自動推進關掉（遊戲預設是開的）', () => {
  const p = seekPolicy();
  assert.deepEqual(autos(p.decide(st(0))), [false]);
  assert.deepEqual(autos(p.decide(st(10))), [], '狀態沒變就不重送');
});

test('推關：穩定滿 stableSec 才 +1，之後每 upEverySec 一次', () => {
  const p = seekPolicy();
  assert.deepEqual(goes(p.decide(st(0, { kill: 12 }))), [], '剛開始還沒穩定夠久');
  assert.deepEqual(goes(p.decide(st(60, { kill: 12 }))), []);
  assert.deepEqual(goes(p.decide(st(130, { kill: 12 }))), [1], '穩定 130 秒（殺敵速率 12 ≥ 門檻 10、沒死）：+1');
  assert.deepEqual(goes(p.decide(st(200, { cur: 51, kill: 12 }))), [], '剛 +1，要重新穩定一段時間');
  assert.deepEqual(goes(p.decide(st(260, { cur: 51, kill: 12 }))), [1]);
});

test('推關：很輕鬆（殺敵速率遠超門檻）一次跳很多關', () => {
  const p = seekPolicy();
  p.decide(st(0, { kill: 35 }));
  assert.deepEqual(goes(p.decide(st(130, { kill: 35 }))), [10], '3.5 倍門檻、很久沒死：+10');
  const q = seekPolicy();
  q.decide(st(0, { kill: 22 }));
  assert.deepEqual(goes(q.decide(st(130, { kill: 22 }))), [5], '2.2 倍門檻、從沒死過：+5（超過 3 倍才 +10）');
});

test('推關：不會超過最高關卡（best）與地圖上限', () => {
  const p = seekPolicy();
  p.decide(st(0, { cur: 60, best: 60, kill: 35 }));
  assert.deepEqual(goes(p.decide(st(130, { cur: 60, best: 60, kill: 35 }))), [], '站在最前線（現在＝最高關）：要先清完一波解鎖下一關才能 +1');
  const q = seekPolicy();
  q.decide(st(0, { cur: 55, best: 60, kill: 35 }));
  assert.deepEqual(goes(q.decide(st(130, { cur: 55, best: 60, kill: 35 }))), [5], '+10 被最高關卡夾住，只能 +5');
});

test('推關：殺敵速率不夠（不穩）就 −1，之後每 downEverySec 一次', () => {
  const p = seekPolicy();
  assert.deepEqual(goes(p.decide(st(0, { kill: 4 }))), [-1], '殺敵速率 4 < 門檻 10：立刻 −1');
  assert.deepEqual(goes(p.decide(st(60, { cur: 49, kill: 4 }))), [], '還在冷卻（120 秒）');
  assert.deepEqual(goes(p.decide(st(130, { cur: 49, kill: 4 }))), [-1]);
});

test('推關：死亡 → S 設成死掉前那關 −1，等 calmSec 之後才回去（遊戲死亡會自己退關）', () => {
  const p = seekPolicy();
  p.decide(st(0, { cur: 50, kill: 12, deaths: 0 }));
  /* 死了：遊戲把關卡退到 40。 */
  assert.deepEqual(goes(p.decide(st(10, { cur: 40, kill: 12, deaths: 1 }))), [], '剛死，先別回去');
  assert.deepEqual(goes(p.decide(st(50, { cur: 40, kill: 12, deaths: 1 }))), [], '還不到 calmSec 60 秒');
  assert.deepEqual(goes(p.decide(st(80, { cur: 40, kill: 12, deaths: 1 }))), [9], '回到 49（死前 50 − 1），不是 50');
});

test('推關：死後關卡比 S 高（例如手動被推上去）要立刻退下來', () => {
  const p = seekPolicy();
  p.decide(st(0, { cur: 50, kill: 4 }));            // 第一次：不穩 → S=49
  assert.deepEqual(goes(p.decide(st(10, { cur: 53, kill: 4 }))), [-4], '現在 53 > S 49：退回 S');
});

test('推關：卡關重試等待中（ctx.retryWaiting）不往前走', () => {
  const p = seekPolicy();
  const s0 = st(0); s0.ctx = { retryWaiting: true };
  p.decide(s0);
  const s1 = st(130); s1.ctx = { retryWaiting: true };
  assert.deepEqual(goes(p.decide(s1)), [], '上一次 BOSS 沒打過、時間沒到：不 +1');
});

test('推關：自動推進只在「最前線、穩定、最高關很久沒進步」時踢一腳', () => {
  const p = seekPolicy();
  p.decide(st(0, { cur: 60, best: 60, kill: 12 }));
  assert.deepEqual(autos(p.decide(st(200, { cur: 60, best: 60, kill: 12 }))), [], '才 200 秒，不踢');
  assert.deepEqual(autos(p.decide(st(320, { cur: 60, best: 60, kill: 12 }))), [true], '最高關 300 秒沒進步：開自動推進');
  assert.deepEqual(autos(p.decide(st(330, { cur: 61, best: 61, kill: 12 }))), [false], '最高關進步了：關回去');
});

test('推關：換地圖就從那張圖目前的關卡重新找', () => {
  const p = seekPolicy();
  p.decide(st(0, { cur: 99, best: 100, kill: 4 }));
  const s = st(500, { cur: 1, best: 1, kill: 12 });
  s.panels.gearTier = { zone: 'Icefield', zones: [{ key: 'Icefield', index: 1, maxStage: 150, current: 1, best: 1, cleared: false }] };
  assert.deepEqual(goes(p.decide(s)), [], '新地圖第 1 關：不會被舊地圖的 S 拉回去');
});
