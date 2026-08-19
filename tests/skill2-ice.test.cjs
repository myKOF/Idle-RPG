/* 新版主動技能第七批：冰系三群組（2026-08-17，js/skills2.js）
   守住設計文檔「技能」頁籤〈魔法〉區塊新增的三個群組與其註記：
     寒冰箭   icearrow   ─ 扇形單體 → 貫穿 → 追蹤，三形態共用同一支命中結算
     水流彈   waterball  ─ 拋物線水彈；爆散改為範圍＋彈射；水龍捲為追加的四道地板場域
     冰霜新星 frostnova  ─ 自身範圍爆發；暴風雪為追加的跟隨場域
   以及使用者於實作前的兩項決策：
     - 【寒霜狀態】的持續傷害不隨層數提高（層數只累積緩速，疊滿才凍結）
     - 【凍結】走既有控場管線（BOSS 控場免疫、韌性折減、控場遞減全部適用）
   另外釘住兩件「不得回歸」的既有行為：
     - 泥沼緩速換成通用收斂點（skill2SlowAspdFactor／skill2SlowMoveFactor）後數值不變
     - skills2CastRangePx 改吃 sgVal 之後，既有群組（沒有 castMPer）的射程完全不變 */
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
    'js/skills.js', 'js/skills2.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  // 魔法技能要看得到魔攻：物攻與魔攻刻意給不同值，才能驗出「吃的是哪一個」
  context.getStats = () => ({
    atk: 1000, matk: 500, hp: 1000, mp: 200, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, shieldEff: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: {},
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  context.GT = 0;
  return context;
}

function enemy(hp, x, y, name) {
  return {
    name: name || '測試怪', maxHp: hp, hp, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    pos: (x === undefined) ? undefined : { x, y }
  };
}
function playerEnt() {
  return { hp: 1000, mp: 200, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
function stubHits(c, opts) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ ent: defender, aCfg: aCfg, atk: aCfg.atk });
    const dmg = (opts && opts.dmg) || 100;
    defender.hp = Math.max(0, defender.hp - dmg);
    return { dmg, crit: false, miss: false, blocked: false, killed: defender.hp <= 0 };
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
function run(c, p, enemies, sec, step) {
  const dt = step || 0.05;
  for (let t = 0; t < sec - 1e-9; t += dt) {
    c.GT += dt;
    c.tickSkill2(dt, tickCtx(c, p, enemies));
  }
}
/* 各階需前一階至少 Lv.1 才生效（sgEffectiveLevels），因此測試等級一律連續給。 */
function setLevels(c, gid, levels) { c.G.player.skills2.levels[gid] = levels.slice(); }
function equip(c, gid) { c.G.player.loadout = [c.SG_PREFIX + gid]; }
function forceRolls(c, value) { c.Math.random = () => value; }   // 0＝機率必中、0.999＝必不中

const M = 10; // 1 米 = 10 個系統距離單位（bfMeterPx）

/* ---- 資料表 ---- */

test('三個冰系群組都在表上，且為魔法傷害／寒冰屬性', () => {
  const c = loadContext();
  ['icearrow', 'waterball', 'frostnova'].forEach((gid) => {
    const g = c.SKILLS2[gid];
    assert.ok(g, gid + ' 應存在');
    assert.equal(g.dmgType, 'magic', gid + ' 為魔法傷害');
    assert.equal(g.elem, 'ice', gid + ' 為寒冰屬性');
    assert.equal(g.tiers.length, c.SG_TIER_COUNT, gid + ' 應有 7 階');
    assert.equal(g.cost, 40, gid + ' 施法消耗與其他魔法群組一致');
  });
  assert.equal(c.SKILLS2.icearrow.cd, 18);
  assert.equal(c.SKILLS2.waterball.cd, 14);
  assert.equal(c.SKILLS2.frostnova.cd, 20);
});

test('每階的說明模板都能代入 fx（沒有缺欄位的佔位符）', () => {
  const c = loadContext();
  ['icearrow', 'waterball', 'frostnova'].forEach((gid) => {
    c.SKILLS2[gid].tiers.forEach((t, i) => {
      const keys = (String(t.desc).match(/\{(\w+)\}/g) || []).map((s) => s.slice(1, -1));
      keys.forEach((k) => {
        assert.ok(k in t.fx, gid + ' 第 ' + (i + 1) + ' 階說明用到 {' + k + '} 但 fx 沒有這一欄');
      });
      assert.ok(!/\{\w+\}/.test(c.describeSkill2Tier(gid, i, 1)), gid + ' 第 ' + (i + 1) + ' 階說明應完全代入');
    });
  });
});

test('寒冰箭參數：箭道間隔 15 度、速度 30 米／秒，爆裂箭連射三波且間隔 0.3 秒', () => {
  const c = loadContext();
  const base = c.SKILLS2.icearrow.tiers[0].fx;
  const burst = c.SKILLS2.icearrow.tiers[6].fx;
  assert.equal(base.deg, 15);
  assert.equal(base.speed, 30);
  assert.equal(burst.waves, 3);
  assert.equal(burst.waveGap, 0.3);
  assert.equal(burst.sec, 6);
  assert.equal(burst.pct, 400);
  assert.equal(c.SG_ICEARROW_SPEED, c.bfMeterPx(30));
});

/* ---- 寒霜狀態（三群組共用） ---- */

test('寒霜的行為參數以狀態表為權威', () => {
  const c = loadContext();
  assert.equal(c.STATUS.sgFrost.stack, 'stack', '層數走疊層規則');
  assert.equal(c.STATUS.sgFrost.maxStacks, 5, '層數上限 5');
  assert.equal(c.STATUS.sgFrost.val, 20, '單層緩速 20%');
  assert.equal(c.STATUS.sgFrostBite.interval, 0.5, '寒霜每 0.5 秒作用一次');
  assert.equal(c.STATUS.sgFrostBite.dur, 5, '寒霜持續 5 秒');
  assert.equal(c.STATUS.sgFrostBite.elem, 'ice', '寒霜的持續傷害為寒冰屬性');
  assert.equal(c.STATUS.sgFrozen.dur, 3, '凍結 3 秒');
  // 引擎讀的就是這張表
  assert.equal(c.sgFrostMaxStacks(), 5);
  assert.equal(c.sgFrostSlowPerStack(), 20);
  assert.equal(c.sgFrostGap(), 0.5);
  assert.equal(c.sgFrostBaseDur(), 5);
  assert.equal(c.sgFrozenSec(), 3);
});

test('冰霜新星起手附加 2 層寒霜，緩速＝單層×層數', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'frostnova', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'frostnova');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 3 * M, 0);
  c.castSkill2(p, [e], 'frostnova', 'mv-float');
  assert.equal(c.sgFrostStacks(e), 2, '文檔：附加 2 層寒霜狀態');
  assert.equal(c.buffVal(e, 'sgFrost'), 40, '2 層 ＝ 緩速 40%');
  assert.ok(Math.abs(c.skill2FrostSlowFactor(e) - 0.6) < 1e-9, '攻速與移速倍率同為 0.6');
  assert.ok(c.sgFindDot(e, 'sgFrostBite'), '同時掛上寒霜的持續傷害');
});

