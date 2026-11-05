'use strict';
/* GM legend 指令：把穿戴中裝備的傳奇特效設為指定 key（測試傳奇特效用，取代隨機擲骰）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = { console, Math, location: { hostname: 'localhost' }, UI: { dirty: {} } };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/runeword_data.js', 'js/status.js', 'js/formula.js', 'js/item.js', 'js/player.js', 'js/gm_exec.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = context.newGameState();
  context.markStatsDirty = () => {};
  return context;
}

function wear(c, slot) {
  const it = c.makeEquipment(100, { rarity: 5, level: 100, slot: slot === 'ring2' ? 'ring' : slot });
  c.G.equipment[slot] = it;
  return it;
}

test('legend 設定指定部位的傳奇特效，預設主手；clear 清除', () => {
  const c = loadContext();
  const weapon = wear(c, 'weapon');
  const ring2 = wear(c, 'ring2');
  let r = c.executeGMCommand('legend bloodthirst');
  assert.equal(r.ok, true, r.message);
  assert.equal(weapon.passive.key, 'bloodthirst');
  r = c.executeGMCommand('legend knifeChain ring2');
  assert.equal(r.ok, true, r.message);
  assert.equal(ring2.passive.key, 'knifeChain');
  r = c.executeGMCommand('legend clear ring2');
  assert.equal(r.ok, true, r.message);
  assert.equal(ring2.passive, null);
  ring2.passive = { key: 'goldenTouch' };
  r = c.executeGMCommand('legend clear all');
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /2 件/);
  assert.equal(weapon.passive, null);
  assert.equal(ring2.passive, null);
});

test('legend 拒絕不存在的鍵、沒穿裝備的部位', () => {
  const c = loadContext();
  wear(c, 'weapon');
  assert.equal(c.executeGMCommand('legend noSuchKey').ok, false);
  assert.equal(c.executeGMCommand('legend bloodthirst helmet').ok, false);
});

test('停用與符文真言專屬的鍵預設拒絕，加 force 才寫入（模擬舊存檔殘留）', () => {
  const c = loadContext();
  const weapon = wear(c, 'weapon');
  for (const key of ['deadTime', 'ghostLamp']) {
    weapon.passive = null;
    assert.equal(c.executeGMCommand('legend ' + key).ok, false);
    assert.equal(weapon.passive, null);
    const r = c.executeGMCommand('legend ' + key + ' weapon force');
    assert.equal(r.ok, true, r.message);
    assert.equal(weapon.passive.key, key);
    assert.match(r.message, /不生效/);
  }
});

test('legend list 依分類篩選，數量與 PASSIVE_POOL 一致', () => {
  const c = loadContext();
  const P = c.PASSIVE_POOL;
  const legendary = Object.keys(P).filter((k) => P[k].legendary);
  const count = (msg) => Number(/^(\d+) 個/.exec(msg)[1]);
  assert.equal(count(c.executeGMCommand('legend list').message), legendary.length);
  assert.equal(count(c.executeGMCommand('legend list rwonly').message), Object.keys(c.RUNEWORD_ONLY_LEGENDARY).length);
  assert.equal(count(c.executeGMCommand('legend list disabled').message), Object.keys(c.LEGACY_LEGENDARY_DISABLED).length);
  assert.equal(count(c.executeGMCommand('legend list knife').message), legendary.filter((k) => P[k].relatedSkill === 'knife').length);
});
