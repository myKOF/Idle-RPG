/* 新版主動技能第五批：地系三群組（2026-08-17，js/skills2.js）
   守住設計文檔「技能」頁籤〈魔法〉區塊新增的三個群組與其註記：
     岩甲術  rockarmor  ─ 護盾爆發；第 4 階＝主動型被動（裝配即生效），
                          第 3、5、6、7 階綁岩甲護盾（使用者決策 2026-08-17）
     泥沼術  mire       ─ 地板場域；本體不造成傷害，只給緩速／中毒／熔岩三種 debuff
     大地守護 earthguard ─ 主動型被動；七階全是掛在既有收斂點上的乘區與攔截
   以及文檔上方新增的兩段注釋：
     - 屬性用語（地屬性＝地系傷害、毒屬性＝毒性傷害…）
     - buff 規則（重上／疊加／取代 → 狀態表 stack 欄） */
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
    calls.push({ ent: defender, aCfg: aCfg });
    const dmg = (opts && opts.dmg) || 100;
    defender.hp = Math.max(0, defender.hp - dmg);
    return { dmg, crit: false, miss: false, blocked: false, killed: defender.hp <= 0 };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  return calls;
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
function equip(c, gid) { c.G.player.loadout = ['sg:' + gid]; }
/* Lv.1 已含 1 級升級效果，追加次數類（add）在 Lv.1 就帶小數並以機率觸發；
   凡是驗「幾攤／幾次」的測試都先關掉那一擲。0＝必中、0.999＝必不中。 */
function forceRolls(c, value) { c.Math.random = () => value; }

const M = 10; // 1 米 = 10 個系統距離單位（bfMeterPx）

/* ===========================================================================
   0) 定義表與文檔注釋
   =========================================================================== */

test('三個新群組都在表上：地系、魔法傷害，且大地守護是主動型被動（無冷卻無耗魔）', () => {
  const c = loadContext();
  ['rockarmor', 'mire', 'earthguard'].forEach((gid) => {
    const g = c.SKILLS2[gid];
    assert.ok(g, gid + ' 不在 SKILLS2');
    assert.equal(g.dmgType, 'magic', gid + ' 應為魔法傷害');
    assert.equal(g.elem, 'earth', gid + ' 應為地屬性');
    assert.equal(g.tiers.length, c.SG_TIER_COUNT);
  });
  assert.equal(c.skills2IsPassive('earthguard'), true, '大地守護＝主動式被動技');
  assert.equal(c.SKILLS2.earthguard.cd, 0);
  assert.equal(c.SKILLS2.earthguard.cost, 0);
  const magicShieldFx = c.SKILLS2.earthguard.tiers[4].fx;
  assert.equal(magicShieldFx.pct, 30);
  assert.equal(magicShieldFx.pctPer, 3);
  assert.equal(magicShieldFx.manaRed, 30);
  assert.equal(magicShieldFx.manaRedPer, 5,
    '魔法盾資料應包含轉換承傷與承擔法力降低兩組倍率');
  assert.equal(c.skills2IsPassive('rockarmor'), false, '岩甲術是主動技（只有第 4 階是被動階）');
  assert.equal(c.skills2IsPassive('mire'), false);
});

test('說明模板採用文檔上方的屬性用語（地系／毒性／火焰傷害）', () => {
  const c = loadContext();
  const descs = ['rockarmor', 'mire', 'earthguard']
    .map((gid) => c.SKILLS2[gid].tiers.map((t) => t.desc).join('\n')).join('\n');
  assert.match(descs, /地系傷害/, '土/地屬性一律稱「地系傷害」');
  assert.match(descs, /毒性傷害/, '毒屬性一律稱「毒性傷害」');
  assert.match(descs, /火焰傷害/, '火屬性一律稱「火焰傷害」');
  assert.ok(!/地屬性傷害|毒屬性傷害|土系傷害/.test(descs), '不得混用舊用語');
});

