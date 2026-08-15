/* 新版主動技能系統（2026-08-13 技能改造第一批，js/skills2.js）
   守住六件事：
     1. SKILLS2 定義表形狀正確，且與 config/CSV/Skills2.csv 完整往返
     2. 等級正規化：第 1 階預設開啟、階層循序解鎖、上限夾限
     3. 升級／降級指令的驗證與金幣扣款
     4. 戰場幾何：米換算、直線貫穿、扇形、最近 N 敵
     5. 施放機制：次數合成、彈射鏈、冷卻寫入、爆擊縮冷卻、DoT 塗抹與零日感染、屍爆
     6. 暴風之舞化身：自動施放、普攻暫停旗標、到期清除 */
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
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/skills2.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  // 測試用固定屬性（getStats 為全域函式，直接覆蓋）
  context.getStats = () => ({
    atk: 1000, matk: 0, hp: 1000, mp: 100, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: 0,
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
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
  return { hp: 1000, mp: 100, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
/* vm 內建立的陣列與宿主的 Array 原型不同，strict deepEqual 會因原型不相等而失敗；
   數值陣列一律先轉純資料再比。 */
function plain(v) { return JSON.parse(JSON.stringify(v)); }
/* 傷害管線替身：固定 100 傷、可指定爆擊——測「機制」不測「公式」（公式由既有測試守）。 */
function stubHits(c, opts) {
  const calls = [];
  c.resolveHit = function (attacker, defender) {
    calls.push(defender);
    const dmg = (opts && opts.dmg) || 100;
    defender.hp = Math.max(0, defender.hp - dmg);
    return { dmg, crit: !!(opts && opts.crit), miss: false, blocked: false, killed: defender.hp <= 0 };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  return calls;
}

/* ---- 1) 定義表 ---- */

test('SKILLS2：8 個群組、每組 7 階、欄位齊全且說明模板的參數鍵都存在', () => {
  const c = loadContext();
  const gids = Object.keys(c.SKILLS2);
  assert.deepEqual(gids, ['thrust', 'cleave', 'knife', 'gale', 'bloodblade', 'dualdance', 'counter', 'bloodrage']);
  gids.forEach((gid) => {
    const g = c.SKILLS2[gid];
    const isPassive = c.skills2IsPassive(gid);
    assert.ok(g.name && g.emoji, gid + ' 缺名稱/圖標');
    assert.ok(g.range === undefined || typeof g.range === 'string', gid + ' range 欄位型別不合法');
    // 被動群組（counter）無冷卻無耗魔；主動群組必須有正冷卻
    assert.ok(isPassive ? (g.cd === 0 && g.cost === 0) : (g.cd > 0 && g.cost >= 0), gid + ' 冷卻/消耗不合法');
    assert.equal(g.tiers.length, c.SG_TIER_COUNT, gid + ' 階數不是 ' + c.SG_TIER_COUNT);
    g.tiers.forEach((t, i) => {
      assert.ok(t.name, gid + ' 第 ' + (i + 1) + ' 階缺名稱');
      assert.ok(t.goldBase > 0 && t.goldGrow >= 1, gid + ' 第 ' + (i + 1) + ' 階升級費用不合法');
      // 說明模板引用的 {鍵} 必須都在 fx 裡（顯示時代入計算值）
      String(t.desc || '').replace(/\{(\w+)\}/g, (m, key) => {
        assert.ok(t.fx[key] !== undefined, gid + ' 第 ' + (i + 1) + ' 階說明模板引用了不存在的參數 {' + key + '}');
        return m;
      });
    });
  });
});

test('SKILLS2 與 config/CSV/Skills2.csv 完整往返（每階一列）', () => {
  const c = loadContext();
  const csv = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8').replace(/^﻿/, '');
  const rows = csv.trim().split(/\r?\n/);
  let tierTotal = 0;
  Object.keys(c.SKILLS2).forEach((gid) => { tierTotal += c.SKILLS2[gid].tiers.length; });
  assert.equal(rows.length - 1, tierTotal, 'CSV 列數應為每階一列');
  assert.match(rows[0], /群組ID/);
  assert.match(rows[0], /range/);
  assert.match(rows[0], /效果參數\(JSON\)/);
});

test('突刺 1～7 階規格：數值、次數、距離與方向符合公開技能表', () => {
  const c = loadContext();
  const t = c.SKILLS2.thrust.tiers;
  assert.equal(c.SKILLS2.thrust.range, '6*2', '突刺初始範圍應由 range 欄位指定');
  assert.deepEqual(plain(c.sgRange(c.SKILLS2.thrust.range)), { length: 6, width: 2 });
  assert.deepEqual(plain(t.map((tier) => tier.fx)), [
    { pct: 300, pctPer: 30, count: 2 },
    { chance: 25, chancePer: 2.5, count: 2 },
    { pct: 30, pctPer: 10 },
    { count: 3, range: 20, rangePer: 2 },
    { pct: 20, pctPer: 2, count: 4 },
    { m: 10, mPer: 1 },
    { pct: 20, pctPer: 2, count: 3, directions: 8 }
  ]);
  assert.doesNotMatch(t[0].desc, /米×寬|\{m\}|\{width\}/, '初始範圍不應寫入遊戲說明');
  assert.match(t[3].desc, /\{count\} 道平行貫穿突刺/);
  assert.match(t[5].desc, /貫穿路徑上所有敵人/);
  assert.match(t[6].desc, /八個方向/);
});

/* ---- 2) 等級正規化 ---- */

test('sgEffectiveLevels：第 1 階預設開啟、上限夾限、前一階未達 Lv.1 時後續階視為 0', () => {
  const c = loadContext();
  // 沒有任何存檔資料：預設 [1,0,0,0,0,0,0]
  assert.deepEqual(plain(c.sgEffectiveLevels(null, 'thrust')), [1, 0, 0, 0, 0, 0, 0]);
  // 超上限夾到 10；小數取整
  assert.deepEqual(plain(c.sgEffectiveLevels({ thrust: [99, 3.7, 0, 0, 0, 0, 0] }, 'thrust')),
    [10, 3, 0, 0, 0, 0, 0]);
  // 斷層：第 2 階 0 級 → 第 3 階以後全部視為 0
  assert.deepEqual(plain(c.sgEffectiveLevels({ thrust: [5, 0, 4, 2, 0, 0, 0] }, 'thrust')),
    [5, 0, 0, 0, 0, 0, 0]);
  // 未知群組回傳 null
  assert.equal(c.sgEffectiveLevels({}, 'nope'), null);
});

/* ---- 3) 升級／降級指令 ---- */

test('skills2Learn：金幣不足拒絕、循序解鎖、扣款與寫入；skills2Downgrade：保底與依賴檢查', () => {
  const c = loadContext();
  c.G.player.gold = 0;
  assert.match(c.skills2Learn('thrust', 0), /金幣不足/);
  assert.match(c.skills2Learn('thrust', 2), /前一階/); // 第 3 階要先有第 2 階 Lv.1
  assert.match(c.skills2Learn('nope', 0), /未知/);
  assert.match(c.skills2Learn('thrust', 9), /未知階數/);

  const cost = c.skills2UpgradeCost('thrust', 0, 1); // 第 1 階目前 Lv.1 → 升 Lv.2 的費用
  c.G.player.gold = cost;
  assert.equal(c.skills2Learn('thrust', 0), null);
  assert.equal(c.G.player.gold, 0, '升級後金幣應扣光');
  assert.deepEqual(plain(c.G.player.skills2.levels.thrust), [2, 0, 0, 0, 0, 0, 0]);

  // 循序解鎖：投第 2 階後才能投第 3 階
  c.G.player.gold = 1e12;
  assert.equal(c.skills2Learn('thrust', 1), null);
  assert.equal(c.skills2Learn('thrust', 2), null);
  assert.deepEqual(plain(c.skills2Levels('thrust')).slice(0, 3), [2, 1, 1]);

  // 降級：後續階已投資時不可把前一階降到 0
  assert.match(c.skills2Downgrade('thrust', 1), /後續階數已投資/);
  assert.equal(c.skills2Downgrade('thrust', 2), null);
  assert.equal(c.skills2Downgrade('thrust', 1), null);
  assert.match(c.skills2Downgrade('thrust', 1), /尚未投資/);
  // 第 1 階至少保持 Lv.1
  assert.equal(c.skills2Downgrade('thrust', 0), null); // 2 → 1
  assert.match(c.skills2Downgrade('thrust', 0), /至少保持/);
});

test('升級費用＝基數 × 倍率^目前等級（取整）', () => {
  const c = loadContext();
  const t = c.SKILLS2.thrust.tiers[0];
  assert.equal(c.skills2UpgradeCost('thrust', 0, 0), Math.floor(t.goldBase));
  assert.equal(c.skills2UpgradeCost('thrust', 0, 3), Math.floor(t.goldBase * Math.pow(t.goldGrow, 3)));
});

/* ---- 4) 戰場幾何 ---- */

test('bfMeterPx：以「近戰攻擊距離＝5 米」換算（預設 1 米＝10 單位）', () => {
  const c = loadContext();
  assert.equal(c.bfMeterPx(5), c.bfMeleeRange());
  assert.equal(c.bfMeterPx(1), c.bfMeleeRange() / 5);
});

test('bfLineTargets：只命中線段沿線的敵人，依距離排序', () => {
  const c = loadContext();
  const a = enemy(100, 30, 0);    // 正前方近
  const b = enemy(100, 60, 0);    // 正前方遠
  const off = enemy(100, 30, 90); // 側方（線外）
  const far = enemy(100, 200, 0); // 線段長度外
  const hit = c.bfLineTargets(0, 70, [b, off, a, far]);
  assert.equal(hit.length, 2);
  assert.ok(hit[0] === a && hit[1] === b, '應依線上距離排序命中 a、b');
});

test('bfConeTargets：全張角與半徑過濾；bfNearestOthers：距離排序與 maxGap', () => {
  const c = loadContext();
  const front = enemy(100, 50, 0);     // 0 度：涵蓋
  const inside = enemy(100, 50, 25);   // 約 26.6 度：±30 度內，涵蓋
  const outside = enemy(100, 30, 40);  // 約 53 度：排除
  const side90 = enemy(100, 0, 50);    // 90 度：排除
  const cone = c.bfConeTargets(0, 60, 0, [side90, inside, outside, front]);
  assert.ok(cone.indexOf(front) >= 0 && cone.indexOf(inside) >= 0,
    '60 度全張角應涵蓋 ±30 度內的敵人');
  assert.ok(cone.indexOf(outside) < 0 && cone.indexOf(side90) < 0,
    '±30 度外的敵人應排除');
  const near = enemy(100, 60, 0);
  const mid = enemy(100, 120, 0);
  const farAway = enemy(100, 500, 0);
  const from = enemy(100, 40, 0);
  const others = c.bfNearestOthers(from, [farAway, mid, near, from], 2);
  assert.equal(others.length, 2);
  assert.ok(others[0] === near && others[1] === mid, '應依邊緣距離排序');
  const gapped = c.bfNearestOthers(from, [farAway, near, from], 5, 100);
  assert.equal(gapped.length, 1, 'maxGap 應擋掉遠敵');
  assert.ok(gapped[0] === near);
});

/* ---- 5) 施放機制 ---- */

test('突刺：Lv.1 對前方 6×2 米範圍造成 2 次命中；自身冷卻寫入；法力扣除', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false; // 關掉所有機率觸發
  const p = playerEnt();
  const m = enemy(1000, 40, 0);
  const out = c.castSkill2(p, [m], 'thrust', 'mv-float');
  assert.equal(calls.length, 2);
  assert.equal(out.dmg, 200);
  assert.equal(p.mp, 100 - c.SKILLS2.thrust.cost);
  assert.ok(p.skillCds['sg:thrust'] > 0, '應寫入群組冷卻');
  assert.equal(p.skillGcd, undefined, '技能 2 不應建立共用 GCD');
  assert.ok(p.skillCds['sg:thrust'] >= c.SKILL_MIN_CAST_INTERVAL, '自身冷卻不得低於技能施放最短間隔');
});

test('突刺·連刺：機率觸發時再追加 2 次突刺', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => true; // 所有機率觸發（含小數次數的補位）
  c.G.player.skills2.levels.thrust = [1, 1, 0, 0, 0, 0, 0];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.castSkill2(p, [m], 'thrust', 'mv-float');
  // 第 1 階 2 次 + 第 2 階追加 2 次＝4 次
  assert.equal(calls.length, 4);
});

test('突刺·超連刺與貫穿突刺：平行路徑上的目標都吃到飛行物命中', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  c.G.player.skills2.levels.thrust = [1, 1, 1, 1, 1, 1, 0]; // 開到 6 階（原 6 米範圍再加 10 米）
  const p = playerEnt();
  const a = enemy(1e9, 30, 0);
  const b = enemy(1e9, 60, 0);
  const off = enemy(1e9, 0, 300);
  c.castSkill2(p, [a, b, off], 'thrust', 'mv-float');
  assert.equal(calls.length, 0, '飛行物尚未推進時不應立即命中');
  c.GT = 0.5;
  c.tickSkill2(0.5, { pEnt: p, getEnemies: () => [a, b, off], floatSel: 'mv-float', onDeaths() {} });
  assert.ok(calls.indexOf(a) >= 0 && calls.indexOf(b) >= 0, '直線上兩敵都要命中');
  assert.equal(calls.indexOf(off), -1, '線外敵人不得命中');
  c.GT = 1.0;
  c.tickSkill2(0.5, { pEnt: p, getEnemies: () => [a, b, off], floatSel: 'mv-float', onDeaths() {} });
  assert.equal(calls.length, 24, '每道平行路徑的目標應在 0.5 秒後各追加命中一次');
  c.GT = 1.6;
  c.tickSkill2(0.6, { pEnt: p, getEnemies: () => [a, b, off], floatSel: 'mv-float', onDeaths() {} });
  assert.equal(calls.length, 24, '飛行物追加命中後應消失');
});

test('延遲飛行物技能：等所有飛行物結算後才顯示含總傷害的技能字', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const floats = [];
  c.floatText = (...args) => floats.push(args);
  c.chance = () => false;
  c.G.player.skills2.levels.thrust = [1, 1, 1, 1, 1, 1, 0];
  const p = playerEnt();
  const a = enemy(1e9, 30, 0);
  const out = c.castSkill2(p, [a], 'thrust', 'pv-float');
  assert.equal(out.dmg, 0, '飛行物尚未命中時不能提前取總傷害');
  const skillFloats = () => floats.filter((args) => String(args[2] || '').includes('skill-cast-total'));
  assert.equal(skillFloats().length, 0, '尚未命中時不得只顯示技能名稱');
  c.GT = 0.5;
  c.tickSkill2(0.5, { pEnt: p, getEnemies: () => [a], floatSel: 'pv-float', onDeaths() {} });
  c.GT = 1.0;
  c.tickSkill2(0.5, { pEnt: p, getEnemies: () => [a], floatSel: 'pv-float', onDeaths() {} });
  c.GT = 1.6;
  c.tickSkill2(0.6, { pEnt: p, getEnemies: () => [a], floatSel: 'pv-float', onDeaths() {} });
  assert.equal(skillFloats().length, 1, '所有飛行物完成後應只顯示一次技能總字');
  assert.match(skillFloats()[0][1], /\d/);
  assert.equal(skillFloats()[0][3], out.dmg);
  assert.ok(calls.length > 0);
});

