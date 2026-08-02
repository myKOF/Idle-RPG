/* 2026-07-30 技能融合系統改造：種子演算法／佔用制／未學習融合技／上限 10+5／
   技能熟練度／魔法卷軸／存檔遷移。harness 比照 tests/skill-mechanics.test.cjs。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadGameContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    RUN_STATS: { skills: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {},
    markStatsDirty() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: {
      level: 999, xp: 0, reincarnations: 0,
      gold: 10000000, magicScroll: 1000,
      skills: {}, skillUnlocks: {},
      skillMastery: { level: 0, xp: 0 },
      talents: { levels: {}, potentialLevels: {} },
      loadout: [], fusions: []
    },
    stage: { current: 1 }
  };
  return context;
}

function comps(c, ids) {
  return c.fusionComps(ids);
}

// 素材滿級（10 級基準）傷害%（base + per×9）
function matMaxDmg(c, id) {
  const fx = c.effectiveFx(id, c.SKILLS[id], 10);
  return (fx.base || 0) + (fx.per || 0) * 9;
}

test('融合技在既有命中結算後將最終傷害乘 2，普通技能維持原值', () => {
  const c = loadGameContext();
  const fusionTarget = { hp: 875, shield: 0 };
  const fusionResult = { dmg: 125, miss: false, killed: false };
  c.applySkillFinalDamageMultiplier(fusionTarget, fusionResult, true);
  assert.equal(fusionResult.dmg, 250);
  assert.equal(fusionTarget.hp, 750);

  const normalTarget = { hp: 875, shield: 0 };
  const normalResult = { dmg: 125, miss: false, killed: false };
  c.applySkillFinalDamageMultiplier(normalTarget, normalResult, false);
  assert.equal(normalResult.dmg, 125);
  assert.equal(normalTarget.hp, 875);
});

/* ================= 1) 種子確定性 ================= */

test('同 seed＋同素材 → 完全相同結果；異 seed 會出現不同結果', () => {
  const c = loadGameContext();
  const cp = comps(c, ['fireball', 'iceLance', 'powerSlash']);
  const a = c.fusionGenerateFx(cp, 123456789);
  const b = c.fusionGenerateFx(cp, 123456789);
  assert.deepEqual(a, b);
  let anyDiff = false;
  for (let s = 1; s <= 50 && !anyDiff; s++) {
    const d = c.fusionGenerateFx(cp, s);
    if (JSON.stringify(d) !== JSON.stringify(a)) anyDiff = true;
  }
  assert.ok(anyDiff, '不同種子應產生不同結果');
});

test('buildFusionRuntimeDef：以 record.seed 重算，快照不存 fx、cost/cd 由素材推導', () => {
  const c = loadGameContext();
  const rec = { id: 'fusion_t1', name: 'X', cat: 'fusion', components: ['fireball', 'iceLance'], seed: 42 };
  const def1 = c.buildFusionRuntimeDef(rec);
  const def2 = c.buildFusionRuntimeDef(rec);
  assert.deepEqual(def1.fx, def2.fx);
  assert.equal(def1.cat, 'fusion');
  assert.equal(def1.cost, (c.SKILLS.fireball.cost || 0) + (c.SKILLS.iceLance.cost || 0));
  assert.equal(def1.cd, Math.round(Math.max(c.SKILLS.fireball.cd, c.SKILLS.iceLance.cd) * c.FUSION_CD_FACTOR));
});

/* ================= 2) 物魔判定 ================= */

