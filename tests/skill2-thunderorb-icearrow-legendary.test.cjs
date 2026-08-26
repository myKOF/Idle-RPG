/* 傳奇進化第九批（2026-08-27）：雷球（水晶球）／寒冰箭（魔法書）
   設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤的雷球、寒冰箭兩段。
   守住的事：
     1. 雷球五個傳奇：雷核（體積）、超載（場上雷球數 → 雷電傷害）、感電核心（伴生時間）、
        雷殞落（降下顆數）、雷殞震（暈眩秒數改寫至 4 秒）
     2. 雷球三個超神：臨界雷劫（伴生 4 顆／機率翻倍／傷害乘區）、雷爆（命中觸發彈射小球）、
        雷殞天地碎（永久節拍不斷降下雷殞石）
     3. 寒冰箭五個傳奇：連射（支數）、冰封（傷害乘區）、凜冬侵蝕（寒霜每跳量與時間）、
        冰裂箭（往前分裂）、深度凍結（控場中增傷）
     4. 寒冰箭三個超神：極寒冰爆（波數與間隔改寫）、無限冰裂（支數＋命中回扣冷卻）、
        冰之淚（跟隨我方的箭雨）

   ⚠️ 本檔只驗「機制有沒有接上」，不驗「數字調校得對不對」（那是參數表的事）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const M = 10; // 1 米 ＝ 10 個戰場單位（bfMeterPx）

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
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
    hpRegen: 0, mpRegen: 0, lifesteal: 0, manaSteal: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: {},
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0, legendaryEffects: {}, legendaryEffectMults: {}
  };
  context.getStats = () => context.BASE_STATS;
  context.GT = 0;
  context.markSkillReady = () => {};
  return context;
}

function enemy(hp, x, y, name) {
  return {
    name: name || '測試怪', maxHp: hp, hp, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    elite: false, isBoss: false,
    pos: (x === undefined) ? undefined : { x, y }
  };
}
function playerEnt() {
  return { hp: 1000, mp: 500, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
/* 命中紀錄：resolveHit 是所有「一次攻擊」的唯一出口，因此數這裡就等於數命中。 */
function stubHits(c) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ ent: defender, atk: aCfg.atk, total: aCfg.totalDmgPct || 0, elem: aCfg.skillElem });
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
  c.floatEnemyEvent = () => {};
  c.floatPlayerEvent = () => {};
  return specs;
}
function tickCtx(c, p, enemies) {
  return { pEnt: p, getEnemies: () => enemies, floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
}
function advance(c, p, enemies, seconds, step) {
  const dt = step || 0.05;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    c.GT = +(c.GT + dt).toFixed(4);
    c.tickSkill2(dt, tickCtx(c, p, enemies));
  }
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
function orbFields(c) {
  return c.SKILL2_RT.grounds.filter((f) => f.gid === 'thunderorb' && f.kind === 'orb');
}
function line(n, gap, start) {
  const es = [];
  for (let i = 0; i < n; i++) es.push(enemy(1e9, (start || 30) + i * gap, 0, 'e' + i));
  return es;
}

/* ===========================================================================
   1) 雷球的五個傳奇特效
   =========================================================================== */

test('【雷核】：雷球的體積 +30%（與第 2 階【擴增雷球】相乘）', () => {
  function radius(keys, levels) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    setLegendary(c, keys);
    setLevels(c, 'thunderorb', levels);
    c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'thunderorb', 'mv-float');
    return orbFields(c)[0].radius;
  }
  const solo = [1, 0, 0, 0, 0, 0, 0];
  const base = radius([], solo);
  assert.equal(base, 3 * M, '表定半徑 3 米');
  assert.equal(radius(['thunderorbCore'], solo), base * 1.3, '體積 ×1.3');
  // 與第 2 階相乘而不是相加：兩者都是「體積 +N%」
  const tier2 = radius([], [1, 1, 0, 0, 0, 0, 0]);
  assert.ok(tier2 > base);
  assert.equal(
    Math.round(radius(['thunderorbCore'], [1, 1, 0, 0, 0, 0, 0]) * 1e6),
    Math.round(tier2 * 1.3 * 1e6),
    '兩個體積%相乘'
  );
});

