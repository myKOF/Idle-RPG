/* 屬性及技能效果改造（2026-07-30）回歸測試
   涵蓋五項改造：
   1. 生命回復／吸血等非技能回復，溢出不再轉護盾（技能治療仍轉）
   2. 吸血／吸魔不設上限，且改由每秒生命回復／法力恢復決定
   3. 韌性上限 80%，同時作用於被控場機率／控場時間／被爆擊機率
   4. 敵人依敵種爆擊（普通 8%／菁英 6%／BOSS 4%、爆傷 300%），可由參數表調整
   5. 技能不再降低敵人防禦，改為穿透增益；穿透無上限並走遞減曲線，超過 100% 轉增傷 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function loadContext() {
  const context = { console, Math };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(read(file), context, { filename: file });
  });
  return context;
}

/* ---- 1. 溢出治療只有技能效果才轉護盾 ---- */
test('healPlayer：技能來源的溢出治療仍轉護盾', () => {
  const c = loadContext();
  const st = { hp: 1000, shieldEff: 0 };
  const p = { hp: 900, shield: 0 };
  c.healPlayer(p, 100000, st);
  assert.equal(p.hp, 1000);
  assert.ok(p.shield > 0, '技能治療溢出應轉為護盾');
});

test('healPlayer：noShield（生命回復／吸血等非技能來源）溢出直接捨棄', () => {
  const c = loadContext();
  const st = { hp: 1000, shieldEff: 0 };
  const p = { hp: 900, shield: 0 };
  c.healPlayer(p, 100000, st, { noShield: true });
  assert.equal(p.hp, 1000);
  assert.equal(p.shield, 0, '非技能來源不得轉護盾');
});

test('戰鬥端與技能端的吸血／汲取／擊殺回復皆以 noShield 呼叫', () => {
  const combat = read('js/combat.js');
  const skills = read('js/skills.js');
  assert.match(combat, /healPlayer\(pEnt, healAmt, st, \{ noShield: true \}\)/);       // 普攻吸血/汲取
  assert.match(combat, /healPlayer\(FIELD\.player, st\.hp \* KILL_HEAL_PCT \/ 100, st, \{ noShield: true \}\)/);
  assert.match(combat, /st\.passives\.soulEater \/ 100, st, \{ noShield: true \}\)/);   // 吸魂
  assert.match(skills, /healPlayer\(pEnt, lifestealHealAmount\(st, st\.lifesteal\), st, \{ noShield: true \}\)/);
  // 技能自身的治療（healPctMax／healPctOfDmg）不得帶 noShield
  assert.match(skills, /healPlayer\(pEnt, totalDmg \* fx\.healPctOfDmg \/ 100, st\);/);
  assert.match(skills, /healPlayer\(pEnt, hv, st\);/);
});

/* ---- 2. 吸血／吸魔改由回復決定，且無上限 ---- */
test('吸血／吸魔上限已取消（STAT_CAPS = 0）', () => {
  const c = loadContext();
  assert.equal(c.STAT_CAPS.lifesteal, 0);
  assert.equal(c.STAT_CAPS.manaSteal, 0);
  assert.equal(c.capValue(500, c.STAT_CAPS.lifesteal), 500);
});

test('吸血回復 = 每秒生命回復 × 吸血%（回復 100/s、吸血 500% → 500）', () => {
  const c = loadContext();
  // 每秒生命回復 = 最大生命 × BASE_HP_REGEN_PCT% + 生命恢復屬性
  const st = { hp: 4000, hpRegen: 40, mpRegen: 20 };            // 4000×1.5% = 60，+40 → 100/秒
  assert.equal(c.playerHpRegenPerSec(st), 100);
  assert.equal(c.lifestealHealAmount(st, 500), 500);
  assert.equal(c.lifestealHealAmount(st, 0), 0);
  assert.equal(c.manaStealAmount(st, 250), 50);                  // 20/秒 × 250%
});