test('物魔判定：純物理→phys、純魔法→magic、含真傷素材→true；混合出現三種且 both 約 10%', () => {
  const c = loadGameContext();
  const pureP = comps(c, ['powerSlash', 'doubleStrike']);
  const pureM = comps(c, ['fireball', 'iceLance']);
  const withTrue = comps(c, ['voidRift', 'powerSlash']); // 虛空裂隙＝真傷
  for (let s = 1; s <= 30; s++) {
    assert.equal(c.fusionGenerateFx(pureP, s).fx.dmgType, 'phys');
    assert.equal(c.fusionGenerateFx(pureM, s).fx.dmgType, 'magic');
    assert.equal(c.fusionGenerateFx(withTrue, s).fx.dmgType, 'true');
  }
  const mixed = comps(c, ['powerSlash', 'fireball']);
  const seen = { phys: 0, magic: 0, both: 0 };
  const N = 800;
  for (let s = 1; s <= N; s++) seen[c.fusionGenerateFx(mixed, s).fx.dmgType]++;
  assert.ok(seen.phys > 0 && seen.magic > 0 && seen.both > 0, '混合素材應出現三種結果');
  // both 基礎 10%（FUSION_BOTH_BASE_CHANCE）；800 次抽樣容忍 ±5%
  assert.ok(Math.abs(seen.both / N - c.FUSION_BOTH_BASE_CHANCE / 100) < 0.05,
    'both 機率應接近 ' + c.FUSION_BOTH_BASE_CHANCE + '%（實測 ' + (seen.both / N * 100).toFixed(1) + '%）');
});

/* ================= 3) 攻擊力四檔 ================= */

test('攻擊力＝素材滿級平均 × {75,100,125,150}% 四檔（融合技滿級值）', () => {
  const c = loadGameContext();
  const cp = comps(c, ['fireball', 'iceLance']); // fire+ice 各 1 個 → 同屬性加成皆 1
  const avg = (matMaxDmg(c, 'fireball') + matMaxDmg(c, 'iceLance')) / 2;
  const tiers = c.FUSION_ATK_TIERS.map((t) => avg * t / 100);
  const seenTier = new Set();
  for (let s = 1; s <= 200; s++) {
    const fx = c.fusionGenerateFx(cp, s).fx;
    const atMax = (fx.base || 0) + (fx.per || 0) * 9; // 滿級（10 級基準）值
    const hit = tiers.findIndex((t) => Math.abs(atMax - t) < 0.5);
    assert.ok(hit >= 0, '滿級值 ' + atMax + ' 不在四檔 ' + tiers.join('/') + ' 內');
    seenTier.add(hit);
  }
  assert.ok(seenTier.size >= 3, '200 個種子應涵蓋大多數檔位');
});

test('Lv.1 數值 = 滿級值 × FUSION_LV1_RATIO（線性成長）', () => {
  const c = loadGameContext();
  const fx = c.fusionGenerateFx(comps(c, ['fireball', 'iceLance']), 7).fx;
  const atMax = fx.base + fx.per * 9;
  assert.ok(Math.abs(fx.base - atMax * c.FUSION_LV1_RATIO) < 0.2);
});

/* ================= 4) 屬性組合 ================= */

test('多重集組合枚舉：物理(2份)+3屬性 = 4+7+7+4+1 = 23 種（規格例）', () => {
  const c = loadGameContext();
  const bySize = c.fusionEnumCombos(['phys', 'phys', 'fire', 'ice', 'lightning']);
  const sizes = Object.keys(bySize).map(Number).sort((a, b) => a - b);
  assert.deepEqual(sizes, [1, 2, 3, 4, 5]);
  assert.deepEqual(sizes.map((k) => bySize[k].length), [4, 7, 7, 4, 1]);
  // 純 4 屬性 → C(4,1..4) = 4+6+4+1 = 15 種（規格例）
  const pure = c.fusionEnumCombos(['fire', 'ice', 'lightning', 'dark']);
  assert.deepEqual([1, 2, 3, 4].map((k) => pure[k].length), [4, 6, 4, 1]);
});