test('新增狀態的疊加規則對得上文檔的「重上／取代」（後蓋前並重新計時）', () => {
  const c = loadContext();
  ['sgRockArmor', 'sgRockAmp', 'sgMire', 'sgMirePoison', 'sgMireLava'].forEach((sid) => {
    assert.ok(c.STATUS[sid], sid + ' 不在狀態表');
    assert.equal(c.STATUS[sid].stack, 'refresh', sid + ' 應為後蓋前並重新計時');
  });
  assert.equal(c.STATUS.sgMire.kind, 'debuff');
  assert.equal(c.STATUS.sgMirePoison.elem, 'poison');
  assert.equal(c.STATUS.sgMireLava.elem, 'fire');
});

/* ===========================================================================
   1) 岩甲術
   =========================================================================== */

test('岩甲術：施放給自己護盾（第 1＋2 階累加），並開啟岩甲期間', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 10 * M, 0);
  setLevels(c, 'rockarmor', [1, 1, 0, 0, 0, 0, 0]);

  assert.ok(c.castSkill2(p, [m], 'rockarmor', 'mv-float'), '應可施放');
  // 33% + 22% ＝ 最大生命 1000 的 55%
  assert.equal(Math.round(p.shield), 550);
  assert.ok(c.SKILL2_RT.rock && c.SKILL2_RT.rock.until > c.GT, '岩甲期間應開啟');
  assert.equal(c.SKILL2_RT.rock.base, 550, 'T6/T7 的分母＝施放當下的護盾總量');
  assert.ok(c.buffVal(p, 'sgRockArmor') > 0, '應掛上岩甲標記（UI 投影）');
});

test('岩甲尖刺（T3）：岩甲期間才反擊，且走地屬性魔法傷害管線', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  // 階層是循序解鎖的：要驗第 3 階，前兩階必須都至少 Lv.1
  setLevels(c, 'rockarmor', [1, 1, 1, 0, 0, 0, 0]);

  // 沒放技能：不觸發
  c.skills2OnPlayerDamaged(m, p, 100, false, { absorbed: 0 }, 'pv-float');
  assert.equal(calls.length, 0, '沒有岩甲護盾就不該有尖刺');

  c.castSkill2(p, [m], 'rockarmor', 'mv-float');
  c.skills2OnPlayerDamaged(m, p, 100, false, { absorbed: 0 }, 'pv-float');
  assert.equal(calls.length, 1, '岩甲期間受擊應反擊一次');
  assert.equal(calls[0].ent, m, '反擊的是攻擊者');
  assert.equal(calls[0].aCfg.dmgType, 'magic');
  assert.equal(calls[0].aCfg.skillElem, 'earth', '土系傷害＝地屬性，吃地屬性加成與敵人地抗');
  assert.equal(Math.round(calls[0].aCfg.atk), 55, '最大生命 1000 的 5.5%');
});

test('護盾增幅（T4）：主動型被動——裝配才生效，且對護盾效率乘算', () => {
  const c = loadContext();
  setLevels(c, 'rockarmor', [1, 1, 1, 1, 0, 0, 0]);
  assert.equal(c.skill2ShieldEffFactor(), 1, '沒裝配就不生效');
  equip(c, 'rockarmor');
  assert.ok(Math.abs(c.skill2ShieldEffFactor() - 1.165) < 1e-9, '裝配後 ×1.165');
  // 不必先放技能：這一階是「主動型被動」，與其餘綁護盾的階不同
  assert.equal(c.SKILL2_RT.rock, null);
  assert.ok(Math.abs(c.skill2ShieldEffFactor() - 1.165) < 1e-9);
});

test('岩之再生（T5）：岩甲期間每減少 1% 生命換得 1.1% 最大生命的護盾', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  setLevels(c, 'rockarmor', [1, 1, 1, 1, 1, 0, 0]);
  c.castSkill2(p, [m], 'rockarmor', 'mv-float');
  const before = p.shield;
  p.shield = 0;               // 先把護盾清掉，才看得出「換回來多少」
  c.skills2OnPlayerDamaged(m, p, 100, false, { absorbed: 0 }, 'pv-float');
  assert.equal(Math.round(p.shield), 110, '扣 100 血（10%）→ 換回 11% 最大生命的護盾');
  assert.ok(before > 0);
});

