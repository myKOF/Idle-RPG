/* 傳奇進化第十二批（2026-08-28）：暴風屏障（盾牌）——設計文檔的最後一組
   設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤的暴風屏障那一段。
   守住的事：
     1. 五個傳奇：吸收（屏障減免）、暴風反射（暴風之刃機率）、逆風切（亂風切的風切每跳量）、
        風之壁（屏障期間的防禦乘算）、風暴核心（暴風神體持續時間）
     2. 三個超神：瓦爾格之力（神體的持續時間／減免／風系乘區）、
        天穹崩裂（每 2 秒落下召喚星體）、森羅萬象（同時打出暴風真空刃與虛空斬）
     3. 兩個群組各有一個叫【天穹崩裂】的超神（設計文檔如此命名）：
        風刃那一個會把技能改為被動，暴風屏障這一個**不會**——判定走 SG_ULT_PASSIVE 查表

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
function stubHits(c) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ ent: defender, atk: aCfg.atk, total: aCfg.totalDmgPct || 0 });
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
/* 決定論亂數：召喚星體的種類、顆數與落點都靠 Math.random，
   固定種子才不會讓「三種星體都出得來」變成機率性的斷言。 */
function seedRandom(c, seed) {
  let s = (seed || 1) >>> 0;
  c.Math.random = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
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
/* 施放一次暴風屏障；回傳這一次施放後的觀測點。 */
function castBarrier(opts) {
  opts = opts || {};
  const c = loadContext();
  const specs = stubVfx(c);
  const hits = stubHits(c);
  setLegendary(c, opts.legendary);
  maxLevels(c, 'stormbarrier');
  maxLevels(c, 'vacuumslash');
  equip(c, 'stormbarrier');
  if (opts.ult) setUlt(c, 'stormbarrier', opts.ult, opts.ultLv || 1);
  if (opts.vacuumUlt) setUlt(c, 'vacuumslash', opts.vacuumUlt, 10);
  const p = playerEnt();
  const list = opts.enemies || [enemy(1e9, 20, 0, 'a')];
  c.castSkill2(p, list, 'stormbarrier', 'mv-float');
  return { c, specs, hits, p, list };
}

/* ===========================================================================
   0) 資料形狀
   =========================================================================== */

test('第十二批的五個傳奇特效都在池子裡，且掛在盾牌／暴風屏障', () => {
  const c = loadContext();
  const keys = ['stormbarrierAbsorb', 'stormbarrierReflect', 'stormbarrierCounterCut',
    'stormbarrierWall', 'stormbarrierCore'];
  keys.forEach((k) => {
    const def = c.PASSIVE_POOL[k];
    assert.ok(def, k + ' 應在傳奇特效池');
    assert.equal(def.legendary, true);
    assert.equal(def.relatedSkill, 'stormbarrier');
    assert.equal(def.weaponTypes.join(','), 'shield');
    assert.equal(def.type, 'wind');
    assert.ok(def.fx && Object.keys(def.fx).length > 0, k + ' 缺 fx 規格');
  });
  // 盾牌是單手副手武器：不吃雙手 ×2 補償
  assert.equal(c.WEAPON_TYPES.shield.hands, 1);
  assert.equal(c.WEAPON_TYPES.shield.cat, 'offHand');
});

test('第十二批的三個超神進化都在群組表上，且說明模板的參數鍵都存在', () => {
  const c = loadContext();
  assert.equal(c.sgUltDefs('stormbarrier').map((u) => u.id).join(','),
    'valgrForce,skyfallStars,myriadPhenomena');
  assert.equal(c.sgSlotCount('stormbarrier'), 8);
  c.sgUltDefs('stormbarrier').forEach((opt) => {
    assert.ok(opt.name && opt.desc && opt.cost > 0 && opt.goldBase > 0);
    (opt.desc.match(/\{(\w+)\}/g) || []).forEach((tok) => {
      const key = tok.slice(1, -1);
      assert.ok(Object.prototype.hasOwnProperty.call(opt.fx, key),
        'stormbarrier／' + opt.id + ' 的說明模板用了不存在的參數鍵 ' + key);
    });
  });
});

test('兩個群組各有一個【天穹崩裂】：只有風刃那一個會把技能改為被動', () => {
  const c = loadContext();
  const windId = c.sgUltDefs('windblade').filter((u) => u.name === '天穹崩裂')[0].id;
  const stormId = c.sgUltDefs('stormbarrier').filter((u) => u.name === '天穹崩裂')[0].id;
  assert.equal(windId, 'skyCollapse');
  assert.equal(stormId, 'skyfallStars');
  assert.notEqual(windId, stormId, '同名的兩個選項必須是不同的 id');
  maxLevels(c, 'windblade'); maxLevels(c, 'stormbarrier');
  equip(c, 'windblade');
  setUlt(c, 'windblade', 'skyCollapse', 1);
  setUlt(c, 'stormbarrier', 'skyfallStars', 1);
  assert.equal(c.skills2ActsPassive('windblade'), true, '風刃【天穹崩裂】＝改為被動');
  assert.equal(c.skills2ActsPassive('stormbarrier'), false, '暴風屏障【天穹崩裂】不改變主動施放');
  // 查表是唯一入口：兩個群組各自只認自己那一個 id
  assert.equal(c.SG_ULT_PASSIVE.windblade, 'skyCollapse');
  assert.equal(c.SG_ULT_PASSIVE.stormbarrier, undefined);
});

/* ===========================================================================
   1) 五個傳奇特效
   =========================================================================== */

test('【吸收】：屏障的傷害減免 +10（加算進風系減免的同一個池子）', () => {
  const base = castBarrier({});
  const up = castBarrier({ legendary: ['stormbarrierAbsorb'] });
  assert.equal(up.p.buffs.sgStormBarrier.val - base.p.buffs.sgStormBarrier.val, 10);
  assert.equal(up.c.skill2WindDamageRedPct(up.p) - base.c.skill2WindDamageRedPct(base.p), 10,
    '走的是風系減免的同一個加總');
});

test('【暴風反射】：【暴風之刃】射出風刃的機率 +10', () => {
  function chanceOf(keys) {
    const r = castBarrier({ legendary: keys, enemies: [enemy(1e9, 20, 0, 'atk')] });
    const m = r.list[0];
    r.c.FIELD = { player: r.p, enemies: [m], dpsWindow: [] };
    let seen = null;
    r.c.chance = (x) => { if (seen === null) seen = x; return false; };
    r.c.sgStormbladeOnPlayerDamaged(m, r.p, 'mv-float');
    return seen;
  }
  const base = chanceOf([]);
  assert.ok(base > 0);
  assert.equal(chanceOf(['stormbarrierReflect']) - base, 10);
});

test('【逆風切】：只放大【亂風切】塗出來的那一份風切，真空斬那一份不受影響', () => {
  function spec(keys) {
    const c = loadContext();
    setLegendary(c, keys);
    maxLevels(c, 'stormbarrier');
    maxLevels(c, 'vacuumslash');
    equip(c, 'stormbarrier');
    return {
      storm: c.sgWindRendSpec(c.SKILLS2.stormbarrier, c.skills2Levels('stormbarrier'), 2, 1000),
      vacuum: c.sgWindRendSpec(c.SKILLS2.vacuumslash, c.skills2Levels('vacuumslash'), 2, 1000)
    };
  }
  const base = spec([]);
  const up = spec(['stormbarrierCounterCut']);
  assert.ok(Math.abs(up.storm.per - base.storm.per * 1.35) < 1e-9, '亂風切那一份每跳 ×1.35');
  assert.ok(Math.abs(up.storm.extra - base.storm.extra * 1.35) < 1e-9, '【無限風切】的額外每層也一起放大');
  assert.equal(up.vacuum.per, base.vacuum.per, '真空斬塗的那一份不得改變');
});

test('【風之壁】：屏障作用中防禦 ×1.2，且乘在 defUp 之外（不覆寫【鐵壁】）', () => {
  const base = castBarrier({});
  const wall = castBarrier({ legendary: ['stormbarrierWall'] });
  assert.equal(base.c.skill2DefFactor(base.p), 1, '沒有這個特效時不生效');
  assert.equal(wall.c.skill2DefFactor(wall.p), 1.2);
  // 屏障結束後就失效（RT 是權威）
  wall.c.GT += 60;
  assert.equal(wall.c.skill2DefFactor(wall.p), 1, '屏障結束後回到 1');
  // 掛點：combat.js 的我方防禦唯一出口，且與 defUp 相乘而不是覆寫
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  assert.match(combat, /var defMul = \(1 \+ buffVal\(pEnt, 'defUp'\) \/ 100\) \*/);
  assert.match(combat, /skill2DefFactor\(pEnt\)/);
});

test('【風暴核心】：【暴風神體】的持續時間 ×1.5', () => {
  const base = castBarrier({});
  const core = castBarrier({ legendary: ['stormbarrierCore'] });
  const baseDur = base.p.buffs.sgStormGod.until - base.c.GT;
  const coreDur = core.p.buffs.sgStormGod.until - core.c.GT;
  assert.ok(baseDur > 0);
  assert.ok(Math.abs(coreDur - baseDur * 1.5) < 1e-9);
});

/* ===========================================================================
   2) 三個超神進化
   =========================================================================== */

test('【瓦爾格之力】：神體的持續時間、傷害減免與風系乘區各自生效', () => {
  const base = castBarrier({});
  const ult = castBarrier({ ult: 'valgrForce', ultLv: 1 });
  const baseDur = base.p.buffs.sgStormGod.until - base.c.GT;
  const ultDur = ult.p.buffs.sgStormGod.until - ult.c.GT;
  assert.ok(Math.abs(ultDur - baseDur * 1.55) < 1e-9, '持續時間 +55%（Lv.1 ＝ 50＋5×1）');
  assert.ok(Math.abs(ult.p.buffs.sgStormGod.val - base.p.buffs.sgStormGod.val - 0.2) < 1e-9,
    '傷害減免再 +0.2%（Lv.1 ＝ 0.1＋0.1×1）');
  const baseAmp = base.c.skill2WindAmpACfg({}, base.p).skillElemAmp.wind;
  const ultAmp = ult.c.skill2WindAmpACfg({}, ult.p).skillElemAmp.wind;
  assert.ok(Math.abs(ultAmp - baseAmp * 1.55) < 1e-9, '風系傷害是獨立乘區（×1.55），不與第 7 階的百分點相加');
});

test('【風暴核心】與【瓦爾格之力】的兩個 +50% 相乘，不相加', () => {
  const base = castBarrier({});
  const both = castBarrier({ legendary: ['stormbarrierCore'], ult: 'valgrForce', ultLv: 1 });
  const baseDur = base.p.buffs.sgStormGod.until - base.c.GT;
  const bothDur = both.p.buffs.sgStormGod.until - both.c.GT;
  assert.ok(Math.abs(bothDur - baseDur * 1.5 * 1.55) < 1e-9);
});

test('【天穹崩裂】：每 2 秒落下召喚星體，三種形態都出得來', () => {
  const c = loadContext();
  const specs = stubVfx(c);
  const hits = stubHits(c);
  seedRandom(c, 20260828);
  maxLevels(c, 'stormbarrier');
  equip(c, 'stormbarrier');
  setUlt(c, 'stormbarrier', 'skyfallStars', 1);
  const p = playerEnt();
  const list = [enemy(1e9, 20, 0, 'a'), enemy(1e9, 30, 5, 'b')];
  advance(c, p, list, 20);
  const rain = specs.filter((s) => s.fxKind === 'rain');
  const kinds = new Set(rain.map((s) => s.variant));
  assert.ok(kinds.has('meteor'), '火殞石走既有的殞石畫法');
  assert.ok(kinds.has('thunder-fall'), '雷殞石走既有的雷殞天落畫法');
  assert.ok(specs.some((s) => s.variant === 'wind-blade'), '巨大風刃走既有的風刃畫法');
  assert.ok(rain.every((s) => s.elem === 'fire' || s.elem === 'lightning'));
  assert.ok(hits.length > 0, '召喚星體會造成傷害');
  // 沒裝配在技能列就不生效
  const off = loadContext();
  stubVfx(off); stubHits(off);
  seedRandom(off, 20260828);
  maxLevels(off, 'stormbarrier');
  setUlt(off, 'stormbarrier', 'skyfallStars', 1);
  const op = playerEnt();
  advance(off, op, [enemy(1e9, 20, 0, 'a')], 20);
  assert.equal(off.SKILL2_RT.meteors.length, 0);
  assert.equal(off.SKILL2_RT.projectiles.length, 0);
});

test('【森羅萬象】：施放時同時打出暴風真空刃與虛空斬，且都歸暴風屏障記帳', () => {
  const base = castBarrier({});
  const ult = castBarrier({ ult: 'myriadPhenomena', ultLv: 1 });
  assert.equal(base.specs.filter((s) => s.variant === 'wind-blade').length, 0);
  assert.equal(base.c.SKILL2_RT.orbits.length, 0);
  // 暴風真空刃＝四個方向 × 每方向 2 道（【風刃】第 7 階的 Lv.1 表定值）
  assert.equal(ult.specs.filter((s) => s.variant === 'wind-blade').length, 8);
  assert.ok(ult.c.SKILL2_RT.projectiles.every((pr) => pr.gid === 'stormbarrier'),
    '風刃的傷害紀錄歸暴風屏障，不歸風刃');
  // 虛空斬＝真空斬第 7 階的四道圓盤
  assert.equal(ult.c.SKILL2_RT.orbits.length, 4);
  ult.c.SKILL2_RT.orbits.forEach((o) => assert.equal(o.gid, 'stormbarrier'));
  // 傷害＝暴風屏障的群組基準值 × 該階 Lv.1 的% × (1＋55%)
  const st = ult.c.getStats();
  const bodyPct = ult.c.sgVal(ult.c.SKILLS2.vacuumslash.tiers[6].fx, 'pct', 1);
  const want = ult.c.sgGroupBaseStat(ult.c.SKILLS2.stormbarrier, st) * bodyPct / 100 * 1.55;
  assert.ok(Math.abs(ult.c.SKILL2_RT.orbits[0].dmgVal - want) < 1e-9);
});

test('【森羅萬象】借的是形態，不吃玩家在真空斬上的超神進化', () => {
  const plain = castBarrier({ ult: 'myriadPhenomena', ultLv: 1 });
  const withVac = castBarrier({ ult: 'myriadPhenomena', ultLv: 1, vacuumUlt: 'spacetimeCollapse' });
  const a = plain.c.SKILL2_RT.orbits[0];
  const b = withVac.c.SKILL2_RT.orbits[0];
  assert.equal(b.rings[0].r, a.rings[0].r, '【時空崩解】的固定半徑不得套到借來的形態上');
  assert.equal(b.growPxPerSec, a.growPxPerSec, '成長速度同上');
  assert.equal(b.until - withVac.c.GT, a.until - plain.c.GT, '持續時間同上');
  assert.equal(a.rings[0].r, 6 * M, '半徑取【虛空斬】第 7 階的表定 6 米');
});