test('同屬性加成：兩個火系素材 → 火屬性傷害 ×1.25（折入總值）', () => {
  const c = loadGameContext();
  const cp = comps(c, ['fireball', 'meteor']); // 均為 fire
  const avg = (matMaxDmg(c, 'fireball') + matMaxDmg(c, 'meteor')) / 2;
  const amp = 1 + c.FUSION_SAME_ELEM_BONUS / 100;
  const tiers = c.FUSION_ATK_TIERS.map((t) => avg * t / 100 * amp);
  for (let s = 1; s <= 100; s++) {
    const fx = c.fusionGenerateFx(cp, s).fx;
    // vm context 的物件原型不同，改以 JSON 快照比對
    assert.deepEqual(JSON.parse(JSON.stringify(fx.elems)), { fire: 1 }); // 只可能是火
    const atMax = fx.base + fx.per * 9;
    assert.ok(tiers.some((t) => Math.abs(atMax - t) < 0.6),
      '滿級值 ' + atMax + ' 應為四檔 ×' + amp + '：' + tiers.join('/'));
  }
});

test('elems 權重表：多屬性素材產生合計 1 的權重；物理份額以 phys 鍵入表', () => {
  const c = loadGameContext();
  const cp = comps(c, ['powerSlash', 'fireball', 'iceLance']);
  let sawPhysKey = false, sawMulti = false;
  for (let s = 1; s <= 300; s++) {
    const fx = c.fusionGenerateFx(cp, s).fx;
    if (!fx.elems) continue; // 純 phys 組合（僅 phys 份額）不寫 elems
    const sum = Object.keys(fx.elems).reduce((t, k) => t + fx.elems[k], 0);
    assert.ok(Math.abs(sum - 1) < 0.03, 'elems 權重合計應為 1（實測 ' + sum + '）');
    if (fx.elems.phys) sawPhysKey = true;
    if (Object.keys(fx.elems).length > 1) sawMulti = true;
  }
  assert.ok(sawPhysKey, '應出現含 phys 份額的組合');
  assert.ok(sawMulti, '應出現多屬性組合');
});

/* ================= 5) buff/debuff 池與數值檔位 ================= */

test('buff 數值：於「上限一半 ~ 上限」均分 4 檔；dur 沿用素材', () => {
  const c = loadGameContext();
  // 鐵壁（defUp M8 base55 per12 dur8）＋治癒術（M8 buff defUp…同 key 取高）→ 用兩個不同 key 素材更乾淨：
  // 鐵壁 defUp ＋ 時間扭曲 aspdUp（M8 base40 per9 dur7）
  const cp = comps(c, ['ironWall', 'timeWarp']);
  const capOf = {};
  ['ironWall', 'timeWarp'].forEach((id) => {
    const fx = c.effectiveFx(id, c.SKILLS[id], 10);
    [fx.buff, fx.buff2].forEach((b) => {
      if (b) capOf[b.key] = { v: c.scaleAt(b, 10), dur: b.dur };
    });
  });
  for (let s = 1; s <= 120; s++) {
    const fx = c.fusionGenerateFx(cp, s).fx;
    const buffs = c.skillFxBuffList(fx);
    assert.ok(buffs.length >= 1, '至少取 1 個效果');
    buffs.forEach((b) => {
      const cap = capOf[b.key];
      assert.ok(cap, '未知 buff key：' + b.key);
      const atMax = b.base + b.per * 9;
      const tiers = [0, 1, 2, 3].map((i) => cap.v / 2 + (cap.v / 2) * (i / 3));
      assert.ok(tiers.some((t) => Math.abs(atMax - t) < 0.4),
        b.key + ' 滿級值 ' + atMax + ' 應在檔位 ' + tiers.map((t) => t.toFixed(1)).join('/'));
      // 時空漣漪變異會使 dur ×2；其餘沿用素材
      assert.ok(b.dur === cap.dur || b.dur === cap.dur * 2);
    });
  }
});

test('debuff 進 debuffList 且不產生已棄用的 defDown', () => {
  const c = loadGameContext();
  const cp = comps(c, ['weakenCurse', 'stunBlow']); // atkDown 減益素材
  let sawDebuff = false;
  for (let s = 1; s <= 100; s++) {
    const fx = c.fusionGenerateFx(cp, s).fx;
    assert.equal(fx.debuff, undefined);
    c.skillFxDebuffList(fx).forEach((d) => {
      assert.notEqual(d.key, 'defDown');
      sawDebuff = true;
    });
  }
  assert.ok(sawDebuff, '減益素材應能產出 debuffList');
});

