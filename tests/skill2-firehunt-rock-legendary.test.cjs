/* 傳奇進化第六批（2026-08-25）：火狩（水晶球）／岩甲術（法器）
   設計來源：神力之巔_記事錄試算表〈傳奇進化〉頁籤的火狩、岩甲術兩段。
   守住的事：
     1. 火狩五個傳奇：增焰（體積與環半徑）、伴生併發（每秒飛出一團）、
        烈火狩（每 0.5 秒堆火焰增幅）、炎爆（命中滿次數爆炸）、狩獵者（數量減半換傷害）
     2. 火狩三個超神：烈陽星環（＋1 團／體積成長／轉速／傷害）、
        無限星環（螺旋外擴＋持續放出）、火神降臨（常駐火焰領域＋普攻星環）
     3. 岩甲術五個傳奇：重岩甲（護盾）、輕飛甲（移速）、巨岩增幅（層數上限）、
        尖刺甲（尖刺傷害）、大地之心（護盾歸零給無敵，有內部冷卻）
     4. 岩甲術三個超神：超重岩之術（石化＋土系易傷）、金剛不壞（減傷／生命／護盾／尖刺）、
        超重力場（僵化＋土系增傷）

   ⚠️ 本檔只驗「機制有沒有接上」，不驗「數字調校得對不對」（那是參數表的事）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext(extra) {
  const logs = [];
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog(message) { logs.push(message); },
    floatText() {}, trackDps() {}, recordRunDamage() {},
    logs
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js',
    'js/skills.js', 'js/skills2.js', 'js/legendary.js'].concat(extra || [])
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {}, ult: {} }, loadout: [] }, stage: { current: 1 } };
  context.BASE_STATS = {
    atk: 1000, matk: 500, hp: 1000, mp: 500, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, shieldEff: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: {},
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0, legendaryEffects: {}, legendaryEffectMults: {}
  };
  context.getStats = () => context.BASE_STATS;
  context.GT = 0;
  return context;
}

function enemy(hp, x, y, name, kind) {
  return {
    name: name || '測試怪', maxHp: hp, hp, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    elite: kind === 'elite', isBoss: kind === 'boss',
    pos: (x === undefined) ? undefined : { x, y }
  };
}
function playerEnt() {
  return { hp: 1000, mp: 1e9, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
function stubHits(c) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ ent: defender, aCfg: aCfg, atk: aCfg.atk, total: aCfg.totalDmgPct, elemAmp: aCfg.skillElemAmp });
    return { dmg: 100, crit: false, miss: false, blocked: false, killed: false };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  return calls;
}
function stubVfx(c) {
  const specs = [];
  c.playCombatVfx = (spec) => specs.push(spec);
  c.enemyEventFloatTarget = (ent) => ent.name;
  c.playerEventFloatTarget = (sel) => sel;
  return specs;
}
function tickCtx(c, p, enemies) {
  return { pEnt: p, getEnemies: () => enemies, floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
}
function setLevels(c, gid, levels) { c.G.player.skills2.levels[gid] = levels.slice(); }
function maxLevels(c, gid) { setLevels(c, gid, [10, 10, 10, 10, 10, 10, 10]); }
function equip(c, gid) { c.G.player.loadout = [c.SG_PREFIX + gid]; }
function setUlt(c, gid, id, lv) {
  c.G.player.skills2.ult[gid] = { pick: c.sgUltIndexOfId(gid, id), lv: lv === undefined ? 1 : lv };
}
function setLegendary(c, keys) {
  const on = {};
  (keys || []).forEach((k) => { on[k] = true; });
  c.BASE_STATS = Object.assign({}, c.BASE_STATS, { legendaryEffects: on, legendaryEffectMults: {} });
}
/* 推進 n 個 0.1 秒的 tick（GT 與 tickSkill2 一起走，與遊戲主迴圈同一個節拍）。 */
function advance(c, p, enemies, seconds) {
  const step = 0.1;
  for (let t = 0; t < Math.round(seconds / step); t++) {
    c.GT = +(c.GT + step).toFixed(4);
    c.tickSkill2(step, tickCtx(c, p, enemies));
  }
}

/* ===========================================================================
   1) 火狩的五個傳奇特效
   =========================================================================== */

test('【增焰】：火狩的體積與環繞半徑同步 +25%', () => {
  function field(keys) {
    const c = loadContext();
    stubHits(c); stubVfx(c);
    setLegendary(c, keys);
    setLevels(c, 'firehunt', [1, 0, 0, 0, 0, 0, 0]);
    c.castSkill2(playerEnt(), [enemy(1e9, 60, 0)], 'firehunt', 'mv-float');
    return c.SKILL2_RT.orbits[0];
  }
  const base = field([]);
  const amp = field(['firehuntAmplify']);
  assert.ok(base && amp, '兩邊都要建立環繞場域');
  assert.equal(Math.round(amp.rings[0].r / base.rings[0].r * 100), 125, '環繞半徑 +25%');
  assert.equal(Math.round(amp.bodyR / base.bodyR * 100), 125, '火狩體積 +25%');
});

test('【狩獵者】：火狩數量減半（進位、至少 1 團），但每次命中傷害 +150%', () => {
  function field(keys) {
    const c = loadContext();
    stubHits(c); stubVfx(c);
    setLegendary(c, keys);
    setLevels(c, 'firehunt', [1, 0, 0, 0, 0, 0, 0]);
    c.castSkill2(playerEnt(), [enemy(1e9, 60, 0)], 'firehunt', 'mv-float');
    return c.SKILL2_RT.orbits[0];
  }
  const base = field([]);
  const hunter = field(['firehuntHunter']);
  assert.equal(base.orbs.length, 2, '基準：2 團');
  assert.equal(hunter.orbs.length, 1, '減半後 1 團');
  assert.equal(Math.round(hunter.dmgVal / base.dmgVal * 100), 250, '傷害 ×2.5');
});

