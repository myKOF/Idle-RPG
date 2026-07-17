const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  context.Math.random = () => 0.5;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('對普通敵人傷害% 放出量同物理防禦，三種敵種傷害抗性為物理防禦的 2 倍', () => {
  const context = loadFormulaContext();
  const defFlat = context.AFFIX_POOL.defFlat;
  const normalDmg = context.AFFIX_POOL.normalDmg;
  assert.ok(normalDmg);
  assert.equal(normalDmg.name, '對普通敵人傷害%');
  assert.equal(normalDmg.pct, true);
  assert.equal(normalDmg.base, defFlat.base);
  assert.equal(normalDmg.lv, defFlat.lv);
  const RED_NAMES = { normalDmgRed: '普通敵人傷害抗性', eliteDmgRed: '菁英傷害抗性', bossDmgRed: 'BOSS傷害抗性' };
  Object.keys(RED_NAMES).forEach((key) => {
    const def = context.AFFIX_POOL[key];
    assert.ok(def, key + ' 詞條需存在');
    assert.equal(def.name, RED_NAMES[key]);
    assert.equal(def.pct, false);
    assert.equal(def.base, defFlat.base * 2);
    assert.equal(def.lv, defFlat.lv);
  });
  // 顯示分類：加成歸進攻、抗性歸防禦
  assert.equal(context.affixCat('normalDmg'), 'off');
  assert.equal(context.affixCat('normalDmgRed'), 'def');
  assert.equal(context.affixCat('eliteDmgRed'), 'def');
  assert.equal(context.affixCat('bossDmgRed'), 'def');
});

test('敵種六屬性與金幣/經驗/掉寶率詞條均為獨特級（minR=3）', () => {
  const context = loadFormulaContext();
  ['normalDmg', 'eliteDmg', 'bossDmg', 'normalDmgRed', 'eliteDmgRed', 'bossDmgRed',
    'goldBonus', 'xpBonus', 'loot'].forEach((key) => {
    assert.equal(context.AFFIX_POOL[key].minR, 3, key + ' 應為獨特級');
  });
});

test('對普通傷害加成僅對非菁英且非 BOSS 的敵人生效', () => {
  const context = loadFormulaContext();
  const aCfg = { atk: 100000, dmgType: 'phys', level: 1, hit: 100, critRate: 0, normalDmg: 50 };
  const baseDef = { def: 0, mdef: 0, dodge: 0, pRes: 0, mRes: 0, resist: {} };

  const vsNormal = context.resolveHit({}, { hp: 1000000, shield: 0 }, aCfg, { ...baseDef });
  const vsElite = context.resolveHit({}, { hp: 1000000, shield: 0 }, aCfg, { ...baseDef, isElite: true });
  const vsBoss = context.resolveHit({}, { hp: 1000000, shield: 0 }, aCfg, { ...baseDef, isBoss: true });

  assert.equal(vsNormal.dmg, 150000); // ×(1 + 50%)
  assert.equal(vsElite.dmg, 100000);  // 菁英不吃對普通加成
  assert.equal(vsBoss.dmg, 100000);   // BOSS 不吃對普通加成
});

test('敵種傷害天賦與既有敵種傷害加成為獨立乘區', () => {
  const context = loadFormulaContext();
  const baseDef = { def: 0, mdef: 0, dodge: 0, pRes: 0, mRes: 0, resist: {} };
  const base = 100000;
  const expected = Math.round(base * 1.10 * 1.01);
  const cases = [
    [{ normalDmg: 10, talentNormalDmg: 1 }, { ...baseDef }],
    [{ eliteDmg: 10, talentEliteDmg: 1 }, { ...baseDef, isElite: true }],
    [{ bossDmg: 10, talentBossDmg: 1 }, { ...baseDef, isBoss: true }]
  ];

  cases.forEach(([flags, defender]) => {
    const actual = context.resolveHit({}, { hp: 1000000, shield: 0 }, {
      atk: base, dmgType: 'phys', level: 1, hit: 100, critRate: 0, ...flags
    }, defender).dmg;
    assert.equal(actual, expected, '天賦應在既有敵種加成之外獨立相乘');
  });
});

