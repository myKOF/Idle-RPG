/* 成就系統（2026-10-31）回歸測試
   涵蓋：
   1. 配置表：CSV 與 js/achievement_data.js 語意一致、圖示不重複、目標類型都有判定、skillUlt 參照 Skills2 真實存在
   2. newGameState 含 achv；存檔防呆
   3. achProgress：品質穿滿（神鑄神話以神話計）、強化／太古／鑲嵌、寶石、累計統計、轉生、封魔塔、威能、技能超神
   4. achCheck：達成後永久保留（條件消失也不撤銷）、只解鎖一次、achPanelData 投影
   5. 累計金幣／符文製作／神鑄統計的掛點存在於各來源檔 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const contextFiles = [
  'js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/achievement_data.js', 'js/runeword_data.js', 'js/status.js', 'js/formula.js',
  'js/item.js', 'js/runeword.js', 'js/skills.js', 'js/skills2.js', 'js/talents.js', 'js/player.js', 'js/factory.js', 'js/newforge.js', 'js/save.js',
  'js/tasks.js', 'js/achievements.js'
];

function loadContext() {
  const logs = [], events = [];
  const context = { console, Math, UI: { dirty: {} }, blog: (m) => logs.push(m), flog: () => {}, shimPushEvent: (k, d) => events.push({ k, d }) };
  context.window = context;
  vm.createContext(context);
  contextFiles.forEach((file) => vm.runInContext(read(file), context, { filename: file }));
  context.G = context.newGameState();
  context.__logs = logs; context.__events = events;
  return context;
}
const def = (c, id) => c.ACHIEVEMENTS.find((a) => a.id === id);

function csvRows() {
  const tool = require(path.join(root, 'tools/config_tables.cjs'));
  const rows = tool.csvParse(read('config/CSV/Achievement.csv')).filter((r) => r.length > 1);
  return { tool, rows };
}

/* ---- 1. 配置表 ---- */
test('Achievement：CSV 與 achievement_data.js 語意一致', () => {
  const { tool, rows } = csvRows();
  const rebuilt = tool.SCHEMAS.Achievement.rebuild(rows.slice(1), rows[0]);
  const fresh = tool.evalLiteral(tool.extractLiteral(rebuilt.ACHIEVEMENTS, 'ACHIEVEMENTS').literal);
  const c = loadContext();
  assert.deepEqual(JSON.parse(JSON.stringify(c.ACHIEVEMENTS)), JSON.parse(JSON.stringify(fresh)));
  assert.equal(c.ACHIEVEMENTS.length, 115);
});

test('Achievement：編號與圖示不重複、類型都有判定、技能成就參照真實超神', () => {
  const c = loadContext();
  const ids = new Set(), icons = new Set();
  c.ACHIEVEMENTS.forEach((a) => {
    assert.ok(!ids.has(a.id), '編號重複 ' + a.id); ids.add(a.id);
    assert.ok(!icons.has(a.icon), '圖示重複 ' + a.icon); icons.add(a.icon);
    assert.ok(a.name && a.desc, a.id + ' 缺名稱或條件');
    c.G.player.skills2 = { levels: {}, ult: {} };
    const r = c.achProgress(a);   // 不得拋例外
    assert.ok(Number.isFinite(r.prog) && Number.isFinite(r.goal), a.id + ' 進度不是有限數');
    if (a.type === 'skillUlt') {
      const [gid, uid] = a.param.split(':');
      assert.ok(c.SKILLS2[gid] && c.SKILLS2[gid].ult.some((u) => u.id === uid), a.id + ' 超神不存在：' + a.param);
    }
  });
  const skillIds = new Set(c.ACHIEVEMENTS.filter((a) => a.type === 'skillUlt').map((a) => a.param));
  assert.equal(skillIds.size, 66, '技能成就 66 個且彼此不同');
});

test('Achievement：圖示檔案齊全（images/achievements/<圖示>.png）', { skip: !fs.existsSync(path.join(root, 'images/achievements')) }, () => {
  const c = loadContext();
  const missing = c.ACHIEVEMENTS.filter((a) => !fs.existsSync(path.join(root, 'images/achievements', a.icon + '.png'))).map((a) => a.icon);
  assert.deepEqual(missing, []);
});