test('【炎爆】：同一個敵人被火狩命中滿次數就爆炸，波及周圍', () => {
  const c = loadContext();
  const calls = stubHits(c); stubVfx(c);
  setLegendary(c, ['firehuntDetonate']);
  setLevels(c, 'firehunt', [1, 0, 0, 0, 0, 0, 0]);
  const p = playerEnt();
  const near = enemy(1e9, 60, 0);
  const beside = enemy(1e9, 62, 0);
  c.castSkill2(p, [near, beside], 'firehunt', 'mv-float');
  const f = c.SKILL2_RT.orbits[0];
  assert.ok(f.detonate, '應帶著炎爆規格');
  assert.equal(f.detonate.hits, 10);

  // 直接以規格驅動爆炸（環繞接觸的節拍由 skill2-magic-firehunt 守）
  calls.length = 0;
  near._sgHuntHits = 0;
  c.sgFirehuntDetonate(f, near, [near, beside], { killed: false, dmg: 0, crit: false });
  assert.ok(calls.length >= 2, '爆炸要打到本體與周圍的敵人');
  assert.ok(calls.some((k) => k.ent === beside), '周圍的敵人也吃到');
});

test('【伴生併發】：火狩在場時每 1 秒飛出一團，且飛出的那一團會從場上消失', () => {
  /* 環繞本體的接觸命中也走 resolveHit，因此要以傷害值把兩者分開：
     飛出的那一團是 300% 魔攻（500×3＝1500），環繞本體是 Lv.1 的 110%（550）。 */
  const LAUNCH_ATK = 1500;
  const launched = (calls) => calls.filter((k) => Math.round(k.atk) === LAUNCH_ATK).length;

  const c = loadContext();
  const calls = stubHits(c); stubVfx(c);
  setLegendary(c, ['firehuntConcurrent']);
  setLevels(c, 'firehunt', [1, 0, 0, 0, 0, 0, 0]);
  equip(c, 'firehunt');
  const p = playerEnt();
  const m = enemy(1e9, 60, 0);
  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  assert.equal(c.SKILL2_RT.orbits[0].orbs.length, 2, '基準：2 團');
  calls.length = 0;
  advance(c, p, [m], 0.5);
  assert.equal(launched(calls), 0, '不到 1 秒不飛出');
  advance(c, p, [m], 0.7);
  assert.equal(launched(calls), 1, '滿 1 秒飛出一團');
  // 使用者決策 2026-08-25：飛出去的那一團會被消耗掉
  assert.equal(c.SKILL2_RT.orbits[0].orbs.length, 1, '飛出去的那一團從場上消失');

  // 再飛一次就把整組消耗光，空掉的場域要就地收掉（狀態列不能繼續倒數）
  advance(c, p, [m], 1);
  assert.equal(c.SKILL2_RT.orbits.length, 0, '消耗光的場域要收掉');
  assert.equal(c.sgFirehuntFieldActive(p), false);

  // 沒裝配在技能列就不生效（與其他主動型被動同一條代價）
  const c2 = loadContext();
  const calls2 = stubHits(c2); stubVfx(c2);
  setLegendary(c2, ['firehuntConcurrent']);
  setLevels(c2, 'firehunt', [1, 0, 0, 0, 0, 0, 0]);
  const p2 = playerEnt();
  const m2 = enemy(1e9, 60, 0);
  c2.castSkill2(p2, [m2], 'firehunt', 'mv-float');
  calls2.length = 0;
  advance(c2, p2, [m2], 1.5);
  assert.equal(launched(calls2), 0, '未裝配時不飛出');
  assert.equal(c2.SKILL2_RT.orbits[0].orbs.length, 2, '未裝配時也不會被消耗');
});

test('【伴生併發】優先消耗伴生體，沒有伴生體才拿一般的火狩', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  setLegendary(c, ['firehuntConcurrent']);
  // 第 7 階【狩神之舞】＝每團出現時自帶伴生，因此場上一定有伴生體可消耗
  maxLevels(c, 'firehunt');
  equip(c, 'firehunt');
  const p = playerEnt();
  const m = enemy(1e9, 60, 0);
  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  const f = c.SKILL2_RT.orbits[0];
  const companionsBefore = f.orbs.filter((o) => o.companion).length;
  const mothersBefore = f.orbs.filter((o) => !o.companion).length;
  assert.ok(companionsBefore > 0 && mothersBefore > 0, '狩神之舞應同時有母體與伴生體');
  advance(c, p, [m], 1.1);
  assert.equal(f.orbs.filter((o) => o.companion).length, companionsBefore - 1, '消耗的是伴生體');
  assert.equal(f.orbs.filter((o) => !o.companion).length, mothersBefore, '母體不動');
});

test('【烈火狩】：火狩在場期間每 0.5 秒把火焰傷害再堆高一層，火狩消失後退場', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  setLegendary(c, ['firehuntBlaze']);
  setLevels(c, 'firehunt', [1, 0, 0, 0, 0, 0, 0]);
  equip(c, 'firehunt');
  const p = playerEnt();
  const m = enemy(1e9, 60, 0);
  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  assert.equal(c.skill2FireAmpPct(p), 0, '施放當下還沒堆');
  advance(c, p, [m], 0.6);
  const one = c.skill2FireAmpPct(p);
  assert.equal(one, 2, '第一拍 +2%');
  advance(c, p, [m], 0.5);
  assert.equal(c.skill2FireAmpPct(p), 4, '第二拍再 +2%（累加成單一數值）');
  // 火焰增幅走 legendaryElementDamageUp 這個唯一收斂點
  assert.equal(c.legendaryElementDamageUp(c.BASE_STATS, p).fire, 4);
});

/* ===========================================================================
   2) 火狩的三個超神進化
   =========================================================================== */