test('寒霜的持續傷害不隨層數提高（使用者決策 2026-08-17）', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'frostnova', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'frostnova');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 3 * M, 0);
  c.castSkill2(p, [e], 'frostnova', 'mv-float');
  const dps1 = c.sgFindDot(e, 'sgFrostBite').dps;
  c.castSkill2(p, [e], 'frostnova', 'mv-float');
  assert.equal(c.sgFrostStacks(e), 4, '層數會累積');
  assert.ok(Math.abs(c.sgFindDot(e, 'sgFrostBite').dps - dps1) < 1e-9, '每跳傷害不變');
});

test('寒霜每跳占施放群組的本體技能傷害', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'frostnova', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'frostnova');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 3 * M, 0);
  c.castSkill2(p, [e], 'frostnova', 'mv-float');
  const novaBody = 500 * (150 + 5) / 100;          // matk × (pct + pctPer×Lv1)
  const perTick = novaBody * 50 / 100;             // frostPct = 50
  const dot = c.sgFindDot(e, 'sgFrostBite');
  assert.ok(Math.abs(dot.dps * 0.5 - perTick) < 1e-6, '每跳量＝本體傷害的 50%');
});

test('疊滿層數才凍結，且維持滿層時不重複凍結', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'frostnova', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'frostnova');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 3 * M, 0);
  c.castSkill2(p, [e], 'frostnova', 'mv-float');   // 2 層
  c.castSkill2(p, [e], 'frostnova', 'mv-float');   // 4 層
  assert.ok(!c.sgFrozenOn(e), '未滿層不凍結');
  c.castSkill2(p, [e], 'frostnova', 'mv-float');   // 夾到 5 層
  assert.equal(c.sgFrostStacks(e), 5, '層數夾在上限');
  assert.ok(c.sgFrozenOn(e), '疊滿即凍結');
  assert.ok(c.effectActive(e, 'stun'), '凍結的行動限制由既有的暈眩承擔');
  const until = e.buffs.sgFrozen.until;
  c.GT += 0.1;
  c.castSkill2(p, [e], 'frostnova', 'mv-float');
  assert.equal(e.buffs.sgFrozen.until, until, '維持滿層的重塗不再重新凍結（避免永久凍結）');
});

