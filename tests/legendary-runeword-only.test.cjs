const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/* 舊版傳奇試算表「重新開放」的 15 個特效（2026-11-05）：全部只由符文真言附帶（js/data.js RUNEWORD_ONLY_LEGENDARY）。
   本檔守兩件事：資料分配（15 個各被 1 組符文真言借用、裝備池不再出現）與 7 個新設計 + 4 個改版特效的執行邏輯。 */
const REOPENED = {
  whirlwindStab: 'rw_assassin', shadowTracker: 'rw_bladedancer', doomProphet: 'rw_bloodmoon',
  mountainSunderer: 'rw_permafrost', berserkBloodAxe: 'rw_legion', unyieldingGuard: 'rw_immortalbody',
  thunderShock: 'rw_thunderemperor', thunderMark: 'rw_stargate', iceSpikeBurst: 'rw_glacier',
  burningLaw: 'rw_smith', godfallMeteor: 'rw_starfall', stormAndThunder: 'rw_galeeye',
  elementHeart: 'rw_genesis', deadTime: 'rw_worldend', heavenlyVow: 'rw_timeloop'
};

function loadContext(files) {
  const context = {
    console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, RUN_STATS: { skills: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  files.forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  return context;
}

function loadEngine() {
  const c = loadContext([
    'js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js',
    'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/skills2.js', 'js/legendary.js'
  ]);
  c.G = { player: { level: 1, reincarnations: 0, talents: { levels: {} }, loadout: [] }, stage: { current: 1 }, tower: { active: false } };
  c.GT = 0;
  return c;
}

function withStats(c, effects, extra) {
  const st = Object.assign({ hp: 1000, mp: 100, legendaryEffects: effects, passives: {}, elemDmgUp: {}, skillTriggers: {} }, extra || {});
  c.getStats = () => st;
  return st;
}

test('15 個重新開放的特效：各被 1 組符文真言借用，不在裝備池，說明與效果參數齊全', () => {
  const c = loadContext(['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/runeword_data.js']);
  assert.deepEqual(Object.keys(c.RUNEWORD_ONLY_LEGENDARY).sort(), Object.keys(REOPENED).sort());
  Object.keys(REOPENED).forEach((key) => {
    const def = c.PASSIVE_POOL[key];
    assert.ok(def && def.legendary && def.desc && def.fx, key + ' 資料齊全');
    assert.equal(def.weaponTypes, undefined, key + ' 不限武器');
    assert.ok(!c.passiveKeysForItem({ kind: 'equip', slot: 'chest' }).includes(key), key + ' 不進裝備池');
    assert.equal(c.passiveAllowedForItem(key, {}), false);
    const owners = c.RUNEWORDS.filter((w) => (w.legend || []).indexOf(key) >= 0).map((w) => w.id);
    assert.deepEqual(Array.from(owners), [REOPENED[key]], key + ' 只由 ' + REOPENED[key] + ' 借用');
  });
  c.RUNEWORDS.forEach((w) => assert.ok((w.legend || []).length <= 1, w.id + ' 最多 1 個傳奇特效'));
  assert.equal(c.LEGACY_LEGENDARY_DISABLED.shadowTracker, undefined, '已重新開放，不再停用');
});

test('舊裝備上殘留的專屬傳奇詞條不生效；只認符文真言借用', () => {
  const c = loadContext(['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js',
    'js/battlefield.js', 'js/item.js']);
  c.G = { player: { level: 1, reincarnations: 0, talents: { levels: {} }, loadout: [] }, stage: { current: 1 }, tower: { active: false },
    equipment: {}, equipmentSets: [] };
  const src = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  assert.match(src, /RUNEWORD_ONLY_LEGENDARY\[passive\.key\]/, '聚合時略過專屬傳奇');
  assert.equal(typeof c.passiveKeysForItem, 'function');
});

test('不屈護衛與元素之心直接改屬性：格擋額外減傷、元素抗性乘以倍率', () => {
  const src = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  assert.match(src, /st\.blockDmgRedExtra\s*=/);
  assert.match(src, /elemResMult/);
  const c = loadContext(['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js']);
  assert.equal(c.PASSIVE_POOL.unyieldingGuard.fx.blockDmgRedExtra, 5);
  assert.equal(c.PASSIVE_POOL.elementHeart.fx.elemResMult, 0.5);
  assert.equal(c.PASSIVE_POOL.elementHeart.fx.elemDmgUpPct, 35);
});

test('風起雷落：風、雷較高者額外獲得較低者 25%；元素之心：所有屬性傷害加成 +35', () => {
  const c = loadEngine();
  let st = withStats(c, { stormAndThunder: true }, { elemDmgUp: { wind: 80, lightning: 40 } });
  let up = c.legendaryElementDamageUp(st, {});
  assert.equal(up.wind, 90, '風 80 較高：+ 雷 40 的 25%');
  assert.equal(up.lightning, 40);
  st = withStats(c, { stormAndThunder: true }, { elemDmgUp: { wind: 20, lightning: 100 } });
  up = c.legendaryElementDamageUp(st, {});
  assert.equal(up.lightning, 105);
  assert.equal(up.wind, 20);
  st = withStats(c, { elementHeart: true }, { elemDmgUp: { fire: 10 } });
  up = c.legendaryElementDamageUp(st, {});
  assert.equal(up.fire, 45);
  assert.equal(up.ice, 35, '沒有任何加成的屬性也 +35');
  st = withStats(c, {}, { elemDmgUp: { wind: 80, lightning: 40 } });
  assert.equal(c.legendaryElementDamageUp(st, {}).wind, 80, '沒有特效時不動');
});

test('燃燒法則：燃燒傷害 +30%；作用時機率把剩餘作用次數用盡；只影響燃燒', () => {
  const c = loadEngine();
  withStats(c, { burningLaw: true });
  const enemy = { hp: 1000, maxHp: 1000, effects: {}, buffs: {}, dots: [] };
  const dot = { name: '燃燒', until: 5, interval: 1, acc: 0 };
  c.chance = () => false;
  const plain = c.legendaryBurnDot(enemy, dot, 1, 1, false);
  assert.deepEqual({ s: plain.seconds, t: plain.tickCount, m: plain.mult }, { s: 1, t: 1, m: 1.3 });
  c.chance = () => true;
  const all = c.legendaryBurnDot(enemy, dot, 1, 1, false);
  assert.deepEqual({ s: all.seconds, t: all.tickCount }, { s: 6, t: 6 }, '本次 1 秒 + 剩餘 5 秒的作用次數一次結算');
  assert.equal(dot.until, 0);
  assert.equal(c.legendaryBurnDot(enemy, { name: '中毒', until: 5, interval: 1 }, 1, 1, false), null);
  const expired = c.legendaryBurnDot(enemy, { name: '燃燒', until: 0, interval: 1, acc: 0.4 }, 0.4, 1, true);
  assert.equal(expired.mult, 1.3, '到期結算也吃增傷');
  withStats(c, {});
  assert.equal(c.legendaryBurnDot(enemy, { name: '燃燒', until: 5, interval: 1 }, 1, 1, false), null, '沒有特效不處理');
});

test('雷霆之震：受到傷害時機率對攻擊者反射 200% 雷電傷害（含被護盾吸收的）', () => {
  const c = loadEngine();
  withStats(c, { thunderShock: true }, { level: 1, atk: 0, matk: 1000, hit: 100, critRate: 0, critDmg: 150, pPen: 0, mPen: 0,
    elemDmgPct: null, eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: {} });
  const player = { hp: 500, mp: 0, shield: 0, buffs: {}, effects: {} };
  c.FIELD.player = player;
  const mk = () => ({ hp: 1e7, maxHp: 1e7, level: 1, def: 0, mdef: 0, pRes: 0, mRes: 0, resist: {}, dodge: 0, effects: {}, buffs: {}, dots: [] });
  let enemy = mk();
  c.chance = () => true;
  c.legendaryOnPlayerDamaged(enemy, player, 10, false, { thorns: 0 }, 'pv-float');
  assert.ok(enemy.hp < 1e7, '攻擊者被反射傷害');
  const dealt = 1e7 - enemy.hp;
  assert.ok(dealt > 1200 && dealt < 3300, '約 200% 魔攻（含浮動）：' + dealt);
  enemy = mk();
  c.legendaryOnPlayerDamaged(enemy, player, 0, false, { thorns: 0, absorbed: 30 }, 'pv-float');
  assert.ok(enemy.hp < 1e7, '被護盾吸收的傷害也算受到傷害');
  enemy = mk();
  c.legendaryOnPlayerDamaged(enemy, player, 0, false, { thorns: 0, absorbed: 0 }, 'pv-float');
  assert.equal(enemy.hp, 1e7, '沒受到傷害不觸發');
  enemy = mk();
  c.chance = () => false;
  c.legendaryOnPlayerDamaged(enemy, player, 10, false, { thorns: 0 }, 'pv-float');
  assert.equal(enemy.hp, 1e7, '機率沒中不觸發');
});

test('雷紋刻印：雷電技能命中機率留下刻印，之後雷電傷害 +35%（依雷電歸屬比例），6 秒後失效', () => {
  const c = loadEngine();
  withStats(c, { thunderMark: true });
  const enemy = { hp: 100, maxHp: 100, effects: {}, buffs: {}, dots: [] };
  const lightning = { isPlayer: true, isSkill: true, skillElem: 'lightning' };
  c.chance = () => false;
  c.legendaryOnPlayerSkillHit({}, enemy, lightning, { dmg: 5 });
  assert.equal(enemy._thunderMarkUntil, undefined);
  c.chance = () => true;
  c.legendaryOnPlayerSkillHit({}, enemy, { isPlayer: true, isSkill: true, skillElem: 'fire' }, { dmg: 5 });
  assert.equal(enemy._thunderMarkUntil, undefined, '非雷電技能不留下');
  c.legendaryOnPlayerSkillHit({}, enemy, lightning, { dmg: 5 });
  assert.equal(enemy._thunderMarkUntil, 6);
  const player = { hp: 100, shield: 1 };
  assert.equal(c.legendaryOutgoingDamageMultiplier(player, enemy, lightning), 1.35);
  assert.equal(c.legendaryOutgoingDamageMultiplier(player, enemy, { isPlayer: true, isSkill: true, skillElem: 'fire' }), 1, '火傷不吃');
  assert.equal(c.legendaryOutgoingDamageMultiplier(player, enemy, { isPlayer: true, isSkill: true, skillElemMix: { lightning: 1, fire: 1 } }), 1 + 0.35 * 0.5, '混合歸屬按比例');
  c.GT = 7;
  assert.equal(c.legendaryOutgoingDamageMultiplier(player, enemy, lightning), 1, '6 秒後失效');
});

test('冰霜尖刺：寒冰技能命中機率排進佇列，下一個 tick 對目標造成 200% 寒冰傷害，不遞迴觸發', () => {
  const c = loadEngine();
  withStats(c, { iceSpikeBurst: true }, { level: 1, atk: 0, matk: 1000, hit: 100, critRate: 0, critDmg: 150, pPen: 0, mPen: 0,
    elemDmgPct: null, eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: {} });
  const player = { hp: 100, shield: 0, buffs: {}, effects: {} };
  const enemy = { hp: 1e7, maxHp: 1e7, level: 1, def: 0, mdef: 0, pRes: 0, mRes: 0, resist: {}, dodge: 0, effects: {}, buffs: {}, dots: [] };
  c.chance = () => true;
  c.legendaryOnPlayerSkillHit(player, enemy, { isPlayer: true, isSkill: true, skillElem: 'fire' }, { dmg: 5 });
  assert.equal(c.legendaryEnsureRT().queue.length, 0, '非寒冰技能不觸發');
  c.legendaryOnPlayerSkillHit(player, enemy, { isPlayer: true, isSkill: true, skillElem: 'ice' }, { dmg: 5 });
  assert.equal(c.legendaryEnsureRT().queue.length, 1);
  assert.equal(enemy.hp, 1e7, '不在 resolveHit 中途結算');
  let deaths = 0;
  c.GT = 1;
  c.legendaryTickQueue({ onDeaths() { deaths++; } });
  const dealt = 1e7 - enemy.hp;
  assert.ok(dealt > 1200 && dealt < 3300, '約 200% 魔攻（含浮動）：' + dealt);
  assert.equal(c.legendaryEnsureRT().queue.length, 0, '衍生傷害不再觸發自己');
});

test('神落天殞：隕石落地傷害 +25%（只在生效時）', () => {
  const c = loadEngine();
  withStats(c, { godfallMeteor: true });
  assert.equal(c.legendaryMeteorDamagePct(), 25);
  withStats(c, {});
  assert.equal(c.legendaryMeteorDamagePct(), 0);
  const sk = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');
  assert.match(sk, /m\.variant === 'meteor-impact'[^\n]*legendaryMeteorDamagePct/, '殞石落地結算接上加成');
});

test('亡者時間：範圍內敵人死亡，物理技能冷卻 -0.05 秒；魔法技能不動；已歸零的不處理', () => {
  const c = loadEngine();
  withStats(c, { deadTime: true });
  const player = { skillCds: { 'sg:thrust': 3, 'sg:fireball': 3, 'sg:cleave': 0 } };
  c.legendaryOnEnemyKill(player, { hp: 0 });
  assert.ok(Math.abs(player.skillCds['sg:thrust'] - 2.95) < 1e-9);
  assert.equal(player.skillCds['sg:fireball'], 3, '魔法技能（火球術）不受影響');
  assert.equal(player.skillCds['sg:cleave'], 0);
  player.skillCds['sg:thrust'] = 0.03;
  c.legendaryOnEnemyKill(player, { hp: 0 });
  assert.equal(player.skillCds['sg:thrust'], 0);
});

test('天譴之誓：每 6 秒讓一個冷卻中的技能立即冷卻完畢，下一次施放傷害 +50%', () => {
  const c = loadEngine();
  withStats(c, { heavenlyVow: true });
  const player = { hp: 100, hpMax: 100, skillCds: { 'sg:thrust': 5, 'sg:gale': 0 }, shield: 1 };
  c.GT = 0;
  c.legendaryTickHeavenlyVow({}, player, {}, 0.1);   // 排定第一次充能
  assert.equal(player.skillCds['sg:thrust'], 5, '還沒到 6 秒');
  c.GT = 6;
  c.legendaryTickHeavenlyVow({}, player, {}, 0.1);
  assert.equal(player.skillCds['sg:thrust'], 0, '立即冷卻完畢');
  assert.equal(c.legendaryEnsureRT().vowChargeGid, 'thrust');
  const hit = { isPlayer: true, isSkill: true, skillGid: 'thrust' };
  assert.equal(c.legendaryOutgoingDamageMultiplier(player, {}, hit), 1, '充能但還沒施放：不增傷');
  c.legendaryOnSkillCast(player, 'gale');
  assert.equal(c.legendaryEnsureRT().vowChargeGid, 'thrust', '施放別的技能不消耗充能');
  c.legendaryOnSkillCast(player, 'thrust');
  assert.equal(c.legendaryOutgoingDamageMultiplier(player, {}, hit), 1.5, '這次施放 +50%');
  assert.equal(c.legendaryOutgoingDamageMultiplier(player, {}, { isPlayer: true, isSkill: true, skillGid: 'gale' }), 1, '只限被充能的技能');
  c.GT = 10;
  assert.equal(c.legendaryOutgoingDamageMultiplier(player, {}, hit), 1, '窗口結束後失效');
});

test('影襲追蹤者：每 12 秒自動射出 3 枚飛刀（150% 物理，含飛刀增傷 +25%），不需要任何武器條件', () => {
  const c = loadEngine();
  withStats(c, { shadowTracker: true }, { level: 1, atk: 1000, matk: 0, hit: 100, critRate: 0, critDmg: 150, pPen: 0, mPen: 0,
    elemDmgPct: null, eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: {} });
  c.G.equipment = {};   // 沒有裝備任何武器
  const player = { hp: 100, shield: 1 };
  const enemy = { hp: 1e8, maxHp: 1e8, level: 1, def: 0, mdef: 0, pRes: 0, mRes: 0, resist: {}, dodge: 0, effects: {}, buffs: {}, dots: [] };
  c.rnd = () => 1;
  const ctx = { getEnemies: () => [enemy], floatSel: 'mv-float', onDeaths() {} };
  c.GT = 0;
  c.legendaryTickAutoKnives(ctx, player, {}, 0.1);
  assert.equal(enemy.hp, 1e8, '還沒到 12 秒');
  c.GT = 12;
  c.legendaryTickAutoKnives(ctx, player, {}, 0.1);
  const dealt = 1e8 - enemy.hp;
  assert.ok(dealt > 3 * 1000 * 1.5 * 1.25 * 0.8 && dealt < 3 * 1000 * 1.5 * 1.25 * 1.3, '3 枚 × 150% × 1.25：' + dealt);
  const before = enemy.hp;
  c.GT = 13;
  c.legendaryTickAutoKnives(ctx, player, {}, 0.1);
  assert.equal(enemy.hp, before, '12 秒內不再射');
  // 飛刀技能本身的增傷
  assert.equal(c.legendaryOutgoingDamageMultiplier(player, enemy, { isPlayer: true, isSkill: true, skillGid: 'knife' }), 1.25);
  assert.equal(c.legendaryOutgoingDamageMultiplier(player, enemy, { isPlayer: true, isSkill: true, skillGid: 'thrust' }), 1);
});

test('舊版 13 個特效仍照原邏輯：崩山、末日、狂暴（已重新開放，不再被停用閘門擋掉）', () => {
  const c = loadEngine();
  const enemy = { hp: 1000, maxHp: 1000, effects: { stun: 10 }, buffs: {}, dots: [] };
  withStats(c, { mountainSunderer: true, doomProphet: true });
  const player = { hp: 100, shield: 1 };
  assert.equal(c.legendaryControlDuration(enemy, 'stun', 2), 4);
  const mult = c.legendaryOutgoingDamageMultiplier(player, enemy, { isPlayer: true });
  assert.ok(mult > 4, '受控增傷生效：' + mult);
  withStats(c, { fireSpiritShield: true });
  assert.equal(c.legendaryHas(c.getStats(), 'fireSpiritShield'), false, '其餘舊版特效仍停用');
});

/* ---------------- 整合：符文真言借用 → computeStats 聚合 ---------------- */
test('整合：符文真言借用專屬傳奇，經 computeStats 生效；沒有真言時不生效', () => {
  const { loadRuneEnv, wordItem, slotFor } = require('./helpers/runeword-env.cjs');
  const c = loadRuneEnv();
  const baseSt = c.getStats();
  assert.ok(!baseSt.legendaryEffects.elementHeart);
  const baseFire = baseSt.resist.fire;

  // 創世紀（任意裝備）→ 元素之心：元素抗性 ×0.5
  const genesis = wordItem(c, 'rw_genesis');
  c.G.equipment[slotFor(c, genesis)] = genesis;
  c.markStatsDirty();
  let st = c.getStats();
  assert.equal(c.rwActiveWord(genesis).word.id, 'rw_genesis');
  assert.equal(st.legendaryEffects.elementHeart, true);
  assert.ok(Math.abs(st.resist.fire - baseFire * 0.5) < 1e-9 || baseFire === 0, '抗性乘以 0.5：' + st.resist.fire + ' / ' + baseFire);
  assert.equal(c.legendaryHas(st, 'elementHeart'), true);
  const up = c.legendaryElementDamageUp(st, null);
  assert.ok(up.fire >= 35 && up.wind >= 35, '所有屬性傷害加成 +35');

  // 不朽之軀（胸甲）→ 不屈護衛：格擋額外減傷 +5
  const immortal = wordItem(c, 'rw_immortalbody');
  c.G.equipment[slotFor(c, immortal)] = immortal;
  c.markStatsDirty();
  st = c.getStats();
  assert.equal(st.legendaryEffects.unyieldingGuard, true);
  assert.equal(st.blockDmgRedExtra, 5);

  // 拿掉真言：兩個效果都消失
  c.G.equipment[slotFor(c, genesis)] = null;
  c.G.equipment[slotFor(c, immortal)] = null;
  c.markStatsDirty();
  st = c.getStats();
  assert.ok(!st.legendaryEffects.elementHeart && !st.legendaryEffects.unyieldingGuard);
  assert.equal(st.blockDmgRedExtra, 0);

  // 舊裝備上殘留的專屬傳奇詞條不生效
  const holder = require('./helpers/runeword-env.cjs').makeItem(c, { slot: 'ring', weaponType: undefined });
  holder.passive = { key: 'deadTime', val: 0 };
  c.G.equipment.ring = holder;
  c.markStatsDirty();
  assert.ok('deadTime' in c.getStats().passives, '詞條本身仍被讀到（資料原樣保留）');
  assert.ok(!c.getStats().legendaryEffects.deadTime, '裝備上殘留的 deadTime 不生效');
});