/* ================= 6) 特效包與效果融合 ================= */

test('特效整包取自單一素材；約 5% 機率融合兩個素材的特效包（最多 2）', () => {
  const c = loadGameContext();
  // 二連擊（hits）＋ 治癒術（healPctMax/selfCleanse）：跨包鍵並存 ＝ 效果融合
  const cp = comps(c, ['doubleStrike', 'healWound']);
  let merged = 0, N = 1500;
  for (let s = 1; s <= N; s++) {
    const fx = c.fusionGenerateFx(cp, s).fx;
    const hasHits = fx.hits !== undefined || fx.healPctOfDmg !== undefined; // 二連擊包（M8 含吸血）
    const hasHeal = fx.healPctMax !== undefined || fx.selfCleanse !== undefined; // 治癒術包
    // 守護餘燼變異會補 shieldPctMax、生命共鳴補 healPctOfDmg——只以「兩包核心鍵並存」判定
    if (fx.hits !== undefined && fx.healPctMax !== undefined) merged++;
    assert.ok(hasHits || hasHeal, '至少要有一個素材的特效包');
  }
  const rate = merged / N;
  assert.ok(rate > 0, '應出現效果融合');
  assert.ok(rate < 0.15, '效果融合機率應在低檔（實測 ' + (rate * 100).toFixed(1) + '%）');
});

test('傷害範圍（shape）可經特效包被融合技繼承', () => {
  const c = loadGameContext();
  const cp = comps(c, ['whirlwind', 'powerSlash']); // 旋風斬 shape 3*3
  let sawShape = false;
  for (let s = 1; s <= 60 && !sawShape; s++) {
    if (c.fusionGenerateFx(cp, s).shape === '3*3') sawShape = true;
  }
  assert.ok(sawShape, '應能抽到旋風斬的 3*3 範圍');
});

/* ================= 7) fuseSkills 佔用制與花費 ================= */

function learnableSetup(c) {
  const p = c.G.player;
  p.skillMastery.level = 100; // 技能點充足
  p.skills.powerSlash = 3;
  p.skills.fireball = 5;
}

test('fuseSkills：花費金幣＋卷軸；素材保留等級、被佔用不可裝備不可再融合；刪除後釋放', () => {
  const c = loadGameContext();
  learnableSetup(c);
  const p = c.G.player;
  p.loadout = ['powerSlash'];
  const gold0 = p.gold, scroll0 = p.magicScroll;
  assert.equal(c.fuseSkills(['powerSlash', 'fireball']), null);
  assert.equal(p.gold, gold0 - c.fusionGoldCost(2));
  assert.equal(p.magicScroll, scroll0 - c.fusionScrollCost(2));
  assert.equal(p.fusions.length, 1);
  const rec = p.fusions[0];
  assert.equal(typeof rec.seed, 'number');
  assert.equal(rec.fx, undefined);
  assert.equal(rec.componentLevels, undefined); // 新記錄不存凍結等級
  // 素材保留等級、僅卸下
  assert.equal(p.skills.powerSlash, 3);
  assert.equal(p.skills.fireball, 5);
  assert.deepEqual(p.loadout, []);
  // 佔用：不可裝備、不可再融合
  assert.match(c.equipSkillToLoadout('powerSlash') || '', /已投入融合/);
  assert.match(c.fuseSkills(['powerSlash', 'iceLance']) || '', /已投入其他融合技/);
  // 融合技未學習（Lv.0）：不可裝備；升至 Lv.1 後可裝備
  assert.equal(c.skillLevel(rec.id), 0);
  assert.match(c.equipSkillToLoadout(rec.id) || '', /Lv\.1 才可裝備/);
  assert.equal(c.learnOrUpgradeSkill(rec.id), null);
  assert.equal(c.skillLevel(rec.id), 1);
  assert.equal(c.equipSkillToLoadout(rec.id), null);
  // 刪除融合技：釋放素材、點數歸還（等級推導制）
  assert.equal(c.deleteFusion(rec.id), null);
  assert.equal(c.skillUsedInFusion('powerSlash'), null);
  assert.equal(c.equipSkillToLoadout('powerSlash'), null);
});