test('【烈陽星環】：＋1 團、體積隨時間長大、環繞更快、傷害更高', () => {
  function field(withUlt) {
    const c = loadContext();
    stubHits(c); stubVfx(c);
    maxLevels(c, 'firehunt');
    if (withUlt) setUlt(c, 'firehunt', 'solarRing', 1);
    c.castSkill2(playerEnt(), [enemy(1e9, 60, 0)], 'firehunt', 'mv-float');
    return c.SKILL2_RT.orbits[0];
  }
  const base = field(false);
  const solar = field(true);
  /* 滿級＝第 7 階【狩神之舞】生效：2 道 × 3 團，且每團出現時自帶 1 個伴生 → 12 個環繞體。
     ＋1 團之後是 2 道 × 4 團 ×（本體＋伴生）＝ 16 個。 */
  assert.equal(base.rings.length, 2);
  assert.equal(base.orbs.length, 12, '基準：2 道 × 3 團 × (本體＋伴生)');
  assert.equal(solar.orbs.length, 16, '每一道多 1 團（伴生跟著多一個）');
  assert.equal(Math.round(solar.rings[0].spin / base.rings[0].spin * 100), 130, '環繞速度 +30%');
  assert.equal(Math.round(solar.dmgVal / base.dmgVal * 100), 160, 'Lv.1 傷害 +60%（50 ＋ 每級 10）');
  assert.equal(base.bodyGrowTo, 1, '沒選就不成長');
  assert.equal(solar.bodyGrowTo, 1.6, '4 秒內最多 +60%');
  assert.equal(solar.bodyGrowSec, 4);
});

test('【烈陽星環】的體積成長是逐幀連續的，且到 growSec 就停在上限', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  maxLevels(c, 'firehunt');
  setUlt(c, 'firehunt', 'solarRing', 1);
  equip(c, 'firehunt');
  const p = playerEnt();
  const m = enemy(1e9, 60, 0);         // 火狩 castM＝8 米，目標必須在施法距離內
  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  const f = c.SKILL2_RT.orbits[0];
  const r0 = f.bodyR0;
  advance(c, p, [m], 2);
  assert.ok(f.bodyR > r0 * 1.25 && f.bodyR < r0 * 1.35, '2 秒＝一半的成長（約 1.3 倍）');
  advance(c, p, [m], 3);
  assert.equal(Math.round(f.bodyR / r0 * 100), 160, '成長到上限就停住');
});

test('【無限星環】：改為從圓心向外的螺旋，並在持續時間內分批再放出火狩', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  maxLevels(c, 'firehunt');
  setUlt(c, 'firehunt', 'infiniteRing', 1);
  equip(c, 'firehunt');
  const p = playerEnt();
  const m = enemy(1e9, 60, 0);         // 火狩 castM＝8 米，目標必須在施法距離內
  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  const f = c.SKILL2_RT.orbits[0];
  assert.equal(f.spiral, true, '半徑改掛在每一團身上');
  assert.ok(f.growPxPerSec > 0, '要往外長');
  assert.equal(f.spawnLeft, 11, 'Lv.1 額外 11 團（10 ＋ 每級 1）');
  assert.equal(f.spiralMaxPx, c.bfMeterPx(40), '外擴上限 40 米（使用者決策 2026-08-25）');
  const born = f.orbs.length;
  const startR = f.orbs[0].radius;
  advance(c, p, [m], 3);
  assert.ok(f.orbs.length > born, '持續時間內要不斷放出新的火狩');
  assert.ok(f.orbs[0].radius > startR, '先出生的那一團已經往外走了');
  const newest = f.orbs[f.orbs.length - 1];
  assert.ok(newest.radius < f.orbs[0].radius, '後放出的在內圈＝螺旋，不是同心圓');
  assert.ok(f.orbs[0].radius <= f.spiralMaxPx + 1e-6, '外擴不超過上限');
});

test('【火神降臨】：常駐火焰領域每 0.5 秒打一次，且普攻附加火狩星環', () => {
  const c = loadContext();
  const calls = stubHits(c); stubVfx(c);
  maxLevels(c, 'firehunt');
  setUlt(c, 'firehunt', 'fireGodDescend', 1);
  equip(c, 'firehunt');
  const p = playerEnt();
  const near = enemy(1e9, 30, 0);      // 6 米內
  const far = enemy(1e9, 900, 0);      // 遠在範圍外
  // 領域不需要先施放火狩本體（設計文檔：你的身體被火焰包裹）
  advance(c, p, [near, far], 0.6);
  assert.ok(calls.length > 0, '領域要自己開始打');
  assert.ok(calls.every((k) => k.ent === near), '只打範圍內的敵人');

  /* 普攻附加：3 顆星環（Lv.1 ＝ 3 ＋ 每級 0.3 → 3.3，小數以機率補）。
     使用者決策 2026-08-25：星環改為 24 米／秒的飛行投射物，因此普攻當下**不結算傷害**，
     只排進飛行物佇列；回傳的是射出幾顆，不是傷害。 */
  calls.length = 0;
  c.chance = () => false;             // 不補那 0.3 顆
  c.SKILL2_RT.projectiles.length = 0;
  const fired = c.skills2OnBasicAttack(p, near, 'mv-float', c.BASE_STATS);
  assert.equal(fired, 3, '固定 3 顆');
  assert.equal(calls.length, 0, '普攻當下不結算傷害（要等飛到）');
  assert.equal(c.SKILL2_RT.projectiles.length, 3, '三顆都進飛行物佇列');
  const orb = c.SKILL2_RT.projectiles[0];
  assert.equal(Math.round(orb.speed), c.bfMeterPx(24), '飛行速度 24 米／秒');
  /* 威力取「第 6 階時的火狩」＝第 4 階【三重火狩】的改寫值（120 ＋ 每級 12，Lv.10 ＝ 240%），
     不是第 1 階的 200%、也不是第 7 階【狩神之舞】的 300%。 */
  assert.equal(Math.round(orb.dmgVal), Math.round(500 * 240 / 100));
  // 飛到之後才結算
  c.GT += 5;
  c.tickSkill2(0.1, tickCtx(c, p, [near, far]));
  assert.ok(calls.length >= 3, '抵達後才結算三顆的傷害');

  // 沒選這個超神進化就完全不作用
  const c2 = loadContext();
  const calls2 = stubHits(c2); stubVfx(c2);
  maxLevels(c2, 'firehunt');
  equip(c2, 'firehunt');
  const p2 = playerEnt();
  advance(c2, p2, [enemy(1e9, 30, 0)], 1);
  assert.equal(calls2.length, 0);
  assert.equal(c2.skills2OnBasicAttack(p2, enemy(1e9, 30, 0), 'mv-float', c2.BASE_STATS), 0);
});

