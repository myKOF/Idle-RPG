'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cfg = require('../tools/config_tables.cjs');
const { extractFunction } = require('./helpers/battle-scene.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
const rows = cfg.csvParse(fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8')).filter(r => r.length > 1);
const header = rows[0], col = name => header.indexOf(name);
const bosses = src => cfg.evalLiteral(cfg.extractLiteral(src, 'BOSS_LIST').literal);
const rebuild = data => bosses(cfg.SCHEMAS.NPC.rebuild(data, header, source).BOSS_LIST);

test('NPC 塔王縮放：全部關卡讀取本列縮放比，與正式 BOSS_LIST 及反向匯出一致', () => {
  const tower = rows.slice(1).filter(r => r[col('類型')] === 'tower_boss');
  const result = rebuild(rows.slice(1)), current = bosses(source);
  const exported = cfg.SCHEMAS.NPC.extract(source).filter(r => r[col('類型')] === 'tower_boss');
  assert.equal(result.length, tower.length);
  for (let i = 0; i < tower.length; i++) {
    const scale = Number(tower[i][col('縮放比')]) || 1;
    assert.equal(result[i].scale || 1, scale);
    assert.equal(current[i].scale || 1, scale);
    assert.equal(Number(exported[i][col('縮放比')]), scale);
    const { scale: beforeScale, ...before } = current[i];
    const { scale: afterScale, ...after } = result[i];
    assert.deepEqual(after, before, '除縮放比外，塔王資料保持');
  }
});

test('塔王縮放正數驗證、留白／1恢復預設，覆寫舊倍率而不累乘', () => {
  for (const value of ['', '1', '.6', '2.4']) {
    const data = rows.slice(1).map(r => r.slice());
    data.find(r => r[col('NPC識別碼')] === 'tower_boss_1')[col('縮放比')] = value;
    const first = rebuild(data)[0];
    assert.equal(first.scale || 1, Number(value) || 1);
  }
  for (const value of ['0', '-1', 'bad', 'Infinity']) {
    const data = rows.slice(1).map(r => r.slice());
    data.find(r => r[col('NPC識別碼')] === 'tower_boss_1')[col('縮放比')] = value;
    assert.throws(() => rebuild(data), /縮放比.*大於 0/);
  }
});

test('塔王渲染讀取本列倍率：同模型不同關卡、重排與 3D 模型比例正確，野外沿用原路徑', () => {
  const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  const c = { NPC_CONFIG_TABLE: { field: { scale: 1.3 } }, BOSS_LIST: bosses(source),
    densityScale: () => 1, cellSize: () => ({ w: 80, h: 80 }) };
  vm.createContext(c);
  vm.runInContext(extractFunction(renderer, 'enemyLayout'), c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/npc3d.js'), 'utf8'), c);
  const body = { npc3d: { controller: { pxPerMeter: 512 / 6.2 } } };
  for (const scale of [.6, 1.2, 2.4]) {
    c.BOSS_LIST[0].scale = scale;
    const data = { npcId: c.BOSS_LIST[0].id, towerBoss: true, isBoss: true, _size: 2 };
    const m = c.enemyLayout(data);
    assert.equal(m.visScale, 2 * scale);
    assert.equal(c.Npc3D.scale(body, m.visScale), 64 * scale / (512 / 6.2));
    assert.equal(c.enemyLayout(data).visScale, m.visScale, '重排不累乘');
  }
  assert.equal(c.enemyLayout({ npcId: 'field', _size: 2 }).visScale, 2.6);
  assert.equal(c.enemyLayout({ npcId: 'missing', isBoss: true, towerBoss: true }).visScale, 1);
  assert.notEqual(c.enemyLayout({ npcId: c.BOSS_LIST[1].id, towerBoss: true }).visScale,
    c.enemyLayout({ npcId: c.BOSS_LIST[0].id, towerBoss: true }).visScale);
});
