/* 生存瓶頸：卡在同一關死太多次（player_strategy.md §2 敗因表「同關卡死亡次數過多」）。
   scripts/sim/policy_interpreter.js 的 observeStageDeaths／updateSurvivalContext 與 stageGate 的 survHold。

   使用者的規則：10 次是觸發線；觸發後**逐步**加強生存屬性，不是一次全換；過一次就算成功。
   合成 state 直接驅動策略層：要測的是計數、升階、成功與退回掛機的時機，不是遊戲。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createPolicy } = require(path.join(__dirname, '..', 'scripts/sim/policy.js'));

function mk(extra) {
  return createPolicy({
    name: 'stall-test',
    decideEveryGameSec: 5,
    needPanels: ['battle', 'inv'],
    survivalStall: Object.assign({
      counter: 'panels.battle.lootStats.sources.field.deaths', best: 'panels.battle.stage.best',
      zone: 'panels.battle.stage.zone', deathsAtStage: 10, stepDeaths: 5, stepMinSec: 600, maxTier: 4,
      farmExtraDeaths: 10, farmSec: 1800, farmBack: 10
    }, extra || {}),
    rules: [
      { id: 'gate', cmd: 'stage.setAutoAdvance', stageGate: {
        stage: 'view.stage', equippedRarities: 'panels.inv.equipmentRarities', argKey: 'on',
        checkpoints: [{ minRarity: 0, coverage: 0 }], retreatCmd: 'stage.go' } },
      { id: 'echo', cmd: 'debug.echo', args: {
        on: { $path: 'ctx.survival' }, tier: { $path: 'ctx.survivalTier' }, n: { $path: 'ctx.survivalDeaths' },
        wall: { $path: 'ctx.survivalStage' }, farm: { $path: 'ctx.survivalFarm' } } }
    ]
  });
}
/* best：這張地圖的最高關卡（單向棘輪）。 */
function st(t, stage, deaths, best, zone) {
  return { gameTimeSec: t, view: { stage },
    panels: { battle: { lootStats: { sources: { field: { deaths } } }, stage: { zone: zone || 'desert', best } },
      inv: { equipmentRarities: { weapon: 3 } } } };
}
const echo = (cmds) => cmds.find((c) => c.name === 'debug.echo').args;
const auto = (cmds) => cmds.find((c) => c.name === 'stage.setAutoAdvance').args.on;
const go = (cmds) => cmds.filter((c) => c.name === 'stage.go').map((c) => c.args.delta);

/* 卡在最高關卡 best，死 n 次（每次觀測一下）。回傳新的累計死亡數。 */
function die(p, t, n, deaths, best, stage) {
  for (let i = 0; i < n; i++) p.observe(st(t + i, stage || best - 10, deaths + i + 1, best));
  return deaths + n;
}

test('最高關卡沒前進的期間死滿 10 次才觸發；9 次不觸發', () => {
  const p = mk();
  p.observe(st(0, 30, 0, 41));
  let d = die(p, 1, 9, 0, 41);
  assert.equal(echo(p.decide(st(100, 31, d, 41))).tier, 0);
  d = die(p, 101, 1, d, 41);
  const e = echo(p.decide(st(200, 31, d, 41)));
  assert.equal(e.tier, 1);
  assert.equal(e.wall, 41);
});

test('逐步加強：觸發後每再死 5 次、且隔至少 10 分鐘才升一階，最多 4 階', () => {
  const p = mk();
  p.observe(st(0, 30, 0, 41));
  let d = 0, t = 1;
  const tiers = [];
  for (const n of [10, 5, 5, 5, 5]) { d = die(p, t, n, d, 41); t += 700; tiers.push(echo(p.decide(st(t, 31, d, 41))).tier); }
  assert.deepEqual(tiers, [1, 2, 3, 4, 4]);
});

test('死得再快也一次只升一階：10 分鐘內死 25 次仍停在第 1 階', () => {
  /* 前期約 30 次／小時；只看次數的話不到一小時就升到最高階，等於一次全換 */
  const p = mk();
  p.observe(st(0, 30, 0, 41));
  const d = die(p, 1, 25, 0, 41);
  assert.equal(echo(p.decide(st(100, 31, d, 41))).tier, 1);
  assert.equal(echo(p.decide(st(400, 31, d, 41))).tier, 1, '還不到 10 分鐘');
  assert.equal(echo(p.decide(st(701, 31, d, 41))).tier, 2, '滿 10 分鐘才升一階');
});

test('在一整段牆裡來回仍會累積（最高關卡沒前進就算同一關）', () => {
  /* 荒漠 41~49 的實際死法：過 41、死在 45、退回 35、再過 41……目前關卡一直變，但最高關卡停在 49 */
  const p = mk();
  p.observe(st(0, 30, 0, 49));
  let d = 0;
  for (let i = 0; i < 10; i++) {
    p.observe(st(i * 30 + 1, 42, d, 49));
    p.observe(st(i * 30 + 2, 45, d, 49));
    d++; p.observe(st(i * 30 + 3, 35, d, 49));
  }
  assert.equal(echo(p.decide(st(400, 35, d, 49))).tier, 1);
});

