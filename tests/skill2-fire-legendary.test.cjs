/* 傳奇進化第五批（2026-08-24）：火球術（魔杖）／火龍捲（雙手杖）
   設計來源：神力之巔_記事錄試算表〈傳奇進化〉頁籤的火球術、火龍捲兩段。
   守住的事：
     1. 火球術五個傳奇：連珠火（數量）、燃燼（燃燒傷害）、火池（爆點場域）、
        烈焰之心（對燃燒中增傷）、爆裂（小火球數量）
     2. 火球術三個超神：火殞天落（額外殞石＋體積＋傷害）、地爆天星（依敵種扣%最大生命、
        倒數狀態、落下前 5 秒黑影、體積 3 倍且下墜速度減半）、火鳳遼原（殞石＋1、伴生火球、傷害）
     3. 火龍捲五個傳奇：追蹤烈焰（移動）、火龍擴散（體積）、火焰爆衝（段數）、
        爆燃（燃燒受傷放大）、火龍共鳴（場上道數增傷）
     4. 火龍捲三個超神：烈焰暴風（數量倍率）、永劫火獄（游走＋軌跡火池）、
        火龍之吞噬（聚攏＋拉近＋段數）

   ⚠️ 本檔只驗「機制有沒有接上」，不驗「數字調校得對不對」（那是參數表的事）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
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
    'js/skills.js', 'js/skills2.js', 'js/legendary.js']
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
  context.trackDps = () => {};
  context.recordRunDamage = () => {};
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
    calls.push({ ent: defender, aCfg: aCfg, atk: aCfg.atk, total: aCfg.totalDmgPct });
    defender.hp = Math.max(0, defender.hp - 100);
    return { dmg: 100, crit: false, miss: false, blocked: false, killed: defender.hp <= 0 };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  return calls;
}
function stubDerived(c) {
  const hits = [];
  c.applyEnemyHpDamage = function (ent, amount) {
    hits.push({ ent: ent, amount: amount });
    ent.hp = Math.max(0, ent.hp - amount);
    return amount;
  };
  return hits;
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
/* 傳奇特效生效：st.legendaryEffects[key] 為真即視為裝著（legendaryHas 的判定）。
   legendaryEffectMults 留空＝不吃雙手補償，本檔只驗機制，補償倍率由 legendary-affix 守。 */
function setLegendary(c, keys) {
  const on = {};
  (keys || []).forEach((k) => { on[k] = true; });
  c.BASE_STATS = Object.assign({}, c.BASE_STATS, { legendaryEffects: on, legendaryEffectMults: {} });
}
/* 讓排到 GT 的殞石／飛行物全部結算（沿用 skill2-magic-fire 的做法）。 */
function settle(c, p, enemies, at) {
  c.GT = at === undefined ? 10 : at;
  c.tickSkill2(0, tickCtx(c, p, enemies));
}
function grounds(c, kind) {
  return c.SKILL2_RT.grounds.filter((f) => f.kind === kind);
}

/* ===========================================================================
   1) 火球術的五個傳奇特效
   =========================================================================== */

test('【連珠火】：火球與殞石的數量各 +1', () => {
  // 一般火球型態
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  setLevels(c, 'fireball', [1, 0, 0, 0, 0, 0, 0]);
  const p = playerEnt();
  const m = enemy(1e9, 100, 0);
  c.castSkill2(p, [m], 'fireball', 'mv-float');
  assert.equal(c.SKILL2_RT.projectiles.length, 1, '基準：一顆火球');

  const c2 = loadContext();
  stubHits(c2);
  c2.chance = () => false;
  setLegendary(c2, ['fireballBeadShot']);
  setLevels(c2, 'fireball', [1, 0, 0, 0, 0, 0, 0]);
  c2.castSkill2(playerEnt(), [enemy(1e9, 100, 0)], 'fireball', 'mv-float');
  assert.equal(c2.SKILL2_RT.projectiles.length, 2, '【連珠火】：火球 +1 顆');

  // 殞石型態
  const c3 = loadContext();
  stubHits(c3);
  c3.chance = () => false;
  setLegendary(c3, ['fireballBeadShot']);
  setLevels(c3, 'fireball', [1, 1, 1, 1, 1, 1, 1]);
  c3.castSkill2(playerEnt(), [enemy(1e9, 100, 0)], 'fireball', 'mv-float');
  assert.equal(c3.SKILL2_RT.meteors.length, 4, '【連珠火】：殞石 3 → 4 顆');
});

