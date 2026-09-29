/* 傷害數字的時序：模擬層一瞬間結算完整段傷害，但畫面上子彈要飛。
   這支測試釘的是「數字什麼時候跳出來」，不是傷害算得對不對。

   2026-09-29 舊技能系統整批移除：原本靠舊 castSkill 驗的幾條（遠近延遲不同、投射物事件的 travelMs、
   隕石落點、近戰不延後、舊多段技逐段錯開、延遲不影響結算）隨之刪除。
   新版技能的「飛行速度 → 特效飛行時間 → 傷害數字延遲」由 tests/skills2-flight-speed.test.cjs 涵蓋；
   本檔保留與技能種類無關的共用部分：等速飛行公式、travelMs／delayMs 的協議與顯示端接線。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console, Math: Object.create(Math), UI: { dirty: {} }, GT: 0,
    RUN_STATS: { skills: {} },
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    blog() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f }));
  context.G = {
    player: { level: 1, loadout: [], talents: { levels: {}, potentialLevels: {} } },
    stage: { current: 1 }, tower: { active: false }
  };
  context.getStats = () => ({
    cdr: 0, castSpeed: 0, hp: 1000, mp: 1000, atk: 100, matk: 100,
    aoeDmg: 0, critRate: 0, critDmg: 150, pPen: 0, mPen: 0, hit: 999, level: 1,
    passives: {}, lifesteal: 0, manaSteal: 0, shieldEff: 0, skillTriggers: {}
  });
  return context;
}

/* 座標制（2026-08-12）：敵人帶 pos={x,y}，我方在原點；距離＝直線距離。 */
function enemy(x, y) {
  return {
    hp: 1e9, maxHp: 1e9, def: 0, mdef: 0, dodge: 0, resist: {}, ctrlRes: 0,
    elite: false, isBoss: false, buffs: {}, dots: [], effects: {}, shield: 0,
    pos: { x: x, y: y }
  };
}

test('投射物是等速飛行：距離越遠飛越久，不是固定時間', () => {
  const c = loadContext();
  const near = enemy(80, 0);    // 最近
  const mid = enemy(200, 0);
  const far = enemy(340, 0);    // 最遠（刻意避開飛行時間上限，正比關係才驗得出來）
  const tNear = c.bfTravelSeconds(near);
  const tMid = c.bfTravelSeconds(mid);
  const tFar = c.bfTravelSeconds(far);
  assert.ok(tNear < tMid && tMid < tFar, '越遠應該飛越久：' + [tNear, tMid, tFar].join(' / '));
  // 時間確實是「距離 ÷ 速度」，而不是隨便給的級距
  assert.ok(Math.abs(tFar / tNear - c.bfTravelDistance(far) / c.bfTravelDistance(near)) < 1e-6,
    '飛行時間應與距離成正比');
  // 夾在上下限內
  assert.ok(tNear >= c.VFX_TRAVEL_MIN_SEC && tFar <= c.VFX_TRAVEL_MAX_SEC);
});

test('投射物速度在目前值上再降低 20%，且上下限同步延長', () => {
  const c = loadContext();
  const target = enemy(340, 0);
  assert.equal(c.VFX_PROJECTILE_SPEED_MULTIPLIER, 0.6);
  assert.equal(c.VFX_PROJECTILE_SPEED_CELLS, 8.4);
  assert.equal(c.VFX_TRAVEL_MIN_SEC, 0.1);
  assert.equal(c.VFX_TRAVEL_MAX_SEC, 0.75);
  assert.equal(c.bfTravelSeconds(target), c.bfTravelDistance(target) /
    (c.VFX_PROJECTILE_SPEED_CELLS * c.BF_UNIT));
});

test('特效事件的 travelMs 原樣送到顯示端，動畫長度與傷害數字用同一組飛行時間（不會走鐘）', () => {
  // 顯示端拿同一個數字當動畫長度（v17：受擊爆點的命中時刻 hitAt 也用同一個數）
  const vfx = fs.readFileSync(path.join(root, 'js/vfx.js'), 'utf8');
  assert.match(vfx, /var tr = \(travelMs && travelMs\[rt\.idxs\[t\]\] > 0\) \? travelMs\[rt\.idxs\[t\]\] : 0;/);
  assert.match(vfx, /vfxProjectile\(s, layer, from, pt, delay, tr\)/);
  assert.match(vfx, /d\.style\.animationDuration = flight \+ 'ms'/);
  assert.match(vfx, /function vfxProjectileFlightMs\(travelMs, fallbackDurationSec\)/);
  /* shim 是逐欄挑選後才送出事件的，漏掉 travelMs 的話畫面會退回預設飛行時間，
     變成「數字到了子彈還在飛」——實機驗證時就是這樣抓到的。 */
  const shim = fs.readFileSync(path.join(root, 'js/worker/shim.js'), 'utf8');
  assert.match(shim, /travelMs:\s*spec\.travelMs \|\| null/);
});

test('浮字延遲會原樣送到顯示端（協議 v11 的 delayMs）', () => {
  const shim = fs.readFileSync(path.join(root, 'js/worker/shim.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(shim, /delayMs:\s*\(delayMs > 0\) \? delayMs : 0/);
  assert.match(ui, /function flushWorkerVisualEvents\(\)[\s\S]*floatText\(event\.elId, event\.text, event\.cls, event\.damageValue, null,\s*uiBattlePanelSnapshot\(\), event\.delayMs\)/);
  // 顯示端收到延遲就排程重播，不是丟掉
  assert.match(ui, /if \(delayMs > 0\) \{[\s\S]*?setTimeout\([\s\S]*?floatText\(elId, text, cls, damageValue, ent, battleSnapshot, 0\)/);
});
