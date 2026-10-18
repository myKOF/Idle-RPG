const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

/* 天堂威能十級制：固定每級效果與逐級成本。 */

test('四個舊潛力解鎖威能已刪除，不阻擋整轉全滿', () => {
  const c=loadContext(); c.G.player.reincarnations=10; c.G.player.reincarnationTalentPoints=999;
  for(const id of ['t3_potential','t4_potential','t7_potential','t10_potential']) {
    assert.equal(c.talentDef(id),null); assert.match(c.talentUpgrade(id),/找不到/);
  }
  for(const def of c.TALENT_TREES[3]) if(!def.disabled) c.G.player.talents.levels[def.id]=10;
  assert.equal(c.talentTreeComplete(3),true); assert.equal(c.talentCompleteMultiplier(3),1);
});

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, UI: { dirty: {} }, GT: 0 };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/skills.js', 'js/talents.js'].forEach((file) => {
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

function talentPanelSnapshot(context) {
  return {
    talents: context.G.player.talents,
    reincarnations: context.G.player.reincarnations,
    talentPoints: context.G.player.reincarnationTalentPoints
  };
}

/* 節點數：帶「每個元素一個節點」的 5/6/8/9 轉＝元素數 + 2，其餘六轉維持 8 個。
   2026-08-07 新增地屬性後為 9 個，2026-08-18 新增風屬性後為 10 個。
   節點數量寫死在測試裡是為了擋住「漏補某一轉」的疏失，所以逐轉列出而不是只檢查「全部相等」。 */
const TALENT_TREE_SIZES = { 1: 8, 2: 8, 3: 7, 4: 7, 5: 10, 6: 10, 7: 7, 8: 10, 9: 10, 10: 7 };

test('天賦資料包含 1～10 轉節點（元素轉 10 個、其餘 8 個）；不再有潛力節點', () => {
  const c = loadContext();
  assert.deepEqual(Object.keys(c.TALENT_TREES).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const [turn, size] of Object.entries(TALENT_TREE_SIZES)) {
    assert.equal(c.TALENT_TREES[turn].length, size, `${turn} 轉節點數應為 ${size}`);
  }
  // 元素節點的四轉必須湊齊 ELEMENTS 全部屬性，缺一個就是「該屬性天賦沒補上」
  for (const [turn, prefix] of [[5, 'elem'], [6, 'dmgVs'], [8, 'resVs'], [9, 'elem']]) {
    const stats = new Set(c.TALENT_TREES[turn].map((d) => d.stat));
    for (const e of c.ELEMENTS) {
      const key = prefix + e.charAt(0).toUpperCase() + e.slice(1);
      assert.ok(stats.has(key), `${turn} 轉缺少 ${key} 節點`);
    }
  }
  assert.equal(c.TALENT_IMPLEMENTED_REINCARNATIONS, 10);
  assert.equal(c.POTENTIAL_TALENTS, undefined);
  assert.equal(c.TALENT_MAX_LEVEL, 10);
  // 潛力解鎖節點：3/4/7 轉各解鎖 3 個、10 轉解鎖 1 個，合計 10
  const unlockDefs = c.talentList().filter((e) => e.def.stat === 'potentialUnlock');
  assert.deepEqual(Array.from(unlockDefs), []);
  assert.ok(unlockDefs.every(e => e.def.disabled && e.def.unlocks === undefined));
});

test('威能十級均使用每級增加值，整轉啟用節點全滿仍依表值', () => {
  const c=loadContext(),def=c.talentDef('t1_str'); assert.equal(def.per,0.5);
  assert.equal(c.talentLevelValue(def,0),0); assert.equal(c.talentLevelValue(def,1),0.5);
  assert.equal(c.talentLevelValue(def,10),5); assert.equal(c.talentLevelValue(def,100),5);
  for(const node of c.TALENT_TREES[1]) c.G.player.talents.levels[node.id]=10;
  assert.equal(c.talentStatBonuses().strPct,5);
});

test('威能升到N級消耗N點，滿級55點，降級與清除精確退點', () => {
  const c=loadContext(); c.G.player.reincarnations=10;
  for(const id of ['t1_str','t2_crit','t10_str']) {
    c.G.player.reincarnationTalentPoints=55;
    for(let lv=1;lv<=10;lv++) { assert.equal(c.talentUpgradeCost(id,lv),lv); assert.equal(c.talentUpgrade(id),null); }
    assert.equal(c.talentTotalCost(id,10),55); assert.equal(c.G.player.reincarnationTalentPoints,0);
    assert.match(c.talentUpgrade(id),/最高/); assert.equal(c.talentDowngrade(id),null);
    assert.equal(c.G.player.reincarnationTalentPoints,10); assert.equal(c.talentDelete(id),null);
    assert.equal(c.G.player.reincarnationTalentPoints,55);
  }
  c.G.player.reincarnationTalentPoints=5; assert.equal(c.talentMax('t1_str'),null);
  assert.equal(c.talentLevel('t1_str'),2); assert.equal(c.G.player.reincarnationTalentPoints,2);
  assert.match(c.talentUpgrade('t1_str'),/需要 3 點/);
});