test('八方突刺：八個方向連續 5 次（2＋3），所有方向目標都命中', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  c.G.player.skills2.levels.thrust = [1, 1, 1, 1, 1, 1, 1];
  const p = playerEnt();
  const targets = [];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    targets.push(enemy(1e9, Math.cos(a) * 60, Math.sin(a) * 60, '方向' + i));
  }
  const off = enemy(1e9, 0, 250);
  c.castSkill2(p, targets.concat(off), 'thrust', 'mv-float');
  c.GT = 0.5;
  c.tickSkill2(0.5, { pEnt: p, getEnemies: () => targets.concat(off), floatSel: 'mv-float', onDeaths() {} });
  assert.ok(targets.every((target) => calls.includes(target)), '八個方向目標都應命中');
  assert.ok(calls.length >= 40, '八方突刺應為第 1 階 2 次＋第 7 階 3 次，共 8 方向×5 次');
  assert.equal(calls.includes(off), false, '扇形外敵人不得命中');
  c.GT = 1.0;
  const beforeRepeat = calls.length;
  c.tickSkill2(0.5, { pEnt: p, getEnemies: () => targets.concat(off), floatSel: 'mv-float', onDeaths() {} });
  assert.ok(calls.length > beforeRepeat, '每個飛行物應在 0.5 秒後追加命中一次');
});