test('岩甲增幅（T6）：損失護盾換傷害增幅，並夾在 30 層上限', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  setLevels(c, 'rockarmor', [1, 1, 1, 1, 1, 1, 0]);
  c.castSkill2(p, [m], 'rockarmor', 'mv-float'); // 護盾 500、base 500

  c.skills2OnPlayerDamaged(m, p, 0, false, { absorbed: 50 }, 'pv-float');
  // 護盾 550 損失 50 ≒ 9.09% → 9.09 層 × 0.55% ＝ 5%
  assert.ok(Math.abs(c.skill2RockAmpPct(p) - 5) < 1e-9, '損失 50 護盾＝5% 增幅');

  c.skills2OnPlayerDamaged(m, p, 0, false, { absorbed: 500 }, 'pv-float');
  assert.ok(Math.abs(c.skill2RockAmpPct(p) - 16.5) < 1e-9, '上限 30 層 × 0.55% ＝ 16.5%');
});

test('天地逆返（T7）：護盾越低減傷越高；沒放技能時完全不生效', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  setLevels(c, 'rockarmor', [1, 1, 1, 1, 1, 1, 1]);

  assert.equal(c.skill2DamageTakenMultiplier(p), 1, '沒有岩甲護盾＝不該白拿減傷');

  c.castSkill2(p, [m], 'rockarmor', 'mv-float');
  assert.equal(c.skill2DamageTakenMultiplier(p), 1, '護盾滿的時候沒有額外減傷');
  p.shield = c.SKILL2_RT.rock.base / 2;
  assert.ok(Math.abs(c.skill2DamageTakenMultiplier(p) - 0.835) < 1e-9, '剩一半護盾＝一半的 33%');
  p.shield = 0;
  assert.ok(Math.abs(c.skill2DamageTakenMultiplier(p) - 0.67) < 1e-9, '護盾歸零＝滿額 33%');
});

/* ===========================================================================
   2) 泥沼術
   =========================================================================== */

test('泥沼術：召喚一片方形沼澤，本體不造成任何傷害', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  setLevels(c, 'mire', [1, 0, 0, 0, 0, 0, 0]);

  assert.ok(c.castSkill2(p, [m], 'mire', 'mv-float'), '應可施放');
  assert.equal(c.SKILL2_RT.grounds.length, 1);
  const f = c.SKILL2_RT.grounds[0];
  assert.equal(f.kind, 'mire');
  assert.equal(f.length, 10 * M, '10 米見方');
  assert.equal(f.width, 10 * M);
  assert.equal(f.hits, 9, 'Lv.1＝4.4 秒 ÷ 0.5 秒節拍 ≒ 9 跳');

  run(c, p, [m], 1);
  assert.equal(calls.length, 0, '泥沼術本體不造成傷害');
});

test('緩速：站在沼澤裡的敵人攻速與移速同時下降；重力泥沼換代成更強的一組', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  setLevels(c, 'mire', [1, 0, 0, 0, 0, 0, 0]);
  c.castSkill2(p, [m], 'mire', 'mv-float');
  run(c, p, [m], 0.6);

  assert.ok(c.buffVal(m, 'sgMire') > 0, '應掛上泥沼緩速');
  assert.ok(Math.abs(c.skill2MireAspdFactor(m) - 0.5) < 1e-9, '攻速 -50%');
  assert.ok(Math.abs(c.skill2MoveSlowFactor(m) - 0.7) < 1e-9, '移動速度 -30%');
  assert.ok(Math.abs(c.bfEnemySpeedFactor(m) - 0.7) < 1e-9, '逼近速度吃同一個倍率');
  // 舊的 slow 控場是另一套機制，兩者相乘而不是取其一
  assert.ok(Math.abs(c.slowFactor(m) - 0.5) < 1e-9);

  const c2 = loadContext();
  stubHits(c2);
  const p2 = playerEnt();
  const m2 = enemy(1e9, 5 * M, 0);
  setLevels(c2, 'mire', [1, 1, 1, 1, 1, 1, 0]);
  c2.castSkill2(p2, [m2], 'mire', 'mv-float');
  run(c2, p2, [m2], 0.6);
  assert.ok(Math.abs(c2.skill2MireAspdFactor(m2) - 0.25) < 1e-9, '重力泥沼：攻速 -75%');
  assert.ok(Math.abs(c2.skill2MoveSlowFactor(m2) - 0.5) < 1e-9, '重力泥沼：移動速度 -50%');
});

