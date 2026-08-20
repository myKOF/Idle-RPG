/* 超神進化【修羅亂舞】（雙刀亂舞，2026-08-20 第三批）：技能狀態決定裝備規則。
   這是全專案唯一一個這種效果，因此它同時踩到四個系統，本檔逐一守住：
     1. 判定入口     js/skills2.js skills2AsuraDualWield（選了它 ＋ 雙刀亂舞裝配在技能列上）
     2. 可裝欄位     js/data.js equipSlotsForItem／slotBlockedByTwoHand
     3. 穿戴互斥     js/player.js equipItem／tryAutoEquip
     4. 屬性聚合     js/formula.js computeStats（副手雙手武器是否計入、雙手詞條加成幾%）
   使用者需求（2026-08-20）：卸下該技能後副手武器不再生效、詞條加成恢復原樣，
   但**物品本身不得遺失**——因此第 4 點是「跳過不計入」，不是「把東西丟回背包」。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const logs = [];
  const context = {
    console, Math: Object.create(Math), UI: { dirty: {}, sel: null },
    setTimeout() {}, clearTimeout() {},
    blog(m) { logs.push(m); }, floatText() {}, trackDps() {}, recordRunDamage() {},
    logs
  };
  context.window = context;
  context.Math.random = () => 0.5;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js',
    'js/item.js', 'js/player.js', 'js/skills2.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function emptySet(c) {
  const eq = {};
  c.SLOT_LIST.forEach((s) => { eq[s] = null; });
  return eq;
}

/* 一把帶固定物攻詞條的雙手大劍。詞條以強度值儲存（js/formula.js §6），
   因此想要的數值要先換算回強度值。 */
function greatsword(c, id, atkFlat) {
  return {
    id, slot: 'weapon', weaponType: 'greatsword2h', level: 10, rarity: 0, upgrade: 0,
    affixes: [{ key: 'atkFlat', roll: c.affixStrengthFromValue('atkFlat', 10, 0, atkFlat) }],
    sockets: [], enchants: []
  };
}
function dagger(c, id, atkFlat) {
  return {
    id, slot: 'weapon', weaponType: 'dagger1h', level: 10, rarity: 0, upgrade: 0,
    affixes: [{ key: 'atkFlat', roll: c.affixStrengthFromValue('atkFlat', 10, 0, atkFlat) }],
    sockets: [], enchants: []
  };
}
function shield(c, id) {
  return {
    id, slot: 'weapon', weaponType: 'shield', level: 10, rarity: 0, upgrade: 0,
    affixes: [], sockets: [], enchants: []
  };
}

function makeG(c) {
  const set = emptySet(c);
  return {
    player: {
      level: 2000, reincarnations: 0, skills: {}, loadout: [],
      skills2: { levels: { dualdance: [10, 10, 10, 10, 10, 10, 10] }, ult: {} }
    },
    equipmentSets: [set, emptySet(c), emptySet(c)],
    equipActive: 0, equipView: 0, equipment: set,
    inventory: [], invCap: 60
  };
}

function pickAsura(c) {
  c.G.player.skills2.ult.dualdance = { pick: c.sgUltIndexOfId('dualdance', 'asuraDance'), lv: 10 };
}
function equipSkill(c) { c.G.player.loadout = [c.SG_PREFIX + 'dualdance']; }

test('判定入口：必須「選了修羅亂舞」且「雙刀亂舞裝配在技能列上」，缺一不可', () => {
  const c = loadContext();
  c.G = makeG(c);
  assert.equal(c.skills2AsuraDualWield(), false, '兩個條件都不成立');
  equipSkill(c);
  assert.equal(c.skills2AsuraDualWield(), false, '只有裝配、沒選超神進化');
  c.G.player.loadout = [];
  pickAsura(c);
  assert.equal(c.skills2AsuraDualWield(), false, '只有選了、沒裝配在技能列上');
  equipSkill(c);
  assert.equal(c.skills2AsuraDualWield(), true);
  // 前 7 階掉出滿級 → 超神進化自動失效，裝備規則也跟著失效
  c.G.player.skills2.levels.dualdance = [10, 10, 10, 10, 10, 10, 9];
  assert.equal(c.skills2AsuraDualWield(), false, '前 7 階不再全滿就失效');
});

test('穿戴互斥：生效時兩把雙手武器可以並存；沒生效時仍互斥', () => {
  const c = loadContext();
  c.G = makeG(c);
  const main = greatsword(c, 'gs-main', 100);
  const off = greatsword(c, 'gs-off', 100);

  // 沒生效：裝副手會把主手那把擠下來
  c.equipItem(main, 'weapon');
  c.equipItem(off, 'weapon2');
  assert.equal(c.G.equipment.weapon, null, '沒生效時主手雙手武器被卸下');
  assert.equal(c.G.equipment.weapon2, off);

  // 生效：兩把並存
  c.G.equipment = emptySet(c);
  c.G.equipmentSets[0] = c.G.equipment;
  pickAsura(c); equipSkill(c);
  c.equipItem(main, 'weapon');
  c.equipItem(off, 'weapon2');
  assert.equal(c.G.equipment.weapon, main, '生效時主手留著');
  assert.equal(c.G.equipment.weapon2, off);

  // 生效也只開給「副手也是雙手武器」：拿盾仍然會擠掉主手
  c.equipItem(shield(c, 'sh'), 'weapon2');
  assert.equal(c.G.equipment.weapon, null, '盾牌不在修羅亂舞的例外範圍內');
});