/* ---- 2. 存檔 ---- */
test('newGameState：achv 預設；migrateSave 補齊壞掉的 achv', () => {
  const c = loadContext();
  assert.deepEqual(JSON.parse(JSON.stringify(c.G.achv)), { got: {}, st: {} });
  const save = JSON.parse(JSON.stringify(c.newGameState()));
  save.achv = { got: [], st: 5 };
  const out = c.migrateSave(save);
  const data = out && out.data ? out.data : (out || save);
  assert.ok(data.achv && typeof data.achv.got === 'object' && !Array.isArray(data.achv.got));
  assert.equal(typeof data.achv.st, 'object');
});

/* ---- 3. 進度 ---- */
test('achProgress：品質穿滿以品質換算，神鑄神話以神話計', () => {
  const c = loadContext();
  const eq = c.G.equipment;
  c.SLOT_LIST.forEach((slot) => {
    if (slot === 'weapon' || slot === 'weapon2') return;
    eq[slot] = c.makeEquipment(1, { slot: slot.replace(/2$/, ''), rarity: 6, level: 1 });
    eq[slot].slot = slot.replace(/2$/, '');
  });
  eq.weapon = c.makeEquipment(1, { slot: 'weapon', rarity: 6, level: 1, weaponType: 'greatsword2h' });
  assert.equal(c.achProgress(def(c, 5)).prog, 13, '神話 13 格');
  assert.equal(c.achProgress(def(c, 6)).prog, 0, '創世 0 格');
  const head = eq[c.SLOT_LIST.find((s) => s !== 'weapon' && s !== 'weapon2')];
  head.rarity = 11;   // 神鑄神話：以神話計
  assert.equal(c.achProgress(def(c, 5)).prog, 13);
  assert.equal(c.achProgress(def(c, 6)).prog, 0);
  head.rarity = 10;   // 神鑄混沌
  assert.equal(c.achProgress(def(c, 7)).prog, 1);
});

test('achProgress：強化、寶石、神鑄裝備、雙傳奇', () => {
  const c = loadContext();
  const it = c.makeEquipment(1, { rarity: 5 });
  it.upgrade = 60;
  c.G.inventory.push(it);
  assert.equal(c.achProgress(def(c, 12)).prog, 60);
  assert.equal(c.achProgress(def(c, 13)).prog, 60);
  assert.equal(c.achProgress(def(c, 23)).prog, 0);
  c.G.inventory.push(c.makeEquipment(1, { rarity: 8 }));
  assert.equal(c.achProgress(def(c, 23)).prog, 1);
  it.passive = { key: Object.keys(c.PASSIVE_POOL)[0] };
  it.imprint = { kind: 'legendary', passive: { key: Object.keys(c.PASSIVE_POOL)[1] } };
  assert.equal(c.achProgress(def(c, 26)).prog, 1);
  c.addGem('ruby', 10, 1);
  assert.equal(c.achProgress(def(c, 20)).prog, 10);
  const all = c.achProgress(def(c, 21));
  assert.equal(all.prog, 1);
  assert.ok(all.goal > 1);
  c.G.player.fusedGems = [{ id: 'x', divine: true }];
  assert.equal(c.achProgress(def(c, 22)).prog, 1);
});

test('achProgress：累計統計與現況數值', () => {
  const c = loadContext();
  c.G.factory.stats.rerolled = 20000;
  assert.equal(c.achProgress(def(c, 17)).prog, 20000);
  c.achAddGold(5e13); c.achAddGold(5e13);
  assert.equal(c.achProgress(def(c, 30)).prog, 1e14);
  c.achAddGold(-5); c.achAddGold(0);
  assert.equal(c.achProgress(def(c, 30)).prog, 1e14, '非正數不計');
  c.G.player.reincarnations = 3;
  assert.equal(c.achProgress(def(c, 37)).prog, 3);
  assert.equal(c.achProgress(def(c, 9)).prog >= c.REINCARNATION_LEVEL, true, '轉生過＝等級達標');
  c.G.tower.highest = 77;
  assert.equal(c.achProgress(def(c, 45)).prog, 77);
  assert.equal(c.achProgress(def(c, 48)).prog, 100, '沒點威能＝100%');
  c.achNoteRune('r33');
  assert.equal(c.achProgress(def(c, 33)).prog, 1);
});

