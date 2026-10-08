'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
function fn(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n}', start);
  return source.slice(start, end + 2);
}
const changes = [
  ['skill.equipLoadout', { id: 'sg:fireball' }],
  ['skill.unequipLoadout', { id: 'potential:power' }],
  ['skill.reorderLoadout', { from: 0, to: 1 }]
];

test('Worker 登場、戰鬥暫停與結算未退出時拒絕裝上／卸下／排序，不改裝載或排程；退出後恢復', () => {
  let calls = 0;
  const c = { G: { tower: { active: true }, player: { loadout: ['sg:cleave', 'potential:power'] } },
    TOWER: { introCd: 2.4, showingResult: false, player: { skillCds: { 'sg:cleave': 1 } } },
    COMMAND_IMPL: { 'skill.reorderLoadout': () => { calls++; return true; } },
    equipSkillToLoadout() { calls++; return null; }, unequipSkillFromLoadout() { calls++; },
    COMBAT_PAUSED: false };
  c.self = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/worker/protocol.js'), 'utf8'), c);
  vm.runInContext(fn(worker, 'runCommand'), c);
  const before = JSON.stringify([c.G.player, c.TOWER.player]);
  for (const phase of ['intro', 'paused', 'result']) {
    c.COMBAT_PAUSED = phase === 'paused'; c.TOWER.showingResult = phase === 'result';
    for (const [name, args] of changes) {
      const result = c.runCommand(name, args);
      assert.equal(result.ok, false);
      assert.equal(result.error, 'BOSS 戰中不可變更戰鬥配置');
      assert.equal(JSON.stringify([c.G.player, c.TOWER.player]), before);
    }
  }
  assert.equal(calls, 0);
  c.G.tower.active = false;
  for (const [name, args] of changes) assert.equal(c.runCommand(name, args).ok, true);
  assert.equal(calls, 3);
});

