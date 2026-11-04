'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

function load() {
  const c = { console, Math, setTimeout() {}, clearTimeout() {}, document: { addEventListener() {}, getElementById() { return null; } }, UI: { dirty: {} }, blog() {} };
  c.window = c; vm.createContext(c);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/stats.js', 'js/combat.js']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), c, { filename: f }));
  return c;
}
const mon = (o) => Object.assign({ hp: 100, maxHp: 100, gold: 1, xp: 1 }, o);

test('LVPURGE-1 升級：小怪死亡、菁英生命 -80%（不致死）、BOSS 不受影響', () => {
  const c = load();
  const swept = [];
  c.onFieldDeaths = () => { for (const m of c.FIELD.monsters) if (m.hp <= 0) swept.push(m.id); };
  const normal = mon({ id: 'n1' }), normal2 = mon({ id: 'n2', hp: 1 });
  const elite = mon({ id: 'e', elite: true, hp: 1000 }), tiny = mon({ id: 'e2', elite: true, hp: 1 });
  const boss = mon({ id: 'b', isBoss: true, hp: 5000 }), dead = mon({ id: 'd', hp: 0 });
  c.FIELD.monsters = [normal, normal2, elite, tiny, boss, dead];
  c.levelUpFieldPurge();
  assert.equal(normal.hp, 0); assert.equal(normal2.hp, 0);
  assert.ok(Math.abs(elite.hp - 200) < 1e-9);
  assert.equal(tiny.hp, 1, '菁英至少剩 1 點，不會被直接殺死');
  assert.equal(boss.hp, 5000);
  assert.deepEqual(swept.sort(), ['d', 'n1', 'n2']);
});

test('LVPURGE-2 settlePlayerXp 升級時呼叫；靜默（讀檔／離線）不觸發', () => {
  const src = fs.readFileSync(path.join(root, 'js/player.js'), 'utf8');
  assert.match(src, /options\.silent !== true && typeof levelUpFieldPurge === 'function'\) levelUpFieldPurge\(\)/);
});
