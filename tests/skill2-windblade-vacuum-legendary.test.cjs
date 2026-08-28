/* 傳奇進化第十一批（2026-08-28）：風刃（單手魔杖）／真空斬（雙手斧）
   設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤的風刃、真空斬兩段。
   守住的事：
     1. 風刃五個傳奇：裂風（每命中 1 次的累加增傷）、增壓（體積與飛行速度）、
        風之痕（另一側的小型風刃＋小型風刃增傷）、風蝕（受傷提高的減益）、
        斷空刃（暴風真空刃每方向改寫至 3 道＋風刃增傷）
     2. 風刃三個超神：暴風萬刃（大型風刃改為全場追擊＋多射 1 道＋增傷）、
        嵐之山（四方向各一道融合的巨型風刃）、天穹崩裂（改為被動、受擊機率射出）
     3. 真空斬五個傳奇：共振（多一次傷害）、裂痕（風切層數上限）、
        真空風刃（額外的小型風刃）、空間澎脹（體積）、虛空漲落（虛空斬持續時間）
     4. 真空斬三個超神：萬象風劫（命中留下靜止的真空斬）、虛空滅界（每 2 秒自動一道虛空斬）、
        時空崩解（虛空斬改為固定環繞＋持續時間）
     5. 雙手補償：真空斬那五個的保護鍵（次數／層數／秒數）不得被 ×2，體積要被 ×2

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
function setLegendary(c, keys, mults) {
  const on = {};
  (keys || []).forEach((k) => { on[k] = true; });
  c.BASE_STATS = Object.assign({}, c.BASE_STATS,
    { legendaryEffects: on, legendaryEffectMults: mults || {} });
}
function grounds(c, gid, kind) {
  return c.SKILL2_RT.grounds.filter((f) => f.gid === gid && f.kind === kind);
}

/* ===========================================================================
   0) 資料形狀
   =========================================================================== */

test('第十一批的十個傳奇特效都在池子裡，且掛在正確的武器部位與關聯技能', () => {
  const c = loadContext();
  const wind = ['windbladeRend', 'windbladePressure', 'windbladeTrace', 'windbladeErode', 'windbladeVoidCut'];
  const vacuum = ['vacuumResonance', 'vacuumRift', 'vacuumWindBlade', 'vacuumExpand', 'vacuumFlux'];
  wind.forEach((k) => {
    const def = c.PASSIVE_POOL[k];
    assert.ok(def, k + ' 應在傳奇特效池');
    assert.equal(def.legendary, true);
    assert.equal(def.relatedSkill, 'windblade');
    assert.equal(def.weaponTypes.join(','), 'wand1h', '風刃五個掛在單手魔杖');
    assert.equal(def.type, 'wind');
  });
  vacuum.forEach((k) => {
    const def = c.PASSIVE_POOL[k];
    assert.ok(def, k + ' 應在傳奇特效池');
    assert.equal(def.relatedSkill, 'vacuumslash');
    assert.equal(def.weaponTypes.join(','), 'axe2h', '真空斬五個掛在雙手斧');
    assert.equal(def.type, 'wind');
  });
});

test('第十一批的六個超神進化都在群組表上，且說明模板的參數鍵都存在', () => {
  const c = loadContext();
  assert.equal(c.sgUltDefs('windblade').map((u) => u.id).join(','),
    'stormMyriad,stormMountain,skyCollapse');
  assert.equal(c.sgUltDefs('vacuumslash').map((u) => u.id).join(','),
    'vacuumOmen,voidAnnihilation,spacetimeCollapse');
  ['windblade', 'vacuumslash'].forEach((gid) => {
    assert.equal(c.sgSlotCount(gid), 8, gid + ' 應該多出第 8 格');
    c.sgUltDefs(gid).forEach((opt) => {
      assert.ok(opt.name && opt.desc && opt.cost > 0 && opt.goldBase > 0);
      (opt.desc.match(/\{(\w+)\}/g) || []).forEach((tok) => {
        const key = tok.slice(1, -1);
        assert.ok(Object.prototype.hasOwnProperty.call(opt.fx, key),
          gid + '／' + opt.id + ' 的說明模板用了不存在的參數鍵 ' + key);
      });
    });
  });
});

/* ===========================================================================
   1) 風刃的五個傳奇特效
   =========================================================================== */

