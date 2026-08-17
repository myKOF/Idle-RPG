/* 新版主動技能第六批：雷系三群組（2026-08-17，js/skills2.js）
   守住設計文檔「技能」頁籤〈魔法〉區塊新增的三個群組與其註記：
     連鎖閃電 chainlightning ─ 逐跳彈射的閃電鏈；第 6 階【雷幻身】以自身當中繼點
     落雷術   thunderstrike  ─ 天降打擊；落地才結算，暈眩塗在傷害之後
     雷球     thunderorb     ─ 移動場域＋環繞場域＋天降打擊三形態共用既有基建
   以及使用者於實作前的三項決策：
     - 電殛擴散（連鎖閃電 T5）升級量為每級 +2.5%（文檔的 +25% 判定為少一位小數）
     - 雷幻身（連鎖閃電 T6）的 +50% 為整道鏈恆時生效
     - 雷殞天落（雷球 T7）為「追加」而非「改為」：飛行雷球照常召喚 */
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
function setLevels(c, gid, levels) { c.G.player.skills2.levels[gid] = levels.slice(); }
function forceRolls(c, value) { c.Math.random = () => value; }   // 0＝機率必中、0.999＝必不中

const M = 10; // 1 米 = 10 個系統距離單位（bfMeterPx）

/* ===========================================================================
   0) 定義表
   =========================================================================== */

test('三個新群組都在表上：雷屬性、魔法傷害、七階、皆為主動技', () => {
  const c = loadContext();
  const cds = { chainlightning: 18, thunderstrike: 14, thunderorb: 20 };
  Object.keys(cds).forEach((gid) => {
    const g = c.SKILLS2[gid];
    assert.ok(g, gid + ' 不在 SKILLS2');
    assert.equal(g.dmgType, 'magic', gid + ' 應為魔法傷害');
    assert.equal(g.elem, 'lightning', gid + ' 應為雷屬性');
    assert.equal(g.tiers.length, c.SG_TIER_COUNT);
    assert.equal(g.cd, cds[gid], gid + ' 冷卻時間應與設計文檔一致');
    assert.equal(c.skills2IsPassive(gid), false, gid + ' 是主動技');
  });
});

test('說明模板採用文檔上方的屬性用語「雷電傷害」', () => {
  const c = loadContext();
  const descs = ['chainlightning', 'thunderstrike', 'thunderorb']
    .map((gid) => c.SKILLS2[gid].tiers.map((t) => t.desc).join('\n')).join('\n');
  assert.match(descs, /雷電傷害/);
  assert.ok(!/雷屬性傷害|閃電屬性傷害/.test(descs), '不得混用舊用語');
});

test('電殛擴散的升級量為每級 +2.5%（使用者決策：文檔的 +25% 判定為少一位小數）', () => {
  const c = loadContext();
  const fx = c.SKILLS2.chainlightning.tiers[4].fx;
  assert.equal(fx.pct, 25);
  assert.equal(fx.pctPer, 2.5);
});

test('環體電球的剩餘時間有自己的狀態，不與火狩共用一格', () => {
  const c = loadContext();
  assert.ok(c.STATUS.sgThunderOrb, 'sgThunderOrb 不在狀態表');
  assert.equal(c.STATUS.sgThunderOrb.stack, 'refresh');
  assert.equal(c.STATUS.sgThunderOrb.elem, 'lightning');
  assert.notEqual(c.STATUS.sgThunderOrb.key, c.STATUS.sgFirehunt.key);
});

/* ===========================================================================
   1) 連鎖閃電
   =========================================================================== */

test('連鎖閃電 T1：吃魔攻，在最多 4 個目標間彈射，每擊 165%（150 + 每級 15）', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 5 * M, 0), enemy(1e9, 8 * M, 0), enemy(1e9, 11 * M, 0),
    enemy(1e9, 14 * M, 0), enemy(1e9, 17 * M, 0)];
  setLevels(c, 'chainlightning', [1, 0, 0, 0, 0, 0, 0]);
  c.castSkill2(p, es, 'chainlightning', 'mv-float');
  assert.equal(calls.length, 4, '4 個目標＝4 擊');
  calls.forEach((call) => assert.ok(Math.abs(call.atk - 500 * 1.65) < 1e-9, '165% 魔攻（不是物攻）'));
  const hitSet = new Set(calls.map((call) => call.ent));
  assert.equal(hitSet.size, 4, '同一輪不重複跳同一個敵人');
});