test('UI 開戰阻擋裝上／卸下／排序指令與按鈕，退出時採最新 view 恢復，不被舊塔快照卡住', async () => {
  const view = { towerActive: true };
  const snapshot = { tower: { active: true } };
  let sends = 0;
  const c = { Promise, Error, viewState: () => view, uiTowerPanelSnapshot: () => snapshot,
    pendingUiButtonAttributes: () => ' data-ui-pending-key="skill"',
    WorkerBridge: { send() { sends++; return Promise.resolve(null); } },
    acquireUiPending: () => ({ entry: { token: 1 } }),
    UI_COMMAND_PENDING: { byToken: {} } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/worker/protocol.js'), 'utf8'), c);
  vm.runInContext(['towerViewActive', 'bossFightConfigLocked', 'skillLoadoutButtonAttributes', 'sendUiCommand'].map(name => fn(ui, name)).join('\n'), c);
  assert.match(c.skillLoadoutButtonAttributes('skill'), / disabled/);
  assert.doesNotMatch(c.skillLoadoutButtonAttributes('skill'), /data-ui-pending-key/);
  for (const [name, args] of changes) await assert.rejects(c.sendUiCommand(name, args), /BOSS 戰中不可變更戰鬥配置/);
  assert.equal(sends, 0);
  view.towerActive = false;
  assert.equal(c.bossFightConfigLocked(), false, '離開塔頁的舊快照不可蓋過最新 view');
  assert.doesNotMatch(c.skillLoadoutButtonAttributes('skill'), / disabled/);
  for (const [name, args] of changes) await c.sendUiCommand(name, args);
  assert.equal(sends, 3);
});

test('BOSS 戰拖曳排序在樂觀更新之前被阻擋，普通野外仍可走原流程', () => {
  const start = ui.indexOf('  function handleSkillLoadoutSwap(');
  const end = ui.indexOf('\n  }', start);
  let locked = true;
  let reads = 0;
  const c = { bossFightConfigLocked: () => locked, nodePendingKey: () => 'skill',
    isUiCommandPending: () => { reads++; return true; } };
  vm.createContext(c);
  vm.runInContext(ui.slice(start, end + 4), c);
  c.handleSkillLoadoutSwap(0, 1);
  assert.equal(reads, 0, '不先改動樂觀裝載列');
  locked = false; c.handleSkillLoadoutSwap(0, 1);
  assert.equal(reads, 1);
});

test('開戰與退出的 view 更新會重繪技能按鈕，同一戰鬥狀態不多加重繪', () => {
  const callbacks = {};
  const c = { UI: { tab: 'skills', dirty: {} },
    UI_WORKER_STATE: { bridgeBound: false, view: { towerActive: false }, viewSubscribed: false },
    WorkerBridge: { on(name, callback) { callbacks[name] = callback; } },
    uiSyncGameTime() {}, handleWorkerUiEvents() {}, syncBossConfigControls() {},
    handleWorkerDead() {}, handleWorkerRestarting() {}, handleWorkerRestarted() {}, hideWorkerDeadNotice() {},
    updateWorkerSafeModeMarker() {}, refreshUiPanelSubscriptions() {}, requestPanelData() {} };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/worker/protocol.js'), 'utf8'), c);
  vm.runInContext(fn(ui, 'applyUiBossFightView') + '\n' + fn(ui, 'bindWorkerUiState'), c);
  assert.equal(c.bindWorkerUiState(), true);
  callbacks[c.MSG_OUT.TICK]({ view: { towerActive: true }, dirty: [] });
  assert.equal(c.UI.dirty.skills, true);
  c.UI.dirty.skills = false;
  callbacks[c.MSG_OUT.TICK]({ view: { towerActive: true }, dirty: [] });
  assert.equal(c.UI.dirty.skills, false);
  callbacks[c.MSG_OUT.TICK]({ view: { towerActive: false }, dirty: [] });
  assert.equal(c.UI.dirty.skills, true);
});

const configCommands = [
  'skill.equipLoadout', 'skill.unequipLoadout', 'skill.reorderLoadout',
  'skill2.downgrade', 'skill2.delete', 'skill2.ultPick', 'skill2.ultSwitch',
  'item.equip', 'item.unequip', 'player.switchEquipSet',
  'item.upgrade', 'item.rerollAffix', 'item.enchant', 'item.removeEnchant',
  'gem.socket', 'gem.socketFused', 'gem.unsocket', 'rune.socket', 'rune.erase',
  'talent.upgrade', 'talent.max', 'talent.downgrade', 'talent.delete',
  'talent.potentialUpgrade', 'talent.potentialMax', 'talent.potentialDowngrade', 'talent.potentialDelete'
];
function configEnvironment() {
  const c = { Promise, Error, G: { tower: { active: true }, equipment: { weapon: 'old' },
    player: { gold: 1000, scrap: 500, gems: { ruby: { 1: 2 } }, runes: { r01: 2 }, talentPoints: 10 } },
    COMMAND_IMPL: {}, UI: { dirty: {} }, UI_WORKER_STATE: { view: { towerActive: true } },
    UI_COMMAND_PENDING: { byKey: {}, byToken: {} }, mutations: 0, sends: 0 };
  c.self = c;
  c.viewState = () => c.UI_WORKER_STATE.view;
  c.uiTowerPanelSnapshot = () => null;
  c.WorkerBridge = { send() { c.sends++; return Promise.resolve(null); } };
  c.acquireUiPending = () => ({ entry: { token: 1 } });
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/worker/protocol.js'), 'utf8'), c);
  for (const name of Object.keys(c.COMMANDS)) c.COMMAND_IMPL[name] = () => { c.mutations++; return null; };
  vm.runInContext(fn(worker, 'runCommand'), c);
  vm.runInContext(['towerViewActive', 'bossFightConfigLocked', 'sendUiCommand', 'bossConfigControlsSelector',
    'syncBossConfigControls', 'syncUiPendingControls', 'applyUiBossFightView'].map(name => fn(ui, name)).join('\n'), c);
  c.isUiCommandPending = key => !!c.UI_COMMAND_PENDING.byKey[key];
  return c;
}
function validArgs(c, name) {
  const args = {};
  for (const [key, type] of Object.entries(c.COMMANDS[name].args)) {
    if (type.endsWith('?')) continue;
    args[key] = type === 'ref' ? { kind: 'plain', type: 'ruby', lv: 1 } : type === 'int' ? (key === 'fromLv' ? 1 : 0) : type === 'num' ? 0 : type === 'bool' ? true : 'example';
  }
  assert.equal(c.validateCommand(name, args), null, name);
  return args;
}

test('BOSS 中全部配置指令在 UI 與 Worker 拒絕，不改物品／金幣／寶石／符文／威能點，退出恢復', async () => {
  const c = configEnvironment();
  assert.deepEqual(Object.keys(c.COMMANDS).filter(c.bossFightBlocksCommand).sort(), configCommands.slice().sort());
  const before = JSON.stringify(c.G);
  for (const name of configCommands) {
    const args = validArgs(c, name);
    const result = c.runCommand(name, args);
    assert.equal(result.ok, false, name);
    assert.equal(result.error, 'BOSS 戰中不可變更戰鬥配置');
    await assert.rejects(c.sendUiCommand(name, args), /BOSS 戰中不可變更戰鬥配置/);
    assert.equal(JSON.stringify(c.G), before, name);
  }
  assert.equal(c.mutations, 0);
  assert.equal(c.sends, 0);
  c.G.tower.active = false;
  c.UI_WORKER_STATE.view.towerActive = false;
  for (const name of configCommands) {
    assert.equal(c.runCommand(name, validArgs(c, name)).ok, true, name);
    await c.sendUiCommand(name, validArgs(c, name));
  }
  assert.equal(c.mutations, configCommands.length);
  assert.equal(c.sends, configCommands.length);
});

test('BOSS 戰保留瀏覽／改名／素材合成與一般技能升級', async () => {
  const c = configEnvironment();
  for (const name of ['player.setEquipView', 'player.renameEquipSet', 'gem.compose', 'gem.fuse', 'rune.compose',
    'skill2.learn', 'skill2.max', 'item.setLock', 'tower.flee']) {
    assert.equal(c.bossFightBlocksCommand(name), false, name);
    assert.equal(c.runCommand(name, validArgs(c, name)).ok, true, name);
    await c.sendUiCommand(name, validArgs(c, name));
  }
});

test('pending 解除不可解鎖戰中配置控制；退出標記所有相關面板重繪，FULL 也立即锁住現有按鈕', () => {
  const c = configEnvironment();
  const blocked = { disabled: false, matches: () => true };
  const browse = { disabled: false, matches: () => false };
  c.document = { querySelectorAll: selector => selector.startsWith('[data-ui-pending-key=') ? [blocked, browse] : [blocked] };
  c.syncBossConfigControls();
  assert.equal(blocked.disabled, true);
  c.syncUiPendingControls('item:gear');
  assert.equal(blocked.disabled, true);
  assert.equal(browse.disabled, false);
  c.applyUiBossFightView({ towerActive: false });
  for (const key of ['equip', 'inv', 'skills', 'talents', 'gems', 'tower']) assert.equal(c.UI.dirty[key], true, key);
  c.syncUiPendingControls('item:gear');
  assert.equal(blocked.disabled, false);
  vm.runInContext(fn(ui, 'applyUiSnapshot'), c);
  c.uiSyncGameTime = () => {};
  c.applyUiSnapshot({ view: { towerActive: true } });
  assert.equal(blocked.disabled, true);
});

test('戰中自動穿裝不找欄位、不改裝備；退出後恢復原自動穿裝', () => {
  const c = { G: { tower: { active: true }, equipment: {} }, reads: 0, equipped: 0,
    equipSlotsForItem: () => { c.reads++; return ['weapon']; }, slotBlockedByTwoHand: () => false,
    isTwoHandItem: () => false, equipItem: () => { c.equipped++; }, blog() {}, rarityTag: () => '劍',
    SLOT_INFO: { weapon: { name: '主手' } } };
  vm.createContext(c);
  vm.runInContext(fn(fs.readFileSync(path.join(root, 'js/player.js'), 'utf8'), 'tryAutoEquip'), c);
  assert.equal(c.tryAutoEquip({}), false);
  assert.equal(c.reads, 0);
  assert.equal(c.equipped, 0);
  c.G.tower.active = false;
  assert.equal(c.tryAutoEquip({}), true);
  assert.equal(c.equipped, 1);
});

test('技能詳情 HTML 未變時，退出 BOSS 仍清除 DOM 的戰鬥鎖，不永久停用重置', () => {
  const c = configEnvironment();
  const elements = { 'sgb-chips': {}, 'sgb-items': {}, 'sgb-detail': {} };
  let button;
  Object.defineProperty(elements['sgb-detail'], 'innerHTML', { set() { button = { disabled: false }; } });
  c.document = { querySelectorAll: () => button ? [button] : [] };
  c.$id = id => elements[id];
  c.UI.sgBrowse = { filter: 'all', gid: 'test' };
  c.SKILLS2 = { test: {} };
  c.sgbResolveGroup = () => 'test';
  c.skillViewLoadout = () => [];
  c.sgbFilterChipsHTML = c.sgbListItemHTML = () => '';
  c.sgbDetailHTML = () => '<button data-skill2-delete="test:0">重置</button>';
  vm.runInContext(fn(ui, 'renderSkillBrowser'), c);
  const trees = { querySelector: () => ({}) };
  c.renderSkillBrowser(trees, {}, {});
  assert.equal(button.disabled, true);
  c.applyUiBossFightView({ towerActive: false });
  c.renderSkillBrowser(trees, {}, {});
  assert.equal(button.disabled, false);
});