/* ===========================================================================
   3) 岩甲術的五個傳奇特效
   =========================================================================== */

function castRock(c, keys, levels, ultId) {
  stubHits(c); stubVfx(c);
  if (keys) setLegendary(c, keys);
  setLevels(c, 'rockarmor', levels);
  if (ultId) setUlt(c, 'rockarmor', ultId, 1);
  equip(c, 'rockarmor');
  const p = playerEnt();
  const m = enemy(1e9, 60, 0);
  c.castSkill2(p, [m], 'rockarmor', 'mv-float');
  return { p, m };
}

test('【重岩甲】：岩甲術獲得的護盾 +30%', () => {
  const c = loadContext();
  const a = castRock(c, [], [1, 0, 0, 0, 0, 0, 0]);
  const basePct = c.buffVal(a.p, 'sgRockArmor');
  const c2 = loadContext();
  const b = castRock(c2, ['rockHeavyArmor'], [1, 0, 0, 0, 0, 0, 0]);
  const heavyPct = c2.buffVal(b.p, 'sgRockArmor');
  assert.ok(basePct > 0);
  assert.equal(Math.round(heavyPct / basePct * 100), 130, '護盾比例 ×1.3');
  assert.ok(b.p.shield > a.p.shield, '實際拿到的護盾也要更高');
});

test('【輕飛甲】：岩甲護盾存在期間移動速度 +30%（護盾結束就回復）', () => {
  const c = loadContext();
  const a = castRock(c, ['rockLightArmor'], [1, 0, 0, 0, 0, 0, 0]);
  assert.equal(Math.round(c.skill2PlayerMoveFactor(a.p) * 100), 130);
  // 我方移動速度的唯一乘區在 battlefield.js，這裡確認它接得到
  assert.equal(Math.round(c.bfPlayerSpeedFactor(a.p) * 100), 130);
  c.GT = 999;
  assert.equal(c.skill2PlayerMoveFactor(a.p), 1, '岩甲結束就沒有加速');

  const c2 = loadContext();
  const b = castRock(c2, [], [1, 0, 0, 0, 0, 0, 0]);
  assert.equal(c2.skill2PlayerMoveFactor(b.p), 1, '沒有這個特效就沒有加速');
});

test('【尖刺甲】：岩甲尖刺的反擊傷害 ×2', () => {
  function spike(keys) {
    const c = loadContext();
    const calls = stubHits(c); stubVfx(c);
    if (keys.length) setLegendary(c, keys);
    setLevels(c, 'rockarmor', [1, 1, 1, 0, 0, 0, 0]);
    equip(c, 'rockarmor');
    const p = playerEnt();
    const m = enemy(1e9, 60, 0);
    c.castSkill2(p, [m], 'rockarmor', 'mv-float');
    calls.length = 0;
    c.skills2OnPlayerDamaged(m, p, 10, false, { absorbed: 10 }, 'mv-float');
    assert.ok(calls.length >= 1, '尖刺要打出一段傷害');
    return calls[0].atk;
  }
  const base = spike([]);
  const armored = spike(['rockSpikeArmor']);
  assert.equal(Math.round(armored / base * 100), 200, '尖刺效果 +100%');
});

test('【巨岩增幅】：岩甲增幅的可疊層數 +10 層（上限跟著提高）', () => {
  function cap(keys) {
    const c = loadContext();
    stubHits(c); stubVfx(c);
    if (keys.length) setLegendary(c, keys);
    setLevels(c, 'rockarmor', [1, 1, 1, 1, 1, 1, 0]);
    equip(c, 'rockarmor');
    const p = playerEnt();
    const m = enemy(1e9, 60, 0);
    c.castSkill2(p, [m], 'rockarmor', 'mv-float');
    // 一路把護盾吃光，讓增幅疊到上限
    for (let i = 0; i < 40; i++) {
      c.skills2OnPlayerDamaged(m, p, 0, false, { absorbed: c.SKILL2_RT.rock.base }, 'mv-float');
    }
    return c.buffVal(p, 'sgRockAmp');
  }
  const base = cap([]);
  const boosted = cap(['rockAmpBoost']);
  assert.ok(base > 0);
  const per = base / 30;                    // 表定 30 層
  assert.equal(Math.round(boosted / per), 40, '30 → 40 層');
});

test('【大地之心】：護盾被打光的那一下給無敵，且 30 秒內只觸發一次', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  setLegendary(c, ['rockEarthHeart']);
  setLevels(c, 'rockarmor', [1, 0, 0, 0, 0, 0, 0]);
  equip(c, 'rockarmor');
  const p = playerEnt();
  const m = enemy(1e9, 60, 0);
  c.castSkill2(p, [m], 'rockarmor', 'mv-float');
  assert.ok(p.shield > 0);
  // 還有護盾＝不觸發
  c.skills2OnPlayerDamaged(m, p, 0, false, { absorbed: 1 }, 'mv-float');
  assert.equal(c.effectActive(p, 'invuln'), false);
  // 打光那一下＝觸發
  p.shield = 0;
  c.skills2OnPlayerDamaged(m, p, 0, false, { absorbed: 1 }, 'mv-float');
  assert.equal(!!c.effectActive(p, 'invuln'), true, '護盾歸零給無敵');
  const until = c.SKILL2_RT.rockHeartAt;
  assert.ok(until >= 30, '內部冷卻 30 秒');
  // 冷卻中不再觸發
  delete p.buffs.invuln;
  delete p.effects.invuln;
  c.skills2OnPlayerDamaged(m, p, 0, false, { absorbed: 1 }, 'mv-float');
  assert.equal(c.effectActive(p, 'invuln'), false, '冷卻中不再觸發');
  assert.equal(c.SKILL2_RT.rockHeartAt, until, '冷卻不會被重設');
});

