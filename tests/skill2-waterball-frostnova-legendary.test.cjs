/* 傳奇進化第十批（2026-08-28）：水流彈（法器）／冰霜新星（雙手杖）
   設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤的水流彈、冰霜新星兩段。
   守住的事：
     1. 水流彈五個傳奇：水流連彈（顆數）、冰霜擴散（爆散改為冰霜新星）、
        寒霜湧動（寒霜可疊過凍結門檻＋額外層增傷）、激流（彈射次數與速度）、
        水龍勢（命中機率捲起水龍捲）
     2. 水流彈三個超神：水牢天瀑（減益＋擋下圈外遠程）、怒海狂濤（門檻觸發巨大水龍捲）、
        海淵葬界（永久領域逐拍塗寒霜＋領域內額外疊層）
     3. 冰霜新星五個傳奇：碎冰（範圍）、雙冰爆＋寒潮（機率相加的再爆發）、
        寒冰衝擊（擊殺凍結敵人昇起冰錐）、凜冬寒霜（暴風雪塗寒霜＋寒霜傷害共用層）
     4. 冰霜新星三個超神：無限新星（免費自動施放＋傷害乘區）、極致之冰（冰晶共鳴）、
        冰皇領域（暴風雪放大＋逐秒昇起冰錐）

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
/* 一擊必殺版：驗「擊殺當下」的效果（寒冰衝擊的冰錐）用。 */
function stubLethalHits(c) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ ent: defender, atk: aCfg.atk });
    defender.hp = 0;
    return { dmg: 1, crit: false, miss: false, blocked: false, killed: true };
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
function frostStacks(ent) {
  const b = ent.buffs && ent.buffs.sgFrost;
  return b ? (b.stacks || 0) : 0;
}
function frostDot(c, ent) {
  return (ent.dots || []).filter((d) => d.sid === 'sgFrostBite' && d.until > c.GT)[0] || null;
}
function grounds(c, gid, kind) {
  return c.SKILL2_RT.grounds.filter((f) => f.gid === gid && f.kind === kind);
}

/* ===========================================================================
   1) 水流彈的五個傳奇特效
   =========================================================================== */

test('【水流連彈】：水流彈的發射顆數 +2', () => {
  function shots(keys) {
    const c = loadContext();
    const specs = stubVfx(c);
    stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;               // 不足 1 顆的擲骰一律失敗，顆數才數得準
    maxLevels(c, 'waterball');
    equip(c, 'waterball');
    c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'waterball', 'mv-float');
    return specs.filter((s) => s.fxKind === 'projectile' && s.variant === 'waterball').length;
  }
  const base = shots([]);
  assert.ok(base > 0);
  assert.equal(shots(['waterballVolley']), base + 2, '顆數 +2（與【三重流水】相加）');
});

test('【冰霜擴散】：爆散改為冰霜新星（範圍 +30%、層數改用新星第 1 階、畫法換成新星）', () => {
  function burst(keys) {
    const c = loadContext();
    const specs = stubVfx(c);
    stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    setLevels(c, 'waterball', [10, 10, 10, 10, 0, 0, 0]); // 只到【寒流爆散】：一顆、一次爆散
    equip(c, 'waterball');
    const e = enemy(1e9, 40, 0, 'a');
    c.castSkill2(playerEnt(), [e], 'waterball', 'mv-float');
    const b = specs.filter((s) => s.fxKind === 'burst')[0];
    return { variant: b.variant, r: b.area.r, stacks: frostStacks(e) };
  }
  const base = burst([]);
  const nova = burst(['waterballNovaBurst']);
  assert.equal(base.variant, 'water-burst');
  assert.equal(base.r, 8 * M, '表定爆散半徑 8 米');
  assert.equal(base.stacks, 1, '表定塗 1 層寒霜');
  assert.equal(nova.variant, 'frost-nova', '畫法換成冰霜新星的既有變體');
  assert.equal(Math.round(nova.r), Math.round(8 * M * 1.3), '爆散半徑 +30%');
  assert.equal(nova.stacks, 2, '層數改用冰霜新星第 1 階的層數');
});

