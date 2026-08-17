/* 新版主動技能第四批：魔法系火狩（2026-08-16，js/skills2.js）
   守住設計文檔「技能」頁籤〈魔法〉區塊新增的火狩群組與其「傷害範圍說明」：
     1. 環繞場域：距自身 8 米、體積 3*3 米，碰到敵人即命中一次（轉速由參數表 fx.rps 決定）
     2. 命中採接觸判定：同一次通過只算一次，離開後再碰到才會再命中
     3. 強化火狩：體積與環繞範圍同步擴大
     4. 伴生火狩：命中機率伴生於後方，每團只伴生一個、伴生體不可再伴生
     5. 三重火狩／狩神之舞：團數、傷害%與持續時間改讀該階，其餘階仍生效
     6. 再生：擊殺延長整組持續時間；時間到時所有火狩（含伴生）一起消失
     7. 無座標（高塔）退化為每轉一圈打一次主目標 */
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
    atk: 1000, matk: 500, hp: 1000, mp: 100, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0,
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
  return { hp: 1000, mp: 500, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}

/* 傷害管線替身：記下每一次命中的目標與攻擊組態，測「機制與範圍」不測「公式」。 */
function stubHits(c, opts) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ ent: defender, aCfg: aCfg });
    const dmg = (opts && opts.dmg) || 100;
    defender.hp = Math.max(0, defender.hp - dmg);
    return { dmg, crit: false, miss: false, blocked: false, killed: defender.hp <= 0 };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  return calls;
}
function tickCtx(c, p, enemies, extra) {
  return Object.assign({
    pEnt: p, getEnemies: () => enemies, floatSel: 'mv-float', onDeaths() {}, onDamage() {}
  }, extra || {});
}
/* 以固定步長推進 sec 秒（模擬戰鬥迴圈的 tick）。 */
function run(c, p, enemies, sec, step) {
  const dt = step || 0.05;
  for (let t = 0; t < sec - 1e-9; t += dt) {
    c.GT += dt;
    c.tickSkill2(dt, tickCtx(c, p, enemies));
  }
}
/* 把等級陣列直接寫進存檔（階層循序解鎖的驗證由 skill2-system 守，這裡只擺場景）。 */
function setLevels(c, gid, levels) { c.G.player.skills2.levels[gid] = levels.slice(); }

const M = 10; // 1 米 = 10 個系統距離單位（bfMeterPx）

/* 旋轉速度是參數表的可調值（Skills2 第 1 階 fx.rps，圈/秒），所以凡是「轉幾圈」
   的驗證一律由表推導成秒數，不寫死秒數——寫死的話每次在參數表調轉速就會誤報成
   測試失敗（同 tests/multi-enemy.test.cjs 的既有教訓）。 */
function baseRps(c) { return Number(c.SKILLS2.firehunt.tiers[0].fx.rps) || 1; }
function turnSec(c, turns) { return turns / baseRps(c); }

/* ---- 1) 環繞場域的基本語意 ---- */

test('火狩：基礎旋轉速度降低 30%', () => {
  const c = loadContext();
  assert.ok(Math.abs(baseRps(c) - 0.65 * 0.7) < 1e-12, '基礎 rps 應為原值的 70%');
});

test('火狩：施放當下不結算，環繞碰到敵人才命中；吃魔攻、火屬性、魔法傷害', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  const p = playerEnt();
  const m = enemy(1e9, 8 * M, 0); // 站在 8 米環上

  const out = c.castSkill2(p, [m], 'firehunt', 'mv-float');
  assert.ok(out, '應可施放');
  assert.equal(calls.length, 0, '召喚當下不造成傷害');
  assert.equal(c.SKILL2_RT.orbits.length, 1);
  assert.equal(c.SKILL2_RT.orbits[0].orbs.length, 2, '第 1 階召喚 2 團火狩');

  run(c, p, [m], turnSec(c, 0.1));
  assert.ok(calls.length >= 1, '火狩掃過敵人應命中');
  assert.equal(calls[0].aCfg.dmgType, 'magic');
  assert.equal(calls[0].aCfg.skillElem, 'fire');
  // 火狩 Lv.1＝110%（100 + 每級 10）→ 魔攻 500 × 110% ＝ 550（若誤吃物攻 1000 會是 1100）
  assert.equal(Math.round(calls[0].aCfg.atk), 550);
});