test('【燃燼】：火球術造成的燃燒每跳量 ×1.5', () => {
  function burnDps(keys) {
    const c = loadContext();
    stubHits(c);
    c.chance = () => false;
    setLegendary(c, keys);
    setLevels(c, 'fireball', [1, 1, 0, 0, 0, 0, 0]);
    const p = playerEnt();
    const m = enemy(1e9, 100, 0);
    c.castSkill2(p, [m], 'fireball', 'mv-float');
    settle(c, p, [m]);
    const dot = c.sgFindDot(m, 'sgBurn');
    assert.ok(dot, '火球命中後應有燃燒');
    return dot.dps;
  }
  const base = burnDps([]);
  const ember = burnDps(['fireballEmber']);
  assert.ok(base > 0);
  assert.equal(Math.round(ember / base * 100), 150, '【燃燼】：燃燒傷害 +50%');
});

test('【火池】：火球爆炸後在爆點留下一團火池場域', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  setLevels(c, 'fireball', [1, 0, 0, 0, 0, 0, 0]);
  const p = playerEnt();
  const m = enemy(1e9, 100, 0);
  c.castSkill2(p, [m], 'fireball', 'mv-float');
  settle(c, p, [m]);
  assert.equal(grounds(c, 'firepool').length, 0, '沒有這個特效就不留火池');

  const c2 = loadContext();
  stubHits(c2);
  c2.chance = () => false;
  setLegendary(c2, ['fireballPool']);
  setLevels(c2, 'fireball', [1, 0, 0, 0, 0, 0, 0]);
  const p2 = playerEnt();
  const m2 = enemy(1e9, 100, 0);
  c2.castSkill2(p2, [m2], 'fireball', 'mv-float');
  settle(c2, p2, [m2]);
  const pool = grounds(c2, 'firepool');
  assert.equal(pool.length, 1, '【火池】：爆炸後留下一團火池');
  assert.equal(pool[0].radius, c2.bfMeterPx(6), '半徑 6 米');
  assert.equal(pool[0].gap, 0.5, '每 0.5 秒作用一次');
  assert.equal(pool[0].hits, 8, '持續 4 秒 ÷ 0.5 秒 ＝ 8 段');
  assert.equal(pool[0].hitElem, 'fire');
  // 每段傷害＝火球本體的 50%（本體 Lv.1 ＝ 魔攻 500 × 165%）
  assert.equal(Math.round(pool[0].dmgVal), Math.round(500 * 1.65 * 0.5));
});

test('【烈焰之心】：對燃燒中的敵人增傷，未燃燒的不吃', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  setLegendary(c, ['fireballHeart']);
  setLevels(c, 'fireball', [1, 0, 0, 0, 0, 0, 0]);
  const p = playerEnt();
  const burning = enemy(1e9, 100, 0, '燃燒中');
  c.applyStatus(burning, 'sgBurn', { dps: 10, dur: 100, interval: 0.5 });
  c.castSkill2(p, [burning], 'fireball', 'mv-float');
  settle(c, p, [burning]);
  assert.ok(calls.length > 0);
  assert.equal(calls[0].total, 30, '燃燒中的敵人吃到 +30% 總傷');

  const c2 = loadContext();
  const calls2 = stubHits(c2);
  c2.chance = () => false;
  setLegendary(c2, ['fireballHeart']);
  setLevels(c2, 'fireball', [1, 0, 0, 0, 0, 0, 0]);
  const p2 = playerEnt();
  const cold = enemy(1e9, 100, 0, '沒燒');
  c2.castSkill2(p2, [cold], 'fireball', 'mv-float');
  settle(c2, p2, [cold]);
  assert.equal(calls2[0].total, 0, '沒有燃燒就沒有加成');
});

