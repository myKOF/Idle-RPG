const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function load() {
  const c = { console, Math: Object.create(Math), UI: { dirty: {} }, blog() {}, document: { getElementById() { return null; } } };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'battlefield', 'combat']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), c);
  }
  return c;
}
test('所有場景通關上限均不自動跨章，仍記錄通關並遵守最後地圖停止規則', () => {
  const c = load();
  for (const key of c.ZONE_LIST) {
    const cap = c.zoneMaxStage(key);
    c.G = { player: { reincarnations: 11 }, stage: { zone: key, current: cap, best: cap, kills: 0, autoAdvance: true },
      zoneProgress: { [key]: { current: cap, best: cap, cleared: cap - 1 } }, tower: { active: false } };
    c.FIELD.player = null;
    c.FIELD.mapComplete = false;
    c.FIELD._waveClearPending = true;
    c.completeFieldWave({ hp: 100 });
    assert.equal(c.G.stage.zone, key, key + '不得跨章');
    assert.equal(c.G.stage.current, cap);
    assert.equal(c.G.stage.best, cap);
    assert.equal(c.zoneClearedStage(key), cap);
    assert.equal(c.FIELD.mapComplete, key === 'god_sanctuary');
    assert.equal(c.FIELD.spawnCd, key === 'god_sanctuary' ? Infinity : c.FIELD_STAGE_SWITCH_DELAY);
  }
});
test('通關後仍能主動進入下一場景並恢復該場景先前的停留關卡', () => {
  const c = load();
  c.G = { player: { reincarnations: 0 }, stage: { zone: 'desert', current: 100, best: 100, kills: 0, autoAdvance: true },
    zoneProgress: { desert: { cleared: 99 }, Icefield: { current: 25, best: 40, cleared: 39 } }, tower: { active: false } };
  c.FIELD.player = null;
  c.FIELD._waveClearPending = true;
  c.completeFieldWave({ hp: 100 });
  assert.equal(c.G.stage.zone, 'desert');
  c.switchZone('Icefield');
  assert.equal(c.G.stage.zone, 'Icefield');
  assert.equal(c.G.stage.current, 25);
  assert.equal(c.G.stage.best, 40);
  assert.equal(c.G.zoneProgress.desert.cleared, 100);
});
test('未通關前置末關時手動前進仍被權威模擬拒絕，通關後0轉即可進神界', () => {
  const c = load();
  c.G = { player: { reincarnations: 0 }, stage: { zone: 'desert', current: 100, best: 100, kills: 0, autoAdvance: true },
    zoneProgress: { desert: { cleared: 99 }, undead_mountains: { cleared: 399, best: 400 } }, tower: { active: false } };
  c.switchZone('Icefield');
  assert.equal(c.G.stage.zone, 'desert');
  c.switchZone('god_battlefield');
  assert.equal(c.G.stage.zone, 'desert');
  c.G.zoneProgress.undead_mountains.cleared = 400;
  c.switchZone('god_battlefield');
  assert.equal(c.G.stage.zone, 'god_battlefield');
  assert.equal(c.G.player.reincarnations, 0);
});
test('上限重複刷關不重複發出通關與世界地圖提示', () => {
  const c = load(), logs = [];
  c.blog = text => logs.push(text);
  c.G = { player: { reincarnations: 0 }, stage: { zone: 'desert', current: 100, best: 100, kills: 0, autoAdvance: true },
    zoneProgress: { desert: { cleared: 99 } }, tower: { active: false } };
  c.FIELD.player = null;
  for (let i = 0; i < 4; i++) { c.FIELD._waveClearPending = true; c.completeFieldWave({ hp: 100 }); }
  assert.equal(logs.filter(text => text.includes('世界地圖')).length, 1);
  assert.equal(c.G.stage.zone, 'desert');
});