test('連鎖閃電 T2：強化閃電與本體傷害累加', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 5 * M, 0), enemy(1e9, 8 * M, 0)];
  setLevels(c, 'chainlightning', [1, 1, 0, 0, 0, 0, 0]);
  c.castSkill2(p, es, 'chainlightning', 'mv-float');
  assert.ok(Math.abs(calls[0].atk - 500 * 2.2) < 1e-9, '165% + 55% ＝ 220% 魔攻');
});

/* 以下的等級陣列一律是累積的：前一階未達 Lv.1 時後續階視為 Lv.0（sgEffectiveLevels），
   因此驗第 N 階時，第 1~N-1 階的效果必然同時生效，期望值要一起算進去。
   另外：Lv.1 已含 1 級升級效果，追加次數／目標數類（add）在 Lv.1 就帶小數
   （雷鳴術 1+0.1＝1.1），小數部分以機率觸發，因此凡是驗「段數」的測試都要先
   forceRolls(0.999) 關掉那一擲，否則段數會忽多忽少。 */

test('連鎖閃電 T3：雷鳴術讓每個被擊中的敵人多吃一次', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 5 * M, 0), enemy(1e9, 8 * M, 0), enemy(1e9, 11 * M, 0), enemy(1e9, 14 * M, 0)];
  setLevels(c, 'chainlightning', [1, 1, 1, 0, 0, 0, 0]);
  forceRolls(c, 0.999);       // 關掉 add 小數部分的擲骰，只留整數 1 次
  c.castSkill2(p, es, 'chainlightning', 'mv-float');
  assert.equal(calls.length, 8, '4 個目標 × (1 + 1 次額外)');
  calls.forEach((call) => assert.ok(Math.abs(call.atk - 500 * 2.2) < 1e-9, '含 T2 的 165%+55%'));
});

test('連鎖閃電 T4：強化連鎖讓彈射數 +1（＝多一個目標）', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [];
  for (let i = 0; i < 6; i++) es.push(enemy(1e9, (5 + i * 3) * M, 0));
  setLevels(c, 'chainlightning', [1, 1, 1, 1, 0, 0, 0]);
  forceRolls(c, 0.999);
  c.castSkill2(p, es, 'chainlightning', 'mv-float');
  assert.equal(new Set(calls.map((call) => call.ent)).size, 5, '4 + 1 個目標');
  assert.equal(calls.length, 10, '5 個目標 × (1 + T3 的 1 次額外)');
});

test('連鎖閃電 T5：電殛擴散只在「彈射」時追加，且起手那一擊不算', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  // 一條直線上六個敵人，彼此相距 3 米（鄰居都在擴散的 6 米內）
  const es = [];
  for (let i = 0; i < 6; i++) es.push(enemy(1e9, (5 + i * 3) * M, 0));
  setLevels(c, 'chainlightning', [1, 1, 1, 1, 1, 0, 0]);
  forceRolls(c, 0.999);
  c.castSkill2(p, es, 'chainlightning', 'mv-float');
  // 5 個目標 ×（本體 + 雷鳴術 1 次）＝ 10，再加 4 次彈射各 1 個擴散目標
  assert.equal(calls.length, 14);
  const splash = calls.filter((call) => Math.abs(call.atk - 500 * 2.2 * 0.275) < 1e-9);
  assert.equal(splash.length, 4, '擴散傷害＝閃電鏈傷害的 27.5%，且起手不算彈射');
});

test('連鎖閃電 T6：雷幻身讓單一敵人也吃滿整條鏈，且整道鏈 +55%', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const only = enemy(1e9, 5 * M, 0);
  setLevels(c, 'chainlightning', [1, 1, 1, 1, 1, 1, 0]);
  forceRolls(c, 0.999);
  c.castSkill2(p, [only], 'chainlightning', 'mv-float');
  assert.equal(calls.length, 10, '以自身當中繼點：5 段 ×（本體 + 雷鳴術）全落在唯一的敵人身上');
  calls.forEach((call) => assert.ok(Math.abs(call.atk - 500 * 2.75) < 1e-9, '165% + 55% + 55% ＝ 275% 魔攻'));

  const c2 = loadContext();
  const calls2 = stubHits(c2);
  setLevels(c2, 'chainlightning', [1, 1, 1, 1, 1, 0, 0]);
  forceRolls(c2, 0.999);
  c2.castSkill2(playerEnt(), [enemy(1e9, 5 * M, 0)], 'chainlightning', 'mv-float');
  assert.equal(calls2.length, 2, '沒有雷幻身時，單一敵人只吃起手那一段（含雷鳴術追加）');
});