test('fuseSkills：未學習但已解鎖的素材可融合；未解鎖/被動/潛力/重複素材被拒', () => {
  const c = loadGameContext();
  const p = c.G.player;
  p.skillMastery.level = 100;
  // 未學習（skills 無此鍵）但人物等級足夠 → 已解鎖可融合
  assert.equal(c.fuseSkills(['meteor', 'frostNova']), null);
  // 未解鎖：等級不足且無解鎖記錄
  p.level = 1;
  p.skillUnlocks = {};
  assert.match(c.fuseSkills(['executeStrike', 'rendWound']) || '', /尚未解鎖/);
  p.level = 999;
  // 被動 / 潛力 / 重複 / 卷軸不足
  assert.match(c.fuseSkills(['toughness', 'powerSlash']) || '', /被動技能無法融合/);
  // 潛力技能不在 SKILLS 表（結構性排除），錯誤訊息與融合技素材共用
  assert.match(c.fuseSkills(['dualCoreFusion', 'powerSlash']) || '', /不能作為素材/);
  assert.match(c.fuseSkills(['powerSlash', 'powerSlash']) || '', /重複/);
  p.magicScroll = 0;
  assert.match(c.fuseSkills(['powerSlash', 'iceLance']) || '', /魔法卷軸不足/);
});

/* ================= 8) 等級上限 10／轉生 +5 ================= */

test('skillMaxLv：一般/被動/融合技一律 10；轉生後 15', () => {
  const c = loadGameContext();
  assert.equal(c.skillMaxLv(c.SKILLS.powerSlash), 10);
  assert.equal(c.skillMaxLv(c.SKILLS.toughness), 10);
  assert.equal(c.skillMaxLv({ cat: 'fusion', maxLv: 40 }), 10); // 記錄凍結 maxLv 不再採用
  c.G.player.reincarnations = 1;
  assert.equal(c.skillMaxLv(c.SKILLS.powerSlash), 15);
  assert.equal(c.skillMaxLv({ cat: 'fusion' }), 15);
  c.G.player.reincarnations = 7;
  assert.equal(c.skillMaxLv(c.SKILLS.toughness), 15); // 轉生後固定 +5，不隨轉數續增
});

/* ================= 9) 技能熟練度 ================= */

test('技能熟練度：經驗升級給點、上限封頂；技能點 = 基礎點數 + 熟練度', () => {
  const c = loadGameContext();
  const p = c.G.player;
  const base = c.SKILL_POINT_BASE; // 開局自帶技能數；調整初始技能不該讓本測試變紅
  assert.equal(c.totalSkillPoints(), base);
  c.gainSkillMasteryXp(c.skillMasteryXpForLevel(0)); // 升 1 級
  assert.equal(p.skillMastery.level, 1);
  assert.equal(c.totalSkillPoints(), base + 1);
  // 已用 = 技能等級總和；可用 = 總 − 已用
  p.skills.powerSlash = 2;
  assert.equal(c.availableSkillPoints(), base + 1 - 2);
  // 上限封頂
  p.skillMastery.level = c.SKILL_MASTERY_MAX_LEVEL;
  c.gainSkillMasteryXp(999999999);
  assert.equal(p.skillMastery.level, c.SKILL_MASTERY_MAX_LEVEL);
  assert.equal(p.skillMastery.xp, 0);
});

test('技能熟練度未升級時也刷新技能面板進度', () => {
  const c = loadGameContext();
  c.UI.dirty.skills = false;
  c.gainSkillMasteryXp(1);
  assert.equal(c.G.player.skillMastery.xp, 1);
  assert.equal(c.UI.dirty.skills, true);
});