test('【裂風】：同一道風刃每命中 1 次，後續命中的總傷加成再 +5%（上限 +100%）', () => {
  const c = loadContext();
  stubVfx(c);
  const hits = stubHits(c);
  setLegendary(c, ['windbladeRend']);
  setLevels(c, 'windblade', [10, 0, 0, 0, 0, 0, 0]);   // 只有第 1 階：全場只有一道風刃
  equip(c, 'windblade');
  const p = playerEnt();
  const list = [];
  for (let i = 0; i < 4; i++) list.push(enemy(1e9, 20 + i * 40, 0, 'e' + i));
  c.castSkill2(p, list, 'windblade', 'mv-float');
  advance(c, p, list, 6);
  const totals = hits.map((h) => h.total);
  assert.ok(totals.length >= 4, '貫穿路徑上至少命中四次');
  assert.equal(totals[0], 0, '第一次命中還沒有累加');
  assert.equal(totals[1], 5, '第二次命中吃到一層');
  assert.equal(totals[2], 10);
  assert.equal(totals[3], 15);
  // 上限：純函式直接驗，不必真的湊出 20 次命中
  assert.equal(c.sgRampPct({ per: 5, max: 100, n: 19 }), 95);
  assert.equal(c.sgRampPct({ per: 5, max: 100, n: 40 }), 100, '加成夾在 +100%');
});

test('【裂風】：追擊型風刃（第 5 階之後的主要形態）也吃得到累加', () => {
  const c = loadContext();
  stubVfx(c);
  stubHits(c);
  setLegendary(c, ['windbladeRend']);
  setLevels(c, 'windblade', [10, 10, 10, 10, 10, 0, 0]);   // 到【追跡風刃】
  equip(c, 'windblade');
  const p = playerEnt();
  const list = [enemy(1e9, 20, 0, 'a'), enemy(1e9, 25, 5, 'b')];
  c.castSkill2(p, list, 'windblade', 'mv-float');
  const chasers = grounds(c, 'windblade', 'windblade');
  assert.ok(chasers.length > 0, '第 5 階之後小型風刃走的是追擊場域');
  chasers.forEach((f) => assert.ok(f.ramp, '每一道追擊風刃各自持有一個累加器'));
  advance(c, p, list, 3);
  assert.ok(chasers.some((f) => f.ramp.n > 0), '接觸到敵人之後累加器才會前進');
});

test('【增壓】：風刃體積 ×1.25、飛行速度 ×1.3（體積與【巨型風刃】相乘）', () => {
  function geom(keys) {
    const c = loadContext();
    setLegendary(c, keys);
    setLevels(c, 'windblade', [10, 10, 0, 0, 0, 0, 0]);
    equip(c, 'windblade');
    return c.sgWindbladeGeom(c.SKILLS2.windblade,
      c.skills2Levels('windblade'), c.sgLegend('windblade'));
  }
  const base = geom([]);
  const up = geom(['windbladePressure']);
  assert.ok(Math.abs(up.halfWidthPx - base.halfWidthPx * 1.25) < 1e-6, '判定半寬 ×1.25');
  assert.ok(Math.abs(up.bodyLenPx - base.bodyLenPx * 1.25) < 1e-6, '刃身長度同步放大');
  assert.ok(Math.abs(up.speedPx - base.speedPx * 1.3) < 1e-6, '飛行速度 ×1.3');
});

test('【風之痕】：小型風刃在另一側再一道，且小型風刃傷害 ×1.3', () => {
  function cast(keys) {
    const c = loadContext();
    const specs = stubVfx(c);
    const hits = stubHits(c);
    setLegendary(c, keys);
    setLevels(c, 'windblade', [10, 10, 10, 10, 0, 0, 0]);  // 到【亂披風】、還沒改為追擊
    equip(c, 'windblade');
    const p = playerEnt();
    const list = [enemy(1e9, 20, 0, 'a')];
    c.castSkill2(p, list, 'windblade', 'mv-float');
    advance(c, p, list, 6);
    return {
      smalls: specs.filter((s) => s.variant === 'wind-blade-small'),
      atks: hits.map((h) => h.atk)
    };
  }
  const base = cast([]);
  const trace = cast(['windbladeTrace']);
  assert.equal(base.smalls.length, 2, '【雙重風刃】的兩個方向各一道小型風刃');
  assert.equal(trace.smalls.length, 4, '另一側再各補一道');
  const baseSmall = Math.min.apply(null, base.atks);
  const traceSmall = Math.min.apply(null, trace.atks);
  assert.ok(Math.abs(traceSmall - baseSmall * 1.3) < 1e-6, '小型風刃傷害 ×1.3');
});

