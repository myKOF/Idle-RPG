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

test('【伴生併發】：火狩在場時每 1 秒飛出一團，打目標與其周圍', () => {
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
  calls.length = 0;
  advance(c, p, [m], 0.5);
  assert.equal(launched(calls), 0, '不到 1 秒不飛出');
  advance(c, p, [m], 0.7);
  assert.equal(launched(calls), 1, '滿 1 秒飛出一團');

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

  // 普攻附加：3 顆星環（Lv.1 ＝ 3 ＋ 每級 0.3 → 3.3，小數以機率補）
  calls.length = 0;
  c.chance = () => false;             // 不補那 0.3 顆
  const out = c.skills2OnBasicAttack(p, near, 'mv-float', c.BASE_STATS);
  assert.ok(out, '應回傳結算結果');
  assert.equal(calls.length, 3, '固定 3 顆');

  // 沒選這個超神進化就完全不作用
  const c2 = loadContext();
  const calls2 = stubHits(c2); stubVfx(c2);
  maxLevels(c2, 'firehunt');
  equip(c2, 'firehunt');
  const p2 = playerEnt();
  advance(c2, p2, [enemy(1e9, 30, 0)], 1);
  assert.equal(calls2.length, 0);
  assert.equal(c2.skills2OnBasicAttack(p2, enemy(1e9, 30, 0), 'mv-float', c2.BASE_STATS), null);
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

  // 岩甲到期：生命上限倍率跟著收回去
  c.GT = 999;
  c.tickSkill2(0.1, tickCtx(c, p, [m]));
  assert.equal(c.skill2RockMaxHpFactor(), 1);
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
  // 兩個新節拍要真的排進 tickSkill2，否則整組傳奇與火神降臨都不會動
  assert.match(skills2, /sgTickFirehuntLegend\(ctx, dt\);\s*[\r\n]+\s*sgTickFireGod\(ctx, dt\);/);
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