test('凍結走既有控場管線：BOSS 完全免疫，但寒霜層數與緩速照樣生效', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'frostnova', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'frostnova');
  const p = playerEnt(); c.FIELD.player = p;
  const b = enemy(1e9, 3 * M, 0, 'BOSS'); b.isBoss = true;
  for (let i = 0; i < 3; i++) c.castSkill2(p, [b], 'frostnova', 'mv-float');
  assert.equal(c.sgFrostStacks(b), 5, 'BOSS 仍會被疊寒霜');
  assert.ok(!c.sgFrozenOn(b), 'BOSS 控場免疫 → 不凍結');
  assert.ok(!c.effectActive(b, 'stun'), 'BOSS 也不會被暈眩');
});

test('凍結標記的長度跟隨「實際暈到的秒數」，不是表定秒數', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  const e = enemy(1e9, 3 * M, 0);
  // 控場遞減把 3 秒砍成 1.2 秒：標記必須跟著縮短，否則會出現「標記凍結卻能行動」
  c.applyStatus = function (ent, sid, ctx) {
    if (sid === 'stun') { ent.effects.stun = c.GT + 1.2; return 1.2; }
    return c.applyBuff(ent, c.STATUS[sid].key || sid, Number(ctx.val) || 0, Number(ctx.dur) || 0, sid, null);
  };
  const sec = c.sgFreezeTarget(e);
  assert.ok(Math.abs(sec - 1.2) < 1e-9, 'sgFreezeTarget 回傳實際秒數');
  assert.ok(Math.abs((e.buffs.sgFrozen.until - c.GT) - 1.2) < 1e-9, '凍結標記與行動限制同時到期');
});

test('【極致寒霜】跨群組放大所有來源的寒霜（傷害與持續時間）', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  const p = playerEnt(); c.FIELD.player = p;
  // 基準線：點到第 3 階（只差第 4 階一個變數）
  setLevels(c, 'frostnova', [1, 1, 1, 0, 0, 0, 0]); equip(c, 'frostnova');
  const a = enemy(1e9, 3 * M, 0, 'A');
  c.castSkill2(p, [a], 'frostnova', 'mv-float');
  const base = c.sgFindDot(a, 'sgFrostBite');
  const baseDps = base.dps, baseDur = base.until - c.GT;
  assert.ok(Math.abs(c.skill2FrostDmgFactor() - 1) < 1e-9, '未投資時沒有倍率');

  setLevels(c, 'frostnova', [1, 1, 1, 1, 0, 0, 0]);
  const b = enemy(1e9, 3 * M, 0, 'B');
  c.castSkill2(p, [b], 'frostnova', 'mv-float');
  const amp = c.sgFindDot(b, 'sgFrostBite');
  assert.ok(Math.abs(c.skill2FrostDmgFactor() - 1.44) < 1e-9, 'Lv.1 ＝ +44%');
  assert.ok(Math.abs(amp.dps / baseDps - 1.44) < 1e-6, '寒霜傷害 ×1.44');
  assert.ok(Math.abs((amp.until - c.GT) / baseDur - 1.44) < 1e-6, '寒霜持續時間 ×1.44');
});

/* ---- 寒冰箭 ---- */

test('寒冰箭第 1 階：前方扇形內的單體攻擊，一支箭一個敵人', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  setLevels(c, 'icearrow', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'icearrow');
  const p = playerEnt(); c.FIELD.player = p;
  const es = [enemy(1e9, 5 * M, 0, 'A'), enemy(1e9, 8 * M, 1 * M, 'B'), enemy(1e9, -20 * M, 0, '後方')];
  assert.ok(c.castSkill2(p, es, 'icearrow', 'mv-float'), '可施放');
  assert.equal(calls.length, 2, '文檔：丟出 2 支寒冰箭，各造成一次傷害');
  assert.ok(calls.every((x) => x.ent.name !== '後方'), '扇形 45 度外的敵人不會被選中');
  assert.ok(Math.abs(calls[0].atk - 500 * (250 + 25) / 100) < 1e-6, '每支＝魔攻 ×(250+25×Lv)%');
  assert.equal(calls[0].aCfg.dmgType, 'magic');
  assert.equal(calls[0].aCfg.skillElem, 'ice');
  const shots = specs.filter((s) => s.variant === 'ice-arrow');
  assert.equal(shots.length, 2, '每支箭各自送出一個投射物事件');
  assert.ok(Math.abs(Math.abs(shots[1].angle - shots[0].angle) - 15 * Math.PI / 180) < 1e-9,
    '相鄰箭道夾角固定 15 度，不重疊');
  assert.equal(shots[0].travelMs[0], Math.round(5 * M / c.SG_ICEARROW_SPEED * 1000),
    '箭速為 30 米／秒');
});

test('【冰系強化】與第 1 階累加（文檔明寫累加效果）', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'icearrow', [1, 1, 1, 0, 0, 0, 0]); equip(c, 'icearrow');
  const p = playerEnt(); c.FIELD.player = p;
  c.castSkill2(p, [enemy(1e9, 5 * M, 0)], 'icearrow', 'mv-float');
  const expected = 500 * ((250 + 25) + (100 + 10)) / 100;
  assert.ok(Math.abs(calls[0].atk - expected) < 1e-6, '250+25 與 100+10 相加後再乘魔攻');
});