test('連鎖閃電 T7：雷電暴風＝三道鏈、彈射 +1、傷害 +110%', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [];
  for (let i = 0; i < 7; i++) es.push(enemy(1e9, (5 + i * 3) * M, 0));
  setLevels(c, 'chainlightning', [1, 1, 1, 1, 1, 1, 1]);
  forceRolls(c, 0.999);
  c.castSkill2(p, es, 'chainlightning', 'mv-float');
  // 每道鏈：6 個目標 ×（本體 + 雷鳴術）＝ 12，加 5 次彈射的擴散 ＝ 17；三道共 51
  assert.equal(calls.length, 51, '3 道 × 17 段');
  assert.ok(Math.abs(calls[0].atk - 500 * 3.85) < 1e-9, '165% + 55% + 55% + 110% ＝ 385% 魔攻');
});

test('連鎖閃電：彈射範圍外的敵人不會被跳到', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  // 第二個敵人距第一個 40 米，超出表定的 30 米彈射範圍
  const es = [enemy(1e9, 5 * M, 0), enemy(1e9, 45 * M, 0)];
  setLevels(c, 'chainlightning', [1, 0, 0, 0, 0, 0, 0]);
  c.castSkill2(p, es, 'chainlightning', 'mv-float');
  assert.equal(calls.length, 1, '跳不到就結束，不會硬跳');
});

test('連鎖閃電：上一個目標死亡仍保留為下一段 VFX 的起點', () => {
  const c = loadContext();
  stubHits(c);
  const specs = stubVfx(c);
  const p = playerEnt();
  const dead = enemy(50, 5 * M, 0, 'A');
  const next = enemy(1e9, 8 * M, 0, 'B');
  const third = enemy(1e9, 11 * M, 0, 'C');
  setLevels(c, 'chainlightning', [1, 0, 0, 0, 0, 0, 0]);

  c.castSkill2(p, [dead, next, third], 'chainlightning', 'mv-float');

  assert.equal(dead.hp, 0, '第一個目標應死亡');
  assert.ok(next.hp < next.maxHp, '死亡後仍應繼續命中下一個目標');
  assert.ok(specs.some((spec) => spec.variant === 'lightning-chain' &&
    spec.targets[0] === 'A' && spec.targets[1] === 'B'),
  '上一個死亡目標仍應保留為下一段閃電鏈的起點');
});

/* ===========================================================================
   2) 落雷術
   =========================================================================== */

test('落雷術 T1：施放當下不結算，落地才扣血；表定 2 個目標', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 5 * M, 0), enemy(1e9, 9 * M, 0), enemy(1e9, 13 * M, 0)];
  setLevels(c, 'thunderstrike', [1, 0, 0, 0, 0, 0, 0]);
  const out = c.castSkill2(p, es, 'thunderstrike', 'mv-float');
  assert.ok(out, '應可施放');
  assert.equal(calls.length, 0, '天降打擊在落地前不得結算');
  run(c, p, es, 3);
  assert.equal(calls.length, 2, '2 道落雷、各 1 次');
  calls.forEach((call) => assert.ok(Math.abs(call.atk - 500 * 2.2) < 1e-9, '220% 魔攻'));
});

test('落雷術 T2／T3：目標數與每目標次數各自追加', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 5 * M, 0), enemy(1e9, 9 * M, 0), enemy(1e9, 13 * M, 0), enemy(1e9, 17 * M, 0)];
  setLevels(c, 'thunderstrike', [1, 1, 1, 0, 0, 0, 0]);
  forceRolls(c, 0.999);
  c.castSkill2(p, es, 'thunderstrike', 'mv-float');
  run(c, p, es, 3);
  assert.equal(calls.length, 6, '(2+1) 個目標 × (1+1) 次');
});

test('落雷術 T4：閃電增幅與本體累加', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 5 * M, 0), enemy(1e9, 9 * M, 0), enemy(1e9, 13 * M, 0), enemy(1e9, 17 * M, 0)];
  setLevels(c, 'thunderstrike', [1, 1, 1, 1, 0, 0, 0]);
  forceRolls(c, 0.999);
  c.castSkill2(p, es, 'thunderstrike', 'mv-float');
  run(c, p, es, 3);
  assert.equal(calls.length, 6, '(2+1) 個目標 × (1+1) 次');
  assert.ok(Math.abs(calls[0].atk - 500 * 3.3) < 1e-9, '220% + 110% ＝ 330% 魔攻');
});