test('迴身雙連斬：前後左右各斬 3 次，且物理傷害額外 +10%', () => {
  const c = loadContext();
  const cfgs = [];
  const hits = new Map();
  c.chance = () => false;
  c.resolveHit = function (attacker, defender, attackCfg) {
    cfgs.push(attackCfg);
    hits.set(defender, (hits.get(defender) || 0) + 1);
    defender.hp = Math.max(0, defender.hp - 1);
    return { dmg: 1, crit: false, miss: false, blocked: false, killed: false };
  };
  c.G.player.skills2.levels.cleave = [1, 1, 1, 1, 1, 1, 1];
  const p = playerEnt();
  const front = enemy(1e9, 40, 0);
  const back = enemy(1e9, -40, 0);
  const right = enemy(1e9, 0, 40);
  const left = enemy(1e9, 0, -40);
  c.castSkill2(p, [front, back, right, left], 'cleave', 'mv-float');

  assert.equal(c.SKILLS2.cleave.tiers[6].fx.times, 3);
  assert.equal(c.SKILLS2.cleave.tiers[6].fx.pct, 10);
  assert.equal(cfgs.length, 0, '震碎斬飛行物應在施放時先不命中');
  c.GT = 0.5;
  c.tickSkill2(0.5, { pEnt: p, getEnemies: () => [front, back, right, left], floatSel: 'mv-float', onDeaths() {} });
  assert.equal(cfgs.length, 12, '前後左右四個方向各 3 次，應產生 12 次命中');
  for (const target of [front, back, right, left]) {
    assert.equal(hits.get(target), 3, '十字四方向的每個目標都應命中 3 次');
  }
  assert.ok(cfgs.every((cfg) => cfg.atk === 2300), '基礎 200%＋傷害強化 20%＋迴身雙連斬 10% 應為 230%');

  c.GT = 1.0;
  c.tickSkill2(0.5, { pEnt: p, getEnemies: () => [front, back, right, left], floatSel: 'mv-float', onDeaths() {} });
  assert.equal(cfgs.length, 24, '每條飛行物路徑應在 0.5 秒後再命中一次');

  const csv = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8');
  const row = csv.split(/\r?\n/).find((line) => line.includes(',7,迴身雙連斬,'));
  assert.ok(row && row.includes('""times"":3'), 'Skills2 CSV 應同步迴身雙連斬 3 次');
});