test('【爆裂】：火球爆裂的小火球數量 +3', () => {
  function splitHits(keys) {
    const c = loadContext();
    const calls = stubHits(c);
    c.chance = () => false;
    setLegendary(c, keys);
    // 階層循序解鎖：要驗第 3 階就必須連著點到第 3 階
    setLevels(c, 'fireball', [1, 1, 1, 0, 0, 0, 0]);
    const p = playerEnt();
    const main = enemy(1e9, 100, 0, '主目標');
    // 爆裂的挑選半徑 20 米、火球爆炸半徑 6 米：全部擺在 12 米處避免混入本體 AOE
    const others = [];
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      others.push(enemy(1e9, 100 + Math.cos(a) * 120, Math.sin(a) * 120, '旁' + i));
    }
    const enemies = [main].concat(others);
    c.castSkill2(p, enemies, 'fireball', 'mv-float');
    assert.equal(calls.length, 0, '飛行途中不得提前命中');
    settle(c, p, enemies, 10);   // 本體爆炸 → 這時才建立小火球
    settle(c, p, enemies, 20);   // 小火球飛完 → 才結算命中
    return calls.length - 1;     // 扣掉本體那一發
  }
  assert.equal(splitHits([]), 3, '基準：3 個小火球');
  assert.equal(splitHits(['fireballBurst']), 6, '【爆裂】：額外 +3 個小火球');
});

/* ===========================================================================
   2) 火球術的三個超神進化
   =========================================================================== */

test('【火殞天落】：額外連續落下 8 顆，且殞石體積與傷害同步提高', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'fireball');
  const p = playerEnt();
  const m = enemy(1e9, 100, 0);
  c.castSkill2(p, [m], 'fireball', 'mv-float');
  const baseCount = c.SKILL2_RT.meteors.length;
  const baseRadius = c.SKILL2_RT.meteors[0].radius;
  const baseDmg = c.SKILL2_RT.meteors[0].dmgVal;

  const c2 = loadContext();
  stubHits(c2);
  c2.chance = () => false;
  maxLevels(c2, 'fireball');
  setUlt(c2, 'fireball', 'meteorFall', 1);   // Lv.1：傷害 +55%、體積 +30%、額外 8 顆
  c2.castSkill2(playerEnt(), [enemy(1e9, 100, 0)], 'fireball', 'mv-float');

  assert.equal(baseCount, 3);
  assert.equal(c2.SKILL2_RT.meteors.length, 11, '3 顆 ＋ 額外 8 顆');
  assert.equal(Math.round(c2.SKILL2_RT.meteors[0].radius / baseRadius * 100), 130, '體積 +30%');
  assert.equal(Math.round(c2.SKILL2_RT.meteors[0].dmgVal / baseDmg * 100), 155, 'Lv.1 傷害 +55%');
});

test('【地爆天星】：每隔一段時間依敵種扣掉最大生命的固定比例', () => {
  const c = loadContext();
  stubHits(c);
  const derived = stubDerived(c);
  c.chance = () => false;
  maxLevels(c, 'fireball');
  equip(c, 'fireball');
  setUlt(c, 'fireball', 'starfallCataclysm', 1);   // Lv.1：間隔 57 秒
  const p = playerEnt();
  const normal = enemy(1000, 100, 0, '普通');
  const elite = enemy(1000, 140, 0, '菁英', 'elite');
  const boss = enemy(1000, 180, 0, 'BOSS', 'boss');
  const enemies = [normal, elite, boss];

  c.GT = 0;
  c.tickSkill2(0.1, tickCtx(c, p, enemies));
  assert.equal(derived.length, 0, '進場只起算節拍，不立刻砸');

  c.GT = 100;
  c.tickSkill2(0.1, tickCtx(c, p, enemies));
  const byName = {};
  derived.forEach((h) => { byName[h.ent.name] = (byName[h.ent.name] || 0) + h.amount; });
  assert.equal(byName['普通'], 900, '普通敵人 -90% 最大生命');
  assert.equal(byName['菁英'], 400, '菁英 -40%');
  assert.equal(byName['BOSS'], 200, 'BOSS -20%');

  // 節拍推進：下一次要再等一個間隔
  const before = derived.length;
  c.GT = 120;
  c.tickSkill2(0.1, tickCtx(c, p, enemies));
  assert.equal(derived.length, before, '間隔未到不得連發');
});

