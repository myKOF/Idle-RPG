/* 傳奇進化第七批（2026-08-25）：泥沼術（魔劍）／大地守護（盾牌）
   設計來源：神力之巔_記事錄試算表〈傳奇進化〉頁籤的泥沼術、大地守護兩段。
   守住的事：
     1. 泥沼術五個傳奇：蔓延（範圍）、削弱（敵人傷害）、腐化（控場中的敵人易傷）、
        熔火（熔岩每跳量）、侵蝕（流血）
     2. 泥沼術三個超神：惡疫魔沼（惡疫 DoT ＋ 毒屬性持續傷害放大）、
        深淵火獄（熔岩沼定期噴火龍捲 ＋ 屬性改寫）、黃泉沼（低血斬殺，機率累加）
     3. 大地守護五個傳奇：魔力滋養（溢出法力轉護盾）、生命滋養（溢出生命轉法力）、
        靈魂連結（反射多打一個）、地之心（擊殺縮短復活冷卻）、不滅意志（擊殺延長無敵）
     4. 大地守護三個超神：光耀之堂（回復倍率＋溢出轉護盾）、天地再造（敵人重生）、
        逆轉乾坤（復活次數可累積）

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
    hpRegen: 0, mpRegen: 0, lifesteal: 0, manaSteal: 0,
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
  return { hp: 1000, mp: 500, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
function stubVfx(c) {
  const specs = [];
  c.playCombatVfx = (spec) => specs.push(spec);
  c.enemyEventFloatTarget = (ent) => ent.name;
  c.playerEventFloatTarget = (sel) => sel;
  c.floatEnemyEvent = () => {};
  c.floatPlayerEvent = () => {};
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
function advance(c, p, enemies, seconds) {
  const step = 0.1;
  for (let t = 0; t < Math.round(seconds / step); t++) {
    c.GT = +(c.GT + step).toFixed(4);
    c.tickSkill2(step, tickCtx(c, p, enemies));
  }
}
function dotOf(ent, sid) {
  return (ent.dots || []).filter((d) => d.sid === sid)[0] || null;
}

/* ===========================================================================
   1) 泥沼術的五個傳奇特效
   =========================================================================== */

test('【蔓延】：沼澤的出生尺寸 +25%（不是併進「隨時間長大」的目標倍率）', () => {
  function field(keys) {
    const c = loadContext();
    stubVfx(c);
    setLegendary(c, keys);
    setLevels(c, 'mire', [1, 0, 0, 0, 0, 0, 0]);
    c.castSkill2(playerEnt(), [enemy(1e9, 60, 0)], 'mire', 'mv-float');
    return c.SKILL2_RT.grounds[0];
  }
  const base = field([]);
  const wide = field(['mireSpread']);
  assert.ok(base && wide, '兩邊都要建立地板場域');
  assert.equal(Math.round(wide.baseLength / base.baseLength * 100), 125, '長 +25%');
  assert.equal(Math.round(wide.baseWidth / base.baseWidth * 100), 125, '寬 +25%');
  assert.equal(wide.growTo, base.growTo, '成長倍率不受影響（那是第 5／7 階的東西）');
});

test('【削弱】：泥沼中的敵人造成的傷害降低，並與【僵化】相乘', () => {
  const c = loadContext();
  setLegendary(c, ['mireWeaken']);
  setLevels(c, 'mire', [1, 0, 0, 0, 0, 0, 0]);
  const e = enemy(1000, 30, 0);
  assert.equal(c.skill2EnemyDamageFactor(e), 1, '沒中泥沼＝不影響');
  c.applyStatus(e, 'sgMire', { val: 50, dur: 5 });
  assert.equal(Math.round(c.skill2EnemyDamageFactor(e) * 100), 70, '泥沼中＝ -30%');
  c.applyStatus(e, 'sgStiffen', { val: 50, dur: 5 });
  assert.equal(Math.round(c.skill2EnemyDamageFactor(e) * 100), 35, '與僵化相乘（0.7 × 0.5）');
});

