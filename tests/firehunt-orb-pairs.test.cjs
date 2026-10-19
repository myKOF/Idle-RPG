'use strict';
/* 火狩的雙色組合（母體＋伴生）由 Skills2 表決定（2026-09-23 使用者規格）：
     母體＝本體欄「飛行子彈」：沒選超神讀第一階；烈陽／無限星環讀該超神列（留白沿前階繼承）；
           火神降臨那一列的飛行子彈是普攻星環，母體照第一階。
     伴生＝「觸發子彈」：選了超神讀該超神列，否則讀第三階（伴生火狩）那一列。
   預期值一律從表（SKILLS2）現讀，不寫死 preset 名稱——配色由使用者在表上調整。 */
const test = require('node:test'), assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');

function cast(ultId, trigger = true) {
  const c = createEngine({ seed: 7 }).boot(null).ctx;
  c.G.player.level = 1000;
  c.G.player.loadout = ['sg:firehunt'];
  c.G.player.skills2.levels.firehunt = Array(7).fill(10);
  c.G.tower = Object.assign(c.G.tower || {}, { highest: 100 });
  c.G.player.skills2.ult = ultId ? { firehunt: { pick: c.sgUltIndexOfId('firehunt', ultId), lv: 1 } } : {};
  c.initFieldPlayer();
  c.gmArenaSpawn(1, 'elite', 1e9);
  c.FIELD.monsters[0].pos = { x: 50, y: 0 };                         // 火狩施法距離＝環繞半徑 8 米
  c.FIELD.player.mp = 1e9;                                             // 第七階施法消耗 320
  const events = [];
  c.playCombatVfx = (s) => events.push(s);
  c.castSkill2(c.FIELD.player, c.FIELD.monsters, 'firehunt', 'mv-float');
  const field = c.SKILL2_RT.orbits.at(-1);
  assert.ok(field.orbs.every(o => !o.companion && o.canSpawn), '各超神施放時皆只有可觸發伴生的母體');
  assert.ok(events.filter(e => e.variant === 'firehunt').every(e => e.area.members.every(m => !m.companion)), '出生事件不得帶伴生');
  if (!trigger) return { c, field, events };
  c.chance = () => true;
  c.FIELD.monsters[0].pos = c.sgOrbitPos(field.orbs[0], c.bfPlayerPos());
  c.sgOrbitStep(field, c.FIELD.monsters, 0, {});
  const packet = events.filter((e) => e.variant === 'firehunt' && e.area && e.area.members.some(m => m.companion)).at(-1);
  assert.ok(packet, '施放後應送出環繞事件');
  return { c, packet, field };
}

const SK = cast('').c.SKILLS2.firehunt;
const ult = (id) => SK.ult.find((u) => u.id === id);
const t1 = SK.tiers[0].vfx;
function chainProjectile(u) {
  let p = '';
  SK.tiers.forEach((t) => { if (t.vfx && t.vfx.projectile) p = t.vfx.projectile; });
  return (u && u.vfx && u.vfx.projectile) || p;
}

const CASES = [
  { ult: '', mother: () => t1.projectile, companion: () => SK.tiers[2].triggerVfx.projectile },
  { ult: 'solarRing', mother: () => chainProjectile(ult('solarRing')), companion: () => ult('solarRing').triggerVfx.projectile },
  { ult: 'infiniteRing', mother: () => chainProjectile(ult('infiniteRing')), companion: () => ult('infiniteRing').triggerVfx.projectile },
  { ult: 'fireGodDescend', mother: () => t1.projectile, companion: () => ult('fireGodDescend').triggerVfx.projectile }
];

for (const k of CASES) {
  test('火狩雙色組合（' + (k.ult || '未選超神') + '）：母體讀飛行子彈、伴生讀觸發子彈', () => {
    const { c, packet, field } = cast(k.ult);
    assert.ok(packet.area.members.some((m) => m.companion), '第三階命中成功後才生成伴生並送出事件');
    assert.equal(packet.vfx.projectile, k.mother(), '母體');
    assert.equal(packet.area.companionPreset, k.companion(), '伴生');
    assert.notEqual(packet.area.companionPreset, packet.vfx.projectile, '母體與伴生應是兩種外觀');
    /* 命中特效與軌道環不可被該列的觸發欄（只有伴生子彈）攔走：命中事件與環繞事件共用同一組列標記 */
    const hitRoles = c.sgVfxRoles(field.gid, { vfxTier: field.vfxTier, vfxUlt: field.vfxUlt, vfxGid: field.vfxGid, vfxBase: field.vfxBase });
    assert.equal(hitRoles.hit, t1.hit, '命中特效沿第一階');
    assert.equal(packet.vfx.ground, t1.ground, '軌道環沿第一階');
  });
}

test('火神降臨的普攻星環不會變成環繞母體', () => {
  const { packet } = cast('fireGodDescend');
  assert.notEqual(packet.vfx.projectile, ult('fireGodDescend').vfx.projectile);
});

test('狩神之舞：無接觸、機率未通過、未命中都不伴生，之後成功命中仍可伴生', () => {
  const { c, field: f } = cast('', false);
  const m = c.FIELD.monsters[0];
  c.sgOrbitStep(f, [], .1, {});
  assert.equal(f.orbs.filter(o => o.companion).length, 0);
  m.pos = c.sgOrbitPos(f.orbs[0], c.bfPlayerPos());
  c.chance = () => false;
  c.sgOrbitStep(f, [m], 0, {});
  assert.equal(f.orbs.filter(o => o.companion).length, 0, '未通過伴生機率');
  assert.ok(f.orbs[0].canSpawn);
  c.sgOrbitStep(f, [], 0, {});
  const resolve = c.resolveHit;
  c.resolveHit = () => ({ miss: true, dmg: 0 });
  c.chance = () => true;
  c.sgOrbitStep(f, [m], 0, {});
  assert.equal(f.orbs.filter(o => o.companion).length, 0, '未命中不消耗伴生資格');
  assert.ok(f.orbs[0].canSpawn);
  c.resolveHit = resolve;
  c.sgOrbitStep(f, [], 0, {});
  c.sgOrbitStep(f, [m], 0, {});
  assert.equal(f.orbs.filter(o => o.companion).length, 1, '真實傷害命中後伴生');
  assert.equal(f.orbs[0].canSpawn, false);
  assert.equal(f.orbs.at(-1).canSpawn, false, '伴生不能再伴生');
  c.sgOrbitStep(f, [], 0, {});
  c.sgOrbitStep(f, [m], 0, {});
  assert.equal(f.orbs.filter(o => o.companion).length, 1, '母體重複命中不重複伴生');
});