test('【風蝕】：風刃命中就塗上風蝕，併進 skill2VulnACfg 的同一個 totalDmgPct', () => {
  const c = loadContext();
  stubVfx(c);
  stubHits(c);
  setLegendary(c, ['windbladeErode']);
  setLevels(c, 'windblade', [10, 0, 0, 0, 0, 0, 0]);
  equip(c, 'windblade');
  const p = playerEnt();
  const e = enemy(1e9, 20, 0, 'a');
  c.castSkill2(p, [e], 'windblade', 'mv-float');
  advance(c, p, [e], 2);
  assert.ok(e.buffs.sgWindErode, '命中後身上帶著風蝕');
  assert.equal(e.buffs.sgWindErode.val, 25);
  assert.equal(c.skill2VulnACfg({}, e).totalDmgPct, 25, '受到的傷害提高走同一個加總入口');
  const clean = enemy(1e9, 20, 0, 'b');
  assert.equal(c.skill2VulnACfg({}, clean).totalDmgPct, undefined, '沒有風蝕就不加');
});

test('【斷空刃】：暴風真空刃每方向改寫至 3 道，且風刃傷害額外 +30%', () => {
  function cast(keys) {
    const c = loadContext();
    const specs = stubVfx(c);
    const hits = stubHits(c);
    setLegendary(c, keys);
    maxLevels(c, 'windblade');
    equip(c, 'windblade');
    const p = playerEnt();
    const list = [enemy(1e9, 20, 0, 'a')];
    c.castSkill2(p, list, 'windblade', 'mv-float');
    advance(c, p, list, 6);
    return {
      big: specs.filter((s) => s.variant === 'wind-blade').length,
      atk: Math.max.apply(null, hits.map((h) => h.atk))
    };
  }
  const base = cast([]);
  const cut = cast(['windbladeVoidCut']);
  assert.equal(base.big, 8, '表定：四個方向各連射 2 道');
  assert.equal(cut.big, 12, '改寫至每方向 3 道');
  assert.ok(cut.atk > base.atk, '風刃傷害額外 +30%');
});

/* ===========================================================================
   2) 風刃的三個超神進化
   =========================================================================== */

test('【暴風萬刃】：大型風刃改為全場追擊、每方向多 1 道，且風刃傷害 +50%', () => {
  function cast(withUlt) {
    const c = loadContext();
    const specs = stubVfx(c);
    const hits = stubHits(c);
    maxLevels(c, 'windblade');
    equip(c, 'windblade');
    if (withUlt) setUlt(c, 'windblade', 'stormMyriad', 1);
    const p = playerEnt();
    const list = [enemy(1e9, 20, 0, 'a')];
    c.castSkill2(p, list, 'windblade', 'mv-float');
    const geom = c.sgWindbladeGeom(c.SKILLS2.windblade, c.skills2Levels('windblade'), {});
    return { c, specs, hits, chasers: grounds(c, 'windblade', 'windblade'), geom, p, list };
  }
  const base = cast(false);
  const ult = cast(true);
  assert.equal(base.chasers.length, 8, '對照組只有小型風刃在追擊（四方向 × 2 道）');
  assert.equal(ult.chasers.length, 24, '每方向 3 道 × 四方向 × （大型＋小型）');
  const bigChasers = ult.chasers.filter((f) => f.radius === ult.geom.halfWidthPx);
  assert.equal(bigChasers.length, 12, '大型風刃改走追擊場域，體積仍是大型的判定半寬');
  bigChasers.forEach((f) => {
    assert.equal(f.chaseM, 60, '追擊半徑取超神自己的表定值');
    assert.ok(f.pulseDmg > 0, '第 6 階【狂風碎裂】的沿途脈衝要跟著換到這條路上');
    assert.equal(f.slowStatus, 'sgWindSlow', '緩速也一起帶過來');
  });
  assert.equal(ult.c.SKILL2_RT.projectiles.length, 0, '不再有直線飛行的大型風刃');
  // 傷害：本體 ×(1＋55%)（Lv.1 ＝ 50＋5×1），獨立乘區
  const lvs = base.c.skills2Levels('windblade');
  const baseBody = base.c.sgWindbladeBodyDamage(base.c.SKILLS2.windblade,
    base.c.getStats(), lvs, {});
  const ultBody = Math.max.apply(null, bigChasers.map((f) => f.dmgVal));
  assert.ok(Math.abs(ultBody - baseBody * 1.55) < 1e-6, '風刃傷害額外 +50%（獨立乘區）');
  assert.equal(ult.c.skills2ActsPassive('windblade'), false, '暴風萬刃不改變主動施放');
});