test('飛刀·神速飛刀：爆擊使群組冷卻縮短', () => {
  const c = loadContext();
  stubHits(c, { crit: true });
  c.chance = () => false;
  c.G.player.skills2.levels.knife = [1, 1, 1, 1, 1, 1, 1];
  const p = playerEnt();
  const a = enemy(1e9, 40, 0);
  const b = enemy(1e9, 80, 0);
  c.castSkill2(p, [a, b], 'knife', 'mv-float');
  const base = c.skills2Cooldown('knife', c.skills2Levels('knife'), p);
  assert.ok(p.skillCds['sg:knife'] < base, '每次爆擊應縮短冷卻（實際 ' + p.skillCds['sg:knife'] + ' < 基礎 ' + base + '）');
});

test('血刃斬：塗抹血刃流血；血毒刃同時中毒；作用間隔受強化流血縮短', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  // 階層循序解鎖：血毒刃（第 4 階）需要 1~3 階皆至少 Lv.1
  c.G.player.skills2.levels.bloodblade = [1, 1, 1, 1, 0, 0, 0];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.castSkill2(p, [m], 'bloodblade', 'mv-float');
  const bleed = m.dots.find((d) => d.sid === 'sgBleed');
  const poison = m.dots.find((d) => d.sid === 'sgPoison');
  assert.ok(bleed, '應塗抹血刃流血');
  assert.ok(poison, '血毒刃應同時中毒');
  const t = c.SKILLS2.bloodblade.tiers;
  const expectGap = t[0].fx.dotGap * (1 - c.sgVal(t[1].fx, 'gapPct', 1) / 100);
  assert.ok(Math.abs(bleed.interval - expectGap) < 1e-9, '流血間隔應被強化流血縮短');
  // 每跳量固定、間隔縮短 → dps 提高：dps = 每跳 ÷ 間隔
  const baseVal = 1000 * c.sgVal(t[0].fx, 'pct', 1) / 100;
  const expectTick = baseVal * c.sgVal(t[0].fx, 'dotPct', 1) / 100;
  assert.ok(Math.abs(bleed.dps * bleed.interval - expectTick) < 1e-6, '每跳傷害＝技能傷害 × dotPct%');
});