/* ===========================================================================
   4) 岩甲術的三個超神進化
   =========================================================================== */

test('【超重岩之術】：施放時石化範圍內的敵人（行動限制走暈眩、增傷走石化標記）', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  maxLevels(c, 'rockarmor');
  setUlt(c, 'rockarmor', 'superRockArt', 1);
  equip(c, 'rockarmor');
  const p = playerEnt();
  const near = enemy(1e9, 60, 0);
  const far = enemy(1e9, 900, 0);
  c.castSkill2(p, [near, far], 'rockarmor', 'mv-float');
  assert.ok(c.buffVal(near, 'sgPetrify') > 0, '範圍內石化');
  assert.equal(!!c.effectActive(near, 'stun'), true, '無法行動由暈眩承擔');
  assert.equal(c.buffVal(far, 'sgPetrify'), 0, '範圍外不受影響');

  // 石化只放大土系那一段，不會連同一次攻擊的其他屬性一起放大
  const cfg = c.skill2VulnACfg({ totalDmgPct: 0 }, near);
  assert.ok(cfg.skillElemAmp && cfg.skillElemAmp.earth > 1, '土系受傷增幅');
  assert.equal(cfg.skillElemAmp.fire, undefined, '不碰其他屬性');
  assert.equal(cfg.totalDmgPct, 0, '不混進「所有傷害」乘區');
});

test('【金剛不壞】：岩甲期間的減傷、生命上限、護盾與尖刺一起提高', () => {
  const c = loadContext();
  const calls = stubHits(c); stubVfx(c);
  maxLevels(c, 'rockarmor');
  setUlt(c, 'rockarmor', 'adamantBody', 1);
  equip(c, 'rockarmor');
  const p = playerEnt();
  const m = enemy(1e9, 60, 0);
  /* 生命上限倍率是 computeStats 的一部分，因此用「會跟著倍率動的 getStats」模擬真實流程——
     這樣才驗得到「RT 先成立、屬性再重算、護盾最後才塗」的順序：順序錯的話
     這一次的護盾仍照舊上限給，玩家看到的是「第一次放沒效、第二次才對」。 */
  c.markStatsDirty = () => {};
  c.getStats = () => Object.assign({}, c.BASE_STATS, { hp: 1000 * c.skill2RockMaxHpFactor() });
  assert.equal(c.skill2RockMaxHpFactor(), 1, '沒施放時沒有生命上限加成');
  c.castSkill2(p, [m], 'rockarmor', 'mv-float');

  // 生命上限：Lv.1 ＝ 50 ＋ 每級 5 → +55%
  assert.equal(Math.round(c.skill2RockMaxHpFactor() * 100), 155);
  /* 使用者決策 2026-08-25：當前生命跟著上限等比例一起漲，生命百分比維持不變。 */
  assert.equal(Math.round(p.hp), 1550, '滿血施放：1000/1000 → 1550/1550');
  // 護盾＝放大後的生命上限 × 放大後的護盾比例（1550 × 155%），不是 1000 × 155%
  assert.equal(Math.round(p.shield), Math.round(1000 * 1.55 * 1.55), '第一次施放就吃到放大後的生命上限');
  // 護盾比例同樣 ×1.55（表定 100% → 155%）
  assert.equal(Math.round(c.buffVal(p, 'sgRockArmor')), 155);
  // 減傷：Lv.1 ＝ 90 ＋ 每級 0.9 → 90.9%
  const mult = c.skill2DamageTakenMultiplier(p);
  assert.ok(mult < 0.1, '減傷要真的接上受擊乘區');
  // 尖刺 +100%
  calls.length = 0;
  c.skills2OnPlayerDamaged(m, p, 10, false, { absorbed: 10 }, 'mv-float');
  const withUlt = calls[0].atk;

  const c2 = loadContext();
  const calls2 = stubHits(c2); stubVfx(c2);
  maxLevels(c2, 'rockarmor');
  equip(c2, 'rockarmor');
  const p2 = playerEnt();
  const m2 = enemy(1e9, 60, 0);
  c2.castSkill2(p2, [m2], 'rockarmor', 'mv-float');
  calls2.length = 0;
  c2.skills2OnPlayerDamaged(m2, p2, 10, false, { absorbed: 10 }, 'mv-float');
  /* 尖刺傷害＝最大生命 × 階級% × (1 + 尖刺加成%)，因此同時吃到兩個乘區：
     尖刺效果 +100%（×2）與生命上限 +55%（×1.55）→ 合計 ×3.1。 */
  assert.equal(Math.round(withUlt / calls2[0].atk * 100), 310, '尖刺 +100% × 生命上限 +55%');

  // 岩甲到期：生命上限倍率跟著收回去，當前生命按同一個比例縮回（不白賺相對生命）
  c.GT = 999;
  c.tickSkill2(0.1, tickCtx(c, p, [m]));
  assert.equal(c.skill2RockMaxHpFactor(), 1);
  assert.equal(Math.round(p.hp), 1000, '到期縮回 1000/1000，百分比不變');
});

test('【金剛不壞】半血施放與到期都維持生命百分比，且不會把人縮死', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  maxLevels(c, 'rockarmor');
  setUlt(c, 'rockarmor', 'adamantBody', 1);
  equip(c, 'rockarmor');
  c.markStatsDirty = () => {};
  c.getStats = () => Object.assign({}, c.BASE_STATS, { hp: 1000 * c.skill2RockMaxHpFactor() });
  const p = playerEnt();
  const m = enemy(1e9, 60, 0);
  p.hp = 500;                                   // 半血
  c.castSkill2(p, [m], 'rockarmor', 'mv-float');
  assert.equal(Math.round(p.hp), 775, '半血施放：500/1000 → 775/1550（仍是 50%）');
  c.GT = 999;
  c.tickSkill2(0.1, tickCtx(c, p, [m]));
  assert.equal(Math.round(p.hp), 500, '到期縮回 500/1000（仍是 50%）');

  // 只剩 1 點生命時到期不能被除成 0（那等於技能自己把人殺了）
  const c2 = loadContext();
  stubHits(c2); stubVfx(c2);
  maxLevels(c2, 'rockarmor');
  setUlt(c2, 'rockarmor', 'adamantBody', 1);
  equip(c2, 'rockarmor');
  c2.markStatsDirty = () => {};
  c2.getStats = () => Object.assign({}, c2.BASE_STATS, { hp: 1000 * c2.skill2RockMaxHpFactor() });
  const p2 = playerEnt();
  const m2 = enemy(1e9, 60, 0);
  c2.castSkill2(p2, [m2], 'rockarmor', 'mv-float');
  p2.hp = 1;
  c2.GT = 999;
  c2.tickSkill2(0.1, tickCtx(c2, p2, [m2]));
  assert.ok(p2.hp >= 1, '到期不得把生命縮到 0');
});