test('敵種傷害減免公式 = 減免值 / (減免值 + a + b×攻擊者等級)', () => {
  const context = loadFormulaContext();
  const a = context.ENEMY_TYPE_DMG_RED_A;
  const b = context.ENEMY_TYPE_DMG_RED_B;
  assert.ok(a > 0 && b > 0);
  assert.equal(context.enemyTypeDamageReduction(1000, 30), 1000 / (1000 + a + b * 30));
  assert.equal(context.enemyTypeDamageReduction(0, 30), 0);
  assert.equal(context.enemyTypeDamageReduction(-5, 30), 0);
});

test('敵種傷害減免依攻擊者敵種選用對應減免值，於全局減傷之後最末端套用', () => {
  const context = loadFormulaContext();
  const a = context.ENEMY_TYPE_DMG_RED_A;
  const b = context.ENEMY_TYPE_DMG_RED_B;
  const level = 30;
  const red = (total) => total / (total + a + b * level);
  const mkAtk = (flags) => ({ atk: 100000, dmgType: 'phys', level, hit: 100, critRate: 0, ...flags });
  const defStats = {
    def: 0, mdef: 0, dodge: 0, pRes: 0, mRes: 0, resist: {},
    normalDmgRed: 500, eliteDmgRed: 2000, bossDmgRed: 8000
  };

  const byNormal = context.resolveHit({}, { hp: 1000000, shield: 0 }, mkAtk({}), { ...defStats });
  const byElite = context.resolveHit({}, { hp: 1000000, shield: 0 }, mkAtk({ isElite: true }), { ...defStats });
  const byBoss = context.resolveHit({}, { hp: 1000000, shield: 0 }, mkAtk({ isBoss: true }), { ...defStats });

  assert.equal(byNormal.dmg, Math.round(100000 * (1 - red(500))));
  assert.equal(byElite.dmg, Math.round(100000 * (1 - red(2000))));
  assert.equal(byBoss.dmg, Math.round(100000 * (1 - red(8000))));

  // 與全局減傷相乘（末端在全局減傷之後，兩者皆為乘區）
  const globalTarget = { hp: 1000000, shield: 0 };
  const byBossGlobal = context.resolveHit({}, globalTarget, mkAtk({ isBoss: true }),
    { ...defStats, globalDmgRed: 10000 });
  const expected = Math.round(100000 * context.globalDamageMultiplier(10000) * (1 - red(8000)));
  assert.equal(byBossGlobal.dmg, expected);

  // 無對應減免值時傷害不變
  const noRed = context.resolveHit({}, { hp: 1000000, shield: 0 }, mkAtk({ isBoss: true }),
    { def: 0, mdef: 0, dodge: 0, pRes: 0, mRes: 0, resist: {} });
  assert.equal(noRed.dmg, 100000);
});

test('屬性面板含 4 個新列，減免 tips 黃字顯示截斷至四位小數的目前同級減傷率', () => {
  const context = loadFormulaContext();
  const offense = context.STAT_GROUPS.find((g) => g.title === '進攻屬性');
  const defense = context.STAT_GROUPS.find((g) => g.title === '防禦屬性');
  assert.ok(offense.rows.some((row) => row[0].includes('對普通敵人傷害')));

  const a = context.ENEMY_TYPE_DMG_RED_A;
  const b = context.ENEMY_TYPE_DMG_RED_B;
  const st = { level: 10, normalDmgRed: 1000, eliteDmgRed: 250, bossDmgRed: 0 };
  const cases = [
    ['普通敵人傷害抗性', st.normalDmgRed],
    ['菁英傷害抗性', st.eliteDmgRed],
    ['BOSS傷害抗性', st.bossDmgRed]
  ];
  cases.forEach(([label, total]) => {
    const row = defense.rows.find((r) => r[0].includes(label));
    assert.ok(row, label + ' 面板列需存在');
    const html = row[2](st);
    assert.match(html, /color:#ffd700/);
    const pct = (Math.floor(total / (total + a + b * st.level) * 100 * 10000) / 10000 || 0).toFixed(4);
    assert.ok(html.includes(pct + '%'), label + ' 應顯示 ' + pct + '%（實得：' + html + '）');
  });
});
