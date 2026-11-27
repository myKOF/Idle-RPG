'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { loadEliteEnv } = require('./helpers/elite-env.cjs');
const { csvParse, csvStringify, readXlsxRows } = require('../tools/config_tables.cjs');
const root = path.resolve(__dirname, '..');
const csv = fs.readFileSync(path.join(root, 'config/CSV/game_parameters.csv'), 'utf8');
const rows = csvParse(csv);
const names = ['普通', '精良', '稀有', '獨特', '史詩', '傳說', '神話', '創世', null, null, '混沌', null];

function expected(floor) {
  return names.map(name => {
    if (!name) return 0;
    const row = rows.find(r => r[2] === '5-高塔裝備掉落' && r[3] === name + '裝備');
    for (const cell of row.slice(6)) {
      const m = /^\{(\d+)(?:~(\d+)|\+)=(\d+(?:\.\d+)?)\}$/.exec(cell);
      if (m && floor >= Number(m[1]) && (!m[2] || floor <= Number(m[2]))) return Number(m[3]);
    }
    throw Error('Uncovered floor ' + floor + ' for ' + name);
  });
}

test('高塔九種來源品質完整讀取Excel，全部150層的12種品質與來源區間一致', () => {
  const xlsx = readXlsxRows(path.join(root, 'config/Excel/game_parameters.xlsx'));
  for (const row of rows.filter(r => r[2] === '5-高塔裝備掉落')) {
    assert.deepEqual(xlsx.find(r => r[2] === row[2] && r[3] === row[3]).map(String), row);
  }
  const c = loadEliteEnv();
  assert.equal(c.RARITIES[10].key, 'chaos');
  for (let floor = 1; floor <= 150; floor++) {
    assert.deepEqual(Array.from(c.dropRatesFor(c.BOSS_DROP_TABLE, floor)), expected(floor), 'floor ' + floor);
  }
});

test('第6與10層傳說0%，11層起10%；混沌與創世各自依實際樓層分界', () => {
  const c = loadEliteEnv();
  for (const [floor, legendary, genesis, chaos] of [
    [1, 0, 0, 0], [6, 0, 0, 0], [10, 0, 0, 0], [11, 10, 0, 0],
    [75, 200, 10, 0], [76, 250, 25, 1], [100, 250, 25, 1],
    [101, 250, 100, 5], [120, 250, 100, 5], [121, 250, 100, 25], [150, 250, 100, 25]
  ]) {
    const rates = c.dropRatesFor(c.BOSS_DROP_TABLE, floor);
    assert.deepEqual([rates[5], rates[7], rates[10]], [legendary, genesis, chaos], 'floor ' + floor);
  }
});

test('第6層真正勝利結算不發傳說；第76層勝利能生成正式混沌裝備並記錄掉落', () => {
  for (const floor of [6, 76]) {
    const c = loadEliteEnv(), items = [], recorded = [];
    c.G.player.gold = 1e30; c.G.tower.highest = floor - 1;
    c.setTowerAutoAdvance(false);
    c.chance = rate => rate > 0;
    c.pushConveyor = item => items.push(item);
    c.recordLootEquip = (...args) => recorded.push(args);
    c.rwRollTowerRuneDrop = () => [];
    c.startTowerFight(floor);
    c.TOWER.boss = { hp: 0, maxHp: 100, xp: 0 };
    c.endTowerFight(true);
    assert.equal(c.TOWER.result.win, true);
    if (floor === 6) {
      assert.ok(items.length > 0);
      assert.ok(items.every(it => it.rarity < 5));
      assert.ok(!recorded.some(r => r[0] === 5));
    } else {
      const chaos = items.filter(it => it.rarity === 10);
      assert.equal(chaos.length, 1);
      assert.equal(chaos[0].level, c.equipmentTierLevel(c.towerRewardFor(floor, true).itemLevel));
      assert.ok(recorded.some(r => r[0] === 10 && r[1] === 1 && r[2] === 'tower'));
      assert.ok(c.TOWER.result.rewards.some(r => r.includes(c.RARITIES[10].name)));
    }
  }
});