test('【地爆天星】：倒數投影成狀態，落地後重新起算', () => {
  const c = loadContext();
  stubHits(c);
  stubVfx(c);
  const derived = stubDerived(c);
  c.chance = () => false;
  maxLevels(c, 'fireball');
  equip(c, 'fireball');
  setUlt(c, 'fireball', 'starfallCataclysm', 1);   // Lv.1：間隔 57 秒
  const p = playerEnt();
  const enemies = [enemy(1000, 100, 0)];

  c.GT = 0;
  c.tickSkill2(0.1, tickCtx(c, p, enemies));
  const buff = p.buffs && p.buffs.sgStarfall;
  assert.ok(buff, '排程時就要把倒數投影成狀態');
  assert.equal(Math.round(buff.until - c.GT), 57, '狀態的剩餘時間＝距離下一次落下還有多久');

  c.GT = 57.05;
  c.tickSkill2(0.1, tickCtx(c, p, enemies));
  assert.ok(derived.length > 0, '落地才扣血');
  assert.equal(Math.round(p.buffs.sgStarfall.until - c.GT), 57, '落地後重新起算倒數');
});

test('【地爆天星】：倒數狀態是 RT 的投影，重置與卸下都要一起收掉', () => {
  function armed() {
    const c = loadContext();
    stubHits(c);
    stubVfx(c);
    c.chance = () => false;
    maxLevels(c, 'fireball');
    equip(c, 'fireball');
    setUlt(c, 'fireball', 'starfallCataclysm', 1);
    const p = playerEnt();
    const enemies = [enemy(1000, 100, 0)];
    c.GT = 0;
    c.tickSkill2(0.1, tickCtx(c, p, enemies));
    assert.ok(p.buffs.sgStarfall, '排程時就要有倒數');
    return { c: c, p: p, enemies: enemies };
  }

  // 重置（死亡／讀檔／進出塔）：留著倒數＝玩家看著一個永遠不會落下的計時
  const a = armed();
  a.c.resetSkill2RT();
  assert.equal(a.p.buffs.sgStarfall, undefined, '重置後不得留下倒數');
  assert.equal(a.c.SKILL2_RT.starfall, null);

  // 卸下技能：主動型節拍的共同代價是「卸下即失效」
  const b = armed();
  b.c.G.player.loadout = [];
  b.c.GT = 1;
  b.c.tickSkill2(0.1, tickCtx(b.c, b.p, b.enemies));
  assert.equal(b.p.buffs.sgStarfall, undefined, '卸下技能後不得留下倒數');
  assert.equal(b.c.SKILL2_RT.starfall, null);
});

test('【地爆天星】：落下前 5 秒黑影擴大到全場，殞石體積 3 倍且下墜速度減半', () => {
  const c = loadContext();
  stubHits(c);
  const specs = stubVfx(c);
  const derived = stubDerived(c);
  c.chance = () => false;
  maxLevels(c, 'fireball');
  equip(c, 'fireball');
  setUlt(c, 'fireball', 'starfallCataclysm', 1);
  const p = playerEnt();
  const enemies = [enemy(1000, 100, 0)];
  const shadows = () => specs.filter((s) => s.variant === 'starfall-shadow');
  const drops = () => specs.filter((s) => s.variant === 'meteor-starfall');

  c.GT = 0;
  c.tickSkill2(0.1, tickCtx(c, p, enemies));   // at = 57

  // 預警：落下前 SG_STARFALL_WARN_SEC 秒才出現，早一點都不行
  c.GT = 57 - c.SG_STARFALL_WARN_SEC - 0.2;
  c.tickSkill2(0.1, tickCtx(c, p, enemies));
  assert.equal(shadows().length, 0, '還沒到預警時間就不該有黑影');
  c.GT = 57 - c.SG_STARFALL_WARN_SEC + 0.1;
  c.tickSkill2(0.1, tickCtx(c, p, enemies));
  assert.equal(shadows().length, 1, '落下前 5 秒出現黑影');
  assert.equal(shadows()[0].fxKind, 'aura');
  assert.ok(shadows()[0].dur > c.SG_STARFALL_WARN_SEC - 0.3 &&
    shadows()[0].dur <= c.SG_STARFALL_WARN_SEC, '黑影一路擴大到落地那一刻');

  // 下墜：一般殞石的兩倍時間（＝速度一半），體積 3 倍
  const fallSec = c.sgMeteorFallTiming().fallMs / 1000 * c.SG_STARFALL_FALL_MULT;
  assert.equal(c.SG_STARFALL_FALL_MULT, 2, '下墜速度是一般殞石的一半');
  c.GT = 57 - fallSec - 0.2;
  c.tickSkill2(0.1, tickCtx(c, p, enemies));
  assert.equal(drops().length, 0, '還沒到下墜時間就不該有殞石');
  c.GT = 57 - fallSec + 0.05;
  c.tickSkill2(0.1, tickCtx(c, p, enemies));
  assert.equal(drops().length, 1, '開始下墜');
  assert.equal(drops()[0].sizeMult, c.SG_STARFALL_SIZE_MULT, '體積 3 倍');
  assert.ok(Math.abs(drops()[0].travelMs[0] - fallSec * 1000) < 150,
    '下墜時間＝一般殞石的兩倍（顯示層靠它對齊落地時刻）');
  assert.equal(derived.length, 0, '殞石還在天上就不能扣血');

  // 落地
  c.GT = 57.05;
  c.tickSkill2(0.1, tickCtx(c, p, enemies));
  assert.ok(derived.length > 0, '落地才扣血');
  assert.equal(specs.filter((s) => s.variant === 'starfall-impact').length, 1, '落地送受擊反饋');
  // 預警與下墜每一輪各只送一次
  assert.equal(shadows().length, 1);
  assert.equal(drops().length, 1);
});