test('【寒霜湧動】：額外上限層數也納入寒霜總層數增傷', () => {
  function stack(keys) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    setLevels(c, 'waterball', [10, 10, 10, 0, 0, 0, 0]); // 單體：一次施放剛好塗 1 層
    equip(c, 'waterball');
    const p = playerEnt();
    const e = enemy(1e9, 40, 0, 'a');
    for (let i = 0; i < 12; i++) c.castSkill2(p, [e], 'waterball', 'mv-float');
    const dot = frostDot(c, e);
    return { stacks: frostStacks(e), dps: dot ? dot.dps : 0 };
  }
  const base = stack([]);
  const over = stack(['waterballFrostSurge']);
  assert.equal(base.stacks, 5, '表定疊到 5 層（＝凍結門檻）為止');
  assert.equal(over.stacks, 10, '額外再疊 5 層');
  // 水流彈 Lv.10：5 層＝450%，10 層＝700%，比例 700／450＝1.56。
  assert.equal(Math.round(over.dps / base.dps * 100) / 100, 1.56, '額外層數依寒霜總層數納入公式');
});

test('【海淵葬界】：Lv.10 的 20 層額外上限會進入寒霜凍傷公式', () => {
  const c = loadContext();
  maxLevels(c, 'waterball');
  equip(c, 'waterball');
  setUlt(c, 'waterball', 'abyssBurial', 10);
  const e = enemy(1e9);
  const spec = c.sgFrostSpec(c.SKILLS2.waterball, c.G.player.skills2.levels.waterball, 2, 2000);
  c.sgApplyFrost(e, spec, 25);
  const dot = frostDot(c, e);
  assert.equal(frostStacks(e), 25, '5 層基礎上限＋海淵 Lv.10 額外 20 層');
  assert.ok(dot, '寒霜凍傷存在');
  assert.ok(Math.abs(dot.dps * 0.5 - 2000 * 1450 / 100) < 1e-9,
    '每跳＝B ×（50×25＋20×10）%');
});

test('寒霜總層數跨技能來源共用', () => {
  const c = loadContext();
  setLevels(c, 'frostnova', [1, 0, 0, 0, 0, 0, 0]);
  maxLevels(c, 'waterball');
  equip(c, 'waterball');
  const e = enemy(1e9);
  const novaSpec = c.sgFrostSpec(c.SKILLS2.frostnova, c.G.player.skills2.levels.frostnova, 0, 775);
  const waterSpec = c.sgFrostSpec(c.SKILLS2.waterball, c.G.player.skills2.levels.waterball, 2, 2000);
  c.sgApplyFrost(e, novaSpec, 2);
  c.sgApplyFrost(e, waterSpec, 1);
  const dot = frostDot(c, e);
  assert.equal(frostStacks(e), 3, '冰霜新星 2 層＋水流彈 1 層');
  assert.ok(Math.abs(dot.dps * 0.5 - 2000 * 350 / 100) < 1e-9,
    '水流彈凍傷使用跨技能共用的 3 層');
});

test('【激流】：彈射次數 +2，且每一段彈射的飛行時間 ÷1.3', () => {
  function run(keys) {
    const c = loadContext();
    const specs = stubVfx(c);
    stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    c.Math.random = () => 0;               // 彈射目標固定，兩組才比得出速度差
    setLevels(c, 'waterball', [10, 10, 10, 10, 0, 0, 0]);
    equip(c, 'waterball');
    const es = [];
    for (let i = 0; i < 10; i++) es.push(enemy(1e9, 200 + i * 30, 0, 'e' + i));
    c.castSkill2(playerEnt(), es, 'waterball', 'mv-float');
    const hops = specs.filter((s) => s.variant === 'water-bounce');
    return { hops: hops.length, travel: hops[0].travelMs[1] };
  }
  const base = run([]);
  const fast = run(['waterballTorrent']);
  assert.equal(fast.hops, base.hops + 2, '彈射次數 +2');
  assert.equal(fast.travel, Math.round(base.travel / 1.3), '彈射速度 +30%');
});