test('【超載】：場上每存在 1 個雷球，雷電傷害 +3%（雷球消失即歸零）', () => {
  const c = loadContext();
  stubVfx(c); stubHits(c);
  setLegendary(c, ['thunderorbOverload']);
  setLevels(c, 'thunderorb', [1, 0, 0, 0, 0, 0, 0]);
  const p = playerEnt();
  const es = [enemy(1e9, 40, 0, 'a')];
  assert.equal(c.skill2LightningDamageUpPct(p), 0, '沒有雷球就沒有加成');
  c.castSkill2(p, es, 'thunderorb', 'mv-float');
  const n = orbFields(c).length;
  assert.ok(n >= 2, '表定一次召喚 2 個雷球');
  assert.equal(c.skill2LightningDamageUpPct(p), 3 * n, '每個雷球各給一份');
  // 雷球打完就消失，加成同步歸零（沒有殘留的常駐增益）
  advance(c, p, es, 20);
  assert.equal(orbFields(c).length, 0);
  assert.equal(c.skill2LightningDamageUpPct(p), 0);
});

test('【超載】沒裝特效時完全不加成（場上有雷球也一樣）', () => {
  const c = loadContext();
  stubVfx(c); stubHits(c);
  setLevels(c, 'thunderorb', [1, 0, 0, 0, 0, 0, 0]);
  const p = playerEnt();
  c.castSkill2(p, [enemy(1e9, 40, 0, 'a')], 'thunderorb', 'mv-float');
  assert.ok(orbFields(c).length > 0);
  assert.equal(c.skill2LightningDamageUpPct(p), 0);
});

test('【感電核心】：伴生雷球的持續時間 ×2（作用拍數跟著加倍）', () => {
  function companionHits(keys) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    setLegendary(c, keys);
    c.chance = () => true;                       // 伴生一定觸發
    setLevels(c, 'thunderorb', [1, 1, 1, 1, 1, 1, 0]);
    const p = playerEnt();
    const es = [enemy(1e9, 40, 0, 'a')];
    c.castSkill2(p, es, 'thunderorb', 'mv-float');
    advance(c, p, es, 1.2);
    // 靜止（speed 0）的那些就是伴生雷球；飛行雷球一律有速度
    return orbFields(c).filter((f) => f.speed === 0).map((f) => f.hits);
  }
  const base = companionHits([]);
  const long = companionHits(['thunderorbShockCore']);
  assert.ok(base.length > 0 && long.length > 0, '應該生出伴生雷球');
  assert.equal(long[0], base[0] * 2, '持續時間 +100% ＝ 拍數 ×2');
});

test('【雷殞落】：雷殞天落降下的雷球數量 +1 顆', () => {
  function fallCount(keys) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;                      // 不足 1 次的擲骰一律失敗，顆數才數得準
    maxLevels(c, 'thunderorb');
    c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'thunderorb', 'mv-float');
    return c.SKILL2_RT.meteors.length;
  }
  assert.equal(fallCount([]), 2, '表定 2 顆');
  assert.equal(fallCount(['thunderorbFallCount']), 3, '+1 顆');
});

test('【雷殞震】：雷殞天落的暈眩改寫「至」4 秒（取高，不會反而變短）', () => {
  function stunSecs(keys) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    maxLevels(c, 'thunderorb');
    const seen = [];
    c.sgTryStun = (target, sec) => { seen.push(sec); return sec; };
    const p = playerEnt();
    const es = [enemy(1e9, 40, 0, 'a')];
    c.castSkill2(p, es, 'thunderorb', 'mv-float');
    advance(c, p, es, 3);
    return seen;
  }
  const base = stunSecs([]);
  assert.ok(base.length > 0 && base.every((s) => s === 3), '表定衝擊波暈 3 秒');
  assert.ok(stunSecs(['thunderorbFallStun']).every((s) => s === 4), '改寫至 4 秒');
});

/* ===========================================================================
   2) 雷球的三個超神進化
   =========================================================================== */