test('【超重力場】：施放時使範圍內的敵人僵化，且岩甲期間土系傷害提高', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  maxLevels(c, 'rockarmor');
  setUlt(c, 'rockarmor', 'gravityField', 1);
  equip(c, 'rockarmor');
  const p = playerEnt();
  const near = enemy(1e9, 60, 0);
  const far = enemy(1e9, 900, 0);
  c.castSkill2(p, [near, far], 'rockarmor', 'mv-float');
  assert.equal(c.buffVal(near, 'sgStiffen'), 65, '範圍內僵化');
  assert.equal(c.buffVal(far, 'sgStiffen'), 0, '範圍外不受影響');

  // 僵化的三個下降各自接上既有收斂點
  assert.equal(Math.round(c.skill2SlowAspdFactor(near) * 100), 35, '攻速 -65%');
  assert.equal(Math.round(c.skill2SlowMoveFactor(near) * 100), 35, '移速 -65%');
  assert.equal(Math.round(c.skill2EnemyDamageFactor(near) * 100), 35, '造成的傷害 -65%');

  // 土系增傷走 legendaryElementDamageUp 這個唯一收斂點
  assert.equal(c.legendaryElementDamageUp(c.BASE_STATS, p).earth, 330, 'Lv.1 ＝ 300 ＋ 每級 30');
  c.GT = 999;
  assert.equal(c.legendaryElementDamageUp(c.BASE_STATS, p).earth, undefined, '岩甲結束就沒有增傷');
});

/* ===========================================================================
   5) 參數表往返
   =========================================================================== */

test('參數表往返：Skills2 的六個超神進化列與 Equipment_Affix 的十個新特效都落表', () => {
  const skills2Csv = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8');
  const affixCsv = fs.readFileSync(path.join(root, 'config/CSV/Equipment_Affix.csv'), 'utf8');
  ['solarRing', 'infiniteRing', 'fireGodDescend', 'superRockArt', 'adamantBody', 'gravityField']
    .forEach((id) => assert.ok(skills2Csv.includes(id), 'Skills2 表缺少超神進化 ' + id));
  ['firehuntAmplify', 'firehuntConcurrent', 'firehuntBlaze', 'firehuntDetonate', 'firehuntHunter',
    'rockHeavyArmor', 'rockLightArmor', 'rockAmpBoost', 'rockSpikeArmor', 'rockEarthHeart']
    .forEach((id) => assert.ok(affixCsv.includes(id), 'Equipment_Affix 表缺少傳奇特效 ' + id));
  const statusCsv = fs.readFileSync(path.join(root, 'config/CSV/Status.csv'), 'utf8');
  ['sgPetrify', 'sgStiffen'].forEach((id) => assert.ok(statusCsv.includes(id), 'Status 表缺少狀態 ' + id));
});

test('圈距跟著火狩體積一起放大：靜態的【增焰】與隨時間長大的【烈陽星環】都算', () => {
  /* 使用者決策 2026-08-26：體積 +30% 圈距就 +30%。圈距不動的話，
     火狩一變大兩圈就會疊在一起。 */
  function danceField(keys) {
    const c = loadContext();
    stubHits(c); stubVfx(c);
    if (keys.length) setLegendary(c, keys);
    /* 第 7 階【狩神之舞】＝兩道環，才有「圈距」可言。
       各階是循序解鎖的（sgEffectiveLevels 會把前面沒學的後階夾成 0），
       所以要每一階都給 1，不能只點第 1 與第 7 階。 */
    setLevels(c, 'firehunt', [1, 1, 1, 1, 1, 1, 1]);
    c.castSkill2(playerEnt(), [enemy(1e9, 60, 0)], 'firehunt', 'mv-float');
    return { c, f: c.SKILL2_RT.orbits[0] };
  }
  const base = danceField([]);
  const amp = danceField(['firehuntAmplify']);
  const gapOf = (f) => f.rings[1].r - f.rings[0].r;
  assert.equal(base.f.rings.length, 2, '狩神之舞應有兩道環');
  assert.equal(Math.round(amp.f.ringGapPx / base.f.ringGapPx * 100), 125,
    '【增焰】＋25% 體積 → 圈距也 +25%');
  assert.equal(Math.round(gapOf(amp.f) / gapOf(base.f) * 100), 125, '實際的兩圈距離同步拉開');

  /* 【烈陽星環】的體積是隨時間長大的，圈距要跟著逐幀拉開（不是只在施放當下算一次）。 */
  const c2 = loadContext();
  stubHits(c2); stubVfx(c2);
  maxLevels(c2, 'firehunt');
  setUlt(c2, 'firehunt', 'solarRing', 1);
  equip(c2, 'firehunt');
  const p2 = playerEnt();
  const m2 = enemy(1e9, 60, 0);
  c2.castSkill2(p2, [m2], 'firehunt', 'mv-float');
  const f2 = c2.SKILL2_RT.orbits[0];
  const gap0 = f2.rings[1].r - f2.rings[0].r;
  advance(c2, p2, [m2], 5);                       // 走完 4 秒的成長期
  const gapEnd = f2.rings[1].r - f2.rings[0].r;
  assert.equal(Math.round(f2.bodyR / f2.bodyR0 * 100), 160, '體積長到 1.6 倍');
  assert.equal(Math.round(gapEnd / gap0 * 100), 160, '圈距也跟著長到 1.6 倍');
  // 最內圈不動：拉開的是「圈與圈的間距」，不是整體外擴
  assert.equal(Math.round(f2.rings[0].r), Math.round(f2.ringR0[0]));
  // 環繞體的判定半徑要跟著新的圈半徑走，否則畫面與傷害範圍會對不上
  const outer = f2.orbs.filter((o) => o.ringIdx === 1);
  assert.ok(outer.length > 0);
  assert.equal(Math.round(outer[0].radius), Math.round(f2.rings[1].r));
});

