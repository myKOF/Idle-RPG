// 測試期望直接讀取權威 CSV；不從受測 SKILLS2 或其匯入接線推導期望。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { csvParse } = require('../../tools/config_tables.cjs');
const [headers, ...data] = csvParse(fs.readFileSync(path.resolve(__dirname, '../../config/CSV/Skills2.csv'), 'utf8'));
const rows = data.map(cells => Object.fromEntries(headers.map((key, i) => [key, cells[i] || ''])));
function row(gid, tier = 1) {
  const found = rows.find(r => r['群組ID'] === gid && (typeof tier === 'number' ? +r['階數'] === tier : r['超神ID'] === tier));
  assert.ok(found, `CSV 缺少 ${gid}/${tier}`);
  return found;
}
function geometry(gid, tier, column, level = 0) {
  const text = row(gid, tier)[column];
  assert.ok(text, `${gid}/${tier} 缺少 ${column}`);
  const [base, per] = text.replace(/\s/g, '').split(',').map(part => part.split('*').map(Number));
  assert.ok(base.every(Number.isFinite) && (!per || per.every(Number.isFinite)), `無效尺寸 ${text}`);
  return base.map((n, i) => n + (per ? per[i] : 0) * level);
}
function number(gid, tier, column, level = 0) {
  const values = geometry(gid, tier, column, level);
  assert.equal(values.length, 1, `${column} 應為純量`);
  return values[0];
}
function fx(gid, tier, key, level = 0) {
  const value = JSON.parse(row(gid, tier)['效果參數(JSON)']);
  assert.equal(typeof value[key], 'number', `${gid}/${tier} 缺少 ${key}`);
  return value[key] + (value[key + 'Per'] || 0) * level;
}
function vfx(gid, tier, column) {
  for (let i = tier; i >= 1; i--) {
    const value = row(gid, i)[column];
    if (value) return value;
  }
  return undefined;
}
function versioned(source, asset) {
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(source, new RegExp(escaped + '\\?v=[A-Za-z0-9][A-Za-z0-9._-]*(?=[\x22\x27])'), `${asset} 必須帶非空快取版本`);
}
module.exports = { headers, rows, row, number, geometry, fx, vfx, versioned };