test('落雷術 T5：雷電脈衝在落地後暈眩目標本身與 6 米內的 1 個敵人', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const near = enemy(1e9, 8 * M, 0);
  const far = enemy(1e9, 40 * M, 0);      // 射程外：不會被選為落點，也不在衝擊波範圍內
  const es = [enemy(1e9, 5 * M, 0), near, far];
  setLevels(c, 'thunderstrike', [1, 1, 1, 1, 1, 0, 0]);
  c.castSkill2(p, es, 'thunderstrike', 'mv-float');
  run(c, p, es, 3);
  assert.ok(c.effectActive(es[0], 'stun'), '落點目標必暈');
  assert.ok(c.effectActive(near, 'stun'), '6 米內的鄰居也被震暈');
  assert.ok(!c.effectActive(far, 'stun'), '範圍外不受影響');
});

test('落雷術 T5：BOSS 控場免疫擋得住落雷的暈眩', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const boss = enemy(1e9, 5 * M, 0, '王');
  boss.isBoss = true;
  const es = [boss];
  setLevels(c, 'thunderstrike', [1, 1, 1, 1, 1, 0, 0]);
  c.castSkill2(p, es, 'thunderstrike', 'mv-float');
  run(c, p, es, 3);
  assert.equal(c.effectActive(boss, 'stun'), false);
});

test('落雷術 T6：迅雷重生會再生落雷，且夾在表定上限', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 5 * M, 0)];
  setLevels(c, 'thunderstrike', [1, 1, 1, 1, 1, 1, 0]);
  forceRolls(c, 0);           // 機率必中（連 add 的小數部分也必中：1.1 → 2）
  c.castSkill2(p, es, 'thunderstrike', 'mv-float');
  run(c, p, es, 20);
  // (2+2) 個目標 × (1+2) 次 ＝ 12 道；每道最多再接力 5 道
  assert.equal(calls.length, 12 + 12 * 5, '每道落雷最多接力 5 次');
});

test('落雷術 T7：次數與目標數 ×2，且暈眩中的敵人吃額外增傷', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 5 * M, 0), enemy(1e9, 20 * M, 0)];
  setLevels(c, 'thunderstrike', [1, 1, 1, 1, 1, 1, 1]);
  forceRolls(c, 0.999);       // 關掉迅雷重生的機率，只驗倍率與增傷
  c.castSkill2(p, es, 'thunderstrike', 'mv-float');
  run(c, p, es, 6);
  assert.equal(calls.length, 24, '((2+1) 目標 × (1+1) 次) × 2 × 2');
  const boosted = calls.filter((call) => call.aCfg.totalDmgPct === 33);
  assert.ok(boosted.length > 0, '先落的雷把人暈住後，後落的雷吃到 +33%');
  assert.equal(calls[0].aCfg.totalDmgPct, 0, '第一道落雷時還沒人被暈');
});

/* ===========================================================================
   3) 雷球
   =========================================================================== */

test('雷球 T1：召喚 2 顆移動場域，飛行途中按節拍打範圍，抵達後停留', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 20 * M, 0)];
  setLevels(c, 'thunderorb', [1, 0, 0, 0, 0, 0, 0]);
  c.castSkill2(p, es, 'thunderorb', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.length, 2, '表定 2 顆雷球');
  const orb = c.SKILL2_RT.grounds[0];
  assert.equal(orb.kind, 'orb');
  assert.ok(orb.dest && Math.abs(orb.dest.x - 20 * M) < 1e-9, '目的地＝目標當下的位置');
  const startX = orb.pos.x;
  run(c, p, es, 0.5);
  assert.ok(orb.pos.x > startX, '雷球會朝目標移動');
  assert.equal(calls.length, 0, '還沒飛到敵人身邊時打不到人（範圍只有半徑 3 米）');
  run(c, p, es, 4.5);
  assert.ok(calls.length > 0, '飛進範圍後每 0.35 秒作用一次');
  assert.ok(Math.abs(calls[0].atk - 500 * 0.55) < 1e-9, '每拍 55% 魔攻');
  run(c, p, es, 10);
  assert.equal(c.SKILL2_RT.grounds.length, 0, '停留時間結束後消散');
});

