/* 技能屬性化（2026-07-26 技能傷害公式改造）
   規則：技能標籤即傷害屬性，本體傷害段整段打出該屬性傷害，不再拆成「純魔法段＋元素附加段」。
   公式：魔攻 →(防禦/魔抗)→ ×元素抗性 ×(1+屬性傷害提升%) → ±浮動 → ×(1+爆傷%)
        → ×(1+對敵種類%) → ×(1+對屬性敵人%) → ×(1+總傷%) */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadFormulaContext() {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.rnd = () => 1;                                       // 關閉 ±10% 浮動
  context.chance = (pct) => (Number(pct) || 0) >= 100;         // 命中必成功；暴擊與元素特效預設不觸發
  return context;
}

function loadSkillsContext() {
  const context = {
    console,
    Math: Object.create(Math),
    document: { getElementById() { return null; }, querySelectorAll() { return []; }, addEventListener() {} },
    UI: { dirty: {} }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/skills.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: { level: 1, reincarnations: 0, skills: {}, talents: { levels: {}, potentialLevels: {} }, loadout: [], fusions: [] } };
  return context;
}

function hit(context, aCfg, dCfg, attacker = { hp: 2000, effects: {} }) {
  const defender = { hp: 1e12, shield: 0, effects: {}, dots: [] };
  return context.resolveHit(attacker, defender, Object.assign({
    atk: 1000, dmgType: 'magic', level: 1, hit: 100, critRate: 0, critDmg: 150
  }, aCfg), Object.assign({ dodge: 0, def: 0, mdef: 0, mRes: 0, pRes: 0, resist: {} }, dCfg));
}

test('skillElem：本體傷害段整段套用該屬性抗性', () => {
  const c = loadFormulaContext();
  assert.equal(hit(c, { skillElem: 'fire' }, {}).dmg, 1000);
  const expected = 1000 * (1 - c.elementalResistanceReduction(50, 1));
  assert.equal(hit(c, { skillElem: 'fire' }, { resist: { fire: 50 } }).dmg, Math.round(expected));
  // 其他屬性的抗性不影響
  assert.equal(hit(c, { skillElem: 'fire' }, { resist: { ice: 50 } }).dmg, 1000);
});

test('skillElem：屬性傷害吃得到暴擊倍率（舊制元素附加段吃不到）', () => {
  const c = loadFormulaContext();
  const res = hit(c, { skillElem: 'fire', critRate: 200, critDmg: 250 }, {});
  assert.equal(res.crit, true);
  assert.equal(res.dmg, 2500);                      // 1000 × 250%
  // 對照：同樣數值走「元素附加段」（裝備固定值元素攻擊）時不吃暴擊
  const attach = hit(c, { atk: 0, elemAtk: { fire: 1000 }, critRate: 200, critDmg: 250 }, {});
  assert.equal(attach.dmg, 1000);
});

test('skillElem：屬性傷害提升% 與對敵種類/對屬性敵人加成依序乘算', () => {
  const c = loadFormulaContext();
  const res = hit(c, {
    skillElem: 'fire',
    elemDmgUp: { fire: 50 },      // ×1.5
    bossDmg: 100,                 // ×2
    dmgVsElem: { ice: 25 }        // ×1.25（防守方為冰屬性敵人）
  }, { isBoss: true, attr: 'ice' });
  assert.equal(res.dmg, Math.round(1000 * 1.5 * 2 * 1.25));
});

test('skillElemMix：融合技依權重拆成各屬性分別結算，權重自動正規化', () => {
  const c = loadFormulaContext();
  const dCfg = { resist: { fire: 50 } };
  const fireMul = 1 - c.elementalResistanceReduction(50, 1);
  const expected = 1000 * 0.5 * fireMul + 1000 * 0.5;   // 火半段吃火抗、冰半段不吃
  assert.equal(hit(c, { skillElemMix: { fire: 0.5, ice: 0.5 } }, dCfg).dmg, Math.round(expected));
  // 未正規化的權重（合計 2）結果相同
  assert.equal(hit(c, { skillElemMix: { fire: 1, ice: 1 } }, dCfg).dmg, Math.round(expected));
});

