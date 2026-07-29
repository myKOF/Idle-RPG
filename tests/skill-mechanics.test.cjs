/* 45 新技能 × 11 機制族：存在性／fxVal／effectiveFx／確定性機制單元測試／說明產生器
   harness 比照 tests/skill-gcd.test.cjs：Node vm 依載入順序執行瀏覽器全域 script。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} !== ${expected}`);
}

function loadGameContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {},
    clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    RUN_STATS: { skills: {} },
    blog() {},
    floatText() {},
    trackDps() {},
    recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: {
      level: 1,
      reincarnations: 0,
      skills: {},
      talents: { levels: {}, potentialLevels: {} },
      loadout: [],
      fusions: []
    },
    stage: { current: 1 }
  };
  context.getStats = () => baseStats();
  return context;
}

// 傷害結算所需的最小屬性集（比照 skill-gcd harness 的 stub）
function baseStats(extra) {
  return Object.assign({
    cdr: 0, castSpeed: 0, hp: 1000, mp: 1000, atk: 100, matk: 100,
    aoeDmg: 0, critRate: 0, critDmg: 150, pPen: 0, mPen: 0, hit: 100, level: 1,
    passives: {}, lifesteal: 0, manaSteal: 0, shieldEff: 0, skillTriggers: {}
  }, extra || {});
}

function playerEntity(extra) {
  return Object.assign({
    hp: 1000, mp: 1000, shield: 0, atkCd: 0,
    skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {}
  }, extra || {});
}

function makeEnemy(extra) {
  return Object.assign({
    hp: 10000, maxHp: 10000, def: 0, mdef: 0, dodge: 0, resist: {},
    ctrlRes: 0, elite: false, isBoss: false, buffs: {}, dots: [], effects: {}, shield: 0
  }, extra || {});
}

/* PLAN.md §3 定案表的 45 個新技能 id（依表列順序、各系 9 個） */
const NEW45 = {
  phys: ['soulBrandFlurry', 'sinDetonate', 'echoBlade', 'warSpiritEngine', 'pursuitDecree',
    'warOverture', 'woundCollapse', 'mindflowChain', 'swordDomain'],
  magic: ['stormSigil', 'runeShatter', 'emberEcho', 'infernoDomain', 'plagueBurst',
    'frostResonance', 'astralConduit', 'bloodSurge', 'rimeTide'],
  def: ['aegisBurst', 'overflowVerdict', 'stigmaCycle', 'soulEcho', 'holyLitany',
    'sustainHymn', 'bastionCycle', 'martyrCharge', 'sanctify'],
  special: ['fateRoulette', 'bestReplay', 'chronoPilfer', 'gamblerChips', 'omniBrand',
    'arcaneAllIn', 'flowSurge', 'comboResonance', 'chronoAnchor'],
  passive: ['phantomEcho', 'reaperTempo', 'battleReflex', 'virulentPulse', 'zeroCadence',
    'afterimagePursuit', 'bulwarkFeedback', 'huntSigil', 'lingeringGlow']
};
const NEW45_FLAT = Object.keys(NEW45).reduce((acc, cat) => acc.concat(NEW45[cat]), []);

// fx 純 JSON 資料檢查：只允許 數字/字串/布林/null/陣列/物件（不可含 function/undefined/NaN）
function assertJsonSafe(v, where) {
  if (v === null) return;
  const t = typeof v;
  if (t === 'number') {
    assert.ok(isFinite(v), `${where} 含非有限數字`);
    return;
  }
  if (t === 'string' || t === 'boolean') return;
  assert.notEqual(t, 'function', `${where} 含 function`);
  assert.notEqual(t, 'undefined', `${where} 含 undefined`);
  assert.equal(t, 'object', `${where} 非法型別 ${t}`);
  if (Array.isArray(v)) {
    v.forEach((x, i) => assertJsonSafe(x, `${where}[${i}]`));
    return;
  }
  for (const k in v) assertJsonSafe(v[k], `${where}.${k}`);
}

/* ================= 1) 45 技存在性 ================= */