test('【冰箭散射】增加箭數（不足 1 支以機率觸發）', () => {
  const c = loadContext(); stubVfx(c);
  const p = playerEnt();
  function arrows(rollValue) {
    const ctx = loadContext(); const calls = stubHits(ctx); stubVfx(ctx);
    setLevels(ctx, 'icearrow', [1, 1, 1, 1, 1, 0, 0]); equip(ctx, 'icearrow');
    ctx.FIELD.player = p;
    forceRolls(ctx, rollValue);
    const es = [enemy(1e9, 5 * M, 0, 'A')];
    ctx.castSkill2(p, es, 'icearrow', 'mv-float');
    return ctx.SKILL2_RT.projectiles.length;   // 第 4 階已投資 → 每支箭一個飛行物
  }
  assert.equal(arrows(0.999), 3, '2 支 + 整數 1 支 ＝ 3 支（小數不觸發）');
  assert.equal(arrows(0), 4, '小數部分觸發 → 再 +1 支');
});

test('【貫穿冰箭】改為路徑貫穿，且貫穿長度不足時自動延長到主目標', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  setLevels(c, 'icearrow', [1, 1, 1, 1, 0, 0, 0]); equip(c, 'icearrow');
  forceRolls(c, 0.999);
  const p = playerEnt(); c.FIELD.player = p;
  /* 主目標（＝最近的敵人）在 25 米處，遠超第 4 階 Lv.1 的 12 米貫穿長度；
     路徑必須自動延長，否則投資第 4 階會讓原本打得到的目標變成打不到。 */
  const es = [enemy(1e9, 25 * M, 0, '遠'), enemy(1e9, 28 * M, 0, '更遠')];
  c.castSkill2(p, es, 'icearrow', 'mv-float');
  run(c, p, es, 2);
  const names = calls.map((x) => x.ent.name);
  assert.ok(names.includes('遠'), '升級不得變成降級：路徑必須長到打得到主目標');
  assert.ok(names.includes('更遠'), '延長後的路徑上其他敵人一併被貫穿');
  assert.ok(specs.some((s) => s.variant === 'ice-arrow-pierce'), '送出貫穿特效');
});

test('【寒霜凍結】對已帶寒霜的敵人結清剩餘凍傷並追加層數', () => {
  /* stub 的 resolveHit 固定每次扣 100，因此「總扣血 − 命中次數×100」就是走
     sgDerivedHit 的結清量（衍生傷害不經 resolveHit，不會進 calls）。
     以「第 6 階未投資／已投資」對照，才能確定那筆衍生傷害真的來自本階。
     ⚠️ tickStatuses 不在本測試的迴圈內，所以扣血不含寒霜自己的逐跳傷害。 */
  function derivedDamage(levels) {
    const c = loadContext(); const calls = stubHits(c); stubVfx(c);
    setLevels(c, 'icearrow', levels); equip(c, 'icearrow');
    forceRolls(c, 0.999);
    const p = playerEnt(); c.FIELD.player = p;
    const e = enemy(1e9, 5 * M, 0);
    const hp0 = e.hp;
    c.castSkill2(p, [e], 'icearrow', 'mv-float');
    run(c, p, [e], 1);
    return { derived: (hp0 - e.hp) - calls.length * 100, stacks: c.sgFrostStacks(e), max: c.sgFrostMaxStacks() };
  }
  const off = derivedDamage([1, 1, 1, 1, 1, 0, 0]);
  assert.ok(Math.abs(off.derived) < 1e-6, '第 6 階未投資時沒有任何結清傷害（實際 ' + off.derived + '）');

  const on = derivedDamage([1, 1, 1, 1, 1, 1, 0]);
  /* 同一次齊射的第 2 支箭就會看到第 1 支塗上的寒霜 —— 這是文檔預期的
     「射中有寒霜狀態之敵人」語意，不是重複觸發。 */
  assert.ok(on.derived > 0, '第 6 階投資後把剩餘凍傷一次結清（衍生傷害 ' + Math.round(on.derived) + '）');
  assert.equal(on.stacks, on.max, '追加層數後夾在層數上限');
});

test('【寒冰爆裂箭】轉為追擊場域，並採接觸判定', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'icearrow', [1, 1, 1, 1, 1, 1, 1]); equip(c, 'icearrow');
  forceRolls(c, 0.999);
  const p = playerEnt(); c.FIELD.player = p;
  const es = [enemy(1e9, 5 * M, 0, 'A'), enemy(1e9, 9 * M, 2 * M, 'B')];
  c.castSkill2(p, es, 'icearrow', 'mv-float');
  const homing = c.SKILL2_RT.grounds.filter((f) => f.kind === 'icearrow');
  assert.equal(homing.length, 9, '三波各發射 3 支追蹤冰箭');
  assert.deepEqual([...new Set(homing.map((f) => f.startAt))], [0, 0.3, 0.6],
    '三波啟動時間為 0、0.3、0.6 秒');
  homing.forEach((f) => {
    assert.equal(f.contact, true, '接觸判定：進入才算一次命中，不是每個節拍全額命中');
    assert.equal(f.chaseM, 30, '追擊範圍沿用表定 30 米');
    assert.equal(f.speed, c.SG_ICEARROW_SPEED, '追蹤冰箭速度為 30 米／秒');
  });
});