test('虛弱（T2）＋重力泥沼（T6）：受泥沼影響的敵人受到的傷害累加提高', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  setLevels(c, 'mire', [1, 1, 1, 1, 1, 1, 0]);

  assert.equal(c.skill2MireVulnPct(m), 0, '沒踩進沼澤就沒有增傷');
  c.castSkill2(p, [m], 'mire', 'mv-float');
  run(c, p, [m], 0.6);
  assert.equal(c.skill2MireVulnPct(m), 38.5, '16.5% + 22% 累加');
  const aCfg = c.skill2VulnACfg({ totalDmgPct: 0 }, m);
  assert.equal(aCfg.totalDmgPct, 38.5, '收斂進同一個 totalDmgPct');
});

test('毒沼術（T3）／熔岩沼（T7）：以中毒與燃燒兩個狀態發傷害，且吃魔攻', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  setLevels(c, 'mire', [1, 1, 1, 1, 1, 1, 1]);
  c.castSkill2(p, [m], 'mire', 'mv-float');
  run(c, p, [m], 0.6);

  const poison = m.dots.filter((d) => d.sid === 'sgMirePoison')[0];
  const lava = m.dots.filter((d) => d.sid === 'sgMireLava')[0];
  assert.ok(poison, '應中毒');
  assert.ok(lava, '熔岩沼應附加燃燒');
  // 魔攻 500 × 27.5% ÷ 0.5 秒 ＝ 275/s（若誤吃物攻 1000 會是 550/s）
  assert.ok(Math.abs(poison.dps - 275) < 1e-9);
  assert.equal(poison.interval, 0.5);
  // 魔攻 500 × 77% ÷ 0.4 秒 ＝ 962.5/s
  assert.ok(Math.abs(lava.dps - 962.5) < 1e-9);
  assert.equal(lava.interval, 0.4);
});

test('離開沼澤後緩速與持續傷害很快自然消失（狀態只給兩跳）', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  setLevels(c, 'mire', [1, 0, 1, 0, 0, 0, 0]);
  c.castSkill2(p, [m], 'mire', 'mv-float');
  run(c, p, [m], 0.6);
  assert.ok(c.buffVal(m, 'sgMire') > 0);

  m.pos = { x: 100 * M, y: 0 };   // 走出沼澤
  run(c, p, [m], 1.5);
  assert.equal(c.buffVal(m, 'sgMire'), 0, '離開後緩速應失效');
});

test('沼澤漫延（T5）／熔岩沼（T7）：持續時間取地板值、範圍隨時間長大且兩階累加', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  setLevels(c, 'mire', [1, 1, 1, 1, 1, 1, 1]);
  c.castSkill2(p, [m], 'mire', 'mv-float');
  const f = c.SKILL2_RT.grounds[0];

  assert.equal(f.hits, 16, '熔岩沼把持續時間拉到 8 秒 ÷ 0.5 ＝ 16 跳');
  assert.ok(Math.abs(f.growTo - 1.66) < 1e-9, '44%（第 5 階）＋22%（第 7 階）累加');
  assert.equal(f.growSec, 4);
  assert.equal(f.length, 10 * M, '剛出生時是原始大小');

  c.GT += 4;
  c.sgGroundApplyGrowth(f);
  assert.ok(Math.abs(f.length - 16.6 * M) < 1e-9, '4 秒後長到 1.66 倍');
});