test('【火鳳遼原】：殞石 +1 顆、每顆伴隨數顆火球落下，且傷害提高', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'fireball');
  const baseP = playerEnt();
  const baseM = enemy(1e9, 100, 0);
  c.castSkill2(baseP, [baseM], 'fireball', 'mv-float');
  const baseDmg = c.SKILL2_RT.meteors[0].dmgVal;

  const c2 = loadContext();
  stubHits(c2);
  c2.chance = () => false;   // sgRollCount 的小數部分不補
  maxLevels(c2, 'fireball');
  setUlt(c2, 'fireball', 'phoenixPrairie', 1);   // Lv.1：殞石 +1、伴生 3.3 顆、傷害 +33%
  const p2 = playerEnt();
  const m2 = enemy(1e9, 100, 0);
  c2.castSkill2(p2, [m2], 'fireball', 'mv-float');
  assert.equal(c2.SKILL2_RT.meteors.length, 4, '殞石 3 → 4 顆');
  assert.equal(Math.round(c2.SKILL2_RT.meteors[0].dmgVal / baseDmg * 100), 133, '傷害 +33%');

  // 每顆殞石落地時再排入伴生火球（同樣走落地佇列）
  c2.GT = 10;
  c2.tickSkill2(0, tickCtx(c2, p2, [m2]));
  assert.equal(c2.SKILL2_RT.meteors.length, 12, '4 顆殞石各伴隨 3 顆火球');
  const ball = c2.SKILL2_RT.meteors[0];
  assert.ok(ball.dmgVal < baseDmg, '伴生火球取第 1 階火球的傷害，遠低於殞石');
  assert.equal(ball.variant, 'fire-explosion');
});

/* ===========================================================================
   3) 火龍捲的五個傳奇特效
   =========================================================================== */

test('【追蹤烈焰】：火龍捲取得追蹤移動能力', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  setLevels(c, 'firepillar', [1, 0, 0, 0, 0, 0, 0]);
  c.castSkill2(playerEnt(), [enemy(1e9, 100, 0)], 'firepillar', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds[0].chaseM, 0, '基準：釘在地板上不動');
  assert.equal(c.SKILL2_RT.grounds[0].speed, 0);

  const c2 = loadContext();
  stubHits(c2);
  c2.chance = () => false;
  setLegendary(c2, ['firepillarTracking']);
  setLevels(c2, 'firepillar', [1, 0, 0, 0, 0, 0, 0]);
  c2.castSkill2(playerEnt(), [enemy(1e9, 100, 0)], 'firepillar', 'mv-float');
  const f = c2.SKILL2_RT.grounds[0];
  assert.equal(f.chaseM, c2.bfMeterPx(30), '追擊半徑 30 米');
  assert.equal(f.speed, c2.bfMeterPx(12), '移動速度 12 米／秒');
});

test('【火龍擴散】：火龍捲的判定體積 +30%', () => {
  function radius(keys) {
    const c = loadContext();
    stubHits(c);
    c.chance = () => false;
    setLegendary(c, keys);
    setLevels(c, 'firepillar', [1, 0, 0, 0, 0, 0, 0]);
    c.castSkill2(playerEnt(), [enemy(1e9, 100, 0)], 'firepillar', 'mv-float');
    return c.SKILL2_RT.grounds[0].radius;
  }
  assert.equal(Math.round(radius(['firepillarSpread']) / radius([]) * 100), 130);
});