test('【寒冰爆裂箭】凍結結束時產生冰爆', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  setLevels(c, 'icearrow', [1, 1, 1, 1, 1, 1, 1]); equip(c, 'icearrow');
  forceRolls(c, 0.999);
  const p = playerEnt(); c.FIELD.player = p;
  const target = enemy(1e9, 5 * M, 0, 'T');
  const near = enemy(1e9, 8 * M, 0, 'N');
  const es = [target, near];
  c.applyStatus(target, 'sgFrozen', { val: 0, dur: 0.2 });
  run(c, p, es, 0.15);                       // 凍結中：還不該炸
  assert.ok(!specs.some((s) => s.variant === 'ice-blast'), '凍結期間不引爆');
  const before = calls.length;
  run(c, p, es, 0.3);                        // 凍結結束
  assert.ok(specs.some((s) => s.variant === 'ice-blast'), '凍結結束 → 冰爆');
  assert.ok(calls.length > before, '冰爆造成傷害');
  const blast = calls.slice(before);
  const expected = 500 * (400 + 40) / 100;
  assert.ok(blast.some((x) => Math.abs(x.atk - expected) < 1e-6), '冰爆傷害＝魔攻 ×(400+40×Lv)%');
});

/* ---- 水流彈 ---- */

test('水流彈第 1 階：單體命中，且拋物線弧高交給顯示層', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  setLevels(c, 'waterball', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'waterball');
  const p = playerEnt(); c.FIELD.player = p;
  c.castSkill2(p, [enemy(1e9, 5 * M, 0)], 'waterball', 'mv-float');
  assert.equal(calls.length, 1, '未投資爆散前為單體');
  assert.ok(Math.abs(calls[0].atk - 500 * (200 + 20) / 100) < 1e-6, '傷害＝魔攻 ×(200+20×Lv)%');
  const proj = specs.find((s) => s.variant === 'waterball');
  assert.ok(proj, '送出水彈投射物特效');
  assert.equal(proj.arcM, 8, '弧高（離地最高 8 米）必須隨事件傳給顯示層（AI_RULES 8.3）');
});

test('【寒冰逆轉】強制改寫敵人屬性標籤，並只放大寒冰段', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'waterball', [1, 1, 0, 0, 0, 0, 0]); equip(c, 'waterball');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 5 * M, 0);
  e.attr = 'fire';
  c.castSkill2(p, [e], 'waterball', 'mv-float');
  assert.equal(c.skill2ForcedAttr(e), 'ice', '無論原本是什麼屬性都改為寒冰');
  assert.equal(c.monsterDefCfg(e).attr, 'ice', 'monsterDefCfg 是唯一出口，改寫在這裡生效');
  assert.equal(c.skill2IceTakenPct(e), 22, '受到的寒冰傷害 +22%（Lv.1）');
  const aCfg = c.skill2VulnACfg({ skillElem: 'ice' }, e);
  assert.ok(Math.abs(aCfg.skillElemAmp.ice - 1.22) < 1e-9, '走 skillElemAmp 的寒冰乘區');
  assert.equal(aCfg.totalDmgPct, undefined, '不得混進 totalDmgPct（否則會放大其他屬性段）');
  // 沒有逆轉的敵人不受影響
  const clean = enemy(1e9, 5 * M, 0);
  assert.equal(c.skill2VulnACfg({ skillElem: 'ice' }, clean).skillElemAmp, undefined);
});

test('【寒流爆散】改為範圍攻擊並彈射（不足 1 次以機率觸發）', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'waterball', [1, 1, 1, 1, 0, 0, 0]); equip(c, 'waterball');
  forceRolls(c, 0.999);
  const p = playerEnt(); c.FIELD.player = p;
  const es = [enemy(1e9, 5 * M, 0, 'A'), enemy(1e9, 6 * M, 0, 'B'), enemy(1e9, 30 * M, 0, 'C')];
  c.castSkill2(p, es, 'waterball', 'mv-float');
  const hitA = calls.filter((x) => x.ent.name === 'A').length;
  const hitB = calls.filter((x) => x.ent.name === 'B').length;
  assert.ok(hitA >= 1 && hitB >= 1, '爆散的 8 米範圍同時打到 A 與 B');
  assert.ok(calls.length >= 4, '再彈射 2 次 → 總命中次數明顯多於單體（實際 ' + calls.length + '）');
});