test('第 1 階滿級的持續時間不會被第 5 階的 6 秒「降級」', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  setLevels(c, 'mire', [10, 1, 1, 1, 1, 0, 0]);   // 第 1 階滿級＝4 + 0.4×10 ＝ 8 秒
  c.castSkill2(p, [m], 'mire', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds[0].hits, 16, '取 max(8, 6) ＝ 8 秒 ÷ 0.5');
});

test('毒沼增生（T4）：沼澤結束時在附近較近的敵人腳下重長，且只傳染一次', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const near = enemy(1e9, 5 * M, 0);
  const far = enemy(1e9, 12 * M, 0);
  setLevels(c, 'mire', [1, 1, 1, 1, 0, 0, 0]);
  forceRolls(c, 0.999);   // Lv.1 的 1.1 次只留整數 1 次
  c.castSkill2(p, [near], 'mire', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds[0].respawnLeft, 1);

  run(c, p, [near, far], 5);
  const alive = c.SKILL2_RT.grounds;
  assert.equal(alive.length, 1, '結束時應長出一攤新的');
  assert.equal(alive[0].respawnLeft, 0, '最多傳染 1 次');

  run(c, p, [near, far], 5);
  assert.equal(c.SKILL2_RT.grounds.length, 0, '第二攤結束後不再傳染');
});

/* ===========================================================================
   3) 大地守護
   =========================================================================== */