test('【嵐之山】：四方向各一道融合後的巨型風刃，且不再另外射出小型風刃', () => {
  function cast(withUlt) {
    const c = loadContext();
    const specs = stubVfx(c);
    const hits = stubHits(c);
    maxLevels(c, 'windblade');
    equip(c, 'windblade');
    if (withUlt) setUlt(c, 'windblade', 'stormMountain', 1);
    const p = playerEnt();
    const list = [enemy(1e9, 20, 0, 'a')];
    c.castSkill2(p, list, 'windblade', 'mv-float');
    advance(c, p, list, 6);
    return { specs, hits };
  }
  const base = cast(false);
  const ult = cast(true);
  const bigBase = base.specs.filter((s) => s.variant === 'wind-blade');
  const bigUlt = ult.specs.filter((s) => s.variant === 'wind-blade');
  assert.equal(bigUlt.length, 4, '四個方向各 1 道');
  assert.equal(ult.specs.filter((s) => s.variant === 'wind-blade-small').length, 0,
    '小型風刃已被融合進巨型風刃');
  assert.ok(bigUlt[0].bodyLength > bigBase[0].bodyLength, '巨型風刃的刃身更長');
  /* 融合傷害＝（大型 ＋ 小型×側邊數）× 每方向道數 × 110%（Lv.1）。
     對照組每一道大型風刃的傷害就是「大型」那一份，因此比值必定大於連射道數。 */
  const baseBig = Math.max.apply(null, base.hits.map((h) => h.atk));
  const ultBig = Math.max.apply(null, ult.hits.map((h) => h.atk));
  const smallRatio = (30 + 3 * 10) / 100;                 // 【亂披風】Lv.10 的小型風刃佔比
  assert.ok(Math.abs(ultBig - baseBig * (1 + smallRatio) * 2 * 1.1) < 1e-6,
    '融合的是同一個方向那一疊（2 道大型＋2 道小型）再乘上 110%');
});

test('【天穹崩裂】：風刃退出主動輪替，改為受擊時機率朝攻擊者射出一道', () => {
  const c = loadContext();
  stubVfx(c);
  const hits = stubHits(c);
  maxLevels(c, 'windblade');
  equip(c, 'windblade');
  setUlt(c, 'windblade', 'skyCollapse', 1);
  assert.equal(c.skills2ActsPassive('windblade'), true, '不再進入主動施放輪替');
  const p = playerEnt();
  const m = enemy(1e9, 20, 0, 'atk');
  c.FIELD = { player: p, enemies: [m] };
  c.chance = () => false;
  c.skills2OnPlayerDamaged(m, p, 100, false, { miss: false }, 'mv-float');
  assert.equal(c.SKILL2_RT.projectiles.length, 0, '機率沒中就不射');
  c.chance = () => true;
  c.skills2OnPlayerDamaged(m, p, 100, false, { miss: false }, 'mv-float');
  assert.equal(c.SKILL2_RT.projectiles.length, 1, '機率成立射出一道風刃');
  // 傷害＝風刃本體 ×（1＋55%）（Lv.1 ＝ 50＋5×1）
  const lvs = c.skills2Levels('windblade');
  const body = c.sgWindbladeBodyDamage(c.SKILLS2.windblade, c.getStats(), lvs, {});
  assert.ok(Math.abs(c.SKILL2_RT.projectiles[0].dmgVal - body * 1.55) < 1e-6,
    '這一道的傷害額外 +50%');
  // 沒裝配在技能列就不生效（與其他「主動型被動」同一條代價）
  c.G.player.loadout = [];
  c.SKILL2_RT.projectiles.length = 0;
  c.skills2OnPlayerDamaged(m, p, 100, false, { miss: false }, 'mv-float');
  assert.equal(c.SKILL2_RT.projectiles.length, 0);
});

/* ===========================================================================
   3) 真空斬的五個傳奇特效
   =========================================================================== */