test('【三重流水】追加水流彈（不足 1 顆以機率觸發）', () => {
  function shots(rollValue) {
    const c = loadContext(); const calls = stubHits(c); stubVfx(c);
    setLevels(c, 'waterball', [1, 1, 1, 0, 0, 1, 0]);
    // 第 4 階未投資 → 保持單體，命中次數就是水彈顆數
    c.G.player.skills2.levels.waterball = [1, 1, 1, 0, 0, 0, 0];
    setLevels(c, 'waterball', [1, 1, 1, 1, 1, 1, 0]);
    equip(c, 'waterball');
    forceRolls(c, rollValue);
    const p = playerEnt(); c.FIELD.player = p;
    const es = [enemy(1e9, 5 * M, 0, 'A')];
    c.castSkill2(p, es, 'waterball', 'mv-float');
    return calls.length;
  }
  assert.ok(shots(0.999) < shots(0), '小數機率觸發時水彈更多');
});

test('【水龍捲】追加四道地板場域，對凍結中的敵人傷害為 2 倍', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  setLevels(c, 'waterball', [1, 1, 1, 1, 1, 1, 1]); equip(c, 'waterball');
  forceRolls(c, 0.999);
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 5 * M, 0);
  c.castSkill2(p, [e], 'waterball', 'mv-float');
  const tor = c.SKILL2_RT.grounds.filter((f) => f.kind === 'tornado');
  assert.equal(tor.length, 4, '文檔：我方 10×10 米正方形的四個頂點各一道');
  tor.forEach((f) => assert.equal(f.frozenMult, 2, '對凍結敵人 2 倍'));
  // 四個頂點應互不相同（不是全部疊在同一點）
  const spots = tor.map((f) => Math.round(f.pos.x) + ':' + Math.round(f.pos.y));
  assert.equal(new Set(spots).size, 4, '四道分別落在四個不同頂點');

  c.applyStatus(e, 'sgFrozen', { val: 0, dur: 5 });
  const before = calls.length;
  run(c, p, [e], 1);
  const frozenHits = calls.slice(before).filter((x) => x.ent === e);
  assert.ok(frozenHits.length > 0, '水龍捲逐段造成傷害');
  frozenHits.forEach((x) => assert.equal(x.aCfg.totalDmgPct, 100, '2 倍＝總傷加成 +100%，仍完整走防禦與抗性'));
  assert.ok(specs.some((s) => s.variant === 'water-tornado'), '送出水龍捲場域特效');
});

/* ---- 冰霜新星 ---- */

test('冰霜新星是自身範圍爆發：施放距離必須跟得上作用半徑', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'frostnova', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'frostnova');
  const p = playerEnt(); c.FIELD.player = p;
  const lvs = c.skills2Levels('frostnova');
  assert.equal(c.skills2CastRangePx('frostnova', lvs), c.bfMeterPx(12), '第 1 階射程＝作用半徑 12 米');
  // 11 米處的敵人在範圍內 → 必須打得到（沒有 castM 時會退回近戰 5 米而完全打不到）
  const es = [enemy(1e9, 11 * M, 0, '遠')];
  assert.ok(c.castSkill2(p, es, 'frostnova', 'mv-float'), '範圍內的敵人可以施放');
  assert.equal(calls.length, 1);
});

test('【冰霜衝擊】擴大範圍與傷害，且射程隨等級跟著長大', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'frostnova', [1, 1, 0, 0, 0, 0, 0]); equip(c, 'frostnova');
  const p = playerEnt(); c.FIELD.player = p;
  const lvs = c.skills2Levels('frostnova');
  assert.ok(Math.abs(c.skills2CastRangePx('frostnova', lvs) - c.bfMeterPx(13.6)) < 1e-6,
    '第 2 階 Lv.1 ＝ 13 + 0.6 米');
  const es = [enemy(1e9, 13 * M, 0)];
  c.castSkill2(p, es, 'frostnova', 'mv-float');
  const expected = 500 * ((150 + 5) + (50 + 5)) / 100;
  assert.ok(Math.abs(calls[0].atk - expected) < 1e-6, '傷害為第 1 階與第 2 階累加');
});

test('【三重新星】多次施放，每次範圍再擴大', () => {
  const c = loadContext(); stubHits(c); const specs = stubVfx(c);
  setLevels(c, 'frostnova', [1, 1, 1, 1, 1, 0, 0]); equip(c, 'frostnova');
  forceRolls(c, 0.999);
  const p = playerEnt(); c.FIELD.player = p;
  c.castSkill2(p, [enemy(1e9, 3 * M, 0)], 'frostnova', 'mv-float');
  const novas = specs.filter((s) => s.variant === 'frost-nova');
  assert.equal(novas.length, 2, '1 次基礎 + 1 次追加');
  const radii = novas.map((s) => s.area && s.area.r);
  assert.ok(radii[1] > radii[0], '第 2 次的範圍再 +3 米');
  assert.ok(Math.abs(radii[1] - radii[0] - c.bfMeterPx(3)) < 1e-6, '每次固定 +3 米');
});