test('大地守護：沒裝配到技能列就一律不生效', () => {
  const c = loadContext();
  const p = playerEnt();
  setLevels(c, 'earthguard', [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(c.skill2EarthguardLevels(), null);
  assert.equal(c.skill2DamageTakenMultiplier(p), 1);
  assert.equal(c.skill2ElemDamageUpPct(), 0);
  assert.equal(c.skill2RegenFactor('hp'), 1);
  assert.equal(c.skill2RegenFactor('mp'), 1);
  assert.equal(c.skills2ManaShieldAbsorb(p, 100), 0);
  assert.equal(c.skills2TryRebirth(p), false);
});

test('大地守護（T1）：傷害減免與生命上限都是乘算；大地祝福（T2）全屬性傷害乘算', () => {
  const c = loadContext();
  const p = playerEnt();
  setLevels(c, 'earthguard', [1, 1, 0, 0, 0, 0, 0]);
  assert.equal(c.skill2MaxHpFactor(), 1, '沒裝配就不加生命上限');
  equip(c, 'earthguard');
  assert.ok(Math.abs(c.skill2DamageTakenMultiplier(p) - 0.89) < 1e-9, '受到的傷害 ×0.89');
  assert.ok(Math.abs(c.skill2MaxHpFactor() - 1.22) < 1e-9, '生命上限 ×1.22');
  assert.equal(c.skill2ElemDamageUpPct(), 27.5);

  setLevels(c, 'earthguard', [10, 1, 0, 0, 0, 0, 0]);
  assert.ok(Math.abs(c.skill2DamageTakenMultiplier(p) - 0.8) < 1e-9, '滿級 20% 減傷');
  assert.ok(Math.abs(c.skill2MaxHpFactor() - 1.4) < 1e-9, '滿級 +40% 生命上限');
});

test('生命上限乘區掛在 st.hp 派生點，且不得在計算途中回頭呼叫 getStats', () => {
  const c = loadContext();
  setLevels(c, 'earthguard', [1, 0, 0, 0, 0, 0, 0]);
  equip(c, 'earthguard');
  // computeStats 途中呼叫 getStats 會無限遞迴；這裡把它換成會爆炸的替身當守門員
  const realGetStats = c.getStats;
  c.getStats = () => { throw new Error('skill2MaxHpFactor 不得呼叫 getStats'); };
  assert.ok(Math.abs(c.skill2MaxHpFactor() - 1.22) < 1e-9);
  c.getStats = realGetStats;
  const src = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  assert.match(src, /skill2MaxHpFactor/, 'st.hp 派生點要接上這個乘區');
});

test('生命／法力再生（T3／T4）：回復 +110%、吸血吸魔 +55%，兩個乘區各自獨立', () => {
  const c = loadContext();
  setLevels(c, 'earthguard', [1, 1, 1, 1, 0, 0, 0]);
  equip(c, 'earthguard');
  assert.equal(c.skill2RegenFactor('hp'), 2.1);
  assert.equal(c.skill2RegenFactor('mp'), 2.1);
  assert.equal(c.skill2DrainFactor('hp'), 1.55);
  assert.equal(c.skill2DrainFactor('mp'), 1.55);

  const st = c.getStats();
  st.hpRegen = 40; st.mpRegen = 20;
  const hpBase = (st.hp * c.BASE_HP_REGEN_PCT / 100) + st.hpRegen;
  assert.ok(Math.abs(c.playerHpRegenPerSec(st) - hpBase * 2.1) < 1e-9, '每秒生命回復 ×2.1');
  assert.ok(Math.abs(c.playerMpRegenPerSec(st) - st.mpRegen * 2.1) < 1e-9, '每秒法力回復 ×2.1');
  /* 吸血是「每秒回復 × 吸血%」，但吃的是自己的 +50%——
     若誤用被放大過的回復換算就會變成 ×2（甚至 ×3），這裡正是防那條回歸。 */
  assert.ok(Math.abs(c.lifestealHealAmount(st, 100) - hpBase * 1.55) < 1e-9, '吸血 ×1.55');
  assert.ok(Math.abs(c.manaStealAmount(st, 100) - st.mpRegen * 1.55) < 1e-9, '吸魔 ×1.55');

  // 滿級：回復 +200%、汲取 +100%
  setLevels(c, 'earthguard', [1, 1, 10, 10, 0, 0, 0]);
  assert.ok(Math.abs(c.skill2RegenFactor('hp') - 3) < 1e-9);
  assert.ok(Math.abs(c.skill2DrainFactor('mp') - 2) < 1e-9);
});

test('沒裝配大地守護時，回復與吸血換算完全維持原本行為', () => {
  const c = loadContext();
  setLevels(c, 'earthguard', [1, 1, 1, 1, 0, 0, 0]);   // 學了但沒裝
  const st = c.getStats();
  st.hpRegen = 40; st.mpRegen = 20;
  const hpBase = (st.hp * c.BASE_HP_REGEN_PCT / 100) + st.hpRegen;
  assert.ok(Math.abs(c.playerHpRegenPerSec(st) - hpBase) < 1e-9);
  assert.ok(Math.abs(c.lifestealHealAmount(st, 100) - hpBase) < 1e-9);
  assert.ok(Math.abs(c.manaStealAmount(st, 100) - st.mpRegen) < 1e-9);
});

test('魔法盾（T5）：轉換傷害與承擔法力各自套用降低倍率，法力不足時按成本反推', () => {
  const c = loadContext();
  const p = playerEnt();
  setLevels(c, 'earthguard', [1, 1, 1, 1, 1, 0, 0]);
  equip(c, 'earthguard');

  p.mp = 200;
  assert.equal(c.skills2ManaShieldAbsorb(p, 100), 33, '33% 由法力承擔');
  assert.ok(Math.abs(p.mp - 178.55) < 1e-9, 'Lv.1 承擔法力降低 35%，只扣 21.45 MP');

  p.mp = 10;
  assert.ok(Math.abs(c.skills2ManaShieldAbsorb(p, 100) - (10 / 0.65)) < 1e-9,
    '法力不足＝依降低後的 MP 成本反推可轉換傷害');
  assert.equal(p.mp, 0);
  assert.equal(c.skills2ManaShieldAbsorb(p, 100), 0, '沒法力就不再轉換');

  p.hp = 1000;
  p.mp = 200;
  assert.equal(c.applyEnemyHpDamage(p, 100), 67, '直接扣血路徑仍只把未轉換的 67 點扣到生命');
  assert.equal(p.hp, 933);
  assert.ok(Math.abs(p.mp - 178.55) < 1e-9, '直接扣血路徑只扣降低後的實際法力');

  c.Math.random = () => 0.5;
  p.hp = 1000;
  p.mp = 200;
  const hit = c.resolveHit({}, p,
    { atk: 100, dmgType: 'phys', level: 1, hit: 100, critRate: 0, critDmg: 150 },
    { def: 0, mdef: 0, level: 1, dodge: 0, pRes: 0, mRes: 0, resist: {},
      isPlayer: true, tenacity: 0 });
  assert.ok(Math.abs(hit.hpDamage - 59.63) < 1e-9, 'resolveHit 路徑只把未轉換傷害扣到生命');
  assert.ok(Math.abs(hit.manaShield - 19.0905) < 1e-9,
    'resolveHit 顯示實際扣除的法力，不是轉換的生命傷害量');

  setLevels(c, 'earthguard', [1, 1, 1, 1, 10, 0, 0]);
  p.mp = 100;
  const result = c.skills2ManaShieldResult(p, 100);
  assert.equal(result.damage, 60, '滿級轉換 60% 生命傷害');
  assert.ok(Math.abs(result.mana - 12) < 1e-9, '滿級承擔法力降低 80%，60 點傷害只扣 12 MP');
  assert.ok(Math.abs(p.mp - 88) < 1e-9);
});

test('生命反射之盾（T6）：目標不只一個時避開當前攻擊者', () => {
  const c = loadContext();
  setLevels(c, 'earthguard', [1, 1, 1, 1, 1, 1, 0]);
  equip(c, 'earthguard');
  const attacker = enemy(1000, 3 * M, 0, '攻擊者');
  const other = enemy(1000, 5 * M, 0, '其他');
  const fx = c.SKILLS2.earthguard.tiers[5].fx;

  const picked = c.sgEarthguardReflectTargets(attacker, [attacker, other], fx);
  assert.equal(picked.length, 1);
  assert.equal(picked[0], other, '有別的目標就不打攻擊者');

  const only = c.sgEarthguardReflectTargets(attacker, [attacker], fx);
  assert.equal(only.length, 1);
  assert.equal(only[0], attacker, '只剩一個目標時才打攻擊者');
});

test('天地共生（T7）：死亡復活、無敵、進入自身冷卻；冷卻中不再觸發', () => {
  const c = loadContext();
  const p = playerEnt();
  setLevels(c, 'earthguard', [1, 1, 1, 1, 1, 1, 1]);
  equip(c, 'earthguard');

  p.hp = 0;
  assert.equal(c.skills2TryRebirth(p), true, '應攔下死亡');
  assert.equal(p.hp, 280, '回復 28% 最大生命');
  assert.ok(c.effectActive(p, 'invuln'), '復活後無敵');
  assert.equal(p.skillCds['sg:earthguard'], 57, '冷卻寫進技能格（通用冷卻顯示）');

  p.hp = 0;
  assert.equal(c.skills2TryRebirth(p), false, '冷卻中不再復活');
});

test('岩甲與狂怒的執行期狀態一律不入存檔，且重置時把投影增益一起撤掉', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 5 * M, 0);
  setLevels(c, 'rockarmor', [1, 1, 1, 1, 1, 1, 0]);
  c.castSkill2(p, [m], 'rockarmor', 'mv-float');
  c.skills2OnPlayerDamaged(m, p, 0, false, { absorbed: 100 }, 'pv-float');
  assert.ok(c.buffVal(p, 'sgRockArmor') > 0);
  assert.ok(c.buffVal(p, 'sgRockAmp') > 0);

  c.resetSkill2RT();
  assert.equal(c.SKILL2_RT.rock, null);
  assert.equal(c.buffVal(p, 'sgRockArmor'), 0, '重置時投影增益要一起撤掉');
  assert.equal(c.buffVal(p, 'sgRockAmp'), 0);
  assert.equal(c.G.player.skills2.levels.rockarmor !== undefined, true, '存檔只留等級，不留執行期狀態');
});