test('【水龍勢】：命中時機率在目標處捲起一道水龍捲（段數與傷害由特效自己給）', () => {
  const c = loadContext();
  stubVfx(c); stubHits(c);
  setLegendary(c, ['waterballTornado']);
  c.chance = (pct) => pct === 10;          // 只讓水龍勢的擲骰過關
  setLevels(c, 'waterball', [10, 10, 10, 0, 0, 0, 0]); // 第 7 階關掉：場上只會有特效捲出來的那些
  equip(c, 'waterball');
  c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'waterball', 'mv-float');
  const list = grounds(c, 'waterball', 'tornado');
  assert.equal(list.length, 1, '一次命中捲起一道');
  assert.equal(list[0].hits, 4, '4 段');
  assert.equal(list[0].radius, 5 * M, '半徑沿用【水龍捲】的表定值');
  assert.equal(list[0].dmgVal, c.BASE_STATS.matk, '每段 100% 寒冰傷害（群組基礎值）');
});

test('沒裝【水龍勢】就不會捲出水龍捲', () => {
  const c = loadContext();
  stubVfx(c); stubHits(c);
  c.chance = () => true;
  setLevels(c, 'waterball', [10, 10, 10, 0, 0, 0, 0]);
  equip(c, 'waterball');
  c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'waterball', 'mv-float');
  assert.equal(grounds(c, 'waterball', 'tornado').length, 0);
});

/* ===========================================================================
   2) 水流彈的三個超神進化
   =========================================================================== */

test('【水牢天瀑】：圈內敵人攻擊力下降並提高受到的傷害，圈外的遠程攻擊被擋下', () => {
  const c = loadContext();
  stubVfx(c); stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'waterball');
  equip(c, 'waterball');
  setUlt(c, 'waterball', 'waterPrisonFall', 1);
  const p = playerEnt();
  const inside = enemy(1e9, 100, 0, 'in');
  const outside = enemy(1e9, 300, 0, 'out');
  c.castSkill2(p, [inside, outside], 'waterball', 'mv-float');
  assert.equal(c.SKILL2_RT.waterPrison.radius, 20 * M, '水牢半徑 20 米');
  advance(c, p, [inside, outside], 0.6);
  assert.equal(inside.buffs.atkDown.val, 50, '圈內攻擊力 -50%');
  assert.equal(inside.buffs.sgWaterPrison.val, 110, 'Lv.1 ＝ 100 + 10');
  assert.equal(outside.buffs.sgWaterPrison, undefined, '圈外不算被關進去');
  assert.equal(c.skill2WaterPrisonBlocks(outside), true, '圈外的遠程攻擊被牢牆擋下');
  assert.equal(c.skill2WaterPrisonBlocks(inside), false, '已經在牢裡的敵人照樣能打');
});

test('【水牢天瀑】到期後遠程封鎖與減益一起解除', () => {
  const c = loadContext();
  stubVfx(c); stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'waterball');
  equip(c, 'waterball');
  setUlt(c, 'waterball', 'waterPrisonFall', 1);
  const p = playerEnt();
  const out = enemy(1e9, 300, 0, 'out');
  c.castSkill2(p, [out], 'waterball', 'mv-float');
  advance(c, p, [out], 7);
  assert.equal(c.SKILL2_RT.waterPrison, null, '到期回收');
  assert.equal(c.skill2WaterPrisonBlocks(out), false);
});

test('【怒海狂濤】：水龍捲達門檻時在中央生成巨大水龍捲，且不會每一拍重複生成', () => {
  const c = loadContext();
  stubVfx(c); stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'waterball');
  equip(c, 'waterball');
  setUlt(c, 'waterball', 'ragingTide', 1);
  const p = playerEnt();
  const es = [enemy(1e9, 100, 0, 'a')];
  for (let i = 0; i < 10; i++) {
    c.sgSpawnGround(p, c.BASE_STATS, 'waterball', {
      kind: 'tornado', tgt: null, floatSel: 'mv-float', from: { x: 100 + i, y: 0 },
      radius: 5 * M, dmgVal: 1, hits: 200, gap: 5
    });
  }
  advance(c, p, es, 0.2);
  const giant = grounds(c, 'waterball', 'tidetornado');
  assert.equal(giant.length, 1, '達門檻生成 1 道');
  assert.equal(giant[0].radius, 20 * M, '範圍 20 米');
  assert.equal(giant[0].hits, 20, '20 段');
  advance(c, p, es, 2);
  assert.equal(grounds(c, 'waterball', 'tidetornado').length, 1, '維持在門檻以上不會再生成');
});