test('過一次就成功：死亡數與階段歸零、回到輸出配置；又卡住就從第 1 階重新開始', () => {
  const p = mk();
  p.observe(st(0, 30, 0, 41));
  let d = die(p, 1, 15, 0, 41);
  p.decide(st(100, 31, d, 41));
  assert.equal(echo(p.decide(st(800, 31, d, 41))).tier, 2, '前提：已到第 2 階');

  p.observe(st(801, 42, d, 42));                    // 過了 41：最高關卡前進
  let e = echo(p.decide(st(802, 42, d, 42)));
  assert.equal(e.n, 0, '死亡數歸零');
  assert.equal(e.tier, 0, '成功＝回到輸出配置');
  assert.equal(e.on, false);

  d = die(p, 803, 9, d, 42);
  assert.equal(echo(p.decide(st(900, 32, d, 42))).tier, 0, '卡在 42 再死 9 次還不觸發');
  d = die(p, 901, 1, d, 42);
  e = echo(p.decide(st(1000, 32, d, 42)));
  assert.equal(e.tier, 1, '死滿 10 次從第 1 階重新開始');
  assert.equal(e.wall, 42);
});

test('最高階仍過不去：再死 10 次才退 10 關掛機；時間到回去再試', () => {
  const p = mk();
  p.observe(st(0, 30, 0, 41));
  let d = die(p, 1, 25, 0, 41);                     // 10 + 5×3 = 第 4 階的死亡數
  let c;
  for (let i = 0; i < 4; i++) c = p.decide(st(100 + i * 700, 35, d, 41));   // 每隔 10 分鐘升一階
  assert.equal(echo(c).tier, 4);
  assert.equal(echo(c).farm, false, '剛到最高階還不退');

  d = die(p, 2201, 10, d, 41);
  c = p.decide(st(2300, 35, d, 41));
  assert.equal(echo(c).farm, true);
  assert.equal(auto(c), false, '掛機期間不得推關');
  assert.deepEqual(go(c), [-4], '從 35 退到 31（41−10）');
  c = p.decide(st(2305, 31, d, 41));
  assert.deepEqual(go(c), [], '已在掛機關卡就不再退');

  c = p.decide(st(2300 + 1800, 31, d, 41));         // 30 分鐘到
  assert.equal(echo(c).farm, false);
  assert.equal(auto(c), true, '回去推關');
  d = die(p, 4101, 9, d, 41);
  assert.equal(echo(p.decide(st(4200, 31, d, 41))).farm, false, '再死 9 次還不退');
  d = die(p, 4201, 1, d, 41);
  assert.equal(echo(p.decide(st(4300, 31, d, 41))).farm, true, '再死滿 10 次才再退');
});

test('掛機期間最高關卡前進＝成功，立刻解除掛機', () => {
  const p = mk();
  p.observe(st(0, 30, 0, 41));
  let d = die(p, 1, 35, 0, 41);
  let c;
  for (let i = 0; i < 4; i++) c = p.decide(st(100 + i * 700, 31, d, 41));
  assert.equal(echo(c).farm, true);
  p.observe(st(101, 42, d, 42));
  assert.equal(echo(p.decide(st(102, 42, d, 42))).farm, false);
});

test('換地圖時紀錄清空（關卡編號從 1 重數）', () => {
  const p = mk();
  p.observe(st(0, 30, 0, 41));
  let d = die(p, 1, 12, 0, 41);
  p.observe(st(100, 1, d, 1, 'Icefield'));
  assert.equal(echo(p.decide(st(101, 1, d, 1, 'Icefield'))).tier, 0);
});

test('計數器變小（遊戲重建統計）不會算出負的死亡數', () => {
  const p = mk();
  p.observe(st(0, 41, 50, 41));
  p.observe(st(1, 31, 3, 41));
  assert.equal(echo(p.decide(st(2, 31, 3, 41))).n, 0);
});

test('觀測面板包含死亡計數器的來源面板（才掛得上 1Hz 觀測）', () => {
  assert.ok(mk().observePanels.indexOf('battle') >= 0);
});

test('死亡計數器與最高關卡的路徑在真的遊戲面板裡解得出值（寫錯會變成永遠不觸發）', () => {
  const { createEngine } = require(path.join(__dirname, '..', 'scripts/sim/engine.js'));
  const raw = require(path.join(__dirname, '..', 'scripts/sim/policy.extreme.json'));
  const e = createEngine({ seed: 3 });
  e.boot(null);
  e.stepSeconds(120);
  const battle = e.panel('battle', raw.panelParams && raw.panelParams.battle);
  const at = (p) => p.split('.').slice(2).reduce((o, k) => (o == null ? o : o[k]), battle);
  assert.equal(typeof at(raw.survivalStall.counter), 'number');
  assert.equal(typeof at(raw.survivalStall.best), 'number');
  assert.equal(at(raw.survivalStall.zone), 'desert');
});

