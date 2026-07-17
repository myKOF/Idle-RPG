const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('4/5 轉潛力解鎖天賦暫時置灰且禁止升級', () => {
  const c = loadContext();
  c.G.player.reincarnations = 0;
  assert.equal(c.talentSystemUnlocked(), false);
  c.G.player.reincarnations = 1;
  assert.equal(c.talentSystemUnlocked(), true);
  c.G.player.reincarnations = 5;
  c.G.player.reincarnationTalentPoints = 999;

  for (const id of ['t4_potential', 't5_potential']) {
    assert.equal(c.talentDef(id).disabled, true);
    assert.match(c.talentUpgrade(id), /暫不開放升級/);
    assert.equal(c.talentLevel(id), 0);
  }

  c.document = { getElementById: () => null };
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), c, { filename: 'js/ui.js' });
  const html = c.talentNodeHTML(c.talentDef('t4_potential'), 4);
  assert.match(html, /temporarily-disabled/);
  assert.match(html, /暫不開放升級/);
});

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, UI: { dirty: {} }, GT: 0 };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/skills.js', 'js/talents.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: {
      reincarnations: 1,
      reincarnationTalentPoints: 0,
      skillPointBudget: 10,
      skillPoints: 10,
      gold: 1000000,
      skills: {},
      talents: { levels: {}, potentialLevels: {} }
    }
  };
  return context;
}

test('天賦資料包含 1～5 轉各 8 個節點與 10 個潛力節點', () => {
  const c = loadContext();
  assert.deepEqual(Object.keys(c.TALENT_TREES).map(Number), [1, 2, 3, 4, 5]);
  assert.ok(Object.values(c.TALENT_TREES).every((tree) => tree.length === 8));
  assert.equal(c.POTENTIAL_TALENTS.length, 10);
  assert.equal(c.TALENT_MAX_LEVEL, 100);
});

test('天賦 1～50 級與 51～100 級依企劃書累加，整轉全滿時效果加倍', () => {
  const c = loadContext();
  const def = c.talentDef('t1_str');
  assert.equal(c.talentLevelValue(def, 0), 0);
  assert.equal(c.talentLevelValue(def, 50), 50);
  assert.equal(c.talentLevelValue(def, 51), 52);
  assert.equal(c.talentLevelValue(def, 100), 150);
  for (const node of c.TALENT_TREES[1]) c.G.player.talents.levels[node.id] = 100;
  assert.equal(c.talentStatBonuses().strPct, 300);
});

test('天賦升級、滿級、降級與刪除依等級成本退還點數', () => {
  const c = loadContext();
  c.G.player.reincarnationTalentPoints = 10;
  assert.equal(c.talentUpgrade('t1_str'), null);
  assert.equal(c.talentLevel('t1_str'), 1);
  assert.equal(c.G.player.reincarnationTalentPoints, 9);
  assert.equal(c.talentMax('t1_str'), null);
  assert.equal(c.talentLevel('t1_str'), 4);
  assert.equal(c.G.player.reincarnationTalentPoints, 0);
  assert.equal(c.talentDowngrade('t1_str'), null);
  assert.equal(c.talentLevel('t1_str'), 3);
  assert.equal(c.G.player.reincarnationTalentPoints, 4);
  assert.equal(c.talentDelete('t1_str'), null);
  assert.equal(c.talentLevel('t1_str'), 0);
  assert.equal(c.G.player.reincarnationTalentPoints, 10);
});

test('未達轉生次數的天賦鎖定，4/5 轉里程碑逐批解鎖潛力節點', () => {
  const c = loadContext();
  assert.match(c.talentUpgrade('t2_fire'), /尚未達到 2 轉/);
  c.G.player.reincarnations = 4;
  c.G.player.reincarnationTalentPoints = 1;
  assert.match(c.talentUpgrade('t4_potential'), /暫不開放升級/);
  assert.equal(c.talentLevel('t4_potential'), 0);
  assert.equal(c.potentialUnlockedCount(), 0);
  assert.match(c.potentialUpgrade('p1_time'), /尚未解鎖/);
  assert.equal(c.potentialLevel('p1_time'), 0);
  assert.equal(c.availableSkillPoints(), c.totalSkillPoints());
  assert.match(c.potentialUpgrade('p4_voidBag'), /暫不開放升級/);
});