test('雷球 T2／T3：體積擴大與數量追加', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 20 * M, 0)];
  setLevels(c, 'thunderorb', [1, 1, 1, 0, 0, 0, 0]);
  forceRolls(c, 0.999);
  c.castSkill2(p, es, 'thunderorb', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.length, 3, '2 + 1 顆');
  assert.ok(Math.abs(c.SKILL2_RT.grounds[0].radius - 3 * M * 1.165) < 1e-6, '半徑擴大 16.5%');
});

test('雷球 T4：環體電球是環繞場域，並掛上自己的剩餘時間狀態', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 20 * M, 0)];
  setLevels(c, 'thunderorb', [1, 1, 1, 1, 0, 0, 0]);
  c.castSkill2(p, es, 'thunderorb', 'mv-float');
  assert.equal(c.SKILL2_RT.orbits.length, 1);
  const field = c.SKILL2_RT.orbits[0];
  assert.equal(field.orbs.length, 2, '2 個環體電球');
  assert.equal(field.statusId, 'sgThunderOrb');
  assert.ok(c.effectActive(p, 'sgThunderOrb') || p.buffs.sgThunderOrb, '玩家身上看得到剩餘時間');
  assert.ok(!p.buffs.sgFirehunt, '不得佔用火狩那一格');
});

test('雷球 T5：強化雷球同時作用在飛行雷球、環體電球與雷殞天落', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 6 * M, 0)];
  setLevels(c, 'thunderorb', [1, 1, 1, 1, 1, 1, 1]);
  forceRolls(c, 0.999);        // 關掉伴生機率，只驗傷害倍率
  c.castSkill2(p, es, 'thunderorb', 'mv-float');
  const flying = c.SKILL2_RT.grounds[0];
  assert.ok(Math.abs(flying.dmgVal - 500 * (55 + 33) / 100) < 1e-9, '飛行雷球 55% + 33%');
  assert.ok(Math.abs(c.SKILL2_RT.orbits[0].dmgVal - 500 * (110 + 33) / 100) < 1e-9, '環體電球 110% + 33%');
  run(c, p, es, 2.5);
  const fall = calls.filter((call) => Math.abs(call.atk - 500 * (330 + 33) / 100) < 1e-9);
  assert.ok(fall.length > 0, '雷殞天落 330% + 33%');
});

test('雷球 T6：伴生雷球在環體電球命中處留下靜止雷球', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 8 * M, 0)];
  setLevels(c, 'thunderorb', [1, 1, 1, 1, 1, 1, 0]);
  forceRolls(c, 0);            // 伴生機率必中
  c.castSkill2(p, es, 'thunderorb', 'mv-float');
  run(c, p, es, 1.5);
  // 飛行雷球飛到定點後 dest 會清空，因此以「速度 0」辨識靜止雷球
  const stationary = c.SKILL2_RT.grounds.filter((f) => f.speed === 0);
  assert.ok(stationary.length > 0, '環體電球命中後在該處生出靜止雷球');
  assert.ok(Math.abs(stationary[0].dmgVal - c.SKILL2_RT.grounds[0].dmgVal) < 1e-9,
    '靜止雷球的每拍傷害比照飛行雷球');
});

test('雷球 T7：雷殞天落是追加（飛行雷球照常召喚），落地暈眩', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 6 * M, 0)];
  setLevels(c, 'thunderorb', [1, 1, 1, 1, 1, 1, 1]);
  forceRolls(c, 0.999);        // 關掉伴生機率，讓場域數量可預期
  c.castSkill2(p, es, 'thunderorb', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.length, 3, '第 7 階不取代飛行雷球（2 + T3 的 1 顆）');
  assert.equal(c.SKILL2_RT.meteors.length, 2, '再追加 2 顆從天而降的巨大雷球');
  run(c, p, es, 2);
  assert.ok(calls.some((call) => Math.abs(call.atk - 500 * (330 + 33) / 100) < 1e-9), '巨雷球 330% + 33%');
  assert.ok(c.effectActive(es[0], 'stun'), '命中地面的衝擊波擊暈敵人');
});

/* ===========================================================================
   4) 共用基建泛用化後，火系行為不得改變
   =========================================================================== */

