'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine');

test('天地共生五秒演出保留原場敵人與關卡，HP 從零回滿後才續戰', () => {
  const engine = createEngine({ seed: 42 }).boot(null), c = engine.ctx;
  c.G.player.skills2.levels.earthguard = Array(7).fill(1);
  c.G.player.loadout = ['sg:earthguard'];
  c.G.player.level = 1000;
  c.G.stage.current = 161;
  c.G.stage.zone = 'ice';
  c.G.stage.autoAdvance = false;
  c.markStatsDirty(); c.initFieldPlayer(); c.gmArenaSpawn(3, 'elite', 1e9);
  const p = c.FIELD.player, enemies = c.FIELD.monsters.slice(), stage = c.G.stage.current;
  p.hp = 0; c.onPlayerFieldDeath();
  assert.equal(p.hp, 0);
  assert.equal(c.FIELD.reviveCd, 0);
  assert.equal(p._sgRevival.mode, 'earthguard');
  assert.ok(c.buildPanel('battle').field.player._sgRevival);
  engine.stepSeconds(2.5);
  assert.ok(Math.abs(p.hp / c.getStats().hp - 0.5) < 1e-8);
  assert.equal(c.G.stage.current, stage);
  assert.deepEqual(c.FIELD.monsters, enemies);
  engine.stepSeconds(2.5);
  assert.equal(p.hp, c.getStats().hp);
  assert.equal(p._sgRevival, undefined);
  assert.equal(c.FIELD.reviveCd, 0);
  assert.equal(c.G.stage.current, stage);
  assert.deepEqual(c.FIELD.monsters, enemies);
});

test('天地共生畫面先倒地、升空起身，最後落回地面', () => {
  const source = fs.readFileSync(require.resolve('../js/battle-renderer.js'), 'utf8');
  const start = source.indexOf('      if (p.revival) {', source.indexOf('function tickWorld('));
  const end = source.indexOf('      p.root.x = p.wx;', start);
  assert.ok(start > 0 && end > start);
  let left = 5;
  const p = { revival: { startAt: 0, endAt: 5, mode: 'earthguard' }, revivalGt: 0,
    facing: 1, dieAnim: false, bodyWrap: { x: 0, y: 0, rotation: 0 } };
  const context = vm.createContext({ p, Math, uiCountdownRemain: () => left });
  const step = () => vm.runInContext(source.slice(start, end), context);
  step(); assert.ok(Math.abs(p.bodyWrap.y) < 1e-8); assert.equal(p.bodyWrap.rotation, -Math.PI / 2);
  left = 2.5; step(); assert.equal(p.bodyWrap.y, -60); assert.equal(p.bodyWrap.rotation, -Math.PI / 4);
  left = 0; step(); assert.ok(Math.abs(p.bodyWrap.y) < 1e-8); assert.ok(Math.abs(p.bodyWrap.rotation) < 1e-8);
});

test('高塔復甦五秒保留同一位 BOSS，倒數結束才繼續挑戰', () => {
  const engine = createEngine({ seed: 7 }).boot(null), c = engine.ctx;
  c.G.player.skills2.levels.earthguard = Array(7).fill(1);
  c.G.player.loadout = ['sg:earthguard'];
  c.G.player.level = 1000;
  c.markStatsDirty();
  const p = c.newPlayerEntity(c.getStats());
  const boss = { hp: 1e9, maxHp: 1e9, atkCd: 1, aspd: 1, effects: {}, buffs: {}, dots: [] };
  c.G.tower.active = true;c.TOWER.player = p;c.TOWER.boss = boss;c.TOWER.floor = 1;
  p.hp = 0;c.endTowerFight(false, 'death');
  assert.equal(c.TOWER.showingResult,false);
  assert.equal(p.hp,0);
  engine.stepSeconds(2.5);
  assert.ok(Math.abs(p.hp/c.getStats().hp-0.5)<1e-8);
  assert.equal(c.TOWER.boss,boss);
  engine.stepSeconds(2.5);
  assert.equal(p.hp,c.getStats().hp);
  assert.equal(p._sgRevival,undefined);
  assert.equal(c.TOWER.boss,boss);
  assert.equal(c.G.tower.active,true);
});