test('【臨界雷劫】：伴生雷球一次 4 顆、觸發機率 ×2，且雷球傷害 +50%', () => {
  function run(withUlt) {
    const c = loadContext();
    stubVfx(c);
    stubHits(c);
    const rolls = [];
    c.chance = (pct) => { rolls.push(pct); return true; };
    maxLevels(c, 'thunderorb');
    equip(c, 'thunderorb');
    if (withUlt) setUlt(c, 'thunderorb', 'criticalThunderbolt', 1);
    const p = playerEnt();
    const es = [enemy(1e9, 40, 0, 'a')];
    c.castSkill2(p, es, 'thunderorb', 'mv-float');
    // 飛行雷球的傷害在施放當下就定版在場域上，不必等它飛完才數命中
    const flyDmg = orbFields(c).filter((f) => f.speed > 0)[0].dmgVal;
    advance(c, p, es, 1.2);
    return { orbs: orbFields(c).filter((f) => f.speed === 0).length, rolls, flyDmg };
  }
  const base = run(false);
  const ult = run(true);
  assert.equal(ult.orbs, base.orbs * 4, '一次生成 4 顆（原本 1 顆）');
  const baseChance = Math.min.apply(null, base.rolls);
  const ultChance = Math.min.apply(null, ult.rolls);
  assert.equal(ultChance, baseChance * 2, '觸發機率 ×2');
  // Lv.1 ＝ 50 + 5×1 ＝ 55%
  assert.equal(Math.round(ult.flyDmg / base.flyDmg * 100), 155, '雷球傷害 ×1.55');
});

test('【雷爆】：一顆小型雷球在範圍內彈射，總共命中「彈射次數」次', () => {
  const c = loadContext();
  stubVfx(c);
  const calls = stubHits(c);
  maxLevels(c, 'thunderorb');
  equip(c, 'thunderorb');
  setUlt(c, 'thunderorb', 'thunderBurst', 1);
  c.chance = () => true;
  const spec = c.sgThunderorbBurstSpec(c.SKILLS2.thunderorb, c.BASE_STATS);
  assert.ok(spec, '選了超神就該有規格');
  assert.equal(spec.bounces, 4, '表定彈射 4 次');
  assert.equal(spec.px, 12 * M, '表定 12 米');
  const es = line(6, 3 * M);
  const out = { killed: false, dmg: 0, crit: false };
  c.sgThunderorbBurst(playerEnt(), c.BASE_STATS, 'mv-float', spec, es[0], es, out);
  assert.equal(calls.length, 4, '4 次命中');
  assert.equal(calls[0].ent, es[0], '第一下就打在觸發它的敵人身上（單一 BOSS 也生效）');
  assert.ok(calls.every((h) => h.elem === 'lightning'));
});

test('【雷爆】沒選超神時規格為 null，雷球命中完全不進判定', () => {
  function hitsIn(withUlt) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    maxLevels(c, 'thunderorb');
    equip(c, 'thunderorb');
    if (withUlt) setUlt(c, 'thunderorb', 'thunderBurst', 1);
    c.chance = () => true;
    const p = playerEnt();
    const es = line(6, 3 * M);
    c.castSkill2(p, es, 'thunderorb', 'mv-float');
    const n0 = calls.length;
    advance(c, p, es, 0.5);
    return { delta: calls.length - n0, spec: c.sgThunderorbBurstSpec(c.SKILLS2.thunderorb, c.BASE_STATS) };
  }
  const base = hitsIn(false);
  const ult = hitsIn(true);
  assert.equal(base.spec, null, '沒選超神＝沒有規格');
  assert.ok(ult.spec);
  assert.ok(ult.delta > base.delta, '選了之後雷球命中會多帶出小型雷球的傷害');
});

test('【雷殞天地碎】：雷殞石體積與傷害放大，並每 1 秒不斷再降下 1 顆', () => {
  const c = loadContext();
  const specs = stubVfx(c);
  stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'thunderorb');
  equip(c, 'thunderorb');
  setUlt(c, 'thunderorb', 'thunderfallShatter', 1);
  const p = playerEnt();
  const es = [enemy(1e9, 40, 0, 'a')];
  // 施放時的那一批照常降下（設計沒寫「改為」＝追加）
  c.castSkill2(p, es, 'thunderorb', 'mv-float');
  const onCast = c.SKILL2_RT.meteors.length;
  assert.equal(onCast, 2, '施放時仍降下表定的 2 顆');
  const radius = c.SKILL2_RT.meteors[0].radius;
  assert.equal(radius, 15 * M * 1.5, '體積 +50%');
  const dropsBefore = specs.filter((s) => s.variant === 'thunder-fall').length;
  advance(c, p, es, 4);
  const dropsAfter = specs.filter((s) => s.variant === 'thunder-fall').length;
  assert.ok(dropsAfter - dropsBefore >= 3, '4 秒內至少再降下 3 顆（每 1 秒 1 顆）');
});

