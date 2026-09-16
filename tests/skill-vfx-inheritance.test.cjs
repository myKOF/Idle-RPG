'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const keys = ['cast', 'attack', 'projectile', 'hit', 'ground', 'field'];
function load() {
  const c = vm.createContext({ console, Math });
  for (const f of ['battlefield', 'skills2']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), c);
  c.skills2Levels = () => [1, 1, 1, 1, 1, 1, 1];
  c.skills2Ult = () => null;
  return c;
}
const plain = x => JSON.parse(JSON.stringify(x));
test('逐風者實際場域只播放表定龍捲風，保留風系傷害與本體繼承', () => {
  const c = load(), events = [], hits = [];
  c.SKILLS2.cleave.ult.find(u => u.id === 'windChaser').vfx = { ground: 'ground-tornado-wind' };
  c.playCombatVfx = spec => events.push(plain(spec));
  c.enemyEventFloatTarget = () => 'enemy';
  c.sgHitOne = (...args) => { hits.push(args); return { miss: true }; };
  const enemy = { hp: 1000 };
  const f = { gid: 'cleave', kind: 'windtornado', vfxUlt: 'windChaser',
    tgt: enemy, pos: null, radius: 40, gap: 0.4, dmgVal: 110,
    hitElem: 'wind', pEnt: {}, st: {}, floatSel: '' };
  c.sgGroundTick(f, [enemy], {});
  assert.deepEqual(events[0].vfx, { ground: 'ground-tornado-wind' });
  assert.equal(events[0].variant, 'wind-tornado');
  assert.equal(hits.length, 1);
  assert.equal(hits[0][3], 110);
  assert.equal(hits[0][9], 'wind');
  assert.equal(c.sgVfxRoles('cleave', { vfxUlt: 'windChaser' }).attack, 'slash-cleave-ring-warm');
  assert.equal(c.sgVfxRoles('cleave', { vfxUlt: 'windChaser' }).projectile, 'proj-cleave-ring-tricolor');
  // 傳奇借用逐風者時同樣只派送場域；無敵人仍顯示原判定範圍。
  c.sgGroundVictims = () => [];
  f.gid = 'thrust'; f.vfxGid = 'cleave'; f.pos = { x: 123, y: 456 }; f.vfxId = 'wind-test';
  c.sgGroundTick(f, [], {});
  assert.deepEqual(events[1].vfx, { ground: 'ground-tornado-wind' });
  assert.deepEqual(events[1].area, { id: 'wind-test', x: 123, y: 456, r: 40 });
  assert.equal(hits.length, 1);
  // 仍以配置為來源，空欄不能偷偷補回其他角色或寫死的 Preset。
  c.SKILLS2.cleave.ult.find(u => u.id === 'windChaser').vfx.ground = 'test-ground';
  c.sgGroundTick(f, [], {});
  assert.deepEqual(events[2].vfx, { ground: 'test-ground' });
  c.SKILLS2.cleave.ult.find(u => u.id === 'windChaser').vfx = {};
  c.sgGroundTick(f, [], {});
  assert.deepEqual(events[3].vfx, {});
});
test('未指定階級只讀目前生效最高階；獨立事件讀指定階，不讀未來階', () => {
  const c = load();
  c.SKILLS2.probe = { tiers: [{vfx:{attack:'first'}},{},{vfx:{attack:'third'}},{vfx:{attack:'future'}}] };
  c.skills2Levels = () => [1,1,1,0];
  assert.equal(c.sgVfxRoles('probe', {}).attack, 'third');
  assert.equal(c.sgVfxRoles('probe', {vfxTier:2}).attack, 'first');
});
test('逐欄繼承：每個角色獨立覆寫，跨空階／空字串直到初階，且不修改配置', () => {
  const c = load();
  const first = Object.fromEntries(keys.map(k => [k, 'first-' + k]));
  c.SKILLS2.probe = { tiers: [{ vfx: first }, { vfx: { attack: 'second', hit: '  ' } }, {}, { vfx: { projectile: ' fourth ' } }, {}, {}, {}] };
  const before = JSON.stringify(c.SKILLS2.probe);
  assert.deepEqual(plain(c.sgVfxRoles('probe', { vfxTier: 7 })), { ...first, attack: 'second', projectile: 'fourth' });
  assert.deepEqual(plain(c.sgVfxRoles('probe', { vfxTier: 1 })), first);
  assert.equal(JSON.stringify(c.SKILLS2.probe), before);
  c.SKILLS2.probe = { tiers: [{}, {}, {}] };
  assert.deepEqual(plain(c.sgVfxRoles('probe', { vfxTier: 3 })), {});
});
test('超神逐欄從第七階繼承，不讀另一個互斥選項', () => {
  const c = load();
  c.SKILLS2.probe = { tiers: [{ vfx: { hit: 'first-hit' } }, {}, {}, {}, {}, {}, { vfx: { attack: 'seventh-attack' } }],
    ult: [{ id: 'a', vfx: { projectile: 'only-a' } }, { id: 'b', vfx: { hit: 'b-hit' } }] };
  assert.deepEqual(plain(c.sgVfxRoles('probe', { vfxUlt: 'b' })), { attack: 'seventh-attack', hit: 'b-hit' });
  c.skills2Ult = () => ({ def: c.SKILLS2.probe.ult[1] });
  assert.deepEqual(plain(c.sgVfxRoles('probe', { vfxTier: 1 })), { attack: 'seventh-attack', hit: 'b-hit' });
  assert.deepEqual(plain(c.sgVfxRoles('other', { vfxGid: 'probe', vfxTier: 1 })), { hit: 'first-hit' });
});
test('所有正式技能、所有階級與超神的非空欄位都原值優先，空欄向前找', () => {
  const c = load();
  for (const [gid, g] of Object.entries(c.SKILLS2)) {
    let inherited = {};
    g.tiers.forEach((row, i) => {
      for (const k of keys) if (row.vfx?.[k]?.trim()) inherited[k] = row.vfx[k].trim();
      assert.deepEqual(plain(c.sgVfxRoles(gid, { vfxTier: i + 1 })), inherited, gid + ':' + (i + 1));
    });
    for (const row of g.ult || []) {
      const expected = { ...inherited };
      for (const k of keys) if (row.vfx?.[k]?.trim()) expected[k] = row.vfx[k].trim();
      assert.deepEqual(plain(c.sgVfxRoles(gid, { vfxUlt: row.id })), expected, gid + ':' + row.id);
    }
  }
});
test('幻影八方陣的實際特效事件使用配置的超神攻擊，敵方／自身事件都保留空表', () => {
  const c = load(), events = [];
  c.playCombatVfx = spec => events.push(spec);
  c.enemyEventFloatTarget = () => 'enemy';
  c.skills2Ult = () => ({ def: c.SKILLS2.thrust.ult.find(u => u.id === 'phantomOcta') });
  c.sgEmitVfx('thrust', [{ hp: 1 }], '', { fxKind: 'slash', vfxTier: 5, delayMs: 200, travelMs: [450] });
  assert.equal(events[0].vfx.attack, 'slash-thrust-scatter-blue');
  assert.equal(events[0].delayMs, 200);
  assert.deepEqual(plain(events[0].travelMs), [450]);
  c.skills2Ult = () => null;
  c.SKILLS2.probe = { tiers: [{}] };
  c.sgEmitVfx('probe', [{ hp: 1 }], '', {});
  c.sgEmitPlayerVfx('probe', '', {});
  assert.deepEqual(plain(events.slice(1).map(e => e.vfx)), [{}, {}]);
});