test('【寒冰體】冰霜新星施放後 6 秒內，攻擊你的敵人有 25% 機率被附加寒霜', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'frostnova', [1, 1, 1, 0, 0, 0, 0]); equip(c, 'frostnova');
  const p = playerEnt(); c.FIELD.player = p;
  const attacker = enemy(1e9, 2 * M, 0);
  forceRolls(c, 0);
  c.skills2OnPlayerDamaged(attacker, p, 10, false, { miss: false }, 'mv-float');
  assert.equal(c.sgFrostStacks(attacker), 0, '未施放冰霜新星前不附加寒霜');

  const novaTarget = enemy(1e9, 3 * M, 0);
  c.castSkill2(p, [novaTarget], 'frostnova', 'mv-float');
  assert.ok(c.statusActive(p, 'sgFrostbody'), '施放後玩家應取得寒冰體狀態');
  assert.equal(c.buffVal(p, 'sgFrostbody'), 25, '寒冰體狀態的機率為 25%');
  assert.ok(Math.abs((p.buffs.sgFrostbody.until - c.GT) - 6) < 1e-9, '寒冰體狀態持續 6 秒');

  forceRolls(c, 0.999);
  c.skills2OnPlayerDamaged(attacker, p, 10, false, { miss: false }, 'mv-float');
  assert.equal(c.sgFrostStacks(attacker), 0, '機率不成立時不附加');
  forceRolls(c, 0);
  c.skills2OnPlayerDamaged(attacker, p, 10, false, { miss: false }, 'mv-float');
  assert.ok(c.sgFrostStacks(attacker) > 0, '機率成立 → 附加寒霜');

  c.GT = 6;
  const expiredAttacker = enemy(1e9, 2 * M, 0);
  c.skills2OnPlayerDamaged(expiredAttacker, p, 10, false, { miss: false }, 'mv-float');
  assert.equal(c.sgFrostStacks(expiredAttacker), 0, '寒冰體狀態到期後不再附加寒霜');
});

test('【死亡新星】帶寒霜的敵人死亡時機率再釋放一次新星', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'frostnova', [1, 1, 1, 1, 1, 1, 0]); equip(c, 'frostnova');
  const p = playerEnt(); c.FIELD.player = p;
  const other = enemy(1e9, 4 * M, 0, 'OTHER');
  forceRolls(c, 0);
  const noFrost = enemy(1, 3 * M, 0, 'NOFROST');
  c.skills2OnEnemyDeath(noFrost, [other]);
  assert.equal(calls.length, 0, '沒有寒霜的敵人死亡不觸發');
  const frosted = enemy(1, 3 * M, 0, 'FROSTED');
  c.applyStatus(frosted, 'sgFrost', { val: 20, dur: 5 });
  c.skills2OnEnemyDeath(frosted, [other]);
  assert.ok(calls.length > 0, '帶寒霜的敵人死亡 → 再釋放一次新星');
});

test('【暴風雪】追加一道跟隨我方的地板場域', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  setLevels(c, 'frostnova', [1, 1, 1, 1, 1, 1, 1]); equip(c, 'frostnova');
  forceRolls(c, 0.999);
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 8 * M, 0);
  c.castSkill2(p, [e], 'frostnova', 'mv-float');
  const bl = c.SKILL2_RT.grounds.filter((f) => f.kind === 'blizzard');
  assert.equal(bl.length, 1, '追加（而非取代）一道暴風雪');
  assert.equal(bl[0].follow, true, '跟隨我方：圓心恆等於玩家當下座標');
  assert.ok(Math.abs(bl[0].length - c.bfMeterPx(20)) < 1e-6, '20×20 米方形範圍');
  const before = calls.length;
  run(c, p, [e], 1);
  assert.ok(calls.length > before, '逐拍造成傷害');
  assert.ok(specs.some((s) => s.variant === 'blizzard'), '送出暴風雪場域特效');
});

/* ---- 寒霜擴散 ---- */

test('【寒霜擴散】寒霜每次作用時機率擴散給附近的敵人', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'waterball', [1, 1, 1, 1, 1, 0, 0]); equip(c, 'waterball');
  forceRolls(c, 0.999);
  const p = playerEnt(); c.FIELD.player = p;
  const a = enemy(1e9, 5 * M, 0, 'A');
  const b = enemy(1e9, 12 * M, 0, 'B');
  c.castSkill2(p, [a], 'waterball', 'mv-float');   // 施放時只有 A 在場
  assert.ok(c.sgFrostOn(a), 'A 帶寒霜');
  assert.ok(!c.sgFrostOn(b), 'B 尚未被波及');
  forceRolls(c, 0);                                 // 擴散機率必中
  run(c, p, [a, b], 1.2);
  assert.ok(c.sgFrostOn(b), '寒霜作用時擴散給附近的 B');
  const src = c.sgFindDot(a, 'sgFrostBite');
  const dst = c.sgFindDot(b, 'sgFrostBite');
  assert.ok(src && dst && Math.abs(src.dps - dst.dps) < 1e-9, '擴散出去的寒霜與來源同強度');
});