test('【腐化】：只有「泥沼中且正在被控場」的敵人才多吃易傷', () => {
  const c = loadContext();
  setLegendary(c, ['mireCorrupt']);
  setLevels(c, 'mire', [1, 0, 0, 0, 0, 0, 0]);   // 不投資【虛弱】，才看得出是腐化給的
  const e = enemy(1000, 30, 0);
  c.applyStatus(e, 'sgMire', { val: 50, dur: 5 });
  assert.equal(c.skill2MireVulnPct(e), 0, '沒被控場＝沒有加成');
  c.applyEffect(e, 'stun', 2);
  assert.equal(c.skill2MireVulnPct(e), 30, '暈眩中＝ +30%');
  const outside = enemy(1000, 30, 0);
  c.applyEffect(outside, 'stun', 2);
  assert.equal(c.skill2MireVulnPct(outside), 0, '沒在泥沼裡就不算數');
});

test('【熔火】：熔岩沼的每跳傷害提高，其餘狀態不受影響', () => {
  function spec(keys) {
    const c = loadContext();
    setLegendary(c, keys);
    maxLevels(c, 'mire');
    return c.sgMireSpec(c.SKILLS2.mire, c.skills2Levels('mire'), c.getStats());
  }
  const base = spec([]);
  const hot = spec(['mireLavaBurn']);
  assert.ok(base.lavaDps > 0, '練滿即有熔岩沼');
  assert.equal(Math.round(hot.lavaDps / base.lavaDps * 100), 170, '熔岩每跳量 +70%');
  assert.equal(hot.poisonDps, base.poisonDps, '毒沼不受影響');
});

test('【侵蝕】：沼澤每一拍給流血，且流血用自己的持續時間（離開沼澤後仍走完）', () => {
  const c = loadContext();
  stubVfx(c);
  setLegendary(c, ['mireErode']);
  setLevels(c, 'mire', [1, 0, 0, 0, 0, 0, 0]);
  const p = playerEnt();
  const e = enemy(1e9, 20, 0);
  c.castSkill2(p, [e], 'mire', 'mv-float');
  advance(c, p, [e], 1);
  const bleed = dotOf(e, 'sgMireBleed');
  assert.ok(bleed, '應塗上泥沼裂傷');
  assert.equal(bleed.interval, 0.5, '每 0.5 秒一跳');
  assert.ok(bleed.until - c.GT > 4, '持續時間走自己的 5 秒，不是沼澤節拍的兩跳');
  // 每跳 150% 物攻 → dps = atk × 1.5 ÷ 0.5
  assert.equal(Math.round(bleed.dps), Math.round(c.getStats().atk * 1.5 / 0.5));
});

/* ===========================================================================
   2) 泥沼術的三個超神進化
   =========================================================================== */

test('【惡疫魔沼】：塗上惡疫，且該敵人受到的毒屬性持續傷害被放大', () => {
  const c = loadContext();
  stubVfx(c);
  maxLevels(c, 'mire');
  equip(c, 'mire');
  setUlt(c, 'mire', 'plagueMire', 1);
  const p = playerEnt();
  const e = enemy(1e9, 20, 0);
  c.castSkill2(p, [e], 'mire', 'mv-float');
  advance(c, p, [e], 1);
  const plague = dotOf(e, 'sgPlague');
  assert.ok(plague, '應塗上惡疫');
  assert.equal(plague.interval, 0.35, '每 0.35 秒一跳');
  assert.ok(plague.until - c.GT > 7, '離開沼澤後仍會存在 8 秒');
  // 毒屬性的持續傷害被放大；非毒屬性（熔岩＝火）不受影響
  const amp = c.skill2DotElemFactor(e, 'sgMirePoison');
  assert.ok(amp > 1, '毒屬性持續傷害要被放大');
  assert.equal(c.skill2DotElemFactor(e, 'sgMireLava'), 1, '火屬性持續傷害不受影響');
  const clean = enemy(1e9, 20, 0);
  assert.equal(c.skill2DotElemFactor(clean, 'sgMirePoison'), 1, '沒中惡疫就沒有放大');
});