test('SKILLS 共 99 筆（21/21/19/19/19）＋潛力 10 筆＝技能表 109 列', () => {
  const c = loadGameContext();
  const cats = {};
  let total = 0;
  for (const id in c.SKILLS) {
    total++;
    cats[c.SKILLS[id].cat] = (cats[c.SKILLS[id].cat] || 0) + 1;
  }
  assert.equal(total, 99);
  assert.equal(cats.phys, 21);
  assert.equal(cats.magic, 21);
  assert.equal(cats.def, 19);
  assert.equal(cats.special, 19);
  assert.equal(cats.passive, 19);
  // 任務規格「共 109」＝SKILLS 99 ＋ 潛力技能 10（Skills 配置表 109 列）
  assert.equal(c.POTENTIAL_TALENTS.length, 10);
  assert.equal(total + c.POTENTIAL_TALENTS.length, 109);
});

test('45 新技能全數存在、分類正確、接在各系尾端', () => {
  const c = loadGameContext();
  for (const cat in NEW45) {
    NEW45[cat].forEach((id) => {
      assert.ok(c.SKILLS[id], `缺少技能 ${id}`);
      assert.equal(c.SKILLS[id].cat, cat, `${id} 分類應為 ${cat}`);
    });
    // 各系尾端＝該系定義順序的最後 9 筆即為新技能（PLAN §0 零存檔遷移條款）
    const catIds = Object.keys(c.SKILLS).filter((id) => c.SKILLS[id].cat === cat);
    assert.deepEqual(catIds.slice(-9), NEW45[cat], `${cat} 系尾端 9 筆應為新技能`);
  }
});

test('45 新技能 id 與 emoji 彼此唯一，且皆有名稱與 flavor', () => {
  const c = loadGameContext();
  const ids = new Set();
  const emojis = new Set();
  NEW45_FLAT.forEach((id) => {
    const sk = c.SKILLS[id];
    assert.ok(!ids.has(id), `id 重複：${id}`);
    ids.add(id);
    assert.ok(!emojis.has(sk.emoji), `emoji 重複：${id} ${sk.emoji}`);
    emojis.add(sk.emoji);
    assert.ok(sk.name && typeof sk.name === 'string');
    assert.ok(sk.flavor && typeof sk.flavor === 'string');
    assert.ok(Array.isArray(sk.tags), `${id} 缺 tags 陣列`);
  });
  assert.equal(ids.size, 45);
  assert.equal(emojis.size, 45);
});

test('45 筆基礎 fx 與 M4/M8 里程碑皆為可 JSON 化的純資料', () => {
  const c = loadGameContext();
  NEW45_FLAT.forEach((id) => {
    const sk = c.SKILLS[id];
    assert.ok(sk.fx && typeof sk.fx === 'object', `${id} 缺 fx`);
    assertJsonSafe(sk.fx, `${id}.fx`);
    // JSON 往返不失真（無 function/undefined 掉欄位）
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(sk.fx))), JSON.stringify(sk.fx));
    const un = c.UNLOCKS[id];
    assert.ok(un && un[4] && un[8], `${id} 缺 M4/M8 里程碑`);
    assertJsonSafe(un[4], `${id}.M4`);
    assertJsonSafe(un[8], `${id}.M8`);
  });
});

/* ================= 2) fxVal 與 effectiveFx ================= */

test('fxVal：純量原樣、{base,per} 走 scaleAt 語意', () => {
  const c = loadGameContext();
  assert.equal(c.fxVal(5, 3), 5);
  assert.equal(c.fxVal(true, 7), true);
  assert.equal(c.fxVal('cat:def', 2), 'cat:def');
  assert.equal(c.fxVal(null, 1), null);
  assert.equal(c.fxVal({ base: 10, per: 2 }, 1), 10);
  assert.equal(c.fxVal({ base: 10, per: 2 }, 4), 16);
  assert.equal(c.fxVal({ base: 3 }, 5), 3);         // 無 per＝固定值
  assertClose(c.fxVal({ base: 1.5, per: 0.1 }, 11), 2.5);
});

