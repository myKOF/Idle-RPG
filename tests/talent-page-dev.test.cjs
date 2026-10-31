'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine.js');

function engine(host = 'localhost') {
  const e = createEngine({ seed: 17 }); e.boot(null);
  e.ctx.location = { hostname: host, protocol: 'http:' };
  e.ctx.G.player.reincarnations = 6;
  return e;
}
function pageLevels(c, turn) {
  return c.TALENT_TREES[turn].filter(d => !d.disabled).map(d => c.talentLevel(d.id));
}
function ui(e) {
  const c = e.ctx, root = { innerHTML: '' };
  c.document = { getElementById: id => id === 'talent-root' ? root : null };
  vm.runInContext(fs.readFileSync('js/ui.js', 'utf8'), c);
  c.uiTalentPanelSnapshot = () => e.panel('talents');
  c.uiHeaderPanelSnapshot = () => e.panel('header');
  c.uiTowerPanelSnapshot = () => e.panel('tower');
  c.UI.talentBrowse.turn = 2;
  return root;
}

test('目前頁直接全滿／歸零，不扣退金幣、不改其他頁，效果及威脅同步且可存讀', () => {
  const e = engine(), c = e.ctx;
  c.G.player.gold = 0;
  c.G.player.talents.levels.t1_str = 3;
  const before = c.talentStatBonuses();
  assert.equal(e.cmd('talent.devSetPage', { turn: 2, full: true }).result, null);
  assert.ok(pageLevels(c, 2).every(l => l === c.TALENT_MAX_LEVEL));
  assert.equal(c.talentLevel('t1_str'), 3);
  assert.ok(pageLevels(c, 3).every(l => l === 0));
  assert.equal(c.G.player.gold, 0);
  assert.equal(c.talentTreeComplete(2), true);
  assert.notDeepEqual(c.talentStatBonuses(), before);
  const threat = c.talentThreatTotal(); assert.ok(threat > 2);
  const e2 = createEngine({ seed: 18 }); e2.boot(JSON.parse(e.saveJson()));
  assert.deepEqual(Array.from(pageLevels(e2.ctx, 2)), Array.from(pageLevels(c, 2)));
  assert.equal(e2.ctx.talentThreatTotal(), threat);
  assert.equal(e.cmd('talent.devSetPage', { turn: 2, full: false }).result, null);
  assert.ok(pageLevels(c, 2).every(l => l === 0));
  assert.equal(c.talentTreeComplete(2), false);
  assert.deepEqual(c.talentStatBonuses(), before);
  assert.equal(c.talentThreatTotal(), 2);
  assert.equal(c.G.player.gold, 0);
});

test('內測主機範圍與現有規則一致；不信任主端旗標，外服拒絕兩種操作', () => {
  const e = engine(), c = e.ctx; ui(e);
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '192.168.1.2', '10.1.2.3', '172.16.1.1', '172.31.9.9', 'game.local', 'game.test', 'example.com', 'localhost.example.com', '192.168.1.2.example.com', '172.32.1.1', '8.8.8.8']) {
    c.location.hostname = host;
    assert.equal(c.talentDevServer(), c.isInternalServer(), host);
  }
  c.location = { protocol: 'file:', hostname: '' };
  assert.equal(c.talentDevServer(), true);
  c.location = { protocol: 'https:', hostname: 'game.example.com' };
  c.isInternalServer = () => true; c.isGMHost = () => true;
  const before = JSON.stringify(c.G.player);
  for (const full of [true, false]) {
    const result = e.cmd('talent.devSetPage', { turn: 2, full });
    assert.equal(result.ok, false); assert.match(result.error, /Internal server only/);
  }
  assert.equal(JSON.stringify(c.G.player), before);
});