test('【深淵火獄】：熔岩沼定期噴出火龍捲並把敵人屬性改寫為火', () => {
  const c = loadContext();
  stubVfx(c);
  maxLevels(c, 'mire');
  equip(c, 'mire');
  setUlt(c, 'mire', 'abyssInferno', 1);
  const p = playerEnt();
  const e = enemy(1e9, 20, 0);
  c.castSkill2(p, [e], 'mire', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.filter((f) => f.kind === 'lavapillar').length, 0, '出生當下先等一個節拍');
  advance(c, p, [e], 2.5);
  const pillars = c.SKILL2_RT.grounds.filter((f) => f.kind === 'lavapillar');
  assert.ok(pillars.length >= 1, '應噴出火龍捲');
  assert.equal(pillars[0].gid, 'mire', '傷害掛在泥沼術名下');
  assert.equal(pillars[0].hitElem, 'fire', '火屬性');
  assert.equal(pillars[0].hits, 8, '八段');
  assert.equal(c.skill2ForcedAttr(e), 'fire', '被噴到的敵人屬性標籤改為火');
});

test('【深淵火獄】沒練到熔岩沼就不生效（設計文字是「熔岩沼每 N 秒…」）', () => {
  const c = loadContext();
  stubVfx(c);
  setLevels(c, 'mire', [10, 10, 10, 10, 10, 10, 0]);   // 差第 7 階熔岩沼
  equip(c, 'mire');
  setUlt(c, 'mire', 'abyssInferno', 1);
  const p = playerEnt();
  const e = enemy(1e9, 20, 0);
  c.castSkill2(p, [e], 'mire', 'mv-float');
  advance(c, p, [e], 3);
  assert.equal(c.SKILL2_RT.grounds.filter((f) => f.kind === 'lavapillar').length, 0);
});

test('【黃泉沼】：低血且在沼澤中的敵人每次受傷累加斬殺機率，BOSS 不吃', () => {
  const c = loadContext();
  stubVfx(c);
  maxLevels(c, 'mire');
  equip(c, 'mire');
  setUlt(c, 'mire', 'netherMire', 1);
  c.Math.random = () => 0.999;                       // 先讓擲骰一定不中
  const e = enemy(1000, 20, 0);
  e.hp = 100;                                        // 10% ≦ 門檻 30%
  c.applyStatus(e, 'sgMire', { val: 50, dur: 5 });
  c.skills2OnEnemyDamaged(e, 10);
  c.skills2OnEnemyDamaged(e, 10);
  assert.equal(e._sgNetherStacks, 2, '每次受傷疊一層');
  assert.ok(!e._sgNetherKill, '沒中就不立旗標');

  c.Math.random = () => 0;                           // 必中
  c.skills2OnEnemyDamaged(e, 10);
  assert.equal(e._sgNetherKill, true, '中了只立旗標，當下不扣血');
  assert.equal(e.hp, 100, '斬殺不在受傷掛點裡結算（避免遞迴）');

  const p = playerEnt();
  c.tickSkill2(0.1, tickCtx(c, p, [e]));
  assert.equal(e.hp, 0, '斬殺在 tickSkill2 結算');

  const boss = enemy(1000, 20, 0, 'BOSS', 'boss');
  boss.hp = 100;
  c.applyStatus(boss, 'sgMire', { val: 50, dur: 5 });
  c.skills2OnEnemyDamaged(boss, 10);
  assert.ok(!boss._sgNetherKill, 'BOSS 不吃斬殺');

  const healthy = enemy(1000, 20, 0);
  c.applyStatus(healthy, 'sgMire', { val: 50, dur: 5 });
  c.skills2OnEnemyDamaged(healthy, 10);
  assert.ok(!healthy._sgNetherKill, '血量高於門檻不吃斬殺');
});

/* ===========================================================================
   3) 大地守護的五個傳奇特效
   =========================================================================== */

function earthguardCtx(keys, ultId, ultLv) {
  const c = loadContext();
  stubVfx(c);
  maxLevels(c, 'earthguard');
  equip(c, 'earthguard');
  setLegendary(c, keys);
  if (ultId) setUlt(c, 'earthguard', ultId, ultLv);
  return c;
}

test('【魔力滋養】：溢出的法力轉為生命護盾', () => {
  const c = earthguardCtx(['earthguardManaFeed']);
  const p = playerEnt();
  p.mp = c.getStats().mp;                    // 已經滿魔＝之後的入帳全部溢出
  c.gainPlayerMana(p, 200, c.getStats());
  assert.equal(p.mp, c.getStats().mp, '法力仍夾在上限');
  assert.ok(p.shield > 0, '溢出的法力轉成護盾');
});

