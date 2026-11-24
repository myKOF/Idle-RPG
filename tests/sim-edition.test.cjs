/* 縮時模擬的遊戲版本選項（內測版＝full／Demo 版＝demo）。

   引擎照桌面外殼的做法改寫 js/game-edition.js 的內容，遊戲程式只有一份。這裡守三件事：
   1. 預設是 full，選 demo 時遊戲端（含 Worker 端的模擬層）讀到的就是 demo 的倍率與開放範圍
   2. 不認得的版本直接報錯，不靜靜退回 full（兩版數值不同，跑錯版本的結果看起來一樣合理）
   3. 命令列、批次、儀表板伺服器、儀表板頁面一路都把版本傳下去 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { createEngine, normalizeEdition } = require(path.join(ROOT, 'scripts/sim/engine.js'));

test('預設 full；demo 時遊戲讀到 demo 的倍率與開放範圍', () => {
  const full = createEngine({ seed: 1 });
  full.boot(null);
  assert.equal(full.edition, 'full');
  assert.equal(full.ctx.GAME_EDITION, 'full');
  assert.equal(full.ctx.isDemoEdition(), false);
  assert.equal(full.ctx.towerOpenMaxFloor(), full.ctx.TOWER_MAX_FLOOR);

  const demo = createEngine({ seed: 1, edition: 'demo' });
  demo.boot(null);
  assert.equal(demo.edition, 'demo');
  assert.equal(demo.ctx.GAME_EDITION, 'demo');
  assert.equal(demo.ctx.isDemoEdition(), true);
  assert.equal(demo.ctx.towerOpenMaxFloor(), Math.min(demo.ctx.TOWER_MAX_FLOOR, demo.ctx.DEMO_TOWER_MAX_FLOOR));
  const zones = demo.ctx.ZONE_LIST;
  const open = Math.floor(demo.ctx.DEMO_OPEN_ZONE_COUNT);
  assert.equal(demo.ctx.demoZoneOpen(zones[open - 1]), true);
  assert.equal(demo.ctx.demoZoneOpen(zones[open]), false);
});

test('demo 的經驗倍率實際作用在模擬上：同 seed 同時間，demo 經驗較多', () => {
  const run = (edition) => {
    const e = createEngine({ seed: 20261124, edition });
    e.boot(null);
    e.stepSeconds(300);
    const p = e.ctx.G.player;
    return p.level * 1e12 + p.xp;
  };
  const mult = createEngine({ seed: 1 }).ctx.DEMO_ENEMY_XP_MULT;
  if (!(mult > 1)) return;   // 參數表把倍率調回 1 時這條比較沒有意義
  assert.ok(run('demo') > run('full'));
});

test('不認得的版本直接報錯', () => {
  assert.equal(normalizeEdition(undefined), 'full');
  assert.equal(normalizeEdition(''), 'full');
  assert.throws(() => normalizeEdition('Demo'), /不認得的遊戲版本/);
  assert.throws(() => createEngine({ seed: 1, edition: 'internal' }), /不認得的遊戲版本/);
});

test('命令列、批次、伺服器、儀表板頁面一路傳遞版本', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const runSim = read('scripts/run_sim.js');
  assert.match(runSim, /createEngine\(\{[^}]*edition: EDITION/);
  assert.match(runSim, /edition: EDITION,/, 'run_summary 要記錄版本');
  const batch = read('scripts/run_batch.js');
  assert.match(batch, /childArgs\.push\(`--edition=\$\{EDITION\}`\)/);
  assert.match(batch, /edition: EDITION, policies/, 'batch_summary 要記錄版本');
  const server = read('tools/sim_server.cjs');
  assert.match(server, /args\.push\(`--edition=\$\{params\.edition\}`\)/);
  const page = read('monte_carlo_app.html');
  assert.match(page, /id="editionInput"/);
  assert.match(page, /edition: selectedEdition\(\)/);
  assert.match(page, /getElementById\('sumEdition'\)/);
});