/* 改版前潛力是「聚合到 talentStatBonuses 的被動加成」（b.potentialCdr / b.potentialInvCap）。
   3fdf419 實裝後改為主動技能：有冷卻、持續時間與機制鍵，效果在施放時生效，
   不再有任何 potential* 的衍生加成鍵。本測試改為鎖住現行模型。 */

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
  assert.equal(st.normalDmg, 10 * 1.005); // V3：清場/破菁每級 0.5%
  assert.equal(st.eliteDmg, 10 * 1.005);
  assert.equal(st.bossDmg, 10 * 1.01);

  // 6/8 轉「弒王進階/極意」與 3 轉弒王法則百分比相加後一次乘算
  c.G.player.talents.levels.t6_boss = 1;  // +1%
  c.G.player.talents.levels.t8_boss = 1;  // +4%（V3 由 5 下修）
  assert.equal(c.computeStats().bossDmg, 10 * 1.06);

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
  c.G.player.talents.levels.t1_pres = 10;  // +5%（V3 每級 0.5%）
  c.G.player.talents.levels.t9_pres = 10;  // +20%（V3 每級 2%）
  c.G.player.talents.levels.t1_mres = 10;  // +5%
  /* 全屬性抗性只有 t3_allres 與 t7_allres 兩個節點，百分比相加後對每個元素乘一次。
     ⚠️ t3_allres2「傷害緩衝」的 stat 是 globalDmgRed 不是 elemRes
     （config/CSV/Talents.csv:25，2a273a5 於 2026-07-20 改），
     原測試把它算進全屬性抗性才會期望 130，實際 125 才對。 */
  c.G.player.talents.levels.t3_allres = 10;   // +5%（V3 每級 0.5%）
  c.G.player.talents.levels.t7_allres = 10;   // +20%

  const st = c.computeStats();
  assert.equal(st.pRes, 100 * 1.25);
  assert.equal(st.mRes, 100 * 1.05);
  assert.equal(st.resist.fire, 100 * 1.25);
  assert.equal(st.resist.ice, 0); // 無來源的元素不憑空提供
});

test('物攻/魔攻天賦為「額外」獨立乘區；總傷害額外增幅寫入 totalDmgPct', () => {
  const c = statsContext();
  const base = c.computeStats();
  c.G.player.talents.levels.t7_patk = 10;      // 物攻 +5%（V3 每級 0.5%）
  c.G.player.talents.levels.t7_matk = 10;      // 魔攻 +10%
  c.G.player.talents.levels.t7_totaldmg = 10;  // 總傷害 +2.5%（V3 每級 0.25%）
  c.G.player.talents.levels.t10_totaldmg = 10; // 總傷害 +10%（每級 1%）
  const st = c.computeStats();
  assert.equal(st.atk, Math.round(base.atk * 1.05));
  assert.equal(st.matk, Math.round(base.matk * 1.05));
  assert.equal(st.totalDmgPct, 12.5);
});

test('對屬性敵人傷害天賦與詞條直接相加；對屬性敵人抗性寫入 resVsElem', () => {
  const c = statsContext();
  c.G.equipment.helmet = { affixes: [{ key: 'dmgVsFire', val: 10 }], sockets: [] };
  c.G.player.talents.levels.t6_vsfire = 10;   // +20%（V3 每級 2%）
  c.G.player.talents.levels.t8_rvsfire = 10;  // 對火屬性敵人抗性 30
  const st = c.computeStats();
  assert.equal(st.dmgVsElem.fire, 30);
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
  // 潛力 id 以 POTENTIAL_TALENTS 為準：清除只走真實存在的鍵，塞假 id 不會被清
  c.G.player.talents.levels.t1_str = 8;

  c.resetTalentsForReincarnationGM(3);

  assert.equal(c.G.player.talents.levels.t1_str, 0);
  assert.equal(c.G.player.reincarnationTalentPoints, (3 - 1) * (c.REINCARNATION_LEVEL - 1) + (Math.min(1234, c.REINCARNATION_LEVEL) - 1));

  c.G.player.level = c.REINCARNATION_LEVEL;
  c.resetTalentsForReincarnationGM(0);
  assert.equal(c.G.player.reincarnationTalentPoints, 0);
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
    assert.equal(def.per, 0.5);
    assert.equal(c.talentLevelValue(def, 5), 2.5);
    assert.equal(c.talentLevelValue(def, 10), 5);
    assert.equal(c.talentEffectDescription(def, 0.5), '攻擊時額外附加0.5%' + element + '傷害');
  }
  for (const id of ['t9_fire', 't9_ice', 't9_lightning', 't9_poison', 't9_light', 't9_dark']) {
    const def = c.talentDef(id);
    assert.equal(def.per, 2);
  }
});

