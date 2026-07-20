const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadFormulaContext() {
  const context = { console, Math };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('煉獄之塔 BOSS 魔種機率依樓層每層增加 2%，並限制在 100%', () => {
  const context = loadFormulaContext();
  assert.equal(context.demonSeedDropChanceForBoss(100), 0);
  assert.equal(context.demonSeedDropChanceForBoss(101), 10);
  assert.equal(context.demonSeedDropChanceForBoss(102), 12);
  assert.equal(context.demonSeedDropChanceForBoss(150), 100);
  assert.equal(context.demonSeedDropChanceForBoss(151), 0);
});

test('魔種掉落只接在煉獄 BOSS 通關流程，且 tips 與資源欄已標示', () => {
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const csv = fs.readFileSync(path.join(root, 'config/CSV/game_parameters.csv'), 'utf8');
  const params = fs.readFileSync(path.join(root, 'tools/apply_params.cjs'), 'utf8');

  assert.match(tower, /demonSeedDropChanceForBoss\(floor\)/);
  assert.match(tower, /G\.player\.demonSeed/);
  assert.match(ui, /demonSeedDropChanceForBoss\(fl\)/);
  assert.match(ui, /魔種.*煉獄之塔限定/);
  assert.match(html, /id="r-demon-seed"/);
  assert.match(csv, /4-高塔BOSS,魔種\(煉獄之塔\)/);
  assert.match(params, /DEMON_SEED_BOSS_RATE_CAP/);
  assert.match(params, /DEMON_SEED_BOSS_BASE_RATE/);
  assert.match(params, /DEMON_SEED_BOSS_PER_FLOOR/);
});