test('生存技能還學不起時不換進技能列，主力技能照常升級（「技能點與金幣足夠才切換」）', () => {
  /* ☠️ 回歸：生存群組只檢查存在就換進 desired，學習段學不起它們、主力也被擠出 desired 而停止升級。
     實測 24h × 15 seed 飛刀停在第 1 階，過 50 關的 seed 從 11 個掉到 1 個。 */
  const tier = (o) => Object.assign({ lv: 0, maxed: false, unlocked: true, prevOk: true, cost: 100, unlockLv: 1 }, o || {});
  const grp = (kind, castable, t0) => ({ kind, castable, passive: false, ult: null,
    tiers: [tier(Object.assign({ lv: castable ? 10 : 0, maxed: castable }, t0 || {})), tier(), tier(), tier(), tier(), tier(), tier()] });
  const skillPanel = {
    prefix: 'sg:', loadoutSize: 2, loadout: ['sg:knife', 'sg:thrust'], points: { available: 3 },
    groups: {
      knife: grp('phys', true), thrust: grp('phys', true),
      rockarmor: grp('earth', false, { unlocked: false, cost: 100000, unlockLv: 300 })
    }
  };
  const p = createPolicy({
    name: 'skill-stall', decideEveryGameSec: 5, needPanels: ['battle', 'skill'],
    skills: { panel: 'panels.skill', gold: 'view.gold', magicChance: 0, required: ['knife'],
      survival: ['rockarmor'], survivalSlots: 2, elemPool: ['fire'], elemCount: 1 },
    survivalStall: { counter: 'panels.battle.lootStats.sources.field.deaths', best: 'panels.battle.stage.best',
      zone: 'panels.battle.stage.zone', deathsAtStage: 10, stepDeaths: 5, maxTier: 4, skillTier: 2 },
    rules: [{ id: 'skill-plan', cmd: 'skill2.learn', skillPlan: true },
      { id: 'echo', cmd: 'debug.echo', args: { tier: { $path: 'ctx.survivalTier' } } }]
  });
  const s = (t, deaths) => ({ gameTimeSec: t, seed: 1, view: { stage: 31, gold: 5000 },
    panels: { skill: skillPanel, battle: { lootStats: { sources: { field: { deaths } } }, stage: { zone: 'desert', best: 41 } } } });
  p.observe(s(0, 0));
  for (let i = 1; i <= 15; i++) p.observe(s(i, i));
  p.decide(s(20, 15));
  const cmds = p.decide(s(700, 15));                 // 隔 10 分鐘升到第 2 階
  assert.equal(cmds.find((c) => c.name === 'debug.echo').args.tier, 2, '前提：已到第 2 階');
  const learns = cmds.filter((c) => c.name === 'skill2.learn').map((c) => c.args.group);
  assert.ok(learns.length > 0 && learns.every((g) => g === 'knife' || g === 'thrust'), '應繼續升級主力：' + JSON.stringify(learns));
  const lo = cmds.find((c) => c.name === 'skill.equipLoadout');
  assert.ok(!lo || JSON.stringify(lo.args).indexOf('rockarmor') < 0, '學不起的生存技能不得換進技能列');
});

test('七份策略都宣告了生存瓶頸：最多 2 階、分段由高階到低階、不轉換寶石庫存', () => {
  /* 實測 24h × 15 seed（docs/SIM_HARNESS.md ⑧）：
       最多 2 階、只改鑲嵌    過 50 關 13/15、死亡中位 360（原策略 11/15、577）
       開到 4 階             0/15——第 3 階起換掉主攻擊寶石就推不動了
       讓寶石轉換也跟著換    0/15——轉換是兩顆換一顆，來回切換把紅寶石耗光，成功後也換不回輸出配置
     這三條守的就是那兩個實測過的壞配置不要回來。 */
  const fs = require('fs');
  const dir = path.join(__dirname, '..', 'scripts/sim');
  for (const f of fs.readdirSync(dir).filter((x) => /^policy\..+\.json$/.test(x))) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(raw.survivalStall && raw.survivalStall.deathsAtStage === 10, f + ' 應宣告 survivalStall');
    assert.equal(raw.survivalStall.maxTier, 2, f + '：開到 4 階實測 0/15 過 50 關');
    const bands = raw.rules.find((r) => r.id === 'socket-gems').socketEmpty.preferByLevel;
    assert.deepEqual(bands.slice(0, 4).map((b) => b.when[0][2]), [2, 2, 1, 1],
      f + '：分段順序錯了會讓低階先命中、高階永遠用不到');
    const conv = raw.rules.find((r) => r.id === 'gem-convert');
    assert.ok(!JSON.stringify(conv).includes('ctx.survivalTier'), f + '：生存模式不得轉換寶石庫存（兩顆換一顆）');
  }
});