function loadTalentUi(c) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8'), c);
  const tip = { innerHTML: '', style: {}, offsetWidth: 250, offsetHeight: 150 };
  c.document = { getElementById: id => id === 'sk-tooltip' ? tip : null };
  c.innerWidth = 1280; c.innerHeight = 800;
  vm.runInContext(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'), c);
  c.uiTalentPanelSnapshot = () => talentPanelSnapshot(c);
  return tip;
}
const tipAnchor = { getBoundingClientRect: () => ({ top: 100, left: 100, right: 160 }) };

test('所有威能0級Tooltip顯示1級表值與成本，圖示上不顯示名稱', () => {
  const c = loadContext(), tip = loadTalentUi(c);
  c.G.player.reincarnations = 10;
  for (const {turn, def} of c.talentList()) {
    c.showTalentTooltip(def.id, tipAnchor);
    assert.ok(tip.innerHTML.includes(c.talentEffectDescription(def, def.per)));
    assert.match(tip.innerHTML, /下一級/);
    assert.match(tip.innerHTML, /消耗 1 點威能點/);
    const node = c.talentNodeHTML(def, turn, talentPanelSnapshot(c), 0, c.TALENT_TREES[turn].length);
    assert.doesNotMatch(node, /tlx-node-name/);
    assert.match(node, /images\/skills\//);
    assert.match(node, /tlx-threat-flame/);
  }
});

test('天賦與潛力圖示使用正式 tooltip，不再使用原生 title 提示', () => {
  const c = loadContext();
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  c.document = { getElementById: () => null };
  vm.runInContext(ui, c, { filename: 'js/ui.js' });
  c.G.player.reincarnations = 10;
  const snapshot = talentPanelSnapshot(c);
  const headerSnapshot = { player: { level: c.REINCARNATION_LEVEL || 9999, reincarnations: 10 } };
  const talentHtml = c.talentNodeHTML(c.talentDef('t5_fire'), 5, snapshot);

  assert.match(talentHtml, /data-talent-tip="t5_fire"/);
  assert.doesNotMatch(talentHtml, /\stitle=/);
  assert.match(ui, /function showTalentTooltip\(ref, anchorEl\)/);
  assert.match(ui, /showTalentTooltip\(talentTipHover\.getAttribute\('data-talent-tip'\), talentTipHover\)/);
});

test('滿級Tooltip隱藏下一級及成本；圖下可降級但不可升級', () => {
  const c = loadContext(), tip = loadTalentUi(c);
  c.G.player.reincarnations = 2;
  c.G.player.talents.levels.t2_crit = 10;
  c.UI.selTalent = { kind: 'talent', id: 't2_crit' };
  c.showTalentTooltip('t2_crit', tipAnchor);
  assert.match(tip.innerHTML, /已達最高等級/);
  assert.doesNotMatch(tip.innerHTML, /下一級：|消耗.*點威能點/);
  const h = c.talentInlineActionsHTML(c.talentDef('t2_crit'), talentPanelSnapshot(c));
  assert.match(h, /data-talent-up="t2_crit"[^>]* disabled/);
  assert.doesNotMatch(h, /data-talent-down="t2_crit"[^>]* disabled/);
});

test('傷害偏折/絕對偏折為乘算：全局減傷 = 裝備總值 × (1 + 天賦%/100)', () => {
  const c = loadContext();
  c.itemEnchants = () => []; // itemEnchants 定義於 js/item.js，此測試環境未載入
  c.G.player.level = 1;
  c.G.player.reincarnations = 10;
  c.G.equipment = c.SLOT_LIST.reduce((eq, slot) => { eq[slot] = null; return eq; }, {});
  c.G.equipment.helmet = { affixes: [{ key: 'globalDmgRed', val: 1000 }], sockets: [] };

  // 固定每級增加值，不再分高低階。
  assert.equal(c.talentDef('t5_global').per, 1);
  assert.equal(c.talentDef('t7_global').per, 2);

  // 無天賦：純裝備定值
  assert.equal(c.computeStats().globalDmgRed, 1000);

  // 傷害偏折十級＝ +10%。
  c.G.player.talents.levels.t5_global = 10;
  assert.equal(c.computeStats().globalDmgRed, 1100);

  // 疊加絕對偏折十級的 +20%，百分比相加。
  c.G.player.talents.levels.t7_global = 10;
  assert.equal(c.computeStats().globalDmgRed, 1300);

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

  // 物防鍛體 Lv.10（+5%，V3 每級 0.5%）：與裝備連乘 ×2×1.05，且不影響魔防
  c.G.player.talents.levels.t1_def = 10;
  const withDef = c.computeStats();
  assert.equal(withDef.def, Math.round(withDef.base.def * 2 * 1.05));
  assert.equal(withDef.mdef, Math.round(withDef.base.mdef));

  // 魔防鍛體 Lv.10（+5%）：乘算到魔防
  c.G.player.talents.levels.t1_mdef = 10;
  const withMdef = c.computeStats();
  assert.equal(withMdef.mdef, Math.round(withMdef.base.mdef * 1.05));
  assert.equal(withMdef.def, Math.round(withMdef.base.def * 2 * 1.05));

  // 1 轉與 3 轉同屬性百分比相加後才乘算：t1_def 5% + t3_def 5% → ×1.1
  c.G.player.reincarnations = 3;
  c.G.player.talents.levels.t3_def = 10;
  const stacked = c.computeStats();
  assert.equal(stacked.def, Math.round(stacked.base.def * 2 * 1.1));
});

test('爆擊/閃避/命中威能與屬性加成直接相加；爆傷每級75', () => {
  const c = loadContext();
  c.itemEnchants = () => [];
  c.G.player.level = 1;
  c.G.player.reincarnations = 10;
  c.G.equipment = c.SLOT_LIST.reduce((eq, slot) => { eq[slot] = null; return eq; }, {});

  assert.equal(c.talentDef('t2_critdmg').per, 75);

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

test('直接升降級依成本、鎖定、滿級與pending停用，不顯示舊彈窗', () => {
  const c = loadContext(); loadTalentUi(c);
  const def = c.talentDef('t6_boss');
  c.UI.selTalent = { kind:'talent', id:def.id };
  const html = () => c.talentInlineActionsHTML(def, talentPanelSnapshot(c));
  c.G.player.reincarnations = 5; c.G.player.reincarnationTalentPoints = 99;
  assert.match(html(), /data-talent-up="t6_boss"[^>]* disabled/);
  assert.match(html(), /data-talent-down="t6_boss"[^>]* disabled/);
  c.G.player.reincarnations = 6;
  assert.doesNotMatch(html(), /data-talent-up="t6_boss"[^>]* disabled/);
  c.G.player.talents.levels.t6_boss = 9; c.G.player.reincarnationTalentPoints = 9;
  assert.match(html(), /需要 10 點/); assert.match(html(), /data-talent-up="t6_boss"[^>]* disabled/);
  c.G.player.reincarnationTalentPoints = 10;
  assert.doesNotMatch(html(), /data-talent-up="t6_boss"[^>]* disabled/);
  c.isUiCommandPending = () => true;
  assert.match(html(), /data-talent-up="t6_boss"[^>]* disabled/);
  assert.match(html(), /data-talent-down="t6_boss"[^>]* disabled/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'index.html'),'utf8'), /id="talent-modal/);
  assert.equal(c.renderTalentModal, undefined);
  c.isUiCommandPending = () => false;
  c.bossFightConfigLocked = () => true;
  assert.match(html(), /BOSS 戰中不可變更戰鬥配置/);
  assert.match(html(), /data-talent-up="t6_boss"[^>]* disabled/);
  assert.match(html(), /data-talent-down="t6_boss"[^>]* disabled/);
});

test('各轉全滿與差一級僅增加該級表值，UI快照與實際加成一致', () => {
  const c = loadContext(); loadTalentUi(c);
  c.G.player.reincarnations = 10;
  for (const [turn, tree] of Object.entries(c.TALENT_TREES)) {
    c.G.player.talents.levels = {};
    for (const def of tree) c.G.player.talents.levels[def.id] = 10;
    const full = c.talentStatBonuses();
    for (const def of tree) {
      assert.equal(c.talentDescriptionValue(def,10,+turn,talentPanelSnapshot(c)), def.per*10);
      c.G.player.talents.levels[def.id] = 9;
      const almost = c.talentStatBonuses();
      assert.ok(Math.abs(full[def.stat]-almost[def.stat]-def.per) < 1e-8, def.id);
      c.G.player.talents.levels[def.id] = 10;
    }
    assert.doesNotMatch(c.talentBoardHTML(+turn,talentPanelSnapshot(c)) + c.talentEffectsHTML(+turn,talentPanelSnapshot(c)), /×2|加倍/);
  }
});