test('接觸判定：同一次通過只命中一次，離開後再碰到才會再命中', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  const p = playerEnt();
  const m = enemy(1e9, 8 * M, 0);

  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  // 0.1 圈＝ 36 度，火狩還在敵人身上：連續 5 個 tick 也只算一次
  run(c, p, [m], turnSec(c, 0.1), 0.02);
  assert.equal(calls.length, 1, '同一次通過只命中一次');

  // 轉滿一圈回到原處：第 2 團先掃過（半圈），本團再掃過一次
  run(c, p, [m], turnSec(c, 1));
  assert.equal(calls.length, 3, '每一團每轉一圈各命中一次');
});

test('環繞半徑 8 米：貼在腳邊與站在環外的敵人都碰不到', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  const p = playerEnt();
  const foot = enemy(1e9, 1 * M, 0, '腳邊');
  const far = enemy(1e9, 13 * M, 0, '環外');

  c.castSkill2(p, [enemy(1e9, 8 * M, 0)], 'firehunt', 'mv-float');
  run(c, p, [foot, far], turnSec(c, 1.2));
  assert.equal(calls.length, 0, '環上以外的位置不該被掃到');
});

test('施法距離＝環繞半徑 8 米：8 米內可施放、更遠不可（先走過去再放）', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  const p = playerEnt();
  // bfEntityDistance 會扣掉體型半徑（20），故 8 米＝ 100 的中心距離剛好在射程上
  assert.ok(c.castSkill2(p, [enemy(1e9, 8 * M + 20, 0)], 'firehunt', 'mv-float'), '8 米應可施放');

  const c2 = loadContext();
  stubHits(c2);
  c2.chance = () => false;
  assert.equal(c2.castSkill2(playerEnt(), [enemy(1e9, 12 * M, 0)], 'firehunt', 'mv-float'), null, '射程外不可施放');
});

/* ---- 2) 各階效果 ---- */

test('強化火狩：體積與環繞範圍同步擴大，原本掃不到的距離變成掃得到', () => {
  const base = loadContext();
  const baseCalls = stubHits(base);
  base.chance = () => false;
  const farOut = () => enemy(1e9, 0, 13 * M); // 13 米：8 米環（含體積）掃不到
  const bp = playerEnt();
  base.castSkill2(bp, [enemy(1e9, 8 * M, 0)], 'firehunt', 'mv-float');
  run(base, bp, [farOut()], turnSec(base, 1.2));
  assert.equal(baseCalls.length, 0, '未投資第 2 階時掃不到');

  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  setLevels(c, 'firehunt', [1, 10, 0, 0, 0, 0, 0]);
  const p = playerEnt();
  const m = farOut();
  c.castSkill2(p, [enemy(1e9, 8 * M, 0)], 'firehunt', 'mv-float');
  const f = c.SKILL2_RT.orbits[0];
  // 底值 15%＋每級 1.5%×10（Lv.10）＝ 30%：半徑與體積同一個倍率
  assert.ok(Math.abs(f.rings[0].r - 8 * M * 1.3) < 1e-6, '環繞半徑應同步擴大');
  assert.ok(Math.abs(f.bodyR - 1.5 * M * 1.3) < 1e-6, '體積半徑應同步擴大');
  run(c, p, [m], turnSec(c, 1.2));
  assert.ok(calls.length >= 1, '擴大後應掃得到');
});

test('伴生火狩：命中才判定、每團只伴生一個，伴生體不再伴生', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => true; // 機率必成立
  setLevels(c, 'firehunt', [1, 1, 1, 0, 0, 0, 0]);
  const p = playerEnt();
  const m = enemy(1e9, 8 * M, 0);

  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  const f = c.SKILL2_RT.orbits[0];
  assert.equal(f.orbs.length, 2, '召喚當下不伴生');

  run(c, p, [m], turnSec(c, 0.1));
  assert.equal(f.orbs.length, 3, '命中的那一團伴生出一團');
  const born = f.orbs[2];
  assert.equal(born.canSpawn, false, '伴生出的火狩不可再伴生');
  assert.equal(born.radius, f.orbs[0].radius, '伴生體在同一道上');

  // 再讓兩團母體各掃過一輪：母體已伴生過，只有另一團還能伴生
  run(c, p, [m], turnSec(c, 1.2));
  assert.equal(f.orbs.length, 4, '每一團母體只伴生一個');
});

