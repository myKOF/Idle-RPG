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
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js'].forEach((file) => {
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

test('戰鬥端與技能端的吸血／汲取／過關回復皆以 noShield 呼叫', () => {
  const combat = read('js/combat.js');
  const skills = read('js/skills.js');
  assert.match(combat, /healPlayer\(pEnt, healAmt, st, \{ noShield: true \}\)/);       // 普攻吸血/汲取
  /* 2026-08：擊殺回復（每殺一隻 12%）改為過關回復（整波清空 30%），觸發點從
     onFieldKill 移到 completeFieldWave，回復性質不變——仍是非技能來源、溢出不轉護盾。 */
  assert.match(combat, /healPlayer\(FIELD\.player, st\.hp \* WAVE_CLEAR_HEAL_PCT \/ 100, st, \{ noShield: true \}\)/);
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

test('吸血回復 = 每秒生命回復 × 吸血%', () => {
  const c = loadContext();
  /* 每秒生命回復 = 最大生命 × BASE_HP_REGEN_PCT% + 生命恢復屬性。
     ⚠️ 期望值改為從 BASE_HP_REGEN_PCT 推導，不寫死數字——這支測試原本假設
     基礎回復是 1.5%，參數調成 2% 之後就紅燈了，但要驗的關係式其實沒有變。
     測「關係是否成立」才是這支測試的目的，「數值是多少」歸參數表管。 */
  const st = { hp: 4000, hpRegen: 40, mpRegen: 20 };
  const perSec = st.hp * c.BASE_HP_REGEN_PCT / 100 + st.hpRegen;
  assert.equal(c.playerHpRegenPerSec(st), perSec);
  assert.equal(c.lifestealHealAmount(st, 500), perSec * 5);
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
  /* ⚠️ 不寫死 8／6／4／300——那是參數表管的可調值（下一支測試負責驗它與參數表一致）。
     這支要驗的是**選用邏輯**：具名常數存在、BOSS 優先於菁英、其餘走一般值。 */
  [ 'ENEMY_CRIT_RATE_NORMAL', 'ENEMY_CRIT_RATE_ELITE', 'ENEMY_CRIT_RATE_BOSS', 'ENEMY_CRIT_DMG_PCT' ]
    .forEach((name) => assert.equal(typeof c[name], 'number', name + ' 應為具名常數'));

  assert.equal(c.enemyCritRateFor({ isBoss: true, elite: true }), c.ENEMY_CRIT_RATE_BOSS, 'BOSS 優先於菁英');
  assert.equal(c.enemyCritRateFor({ elite: true }), c.ENEMY_CRIT_RATE_ELITE);
  assert.equal(c.enemyCritRateFor({}), c.ENEMY_CRIT_RATE_NORMAL);
  assert.equal(c.enemyCritRateFor(null), c.ENEMY_CRIT_RATE_NORMAL, '沒有敵人資料時退回一般值');
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
  /* ⚠️ 比對的是「參數表與程式常數一致」，不是寫死 8／6／4／300。
     這才是這支測試真正要守的不變量；數值本身由使用者在參數表調整。 */
  const c = loadContext();
  assert.deepEqual(
    cols.slice(-12, -8),
    [c.ENEMY_CRIT_RATE_NORMAL, c.ENEMY_CRIT_RATE_ELITE, c.ENEMY_CRIT_RATE_BOSS, c.ENEMY_CRIT_DMG_PCT]
      .map(String),
    '參數表的敵人爆擊四欄應與 js/formula.js 的常數一致（一般／菁英／BOSS／爆傷）'
  );
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

test('忽略防禦% = 穿透倍率 ÷ (穿透倍率 + a)，且參數可調', () => {
  /* 期望值出處：參數表「3-戰鬥核心／忽略防禦」param a，經 tools/apply_params.cjs
     套進 js/formula.js 的 PEN_IGNORE_A（改參數請改 xlsx，改 config/CSV 會被沖掉）。

     依 AI_RULES.md 9.1 例外，測試**刻意釘住目前數值**：參數表一動這裡就會紅，
     這是預期行為——確認新值是有意調整後，把期望值一併更新。
     2026-08-06（穿透平衡性調整）起：a = 0.75（原為 1.5）。

     ⚠️ 我一度把這支改成「只釘公式形狀、a 向遊戲拿」，理由是「標題寫著參數可調
     卻用常數擋住調參」。**那個判斷跟專案慣例相反**：9.1 管的是註釋不該寫死數值
     （註釋不會被驗證，改了就變成謊話），而測試恰恰相反——釘住數值是刻意的哨兵，
     讓調參的人被強制看見「這個改動影響到誰」。已改回。 */
  const c = loadContext();
  assert.equal(c.PEN_IGNORE_A, 0.75);
  assert.equal(typeof c.PEN_IGNORE_B, 'undefined', 'b 欄已停用');
  assert.equal(typeof c.PEN_IGNORE_C, 'undefined', 'c 欄已停用');
  assert.equal(c.penIgnoreRatio(0), 0);

  const expect = (pen) => (pen / 100) / (pen / 100 + c.PEN_IGNORE_A);
  [100, 250, 350, 500, 1000, 5000].forEach((pen) => {
    assert.ok(Math.abs(c.penIgnoreRatio(pen) - expect(pen)) < 1e-12, '穿透 ' + pen);
    assert.ok(Math.abs(c.penIgnorePct(pen) - expect(pen) * 100) < 1e-9,
      'penIgnorePct 必須是 penIgnoreRatio 的百分比版本：穿透 ' + pen);
  });

  // 曲線關鍵點（a = 0.75）
  assert.ok(Math.abs(c.penIgnorePct(100) - 57.14) < 0.05);
  assert.ok(Math.abs(c.penIgnorePct(250) - 76.92) < 0.05);
  assert.ok(Math.abs(c.penIgnorePct(350) - 82.35) < 0.05);
  assert.ok(Math.abs(c.penIgnorePct(500) - 86.96) < 0.05);
  assert.ok(Math.abs(c.penIgnorePct(1000) - 93.02) < 0.05);

  /* 半數點：穿透倍率等於 a 時剛好忽略 50% 防禦。這是這條曲線**與參數無關**的
     幾何性質，跟上面釘死的數值不衝突——一個抓「數值被改了」，
     一個抓「公式被改成別的形狀」。 */
  assert.ok(Math.abs(c.penIgnoreRatio(c.PEN_IGNORE_A * 100) - 0.5) < 1e-12,
    '穿透 = a×100% 時應忽略 50% 防禦');
});

test('忽略防禦為飽和曲線：單調遞增、到不了 100%，且不轉為增傷', () => {
  const c = loadContext();
  assert.equal(c.penDefMultiplier(1), 0);             // 不得出現負防禦
  assert.equal(c.penDefMultiplier(0.25), 0.75);
  let prev = 0;
  [100, 500, 1000, 5000, 100000].forEach((pen) => {
    const r = c.penIgnoreRatio(pen);
    assert.ok(r > prev, '忽略防禦應隨穿透遞增：' + pen);
    assert.ok(r < 1, '忽略防禦不得達到 100%：' + pen);
    prev = r;
  });
  assert.equal(typeof c.penOverflowDmgMultiplier, 'undefined', '溢出增傷乘區已移除');
});

test('resolveHit：穿透只折減防禦，敵方永遠保留一小部分防禦', () => {
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
  const mid = hit(350);              // 忽略 70% 防禦
  const high = hit(5000);            // 忽略 97.1% 防禦，仍非全免
  assert.ok(mid > base, '穿透應提高傷害');
  assert.ok(high > mid);
  assert.ok(high < 1000, '防禦未歸零，傷害不得達到攻擊力全額：' + high);
  // 傷害對得上公式：攻擊力 × (1 - 防禦減傷(防禦 × (1 - 忽略防禦比率)))
  const expectAt = (pen) => {
    const def = 500 * c.penDefMultiplier(c.penIgnoreRatio(pen));
    return Math.round(1000 * (1 - c.defReduction(def, 1)));
  };
  assert.ok(Math.abs(mid - expectAt(350)) <= 1, '350% 穿透傷害不符：' + mid);
  assert.ok(Math.abs(high - expectAt(5000)) <= 1, '5000% 穿透傷害不符：' + high);
});

test('技能不再有降低敵人防禦效果，改為穿透增益 penUp', () => {
  const skills = read('js/skills.js');
  const skillsCsv = read('config/CSV/Skills.csv');
  // 技能定義與里程碑皆不得再出現 defDown（僅保留 buffLabel／浮字分類的相容對照）
  // 2026-08-11 技能及狀態改造：增益改以狀態引用 status:[{id:'penUp',…}] 表達（→ config/Excel/Status.xlsx）
  assert.doesNotMatch(skills, /id: 'defDown'/);
  assert.ok(!skillsCsv.includes('defDown'), 'Skills 表仍有 defDown');
  assert.match(skills, /armorBreak:.*status: \[\{ id: 'penUp', base: 25, per: 5, dur: 5 \}\]/);
  assert.match(skills, /whirlwind: \{ 4: \{ status: \[\{ id: 'slow', dur: 2 \}\] \}, 8: \{ status: \[\{ id: 'slow', dur: 3 \}, \{ id: 'penUp'/);
  assert.match(skills, /manaBurn: \{ 4: \{ mpOnCrit: 35 \}, 8: \{ mpOnCrit: 40, status: \[\{ id: 'penUp'/);
  assert.match(read('js/status.js'), /penUp: \{ name: '物理\/魔法穿透'/);
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
  // 2026-07-30 技能融合改造：增益改走 skillFxBuffList 存取器（支援融合技 buffList），閘門語意不變
  const skills = read('js/skills.js');
  assert.match(skills, /if \(firstBuff && !fx\.dmgType && buffVal\(pEnt, statusRefKey\(firstBuff\)\) > 0\) return false;/);
});