test('非法參數、未解鎖頁與BOSS戰皆不修改數值', () => {
  const e = engine(), c = e.ctx, before = JSON.stringify(c.G.player);
  for (const args of [{ turn: 0, full: true }, { turn: 11, full: true }, { turn: 2.5, full: true }, { turn: 2, full: 'true' }, { turn: 2 }]) {
    assert.equal(e.cmd('talent.devSetPage', args).ok, false);
  }
  assert.equal(typeof e.cmd('talent.devSetPage', { turn: 7, full: true }).result, 'string');
  c.G.tower.active = true;
  assert.equal(e.cmd('talent.devSetPage', { turn: 2, full: true }).ok, false);
  assert.equal(JSON.stringify(c.G.player), before);
});

test('跳過停用節點且每次只刷新一次，場上魔物保留血量比例', () => {
  const e = engine(), c = e.ctx;
  c.G.stage.current = 100; c.G.stage.zone = 'desert'; c.spawnEliteWave(false, true);
  const enemy = c.fieldEnemyList()[0]; enemy.hp = enemy.maxHp / 2;
  const oldLevel = enemy.level;
  const disabled = c.TALENT_TREES[2][0]; disabled.disabled = true;
  let refreshes = 0; const refresh = c.talentRefresh;
  c.talentRefresh = () => { refreshes++; refresh(); };
  e.cmd('talent.devSetPage', { turn: 2, full: true });
  assert.equal(c.talentLevel(disabled.id), 0);
  assert.equal(c.talentTreeComplete(2), true);
  assert.equal(refreshes, 1);
  assert.equal(enemy.level, oldLevel + c.monsterPowerLevelBonus());
  assert.equal(enemy.hp / enemy.maxHp, 0.5);
  e.cmd('talent.devSetPage', { turn: 2, full: false });
  assert.equal(refreshes, 2); assert.equal(enemy.level, oldLevel);
  assert.equal(enemy.hp / enemy.maxHp, 0.5);
});

test('UI依Worker快照切換按鈕與頁面，全滿後顯示歸零，外服完全無入口', () => {
  const e = engine(), c = e.ctx, root = ui(e);
  c.renderTalents(); assert.match(root.innerHTML, /data-talent-dev-page>一鍵全滿/);
  e.cmd('talent.devSetPage', { turn: 2, full: true });
  const snapshot = e.panel('talents'); c.uiTalentPanelSnapshot = () => snapshot;
  c.G = null;
  c.uiHeaderPanelSnapshot = () => null;
  c.renderTalents(); assert.match(root.innerHTML, /data-talent-dev-page>一鍵歸零/);
  c.UI.talentBrowse.turn = 1; c.renderTalents();
  assert.match(root.innerHTML, /data-talent-dev-page>一鍵全滿/);
  c.UI.talentBrowse.turn = 7; c.renderTalents();
  assert.match(root.innerHTML, /data-talent-dev-page disabled/);
  c.location.hostname = 'game.example.com'; c.renderTalents();
  assert.doesNotMatch(root.innerHTML, /data-talent-dev-page/);
});

test('UI發送當下頁面及明確目標，等待／BOSS／外服時不送出', async () => {
  const e = engine(), c = e.ctx; ui(e);
  let sent = [], pending = false;
  c.sendUiCommand = (name, args, options) => { sent.push({ name, args, options }); return Promise.resolve({ ok: true, result: null }); };
  c.isUiCommandPending = () => pending;
  await c.runTalentDevPageAction();
  assert.equal(sent[0].name, 'talent.devSetPage');
  assert.equal(sent[0].args.turn, 2); assert.equal(sent[0].args.full, true);
  assert.ok(sent[0].options.keys.includes(c.nodePendingKey('talent:t2_crit')));
  e.cmd('talent.devSetPage', { turn: 2, full: true });
  await c.runTalentDevPageAction(); assert.equal(sent[1].args.full, false);
  pending = true; c.runTalentDevPageAction(); assert.equal(sent.length, 2);
  pending = false; c.bossFightConfigLocked = () => true;
  c.runTalentDevPageAction(); assert.equal(sent.length, 2);
  c.bossFightConfigLocked = () => false; c.location.hostname = 'game.example.com';
  c.runTalentDevPageAction(); assert.equal(sent.length, 2);
});