test('【海淵葬界】：永久領域逐拍塗寒霜，且領域內可額外再疊 10 層', () => {
  function run(withUlt) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    c.chance = () => false;
    maxLevels(c, 'waterball');
    equip(c, 'waterball');
    if (withUlt) setUlt(c, 'waterball', 'abyssBurial', 1);
    const p = playerEnt();
    const e = enemy(1e9, 100, 0, 'a');
    advance(c, p, [e], 8);
    return frostStacks(e);
  }
  assert.equal(run(false), 0, '沒選超神就不會有領域');
  // Lv.1 ＝ 10 + 1 ＝ 11 層額外上限 → 基礎 5 層 ＋ 11 ＝ 16
  assert.equal(run(true), 16, '領域每一拍塗寒霜，且可疊過凍結門檻');
});

/* ===========================================================================
   3) 冰霜新星的五個傳奇特效
   =========================================================================== */

test('【碎冰】：冰霜新星的攻擊範圍 +30%', () => {
  function radius(keys) {
    const c = loadContext();
    const specs = stubVfx(c);
    stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    setLevels(c, 'frostnova', [10, 10, 0, 0, 0, 0, 0]);
    equip(c, 'frostnova');
    c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'frostnova', 'mv-float');
    return specs.filter((s) => s.variant === 'frost-nova')[0].area.r;
  }
  const base = radius([]);
  assert.ok(base > 0);
  assert.equal(Math.round(radius(['frostnovaShatter'])), Math.round(base * 1.3));
});

test('【雙冰爆】【寒潮】：兩個特效的機率相加，並在目標處再爆一次新星', () => {
  function run(keys) {
    const c = loadContext();
    const specs = stubVfx(c);
    stubHits(c);
    setLegendary(c, keys);
    const rolls = [];
    c.chance = (pct) => { rolls.push(pct); return true; };
    setLevels(c, 'frostnova', [10, 10, 0, 0, 0, 0, 0]);
    equip(c, 'frostnova');
    const p = playerEnt();
    const e = enemy(1e9, 40, 0, 'a');
    c.castSkill2(p, [e], 'frostnova', 'mv-float');   // 第 1 次施放先塗上寒霜
    rolls.length = 0;
    specs.length = 0;
    c.castSkill2(p, [e], 'frostnova', 'mv-float');   // 第 2 次才會通過「命中前已帶寒霜」
    const echo = specs.filter((s) => s.variant === 'frost-nova' && s.area && s.area.x === 40);
    return { rolls, echo: echo.length };
  }
  const twin = run(['frostnovaTwinBurst']);
  assert.ok(twin.rolls.indexOf(35) >= 0, '單裝【雙冰爆】＝35%');
  assert.ok(twin.echo > 0, '再爆發的圓心是被命中的敵人，不是我方');
  const both = run(['frostnovaTwinBurst', 'frostnovaColdTide']);
  assert.ok(both.rolls.indexOf(55) >= 0, '兩個一起裝＝機率相加');
  const none = run([]);
  assert.equal(none.echo, 0, '沒裝就不會有再爆發');
});

test('【寒冰衝擊】：新星殺死凍結中的敵人時昇起冰錐（沒凍結就不昇）', () => {
  function run(frozen) {
    const c = loadContext();
    stubVfx(c); stubLethalHits(c);
    setLegendary(c, ['frostnovaIceSpike']);
    c.chance = () => false;
    setLevels(c, 'frostnova', [10, 10, 0, 0, 0, 0, 0]);
    equip(c, 'frostnova');
    const e = enemy(1e9, 40, 0, 'a');
    if (frozen) e.buffs.sgFrozen = { val: 0, until: 999, dur: 3, sid: 'sgFrozen', stacks: 1 };
    c.castSkill2(playerEnt(), [e], 'frostnova', 'mv-float');
    return grounds(c, 'frostnova', 'icespike');
  }
  const spikes = run(true);
  assert.equal(spikes.length, 1, '凍結中的敵人被殺死＝昇起 1 根冰錐');
  assert.equal(spikes[0].hits, 4, '4 段');
  assert.equal(spikes[0].radius, 8 * M, '周圍 8 米');
  assert.equal(run(false).length, 0, '沒凍結就不昇');
});

