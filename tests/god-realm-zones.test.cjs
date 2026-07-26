const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv() {
  const codeData = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
  const codeFormula = fs.readFileSync(path.join(__dirname, '../js/formula.js'), 'utf8');
  const codeCombat = fs.readFileSync(path.join(__dirname, '../js/combat.js'), 'utf8');

  const sandbox = {
    console,
    Math,
    Number,
    isFinite,
    blog: () => {},
    UI: { dirty: {} },
    document: { querySelectorAll: () => [], getElementById: () => null },
    window: {},
    G: { player: { level: 1, reincarnations: 11 }, stage: { current: 1, best: 1, zone: 'plains' }, zoneProgress: { plains: { current: 1, best: 1 } } }
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(codeData, sandbox);
  vm.runInContext(codeFormula, sandbox);
  vm.runInContext(codeCombat, sandbox);

  return sandbox;
}

test('神界練功地圖資料與敵人 Monster Pools 正確定義', () => {
  const env = createTestEnv();
  assert.equal(env.ZONE_LIST.length, 6);
  assert.equal(JSON.stringify(env.ZONE_LIST), JSON.stringify(['plains', 'desert', 'swamp', 'god_battlefield', 'god_chaos', 'god_sanctuary']));
  
  assert.ok(env.ZONES.god_battlefield);
  assert.equal(env.ZONES.god_battlefield.name, '太古戰場');
  assert.equal(env.ZONES.god_battlefield.pool.length, 12);
  assert.equal(env.ZONES.god_battlefield.pool[0].name, '太古戰魂');

  assert.ok(env.ZONES.god_chaos);
  assert.equal(env.ZONES.god_chaos.name, '混沌界');
  assert.equal(env.ZONES.god_chaos.pool.length, 12);
  assert.equal(env.ZONES.god_chaos.reqZone, 'god_battlefield');

  assert.ok(env.ZONES.god_sanctuary);
  assert.equal(env.ZONES.god_sanctuary.name, '永恒神域');
  assert.equal(env.ZONES.god_sanctuary.pool.length, 12);
  assert.equal(env.ZONES.god_sanctuary.reqZone, 'god_chaos');
});

test('位面 REALMS 分類與切換測試', () => {
  const env = createTestEnv();
  assert.ok(env.REALMS.human);
  assert.ok(env.REALMS.god);
  assert.equal(JSON.stringify(env.REALMS.human.zones), JSON.stringify(['plains', 'desert', 'swamp']));
  assert.equal(JSON.stringify(env.REALMS.god.zones), JSON.stringify(['god_battlefield', 'god_chaos', 'god_sanctuary']));

  // 切換至太古戰場
  env.switchZone('god_battlefield');
  assert.equal(env.G.stage.zone, 'god_battlefield');

  // 切換回凡人界草原
  env.switchZone('plains');
  assert.equal(env.G.stage.zone, 'plains');
});
