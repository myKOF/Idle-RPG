const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

/* 5 轉昇華天賦（skillPhys/Magic/Def/Special/Passive）作用範圍：
   除既有的傷害/治療/護盾/被動外，增益、減益、持續再生、死亡詛咒、金幣、法力回復
   也要吃「該技能類別的天賦倍率」；融合技 = 素材類別倍率的平均。 */

function loadCtx(opts) {
  opts = opts || {};
  const context = {
    console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {} }, UI: { dirty: {} }, GT: 0,
    RUN_STATS: { skills: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  const files = ['js/util.js', 'js/data.js', 'js/formula.js', 'js/combat.js', 'js/skills.js'];
  if (opts.talents) files.push('js/talents.js');
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: { level: 1, gold: 0, skills: {}, loadout: [], fusions: [], talents: { levels: {}, potentialLevels: {} } },
    stage: { current: 1 }
  };
  context.getStats = () => ({
    level: 1, hp: 1000, mp: 1000, atk: 100, matk: 100, cdr: 0, castSpeed: 0, aoeDmg: 0,
    comboHits: 0, critRate: 0, critDmg: 150, hit: 100, pPen: 0, mPen: 0,
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, lifesteal: 0, manaSteal: 0, shieldEff: 0,
    potentialManaRefund: 0, potentialExecute: 0, passives: {}
  });
  if (!opts.talents) {
    // 以固定倍率 stub 檢驗接線（castSkill 是否把倍率乘進各效果）
    context.talentSkillEffectMultiplier = (cat) => (context._mult && context._mult[cat]) || 1;
  }
  return context;
}

function pEnt() { return { hp: 1000, mp: 1000, shield: 0, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} }; }
function foe() { return { hp: 1000, maxHp: 1000, def: 0, mdef: 0, level: 1, dodge: 0, resist: {}, buffs: {}, dots: [], effects: {}, shield: 0, ctrlRes: 0 }; }

test('增益類技能數值吃該類別天賦倍率（特殊/防禦）', () => {
  const c = loadCtx();
  c._mult = { special: 2, def: 3 };
  const p1 = pEnt();
  c.castSkill(p1, [], 'timeWarp', 1, 'pv-float'); // special：攻速增益 base 25
  assert.equal(p1.buffs.aspdUp.val, 50);
  const p2 = pEnt();
  c.castSkill(p2, [], 'ironWall', 1, 'pv-float'); // def：防禦增益 base 40
  assert.equal(p2.buffs.defUp.val, 120);
});

test('減益類技能數值吃天賦倍率', () => {
  const c = loadCtx();
  c._mult = { special: 2 };
  const target = foe();
  c.castSkill(pEnt(), [target], 'weakenCurse', 1, 'pv-float'); // atkDown base 18
  assert.equal(target.buffs.atkDown.val, 36);
});

test('持續再生（hot）數值吃天賦倍率', () => {
  const c = loadCtx();
  c._mult = { def: 2 };
  const p = pEnt();
  c.castSkill(p, [], 'regenerate', 1, 'pv-float'); // hotPct base 2.5
  assert.equal(p.buffs.hot.val, 5);
});

test('死亡詛咒（按目標最大生命的 DoT）吃天賦倍率', () => {
  const c = loadCtx();
  c._mult = { special: 2 };
  const target = foe();
  c.castSkill(pEnt(), [target], 'deathCurse', 1, 'pv-float'); // maxHpDotPct base 2.4 → 1000×2.4%×2
  assert.equal(target.dots.length, 1);
  assert.equal(target.dots[0].dps, 48);
});

test('法力回復與金幣類效果吃天賦倍率', () => {
  const c = loadCtx();
  c._mult = { def: 2, special: 2 };
  const p = pEnt();
  p.hp = 500; p.mp = 500;
  c.castSkill(p, [], 'secondWind', 1, 'pv-float'); // 治療 10%×2、mpRestore 20×2
  assert.equal(p.hp, 700);
  assert.equal(p.mp, 540);
  const target = foe();
  c.castSkill(pEnt(), [target], 'midasTouch', 1, 'pv-float'); // goldPer 15 × lv1 × 玩家等級1 × 2
  assert.equal(c.G.player.gold, 30);
});

test('融合技倍率 = 素材類別倍率的平均；無素材記錄時為 1', () => {
  const c = loadCtx({ talents: true });
  c.G.player.talents.levels.t5_phys = 10; // 物理類 +10%
  const catA = c.SKILLS.powerSlash.cat, catB = c.SKILLS.arcaneBurst.cat;
  const expected = (c.talentSkillEffectMultiplier(catA) + c.talentSkillEffectMultiplier(catB)) / 2;
  assert.ok(expected > 1); // 至少一個素材是物理 → 平均 > 1
  const fusionDef = { cat: 'fusion', components: ['powerSlash', 'arcaneBurst'] };
  assert.ok(Math.abs(c.skillEffectTalentMultiplier(fusionDef) - expected) < 1e-9);
  assert.equal(c.skillEffectTalentMultiplier({ cat: 'fusion' }), 1); // 舊快照無素材 → 1
  assert.equal(c.skillEffectTalentMultiplier(c.SKILLS.powerSlash), c.talentSkillEffectMultiplier(catA)); // 一般類別直通
});