/* ---- 既有行為不得回歸 ---- */

test('泥沼緩速改走通用收斂點後數值完全不變', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'mire', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'mire');
  const m = enemy(1e9, 3 * M, 0);
  c.applyStatus(m, 'sgMire', { val: 50, dur: 2 });
  assert.ok(Math.abs(c.skill2MireAspdFactor(m) - 0.5) < 1e-9, '泥沼攻速 -50%');
  assert.ok(Math.abs(c.skill2MoveSlowFactor(m) - 0.7) < 1e-9, '泥沼移速 -30%');
  assert.ok(Math.abs(c.skill2SlowAspdFactor(m) - 0.5) < 1e-9, '只有泥沼時通用值等於泥沼值');
  assert.ok(Math.abs(c.skill2SlowMoveFactor(m) - 0.7) < 1e-9, '移速同理');
  // 兩種場域型緩速並存時相乘（不是取其一、也不是相加）
  c.applyStatus(m, 'sgFrost', { val: 20, dur: 2 });
  assert.ok(Math.abs(c.skill2SlowAspdFactor(m) - 0.5 * 0.8) < 1e-9, '泥沼 × 寒霜');
  assert.ok(Math.abs(c.skill2SlowMoveFactor(m) - 0.7 * 0.8) < 1e-9, '移速亦相乘');
});

test('沒有任何緩速時通用收斂點恆為 1', () => {
  const c = loadContext();
  const e = enemy(1e9, 3 * M, 0);
  assert.equal(c.skill2SlowAspdFactor(e), 1);
  assert.equal(c.skill2SlowMoveFactor(e), 1);
  assert.equal(c.skill2FrostSlowFactor(e), 1);
});

test('skills2CastRangePx 改吃 sgVal 之後，既有群組的射程完全不變', () => {
  const c = loadContext();
  /* 既有群組都沒有定義 castMPer，因此不論等級多高，射程都應等於表定底值。
     只投資第 1 階（其餘階為 0）才測得到「底值」——高階的 castM 改寫（殞石術）另外驗。 */
  const expect = { fireball: 30, firepillar: 30, firehunt: 8, mire: 20, chainlightning: 30, thunderstrike: 30, thunderorb: 30 };
  Object.keys(expect).forEach((gid) => {
    for (const lv of [1, 5, 10]) {
      const at = c.SKILLS2[gid].tiers.map((t, i) => (i === 0 ? lv : 0));
      assert.equal(c.skills2CastRangePx(gid, at), c.bfMeterPx(expect[gid]),
        gid + ' 在 Lv.' + lv + ' 的射程不得改變');
    }
  });
  // 殞石術（第 7 階）仍然把射程改寫成 20 米，且同樣不隨等級變動
  for (const lv of [1, 10]) {
    const meteorLvs = c.SKILLS2.fireball.tiers.map(() => lv);
    assert.equal(c.skills2CastRangePx('fireball', meteorLvs), c.bfMeterPx(20),
      '第 7 階殞石術改寫為 20 米（Lv.' + lv + '）');
  }
  // 冰霜新星是唯一定義 castMPer 的群組：射程隨作用半徑一起長大
  assert.equal(c.skills2CastRangePx('frostnova', [1, 0, 0, 0, 0, 0, 0]), c.bfMeterPx(12));
  assert.ok(Math.abs(c.skills2CastRangePx('frostnova', [10, 10, 0, 0, 0, 0, 0]) - c.bfMeterPx(13 + 0.6 * 10)) < 1e-6,
    '第 2 階 Lv.10 ＝ 13 + 0.6×10 米');
});

test('sgTryStun 回傳實際秒數，且既有呼叫端的真假判定不受影響', () => {
  const c = loadContext();
  const e = enemy(1e9, 3 * M, 0);
  const sec = c.sgTryStun(e, 2.5);
  assert.ok(Math.abs(sec - 2.5) < 1e-9, '沒有遞減時回傳表定秒數');
  assert.ok(sec, '數值 > 0 在既有呼叫端仍為真');
  const boss = enemy(1e9, 3 * M, 0); boss.isBoss = true;
  assert.equal(c.sgTryStun(boss, 2.5), 0, 'BOSS 免疫回傳 0');
  assert.ok(!c.sgTryStun(boss, 2.5), '0 在既有呼叫端仍為假');
});

test('沒有投資冰系群組時，寒霜的節拍器與冰爆完全不作用', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 5 * M, 0);
  c.applyStatus(e, 'sgFrozen', { val: 0, dur: 0.2 });
  run(c, p, [e], 0.6);
  assert.equal(calls.length, 0, '沒有寒冰箭第 7 階就不會冰爆');
  assert.ok(!specs.some((s) => s.variant === 'ice-blast'));
});
