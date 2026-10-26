'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createEngine } = require('../scripts/sim/engine');
const tables = require('../tools/config_tables.cjs');
const root = path.resolve(__dirname, '..');
const plain = x => JSON.parse(JSON.stringify(x));
function setup() {
  const e = createEngine({ seed: 42 }).boot(null), c = e.ctx;
  c.G.player.level = 1000;
  c.G.player.reincarnations = 0;
  c.G.player.skillMastery = { level: 480, xp: 0 };
  c.G.player.gold = 1e12;
  c.G.player.skills2 = { levels: { thrust: Array(7).fill(10) }, ult: {} };
  c.G.tower.highest = 29;
  return { e, c };
}
function uiContext() {
  const c = vm.createContext({ console, Math, setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } });
  c.window = c;
  for (const file of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'battlefield', 'skills', 'skills2', 'talents', 'ui']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), c);
  }
  c.pendingUiButtonAttributes = () => '';
  c.nodePendingKey = () => '';
  return c;
}
function snap(c, floor) {
  return { skills2: { levels: { thrust: Array(7).fill(10) }, ult: {},
    progress: { level: 1000, reinc: 0, towerHighest: floor } }, loadout: [] };
}
function rebuilt(rows) {
  return tables.SCHEMAS.Skills2.rebuild(rows.slice(1), rows[0]);
}
const csvRows = () => tables.csvParse(fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8'));

test('配置接受兩段、三段、尾段留白與整格留白；非法格式拒絕，不丟掉超神門檻', () => {
  const rows = csvRows(), col = rows[0].indexOf('解鎖轉生/等級/封魔塔層級');
  assert.ok(col >= 0);
  const ri = rows.findIndex(r => r[rows[0].indexOf('群組ID')] === 'thrust' && r[rows[0].indexOf('階數')] === '8');
  for (const [value, expected] of [['10|50|80', { reinc: 10, lv: 50, tower: 80 }],
    ['10|50', { reinc: 10, lv: 50 }], ['10|50|', { reinc: 10, lv: 50 }], ['', undefined]]) {
    rows[ri][col] = value;
    const ctx = vm.createContext({});
    vm.runInContext(rebuilt(rows).SKILLS2, ctx);
    assert.deepEqual(ctx.SKILLS2.thrust.ult[0].unlock && plain(ctx.SKILLS2.thrust.ult[0].unlock), expected);
  }
  for (const value of ['10|50|-1', '10|50|1.5', '10|50|abc', '10|50|80|90', '10||80']) {
    rows[ri][col] = value;
    assert.throws(() => rebuilt(rows), /必須是/);
  }
  rows[ri][col] = '10|50|80';
  for (const alias of ['解鎖轉生/等級', '解鎖轉生/等級/封魔塔等級']) {
    rows[0][col] = alias;
    const ctx = vm.createContext({});
    vm.runInContext(rebuilt(rows).SKILLS2, ctx);
    assert.equal(ctx.SKILLS2.thrust.ult[0].unlock.tower, 80);
  }
});

test('Excel／CSV資料一致；全部69個超神選項的限制在匯入及反向匯出完整保留', () => {
  const { c } = setup(), rows = csvRows();
  const excelRows = tables.readXlsxRows(path.join(root, 'config/Excel/Skills2.xlsx'), 'Skills2');
  assert.deepEqual(excelRows.map(r => r.map(String)), rows.map(r => r.map(String)));
  const exported = tables.SCHEMAS.Skills2.extract(fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8'));
  const exportCol = tables.SCHEMAS.Skills2.header.indexOf('解鎖轉生/等級/封魔塔層級');
  let count = 0;
  for (const [gid, g] of Object.entries(c.SKILLS2)) for (const [idx, opt] of g.ult.entries()) {
    const row = rows.find(r => r[0] === gid && r[rows[0].indexOf('階數')] === String(8 + idx));
    const cell = row[rows[0].indexOf('解鎖轉生/等級/封魔塔層級')];
    const [reinc, lv, tower] = cell.split('|').map(Number);
    assert.deepEqual(plain(opt.unlock), { reinc, lv, tower });
    const out = exported.find(r => r[0] === gid && r[7] === String(8 + idx));
    assert.equal(out[exportCol], cell);
    count++;
  }
  assert.equal(count, 69);
});

test('轉生優先只放寬人物門檻，封魔塔仍獨立要求；普通階快取隨最高層及表值失效', () => {
  const { c } = setup();
  const need = { reinc: 10, lv: 50, tower: 80 };
  assert.equal(c.sgTierUnlockedBy(need, 1, 11, 79), false);
  assert.equal(c.sgTierUnlockedBy(need, 1, 11, 80), true);
  assert.equal(c.sgTierUnlockedBy(need, 49, 10, 80), false);
  assert.equal(c.sgTierUnlockedBy(need, 50, 10, 80), true);
  c.SKILLS2.thrust.tiers[0].unlock.tower = 30;
  assert.equal(c.skills2Levels('thrust')[0], 0);
  c.G.tower.highest = 30;
  assert.equal(c.skills2Levels('thrust')[0], 10);
  c.SKILLS2.thrust.tiers[0].unlock.tower = 31;
  assert.equal(c.skills2Levels('thrust')[0], 0);
  assert.equal(c.G.player.skills2.levels.thrust[0], 10);
});

test('Worker選擇／切換／升級／一鍵滿級都擋門檻，拒絕時金幣與舊投資不變', () => {
  const { e, c } = setup(), gold = c.G.player.gold;
  assert.match(e.cmd('skill2.ultPick', { group: 'thrust', opt: 0 }).result, /第30層/);
  assert.equal(c.G.player.gold, gold);
  c.G.tower.highest = 30;
  assert.equal(e.cmd('skill2.ultPick', { group: 'thrust', opt: 0 }).result, null);
  const before = plain(c.G.player.skills2), cash = c.G.player.gold;
  const a = { group: 'thrust', opt: 1, fromOpt: 0, fromLv: 1, cost: c.skills2UltCost('thrust', 1, 0) };
  assert.match(e.cmd('skill2.ultSwitch', a).result, /第60層/);
  assert.deepEqual(plain(c.G.player.skills2), before);
  assert.equal(c.G.player.gold, cash);
  c.G.tower.highest = 29;
  assert.match(e.cmd('skill2.learn', { group: 'thrust', tier: c.SG_ULT_SLOT }).result, /第30層/);
  assert.match(e.cmd('skill2.max', { group: 'thrust', tier: c.SG_ULT_SLOT }).result.err, /第30層/);
  assert.equal(c.G.player.gold, cash);
  assert.deepEqual(plain(c.G.player.skills2), before);
  c.G.tower.highest = 60;
  assert.equal(e.cmd('skill2.ultSwitch', a).result, null);
  assert.equal(c.skills2Ult('thrust').id, 'shadowExecutioner');
});

test('舊超神投資未通關時不生效且不刪除；通關後同一存檔恢復，MP與UI一致', () => {
  const { e, c } = setup();
  c.G.player.skills2.ult.thrust = { pick: 0, lv: 4 };
  assert.equal(c.skills2Ult('thrust'), null);
  assert.equal(c.skills2ManaCost('thrust'), 3000);
  const low = plain(e.panel('skills'));
  assert.equal(low.skills2.progress.towerHighest, 29);
  const u = uiContext();
  assert.equal(u.sgUiUltUnlocked('thrust', u.sgUiLevels(low, 'thrust'), low), false);
  assert.equal(u.skills2ManaCost('thrust', u.sgUiLevels(low, 'thrust'), low.skills2.ult, low.skills2.progress), 3000);
  c.G.tower.highest = 30;
  assert.equal(c.skills2Ult('thrust').lv, 4);
  assert.equal(c.skills2ManaCost('thrust'), 10000);
  const high = plain(e.panel('skills'));
  assert.equal(u.sgUiUltUnlocked('thrust', u.sgUiLevels(high, 'thrust'), high), true);
  assert.equal(u.skills2ManaCost('thrust', u.sgUiLevels(high, 'thrust'), high.skills2.ult, high.skills2.progress), 10000);
  assert.deepEqual(plain(c.G.player.skills2.ult.thrust), { pick: 0, lv: 4 });
});

test('普通階一鍵滿級也檢查塔層，第三段不填仍可正常投資', () => {
  const { e, c } = setup();
  c.SKILLS2.thrust.tiers[1].unlock.tower = 30;
  const gold = c.G.player.gold;
  assert.match(e.cmd('skill2.max', { group: 'thrust', tier: 1 }).result.err, /第30層/);
  assert.equal(c.G.player.gold, gold);
  delete c.SKILLS2.thrust.tiers[1].unlock.tower;
  c.G.player.skills2.levels.thrust[1] = 1;
  assert.equal(e.cmd('skill2.max', { group: 'thrust', tier: 1 }).result, true);
  assert.equal(c.skills2Levels('thrust')[1], 10);
});

test('超神人物等級與轉生門檻也有效；選項整格留白不附加進度限制', () => {
  const { e, c } = setup();
  c.G.tower.highest = 150;
  c.SKILLS2.thrust.ult[0].unlock = { reinc: 0, lv: 1001 };
  assert.match(e.cmd('skill2.ultPick', { group: 'thrust', opt: 0 }).result, /1001 級/);
  c.G.player.reincarnations = 1;
  assert.equal(e.cmd('skill2.ultPick', { group: 'thrust', opt: 0 }).result, null);
  delete c.SKILLS2.thrust.ult[1].unlock;
  c.G.tower.highest = 0;
  assert.equal(e.cmd('skill2.ultSwitch', { group: 'thrust', opt: 1, fromOpt: 0, fromLv: 1,
    cost: c.skills2UltCost('thrust', 1, 0) }).result, null);
});

test('實際首通更新最高層、技能快照及屬性快取，已保留的超神即時恢復', () => {
  const { c } = setup();
  c.G.player.skills2.ult.thrust = { pick: 0, lv: 3 };
  c.startTowerFight(30);
  assert.equal(c.G.tower.active, true);
  assert.equal(c.skills2Ult('thrust'), null);
  c.UI.dirty.skills = false;
  c._statsCache = { stale: true };
  c.TOWER.boss.hp = 0;
  c.endTowerFight(true);
  assert.equal(c.G.tower.highest, 30);
  assert.equal(c.UI.dirty.skills, true);
  assert.equal(c._statsCache && c._statsCache.stale, undefined);
  assert.equal(c.skills2PanelView().progress.towerHighest, 30);
  assert.equal(c.skills2Ult('thrust').lv, 3);
});

test('各選項UI獨立鎖定；Tips末行橘色與通關灰色小字，三選一不誤啟用', () => {
  const c = uiContext(), low = snap(c, 30);
  c.UI.sgBrowse.focus = 'ult'; c.UI.sgBrowse.ultFocus = 1;
  const h = c.sgbUltHTML('thrust', Array(7).fill(10), low, 1e12, '');
  assert.match(h, /幻影八方陣<\/b><span>可選擇/);
  assert.match(h, /暗影絕殺者<\/b><span>未開放/);
  assert.doesNotMatch(h, /data-skill2-ultpick=/);
  const locked = c.skill2UltOptionTooltipHTML('thrust', 1, low);
  assert.ok(locked.endsWith('<div class="skill-tower-hint">需通關封魔塔第60層解鎖</div>'));
  const clear = c.skill2UltOptionTooltipHTML('thrust', 1, snap(c, 60));
  assert.ok(clear.endsWith('<div class="skill-tower-hint is-cleared">已通行封魔塔第60層</div>'));
  assert.equal(c.skillTowerUnlockHintHTML({ unlock: { reinc: 0, lv: 1 } }, low), '');
  const css = fs.readFileSync(path.join(root, 'css/ashen-forge.css'), 'utf8');
  assert.match(css, /\.skill-tower-hint \{[^}]*color: #ffab54;[^}]*font-size: 13px/);
  assert.match(css, /\.skill-tower-hint\.is-cleared \{[^}]*color: #999;[^}]*font-size: 11px/);
});

test('塔BOSS獎勵最下方獨立框支援同層多技能，沒有解鎖技能完全隱藏', () => {
  const c = uiContext();
  c.SKILLS2.thrust.ult[1].unlock.tower = 30;
  const h = c.towerDetailHTML(30, 29);
  assert.match(h, /<div class="twx-skill-unlocks">/);
  assert.match(h, /解鎖【幻影八方陣】技能/);
  assert.match(h, /解鎖【暗影絕殺者】技能/);
  assert.ok(h.indexOf('twx-skill-unlocks') > h.indexOf('BOSS 裝備'));
  assert.doesNotMatch(c.towerDetailHTML(1, 0), /twx-skill-unlocks/);
});
