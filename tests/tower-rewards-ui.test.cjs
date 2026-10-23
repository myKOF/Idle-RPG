'use strict';
const test = require('node:test');
const { readExpanded } = require('./helpers/str-expand.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadEliteEnv } = require('./helpers/elite-env.cjs');
const root = path.resolve(__dirname, '..');
const ui = readExpanded(path.join(root, 'js/ui.js'));

function uiContext() {
  const c = loadEliteEnv();
  c.UI.towerBrowse = { tier: 'trial', sel: 35 };
  c.towerBossImageFailed = () => false;
  c.uiTalentPanelSnapshot = () => ({});
  c.talentViewLevels = () => ({});
  c.talentThreatTotal = () => 0;
  for (const name of ['towerTiers', 'towerTierOf', 'towerBossOf', 'towerBossIconHTML',
    'towerRewardRows', 'towerEquipDropRows', 'towerFloorRowHTML', 'towerDetailHTML']) {
    const start = ui.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    vm.runInContext(ui.slice(start, ui.indexOf('\n}', start) + 2), c);
  }
  return c;
}

for (const floor of [1, 35, 51, 101, 150]) {
  test(`第${floor}層首通與重複通關皆只扣挑戰費、不給金幣或記錄金幣掉落`, () => {
    const c = loadEliteEnv();
    c.G.player.gold = 1e14;
    c.G.tower.highest = floor - 1;
    c.showTowerResultModal = () => {};
    const goldEvents = [];
    c.recordLootGold = (...args) => goldEvents.push(args);
    for (const firstClear of [true, false]) {
      const goldBefore = c.G.player.gold;
      const essenceBefore = c.G.player.essence;
      const reward = c.towerRewardFor(floor, firstClear);
      c.startTowerFight(floor);
      assert.equal(c.G.tower.active, true);
      assert.equal(c.G.player.gold, goldBefore - c.towerChallengeCost(floor));
      // 模擬已擊殺的終態，僅測結算，不觸發BOSS免死／復活技能。
      c.TOWER.boss = { hp: 0, maxHp: 100, xp: 10 };
      c.endTowerFight(true);
      assert.equal(c.TOWER.result.win, true);
      assert.equal(c.G.tower.highest, floor);
      assert.equal(c.G.player.gold, goldBefore - c.towerChallengeCost(floor));
      assert.equal(c.G.player.essence, essenceBefore + reward.essence);
      assert.doesNotMatch(c.TOWER.result.rewards.join('、'), /金幣|首通.*倍/);
      assert.ok(c.TOWER.result.rewards.some(s => s.includes('經驗')));
      assert.ok(c.TOWER.result.rewards.some(s => s.includes('附魔精華')));
      c.confirmTowerResult();
      assert.equal(c.G.tower.active, false);
    }
    assert.deepEqual(goldEvents, []);
  });
}

test('全塔樓層不再有BOSS hover或技能施放說明，顯示正式配置的真言等級與名稱', () => {
  const c = uiContext();
  for (let floor = 1; floor <= c.TOWER_MAX_FLOOR; floor++) {
    const row = c.towerFloorRowHTML(floor, floor - 1);
    const html = c.towerDetailHTML(floor, floor - 1);
    assert.match(row, /role="button" tabindex="0"/);
    assert.match(row, new RegExp('data-tower-pick="' + floor + '"'));
    assert.doesNotMatch(row, /data-tower-tip|data-tip|title=/);
    assert.doesNotMatch(html, /twx-boss-skillnote|BOSS 專屬技能|BOSS 每場隨機|BOSS 額外隨機|首通.*倍/);
    for (const word of c.RUNEWORDS.filter(w => w.towerUnlockFloor === floor)) {
      assert.ok(html.includes('第 ' + word.tier + ' 級（' + c.RUNEWORD_TIER_NAMES[word.tier] + '）【' + word.name + '】'));
    }
    assert.equal(html.includes('twx-word-unlocks'), c.RUNEWORDS.some(w => w.towerUnlockFloor === floor));
    const labels = c.towerRewardRows(floor).map(r => r.label);
    assert.ok(!labels.includes('金幣') && !labels.includes('符文'));
    assert.ok(labels.includes('經驗') && labels.includes('附魔精華') && labels.includes('隨機寶石'));
  }
  assert.doesNotMatch(ui, /showTowerTooltip|data-tower-tip/);
});

test('同層多個真言完整列出，停用／非整數門檻不顯示，原技能解鎖保留', () => {
  const c = uiContext();
  c.RUNEWORDS = [
    { name: '第一真言', tier: 1, towerUnlockFloor: 35 },
    { name: '第二真言', tier: 4, towerUnlockFloor: 35 },
    { name: '停用', tier: 1, towerUnlockFloor: 0 },
    { name: '留白', tier: 1, towerUnlockFloor: '' },
    { name: '非整數', tier: 1, towerUnlockFloor: 35.5 },
    { name: '未來', tier: 1, towerUnlockFloor: 151 }
  ];
  c.skills2TowerUnlocks = () => ['烈陽星環'];
  const html = c.towerDetailHTML(35, 34);
  assert.match(html, /第 1 級.*第一真言/);
  assert.match(html, /第 4 級.*第二真言/);
  assert.doesNotMatch(html, /停用|留白|非整數|未來/);
  assert.match(html, /解鎖【烈陽星環】技能/);
  assert.doesNotMatch(c.towerDetailHTML(36, 35), /twx-word-unlocks/);
});

test('附魔功能開啟時仍有附魔書獎勵，關閉時不以符文說明替代', () => {
  const c = uiContext();
  c.ENCHANT_ENABLED = true;
  assert.ok(c.towerRewardRows(35).some(r => r.label === '附魔書'));
  c.ENCHANT_ENABLED = false;
  assert.ok(c.towerRewardRows(35).every(r => r.label !== '附魔書' && r.label !== '符文'));
});