test('effectiveFx：新被動與主動的 M4/M8 淺層覆蓋生效', () => {
  const c = loadGameContext();
  // 零式節律（被動）：lv1 每第 5 次；M4 → 4；M8 追加 noGcd
  const z1 = c.effectiveFx('zeroCadence', c.SKILLS.zeroCadence, 1);
  const z4 = c.effectiveFx('zeroCadence', c.SKILLS.zeroCadence, 4);
  const z8 = c.effectiveFx('zeroCadence', c.SKILLS.zeroCadence, 8);
  assert.equal(z1.passiveNthFree.n, 5);
  assert.equal(z1.passiveNthFree.noGcd, undefined);
  assert.equal(z4.passiveNthFree.n, 4);
  assert.equal(z8.passiveNthFree.n, 4);
  assert.equal(z8.passiveNthFree.noGcd, true);
  // 死神節拍（被動）：M4 selfResetPct、M8 inclBasic
  const r4 = c.effectiveFx('reaperTempo', c.SKILLS.reaperTempo, 4);
  const r8 = c.effectiveFx('reaperTempo', c.SKILLS.reaperTempo, 8);
  assert.equal(r4.passiveKillCd.selfResetPct, 15);
  assert.equal(r4.passiveKillCd.inclBasic, undefined);
  assert.equal(r8.passiveKillCd.inclBasic, true);
  // 烙魂連斬（主動）：lv1 疊 3；M4 疊 5；M8 儲 45%、10 秒
  const s1 = c.effectiveFx('soulBrandFlurry', c.SKILLS.soulBrandFlurry, 1);
  const s4 = c.effectiveFx('soulBrandFlurry', c.SKILLS.soulBrandFlurry, 4);
  const s8 = c.effectiveFx('soulBrandFlurry', c.SKILLS.soulBrandFlurry, 8);
  assert.equal(s1.brand.maxStacks, 3);
  assert.equal(s4.brand.maxStacks, 5);
  assert.equal(s4.brand.storePct, 30);
  assert.equal(s8.brand.storePct, 45);
  assert.equal(s8.brand.dur, 10);
  // 斷罪引爆 M8：倍率基準 150、重置 40%、暈眩重申
  const d8 = c.effectiveFx('sinDetonate', c.SKILLS.sinDetonate, 8);
  assert.equal(d8.detonate.multPct.base, 150);
  assert.equal(d8.detonate.resetCd.pct, 40);
  assert.equal(d8.detonate.stunDur, 1);
  // 凜冬迴潮 M8：雙鍵（cdResetOnKill＋cdResetOnKill2）同時重申＋回捲 cdShift
  const t8 = c.effectiveFx('rimeTide', c.SKILLS.rimeTide, 8);
  assert.equal(t8.cdResetOnKill.pct, 30);
  assert.equal(t8.cdResetOnKill2.othersPct, 20);
  assertClose(t8.cdShift.sec.base, 2.5);
  // 低於里程碑等級不套用
  const t3 = c.effectiveFx('rimeTide', c.SKILLS.rimeTide, 3);
  assert.equal(t3.cdResetOnKill, undefined);
});

/* ================= 3) 確定性機制單元測試 ================= */

test('buffExtend：累計延長封頂於原始持續 100%，低剩餘加倍', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  // GT=0：dur 10 → 累計延長上限 10 秒
  const entry = { until: 5, dur: 10, ext: 0 };
  c.skillRtExtendEntry(entry, 6, false);
  assert.equal(entry.until, 11);
  assert.equal(entry.ext, 6);
  c.skillRtExtendEntry(entry, 6, false); // 只剩 4 秒可延
  assert.equal(entry.until, 15);
  assert.equal(entry.ext, 10);
  c.skillRtExtendEntry(entry, 6, false); // 已達 100% → 不再延長
  assert.equal(entry.until, 15);
  assert.equal(entry.ext, 10);
  // lowThreshold2x：剩餘 < BUFF_EXTEND_LOW_REMAIN_SEC（2 秒）時延長加倍
  const low = { until: 1, dur: 10, ext: 0 };
  c.skillRtExtendEntry(low, 1, true);
  assert.equal(low.ext, 2);
  const high = { until: 5, dur: 10, ext: 0 };
  c.skillRtExtendEntry(high, 1, true); // 剩餘 5 秒 → 不加倍
  assert.equal(high.ext, 1);
  // 經 skillRtExtendSelfBuffs 對玩家增益整批延長（applyBuff 補存 dur/ext）
  const p = playerEntity();
  c.applyBuff(p, 'atkUp', 10, 8);
  assert.equal(p.buffs.atkUp.dur, 8);
  assert.equal(p.buffs.atkUp.ext, 0);
  c.skillRtExtendSelfBuffs(p, 100, false); // 一口氣要求 100 秒 → 封頂 8 秒
  assert.equal(p.buffs.atkUp.ext, 8);
  assert.equal(p.buffs.atkUp.until, 16);
});

