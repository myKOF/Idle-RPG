const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

/* 天賦系統 V2（1～10 轉）：
   - 每轉 8 個節點、每個上限 100 級；升 1 級成本 = 該天賦轉數 + 1（固定值/級）。
   - 「額外」＝於對應總值上乘算（獨立乘區）；沒寫「額外」＝與現有加成相加。
   - 潛力解鎖節點位於 3/4/7/10 轉（解鎖 3+3+3+1 = 10 個），目前整批鎖定置灰。 */

test('潛力解鎖天賦（3/4/7/10 轉）暫時置灰且禁止升級', () => {
  const c = loadContext();
  c.G.player.reincarnations = 0;
  assert.equal(c.talentSystemUnlocked(), false);
  c.G.player.reincarnations = 1;
  assert.equal(c.talentSystemUnlocked(), true);
  c.G.player.reincarnations = 10;
  c.G.player.reincarnationTalentPoints = 999;

  for (const id of ['t3_potential', 't4_potential', 't7_potential', 't10_potential']) {
    assert.equal(c.talentDef(id).disabled, true);
    assert.match(c.talentUpgrade(id), /暫不開放升級/);
    assert.equal(c.talentLevel(id), 0);
  }

  c.document = { getElementById: () => null };
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), c, { filename: 'js/ui.js' });
  const html = c.talentNodeHTML(c.talentDef('t3_potential'), 3);
  assert.match(html, /temporarily-disabled/);
  assert.match(html, /暫不開放升級/);
});

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, UI: { dirty: {} }, GT: 0 };
  context.window = context;
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