test('【雷殞天地碎】：沒裝配在技能列上就不運轉（節拍歸零）', () => {
  const c = loadContext();
  const specs = stubVfx(c);
  stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'thunderorb');
  setUlt(c, 'thunderorb', 'thunderfallShatter', 1);   // 故意不 equip
  const p = playerEnt();
  const es = [enemy(1e9, 40, 0, 'a')];
  advance(c, p, es, 4);
  assert.equal(c.SKILL2_RT.thunderfallAt, 0);
  assert.equal(specs.filter((s) => s.variant === 'thunder-fall').length, 0);
});

/* ===========================================================================
   3) 寒冰箭的五個傳奇特效
   =========================================================================== */

test('【連射】：射出的寒冰箭 +2 支', () => {
  function arrows(keys) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    setLevels(c, 'icearrow', [1, 0, 0, 0, 0, 0, 0]);
    c.castSkill2(playerEnt(), line(8, 6 * M), 'icearrow', 'mv-float');
    return calls.length;
  }
  assert.equal(arrows([]), 2, '表定 2 支');
  assert.equal(arrows(['icearrowVolley']), 4, '+2 支');
});

test('【冰封】：寒冰箭傷害 ×1.5（乘在第 1 階＋冰系強化的加總之後）', () => {
  function atk(keys) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    setLevels(c, 'icearrow', [1, 0, 0, 0, 0, 0, 0]);
    c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'icearrow', 'mv-float');
    return calls[0].atk;
  }
  assert.equal(Math.round(atk(['icearrowSeal']) / atk([]) * 100), 150);
});

test('【凜冬侵蝕】：寒冰箭塗出來的寒霜，每跳量與持續時間各 ×1.5', () => {
  function frost(keys) {
    const c = loadContext();
    stubVfx(c);
    stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    setLevels(c, 'icearrow', [1, 1, 0, 0, 0, 0, 0]);
    const e = enemy(1e9, 40, 0, 'a');
    c.castSkill2(playerEnt(), [e], 'icearrow', 'mv-float');
    return c.sgFindDot(e, 'sgFrostBite');
  }
  const base = frost([]);
  const winter = frost(['icearrowWinter']);
  assert.ok(base && winter, '第 2 階【寒霜箭】應該塗上凍傷');
  assert.equal(Math.round(winter.dps / base.dps * 100), 150, '每跳量 ×1.5');
  assert.equal(Math.round(winter.until / base.until * 100), 150, '持續時間 ×1.5');
});

test('【冰裂箭】：命中後往前分裂 2 支小箭，打的是前方而不是身後的敵人', () => {
  const c = loadContext();
  stubVfx(c);
  const calls = stubHits(c);
  setLegendary(c, ['icearrowSplit']);
  c.chance = () => false;
  setLevels(c, 'icearrow', [1, 0, 0, 0, 0, 0, 0]);
  // 玩家在原點：behind 比 victim 近、ahead 在 victim 更遠處（同一條 +x 直線）
  const behind = enemy(1e9, 10 * M, 0, 'behind');
  const victim = enemy(1e9, 20 * M, 0, 'victim');
  const ahead = enemy(1e9, 28 * M, 0, 'ahead');
  c.castSkill2(playerEnt(), [victim, ahead, behind], 'icearrow', 'mv-float');
  const splitAtk = Math.min.apply(null, calls.map((h) => h.atk));
  const aheadHits = calls.filter((h) => h.ent === ahead && h.atk === splitAtk);
  assert.ok(aheadHits.length > 0, '前方的敵人吃得到分裂箭');
  assert.equal(calls.filter((h) => h.ent === behind && h.atk === splitAtk).length, 0, '身後的敵人吃不到');
  // 分裂箭是「群組基礎值的 150%」，不是本體那一箭的 150%
  const bodyAtk = Math.max.apply(null, calls.map((h) => h.atk));
  assert.ok(splitAtk < bodyAtk, '小箭比本體弱');
});