test('環形特效事件送的是出生半徑，成長交給 rGrowTo／rGrowSec（否則會多畫一圈）', () => {
  const c = loadContext();
  stubHits(c);
  const specs = stubVfx(c);
  maxLevels(c, 'firehunt');
  setUlt(c, 'firehunt', 'solarRing', 1);
  equip(c, 'firehunt');
  c.castSkill2(playerEnt(), [enemy(1e9, 60, 0)], 'firehunt', 'mv-float');
  const f = c.SKILL2_RT.orbits[0];
  const auras = specs.filter((s) => s.fxKind === 'aura' && s.area && isFinite(s.area.r));
  assert.equal(auras.length, f.rings.length, '一道環一則事件');
  // 內圈不成長、外圈成長到與模擬層相同的倍率
  assert.equal(auras[0].area.rGrowTo, 1, '最內圈不成長');
  const outerFinal = f.ringR0[0] + f.ringGapPx * f.bodyGrowTo * 1;
  assert.equal(Math.round(auras[1].area.r), Math.round(f.ringR0[1]), '送的是出生半徑');
  assert.equal(Math.round(auras[1].area.r * auras[1].area.rGrowTo), Math.round(outerFinal),
    'r × rGrowTo 要等於模擬層長滿後的半徑');
  assert.equal(auras[1].area.rGrowSec, f.bodyGrowSec);
});

test('【火神降臨】的領域走玩家錨定變體，星環走旋轉圓環變體（不是泥沼池與小火球）', () => {
  const c = loadContext();
  stubHits(c);
  const specs = stubVfx(c);
  maxLevels(c, 'firehunt');
  setUlt(c, 'firehunt', 'fireGodDescend', 1);
  equip(c, 'firehunt');
  const p = playerEnt();
  const m = enemy(1e9, 30, 0);
  advance(c, p, [m], 0.6);
  const aura = specs.filter((s) => s.fxKind === 'aura' && s.variant === 'follow-aura');
  assert.ok(aura.length > 0, '領域要送 follow-aura');
  assert.ok(aura[0].area && aura[0].area.id === 'sg-firegod-aura', '帶穩定 id 才會重用同一個節點');
  assert.equal(aura[0].area.x, undefined, '不送座標＝位置由顯示層逐幀取玩家錨點');
  assert.equal(specs.filter((s) => s.variant === 'mire-lava').length, 0, '不再沿用泥沼池畫法');

  specs.length = 0;
  c.chance = () => false;
  c.skills2OnBasicAttack(p, m, 'mv-float', c.BASE_STATS);
  const rings = specs.filter((s) => s.fxKind === 'projectile' && s.variant === 'firehunt-ring');
  assert.equal(rings.length, 3, '三顆星環各一則投射物事件');
  assert.equal(specs.filter((s) => s.variant === 'fireball-small').length, 0, '不再畫成小火球');
});

test('岩甲領域：施放當下作用一次，之後**進入**範圍的敵人也立即受作用', () => {
  /* 使用者決策 2026-08-26：兩個超神進化不是施放瞬間打一次就結束，
     而是在岩甲護盾存在期間持續成立的領域。 */
  function fieldRun(ultId, statusKey) {
    const c = loadContext();
    stubHits(c); stubVfx(c);
    maxLevels(c, 'rockarmor');
    setUlt(c, 'rockarmor', ultId, 1);
    equip(c, 'rockarmor');
    const p = playerEnt();
    const near = enemy(1e9, 60, 0);      // 施放當下就在 24 米內
    const far = enemy(1e9, 900, 0);      // 遠在範圍外
    c.castSkill2(p, [near, far], 'rockarmor', 'mv-float');
    assert.ok(c.buffVal(near, statusKey) > 0, '施放當下範圍內的敵人受作用');
    assert.equal(c.buffVal(far, statusKey), 0, '範圍外不受影響');

    // 讓第一次的效果自然結束，確認「站著沒動」不會被無限重塗
    advance(c, p, [near, far], 6);
    assert.equal(c.buffVal(near, statusKey), 0, '待在裡面不動的敵人不會被永久重塗');

    // 遠處那隻走進範圍 → 下一拍就要受作用
    far.pos.x = 60;
    advance(c, p, [near, far], 0.2);
    assert.ok(c.buffVal(far, statusKey) > 0, '之後進入範圍的敵人立即受作用');
    return { c, p, near, far };
  }
  fieldRun('superRockArt', 'sgPetrify');
  fieldRun('gravityField', 'sgStiffen');
});

test('岩甲領域：岩甲護盾結束後領域就不再作用', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  maxLevels(c, 'rockarmor');
  setUlt(c, 'rockarmor', 'gravityField', 1);
  equip(c, 'rockarmor');
  const p = playerEnt();
  const far = enemy(1e9, 900, 0);
  c.castSkill2(p, [far], 'rockarmor', 'mv-float');
  // 岩甲到期
  c.GT = 999;
  c.tickSkill2(0.1, tickCtx(c, p, [far]));
  assert.equal(c.SKILL2_RT.rock, null, '岩甲已回收');
  // 之後才走進來的敵人不該受作用
  far.pos.x = 60;
  advance(c, p, [far], 0.5);
  assert.equal(c.buffVal(far, 'sgStiffen'), 0, '領域結束後不再作用');
});