test('泛用化後火狩仍用自己的狀態與火焰特效', () => {
  const c = loadContext();
  stubHits(c);
  const specs = stubVfx(c);
  const p = playerEnt();
  const es = [enemy(1e9, 8 * M, 0)];    // 站在火狩的環繞半徑上，轉一圈必定碰到
  setLevels(c, 'firehunt', [1, 0, 0, 0, 0, 0, 0]);
  c.castSkill2(p, es, 'firehunt', 'mv-float');
  assert.equal(c.SKILL2_RT.orbits[0].statusId, 'sgFirehunt');
  const aura = specs.filter((s) => s.variant === 'firehunt');
  assert.equal(aura.length, 1, '環繞特效仍是 firehunt');
  assert.equal(aura[0].elem, 'fire', '屬性仍由群組帶入');
  run(c, p, es, 2.5);
  assert.ok(specs.some((s) => s.variant === 'fire-explosion'), '命中特效仍是火焰爆點');
});

test('泛用化後殞石術仍走 fireball 的落地結算與燃燒', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 5 * M, 0)];
  setLevels(c, 'fireball', [1, 1, 1, 1, 1, 1, 1]);
  c.castSkill2(p, es, 'fireball', 'mv-float');
  assert.equal(c.SKILL2_RT.meteors.length, 3, '三顆殞石');
  assert.equal(c.SKILL2_RT.meteors[0].gid, 'fireball');
  run(c, p, es, 2);
  assert.ok(calls.length >= 3);
  assert.ok(c.sgHasDot(es[0], 'sgBurn'), '殞石仍會點燃');
});

/* ===========================================================================
   5) 特效協議
   =========================================================================== */

test('三個技能都送出雷屬性的特效事件（鏈、天降、球體場域）', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const es = [enemy(1e9, 5 * M, 0), enemy(1e9, 9 * M, 0)];

  const chainSpecs = stubVfx(c);
  setLevels(c, 'chainlightning', [1, 0, 0, 0, 0, 0, 0]);
  c.castSkill2(p, es, 'chainlightning', 'mv-float');
  assert.ok(chainSpecs.some((s) => s.fxKind === 'chain' && s.variant === 'lightning-chain'));
  assert.ok(chainSpecs.every((s) => s.elem === 'lightning'), '雷系事件一律帶雷屬性');

  const c2 = loadContext();
  stubHits(c2);
  const boltSpecs = stubVfx(c2);
  const p2 = playerEnt();
  const es2 = [enemy(1e9, 5 * M, 0)];
  setLevels(c2, 'thunderstrike', [1, 0, 0, 0, 0, 0, 0]);
  c2.castSkill2(p2, es2, 'thunderstrike', 'mv-float');
  assert.ok(boltSpecs.some((s) => s.fxKind === 'rain' && s.variant === 'thunder-strike'));
  run(c2, p2, es2, 2);
  assert.ok(boltSpecs.some((s) => s.variant === 'thunder-impact'), '落地要有爆點');

  const c3 = loadContext();
  stubHits(c3);
  const orbSpecs = stubVfx(c3);
  const p3 = playerEnt();
  const es3 = [enemy(1e9, 8 * M, 0)];
  setLevels(c3, 'thunderorb', [1, 1, 1, 1, 1, 1, 1]);
  c3.castSkill2(p3, es3, 'thunderorb', 'mv-float');
  run(c3, p3, es3, 1);
  assert.ok(orbSpecs.some((s) => s.fxKind === 'aura' && s.variant === 'thunder-orb' && s.area),
    '飛行雷球以 area 為錨點');
  assert.ok(orbSpecs.some((s) => s.variant === 'thunder-orbit'), '環體電球是環繞特效');
  assert.ok(orbSpecs.some((s) => s.variant === 'thunder-fall'), '雷殞天落是天降特效');
});

/* ===========================================================================
   6) 高塔（無座標）退化
   =========================================================================== */

test('無座標時三個技能都能施放並造成傷害（高塔退化）', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const boss = enemy(1e9);     // 無 pos
  setLevels(c, 'chainlightning', [1, 0, 0, 0, 0, 0, 0]);
  setLevels(c, 'thunderstrike', [1, 0, 0, 0, 0, 0, 0]);
  setLevels(c, 'thunderorb', [1, 0, 0, 0, 0, 0, 0]);

  assert.ok(c.castSkill2(p, [boss], 'chainlightning', 'tb-float'), '連鎖閃電可施放');
  assert.ok(c.castSkill2(p, [boss], 'thunderstrike', 'tb-float'), '落雷術可施放');
  assert.ok(c.castSkill2(p, [boss], 'thunderorb', 'tb-float'), '雷球可施放');
  const beforeTick = calls.length;
  run(c, p, [boss], 3);
  assert.ok(beforeTick > 0, '連鎖閃電在施放當下就結算');
  assert.ok(calls.length > beforeTick, '落雷與雷球在 tick 中結算');
});