test('dotDetonate：引爆倍率雙重夾 DOT_DETONATE_CAP_PCT=100 並結清 DoT', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  assert.equal(c.DOT_DETONATE_CAP_PCT, 100);
  const st = baseStats();
  // pct 150、fx.cap 200 → 仍夾到全域上限 100%
  const t = makeEnemy({ dots: [{ dps: 100, until: 5, dur: 5, name: '燃燒' }] }); // 剩餘 5 秒 × 100 dps ＝ 500
  const out = { killed: false, dmg: 0 };
  const extra = c.skillRtApplyDotOps([t], { dotDetonate: { pct: 150, cap: 200 } }, 1, st, 'mv-float', [], out);
  assert.equal(extra, 500); // 500 × 100%（非 150%）
  assert.equal(t.hp, 9500);
  assert.equal(t.dots.length, 0); // 結清
  // 上限內照 pct 結算：80% → 400
  const t2 = makeEnemy({ dots: [{ dps: 100, until: 5, dur: 5, name: '燃燒' }] });
  const extra2 = c.skillRtApplyDotOps([t2], { dotDetonate: { pct: { base: 80, per: 1 }, cap: 100 } }, 1, st, 'mv-float', [], out);
  assert.equal(extra2, 400);
});

test('shieldBurst：追加傷害上限 matk × SHIELD_BURST_ATK_MULT_CAP=10，護盾實際消耗', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  assert.equal(c.SHIELD_BURST_ATK_MULT_CAP, 10);
  const st = baseStats({ matk: 100 });
  const p = playerEntity({ shield: 1000000, shieldMax: 1000000 });
  const parts = [];
  // capAtkMult 99 也會被全域上限夾回 10 → flat ≤ 100 × 10 ＝ 1000
  const res = c.skillRtApplyDamageAmps(p, { cd: 14 }, { shieldBurst: { convertPct: 100, capAtkMult: 99 } },
    'aegisBurst', 1, st, [], null, parts);
  assert.equal(res.flat, 1000);
  assert.equal(p.shield, 0); // convertPct 100 → 護盾全數消耗
  // 護盾量低於上限時照 convertPct 轉換
  c.resetSkillRT();
  const p2 = playerEntity({ shield: 500, shieldMax: 500 });
  const res2 = c.skillRtApplyDamageAmps(p2, { cd: 14 }, { shieldBurst: { convertPct: 60, capAtkMult: 10 } },
    'aegisBurst', 1, st, [], null, []);
  assert.equal(res2.flat, 300);
  assertClose(p2.shield, 200);
});

test('hpSacrifice：獻祭不致死（至少留 1 點生命）且增傷正確', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  const st = baseStats();
  // hpPct 100 但生命只有 50 → 只能獻祭 49、留 1
  const p = playerEntity({ hp: 50 });
  const res = c.skillRtApplyDamageAmps(p, { cd: 16 }, { hpSacrifice: { hpPct: 100, ampPct: 50 } },
    'bloodSurge', 1, st, [], null, []);
  assert.equal(p.hp, 1);
  assertClose(res.mult, 1.5);
  // 正常情境：15% 當前生命、增傷 fxVal({80,2}, lv3)=84%
  c.resetSkillRT();
  const p2 = playerEntity({ hp: 1000 });
  const res2 = c.skillRtApplyDamageAmps(p2, { cd: 16 }, { hpSacrifice: { hpPct: 15, ampPct: { base: 80, per: 2 } } },
    'bloodSurge', 3, st, [], null, []);
  assertClose(p2.hp, 850);
  assertClose(res2.mult, 1.84);
  // 生命只剩 1 → 獻祭 0、不增傷
  c.resetSkillRT();
  const p3 = playerEntity({ hp: 1 });
  const res3 = c.skillRtApplyDamageAmps(p3, { cd: 16 }, { hpSacrifice: { hpPct: 100, ampPct: 50 } },
    'bloodSurge', 1, st, [], null, []);
  assert.equal(p3.hp, 1);
  assertClose(res3.mult, 1);
});