test('五個新掛點都接上了戰鬥主流程（不是只寫了函式沒人呼叫）', () => {
  /* 這五條是「函式寫好了但沒人呼叫」最容易發生的地方——它們各自在別的檔裡，
     單檔測試看不出來。比照 tests/legendary-affix.test.cjs 的執行期路由檢查。 */
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  const battlefield = fs.readFileSync(path.join(root, 'js/battlefield.js'), 'utf8');
  const legendary = fs.readFileSync(path.join(root, 'js/legendary.js'), 'utf8');
  const skills2 = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');

  // ① 火神降臨的普攻星環：掛在 doPlayerAttack 的 depth 0 段（追加攻擊不重複觸發）
  assert.match(combat, /if \(!depth\) \{[\s\S]*skills2OnBasicAttack\(pEnt, mEnt, floatSel, st\)/);
  // ② 僵化的傷害下降：掛在敵人攻擊組態的攻擊力那一格
  assert.match(combat, /skill2EnemyDamageFactor === 'function'\) \? skill2EnemyDamageFactor\(m\)/);
  // ③ 金剛不壞的生命上限：掛在 formula.js 的 st.hp 派生點
  assert.match(formula, /skill2RockMaxHpFactor === 'function'\) \? skill2RockMaxHpFactor\(\)/);
  // ④ 輕飛甲的移速：掛在我方移動的兩個推進點（空場推進與追擊）
  assert.match(battlefield, /function bfPlayerSpeedFactor\(pEnt\)/);
  assert.equal((battlefield.match(/bfPlayerSpeed\(\) \* bfPlayerSpeedFactor\(pEnt\)/g) || []).length, 2,
    '我方移動有兩個推進點（空場與追擊），兩個都要吃乘區');
  // ⑤ 超重力場的土系增傷：掛在屬性傷害提升的唯一收斂點
  assert.match(legendary, /skill2RockEarthDamageUpPct === 'function'/);
  // 石化的單屬性受傷增幅：與寒冰逆轉同一條路（skill2VulnACfg）
  assert.match(skills2, /if \(typeof skill2PetrifyACfg === 'function'\) aCfg = skill2PetrifyACfg\(aCfg, target\);/);
  // 三個新節拍要真的排進 tickSkill2，否則整組傳奇、火神降臨與岩甲領域都不會動
  assert.match(skills2, /sgTickFirehuntLegend\(ctx, dt\);\s*[\r\n]+\s*sgTickFireGod\(ctx, dt\);\s*[\r\n]+\s*sgTickRockField\(ctx, dt\);/);

  /* 兩個新變體在兩套顯示層都要有專屬畫法——變體不被認得時只會**安靜地**退回泛用畫法，
     那正是「看起來沒壞、但要的效果根本沒出現」的失敗模式。 */
  const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  const vfx = fs.readFileSync(path.join(root, 'js/vfx.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(renderer, /spec\.variant === 'follow-aura'\) \{ spawnFollowAura\(spec\); break; \}/);
  assert.match(renderer, /function spawnFollowAura\(spec\)/);
  assert.match(renderer, /node\.x = p\.x; node\.y = p\.y - 12;\s*\/\/ 與環繞場域同一個視覺中心/,
    '領域要逐幀取玩家錨點才會平滑跟隨');
  assert.match(renderer, /spec\.variant === 'firehunt-ring'\) \{\s*[\r\n]+\s*core = fireHuntRingProjectile\(theme\);/);
  assert.match(renderer, /core\._ringUpdate\(dt\)/, '圓環的翻轉要每一幀推進');
  assert.match(vfx, /v === 'firehunt-ring'/);
  assert.match(vfx, /s\.variant === 'follow-aura'/);
  assert.match(css, /\.vfx-proj-firehunt-ring[\s\S]*?vfx-firehunt-ring-spin/);
  // 環半徑成長：模擬層與顯示層必須讀同一組語意參數
  assert.match(skills2, /rGrowTo: rGrowTo, rGrowSec: f\.bodyGrowSec/);
  assert.match(renderer, /var rGrowTo = Math\.max\(1, Number\(a\.rGrowTo\) \|\| 1\);/);
});

test('十個新傳奇特效：各自只出現在指定武器類型，且關聯到對應的技能群組', () => {
  const c = loadContext();
  const EXPECT = {
    firehuntAmplify: ['增焰', 'orb', 'firehunt'],
    firehuntConcurrent: ['伴生併發', 'orb', 'firehunt'],
    firehuntBlaze: ['烈火狩', 'orb', 'firehunt'],
    firehuntDetonate: ['炎爆', 'orb', 'firehunt'],
    firehuntHunter: ['狩獵者', 'orb', 'firehunt'],
    rockHeavyArmor: ['重岩甲', 'focus', 'rockarmor'],
    rockLightArmor: ['輕飛甲', 'focus', 'rockarmor'],
    rockAmpBoost: ['巨岩增幅', 'focus', 'rockarmor'],
    rockSpikeArmor: ['尖刺甲', 'focus', 'rockarmor'],
    rockEarthHeart: ['大地之心', 'focus', 'rockarmor']
  };
  Object.keys(EXPECT).forEach((key) => {
    const def = c.PASSIVE_POOL[key];
    const [name, weapon, gid] = EXPECT[key];
    assert.ok(def, key + ' 不在傳奇特效池');
    assert.equal(def.name, name);
    assert.equal(def.legendary, true);
    assert.equal(def.relatedSkill, gid);
    assert.deepEqual(Array.from(def.weaponTypes || []), [weapon]);
    assert.ok(def.desc && def.desc.length > 0, key + ' 缺說明');
    assert.ok(def.fx && Object.keys(def.fx).length > 0, key + ' 缺效果參數');
  });
  // 傳奇橋：只合併「同群組且已生效」的 fx
  setLegendary(c, ['firehuntAmplify', 'rockHeavyArmor']);
  assert.equal(c.legendarySkill2Mods('firehunt').firehuntScalePct, 25);
  assert.equal(c.legendarySkill2Mods('rockarmor').rockShieldPct, 30);
  assert.equal(c.legendarySkill2Mods('firehunt').rockShieldPct, undefined, '不跨群組');
});
