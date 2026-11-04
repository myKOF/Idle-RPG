'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

function loadCombat() {
  const c = { console, Math, setTimeout() {}, clearTimeout() {}, document: { addEventListener() {}, getElementById() { return null; } }, UI: { dirty: {} }, blog() {} };
  c.window = c; vm.createContext(c);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/stats.js', 'js/combat.js']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), c, { filename: f }));
  return c;
}

function setup(c) {
  const calls = { hp: 0, mp: 0 };
  c.getStats = () => ({ lifesteal: 10, manaSteal: 10, passives: {} });
  c.healPlayer = () => { calls.hp++; };
  c.gainPlayerMana = () => { calls.mp++; };
  c.lifestealHealAmount = (v) => v; c.manaStealAmount = (v) => v;
  return calls;
}
const P = { hp: 10 }, T = { hp: 10 };

test('DRAIN-1 未帶系數＝必定觸發吸血與吸魔（普攻、持續傷害維持原樣）', () => {
  const c = loadCombat(), calls = setup(c);
  for (let i = 0; i < 50; i++) c.playerDrainOnDamage(T, 5, P);
  assert.equal(calls.hp, 50); assert.equal(calls.mp, 50);
});

test('DRAIN-2 系數 0＝從不觸發；100＝必定；50＝吸血與吸魔各自獨立擲骰', () => {
  const c = loadCombat(), calls = setup(c);
  for (let i = 0; i < 200; i++) c.playerDrainOnDamage(T, 5, P, undefined, 0);
  assert.equal(calls.hp + calls.mp, 0);
  for (let i = 0; i < 200; i++) c.playerDrainOnDamage(T, 5, P, undefined, 100);
  assert.equal(calls.hp, 200); assert.equal(calls.mp, 200);
  calls.hp = calls.mp = 0;
  let differ = 0;
  for (let i = 0; i < 4000; i++) {
    const h = calls.hp, m = calls.mp;
    c.playerDrainOnDamage(T, 5, P, undefined, 50);
    if ((calls.hp - h) !== (calls.mp - m)) differ++;
  }
  assert.ok(Math.abs(calls.hp / 4000 - 0.5) < 0.06 && Math.abs(calls.mp / 4000 - 0.5) < 0.06);
  assert.ok(differ > 1200, '兩者各擲一次：不會永遠同時觸發或同時不觸發');
});

test('DRAIN-3 技能攻擊設定與 resolveHit 傳遞系數', () => {
  assert.match(fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8'), /typeof g\.drainPct === 'number'\) aCfg\.drainChance = g\.drainPct/);
  assert.match(fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8'), /playerDrainOnDamage\(defender, out\.dmg, attacker, undefined, aCfg\.drainChance\)/);
});

test('DRAIN-4 Skills2 表「擊中回復觸發系數」解析：50%／50 皆可、留白＝不寫、超出範圍中止', () => {
  const src = fs.readFileSync(path.join(root, 'tools/config_tables.cjs'), 'utf8');
  assert.ok(src.includes("'擊中回復觸發系數'"));
  assert.match(src, /dv < 0 \|\| dv > 100/);
  const data = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8').split(/\r?\n/)[0];
  assert.ok(data.endsWith('擊中回復觸發系數'));
});