test('自動穿裝：副手可用時也不得把非雙手武器塞進去擠掉主手', () => {
  const c = loadContext();
  c.G = makeG(c);
  pickAsura(c); equipSkill(c);
  const main = greatsword(c, 'gs-main', 100);
  c.equipItem(main, 'weapon');
  const ok = c.tryAutoEquip(dagger(c, 'dg', 50));
  assert.equal(c.G.equipment.weapon, main, '主手不得被自動穿裝擠掉');
  assert.ok(!ok || c.G.equipment.weapon2 === null, '匕首不得被自動塞進副手');
});

test('屬性聚合：生效時副手計入且雙手詞條加成；卸下技能後兩者一起恢復原樣，物品不遺失', () => {
  const c = loadContext();
  c.G = makeG(c);
  const main = greatsword(c, 'gs-main', 500);
  const off = greatsword(c, 'gs-off', 500);
  pickAsura(c); equipSkill(c);
  c.equipItem(main, 'weapon');
  c.equipItem(off, 'weapon2');

  const on = c.computeStats().atk;

  // 卸下技能：副手立刻不生效、詞條加成也一起消失
  c.G.player.loadout = [];
  c.markStatsDirty();
  const off1 = c.computeStats().atk;
  assert.ok(off1 < on, '卸下後攻擊力必須下降');
  assert.equal(c.G.equipment.weapon2, off, '物品仍留在欄位裡，不得遺失');

  // 只留主手（把副手拿掉）當對照：卸下技能後的數值必須與它完全一致，
  // 也就是「副手完全沒計入」而不是「打了折」。
  c.G.equipment.weapon2 = null;
  c.markStatsDirty();
  assert.equal(c.computeStats().atk, off1, '卸下技能＝副手完全沒穿');

  // 詞條加成：把副手放回去並重新裝配技能，攻擊力要回到原本的數值
  c.G.equipment.weapon2 = off;
  equipSkill(c);
  c.markStatsDirty();
  assert.equal(c.computeStats().atk, on, '重新裝配技能就原樣回來');
});

test('詞條加成只加在雙手武器上，且加成幅度＝超神進化的當級參數', () => {
  const c = loadContext();
  c.G = makeG(c);
  const main = greatsword(c, 'gs-main', 500);
  c.equipItem(main, 'weapon');
  const plain = c.computeStats().atk;

  pickAsura(c); equipSkill(c);
  c.markStatsDirty();
  const boosted = c.computeStats().atk;

  const pct = c.sgVal(c.SKILLS2.dualdance.ult[2].fx, 'pct', c.SG_TIER_MAX_LV);
  /* 加成只乘在詞條值上，其餘（基礎四維等）不動，因此差額＝該詞條原本貢獻 × pct%。
     以「沒穿武器」為基準把詞條貢獻算出來，再對照差額。 */
  c.G.equipment.weapon = null;
  c.markStatsDirty();
  const bare = c.computeStats().atk;
  const affixPart = plain - bare;
  assert.ok(affixPart > 0);
  assert.ok(Math.abs((boosted - plain) - affixPart * pct / 100) < 1e-6,
    '加成幅度應為詞條貢獻的 ' + pct + '%');

  // 單手武器不吃這個加成
  c.G.equipment.weapon = dagger(c, 'dg', 500);
  c.markStatsDirty();
  const oneHandOn = c.computeStats().atk;
  c.G.player.loadout = [];
  c.markStatsDirty();
  const oneHandOff = c.computeStats().atk;
  assert.equal(oneHandOn, oneHandOff, '單手武器的詞條不得被修羅亂舞放大');
});

test('屬性快取：選／卸超神進化與技能裝載欄異動都必須讓 _statsCache 失效', () => {
  const src = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');
  ['skills2UltPick', 'skills2UltLearn', 'skills2UltDowngrade'].forEach((fn) => {
    const start = src.indexOf('function ' + fn + '(');
    assert.notEqual(start, -1, '缺少 ' + fn);
    const end = src.indexOf('\nfunction ', start + 1);
    const body = src.slice(start, end < 0 ? src.length : end);
    assert.match(body, /markStatsDirty\(\)/, fn + ' 必須讓屬性快取失效');
  });
  const skills = fs.readFileSync(path.join(root, 'js/skills.js'), 'utf8');
  ['equipSkillToLoadout', 'unequipSkillFromLoadout'].forEach((fn) => {
    const start = skills.indexOf('function ' + fn + '(');
    assert.notEqual(start, -1, '缺少 ' + fn);
    const end = skills.indexOf('\nfunction ', start + 1);
    const body = skills.slice(start, end < 0 ? skills.length : end);
    assert.match(body, /markStatsDirty\(\)/, fn + ' 必須讓屬性快取失效');
  });
});