test('毒霧感染：傳染數量由 count 參數控制', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  c.G.player.skills2.levels.bloodblade = [1, 1, 1, 1, 1, 0, 0];
  const p = playerEnt();
  const source = enemy(1e9, 40, 0);
  const near1 = enemy(1e9, 50, 0);
  const near2 = enemy(1e9, 60, 0);
  const near3 = enemy(1e9, 70, 0);
  c.castSkill2(p, [source], 'bloodblade', 'mv-float');
  // 釘住表定值（表是唯一權威——Skills2.xlsx 調整後此處需同步）
  assert.equal(c.SKILLS2.bloodblade.tiers[4].fx.count, 2, '毒霧感染應有 count 參數（表定 2）');

  const spreadEvents = [];
  c.sgEmitVfx = (gid, targets, floatSel, spec) => {
    if (spec && spec.variant === 'poison-spread') spreadEvents.push({ from: targets[0], to: targets[1] });
  };
  c.SKILLS2.bloodblade.tiers[4].fx.count = 2;
  c.chance = (pct) => pct > 0;
  c.tickSkill2(0.5, {
    pEnt: p,
    getEnemies: () => [source, near1, near2, near3],
    floatSel: 'mv-float',
    onDeaths() {}
  });
  assert.equal(spreadEvents.filter((event) => event.from === source).length, 2);
  const infected = [near1, near2, near3].filter((e) => e.dots.some((d) => d.sid === 'sgPoison'));
  assert.equal(infected.length, 2, '毒霧感染應傳染給 2 個附近敵人');
});