test('吸血回復與造成的傷害無關', () => {
  const c = loadContext();
  const st = { hp: 1000, hpRegen: 0 };
  // 同一組屬性，不同傷害不影響回復量（函式簽章本身不吃傷害）
  assert.equal(c.lifestealHealAmount(st, 100), c.playerHpRegenPerSec(st));
  assert.doesNotMatch(read('js/combat.js'), /res\.dmg \* \(st\.lifesteal/);
  assert.doesNotMatch(read('js/skills.js'), /totalDmg \* st\.(lifesteal|manaSteal)/);
});

/* ---- 3. 韌性 ---- */
test('韌性上限為 80%', () => {
  const c = loadContext();
  assert.equal(c.STAT_CAPS.tenacity, 80);
  assert.equal(c.capValue(95, c.STAT_CAPS.tenacity), 80);
});

test('resistCtrl：控制抵抗與韌性各自獨立擲骰（總抵抗 = 1-(1-控抗)(1-韌性)）', () => {
  const c = loadContext();
  const calls = [];
  c.chance = (p) => { calls.push(p); return false; };
  c.resistCtrl({ ctrlRes: 50, tenacity: 60 });
  assert.equal(calls.length, 1);
  assert.ok(Math.abs(calls[0] - 80) < 1e-9, '50% 與 60% 應合成 80%，實得 ' + calls[0]);
  calls.length = 0;
  c.resistCtrl({ ctrlRes: 0, tenacity: 80 });
  assert.ok(Math.abs(calls[0] - 80) < 1e-9);
  calls.length = 0;
  // 怪物 dCfg 無 tenacity：行為與改版前一致
  c.resistCtrl({ ctrlRes: 30 });
  assert.ok(Math.abs(calls[0] - 30) < 1e-9);
});

test('韌性折減被爆擊機率：敵方 8% × (1-80%) = 1.6%', () => {
  const c = loadContext();
  const rates = [];
  c.chance = (p) => { rates.push(p); return p >= 100; };   // 必中、不爆擊
  c.rnd = () => 1;
  c.defReduction = () => 0;
  c.physicalResistanceReduction = () => 0;
  c.magicResistanceReduction = () => 0;
  c.globalDamageMultiplier = () => 1;
  const attacker = { hp: 100 };
  const defender = { hp: 100000, shield: 0 };
  c.resolveHit(attacker, defender, { atk: 100, dmgType: 'phys', critRate: 8, critDmg: 300, hit: 100 },
    { def: 0, dodge: 0, tenacity: 80, isPlayer: true });
  // rates[0] = 命中率、rates[1] = 爆擊率
  assert.ok(Math.abs(rates[1] - 1.6) < 1e-9, '被爆擊機率應為 1.6%，實得 ' + rates[1]);
});

test('韌性同時縮短控場時間（playerDefCfg 的 ccFactor 仍含韌性）', () => {
  const combat = read('js/combat.js');
  assert.match(combat, /ccFactor: \(1 - st\.tenacity \/ 100\) \* \(1 - st\.ccRed \/ 100\)/);
  assert.match(combat, /tenacity: st\.tenacity,/);
});

/* ---- 4. 敵人爆擊 ---- */
test('敵人爆擊率依敵種區分、爆傷共用，且為具名常數（可由參數表調整）', () => {
  const c = loadContext();
  assert.equal(c.ENEMY_CRIT_RATE_NORMAL, 8);
  assert.equal(c.ENEMY_CRIT_RATE_ELITE, 6);
  assert.equal(c.ENEMY_CRIT_RATE_BOSS, 4);
  assert.equal(c.ENEMY_CRIT_DMG_PCT, 300);
  assert.equal(c.enemyCritRateFor({ isBoss: true, elite: true }), 4);  // BOSS 優先
  assert.equal(c.enemyCritRateFor({ elite: true }), 6);
  assert.equal(c.enemyCritRateFor({}), 8);
  assert.equal(c.enemyCritRateFor(null), 8);
});

test('monsterAtkCfg 使用敵種爆擊率與爆傷常數，不再寫死 5%／150%', () => {
  const combat = read('js/combat.js');
  assert.match(combat, /critRate: enemyCritRateFor\(m\), critDmg: ENEMY_CRIT_DMG_PCT/);
  assert.doesNotMatch(combat, /critRate: 5, critDmg: 150/);
});

test('參數表含「敵人爆擊」列，且 apply_params 已建立映射', () => {
  const csv = read('config/CSV/game_parameters.csv');
  const applyParams = read('tools/apply_params.cjs');
  const row = csv.split(/\r?\n/).find((l) => l.includes(',3-戰鬥核心,敵人爆擊,'));
  assert.ok(row, '參數表缺少「3-戰鬥核心/敵人爆擊」列');
  const cols = row.split(',');
  assert.deepEqual(cols.slice(-12, -8), ['8', '6', '4', '300']);
  ['ENEMY_CRIT_RATE_NORMAL', 'ENEMY_CRIT_RATE_ELITE', 'ENEMY_CRIT_RATE_BOSS', 'ENEMY_CRIT_DMG_PCT']
    .forEach((name) => assert.ok(applyParams.includes(name), 'apply_params 缺少 ' + name));
});

/* ---- 5. 穿透 ---- */
test('穿透上限已取消（STAT_CAPS = 0）', () => {
  const c = loadContext();
  assert.equal(c.STAT_CAPS.pPen, 0);
  assert.equal(c.STAT_CAPS.mPen, 0);
  assert.equal(c.capValue(1000, c.STAT_CAPS.pPen), 1000);
});

test('忽略防禦% = a×(穿透%÷100×b)^c，且參數可調', () => {
  const c = loadContext();
  assert.equal(c.PEN_IGNORE_A, 0.01);
  assert.equal(c.PEN_IGNORE_B, 100);
  assert.equal(c.PEN_IGNORE_C, 0.68);
  assert.equal(c.penIgnoreRatio(0), 0);
  const expect = (pen) => c.PEN_IGNORE_A * Math.pow(pen / 100 * c.PEN_IGNORE_B, c.PEN_IGNORE_C);
  [100, 250, 500, 1000].forEach((pen) => {
    assert.ok(Math.abs(c.penIgnoreRatio(pen) - expect(pen)) < 1e-12);
  });
  // 曲線關鍵點（文件 §3.1 對照表）
  assert.ok(Math.abs(c.penIgnorePct(100) - 22.91) < 0.05);
  assert.ok(Math.abs(c.penIgnorePct(250) - 42.72) < 0.05);
  assert.ok(Math.abs(c.penIgnorePct(500) - 68.44) < 0.05);
  assert.ok(c.penIgnorePct(1000) > 100);
});

test('忽略防禦超過 100% 時，防禦歸零並將超出部分轉為增傷', () => {
  const c = loadContext();
  assert.equal(c.penDefMultiplier(1.5), 0);           // 不得出現負防禦
  assert.equal(c.penDefMultiplier(0.25), 0.75);
  assert.equal(c.penOverflowDmgMultiplier(1.5), 1.5); // 150% → ×1.5 增傷
  assert.equal(c.penOverflowDmgMultiplier(0.9), 1);   // 未溢出 → 不增傷
});

test('resolveHit：穿透溢出的增傷實際套用在傷害上', () => {
  const c = loadContext();
  c.chance = (p) => p >= 100;         // 必中、不爆擊
  c.rnd = () => 1;
  c.physicalResistanceReduction = () => 0;
  c.globalDamageMultiplier = () => 1;
  const hit = (pen) => {
    const defender = { hp: 1e9, shield: 0 };
    return c.resolveHit({ hp: 100 }, defender,
      { atk: 1000, dmgType: 'phys', critRate: 0, hit: 100, pen: pen },
      { def: 500, dodge: 0, level: 1 }).dmg;
  };
  const base = hit(0);
  const mid = hit(500);              // 忽略 68.4% 防禦 → 傷害提高但未溢出
  const over = hit(5000);            // 忽略 > 100% → 防禦歸零＋溢出增傷
  assert.ok(mid > base, '穿透應提高傷害');
  assert.ok(over > mid);
  const ratio = c.penIgnoreRatio(5000);
  assert.ok(ratio > 1, '此穿透量應溢出');
  // 溢出時：傷害 = 攻擊力 × 溢出倍率（防禦已歸零）
  assert.ok(Math.abs(over - Math.round(1000 * ratio)) <= 1, '溢出增傷倍率不符：' + over);
});

test('技能不再有降低敵人防禦效果，改為穿透增益 penUp', () => {
  const skills = read('js/skills.js');
  const skillsCsv = read('config/CSV/Skills.csv');
  // 技能定義與里程碑皆不得再出現 defDown（僅保留 buffLabel／浮字分類的相容對照）
  assert.doesNotMatch(skills, /debuff2?: \{ key: 'defDown'/);
  assert.ok(!skillsCsv.includes('defDown'), 'Skills 表仍有 defDown');
  assert.match(skills, /armorBreak:.*buff: \{ key: 'penUp', base: 25, per: 5, dur: 5 \}/);
  assert.match(skills, /whirlwind: {5}\{ 4: \{ slowDur: 2 \}, 8: \{ slowDur: 3, buff: \{ key: 'penUp'/);
  assert.match(skills, /manaBurn: {6}\{ 4: \{ mpOnCrit: 35 \}, 8: \{ mpOnCrit: 40, buff: \{ key: 'penUp'/);
  assert.match(skills, /penUp: '物理\/魔法穿透'/);
});

test('penUp 增益同時加成物理與魔法穿透，且各攻擊來源都吃得到', () => {
  const c = loadContext();
  c.buffVal = (ent, key) => (ent && ent.buffs && ent.buffs[key]) || 0;
  const st = { pPen: 100, mPen: 30 };
  const ent = { buffs: { penUp: 25 } };
  assert.equal(c.effectivePPen(st, ent), 125);
  assert.equal(c.effectiveMPen(st, ent), 55);
  assert.equal(c.effectivePPen(st, null), 100);      // 無實體時只用屬性值
  ['js/combat.js', 'js/skills.js', 'js/legendary.js', 'js/potential.js'].forEach((f) => {
    const src = read(f);
    assert.ok(/effective[PM]Pen\(/.test(src), f + ' 未套用 penUp 增益');
    assert.doesNotMatch(src, /pen: st\.[pm]Pen\b/);
  });
});

test('傷害技的附帶增益不受「增益不重複疊放」閘門限制', () => {
  const skills = read('js/skills.js');
  assert.match(skills, /if \(fx\.buff && !fx\.dmgType && buffVal\(pEnt, fx\.buff\.key\) > 0\) return false;/);
});