test('潛力啟示固定解鎖前三個潛力，並依 2/4 點規則給予技能點', () => {
  const c = loadContext();
  const def = c.talentDef('t4_potential');
  assert.equal(c.talentLevelValue(def, 1), 2);
  assert.equal(c.talentLevelValue(def, 50), 100);
  assert.equal(c.talentLevelValue(def, 51), 104);
  assert.equal(c.talentLevelValue(def, 100), 300);
  assert.equal(c.potentialCountForLevel(def, 1), 3);
  assert.equal(c.potentialCountForLevel(def, 100), 3);

  c.G.player.reincarnations = 4;
  c.G.player.talents.levels.t4_potential = 100;
  assert.equal(c.potentialUnlockedCount(), 3);
  assert.equal(c.potentialUnlocked('p3_lootEcho'), true);
  assert.equal(c.potentialUnlocked('p4_voidBag'), false);
  assert.equal(c.talentSkillPointBonus(), 300);
  assert.equal(c.totalSkillPoints(), 10300);
});

test('潛力覺醒固定解鎖兩個潛力，並依 2/4 點規則給予技能點', () => {
  const c = loadContext();
  const def = c.talentDef('t5_potential');
  assert.equal(def.desc, '解鎖新類型技能「潛力」兩個並給予技能點');
  assert.equal(c.talentLevelValue(def, 1), 2);
  assert.equal(c.talentLevelValue(def, 50), 100);
  assert.equal(c.talentLevelValue(def, 51), 104);
  assert.equal(c.talentLevelValue(def, 100), 300);
  assert.equal(c.potentialCountForLevel(def, 1), 2);
  assert.equal(c.potentialCountForLevel(def, 100), 2);

  c.G.player.reincarnations = 5;
  c.G.player.talents.levels.t5_potential = 100;
  assert.equal(c.potentialUnlockedCount(), 2);
  assert.equal(c.potentialUnlocked('p2_secondLife'), true);
  assert.equal(c.potentialUnlocked('p3_lootEcho'), false);
  assert.equal(c.talentSkillPointBonus(), 300);
  assert.equal(c.totalSkillPoints(), 10300);
});

test('5 轉新增的兩個潛力技能暫時置灰且禁止升級', () => {
  const c = loadContext();
  c.G.player.reincarnations = 5;
  c.G.player.talents.levels.t4_potential = 1;
  c.G.player.talents.levels.t5_potential = 1;

  assert.equal(c.potentialUnlocked('p1_time'), true);
  assert.equal(c.potentialUnlocked('p3_lootEcho'), true);
  assert.equal(c.potentialUnlocked('p4_voidBag'), false);
  assert.equal(c.potentialUnlocked('p5_elementCore'), false);
  assert.equal(c.potentialUnlockedCount(), 3);
  assert.match(c.potentialUpgrade('p4_voidBag'), /暫不開放升級/);
  assert.match(c.potentialUpgrade('p5_elementCore'), /暫不開放升級/);
});

test('潛力效果會彙總到衍生加成', () => {
  const c = loadContext();
  c.G.player.reincarnations = 5;
  c.G.player.talents.potentialLevels.p1_time = 3;
  c.G.player.talents.potentialLevels.p4_voidBag = 2;
  const b = c.talentStatBonuses();
  assert.equal(b.potentialCdr, 3);
  assert.equal(b.potentialInvCap, 200);
});