test('【火焰爆衝】：火龍捲的傷害段數 +3（壽命不變＝節拍變密）', () => {
  function shape(keys) {
    const c = loadContext();
    stubHits(c);
    c.chance = () => false;
    setLegendary(c, keys);
    setLevels(c, 'firepillar', [1, 0, 0, 0, 0, 0, 0]);
    c.castSkill2(playerEnt(), [enemy(1e9, 100, 0)], 'firepillar', 'mv-float');
    const f = c.SKILL2_RT.grounds[0];
    return { hits: f.hits, gap: f.gap };
  }
  const base = shape([]);
  const boost = shape(['firepillarOutburst']);
  assert.equal(base.hits, 5);
  assert.equal(boost.hits, 8, '5 → 8 段');
  assert.equal(Math.round(base.hits * base.gap * 1000), Math.round(boost.hits * boost.gap * 1000),
    '總壽命不變');
});

test('【爆燃】：火龍捲每段命中都讓該敵人受到的燃燒傷害更高', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => true;   // 第 4 階燃燒必定塗上，才驗得到放大
  setLegendary(c, ['firepillarDeflagration']);
  // 階層循序解鎖：要驗第 4 階（燃燒）就必須連著點到第 4 階
  setLevels(c, 'firepillar', [1, 1, 1, 1, 0, 0, 0]);
  const p = playerEnt();
  const m = enemy(1e9, 100, 0);
  c.castSkill2(p, [m], 'firepillar', 'mv-float');
  // 第 3 階【雙重龍捲】會同時生出 2 道；只留第 1 道，疊層才數得準
  c.SKILL2_RT.grounds.length = 1;
  const f = c.SKILL2_RT.grounds[0];
  assert.ok(f.burnAmp && f.burnAmp.pct === 10, '場域帶著【爆燃】的放大規格');

  // 推進兩拍
  c.GT += f.gap; c.tickSkill2(f.gap, tickCtx(c, p, [m]));
  const amp1 = c.buffVal(m, 'sgBurnAmp');
  const dps1 = c.sgFindDot(m, 'sgBurn').dps;
  c.GT += f.gap; c.tickSkill2(f.gap, tickCtx(c, p, [m]));
  const amp2 = c.buffVal(m, 'sgBurnAmp');
  const dps2 = c.sgFindDot(m, 'sgBurn').dps;

  assert.equal(amp1, 10, '第 1 段：+10%');
  assert.equal(amp2, 20, '第 2 段：累加到 +20%');
  assert.ok(dps2 > dps1, '已經在燒的那一份要跟著變強');
  assert.equal(Math.round(dps2 / dps1 * 1000) / 1000, Math.round(1.2 / 1.1 * 1000) / 1000);
});

test('【火龍共鳴】：場上每存在 1 道火龍捲就替所有火龍捲增傷', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  setLegendary(c, ['firepillarResonance']);
  // 第 3 階＝同時 2 道（階層循序解鎖，必須連著點）；兩個目標分開站，兩道各自命中自己那一個
  setLevels(c, 'firepillar', [1, 1, 1, 0, 0, 0, 0]);
  const p = playerEnt();
  const a = enemy(1e9, 100, 0, 'A');
  const b = enemy(1e9, 100, 300, 'B');
  const enemies = [a, b];
  c.castSkill2(p, enemies, 'firepillar', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.length, 2);
  const gap = c.SKILL2_RT.grounds[0].gap;
  c.GT += gap; c.tickSkill2(gap, tickCtx(c, p, enemies));
  assert.ok(calls.length > 0, '應該有命中');
  assert.equal(calls[0].total, 8, '場上 2 道 × 每道 +4% ＝ +8%');
});

/* ===========================================================================
   4) 火龍捲的三個超神進化
   =========================================================================== */

test('【烈焰暴風】：每次施放的火龍捲數量變為 N 倍', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'firepillar');
  c.castSkill2(playerEnt(), [enemy(1e9, 100, 0)], 'firepillar', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.length, 3, '基準：無限火牆 3 道');

  const c2 = loadContext();
  stubHits(c2);
  c2.chance = () => false;
  maxLevels(c2, 'firepillar');
  setUlt(c2, 'firepillar', 'infernoTempest', 1);   // Lv.1：1.2 ＋ 0.8 ＝ 2.0 倍
  c2.castSkill2(playerEnt(), [enemy(1e9, 100, 0)], 'firepillar', 'mv-float');
  assert.equal(c2.SKILL2_RT.grounds.length, 6, '3 道 × 2.0 倍');
});