test('零日感染：作用時機率立即結算剩餘持續傷害並清除狀態', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  // 零日感染在第 7 階：1~6 階皆需至少 Lv.1
  c.G.player.skills2.levels.bloodblade = [1, 1, 1, 1, 1, 1, 1];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.castSkill2(p, [m], 'bloodblade', 'mv-float');
  assert.ok(m.dots.some((d) => d.sid === 'sgBleed'));
  const hpAfterCast = m.hp;
  c.chance = () => true; // 下一次作用必定觸發零日感染
  c.tickSkill2(1.0, { pEnt: p, getEnemies: () => [m], floatSel: 'mv-float', onDeaths() {} });
  assert.ok(!m.dots.some((d) => d.sid === 'sgBleed'), '零日感染應清除流血');
  assert.ok(m.hp < hpAfterCast, '剩餘持續傷害應立即生效');
});

test('零日感染：流血與中毒傷害提高，結束後傳染兩種狀態給 80 米內隨機 1 敵人', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  c.G.player.skills2.levels.bloodblade = [1, 1, 1, 1, 1, 1, 1];
  const p = playerEnt();
  const source = enemy(1e9, 40, 0);
  const near = enemy(1e9, 120, 0);
  const far = enemy(1e9, 6000, 0);
  c.GT = 0;
  c.castSkill2(p, [source], 'bloodblade', 'mv-float');
  const bleed = source.dots.find((d) => d.sid === 'sgBleed');
  const poison = source.dots.find((d) => d.sid === 'sgPoison');
  assert.equal(Math.round(bleed.dps * bleed.interval), 720, '零日感染應使流血每跳傷害提高 20%');
  assert.equal(Math.round(poison.dps * poison.interval), 600, '零日感染應使中毒每跳傷害提高 20%');

  c.chance = (pct) => pct === c.SKILLS2.bloodblade.tiers[6].fx.chance;
  c.tickSkill2(1.0, { pEnt: p, getEnemies: () => [source, near, far], floatSel: 'mv-float', onDeaths() {} });
  assert.ok(near.dots.some((d) => d.sid === 'sgBleed'), '作用結束後應傳染流血');
  assert.ok(near.dots.some((d) => d.sid === 'sgPoison'), '作用結束後應傳染中毒');
  assert.equal(far.dots.length, 0, '超出 80 米的敵人不得成為傳染目標');
});

