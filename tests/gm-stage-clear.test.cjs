'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function load(hostname = 'localhost') {
  const c = { console, location: { hostname }, UI: { dirty: {} } };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'strings_data', 'strings', 'data', 'gm_exec', 'ai-key-setting']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), c, { filename: file });
  }
  c.G = { player: { reincarnations: 0, gold: 99, xp: 12 },
    stage: { zone: 'undead_mountains', current: 400, best: 400, kills: 3, autoAdvance: true },
    zoneProgress: { undead_mountains: { current: 400, best: 400, cleared: 399 },
      god_chaos: { current: 42, best: 60, cleared: 59 } }, inventory: [], tower: { active: false } };
  return c;
}
test('白話已通關補齊前置場景及400關完成；保留所在地、後續進度與轉生／資源', () => {
  const c = load(), before = JSON.parse(JSON.stringify(c.G));
  const commands = c.AiKeySetting.parseFastPath('亡靈山脈400關改為已通關狀態');
  assert.deepEqual(Array.from(commands), ['stage_clear 亡靈山脈 400']);
  assert.equal(c.executeGMCommand(commands[0]).ok, true);
  assert.equal(c.G.zoneProgress.undead_mountains.cleared, 400);
  for (const key of c.ZONE_LIST.slice(0, c.ZONE_LIST.indexOf('undead_mountains'))) {
    assert.equal(c.zoneClearedStage(key), c.zoneMaxStage(key), key);
    assert.equal(c.G.zoneProgress[key].best, c.zoneMaxStage(key), key);
    assert.equal(c.isZoneUnlocked(key), true, key);
  }
  assert.equal(c.isFieldBossDefeated('undead_mountains', 400), true);
  assert.equal(c.isZoneUnlocked('god_battlefield'), false, '入口出現不免除11轉門檻');
  assert.deepEqual(JSON.parse(JSON.stringify(c.G.stage)), before.stage);
  assert.deepEqual(JSON.parse(JSON.stringify(c.G.player)), before.player);
  assert.deepEqual(JSON.parse(JSON.stringify(c.G.zoneProgress.god_chaos)), before.zoneProgress.god_chaos);
  assert.equal(c.UI.dirty.battle, true);
  const completed = JSON.stringify(c.G);
  assert.equal(c.executeGMCommand(commands[0]).ok, true);
  assert.equal(JSON.stringify(c.G), completed, '重複通關不得補發獎勵或改寫進度');
});
test('stage跳關仍只到達400；stage_clear才標記400通關', () => {
  const c = load();
  assert.equal(c.executeGMCommand('stage 亡靈山脈 400').ok, true);
  assert.equal(c.G.zoneProgress.undead_mountains.cleared, 399);
  assert.equal(c.executeGMCommand('stage_clear 亡靈山脈 400').ok, true);
  assert.equal(c.G.zoneProgress.undead_mountains.cleared, 400);
});
test('中途通關提高下一關最高到達值但不移動；低關重複操作不倒退', () => {
  const c = load();
  c.G.stage = { zone: 'desert', current: 5, best: 8, kills: 2 };
  c.G.zoneProgress = { desert: { current: 5, best: 8, cleared: 7 } };
  assert.equal(c.executeGMCommand('stage_clear 1 50').ok, true);
  assert.equal(c.G.stage.current, 5);
  assert.equal(c.G.stage.best, 51);
  assert.equal(c.G.stage.kills, 2);
  assert.equal(c.G.zoneProgress.desert.current, 5);
  assert.equal(c.G.zoneProgress.desert.best, 51);
  assert.equal(c.G.zoneProgress.desert.cleared, 50);
  const before = JSON.stringify(c.G);
  assert.equal(c.executeGMCommand('stage_clear desert 20').ok, true);
  assert.equal(JSON.stringify(c.G), before);
});
test('不在目標場景時補前置通關而不換圖；神界既有紀錄保留', () => {
  const c = load();
  c.G.stage = { zone: 'desert', current: 5, best: 5, kills: 2 };
  assert.equal(c.executeGMCommand('stage_clear undead_mountains 400').ok, true);
  assert.equal(c.G.stage.zone, 'desert');
  assert.equal(c.G.stage.current, 5);
  assert.equal(c.G.stage.best, c.zoneMaxStage('desert'));
  assert.equal(c.G.zoneProgress.god_chaos.cleared, 59);
});
test('錯誤場景、缺少／多餘參數、超上限／小數或負值一律拒絕且不部分寫入', () => {
  const c = load(), before = JSON.stringify(c.G);
  for (const line of ['stage_clear', 'stage_clear 亡靈山脈', 'stage_clear wrong 5',
    'stage_clear 亡靈山脈 401', 'stage_clear 亡靈山脈 0', 'stage_clear 亡靈山脈 -1',
    'stage_clear 亡靈山脈 399.5', 'stage_clear 亡靈山脈 400 extra']) {
    assert.equal(c.executeGMCommand(line).ok, false, line);
    assert.equal(JSON.stringify(c.G), before, line);
  }
});
test('正式網域不能執行通關GM', () => {
  const c = load('game.example.com'), before = JSON.stringify(c.G);
  assert.equal(c.executeGMCommand('stage_clear 亡靈山脈 400').ok, false);
  assert.equal(JSON.stringify(c.G), before);
});