test('achProgress：技能超神需選中那一個且等級足夠', () => {
  const c = loadContext();
  const a = def(c, 50);
  assert.equal(a.param, 'knife:petalStorm');
  c.G.player.skills2 = { levels: {}, ult: { knife: { pick: 1, lv: 10 } } };
  assert.equal(c.achProgress(a).prog, 0, '選的是別的超神');
  const idx = c.sgUltIndexOfId('knife', 'petalStorm');
  c.G.player.skills2.ult.knife = { pick: idx, lv: 7 };
  assert.equal(c.achProgress(a).prog, 7);
  c.G.player.skills2.ult.knife.lv = 10;
  assert.equal(c.achProgress(a).prog, 10);
});

/* ---- 4. 判定與永久保留 ---- */
test('achCheck：達成即永久保留、不重複解鎖，面板投影帶達成時間', () => {
  const c = loadContext();
  c.G.player.reincarnations = 2;
  const n = c.achCheck();
  assert.ok(n >= 3, '1轉2轉＋等級類同時解鎖');
  const first = c.G.achv.got[35];
  assert.ok(first > 0);
  assert.equal(c.achCheck(), 0, '第二次不再解鎖');
  assert.equal(c.__events.filter((e) => e.k === 'notice' && e.d.key === 'achievementUnlocked').length, n);
  c.G.player.reincarnations = 0;   // 條件消失
  c.G.player.level = 1;
  c.achCheck();
  assert.equal(c.G.achv.got[35], first, '不撤銷');
  const panel = c.achPanelData();
  assert.equal(panel.list.length, 115);
  assert.equal(panel.got, Object.keys(c.G.achv.got).length);
  const row = panel.list.find((r) => r.id === 35);
  assert.equal(row.at, first);
  assert.equal(row.prog, row.goal, '已達成的顯示滿進度');
  assert.ok(c.__logs.some((m) => m.includes(def(c, 35).name)));
});

test('achTick：每 ACH_CHECK_SEC 秒才掃一次', () => {
  const c = loadContext();
  c.G.player.reincarnations = 1;
  c.achTick(0.4); c.achTick(0.4);
  assert.equal(c.G.achv.got[35], undefined);
  c.achTick(0.4);
  assert.ok(c.G.achv.got[35] > 0);
});

/* ---- 5. 累計統計的掛點 ---- */
test('累計統計掛點：金幣來源、符文製作、神鑄／精鑄／刻印、轉生前結算', () => {
  assert.match(read('js/combat.js'), /achAddGold\(goldGain\)/);
  assert.match(read('js/factory.js'), /achAddGold\(res\.gold\)/);
  assert.match(read('js/save.js'), /achAddGold\(gold\)/);
  assert.match(read('js/runeword.js'), /achNoteRune\(next\.id\)/);
  const forge = read('js/forge.js');
  assert.match(forge, /achAddStat\('divineConsumed', items\.length\)/);
  assert.match(forge, /achAddStat\('divineConsumed', lost\)/);
  assert.match(forge, /achAddStat\('ancientCast', 1\)/);
  assert.match(forge, /achAddStat\('imprint', 1\)/);
  assert.match(read('js/player.js'), /achCheck\(\);/);
  assert.match(read('js/worker/sim.worker.js'), /achTick\(dt\)/);
});

test('UI 接線：Esc 菜單按鈕、成就頁、面板訂閱、解鎖提示', () => {
  const html = read('index.html');
  assert.match(html, /id="game-menu-achv"/);
  assert.match(html, /id="achv-modal"/);
  assert.match(html, /js\/achievement_data\.js\?v=/);
  assert.match(html, /js\/ui-achievements\.js\?v=/);
  assert.ok(html.indexOf('src="js/ui.js?v=') < html.indexOf('src="js/ui-achievements.js?v='));
  assert.match(read('js/game-menu.js'), /openAchievements/);
  assert.match(read('js/ui.js'), /achievementUnlocked/);
  assert.match(read('js/ui.js'), /UI\.achvPanelOpen\) include\(\['achv'\]\)/);
});