test('普通／菁英／BOSS 天賦傷害與裝備敵種傷害分開保留', () => {
  const c = loadContext();
  c.itemEnchants = () => [];
  c.G.player.level = 1;
  c.G.player.reincarnations = 4;
  c.G.equipment = c.SLOT_LIST.reduce((eq, slot) => { eq[slot] = null; return eq; }, {});
  c.G.equipment.helmet = { affixes: [
    { key: 'normalDmg', val: 10 }, { key: 'eliteDmg', val: 10 }, { key: 'bossDmg', val: 10 }
  ], sockets: [] };
  c.G.player.talents.levels.t4_normal = 1;
  c.G.player.talents.levels.t4_elite = 1;
  c.G.player.talents.levels.t4_boss = 1;

  const st = c.computeStats();
  assert.equal(st.baseNormalDmg, 10);
  assert.equal(st.baseEliteDmg, 10);
  assert.equal(st.baseBossDmg, 10);
  assert.equal(st.talentNormalDmg, 1);
  assert.equal(st.talentEliteDmg, 1);
  assert.equal(st.talentBossDmg, 1);
  assert.equal(st.normalDmg, 11); // 面板合計仍顯示 11%，戰鬥會拆成 ×1.10×1.01
  assert.equal(st.eliteDmg, 11);
  assert.equal(st.bossDmg, 11);
});

test('GM 變更轉生次數會清空天賦並依新轉生次數重算天賦點', () => {
  const c = loadContext();
  c.G.player.level = 1234;
  c.G.player.reincarnationTalentPoints = 999999;
  c.G.player.talents.levels.t1_str = 8;
  c.G.player.talents.potentialLevels.p1_time = 4;

  c.resetTalentsForReincarnationGM(3);

  assert.equal(c.G.player.talents.levels.t1_str, 0);
  assert.equal(c.G.player.talents.potentialLevels.p1_time, 0);
  assert.equal(c.G.player.reincarnationTalentPoints, (3 - 1) * (c.REINCARNATION_LEVEL - 1) + (1234 - 1));

  c.G.player.level = 9999;
  c.resetTalentsForReincarnationGM(0);
  assert.equal(c.G.player.reincarnationTalentPoints, 0);
});

test('全部潛力技能的效果文字清楚標示數值意義', () => {
  const data = fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  assert.match(data, /受到致命傷害時復活，並恢復最大生命值的 20%（最高 100%）/);
  assert.match(data, /每級使掉落物數量額外增加 5%/);
  assert.match(ui, /def\.stat === 'potentialRevive'[\s\S]*current \* 20/);
  assert.match(ui, /def\.stat === 'potentialLootDup'[\s\S]*目前額外掉落加成/);
  for (const stat of ['potentialCdr', 'potentialInvCap', 'potentialElemAtk', 'potentialExecute', 'potentialShieldOverflow', 'potentialManaRefund', 'potentialTowerTime', 'potentialOffline']) {
    assert.match(ui, new RegExp("def\\.stat === '" + stat + "'"));
  }
});

test('潛力區塊位於技能界面，天賦界面不再顯示潛力面板與技能點摘要', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const talentStart = ui.indexOf('function renderTalents()');
  const skillsStart = ui.indexOf('function renderSkills()');
  const modalStart = ui.indexOf('/* ----', talentStart);
  const talentRender = ui.slice(talentStart, modalStart);
  const skillsRender = ui.slice(skillsStart, ui.indexOf('/* ----', skillsStart));

  assert.doesNotMatch(talentRender, /POTENTIAL_TALENTS\.map/);
  assert.match(skillsRender, /potential-skill-panel/);
  assert.match(skillsRender, /POTENTIAL_TALENTS\.map\(function \(def, index\)/);
});

test('潛力技能沿用一般技能的升級彈窗與操作流程', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const talentModalStart = ui.indexOf('function renderTalentModal()');
  const talentModalEnd = ui.indexOf('function renderTalents()', talentModalStart);
  const skillModalStart = ui.indexOf('function renderSkillModal()');
  const skillModalEnd = ui.indexOf('/* ---- 技能懸停提示 ---- */', skillModalStart);
  const talentModal = ui.slice(talentModalStart, talentModalEnd);
  const skillModal = ui.slice(skillModalStart, skillModalEnd);

  assert.match(ui, /openSkillModal\('potential:' \+ id\)/);
  assert.match(ui, /function potentialSkillId/);
  assert.match(skillModal, /class="skd-head"/);
  assert.match(skillModal, /skill-modal-actions/);
  assert.match(skillModal, /data-skill-learn="' \+ skillRef/);
  assert.doesNotMatch(talentModal, /potential-modal|data-potential-/);
});