test('印記：儲能＝本次總傷 × storePct（固定不隨級），引爆＝儲能 × multPct', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  const st = baseStats();
  const p = playerEntity();
  const t = makeEnemy();
  const out = { killed: false, dmg: 0 };
  // 塗印：castDmg 1000 × 30% ＝ 300
  const brandFx = { brand: { name: '魂痕', storePct: 30, dur: 8, maxStacks: 3 } };
  c.skillRtApplyBrandOps(p, { name: '烙魂連斬' }, brandFx, 1, st, [t], 'mv-float', [], out, 1000);
  assert.equal(t.brands.length, 1);
  assert.equal(t.brands[0].stored, 300);
  assert.equal(t.brands[0].stacks, 1);
  // storePct 固定不隨級：lv 11 塗印儲能不變（仍 30%、疊 1 層加 300）
  c.skillRtApplyBrandOps(p, { name: '烙魂連斬' }, brandFx, 11, st, [t], 'mv-float', [], out, 1000);
  assert.equal(t.brands[0].stored, 600);
  assert.equal(t.brands[0].stacks, 2);
  // 疊滿後只刷新持續、儲能封頂（第 3、4 次塗印）
  c.skillRtApplyBrandOps(p, { name: '烙魂連斬' }, brandFx, 1, st, [t], 'mv-float', [], out, 1000);
  assert.equal(t.brands[0].stacks, 3);
  assert.equal(t.brands[0].stored, 900);
  c.skillRtApplyBrandOps(p, { name: '烙魂連斬' }, brandFx, 1, st, [t], 'mv-float', [], out, 1000);
  assert.equal(t.brands[0].stacks, 3);
  assert.equal(t.brands[0].stored, 900); // 疊滿不再累加
  // 引爆：900 × 120% ＝ 1080 真傷直扣、印記消耗
  const hpBefore = t.hp;
  const extra = c.skillRtApplyBrandOps(p, { name: '斷罪引爆' },
    { detonate: { brand: 'any', multPct: { base: 120, per: 3 } } }, 1, st, [t], 'mv-float', [], out, 0);
  assert.equal(extra, 1080);
  assert.equal(t.hp, hpBefore - 1080);
  assert.equal(t.brands.length, 0);
  // multPct 隨級成長：lv 5 → 120 + 3×4 ＝ 132%
  assertClose(c.fxVal({ base: 120, per: 3 }, 5), 132);
});

test('cdShift：扣秒／scope 篩選／extraPct 追削／focus:longest／zeroSelfCdrPct', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  const p = playerEntity({ skillCds: { fireball: 10, powerSlash: 8, iceLance: 0 }, _skillReadyOrder: {}, _skillReadySeq: 0 });
  // 無 scope：全部冷卻中其他技 −3 秒（歸零者不動、自身排除）
  c.skillRtShiftOthers(p, 'rimeTide', 3, 0, null);
  assert.equal(p.skillCds.fireball, 7);
  assert.equal(p.skillCds.powerSlash, 5);
  assert.equal(p.skillCds.iceLance, 0);
  // scope 'cat:phys'：只影響物理技（fireball 是 magic）
  c.skillRtShiftOthers(p, 'pursuitDecree', 2, 0, 'cat:phys');
  assert.equal(p.skillCds.fireball, 7);
  assert.equal(p.skillCds.powerSlash, 3);
  // extraPct：扣後再削剩餘 10%（追擊號令 M8）：7−1.5＝5.5 → ×0.9＝4.95
  c.skillRtShiftOthers(p, 'pursuitDecree', 1.5, 10, null);
  assertClose(p.skillCds.fireball, 4.95);
  // 扣到歸零：回報 zeroed 並可立即施放
  const p2 = playerEntity({ skillCds: { fireball: 2 }, _skillReadyOrder: {}, _skillReadySeq: 0 });
  const zeroed = c.skillRtShiftOthers(p2, 'x', 5, 0, null);
  // 註：vm 跨 realm 陣列不能用 deepStrictEqual（原型不同），改比對內容
  assert.equal(zeroed.length, 1);
  assert.equal(zeroed[0], 'fireball');
  assert.equal(p2.skillCds.fireball, 0);
  // focus:'longest'（竊時者）：全部秒數灌給剩餘冷卻最長者；sec=fxVal({3,0.2}, lv6)=4
  const p3 = playerEntity({ skillCds: { fireball: 10, powerSlash: 4 }, _skillReadyOrder: {}, _skillReadySeq: 0 });
  c.skillRtShiftCds(p3, 'chronoPilfer', { sec: { base: 3, per: 0.2 }, focus: 'longest' }, 6);
  assert.equal(p3.skillCds.fireball, 6);
  assert.equal(p3.skillCds.powerSlash, 4);
  // zeroSelfCdrPct（竊時者 M8）：被灌技歸零 → 本技冷卻 −50%
  const p4 = playerEntity({ skillCds: { fireball: 2, chronoPilfer: 10 }, _skillReadyOrder: {}, _skillReadySeq: 0 });
  c.skillRtShiftCds(p4, 'chronoPilfer', { sec: { base: 3, per: 0.2 }, focus: 'longest', zeroSelfCdrPct: 50 }, 1);
  assert.equal(p4.skillCds.fireball, 0);
  assert.equal(p4.skillCds.chronoPilfer, 5);
});