test('【深度凍結】：擊中暈眩或凍結中的敵人時 +50%，未控場則不加', () => {
  function bonus(keys, control) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    setLevels(c, 'icearrow', [1, 0, 0, 0, 0, 0, 0]);
    const e = enemy(1e9, 40, 0, 'a');
    if (control === 'stun') e.effects.stun = 999;
    if (control === 'frozen') e.buffs.sgFrozen = { until: 999, val: 0 };
    c.castSkill2(playerEnt(), [e], 'icearrow', 'mv-float');
    return calls[0].total;
  }
  assert.equal(bonus(['icearrowDeepFreeze'], null), 0, '沒有控場就沒有加成');
  assert.equal(bonus(['icearrowDeepFreeze'], 'stun'), 50, '暈眩中 +50%');
  assert.equal(bonus(['icearrowDeepFreeze'], 'frozen'), 50, '凍結中 +50%');
  assert.equal(bonus([], 'stun'), 0, '沒裝特效就不加');
});

test('【深度凍結】與【冰裂箭】在追擊冰箭（第 7 階）那一段同樣生效', () => {
  const c = loadContext();
  stubVfx(c);
  stubHits(c);
  setLegendary(c, ['icearrowDeepFreeze', 'icearrowSplit']);
  c.chance = () => false;
  maxLevels(c, 'icearrow');
  equip(c, 'icearrow');
  c.castSkill2(playerEnt(), line(4, 5 * M), 'icearrow', 'mv-float');
  const homing = c.SKILL2_RT.grounds.filter((f) => f.kind === 'icearrow');
  assert.ok(homing.length > 0, '第 7 階應該生出追擊場域');
  assert.equal(homing[0].ctrlPct, 50, '控場增傷帶進場域');
  assert.equal(typeof homing[0].onHit, 'function', '分裂箭掛在場域的命中後回呼');
});

/* ===========================================================================
   4) 寒冰箭的三個超神進化
   =========================================================================== */

test('【極寒冰爆】：連射改為 10 波／每 0.35 秒，且寒冰箭傷害 +50%', () => {
  function run(withUlt) {
    const c = loadContext();
    const specs = stubVfx(c);
    stubHits(c);
    c.chance = () => false;
    maxLevels(c, 'icearrow');
    equip(c, 'icearrow');
    if (withUlt) setUlt(c, 'icearrow', 'absoluteZeroBurst', 1);
    c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'icearrow', 'mv-float');
    const pierce = specs.filter((s) => s.variant === 'ice-arrow-pierce');
    const delays = Array.from(new Set(pierce.map((s) => s.delayMs || 0))).sort((a, b) => a - b);
    // 貫穿箭的傷害在施放當下定版在飛行物上（命中要等它飛完才發生）
    return { waves: delays.length, gap: delays[1] - delays[0], dmg: c.SKILL2_RT.projectiles[0].dmgVal };
  }
  const base = run(false);
  const ult = run(true);
  assert.equal(base.waves, 3, '表定 3 波');
  assert.equal(base.gap, 300, '表定間隔 0.3 秒');
  assert.equal(ult.waves, 10, '改為 10 波');
  assert.equal(ult.gap, 350, '改為 0.35 秒');
  // Lv.1 ＝ 50 + 5×1 ＝ 55%
  assert.equal(Math.round(ult.dmg / base.dmg * 100), 155, '寒冰箭傷害 ×1.55');
});

test('【無限冰裂】：發射支數 +4，且每造成 1 次傷害就回扣 0.1 秒冷卻', () => {
  function run(withUlt) {
    const c = loadContext();
    const specs = stubVfx(c);
    const calls = stubHits(c);
    c.chance = () => false;                       // 不足 1 支的部分一律不觸發
    maxLevels(c, 'icearrow');
    equip(c, 'icearrow');
    if (withUlt) setUlt(c, 'icearrow', 'infiniteIceRift', 1);
    const p = playerEnt();
    const es = line(6, 5 * M);
    c.castSkill2(p, es, 'icearrow', 'mv-float');
    const cdAtCast = p.skillCds[c.SG_PREFIX + 'icearrow'];
    advance(c, p, es, 1);
    return {
      lanes: specs.filter((s) => s.variant === 'ice-arrow-pierce' && !s.delayMs).length,
      cdAtCast, cdAfter: p.skillCds[c.SG_PREFIX + 'icearrow'], hits: calls.length
    };
  }
  const base = run(false);
  const ult = run(true);
  assert.equal(ult.lanes, base.lanes + 4, '每次發射 +4 支');
  assert.equal(base.cdAfter, base.cdAtCast, '沒選超神時冷卻不會被命中扣掉');
  assert.ok(ult.hits > 0);
  assert.ok(ult.cdAfter <= Math.max(0, ult.cdAtCast - ult.hits * 0.1) + 1e-6, '每次命中各扣 0.1 秒');
  assert.ok(ult.cdAfter < ult.cdAtCast);
});