test('熟練度經驗需求依參數表：⌊30×L³+20⌋', () => {
  const c = loadGameContext();
  assert.equal(c.skillMasteryXpForLevel(0), 20);
  assert.equal(c.skillMasteryXpForLevel(1), 50);
  assert.equal(c.skillMasteryXpForLevel(10), 30020);
});

/* ================= 10) 魔法卷軸換算 ================= */

test('magicScrollFromEssence：精華 × 0.1、機率式進位（期望值精準）', () => {
  const c = loadGameContext();
  c.chance = () => false;
  assert.equal(c.magicScrollFromEssence(25), 2);  // 2.5 → 下取整
  assert.equal(c.magicScrollFromEssence(5), 0);   // 0.5 → 0
  c.chance = () => true;
  assert.equal(c.magicScrollFromEssence(25), 3);  // 2.5 → 進位
  assert.equal(c.magicScrollFromEssence(5), 1);
  assert.equal(c.magicScrollFromEssence(30), 3);  // 3.0 整數不再進位（小數 0 → chance(0)）
});

/* ================= 11) 存檔遷移 ================= */

function loadSaveContext() {
  const context = {
    console, Math, Date,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, key() { return null; }, length: 0 }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js', 'js/skills.js', 'js/player.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('遷移：舊 skillPointBudget → 熟練度、等級夾回上限、舊融合補 seed、佔用素材卸下', () => {
  const c = loadSaveContext();
  const data = {
    version: 1,
    player: {
      level: 500, xp: 0, reincarnations: 0,
      gold: 0,
      skills: { powerSlash: 20, arcaneBurst: 15, fusion_old1: 27 },
      skillPointBudget: 501,
      loadout: ['powerSlash', 'arcaneBurst'],
      fusions: [{
        id: 'fusion_old1', name: '舊融合', cat: 'fusion', cost: 40, cd: 11, maxLv: 27,
        components: ['powerSlash', 'fireball'], componentLevels: [4, 3],
        mutation: { key: 'manaVortex', name: '法力漩渦', desc: 'x' },
        fx: { dmgType: 'phys', base: 100, per: 10 }
      }]
    },
    stage: { current: 1, best: 1, kills: 0, autoAdvance: true, zone: 'plains' }
  };
  const out = c.migrateSave(data);
  // 等級夾回 10（0 轉）
  assert.equal(out.player.skills.powerSlash, 10);
  assert.equal(out.player.skills.arcaneBurst, 10);
  assert.equal(out.player.skills.fusion_old1, 10);
  // 熟練度轉換：max(舊預算 501−基礎, 夾回後已花費 30−基礎)；基礎點數由常數推導，調整初始技能不該讓本測試變紅
  const expectedMastery = 501 - c.SKILL_POINT_BASE;
  assert.equal(out.player.skillMastery.level, expectedMastery);
  assert.equal(out.player.skillPointBudget, undefined);
  // 舊融合記錄補 seed，可重建者移除 fx 快照
  const rec = out.player.fusions[0];
  assert.equal(typeof rec.seed, 'number');
  assert.equal(rec.algo, 2);
  assert.equal(rec.fx, undefined);
  // 佔用素材（powerSlash）自裝載欄卸下；未佔用者保留
  assert.deepEqual(out.player.loadout, ['arcaneBurst']);
  // 冪等：重跑一次結果不變（seed 不再變動）
  const seed1 = rec.seed;
  const again = c.migrateSave(out);
  assert.equal(again.player.fusions[0].seed, seed1);
  assert.equal(again.player.skillMastery.level, expectedMastery);
});

test('遷移：新帳號（無舊欄位）不受影響；魔法卷軸欄位補 0', () => {
  const c = loadSaveContext();
  const fresh = c.migrateSave(c.newGameState());
  assert.equal(fresh.player.skillMastery.level, 0);
  assert.equal(fresh.player.magicScroll, 0);
  assert.equal(fresh.player.skillPointBudget, undefined);
});