test('freeNext：免費施放跳過扣魔與 MP 門檻，用罄自動清除', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  c.Math.random = () => 0.5;
  c.G.player.skills = { powerSlash: 1 };
  c.G.player.loadout = ['powerSlash'];
  c.getStats = () => baseStats({ mp: 1000 });
  const enemy = makeEnemy();
  const p = playerEntity({ mp: 0 });
  // 無免費狀態：MP 0 付不起 → 不施放
  assert.equal(c.pickAndCastSkill(p, enemy, 'mv-float'), null);
  // 授予 freeNext：skillRtWouldBeFree 旁路 MP 門檻、castSkill 不扣魔
  c.SKILL_RT.freeCasts = { count: 1, until: 100, scope: null };
  const result = c.pickAndCastSkill(p, enemy, 'mv-float');
  assert.ok(result && typeof result === 'object');
  assert.equal(p.mp, 0); // 免費施放：MP 不變（未扣成負數）
  assert.ok(enemy.hp < 10000); // 傷害照常結算
  assert.equal(c.SKILL_RT.freeCasts, null); // count 用罄自動清除
  // 之後再施放又付不起
  c.tickSkillCds(p, 60);
  assert.equal(c.pickAndCastSkill(p, enemy, 'mv-float'), null);
});

test('zeroCadence（passiveNthFree）：每第 N 次施放免費並歸零重數', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  const p = playerEntity();
  const st = baseStats({ skillTriggers: { passiveNthFree: { n: 5, ampPct: 40 } } });
  for (let i = 1; i <= 4; i++) {
    const pre = c.skillRtPreCast(p, { cat: 'phys' }, {}, 'powerSlash', 1, st);
    assert.equal(pre.free, false, `第 ${i} 次不應免費`);
    assert.equal(c.SKILL_RT.nthCastCount, i);
  }
  const pre5 = c.skillRtPreCast(p, { cat: 'phys' }, {}, 'powerSlash', 1, st);
  assert.equal(pre5.free, true);
  assert.equal(pre5.ampPct, 40);
  assert.equal(c.SKILL_RT.nthCastCount, 0); // 計數歸零重啟
  // M8 noGcd：免費那次免 GCD
  const st8 = baseStats({ skillTriggers: { passiveNthFree: { n: 1, ampPct: 40, noGcd: true } } });
  const pre8 = c.skillRtPreCast(p, { cat: 'phys' }, {}, 'powerSlash', 1, st8);
  assert.equal(pre8.free, true);
  assert.equal(pre8.noGcd, true);
});

test('stackCharge：疊滿引爆乘算與引爆留層（keepStacks）', () => {
  const c = loadGameContext();
  c.resetSkillRT();
  const st = baseStats();
  const p = playerEntity();
  // scope 'next'：任何傷害技消耗；120% → ×2.2；預設引爆不留層
  c.SKILL_RT.charges['鬥氣'] = { stacks: 3, max: 3, until: 100, burst: { multPct: 120, scope: 'next' }, srcId: 'warSpiritEngine' };
  const res = c.skillRtApplyDamageAmps(p, { cat: 'phys', cd: 5 }, {}, 'powerSlash', 1, st, [], null, []);
  assertClose(res.mult, 2.2);
  assert.equal(c.SKILL_RT.charges['鬥氣'].stacks, 0);
  // keepStacks 1（鬥氣輪轉 M8）：引爆後留 1 層
  c.SKILL_RT.charges['鬥氣'] = { stacks: 3, max: 3, until: 100, burst: { multPct: 150, scope: 'next', keepStacks: 1 }, srcId: 'warSpiritEngine' };
  const res2 = c.skillRtApplyDamageAmps(p, { cat: 'phys', cd: 5 }, {}, 'powerSlash', 1, st, [], null, []);
  assertClose(res2.mult, 2.5);
  assert.equal(c.SKILL_RT.charges['鬥氣'].stacks, 1);
  // 未疊滿不引爆
  c.SKILL_RT.charges['鬥氣'] = { stacks: 2, max: 3, until: 100, burst: { multPct: 120, scope: 'next' }, srcId: 'warSpiritEngine' };
  const res3 = c.skillRtApplyDamageAmps(p, { cat: 'phys', cd: 5 }, {}, 'powerSlash', 1, st, [], null, []);
  assertClose(res3.mult, 1);
});

