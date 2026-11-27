/* 三套裝備的啟用閘門（使用者 2026-11-27）：第 4 張地圖起、而且某個 BOSS 卡了很久才開，開了就鎖定。

   真人 30 小時只用第 1 套；模擬卻讓角色大半時間穿著比第 1 套弱的第 3 套。這裡不開遊戲引擎，合成 state 驅動策略層。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPolicy } = require('../scripts/sim/policy.js');

const GATE = { minZoneIndex: 3, stuckBossMin: 30, towerStallMin: 60, zones: 'panels.gearTier' };

function probe() {
  return createPolicy({
    name: 'gate-test', decideEveryGameSec: 1, needPanels: [], lists: {},
    equipSets: { panel: 'panels.equipSets', home: 0, gate: GATE },
    rules: [{ id: 'p', cmd: 'noop', args: { on: { $path: 'ctx.setsEnabled' } } }]
  });
}
const state = (t, zoneIndex, stuck, towerHigh) => ({
  gameTimeSec: t, view: {}, ctx: { stuckBossMin: stuck },
  panels: {
    gearTier: { zone: 'z' + zoneIndex, zones: [{ key: 'z' + zoneIndex, index: zoneIndex }] },
    tower: { tower: { highest: towerHigh === undefined ? 5 : towerHigh, active: false } }
  }
});
const enabled = (p, s) => p.decide(s)[0].args.on;

test('閘門：前三張地圖不開，即使 BOSS 卡很久', () => {
  const p = probe();
  assert.equal(enabled(p, state(0, 0, 500)), false);
  assert.equal(enabled(p, state(10, 2, 500)), false, '第 3 張（索引 2）還不到第 4 張');
});

test('閘門：第 4 張地圖起，要 BOSS 卡夠久才開（野外 BOSS）', () => {
  const p = probe();
  assert.equal(enabled(p, state(0, 3, 10)), false, '卡 10 分鐘還不算久');
  assert.equal(enabled(p, state(10, 3, 29)), false);
  assert.equal(enabled(p, state(20, 3, 31)), true, '卡 31 分鐘：開');
});

test('閘門：開了就鎖定，BOSS 過關之後也不關回去', () => {
  const p = probe();
  assert.equal(enabled(p, state(0, 3, 40)), true);
  assert.equal(enabled(p, state(10, 3, 0)), true, '過關了（卡關時間歸零）仍維持開啟');
  assert.equal(enabled(p, state(20, 4, 0)), true);
});

test('閘門：封魔塔最高層 60 分鐘沒進步也算卡很久', () => {
  const p = probe();
  assert.equal(enabled(p, state(0, 3, 0, 12)), false);
  assert.equal(enabled(p, state(3000, 3, 0, 12)), false, '50 分鐘');
  assert.equal(enabled(p, state(3700, 3, 0, 12)), true, '61 分鐘：開');
  const q = probe();
  q.decide(state(0, 3, 0, 12));
  q.decide(state(3000, 3, 0, 13));                              // 進步了，重新計時
  assert.equal(enabled(q, state(3700, 3, 0, 13)), false);
});

test('沒有 gate 設定的策略不受影響（恆為開）', () => {
  const p = createPolicy({
    name: 'nogate', decideEveryGameSec: 1, needPanels: [], lists: {},
    equipSets: { panel: 'panels.equipSets', home: 0 },
    rules: [{ id: 'p', cmd: 'noop', args: { on: { $path: 'ctx.setsEnabled' } } }]
  });
  assert.equal(p.decide(state(0, 0, 0))[0].args.on, true);
});

test('閘門沒開：不建第 2、3 套，人在別套就切回第 1 套', () => {
  const p = createPolicy({
    name: 'gate-switch', decideEveryGameSec: 1, needPanels: [], lists: {},
    equipSets: { panel: 'panels.equipSets', home: 0, gate: GATE, awayBlock: [] },
    rules: [
      { id: 'sw', cmd: 'player.switchEquipSet', equipSetSwitch: { panel: 'panels.equipSets', home: 0, minFilled: 1, encounter: { elite: 2 }, towerActive: 'panels.tower.tower.active' } }
    ]
  });
  const mk = (active) => {
    const s = state(0, 1, 0);
    s.ctx.mode = 'elite';                                       // 遇到菁英：開了閘門就會換第 3 套
    s.panels.equipSets = { active, unlocked: [true, true, true], sets: [{ slots: { a: 1 } }, { slots: { a: 1 } }, { slots: { a: 1 } }] };
    return s;
  };
  assert.deepEqual(p.decide(mk(0)), [], '在第 1 套、閘門沒開：遇到菁英也不換');
  const back = p.decide(mk(2));
  assert.deepEqual(back.map((c) => [c.name, c.args.index]), [['player.switchEquipSet', 0]], '人在第 3 套：切回第 1 套');
});