test('【冰之淚】：施放時另外召喚跟隨我方的箭雨（10 波、我方 30 米內）', () => {
  const c = loadContext();
  stubVfx(c);
  const calls = stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'icearrow');
  equip(c, 'icearrow');
  setUlt(c, 'icearrow', 'tearsOfIce', 1);
  const p = playerEnt();
  const es = [enemy(1e9, 40, 0, 'a'), enemy(1e9, 200, 100, 'b')];
  c.castSkill2(p, es, 'icearrow', 'mv-float');
  const rain = c.SKILL2_RT.grounds.filter((f) => f.kind === 'icerain');
  assert.equal(rain.length, 1, '一次施放一片箭雨');
  assert.equal(rain[0].hits, 10, '10 波');
  assert.equal(rain[0].radius, 30 * M, '我方 30 米');
  assert.equal(rain[0].follow, true, '圓心跟著我方走');
  const n0 = calls.length;
  advance(c, p, es, 4);
  assert.ok(calls.length > n0, '箭雨會逐波造成傷害');
});

test('【冰之淚】沒選超神就不會有箭雨場域', () => {
  const c = loadContext();
  stubVfx(c); stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'icearrow');
  equip(c, 'icearrow');
  c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'icearrow', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.filter((f) => f.kind === 'icerain').length, 0);
});

/* ===========================================================================
   5) 資料表：十個傳奇特效與六個超神進化都落到參數表
   =========================================================================== */

test('十個新傳奇特效：武器類型與關聯群組正確，且都落在 Equipment_Affix 表', () => {
  const c = loadContext();
  const csv = fs.readFileSync(path.join(root, 'config/CSV/Equipment_Affix.csv'), 'utf8');
  const expect = {
    thunderorbCore: 'orb', thunderorbOverload: 'orb', thunderorbShockCore: 'orb',
    thunderorbFallCount: 'orb', thunderorbFallStun: 'orb',
    icearrowVolley: 'spellbook', icearrowSeal: 'spellbook', icearrowWinter: 'spellbook',
    icearrowSplit: 'spellbook', icearrowDeepFreeze: 'spellbook'
  };
  Object.keys(expect).forEach((key) => {
    const def = c.PASSIVE_POOL[key];
    assert.ok(def, key + ' 應在傳奇特效池內');
    assert.equal(def.legendary, true);
    // ⚠️ vm 沙盒的陣列與宿主不同 realm，deepStrictEqual 會因原型不同而誤判，故比字串
    assert.equal(def.weaponTypes.join('|'), expect[key], key + ' 的武器類型');
    assert.equal(def.relatedSkill, expect[key] === 'orb' ? 'thunderorb' : 'icearrow');
    assert.ok(def.fx && Object.keys(def.fx).length > 0, key + ' 缺 fx');
    assert.ok(csv.includes(',' + key + ','), key + ' 沒落到參數表');
  });
});

test('六個新超神進化：id 與參數表一致，說明模板的參數鍵都存在', () => {
  const c = loadContext();
  const csv = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8');
  [['thunderorb', ['criticalThunderbolt', 'thunderBurst', 'thunderfallShatter']],
    ['icearrow', ['absoluteZeroBurst', 'infiniteIceRift', 'tearsOfIce']]].forEach(([gid, ids]) => {
    const list = c.sgUltDefs(gid);
    assert.ok(list, gid + ' 應已開放超神進化');
    assert.equal(list.map((o) => o.id).join('|'), ids.join('|'), gid + ' 的三個選項與順序');
    list.forEach((o) => {
      String(o.desc || '').replace(/\{(\w+)\}/g, (m, key) => {
        assert.ok(o.fx[key] !== undefined, gid + '/' + o.id + ' 說明引用了不存在的參數 {' + key + '}');
        return m;
      });
      assert.ok(csv.includes(',' + o.id + '\n') || csv.includes(',' + o.id + '\r\n'), o.id + ' 沒落到參數表');
    });
  });
});