test('【凜冬寒霜】：暴風雪逐拍塗寒霜，且寒霜狀態傷害走共用層 +30%', () => {
  function run(keys) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    maxLevels(c, 'frostnova');
    equip(c, 'frostnova');
    const p = playerEnt();
    const e = enemy(1e9, 40, 0, 'a');
    c.castSkill2(p, [e], 'frostnova', 'mv-float');
    const blizzard = grounds(c, 'frostnova', 'blizzard')[0];
    return { frostSpec: blizzard.frostSpec, factor: c.skill2FrostDmgFactor() };
  }
  const base = run([]);
  const winter = run(['frostnovaWinterFrost']);
  assert.equal(base.frostSpec, null, '表定的暴風雪不塗寒霜');
  assert.ok(winter.frostSpec && winter.frostSpec.dps > 0, '暴風雪每一拍順便塗寒霜');
  assert.equal(Math.round(winter.factor / base.factor * 100), 130, '寒霜狀態傷害 +30%（共用層）');
});

/* ===========================================================================
   4) 冰霜新星的三個超神進化
   =========================================================================== */

test('【無限新星】：每 1 秒自動施放 1 次，不扣法力、不進冷卻，且新星傷害 +50%', () => {
  const c = loadContext();
  stubVfx(c);
  const calls = stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'frostnova');
  equip(c, 'frostnova');
  setUlt(c, 'frostnova', 'infiniteNova', 1);
  const p = playerEnt();
  const es = [enemy(1e9, 40, 0, 'a')];
  const mp0 = p.mp;
  advance(c, p, es, 2.6);
  assert.ok(calls.length >= 2, '2.6 秒內自動施放 2 次');
  assert.equal(p.mp, mp0, '自動施放不扣法力');
  assert.equal(p.skillCds[c.SG_PREFIX + 'frostnova'], undefined, '自動施放不進冷卻');

  const plain = loadContext();
  stubVfx(plain);
  const plainCalls = stubHits(plain);
  plain.chance = () => false;
  maxLevels(plain, 'frostnova');
  equip(plain, 'frostnova');
  plain.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'frostnova', 'mv-float');
  // Lv.1 ＝ 50 + 5×1 ＝ 55%
  assert.equal(Math.round(calls[0].atk / plainCalls[0].atk * 100), 155, '新星傷害 ×1.55');
});

test('【極致之冰】：凍結中的敵人互相共鳴造成傷害；只有一個凍結時不共鳴', () => {
  function run(frozenCount) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    c.chance = () => false;
    maxLevels(c, 'frostnova');
    equip(c, 'frostnova');
    setUlt(c, 'frostnova', 'crystalResonance', 1);
    const p = playerEnt();
    const es = [enemy(1e9, 100, 0, 'a'), enemy(1e9, 130, 0, 'b')];
    for (let i = 0; i < frozenCount; i++) {
      es[i].buffs.sgFrozen = { val: 0, until: 999, dur: 3, sid: 'sgFrozen', stacks: 1 };
    }
    advance(c, p, es, 1);
    return calls.length;
  }
  assert.equal(run(1), 0, '只有一個凍結＝沒有共鳴對象');
  assert.ok(run(2) >= 2, '兩個都凍結＝每 0.4 秒互相共鳴一次');
});

test('【冰皇領域】：暴風雪範圍 +50%，且每 1 秒在範圍內昇起 2～8 根冰錐', () => {
  function side(withUlt) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    c.chance = () => false;
    maxLevels(c, 'frostnova');
    equip(c, 'frostnova');
    if (withUlt) setUlt(c, 'frostnova', 'iceKingDomain', 1);
    const p = playerEnt();
    const es = [enemy(1e9, 40, 0, 'a')];
    c.castSkill2(p, es, 'frostnova', 'mv-float');
    const blizzard = grounds(c, 'frostnova', 'blizzard')[0];
    advance(c, p, es, 1.2);
    return { len: blizzard.length, spikes: grounds(c, 'frostnova', 'icespike').length };
  }
  const base = side(false);
  const ult = side(true);
  assert.equal(base.spikes, 0, '沒選超神就不會昇起冰錐');
  assert.equal(Math.round(ult.len), Math.round(base.len * 1.5), '暴風雪邊長 +50%');
  assert.ok(ult.spikes >= 2 && ult.spikes <= 8, '每一拍昇起 2～8 根：' + ult.spikes);
});

