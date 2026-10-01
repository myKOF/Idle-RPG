/* 吸血／吸魔改為定值（2026-10-01）回歸測試
   需求：
   1. 由百分比轉為定值，轉換公式 1% = 1（吸血 50% → 每觸發 1 次吸收 50 點生命）
   2. 單獨計算，不再與每秒生命回復／法力恢復相關聯
   3. 裝備詞條、寶石、神鑄特效、技能倍率、屬性面板與參數表全數同步
   這裡不釘死詞條成長係數以外的平衡數值，只守「語意」：
   定值、與回復無關、數字沿用舊百分比、顯示不再帶 %、參數表與程式一致。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../scripts/sim/engine');
const { csvParse } = require('../tools/config_tables.cjs');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const boot = () => createEngine({ seed: 7 }).boot(null).ctx;
const item = (affixes, extra) => Object.assign(
  { id: 'x', slot: 'chest', level: 1, rarity: 0, upgrade: 0, affixes, sockets: [], enchants: [] }, extra || {});

test('詞條池：吸血／吸魔是定值，不是百分比；數字沿用舊百分比（1% = 1）', () => {
  const c = boot();
  for (const key of ['lifesteal', 'manaSteal']) {
    const def = c.AFFIX_POOL[key];
    assert.equal(def.pct, false, key + ' 不再是百分比詞條');
    assert.doesNotMatch(def.name, /%/, key + ' 名稱不再帶 %');
  }
  // 轉換是 1%＝1：基礎值、成長係數完全沿用舊百分比的數字
  assert.deepEqual([c.AFFIX_POOL.lifesteal.base, c.AFFIX_POOL.lifesteal.growthBase, c.AFFIX_POOL.lifesteal.lv], [1, 1, 0.005]);
  assert.deepEqual([c.AFFIX_POOL.manaSteal.base, c.AFFIX_POOL.manaSteal.growthBase, c.AFFIX_POOL.manaSteal.lv], [0.8, 0.8, 0.003]);
  // 定值詞條與其他定值詞條（生命恢復、攻擊力）一致：取整數
  assert.equal(c.affixRoundValue('lifesteal', 1.4), 1);
  assert.equal(c.affixRoundValue('lifesteal', 1.6), 2);
  assert.equal(c.affixRoundValue('hpRegen', 1.6), 2);
});

test('裝備詞條 → st.lifesteal／st.manaSteal 直接累加成定值，強化倍率仍作用', () => {
  const c = boot();
  c.G.equipment.chest = item([{ key: 'lifesteal', roll: 500 }, { key: 'manaSteal', roll: 500 }], { level: 100, rarity: 6 });
  const st = c.computeStats();
  const wantHp = c.affixValueFromStrength('lifesteal', 100, 6, 500);
  const wantMp = c.affixValueFromStrength('manaSteal', 100, 6, 500);
  assert.ok(wantHp > 1 && Number.isInteger(wantHp));
  assert.equal(st.lifesteal, wantHp);
  assert.equal(st.manaSteal, wantMp);
  c.G.equipment.chest.upgrade = 10;
  assert.ok(Math.abs(c.computeStats().lifesteal - wantHp * 1.5) < 1e-9, '強化 +10 → 詞條 ×1.5（參數表強化倍率）');
});

test('寶石：黑曜石是定值吸血，數值沿用舊百分比、顯示不帶 %', () => {
  const c = boot();
  const g = c.GEM_TYPES.onyx;
  assert.equal(g.stat, 'lifesteal');
  assert.equal(g.pct, false);
  assert.doesNotMatch(g.statName, /%/);
  assert.equal(g.base, 1);
  c.G.equipment.chest = item([], { sockets: [{ type: 'onyx', level: 3 }] });
  assert.equal(c.computeStats().lifesteal, c.gemStatValue('onyx', 3));
});

test('神鑄【萬象汲取】：每次傷害額外回復固定量的生命與法力，說明不再是傷害百分比', () => {
  const c = boot();
  const d = c.GODFORGE_POOL.omniDrain;
  assert.equal(d.base, 5, '5% 轉成 5 點');
  assert.doesNotMatch(d.desc, /%/);
  assert.match(d.desc, /\{v\} 點生命與法力/);
});

test('屬性面板：吸血／吸魔列顯示定值，不帶 %，提示說明單獨計算', () => {
  const c = boot();
  c.G.equipment.chest = item([{ key: 'lifesteal', roll: 500 }, { key: 'manaSteal', roll: 500 }], { level: 100, rarity: 6 });
  const st = c.playerPanelStats(c.computeStats());
  const rows = c.STAT_GROUPS.flatMap((g) => g.rows);
  for (const [name, key] of [['吸血', 'lifesteal'], ['吸魔', 'manaSteal']]) {
    const row = rows.find((r) => r[0].includes(name));
    assert.ok(row, '找不到 ' + name + ' 列');
    const shown = row[1](st);
    assert.doesNotMatch(shown, /%/, name + ' 不顯示百分比');
    assert.equal(shown, c.statFmt(st.passivePanel[key], c.STAT_CAPS[key], 'raw1'));
    const tip = row[2](st);
    assert.match(tip, /單獨計算/);
    assert.doesNotMatch(tip, /每秒.*換算|汲取換算基準/);
  }
});

test('面板投影：lifesteal／manaSteal 帶汲取倍率的定值，與回復倍率各自獨立；舊的以回復換算欄位已移除', () => {
  const c = boot();
  const st = { hp: 10000, hpRegen: 100, mp: 1000, mpRegen: 50, lifesteal: 20, manaSteal: 10, elemDmgUp: {}, globalDmgRed: 0 };
  const p = c.playerPanelStats(st).passivePanel;
  assert.equal(p.lifesteal, c.lifestealHealAmount(20));
  assert.equal(p.manaSteal, c.manaStealAmount(10));
  for (const k of ['hpDrain', 'mpDrain', 'hpDrainBase', 'mpDrainBase']) assert.equal(p[k], undefined, k);
  // 每秒回復怎麼變都不動吸血／吸魔
  const p2 = c.playerPanelStats(Object.assign({}, st, { hpRegen: 99999, mpRegen: 88888, hp: 1e9 })).passivePanel;
  assert.equal(p2.lifesteal, p.lifesteal);
  assert.equal(p2.manaSteal, p.manaSteal);
});

test('參數表（CSV）與程式一致：名稱不帶 %、百分比欄為 FALSE', () => {
  const aff = csvParse(read('config/CSV/Equipment_Affix.csv'));
  const hdr = aff[0].map((h) => String(h).split('\n')[0]);
  const col = (n) => hdr.indexOf(n);
  for (const [id, name] of [['lifesteal', '吸血'], ['manaSteal', '吸魔']]) {
    const row = aff.find((r) => r[col('池')] === '詞條池' && r[col('id')] === id);
    assert.ok(row, id);
    assert.equal(row[col('名稱')], name);
    assert.equal(row[col('百分比')], 'FALSE');
  }
  const omni = aff.find((r) => r[col('id')] === 'omniDrain');
  assert.doesNotMatch(omni.join(','), /\{v\}%/);
  const gems = csvParse(read('config/CSV/Gems.csv'));
  const gh = gems[0];
  const onyx = gems.find((r) => r[0] === 'onyx');
  assert.equal(onyx[gh.indexOf('屬性名稱')], '吸血');
  assert.equal(onyx[gh.indexOf('百分比')], 'FALSE');
});

test('吸血／吸魔上限參數表說明已改為定值', () => {
  const rows = csvParse(read('config/CSV/game_parameters.csv'));
  for (const name of ['吸血 上限', '吸魔 上限']) {
    const row = rows.find((r) => r[3] === name);
    assert.ok(row, name);
    assert.match(row[5], /定值/);
    assert.doesNotMatch(row[5], /每秒生命回復 × |每秒法力恢復 × /);
  }
});