test('【生命滋養】：溢出的生命轉為法力（而且不會再倒灌回護盾）', () => {
  const c = earthguardCtx(['earthguardLifeFeed']);
  const p = playerEnt();
  p.hp = c.getStats().hp;                    // 滿血
  p.mp = 0;
  c.healPlayer(p, 500, c.getStats(), { noShield: true });
  assert.equal(p.hp, c.getStats().hp, '生命仍夾在上限');
  assert.equal(Math.round(p.mp), 50, '溢出 500 的 10% → 50 法力');
  assert.equal(p.shield, 0, '沒有【魔力滋養】就不該憑空長出護盾');
});

test('【靈魂連結】：生命反射之盾多打一個敵人', () => {
  function victims(keys) {
    const c = earthguardCtx(keys);
    const fx = c.SKILLS2.earthguard.tiers[5].fx;
    const pool = [enemy(1000, 10, 0, 'A'), enemy(1000, 20, 0, 'B'), enemy(1000, 30, 0, 'C')];
    return c.sgEarthguardReflectTargets(null, pool, fx).length;
  }
  assert.equal(victims([]), 1);
  assert.equal(victims(['earthguardSoulLink']), 2);
});

test('【地之心】：每擊殺 1 個敵人縮短【天地共生】的復活冷卻', () => {
  const c = earthguardCtx(['earthguardHeartOfEarth']);
  const p = playerEnt();
  p.skillCds[c.SG_PREFIX + 'earthguard'] = 30;
  c.skills2OnEnemyKill(p, enemy(100, 10, 0));
  assert.equal(p.skillCds[c.SG_PREFIX + 'earthguard'], 29);
});

test('【不滅意志】：只延長【天地共生】給的那段無敵', () => {
  const c = earthguardCtx(['earthguardUndyingWill']);
  const p = playerEnt();
  // 其他來源的無敵不該被延長
  p.effects.invuln = c.GT + 3;
  c.skills2OnEnemyKill(p, enemy(100, 10, 0));
  assert.equal(p.effects.invuln, c.GT + 3, '非天地共生的無敵不受影響');
  // 天地共生的那一段才算
  c.skills2TryRebirth(p);
  const before = p.effects.invuln;
  c.skills2OnEnemyKill(p, enemy(100, 10, 0));
  assert.equal(Math.round((p.effects.invuln - before) * 10), 5, '每擊殺 +0.5 秒');
});

/* ===========================================================================
   4) 大地守護的三個超神進化
   =========================================================================== */

test('【光耀之堂】：回復倍率再乘一層，且溢出的生命與法力都轉成護盾', () => {
  const plain = earthguardCtx([]);
  const shine = earthguardCtx([], 'hallOfRadiance', 1);
  assert.ok(shine.skill2RegenFactor('hp') > plain.skill2RegenFactor('hp'), '生命回復再放大');
  assert.ok(shine.skill2RegenFactor('mp') > plain.skill2RegenFactor('mp'), '法力回復再放大');
  assert.equal(shine.skill2DrainFactor('hp'), plain.skill2DrainFactor('hp'), '吸血不受影響（設計文字只寫回復）');

  const p = playerEnt();
  p.hp = shine.getStats().hp;
  shine.healPlayer(p, 100, shine.getStats(), { noShield: true });
  assert.ok(p.shield > 0, '溢出的生命轉護盾');
  const afterHp = p.shield;
  p.mp = shine.getStats().mp;
  shine.gainPlayerMana(p, 100, shine.getStats());
  assert.ok(p.shield > afterHp, '溢出的法力也轉護盾');
});

test('【天地再造】：普通／菁英敵人機率重生，同一隻只會重生一次，BOSS 不重生', () => {
  const c = earthguardCtx([], 'worldRebirth', 1);
  c.Math.random = () => 0;                       // 必中
  const p = playerEnt();
  const e = enemy(1000, 10, 0);
  e.hp = 0;
  assert.equal(c.skills2OnEnemyKill(p, e), true, '應重生');
  assert.ok(e.hp > 0 && e.hp < e.maxHp, '以部分生命重生');
  assert.equal(e._sgReborn, true);
  e.hp = 0;
  assert.equal(c.skills2OnEnemyKill(p, e), false, '同一隻只重生一次');

  const boss = enemy(1000, 10, 0, 'BOSS', 'boss');
  boss.hp = 0;
  assert.equal(c.skills2OnEnemyKill(p, boss), false, 'BOSS 不重生');
});