test('天賦資料包含 1～10 轉各 8 個節點與 10 個潛力節點', () => {
  const c = loadContext();
  assert.deepEqual(Object.keys(c.TALENT_TREES).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(Object.values(c.TALENT_TREES).every((tree) => tree.length === 8));
  assert.equal(c.TALENT_IMPLEMENTED_REINCARNATIONS, 10);
  assert.equal(c.POTENTIAL_TALENTS.length, 10);
  assert.equal(c.TALENT_MAX_LEVEL, 100);
  // 潛力解鎖節點：3/4/7 轉各解鎖 3 個、10 轉解鎖 1 個，合計 10
  const unlockDefs = c.talentList().filter((e) => e.def.stat === 'potentialUnlock');
  assert.deepEqual(Array.from(unlockDefs, (e) => e.turn), [3, 4, 7, 10]);
  assert.deepEqual(Array.from(unlockDefs, (e) => e.def.unlocks), [3, 3, 3, 1]);
});

test('天賦 1～50 級與 51～100 級依 low/high 累加，整轉全滿時效果加倍', () => {
  const c = loadContext();
  const def = c.talentDef('t1_str');
  assert.equal(c.talentLevelValue(def, 0), 0);
  assert.equal(c.talentLevelValue(def, 50), 50);
  assert.equal(c.talentLevelValue(def, 51), 52);
  assert.equal(c.talentLevelValue(def, 100), 150);
  for (const node of c.TALENT_TREES[1]) c.G.player.talents.levels[node.id] = 100;
  assert.equal(c.talentStatBonuses().strPct, 300);
});

test('天賦升級成本 = 該天賦轉數 + 1（固定值/級），降級與刪除按新成本退點', () => {
  const c = loadContext();
  // 1 轉天賦：每級 2 點
  assert.equal(c.talentUpgradeCost('t1_str'), 2);
  c.G.player.reincarnationTalentPoints = 9;
  assert.equal(c.talentUpgrade('t1_str'), null);
  assert.equal(c.talentLevel('t1_str'), 1);
  assert.equal(c.G.player.reincarnationTalentPoints, 7);
  assert.equal(c.talentMax('t1_str'), null); // 一鍵升滿：7 點只夠再升 3 級
  assert.equal(c.talentLevel('t1_str'), 4);
  assert.equal(c.G.player.reincarnationTalentPoints, 1);
  assert.equal(c.talentDowngrade('t1_str'), null);
  assert.equal(c.talentLevel('t1_str'), 3);
  assert.equal(c.G.player.reincarnationTalentPoints, 3);
  assert.equal(c.talentDelete('t1_str'), null);
  assert.equal(c.talentLevel('t1_str'), 0);
  assert.equal(c.G.player.reincarnationTalentPoints, 9);

  // 10 轉天賦：每級 11 點
  c.G.player.reincarnations = 10;
  c.G.player.reincarnationTalentPoints = 11;
  assert.equal(c.talentUpgradeCost('t10_str'), 11);
  assert.equal(c.talentUpgrade('t10_str'), null);
  assert.equal(c.G.player.reincarnationTalentPoints, 0);
  assert.match(c.talentUpgrade('t10_str'), /需要 11 點/);
  assert.equal(c.talentDelete('t10_str'), null);
  assert.equal(c.G.player.reincarnationTalentPoints, 11);
});

test('未達轉生次數的天賦鎖定；潛力解鎖節點依 unlocks 逐批解鎖潛力', () => {
  const c = loadContext();
  assert.match(c.talentUpgrade('t2_crit'), /尚未達到 2 轉/);
  c.G.player.reincarnations = 3;
  c.G.player.reincarnationTalentPoints = 10;
  assert.match(c.talentUpgrade('t3_potential'), /暫不開放升級/);
  assert.equal(c.talentLevel('t3_potential'), 0);
  assert.equal(c.potentialUnlockedCount(), 0);
  assert.match(c.potentialUpgrade('p1_time'), /尚未解鎖/);
  assert.equal(c.potentialLevel('p1_time'), 0);
  assert.equal(c.availableSkillPoints(), c.totalSkillPoints());
  assert.match(c.potentialUpgrade('p4_voidBag'), /暫不開放升級/);

  // 直接寫入等級模擬解鎖（潛力解鎖天賦目前 disabled，無法用 talentUpgrade 升級）
  c.G.player.talents.levels.t3_potential = 1;
  assert.equal(c.potentialUnlockedCount(), 3); // 前 3 個潛力（p1~p3）皆未停用
  assert.equal(c.potentialUnlockLimit(), 3);
  assert.equal(c.potentialUnlocked('p3_lootEcho'), true);
  assert.equal(c.potentialUnlocked('p4_voidBag'), false);
  c.G.player.talents.levels.t4_potential = 1;
  assert.equal(c.potentialUnlockLimit(), 6);
  c.G.player.talents.levels.t7_potential = 1;
  c.G.player.talents.levels.t10_potential = 1;
  assert.equal(c.potentialUnlockLimit(), 10);
});

test('潛力解鎖天賦依 2/4 點規則給予技能點（低段每級 2 點、高段每級 4 點）', () => {
  const c = loadContext();
  const def = c.talentDef('t3_potential');
  assert.equal(c.talentLevelValue(def, 1), 2);
  assert.equal(c.talentLevelValue(def, 50), 100);
  assert.equal(c.talentLevelValue(def, 51), 104);
  assert.equal(c.talentLevelValue(def, 100), 300);
  assert.equal(c.potentialCountForLevel(def, 1), 3);
  assert.equal(c.potentialCountForLevel(def, 100), 3);

  c.G.player.reincarnations = 4;
  c.G.player.talents.levels.t3_potential = 100;
  c.G.player.talents.levels.t4_potential = 100;
  assert.equal(c.talentSkillPointBonus(), 600);
  assert.equal(c.totalSkillPoints(), 10600);
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

/* ---- computeStats 接線（V2 乘算/加總語意） ---- */

function statsContext() {
  const c = loadContext();
  c.itemEnchants = () => [];
  c.G.player.level = 1;
  c.G.player.reincarnations = 10;
  c.G.equipment = c.SLOT_LIST.reduce((eq, slot) => { eq[slot] = null; return eq; }, {});
  return c;
}

test('敵種傷害天賦為「額外」乘算：傷害加成總合 ×(1+天賦%)，無其他來源時不憑空提供', () => {
  const c = statsContext();
  c.G.equipment.helmet = { affixes: [
    { key: 'normalDmg', val: 10 }, { key: 'eliteDmg', val: 10 }, { key: 'bossDmg', val: 10 }
  ], sockets: [] };
  c.G.player.talents.levels.t3_normal = 1;
  c.G.player.talents.levels.t3_elite = 1;
  c.G.player.talents.levels.t3_boss = 1;

  const st = c.computeStats();
  assert.equal(st.normalDmg, 10 * 1.01);
  assert.equal(st.eliteDmg, 10 * 1.01);
  assert.equal(st.bossDmg, 10 * 1.01);

  // 6/8 轉「弒王進階/極意」與 3 轉弒王法則百分比相加後一次乘算
  c.G.player.talents.levels.t6_boss = 1;  // +1%
  c.G.player.talents.levels.t8_boss = 1;  // +5%
  assert.equal(c.computeStats().bossDmg, 10 * 1.07);

  // 沒有任何敵種傷害來源時，天賦不再憑空提供
  c.G.equipment.helmet = null;
  const bare = c.computeStats();
  assert.equal(bare.normalDmg, 0);
  assert.equal(bare.bossDmg, 0);
});

test('敵種抗性天賦為「額外」乘算：抗性總合 ×(1+天賦%)；對BOSS抗性三個天賦相加後乘算', () => {
  const c = statsContext();
  c.G.equipment.helmet = { affixes: [
    { key: 'normalDmgRed', val: 100 }, { key: 'eliteDmgRed', val: 100 }, { key: 'bossDmgRed', val: 100 }
  ], sockets: [] };
  c.G.player.talents.levels.t2_normalred = 10;  // +10%
  c.G.player.talents.levels.t4_normalred = 10;  // +20%
  c.G.player.talents.levels.t2_elitered = 10;   // +10%
  c.G.player.talents.levels.t6_bossred = 10;    // +10%
  c.G.player.talents.levels.t8_bossred = 10;    // +50%
  c.G.player.talents.levels.t10_bossred = 10;   // +100%

  const st = c.computeStats();
  assert.equal(st.normalDmgRed, 100 * 1.3);
  assert.equal(st.eliteDmgRed, 100 * 1.1);
  assert.equal(st.bossDmgRed, 100 * 2.6);

  // 沒有其他抗性來源時，乘算天賦不憑空提供定值
  c.G.equipment.helmet = null;
  assert.equal(c.computeStats().bossDmgRed, 0);
});

test('生命/護盾天賦為「額外」乘算：總值 ×(1+天賦%)', () => {
  const c = statsContext();
  const base = c.computeStats();
  c.G.player.talents.levels.t2_hp = 10;     // 生命 +10%
  c.G.player.talents.levels.t2_shield = 10; // 護盾 +10%
  const st = c.computeStats();
  assert.equal(st.hp, Math.round(base.hp * 1.1));
  // 護盾效率折算：(1+0%)×(1+10%)−1 = 10%
  assert.ok(Math.abs(st.shieldEff - 10) < 1e-9);
});

test('物抗/魔抗天賦為「額外」乘算；全屬性抗性天賦對六大元素各自乘算', () => {
  const c = statsContext();
  c.G.equipment.helmet = { affixes: [
    { key: 'pRes', val: 100 }, { key: 'mRes', val: 100 }, { key: 'resFire', val: 100 }
  ], sockets: [] };
  c.G.player.talents.levels.t1_pres = 10;  // +10%
  c.G.player.talents.levels.t9_pres = 10;  // +30%
  c.G.player.talents.levels.t1_mres = 10;  // +10%
  // 全屬性抗性：3 轉兩個節點 + 5/7 轉，百分比相加後對每個元素乘一次
  c.G.player.talents.levels.t3_allres = 10;   // +10%
  c.G.player.talents.levels.t3_allres2 = 10;  // +10%
  c.G.player.talents.levels.t7_allres = 10;   // +20%

  const st = c.computeStats();
  assert.equal(st.pRes, 100 * 1.4);
  assert.equal(st.mRes, 100 * 1.1);
  assert.equal(st.resist.fire, 100 * 1.4);
  assert.equal(st.resist.ice, 0); // 無來源的元素不憑空提供
});

test('物攻/魔攻天賦為「額外」獨立乘區；總傷害額外增幅寫入 totalDmgPct', () => {
  const c = statsContext();
  const base = c.computeStats();
  c.G.player.talents.levels.t7_patk = 10;      // 物攻 +10%
  c.G.player.talents.levels.t7_matk = 20;      // 魔攻 +20%
  c.G.player.talents.levels.t7_totaldmg = 10;  // 總傷害 +5%（每級 0.5%）
  c.G.player.talents.levels.t10_totaldmg = 10; // 總傷害 +10%（每級 1%）
  const st = c.computeStats();
  assert.equal(st.atk, Math.round(base.atk * 1.1));
  assert.equal(st.matk, Math.round(base.matk * 1.2));
  assert.equal(st.totalDmgPct, 15);
});

test('對屬性敵人傷害天賦與詞條直接相加；對屬性敵人抗性寫入 resVsElem', () => {
  const c = statsContext();
  c.G.equipment.helmet = { affixes: [{ key: 'dmgVsFire', val: 10 }], sockets: [] };
  c.G.player.talents.levels.t6_vsfire = 10;   // +30%（每級 3%）
  c.G.player.talents.levels.t8_rvsfire = 10;  // 對火屬性敵人抗性 30
  const st = c.computeStats();
  assert.equal(st.dmgVsElem.fire, 40);
  assert.equal(st.resVsElem.fire, 30);
  assert.equal(st.resVsElem.ice, 0);
});

test('寶石鑲嵌效率天賦與其他來源直接相加，放大鑲嵌寶石數值', () => {
  const c = statsContext();
  c.G.player.talents.levels.t10_gemeff = 10; // +100%（每級 10%）
  const st = c.computeStats();
  assert.equal(st.gemEff, 100);

  // 鑲一顆紅寶石（atkFlat）驗證 gemMult 放大
  const gemVal = c.gemStatValue('ruby', 1);
  c.G.equipment.helmet = { affixes: [], sockets: [{ type: 'ruby', level: 1 }] };
  const withGem = c.computeStats();
  assert.equal(withGem.A.atkFlat, gemVal * 2);
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

test('5/9 轉元素天賦使用攻擊附加元素傷害的完整說明', () => {
  const c = loadContext();
  c.document = { getElementById: () => null };
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), c, { filename: 'js/ui.js' });
  const expected5 = {
    t5_fire: '火焰', t5_ice: '寒冰', t5_lightning: '雷電',
    t5_poison: '劇毒', t5_light: '聖光', t5_dark: '暗影'
  };

  for (const [id, element] of Object.entries(expected5)) {
    const def = c.talentDef(id);
    assert.equal(def.desc, '攻擊時額外附加');
    assert.equal(def.low, 1);  // Lv.1~50 每級 1%
    assert.equal(def.high, 2); // Lv.51~100 每級 2%
    assert.equal(c.talentLevelValue(def, 50), 50);
    assert.equal(c.talentLevelValue(def, 100), 150);
    assert.equal(c.talentEffectDescription(def, 1), '攻擊時額外附加1%' + element + '傷害');
  }
  for (const id of ['t9_fire', 't9_ice', 't9_lightning', 't9_poison', 't9_light', 't9_dark']) {
    const def = c.talentDef(id);
    assert.equal(def.low, 2);  // Lv.1~50 每級 2%
    assert.equal(def.high, 4); // Lv.51~100 每級 4%
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
  c.G.player.reincarnations = 10;

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
  const talentHtml = c.talentNodeHTML(c.talentDef('t5_fire'), 5);
  const potentialHtml = c.potentialNodeHTML(c.potentialDef('p1_time'), 0);

  assert.match(talentHtml, /data-talent-tip="t5_fire"/);
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
  c.G.player.reincarnations = 2;
  c.G.player.talents.levels.t2_crit = 100;
  c.UI.selTalent = { kind: 'talent', id: 't2_crit' };
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
  c.G.player.reincarnations = 10;
  c.G.equipment = c.SLOT_LIST.reduce((eq, slot) => { eq[slot] = null; return eq; }, {});
  c.G.equipment.helmet = { affixes: [{ key: 'globalDmgRed', val: 1000 }], sockets: [] };

  // V2 數值：5 轉傷害偏折 Lv.1~50 每級 1%、Lv.51~100 每級 2%；7 轉絕對偏折每級 2%/4%
  assert.equal(c.talentDef('t5_global').low, 1);
  assert.equal(c.talentDef('t5_global').high, 2);
  assert.equal(c.talentDef('t7_global').low, 2);
  assert.equal(c.talentDef('t7_global').high, 4);

  // 無天賦：純裝備定值
  assert.equal(c.computeStats().globalDmgRed, 1000);

  // 傷害偏折 Lv.100（未全滿 ×1）＝ +150% → 1000 × 2.5
  c.G.player.talents.levels.t5_global = 100;
  assert.equal(c.computeStats().globalDmgRed, 2500);

  // 疊加 7 轉絕對偏折 Lv.50（+100%）：百分比相加 → 1000 × (1 + 250%)
  c.G.player.talents.levels.t7_global = 50;
  assert.equal(c.computeStats().globalDmgRed, 3500);

  // 沒有任何全局減傷來源時，天賦不再憑空提供定值
  c.G.equipment.helmet = null;
  assert.equal(c.computeStats().globalDmgRed, 0);
});

test('物防/魔防鍛體為獨立乘區：與裝備物防%連乘、物魔分開', () => {
  const c = loadContext();
  c.itemEnchants = () => [];
  c.G.player.level = 1;
  c.G.equipment = c.SLOT_LIST.reduce((eq, slot) => { eq[slot] = null; return eq; }, {});
  c.G.equipment.helmet = { affixes: [{ key: 'defPct', val: 100 }], sockets: [] }; // 裝備物防% ×2（僅作用物防）

  const base = c.computeStats();
  assert.equal(base.def, Math.round(base.base.def * 2));
  assert.equal(base.mdef, Math.round(base.base.mdef)); // 裝備物防%不影響魔防

  // 物防鍛體 Lv.10（+10%）：與裝備連乘 ×2×1.1，且不影響魔防
  c.G.player.talents.levels.t1_def = 10;
  const withDef = c.computeStats();
  assert.equal(withDef.def, Math.round(withDef.base.def * 2 * 1.1));
  assert.equal(withDef.mdef, Math.round(withDef.base.mdef));

  // 魔防鍛體 Lv.10（+10%）：乘算到魔防
  c.G.player.talents.levels.t1_mdef = 10;
  const withMdef = c.computeStats();
  assert.equal(withMdef.mdef, Math.round(withMdef.base.mdef * 1.1));
  assert.equal(withMdef.def, Math.round(withMdef.base.def * 2 * 1.1));

  // 1 轉與 3 轉同屬性百分比相加後才乘算：t1_def 10% + t3_def 10% → ×1.2
  c.G.player.reincarnations = 3;
  c.G.player.talents.levels.t3_def = 10;
  const stacked = c.computeStats();
  assert.equal(stacked.def, Math.round(stacked.base.def * 2 * 1.2));
});

test('爆擊/閃避/命中天賦與屬性加成直接相加；爆傷每級 75/150', () => {
  const c = loadContext();
  c.itemEnchants = () => [];
  c.G.player.level = 1;
  c.G.player.reincarnations = 10;
  c.G.equipment = c.SLOT_LIST.reduce((eq, slot) => { eq[slot] = null; return eq; }, {});

  assert.equal(c.talentDef('t2_critdmg').low, 75);
  assert.equal(c.talentDef('t2_critdmg').high, 150);

  const base = c.computeStats();
  c.G.player.talents.levels.t2_crit = 10;     // +50%
  c.G.player.talents.levels.t2_critdmg = 10;  // +750%
  c.G.player.talents.levels.t2_hit = 10;      // +50%
  c.G.player.talents.levels.t2_evasion = 10;  // +50%
  c.G.player.talents.levels.t7_hit = 10;      // +100%
  c.G.player.talents.levels.t7_evasion = 10;  // +100%
  const st = c.computeStats();
  assert.equal(st.critRate, base.critRate + 50);
  assert.equal(st.critDmg, base.critDmg + 750);
  assert.equal(st.hit, base.hit + 150);
  assert.equal(st.evasion, base.evasion + 150);
});

test('天賦升級成本顯示為「轉數+1」', () => {
  const c = loadContext();
  const body = { innerHTML: '' };
  const overlay = { style: { display: 'flex' } };
  c.document = {
    getElementById: (id) => id === 'talent-modal-body' ? body : (id === 'talent-modal' ? overlay : null)
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), c, { filename: 'js/ui.js' });
  c.G.player.reincarnations = 6;
  c.UI.selTalent = { kind: 'talent', id: 't6_boss' };
  c.renderTalentModal();
  assert.match(body.innerHTML, /消耗天賦點：7/);
});