test('混沌沿用掉寶率／部分獎勵乘區與大於100%的必掉加餘數規則', () => {
  const c = loadEliteEnv();
  c.rwRollTowerRuneDrop = () => [];
  const stats = c.getStats(); c.getStats = () => ({ ...stats, loot: 100 });
  const rates = [];
  c.rollDropCount = rate => { rates.push(rate); return 0; };
  c.grantTowerBossRewards(121, false, 0, [], .25);
  assert.deepEqual(rates, expected(121).filter(r => r > 0).map(r => r * 2 * .25));
  const normal = loadEliteEnv(), items = [];
  normal.BOSS_DROP_TABLE = [{ min: 1, rates: Array.from({ length: 12 }, (_, r) => r === 10 ? 250 : 0) }];
  normal.chance = rate => rate > 0;
  normal.pushConveyor = item => items.push(item);
  normal.rwRollTowerRuneDrop = () => [];
  normal.getStats = () => ({ ...stats, loot: 0 });
  normal.grantTowerBossRewards(121, false, 0);
  assert.equal(items.length, 3);
  assert.ok(items.every(it => it.rarity === 10));
});

test('高塔樓層詳情與BOSS tips共用的裝備顯示包含正確混沌機率，低層不列傳說', () => {
  const c = loadEliteEnv();
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const start = ui.indexOf('function towerEquipDropRows(');
  vm.runInContext(ui.slice(start, ui.indexOf('\n}', start) + 2), c);
  const label = c.STR(45, c.RARITIES[10].name);
  assert.ok(!c.towerEquipDropRows(6).some(r => r.name.includes(c.RARITIES[5].name)));
  for (const [floor, rate] of [[75, null], [76, '1%'], [100, '1%'], [101, '5%'], [120, '5%'], [121, '25%']]) {
    const row = c.towerEquipDropRows(floor).find(r => r.name === label);
    assert.equal(row && row.rate, rate === null ? undefined : rate, 'floor ' + floor);
  }
});

test('套用器以實際區間產表，能接受新分界並拒絕重疊／缺口／負率／壞資料', () => {
  const source = fs.readFileSync(path.join(root, 'tools/apply_params.cjs'), 'utf8');
  function apply(cells) {
    const data = rows.map(r => r.slice());
    const row = data.find(r => r[2] === '5-高塔裝備掉落' && r[3] === '混沌裝備');
    row.splice(6, 12, ...Array.from({ length: 12 }, (_, i) => cells[i] || '0'));
    const csvInput = csvStringify(data);
    const output = [];
    const customFs = Object.create(fs);
    customFs.readFileSync = (file, ...args) => path.resolve(file) === path.join(root, 'config/CSV/game_parameters.csv') ? csvInput : fs.readFileSync(file, ...args);
    customFs.writeFileSync = () => { throw Error('試跑測試禁止寫檔'); };
    const exited = {};
    const context = { require: name => name === 'fs' ? customFs : require(name), __dirname: path.join(root, 'tools'),
      process: { argv: [], env: {}, exit() { throw exited; } }, console: { log: (...args) => output.push(args.join(' ')) }, Buffer };
    try { vm.runInNewContext(source, context); } catch (error) { if (error !== exited) throw error; }
    return output.join('\n');
  }
  const out = apply(['{1~2=0}', '{3+=12.5}']);
  assert.match(out, /min: 3, rates: \[[^\]]*, 12\.5, 0\]/);
  for (const cells of [ ['{1~10=0}', '{10+=1}'], ['{1~10=0}', '{12+=1}'], ['{1+=-1}'], ['bad'], ['{1~150=1}'] ]) {
    assert.throws(() => apply(cells), /高塔裝備掉落/);
  }
  const dryRun = execFileSync(process.execPath, ['tools/apply_params.cjs'], { cwd: root, encoding: 'utf8' });
  assert.match(dryRun, /對應參數總數：626/);
  assert.match(dryRun, /將變更 0、錨點問題 0/);
});