test('【逆轉乾坤】：冷卻結束後累積復活次數，用完才真的進冷卻', () => {
  const c = earthguardCtx([], 'fateReversal', 1);
  assert.equal(c.skills2RebirthMaxCharges(), 2, 'Lv.1 ＝ 2 次');
  const p = playerEnt();
  // 進場即滿：可用次數＝（冷卻已結束 1）＋（累積 1）
  c.sgTickRebirthCharge(p);
  assert.equal(c.SKILL2_RT.rebirth.charges, 1);
  assert.equal(c.skills2TryRebirth(p), true, '第一次：花掉「冷卻已結束」的那一次');
  assert.ok(p.skillCds[c.SG_PREFIX + 'earthguard'] > 0, '冷卻開始跑');
  assert.equal(c.SKILL2_RT.rebirth.charges, 1, '累積的那一次還在');
  assert.equal(c.skills2TryRebirth(p), true, '第二次：花掉累積的那一次');
  assert.equal(c.SKILL2_RT.rebirth.charges, 0);
  assert.equal(c.skills2TryRebirth(p), false, '用完就要等冷卻');
});

test('沒選【逆轉乾坤】時，【天地共生】維持「冷卻好了才有一次」的原行為', () => {
  const c = earthguardCtx([]);
  const p = playerEnt();
  c.sgTickRebirthCharge(p);
  assert.equal(c.SKILL2_RT.rebirth, null, '不建立累積狀態＝零成本');
  assert.equal(c.skills2TryRebirth(p), true);
  assert.equal(c.skills2TryRebirth(p), false, '冷卻中不能再復活');
});

/* ===========================================================================
   5) 參數表落表（撥離管線的唯一來源）
   =========================================================================== */

test('參數表往返：Skills2 的六個超神進化列與 Equipment_Affix 的十個新特效都落表', () => {
  const skills2Csv = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8');
  ['plagueMire', 'abyssInferno', 'netherMire', 'hallOfRadiance', 'worldRebirth', 'fateReversal']
    .forEach((id) => assert.ok(skills2Csv.indexOf(id) >= 0, 'Skills2.csv 應有 ' + id));
  const affixCsv = fs.readFileSync(path.join(root, 'config/CSV/Equipment_Affix.csv'), 'utf8');
  ['mireSpread', 'mireWeaken', 'mireCorrupt', 'mireLavaBurn', 'mireErode',
    'earthguardManaFeed', 'earthguardLifeFeed', 'earthguardSoulLink',
    'earthguardHeartOfEarth', 'earthguardUndyingWill']
    .forEach((id) => assert.ok(affixCsv.indexOf(id) >= 0, 'Equipment_Affix.csv 應有 ' + id));
  const statusCsv = fs.readFileSync(path.join(root, 'config/CSV/Status.csv'), 'utf8');
  ['sgMireBleed', 'sgPlague', 'sgInferno']
    .forEach((sid) => assert.ok(statusCsv.indexOf(sid) >= 0, 'Status.csv 應有 ' + sid));
});

test('十個新特效的武器限定：泥沼術＝魔劍、大地守護＝盾牌', () => {
  const c = loadContext();
  const mire = ['mireSpread', 'mireWeaken', 'mireCorrupt', 'mireLavaBurn', 'mireErode'];
  const guard = ['earthguardManaFeed', 'earthguardLifeFeed', 'earthguardSoulLink',
    'earthguardHeartOfEarth', 'earthguardUndyingWill'];
  mire.forEach((k) => {
    const def = c.PASSIVE_POOL[k];
    assert.ok(def, k);
    assert.equal(def.legendary, true);
    assert.equal(def.relatedSkill, 'mire');
    assert.deepEqual(Array.from(def.weaponTypes || []), ['magicSword1h']);
  });
  guard.forEach((k) => {
    const def = c.PASSIVE_POOL[k];
    assert.ok(def, k);
    assert.equal(def.legendary, true);
    assert.equal(def.relatedSkill, 'earthguard');
    assert.deepEqual(Array.from(def.weaponTypes || []), ['shield']);
  });
});