test('45 筆 fx 實際值抽樣（對照 PLAN.md §3 定案表）', () => {
  const c = loadGameContext();
  const S = c.SKILLS;
  // 烙魂連斬：28/12、3 段各 145%+32%、儲 30% 固定、疊 3、8 秒
  assert.equal(S.soulBrandFlurry.cost, 28);
  assert.equal(S.soulBrandFlurry.cd, 12);
  assert.equal(S.soulBrandFlurry.fx.hits, 3);
  assert.equal(c.fxVal(S.soulBrandFlurry.fx.base, 1), 145);
  assert.equal(S.soulBrandFlurry.fx.per, 32);
  assert.deepEqual(JSON.parse(JSON.stringify(S.soulBrandFlurry.fx.brand)), { name: '魂痕', storePct: 30, dur: 8, maxStacks: 3 });
  // 斷罪引爆：560%+110%、引爆 ×(120%+3%)、重置 25%
  assert.equal(S.sinDetonate.fx.base, 560);
  assert.equal(S.sinDetonate.fx.per, 110);
  assertClose(c.fxVal(S.sinDetonate.fx.detonate.multPct, 5), 132);
  assert.equal(S.sinDetonate.fx.detonate.resetCd.pct, 25);
  // 破軍先聲：8 秒內下一技增幅＝冷卻秒數 ×(4%+0.1%)、上限 120、受惠 1 次
  const wo = S.warOverture.fx.skillAmp;
  assert.equal(wo.scope, 'next');
  assert.equal(wo.dur, 8);
  assert.equal(wo.uses, 1);
  assert.equal(wo.cap, 120);
  assertClose(c.fxVal(wo.perCdSec, 1), 4);
  assertClose(c.fxVal(wo.perCdSec, 11), 5);
  // 連環戰訣：3 秒連段窗 +25%+1%
  assert.equal(S.mindflowChain.fx.comboWindow.dur, 3);
  assertClose(c.fxVal(S.mindflowChain.fx.comboWindow.pct, 3), 27);
  // 追擊號令：其他物理技 −(1.5+0.1)秒
  assert.equal(S.pursuitDecree.fx.cdShift.scope, 'cat:phys');
  assertClose(c.fxVal(S.pursuitDecree.fx.cdShift.sec, 1), 1.5);
  assertClose(c.fxVal(S.pursuitDecree.fx.cdShift.sec, 11), 2.5);
  // 竊時者：竊 (3+0.2)秒 全灌最長冷卻
  assert.equal(S.chronoPilfer.fx.cdShift.focus, 'longest');
  assertClose(c.fxVal(S.chronoPilfer.fx.cdShift.sec, 1), 3);
  // 疫爆術：引爆 ×(80%+1%、上限 100)、瘟疫 DoT 每秒 40%、6 秒
  assertClose(c.fxVal(S.plagueBurst.fx.dotDetonate.pct, 1), 80);
  assert.equal(S.plagueBurst.fx.dotDetonate.cap, 100);
  assert.equal(S.plagueBurst.fx.requiresTargetDot, true);
  assert.equal(S.plagueBurst.fx.dot.pct, 40);
  assert.equal(S.plagueBurst.fx.dot.dur, 6);
  // 聖盾崩華：引爆護盾 60%、上限 matk×10
  assert.equal(S.aegisBurst.fx.shieldBurst.convertPct, 60);
  assert.equal(S.aegisBurst.fx.shieldBurst.capAtkMult, 10);
  // 溢流聖罰：治療 12%+3%、溢出 ×(40%+2%、上限 90)
  assertClose(c.fxVal(S.overflowVerdict.fx.healPctMax, 1), 12);
  assertClose(c.fxVal(S.overflowVerdict.fx.overhealDmg.pct, 2), 42);
  assert.equal(S.overflowVerdict.fx.overhealDmg.cap, 90);
  // 聖痕輪迴：儲 35%、8 秒、上限最大生命 20%、引爆 ×130%
  assert.deepEqual(JSON.parse(JSON.stringify(S.stigmaCycle.fx.stigma)), { storePct: 35, dur: 8, capMaxHpPct: 20, multPct: 130 });
  // 心流湧動：(5+0.3)秒、免費 2 個
  assert.equal(S.flowSurge.fx.freeNext.count, 2);
  assertClose(c.fxVal(S.flowSurge.fx.freeNext.dur, 1), 5);
  assertClose(c.fxVal(S.flowSurge.fx.freeNext.dur, 11), 8);
  // 奧能梭哈：0 耗魔、每 10MP +(2%+0.15%)
  assert.equal(S.arcaneAllIn.cost, 0);
  assert.equal(S.arcaneAllIn.cd, 25);
  assertClose(c.fxVal(S.arcaneAllIn.fx.mpDump.pctPer10Mp, 1), 2);
  // 蓄怒之盾：被打疊層上限 4、15 秒、疊滿 ×(200%+6%)
  const mc = S.martyrCharge.fx.charge;
  assert.equal(mc.source, 'hitTaken');
  assert.equal(mc.max, 4);
  assert.equal(mc.dur, 15);
  assertClose(c.fxVal(mc.burst.multPct, 1), 200);
  // 賭徒籌碼：押 1~3 枚、上限 5
  assert.deepEqual(JSON.parse(JSON.stringify(S.gamblerChips.fx.charge.addRange)), [1, 3]);
  assert.equal(S.gamblerChips.fx.charge.max, 5);
  // 壁壘迴環：ai:shield、被打 −0.4 秒（icd 0.5）
  assert.equal(S.bastionCycle.ai, 'shield');
  assertClose(S.bastionCycle.fx.cdOnHitTaken.sec, 0.4);
  assertClose(S.bastionCycle.fx.cdOnHitTaken.icdSec, 0.5);
  // 續光聖詠：延長自身增益 2 秒；時之錨：(1.5+0.15)秒
  assert.equal(c.fxVal(S.sustainHymn.fx.buffExtend.sec, 1), 2);
  assertClose(c.fxVal(S.chronoAnchor.fx.buffExtend.sec, 1), 1.5);
  // 蝕骨頻率：DoT 跳速 ×(1+20%+2%)
  assertClose(c.fxVal(S.virulentPulse.fx.passiveDotHaste.mult, 1), 1.2);
  assertClose(c.fxVal(S.virulentPulse.fx.passiveDotHaste.mult, 6), 1.3);
  // 流光永續：每次施放延長 (0.4+0.05)秒
  assertClose(c.fxVal(S.lingeringGlow.fx.passiveCastExtend.sec, 1), 0.4);
  assertClose(c.fxVal(S.lingeringGlow.fx.passiveCastExtend.sec, 5), 0.6);
  // 殘響法則：2 秒後 (15%+1%) 機率以 30% 威力回響
  assert.equal(S.phantomEcho.fx.passiveEcho.delay, 2);
  assertClose(c.fxVal(S.phantomEcho.fx.passiveEcho.pct, 6), 20);
  assert.equal(S.phantomEcho.fx.passiveEcho.powerPct, 30);
});

/* ================= 4) 說明產生器 ================= */

test('45 技呼叫 describeSkill（lv1/4/8/20）不拋錯且回傳非空字串', () => {
  const c = loadGameContext();
  NEW45_FLAT.forEach((id) => {
    [1, 4, 8, 20].forEach((lv) => {
      let desc;
      assert.doesNotThrow(() => { desc = c.describeSkill(id, lv); }, `${id}@lv${lv} 拋錯`);
      assert.equal(typeof desc, 'string', `${id}@lv${lv} 非字串`);
      assert.ok(desc.length > 0, `${id}@lv${lv} 空字串`);
    });
  });
});