test('元素特效：技能屬性化段與元素附加段合併後每系只判定一次', () => {
  const c = loadFormulaContext();
  c.chance = (pct) => (Number(pct) || 0) > 0;   // 元素特效必觸發（暴擊率 0 仍不暴擊）
  // 暗屬性技能 1000 ＋ 裝備固定暗屬性攻擊 500；暗影汲取回復＝攻擊者當前生命 ×25%，且只結算一次
  const res = hit(c, { skillElem: 'dark', elemAtk: { dark: 500 }, critRate: 0 }, {});
  assert.equal(res.dmg, 1500);
  assert.equal(res.heal, 2000 * c.ELEM_PROC.darkDrainMult);
  // 只有元素附加段時，仍以該段值判定
  const onlyAttach = hit(c, { atk: 0, elemAtk: { dark: 500 } }, {});
  assert.equal(onlyAttach.heal, 2000 * c.ELEM_PROC.darkDrainMult);
  const higherDamage = hit(c, { skillElem: 'dark', elemAtk: { dark: 1500 }, critRate: 0 }, {});
  assert.equal(higherDamage.heal, res.heal, '暗影汲取不應隨造成傷害增加');
});

test('無屬性標籤的技能不做屬性化，維持純物理結算', () => {
  const c = loadFormulaContext();
  const res = hit(c, { dmgType: 'phys' }, { resist: { fire: 90, ice: 90, lightning: 90, poison: 90, light: 90, dark: 90 } });
  assert.equal(res.dmg, 1000);
});

test('技能資料：魔法傷害技能皆帶屬性標籤，且不再保留舊的 fx.elem 元素占比', () => {
  const c = loadSkillsContext();
  const src = fs.readFileSync(path.join(root, 'js/skills.js'), 'utf8');
  assert.doesNotMatch(src, /elem: \{ type:/);
  Object.keys(c.SKILLS).forEach((id) => {
    const sk = c.SKILLS[id];
    if (!sk.fx || sk.fx.dmgType !== 'magic') return;
    assert.ok(Array.isArray(sk.tags) && sk.tags.length > 0, id + ' 缺少屬性標籤');
    assert.equal(c.skillElemOf(sk, sk.fx), sk.tags[0]);
  });
});

test('skillElemApplyACfg：標籤 → skillElem；elemOverride 蓋過標籤與融合權重', () => {
  const c = loadSkillsContext();
  const plain = (o) => JSON.parse(JSON.stringify(o)); // vm 沙盒物件跨 realm，改比對結構
  const fireball = c.SKILLS.fireball;
  assert.deepEqual(plain(c.skillElemApplyACfg({}, fireball, fireball.fx)), { skillElem: 'fire' });
  // 物理技能不寫入任何屬性欄位
  assert.deepEqual(plain(c.skillElemApplyACfg({}, c.SKILLS.powerSlash, c.SKILLS.powerSlash.fx)), {});
  // 融合技多屬性權重
  assert.deepEqual(plain(c.skillElemApplyACfg({}, { tags: [] }, { dmgType: 'magic', elems: { fire: 0.5, ice: 0.5 } })),
    { skillElemMix: { fire: 0.5, ice: 0.5 } });
  // 特規改屬性（傳奇【死亡領域】）優先
  assert.deepEqual(plain(c.skillElemApplyACfg({}, fireball, { dmgType: 'magic', elemOverride: 'poison', elems: { fire: 1 } })),
    { skillElem: 'poison' });
});

test('技能說明：魔法技能寫成「X屬性傷害」，不再有魔法／元素混用句型', () => {
  const c = loadSkillsContext();
  const fireDesc = c.describeSkill('fireball', 1);
  assert.match(fireDesc, /% 魔攻 的火屬性傷害/);
  assert.doesNotMatch(fireDesc, /魔法傷害/);
  assert.doesNotMatch(fireDesc, /昇華|化作火屬性|屬性佔/);

  const arcane = c.describeSkill('arcaneBurst', 1);
  assert.match(arcane, /% 魔攻 的聖屬性傷害/);

  // 真實傷害技能不屬性化，仍寫「真實傷害」並保留系別註記
  const rift = c.describeSkill('voidRift', 1);
  assert.match(rift, /真實傷害/);
  assert.match(rift, /暗影一系/);

  // 物理技能維持「物理傷害」
  assert.match(c.describeSkill('powerSlash', 1), /% 物攻 的物理傷害/);
});