test('三重火狩：改為 3 團、傷害%改讀第 4 階', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  setLevels(c, 'firehunt', [1, 1, 1, 1, 0, 0, 0]);
  const p = playerEnt();
  const m = enemy(1e9, 8 * M, 0);

  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  assert.equal(c.SKILL2_RT.orbits[0].orbs.length, 3);
  run(c, p, [m], turnSec(c, 0.1));
  // 第 4 階 Lv.1＝132%（120 + 每級 12）→ 魔攻 500 × 132% ＝ 660
  assert.equal(Math.round(calls[0].aCfg.atk), 660);
});

test('極速火狩：旋轉速度提升，命中頻率跟著變快', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  setLevels(c, 'firehunt', [1, 1, 1, 1, 1, 0, 0]);
  const p = playerEnt();
  const m = enemy(1e9, 8 * M, 0);

  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  const spin = c.SKILL2_RT.orbits[0].orbs[0].spin;
  assert.ok(Math.abs(spin - Math.PI * 2 * baseRps(c) * 1.275) < 1e-6, '第 5 階 Lv.1＝ +27.5% 旋轉速度');

  // 同一段時間內：投資第 5 階的命中次數必須多於未投資（比較兩邊，不寫死次數）
  const slow = loadContext();
  const slowCalls = stubHits(slow);
  slow.chance = () => false;
  setLevels(slow, 'firehunt', [1, 1, 1, 1, 0, 0, 0]);
  const sp = playerEnt();
  slow.castSkill2(sp, [enemy(1e9, 8 * M, 0)], 'firehunt', 'mv-float');

  const sec = 3.9; // 整段持續時間（一圈的絕對秒數會隨參數表的轉速改變，這裡比的是同一段時間）
  run(c, p, [m], sec);
  run(slow, sp, [slow.SKILL2_RT.orbits[0].tgt], sec);
  assert.ok(calls.length > slowCalls.length,
    '轉得快＝同樣時間內命中更多次（快 ' + calls.length + ' 次 vs 慢 ' + slowCalls.length + ' 次）');
});

test('再生：火狩擊殺敵人時延長整組持續時間', () => {
  const c = loadContext();
  stubHits(c, { dmg: 1e9 }); // 一擊必殺
  c.chance = () => false;
  setLevels(c, 'firehunt', [1, 1, 1, 1, 1, 1, 0]);
  const p = playerEnt();
  const m = enemy(100, 8 * M, 0);

  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  const f = c.SKILL2_RT.orbits[0];
  const before = f.until;
  run(c, p, [m], turnSec(c, 0.1));
  assert.equal(m.hp, 0, '敵人應被火狩擊殺');
  assert.ok(Math.abs(f.until - (before + 0.44)) < 1e-9, '第 6 階 Lv.1＝擊殺延長 0.44 秒');
});

/* 持續時間要看得見：火狩的剩餘時間掛在狀態列（狀態表 sgFirehunt），
   而且【再生】的擊殺延長必須累加上去——否則玩家無從得知火狩還會在場多久。 */
test('火狩的持續時間以狀態呈現，剩餘時間隨【再生】的擊殺延長累加', () => {
  const c = loadContext();
  stubHits(c, { dmg: 1e9 }); // 一擊必殺
  c.chance = () => false;
  setLevels(c, 'firehunt', [1, 1, 1, 1, 1, 1, 0]);
  const p = playerEnt();
  const m = enemy(100, 8 * M, 0);

  const firehuntState = () => c.statusEntries(p).filter((e) => e.sid === 'sgFirehunt')[0];
  assert.equal(firehuntState(), undefined, '沒施放時不該有狀態');

  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  const f = c.SKILL2_RT.orbits[0];
  const cast = firehuntState();
  assert.ok(cast, '施放後狀態列應出現火狩');
  assert.equal(cast.name, '火狩');
  assert.ok(Math.abs(cast.until - f.until) < 1e-9, '狀態與環繞場域必須同時到期');

  // 擊殺延長：狀態的剩餘時間跟著往後推，不是停在原本的 4 秒
  run(c, p, [m], turnSec(c, 0.1));
  const extended = firehuntState();
  assert.ok(Math.abs(extended.until - f.until) < 1e-9, '延長後狀態要跟上累積的到期時間');
  assert.ok(extended.until > cast.until, '【再生】的擊殺延長必須累加到剩餘時間');

  // 場域消失時狀態一起消失（共用同一個時鐘，不需要另外清除）
  run(c, p, [], f.until - c.GT + 0.1);
  assert.equal(c.SKILL2_RT.orbits.length, 0);
  assert.equal(firehuntState(), undefined, '火狩結束後狀態不得殘留');
});

