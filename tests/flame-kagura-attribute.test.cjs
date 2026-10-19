'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine');
const { extractFunction } = require('./helpers/battle-scene.cjs');
const root = path.resolve(__dirname, '..');
function setup() { return createEngine({ seed: 1019 }).boot(null).ctx; }
function enemy(attr = 'ice') {
  return { name: '神樂測試怪', level: 1, hp: 1e12, maxHp: 1e12, attr,
    atk: 100, def: 0, mdef: 0, hit: 100, dodge: 0, resist: {}, ctrlRes: 0,
    effects: {}, buffs: {}, dots: [], pos: { x: 30, y: 0 } };
}
const spec = { dps: 100, dur: 2, interval: .5, maxStacks: 3 };

test('神樂灼焰將敵人攻防屬性改為火，保留原屬性及疊層持續火傷', () => {
  const c = setup(), e = enemy();
  assert.equal(c.monsterDefCfg(e).attr, 'ice');
  c.sgApplyKagura(e, spec); c.sgApplyKagura(e, spec);
  assert.equal(c.statusActive(e, 'sgKagura'), true);
  assert.equal(c.STATUS.sgKagura.elem, 'fire');
  assert.equal(c.monsterDefCfg(e).attr, 'fire');
  assert.equal(c.monsterAtkCfg(e).attr, 'fire');
  assert.equal(c.skill2CurrentEnemyAttr(e), 'fire');
  assert.equal(e.attr, 'ice', '不永久覆蓋敵人的原屬性');
  const dot = e.dots[0];
  assert.equal(dot.stacks, 2); assert.equal(dot.dps, 200); assert.equal(dot.interval, .5);
  c.GT = .5; const hp = e.hp; c.tickStatuses(e, .5);
  assert.equal(hp - e.hp, 100, '原本每層持續傷害繼續結算');
});

test('神樂灼焰刷新及層數上限不變，到期立即恢復原屬性', () => {
  const c = setup(), e = enemy('wind');
  for (let i = 0; i < 5; i++) c.sgApplyKagura(e, spec);
  assert.equal(e.dots.length, 1); assert.equal(e.dots[0].stacks, 3);
  c.GT = 1; c.sgApplyKagura(e, spec);
  assert.equal(e.dots[0].until, 3);
  c.GT = 2; assert.equal(c.skill2CurrentEnemyAttr(e), 'fire');
  c.GT = 3;
  assert.equal(c.skill2ForcedAttr(e), '', '到期實例尚未回收也不能繼續轉火');
  assert.equal(c.skill2CurrentEnemyAttr(e), 'wind');
  assert.equal(c.monsterDefCfg(e).attr, 'wind');
  assert.equal(c.monsterAtkCfg(e).attr, 'wind');
});

test('神樂灼焰受無敵阻擋、普通燃燒不轉火，狀態角色換表後仍跟隨實際授予狀態', () => {
  const c = setup(), immune = enemy(), burning = enemy();
  c.applyStatus(immune, 'invuln', { dur: 5 }); c.sgApplyKagura(immune, spec);
  assert.equal(c.statusActive(immune, 'sgKagura'), false);
  assert.equal(c.skill2CurrentEnemyAttr(immune), 'ice');
  c.applyStatus(burning, 'sgBurn', { dps: 100, dur: 2 });
  assert.equal(c.skill2CurrentEnemyAttr(burning), 'ice');
  c.SKILLS2.dualdance.ult[1].status.enemy = [{ id: 'sgBurn' }]; c.sgStatusSlotsReset();
  const changed = enemy(); c.sgApplyKagura(changed, spec);
  assert.equal(changed.dots[0].sid, 'sgBurn');
  assert.equal(c.skill2CurrentEnemyAttr(changed), 'fire');
});

test('石化仍優先轉地，神樂轉火高於寒冰逆轉，依各狀態到期逐一還原', () => {
  const c = setup(), e = enemy('dark');
  c.applyStatus(e, 'sgIceRevert', { dur: 8 }); c.sgApplyKagura(e, { ...spec, dur: 4 });
  assert.equal(c.skill2CurrentEnemyAttr(e), 'fire');
  c.applyStatus(e, c.sgRoleSid('petrify'), { dur: 2 });
  assert.equal(c.skill2CurrentEnemyAttr(e), 'earth');
  c.GT = 2; assert.equal(c.skill2CurrentEnemyAttr(e), 'fire');
  c.GT = 4; assert.equal(c.skill2CurrentEnemyAttr(e), 'ice');
  c.GT = 8; assert.equal(c.skill2CurrentEnemyAttr(e), 'dark');
});

test('神樂轉火實際接入對火屬性敵人增傷，正式施放確實附加該狀態', () => {
  const c = setup(), e = enemy();
  c.Math.random = () => .5;
  const attack = { atk: 100, level: 1, dmgType: 'phys', hit: 1000000, critRate: 0, dmgVsElem: { fire: 100 } };
  const before = c.resolveHit({}, e, attack, c.monsterDefCfg(e));
  c.sgApplyKagura(e, spec);
  const after = c.resolveHit({}, e, attack, c.monsterDefCfg(e));
  assert.equal(before.miss, false); assert.equal(after.miss, false);
  assert.equal(after.dmg, before.dmg * 2);
  c.G.player.level = 650; c.G.tower.highest = 73;
  c.G.player.skills2 = { levels: { dualdance: Array(7).fill(10) }, ult: { dualdance: { pick: 1, lv: 10 } } };
  c.G.player.loadout = ['sg:dualdance']; c.clearSkills2LevelsCache(); c.markStatsDirty();
  c.FIELD.player.mp = 1e9;
  const target = enemy('wind'), home = c.bfPlayerPos(); target.pos = { x: home.x + 20, y: home.y };
  c.castSkill2(c.FIELD.player, [target], 'dualdance', 'mv-float');
  assert.ok(target.dots.some(d => d.sid === 'sgKagura'));
  assert.equal(c.monsterDefCfg(target).attr, 'fire');
});

test('DOM與Pixi名稱讀取同一當前屬性，狀態生效及到期時標籤同步變更', () => {
  const c = setup(), e = enemy();
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  vm.runInContext(extractFunction(ui, 'enemyNameHTML') + '\n' + extractFunction(renderer, 'enemyNameText'), c);
  assert.ok(c.enemyNameHTML(e).includes(c.ELEM_INFO.ice.emoji));
  c.sgApplyKagura(e, spec);
  assert.equal(c.enemyNameHTML(e), c.ELEM_INFO.fire.emoji + e.name);
  assert.equal(c.enemyNameText(e), 'Lv.1 ' + c.ELEM_INFO.fire.emoji + e.name);
  c.GT = 2;
  assert.equal(c.enemyNameHTML(e), c.ELEM_INFO.ice.emoji + e.name);
  assert.equal(c.enemyNameText(e), 'Lv.1 ' + c.ELEM_INFO.ice.emoji + e.name);
  assert.match(ui, /setHtmlIfChanged\(card\.querySelector\('\.enemy-name'\), enemyNameHTML\(liveEnemy\)\)/);
  assert.match(renderer, /var nameTxt = enemyNameText\(d\);\s*if \(ent\.nameText\.text !== nameTxt\) ent\.nameText\.text = nameTxt/);
});