function castVacuum(keys, opts) {
  const c = loadContext();
  const specs = stubVfx(c);
  const hits = stubHits(c);
  setLegendary(c, keys, opts && opts.mults);
  c.chance = () => ((opts && opts.chance) || false);
  maxLevels(c, 'vacuumslash');
  equip(c, 'vacuumslash');
  if (opts && opts.ult) setUlt(c, 'vacuumslash', opts.ult, opts.ultLv || 1);
  const p = playerEnt();
  const list = [enemy(1e9, 20, 0, 'a'), enemy(1e9, 25, 5, 'b')];
  c.castSkill2(p, list, 'vacuumslash', 'mv-float');
  return { c, specs, hits, p, list };
}

test('【共振】：真空爆震每個目標再多結算 1 次傷害', () => {
  const base = castVacuum([]);
  const res = castVacuum(['vacuumResonance']);
  // 表定：每個目標 3 次（本體 1 ＋ 爆震 2）；共振後 4 次
  assert.equal(res.hits.length / base.hits.length, 4 / 3, '每個目標各多一次');
});

test('【裂痕】：真空斬的風切層數上限 +3（狀態表的上限只是天花板）', () => {
  const base = castVacuum([]);
  const rift = castVacuum(['vacuumRift']);
  assert.equal(base.c.sgWindRendMaxStacks(), 3, '表定：【無限風切】的 3 層');
  assert.equal(rift.c.sgWindRendMaxStacks(), 6, '再 +3 層');
  assert.equal(rift.c.sgStatusNum('sgWindRend', 'maxStacks', 0), 6, '狀態表得容得下');
  /* 沒學【無限風切】時上限是 1＋3（不以該階已學為前提，比照【電擊】），
     但多出來的層數在那個情況下不會變成傷害——每層的額外每跳量由該階提供。 */
  const c = loadContext();
  setLegendary(c, ['vacuumRift']);
  assert.equal(c.sgWindRendMaxStacks(), 4);
  const spec = c.sgWindRendSpec(c.SKILLS2.vacuumslash, c.skills2Levels('vacuumslash'), 2, 1000);
  assert.equal(spec, null, '連【風切】那一階都沒學時根本不塗風切');
});

test('【真空風刃】：每次施放額外射出 2 道小型風刃（傷害記在真空斬名下）', () => {
  const base = castVacuum([]);
  const blade = castVacuum(['vacuumWindBlade']);
  assert.equal(base.specs.filter((s) => s.variant === 'wind-blade-small').length, 0);
  const smalls = blade.specs.filter((s) => s.variant === 'wind-blade-small');
  assert.equal(smalls.length, 2);
  assert.ok(blade.c.SKILL2_RT.projectiles.every((pr) => pr.gid === 'vacuumslash'),
    '這幾道刃的來源是真空斬，傷害紀錄不歸風刃');
});

test('【空間澎脹】：真空斬的體積 +25%（判定與特效同一個來源）', () => {
  const base = castVacuum([]);
  const big = castVacuum(['vacuumExpand']);
  const b = base.specs.filter((s) => s.fxKind === 'slash')[0];
  const g = big.specs.filter((s) => s.fxKind === 'slash')[0];
  assert.ok(Math.abs(g.lineLength - b.lineLength * 1.25) < 1e-6, '半徑 ×1.25');
  assert.ok(Math.abs(g.area.r - b.area.r * 1.25) < 1e-6, '特效範圍同步放大');
});

test('【虛空漲落】：虛空斬的持續時間 +3 秒', () => {
  const base = castVacuum([]);
  const flux = castVacuum(['vacuumFlux']);
  assert.equal(base.c.SKILL2_RT.orbits[0].until - base.c.GT, 6, '表定 6 秒');
  assert.equal(flux.c.SKILL2_RT.orbits[0].until - flux.c.GT, 9, '+3 秒');
});