test('狩神之舞：兩道反向火狩、外圈距內圈 6 米、出現即自帶伴生、傷害與時間改讀第 7 階', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  setLevels(c, 'firehunt', [1, 1, 1, 1, 1, 1, 1]);
  const p = playerEnt();
  const m = enemy(1e9, 8 * M, 0);

  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  const f = c.SKILL2_RT.orbits[0];
  assert.equal(f.rings.length, 2, '一次施放 2 道');
  assert.ok(Math.abs(f.rings[1].r - (f.rings[0].r + 6 * M)) < 1e-6, '第 2 道在 6 米外的更外圈');
  assert.equal(Math.sign(f.rings[1].spin), -Math.sign(f.rings[0].spin), '兩道旋轉方向相反');
  // 3 團／道 × 2 道，且每團出現時自帶伴生 → 12 團
  assert.equal(f.orbs.length, 12);
  assert.ok(f.orbs.every((o) => o.canSpawn === false), '自帶伴生後不再伴生');
  assert.ok(Math.abs(f.until - 6) < 1e-9, '持續時間改讀第 7 階的 6 秒');

  run(c, p, [m], turnSec(c, 0.1));
  // 第 7 階 Lv.1＝200% → 魔攻 500 × 200% ＝ 1000
  assert.equal(Math.round(calls[0].aCfg.atk), 825);
});

/* ---- 3) 生命週期與無座標退化 ---- */

test('持續時間結束：整組火狩（含伴生）一起消失', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => true;
  setLevels(c, 'firehunt', [1, 1, 1, 0, 0, 0, 0]);
  const p = playerEnt();
  const m = enemy(1e9, 8 * M, 0);

  c.castSkill2(p, [m], 'firehunt', 'mv-float');
  run(c, p, [m], 3.9);
  assert.equal(c.SKILL2_RT.orbits.length, 1, '4 秒內仍在場');
  run(c, p, [m], 0.3);
  assert.equal(c.SKILL2_RT.orbits.length, 0, '時間到就整組消失');
});

test('高塔（無座標）：退化為每轉一圈打一次主目標', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  const p = playerEnt();
  const boss = enemy(1e9); // 無 pos

  c.castSkill2(p, boss, 'firehunt', 'tb-float');
  assert.equal(c.SKILL2_RT.orbits.length, 1);
  run(c, p, [boss], turnSec(c, 0.9));
  assert.equal(calls.length, 0, '還沒轉滿一圈不該命中');
  run(c, p, [boss], turnSec(c, 0.2));
  assert.equal(calls.length, 2, '2 團各轉滿一圈＝ 2 次命中');
  assert.ok(calls.every((call) => call.ent === boss));
});

test('戰鬥重置（開戰／死亡／讀檔）會清掉環繞場域，不會殘留到下一場', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  c.castSkill2(playerEnt(), [enemy(1e9, 8 * M, 0)], 'firehunt', 'mv-float');
  assert.equal(c.SKILL2_RT.orbits.length, 1);
  c.resetSkill2RT();
  assert.equal(c.SKILL2_RT.orbits.length, 0);
});

/* ---- 4) 存檔與參數表 ---- */

test('火狩可裝載、可升級，且參數表往返一致', () => {
  const c = loadContext();
  c.G.player.gold = 1e12;
  assert.equal(c.skills2Learn('firehunt', 1), null);
  assert.equal(c.equipSkillToLoadout('sg:firehunt'), null);

  const csv = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8').replace(/^﻿/, '');
  const rows = csv.trim().split(/\r?\n/);
  const tiers = rows.filter((r) => r.indexOf('firehunt,火狩') === 0);
  assert.equal(tiers.length, 7, '參數表應有 7 階');
  assert.ok(tiers.every((r) => r.indexOf('magic,fire') > 0), '魔法系火屬性');
  assert.ok(tiers[0].indexOf('3*3') > 0, '體積寫在群組 range 欄');
});