test('死亡屍爆：流血敵人死亡時對附近敵人造成傷害並傳染中毒', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  // 死亡屍爆在第 6 階：1~5 階皆需至少 Lv.1
  c.G.player.skills2.levels.bloodblade = [1, 1, 1, 1, 1, 1, 0];
  c.FIELD.player = playerEnt();
  const dead = enemy(0, 40, 0);
  dead.dots = [{ sid: 'sgBleed', dps: 10, until: 999, name: '血刃流血', interval: 1 }];
  c.GT = 0;
  const near1 = enemy(1e9, 60, 0);
  const near2 = enemy(1e9, 80, 0);
  c.skills2OnEnemyDeath(dead, [near1, near2]);
  assert.equal(calls.length, 2, '屍爆應命中附近 2 個敵人');
  assert.ok(near1.dots.some((d) => d.sid === 'sgPoison'), '屍爆應傳染中毒給第 1 個敵人');
  assert.ok(near2.dots.some((d) => d.sid === 'sgPoison'), '屍爆應傳染中毒給第 2 個敵人');
});

/* ---- 6) 暴風之舞 ---- */

test('暴風之舞：施放進入化身；期間自動施放、普攻旗標鎖定；到期清除', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  // 暴風之舞在第 7 階：1~6 階皆需至少 Lv.1
  c.G.player.skills2.levels.dualdance = [1, 1, 1, 1, 1, 1, 1];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.GT = 0;
  c.castSkill2(p, [m], 'dualdance', 'mv-float');
  assert.ok(c.skill2StormActive(), '施放後應進入暴風化身');
  const beforeMp = p.mp;
  const beforeCalls = calls.length;
  c.GT = 1.0; // 前進 1 秒 → 應觸發多次自動施放（每 0.35 秒一次）
  c.tickSkill2(0.1, { pEnt: p, getEnemies: () => [m], floatSel: 'mv-float', onDeaths() {} });
  assert.ok(calls.length > beforeCalls, '化身期間應自動施放');
  assert.equal(p.mp, beforeMp, '自動施放不扣法力');
  c.GT = 100; // 化身到期
  c.tickSkill2(0.1, { pEnt: p, getEnemies: () => [m], floatSel: 'mv-float', onDeaths() {} });
  assert.ok(!c.skill2StormActive(), '到期應清除化身');
});

/* ---- 裝載與施放選擇 ---- */

test("pickAndCastSkill：裝載 'sg:' 鍵可施放；equipSkillToLoadout 驗證未知群組", () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  c.G.player.loadout = [];
  assert.equal(c.equipSkillToLoadout('sg:thrust'), null);
  assert.match(c.equipSkillToLoadout('sg:nope'), /未知/);
  assert.match(c.equipSkillToLoadout('sg:thrust'), /已在裝載欄/);
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  const out = c.pickAndCastSkill(p, [m], 'mv-float');
  assert.ok(out && out.casting, '裝載後應在 CD 就緒時立即進入統一施放迴圈');
  assert.equal(out.castTime, c.SKILL_CAST_LOCK);
  c.tickSkillCast(p, c.SKILL_CAST_LOCK);
  assert.equal(calls.length, 2, '施放硬直結束後應套用兩段突刺傷害');
});

/* ---- 存檔常態化（save.js 讀檔防護與 sgEffectiveLevels 同規則） ---- */

test('save.js：skills2 常態化程式碼存在且與正規化規則一致（防手改存檔）', () => {
  const saveSrc = fs.readFileSync(path.join(root, 'js/save.js'), 'utf8');
  assert.match(saveSrc, /skills2/, 'save.js 應包含 skills2 常態化');
  assert.match(saveSrc, /SG_TIER_MAX_LV/, '夾限應以 SG_TIER_MAX_LV 為準');
});