test('雙手補償：真空斬的保護鍵不被 ×2，體積百分比要被 ×2', () => {
  const mults = { vacuumRift: 2, vacuumFlux: 2, vacuumExpand: 2, vacuumResonance: 2, vacuumWindBlade: 2 };
  const base = castVacuum([]);
  const doubled = castVacuum(['vacuumRift', 'vacuumFlux', 'vacuumExpand', 'vacuumResonance', 'vacuumWindBlade'],
    { mults: mults });
  assert.equal(doubled.c.sgWindRendMaxStacks(), 6, 'maxStacks 是保護鍵：仍然只 +3');
  assert.equal(doubled.c.SKILL2_RT.orbits[0].until - doubled.c.GT, 9, 'sec 是保護鍵：仍然只 +3 秒');
  assert.equal(doubled.specs.filter((s) => s.variant === 'wind-blade-small').length, 2,
    'count 是保護鍵：仍然只有 2 道小型風刃');
  assert.equal(doubled.hits.length / base.hits.length, 4 / 3, 'hits 是保護鍵：仍然只多 1 次');
  const b = base.specs.filter((s) => s.fxKind === 'slash')[0];
  const d = doubled.specs.filter((s) => s.fxKind === 'slash')[0];
  assert.ok(Math.abs(d.lineLength - b.lineLength * 1.5) < 1e-6, '體積百分比吃雙手補償（25% → 50%）');
});

/* ===========================================================================
   4) 真空斬的三個超神進化
   =========================================================================== */

test('【萬象風劫】：命中時機率在該處留下一道會長大的靜止真空斬（接觸判定）', () => {
  const miss = castVacuum([], { ult: 'vacuumOmen', chance: false });
  assert.equal(grounds(miss.c, 'vacuumslash', 'vacuumfield').length, 0, '機率沒中就不留');
  const hit = castVacuum([], { ult: 'vacuumOmen', chance: true });
  const fields = grounds(hit.c, 'vacuumslash', 'vacuumfield');
  assert.ok(fields.length > 0, '機率成立就在命中處留下');
  const f = fields[0];
  assert.equal(f.contact, true, '接觸判定：掃過去的敵人各挨一次，不會每一拍全額重打');
  assert.equal(f.growTo, 2, '半徑隨時間擴大為 2 倍');
  assert.equal(f.growSec, 3, '成長曲線走完整段持續時間');
  const r0 = f.baseRadius;
  advance(hit.c, hit.p, hit.list, 3);
  assert.ok(f.radius >= r0 * 1.9, '結束前半徑已經長到接近 2 倍');
});

test('【虛空滅界】：每 2 秒自動斬出 1 道虛空斬，且虛空斬傷害額外 +100%', () => {
  const c = loadContext();
  stubVfx(c);
  stubHits(c);
  maxLevels(c, 'vacuumslash');
  equip(c, 'vacuumslash');
  setUlt(c, 'vacuumslash', 'voidAnnihilation', 1);
  const p = playerEnt();
  const list = [enemy(1e9, 20, 0, 'a')];
  advance(c, p, list, 5);
  assert.equal(c.SKILL2_RT.orbits.length, 2, '第 2 秒與第 4 秒各一道');
  // 傷害：Lv.1 ＝ 100＋10×1 ＝ 110% 的額外加成
  const plain = loadContext();
  stubVfx(plain); stubHits(plain);
  maxLevels(plain, 'vacuumslash');
  equip(plain, 'vacuumslash');
  plain.castSkill2(playerEnt(), [enemy(1e9, 20, 0, 'a')], 'vacuumslash', 'mv-float');
  const baseDmg = plain.SKILL2_RT.orbits[0].dmgVal;
  assert.ok(Math.abs(c.SKILL2_RT.orbits[0].dmgVal - baseDmg * 2.1) < 1e-6);
  // 沒裝配在技能列就不生效
  const off = loadContext();
  stubVfx(off); stubHits(off);
  maxLevels(off, 'vacuumslash');
  setUlt(off, 'vacuumslash', 'voidAnnihilation', 1);
  const op = playerEnt();
  advance(off, op, [enemy(1e9, 20, 0, 'a')], 5);
  assert.equal(off.SKILL2_RT.orbits.length, 0);
});

test('【時空崩解】：虛空斬不再外擴，改為固定在周圍 12 米，且持續時間 +50%', () => {
  const base = castVacuum([]);
  const ult = castVacuum([], { ult: 'spacetimeCollapse' });
  const b = base.c.SKILL2_RT.orbits[0];
  const u = ult.c.SKILL2_RT.orbits[0];
  assert.ok(b.growPxPerSec > 0, '表定：每秒往外擴大');
  assert.equal(u.growPxPerSec, 0, '改為不擴展');
  assert.equal(u.rings[0].r, 12 * M, '固定在 12 米');
  assert.equal(u.until - ult.c.GT, 6 * 1.55, '持續時間 +50%（Lv.1 ＝ 50＋5×1）');
  assert.equal(ult.c.SKILL2_RT.orbits.length, 4, '道數仍由第 7 階決定');
});