test('2 轉六個元素天賦使用攻擊附加元素傷害的完整說明', () => {
  const c = loadContext();
  c.document = { getElementById: () => null };
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), c, { filename: 'js/ui.js' });
  const expected = {
    t2_fire: '火焰', t2_ice: '寒冰', t2_lightning: '雷電',
    t2_poison: '劇毒', t2_light: '聖光', t2_dark: '暗影'
  };

  for (const [id, element] of Object.entries(expected)) {
    const def = c.talentDef(id);
    assert.equal(def.desc, '攻擊時額外附加');
    assert.equal(def.low, 0.25);  // Lv.1~50 每級 0.25%
    assert.equal(def.high, 0.5);  // Lv.51~100 每級 0.5%
    assert.equal(c.talentLevelValue(def, 50), 12.5);
    assert.equal(c.talentLevelValue(def, 100), 37.5);
    assert.equal(c.talentEffectDescription(def, 0), '攻擊時額外附加0%' + element + '傷害');
    assert.equal(c.talentEffectDescription(def, 0.25), '攻擊時額外附加0.25%' + element + '傷害');
    assert.equal(c.talentEffectDescription(def, 12.5), '攻擊時額外附加12.5%' + element + '傷害');
  }
});

test('所有一般天賦在 0 級時的目前效果改顯示 1 級效果', () => {
  const c = loadContext();
  const body = { innerHTML: '' };
  const overlay = { style: { display: 'flex' } };
  c.document = {
    getElementById: (id) => id === 'talent-modal-body' ? body : (id === 'talent-modal' ? overlay : null)
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), c, { filename: 'js/ui.js' });
  c.G.player.reincarnations = 5;

  for (const [turn, tree] of Object.entries(c.TALENT_TREES)) {
    for (const def of tree) {
      c.G.player.talents.levels[def.id] = 0;
      c.UI.selTalent = { kind: 'talent', id: def.id };
      c.renderTalentModal();
      const expectedValue = c.talentDescriptionValue(def, 1, Number(turn));
      const expected = c.talentEffectDescription(def, expectedValue);
      assert.match(body.innerHTML, new RegExp('<div class="talent-modal-desc"><b>' + expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</b>'));
    }
  }
});

test('天賦與潛力圖示使用正式 tooltip，不再使用原生 title 提示', () => {
  const c = loadContext();
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  c.document = { getElementById: () => null };
  vm.runInContext(ui, c, { filename: 'js/ui.js' });
  const talentHtml = c.talentNodeHTML(c.talentDef('t2_fire'), 2);
  const potentialHtml = c.potentialNodeHTML(c.potentialDef('p1_time'), 0);

  assert.match(talentHtml, /data-talent-tip="t2_fire"/);
  assert.match(potentialHtml, /data-talent-tip="potential:p1_time"/);
  const disabledPotentialHtml = c.potentialNodeHTML(c.potentialDef('p4_voidBag'), 3);
  assert.match(disabledPotentialHtml, /temporarily-disabled/);
  assert.match(disabledPotentialHtml, /暫不開放/);
  assert.doesNotMatch(talentHtml, /\stitle=/);
  assert.doesNotMatch(potentialHtml, /\stitle=/);
  assert.match(ui, /function showTalentTooltip\(ref, anchorEl\)/);
  assert.match(ui, /showTalentTooltip\(talentTipHover\.getAttribute\('data-talent-tip'\), talentTipHover\)/);
});

test('天賦滿級時標示完成並隱藏下一級與升級消耗', () => {
  const c = loadContext();
  const body = { innerHTML: '' };
  const overlay = { style: { display: 'flex' } };
  c.document = {
    getElementById: (id) => id === 'talent-modal-body' ? body : (id === 'talent-modal' ? overlay : null)
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), c, { filename: 'js/ui.js' });
  c.G.player.reincarnations = 3;
  c.G.player.talents.levels.t3_crit = 100;
  c.UI.selTalent = { kind: 'talent', id: 't3_crit' };
  c.renderTalentModal();

  assert.match(body.innerHTML, /talent-modal-complete">已滿級！/);
  assert.doesNotMatch(body.innerHTML, /下一級：/);
  assert.doesNotMatch(body.innerHTML, /消耗天賦點：/);
  assert.match(body.innerHTML, /轉生天賦點：/);
});

test('傷害偏折/絕對偏折為乘算：全局減傷 = 裝備總值 × (1 + 天賦%/100)', () => {
  const c = loadContext();
  c.itemEnchants = () => []; // itemEnchants 定義於 js/item.js，此測試環境未載入
  c.G.player.level = 1;
  c.G.player.reincarnations = 4;
  c.G.equipment = c.SLOT_LIST.reduce((eq, slot) => { eq[slot] = null; return eq; }, {});
  c.G.equipment.helmet = { affixes: [{ key: 'globalDmgRed', val: 1000 }], sockets: [] };

  // 每級數值減半：Lv.1~50 每級 0.5%、Lv.51~100 每級 1%
  assert.equal(c.talentDef('t2_global').low, 0.5);
  assert.equal(c.talentDef('t2_global').high, 1);
  assert.equal(c.talentDef('t4_global').low, 0.5);
  assert.equal(c.talentDef('t4_global').high, 1);

  // 無天賦：純裝備定值
  assert.equal(c.computeStats().globalDmgRed, 1000);

  // 傷害偏折 Lv.100（未全滿 ×1）＝ +75% → 1000 × 1.75
  c.G.player.talents.levels.t2_global = 100;
  assert.equal(c.computeStats().globalDmgRed, 1750);

  // 2 轉全滿 ×2 ＝ +150% → 1000 × 2.5
  for (const def of c.TALENT_TREES[2]) c.G.player.talents.levels[def.id] = 100;
  assert.equal(c.computeStats().globalDmgRed, 2500);

  // 疊加 4 轉絕對偏折 Lv.50（+25%）：百分比相加 → 1000 × (1 + 175%)
  c.G.player.talents.levels.t4_global = 50;
  assert.equal(c.computeStats().globalDmgRed, 2750);

  // 沒有任何全局減傷來源時，天賦不再憑空提供定值
  c.G.equipment.helmet = null;
  assert.equal(c.computeStats().globalDmgRed, 0);
});

test('物防/魔防鍛體為獨立乘區：與裝備物防%連乘、物魔分開', () => {
  const c = loadContext();
  c.itemEnchants = () => [];
  c.G.player.level = 1;
  c.G.equipment = c.SLOT_LIST.reduce((eq, slot) => { eq[slot] = null; return eq; }, {});
  c.G.equipment.helmet = { affixes: [{ key: 'defPct', val: 100 }], sockets: [] }; // 裝備物防% ×2（物魔共用）

  const base = c.computeStats();
  assert.equal(base.def, Math.round(base.base.def * 2));
  assert.equal(base.mdef, Math.round(base.base.mdef * 2));

  // 物防鍛體 Lv.10（+10%）：與裝備連乘 ×2×1.1，且不再影響魔防
  c.G.player.talents.levels.t1_def = 10;
  const withDef = c.computeStats();
  assert.equal(withDef.def, Math.round(withDef.base.def * 2 * 1.1));
  assert.equal(withDef.mdef, Math.round(withDef.base.mdef * 2));

  // 魔防鍛體 Lv.10（+10%）：先前完全無作用，現在乘算到魔防
  c.G.player.talents.levels.t1_mdef = 10;
  const withMdef = c.computeStats();
  assert.equal(withMdef.mdef, Math.round(withMdef.base.mdef * 2 * 1.1));
  assert.equal(withMdef.def, Math.round(withMdef.base.def * 2 * 1.1));

  // 1 轉與 4 轉同屬性百分比相加後才乘算：t1_def 10% + t4_def 10% → ×1.2
  c.G.player.talents.levels.t4_def = 10;
  const stacked = c.computeStats();
  assert.equal(stacked.def, Math.round(stacked.base.def * 2 * 1.2));
});

test('傷害偏折每級 0.5%，數值顯示保留小數', () => {
  const c = loadContext();
  c.document = { getElementById: () => null };
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), c, { filename: 'js/ui.js' });
  const def = c.talentDef('t2_global');
  assert.equal(c.talentEffectDescription(def, 0.5), '全局減傷額外提高0.5%');
  assert.equal(c.talentEffectDescription(def, 150), '全局減傷額外提高150%');
});