/* ===========================================================================
   5) 資料形狀（部位、關聯技能、超神選項）
   =========================================================================== */

test('十個傳奇特效落在正確的部位與關聯技能，且都帶得動執行期參數鍵', () => {
  const c = loadContext();
  const expect = {
    waterballVolley: ['focus', 'waterball', 'waterballShotAdd'],
    waterballNovaBurst: ['focus', 'waterball', 'waterballBurstNova'],
    waterballFrostSurge: ['focus', 'waterball', 'waterballFrostOver'],
    waterballTorrent: ['focus', 'waterball', 'waterballBounceAdd'],
    waterballTornado: ['focus', 'waterball', 'waterballTornadoProc'],
    frostnovaShatter: ['staff2h', 'frostnova', 'frostnovaScalePct'],
    frostnovaTwinBurst: ['staff2h', 'frostnova', 'frostnovaTwinBurst'],
    frostnovaIceSpike: ['staff2h', 'frostnova', 'frostnovaKillSpike'],
    frostnovaColdTide: ['staff2h', 'frostnova', 'frostnovaColdTide'],
    frostnovaWinterFrost: ['staff2h', 'frostnova', 'frostnovaBlizzardFrost']
  };
  Object.keys(expect).forEach((key) => {
    const def = c.PASSIVE_POOL[key];
    assert.ok(def, key + ' 應在傳奇特效池裡');
    assert.equal(def.legendary, true);
    assert.equal(def.type, 'ice');
    // vm 內建立的陣列跨 realm，deepStrictEqual 會因原型不同而失敗——比字串即可
    assert.equal(def.weaponTypes.join(','), expect[key][0]);
    assert.equal(def.relatedSkill, expect[key][1]);
    assert.ok(Object.prototype.hasOwnProperty.call(def.fx, expect[key][2]), key + ' 的 fx 缺少 ' + expect[key][2]);
  });
});

test('兩個群組各三個超神進化，id 與名稱都對得上設計文檔', () => {
  const c = loadContext();
  assert.equal(c.sgUltDefs('waterball').map((u) => u.id).join(','),
    'waterPrisonFall,ragingTide,abyssBurial');
  assert.equal(c.sgUltDefs('waterball').map((u) => u.name).join(','),
    '水牢天瀑,怒海狂濤,海淵葬界');
  assert.equal(c.sgUltDefs('frostnova').map((u) => u.id).join(','),
    'infiniteNova,crystalResonance,iceKingDomain');
  assert.equal(c.sgUltDefs('frostnova').map((u) => u.name).join(','),
    '無限新星,極致之冰,冰皇領域');
});

test('參數表往返：新增的十個傳奇特效與六個超神進化都落在 CSV 上', () => {
  const affix = fs.readFileSync(path.join(root, 'config/CSV/Equipment_Affix.csv'), 'utf8');
  ['waterballVolley', 'waterballNovaBurst', 'waterballFrostSurge', 'waterballTorrent', 'waterballTornado',
    'frostnovaShatter', 'frostnovaTwinBurst', 'frostnovaIceSpike', 'frostnovaColdTide', 'frostnovaWinterFrost']
    .forEach((key) => assert.ok(affix.indexOf(key) >= 0, 'Equipment_Affix.csv 缺少 ' + key));
  const skills2 = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8');
  ['waterPrisonFall', 'ragingTide', 'abyssBurial', 'infiniteNova', 'crystalResonance', 'iceKingDomain']
    .forEach((id) => assert.ok(skills2.indexOf(id) >= 0, 'Skills2.csv 缺少 ' + id));
  const status = fs.readFileSync(path.join(root, 'config/CSV/Status.csv'), 'utf8');
  assert.ok(status.indexOf('sgWaterPrison') >= 0, 'Status.csv 缺少 sgWaterPrison');
});