test('【永劫火獄】：火龍捲在附近游走，並在移動軌跡上留下火池', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'firepillar');
  setUlt(c, 'firepillar', 'eternalInferno', 1);
  const p = playerEnt();
  const m = enemy(1e9, 100, 0);
  c.castSkill2(p, [m], 'firepillar', 'mv-float');
  const f = grounds(c, 'wall')[0];
  assert.equal(f.wanderM, c.bfMeterPx(20), '游走半徑 20 米');
  assert.ok(f.speed > 0, '游走要有速度');
  assert.ok(f.trail, '帶著軌跡火池的規格');
  assert.equal(f.trail.gap, 0.5);
  assert.equal(f.trail.sec, 6);
  // Lv.1：每 0.5 秒 220% 火焰傷害
  assert.equal(Math.round(f.trail.dmgVal / f.dmgVal * 100), 220);

  const start = { x: f.pos.x, y: f.pos.y };
  c.GT += f.gap; c.tickSkill2(f.gap, tickCtx(c, p, [m]));
  assert.ok(grounds(c, 'firepool').length > 0, '每一拍在當下位置留下一灘火池');
  const moved = Math.abs(f.pos.x - start.x) + Math.abs(f.pos.y - start.y);
  assert.ok(moved > 0, '火龍捲應該有移動');
});

test('【火龍之吞噬】：火龍捲聚攏在自己身邊、持續拉近敵人，且段數提高', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;   // sgRollCount 的小數部分不補
  maxLevels(c, 'firepillar');
  const baseHits = (() => {
    const b = loadContext();
    stubHits(b);
    b.chance = () => false;
    maxLevels(b, 'firepillar');
    b.castSkill2(playerEnt(), [enemy(1e9, 100, 0)], 'firepillar', 'mv-float');
    return b.SKILL2_RT.grounds[0].hits;
  })();
  setUlt(c, 'firepillar', 'dragonDevour', 1);
  const p = playerEnt();
  const far = enemy(1e9, 250, 0, '遠方');
  c.castSkill2(p, [far], 'firepillar', 'mv-float');
  const f = c.SKILL2_RT.grounds[0];
  assert.equal(f.hits, baseHits + 3, '傷害段數 +3');
  assert.equal(f.pullM, c.bfMeterPx(30), '拉近半徑 30 米');
  const home = c.bfPlayerPos();
  assert.equal(Math.round(f.pos.x), Math.round(home.x), '落點改為聚攏在自己身邊');
  assert.equal(Math.round(f.pos.y), Math.round(home.y));

  const before = c.bfEntityDistance(far);
  c.GT += f.gap; c.tickSkill2(f.gap, tickCtx(c, p, [far]));
  assert.ok(c.bfEntityDistance(far) < before, '範圍內的敵人被拉向自己');
});

/* ===========================================================================
   5) 傳奇橋與資料表
   =========================================================================== */

test('legendarySkill2Mods 只合併「同群組且已生效」的火系傳奇 fx', () => {
  const c = loadContext();
  setLegendary(c, ['fireballBeadShot', 'firepillarResonance', 'knifeChain']);
  const fb = c.legendarySkill2Mods('fireball');
  const fp = c.legendarySkill2Mods('firepillar');
  assert.deepEqual(JSON.parse(JSON.stringify(fb)), { fireballCountAdd: { count: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(fp)), { firepillarResonancePct: 4 });
  assert.equal(fb.firepillarResonancePct, undefined, '不得跨群組外洩');
});

test('數量／段數包在規格物件裡：雙手補償只放大威力，不放大次數', () => {
  const c = loadContext();
  const base = c.getStats();
  c.getStats = () => Object.assign({}, base, {
    legendaryEffects: { firepillarOutburst: true, firepillarResonance: true },
    legendaryEffectMults: { firepillarOutburst: 2, firepillarResonance: 2 }
  });
  const fp = c.legendarySkill2Mods('firepillar');
  assert.equal(fp.firepillarHitsAdd.hits, 3, '段數是受保護的鍵，不吃 ×2');
  assert.equal(fp.firepillarResonancePct, 8, '威力照吃 ×2');
});
