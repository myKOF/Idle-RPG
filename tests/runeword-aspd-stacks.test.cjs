'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuneEnv, wordItem, slotFor, rarityForSlots } = require('./helpers/runeword-env.cjs');

function setup(ids) {
  const c = loadRuneEnv();
  for (const id of ids) {
    const w = c.RUNEWORD_BY_ID[id];
    const it = wordItem(c, id, { rarity: rarityForSlots(c, w.runes.length, c.rwWordTwoHandOnly(w)) });
    c.G.equipment[slotFor(c, it)] = it;
  }
  c.markStatsDirty();
  const st = c.getStats();
  const p = c.FIELD.player = c.newPlayerEntity(st);
  const e = { hp: 1e12, maxHp: 1e12, buffs: {}, effects: {}, dots: [], resist: {} };
  c.FIELD.monsters = [e];
  c.FIELD.monster = e;
  return { c, p, st, crit() {
    c.rwOnBasicAttack(p, e, { miss: false, dmg: 1, crit: true }, 'mv-float', st);
  } };
}

for (const spec of [
  { id: 'rw_awakening', name: '驚蟄', cap: 3, sec: 3, total: 36 },
  { id: 'rw_galeeye', name: '風暴之眼', cap: 4, sec: 4, total: 48 }
]) {
  test(spec.name + '：每次暴擊疊1層，達上限後不再增加', () => {
    const { c, p, crit } = setup([spec.id]);
    for (let i = 1; i <= spec.cap + 2; i++) {
      crit();
      assert.equal(c.buffVal(p, 'aspdUp'), Math.min(i, spec.cap) * 12);
    }
  });
  test(spec.name + '：重複觸發刷新持續時間，到期後從1層重新開始', () => {
    const { c, p, crit } = setup([spec.id]);
    crit();
    c.GT = 1;
    crit();
    assert.equal(c.buffVal(p, 'aspdUp'), 24);
    c.GT = spec.sec;
    assert.equal(c.buffVal(p, 'aspdUp'), 24);
    c.GT = spec.sec + 1;
    assert.equal(c.buffVal(p, 'aspdUp'), 0);
    crit();
    assert.equal(c.buffVal(p, 'aspdUp'), 12);
  });
  test(spec.name + '：實際攻速與狀態列層數均符合滿層效果', () => {
    const { c, p, st, crit } = setup([spec.id]);
    const base = c.playerBasicAttackRate(p, st);
    for (let i = 0; i < spec.cap; i++) crit();
    assert.ok(Math.abs(c.playerBasicAttackRate(p, st) / base - (1 + spec.total / 100)) < 1e-10);
    const entry = c.statusEntries(p).find(e => e.effect === 'stat' && e.val === spec.total);
    assert.ok(entry);
    assert.equal(entry.stacks, spec.cap);
    assert.equal(entry.dur, spec.sec);
  });
}

test('未暴擊不疊層；一般攻速增益維持單層刷新', () => {
  const { c, p, st } = setup(['rw_awakening']);
  c.rwOnBasicAttack(p, c.FIELD.monster, { miss: false, dmg: 1, crit: false }, 'mv-float', st);
  assert.equal(c.buffVal(p, 'aspdUp'), 0);
  c.applyStatus(p, 'aspdUp', { val: 25, dur: 8 });
  c.applyStatus(p, 'aspdUp', { val: 25, dur: 8 });
  assert.equal(c.buffVal(p, 'aspdUp'), 25);
  assert.equal(p.buffs.aspdUp.stacks, 1);
});

test('兩組真言同時裝備時，各自維持3／4層與獨立到期時間', () => {
  const { c, p, crit } = setup(['rw_awakening', 'rw_galeeye']);
  for (let i = 0; i < 4; i++) crit();
  assert.equal(c.buffVal(p, 'aspdUp'), 84);
  c.GT = 3;
  assert.equal(c.buffVal(p, 'aspdUp'), 48);
  c.GT = 4;
  assert.equal(c.buffVal(p, 'aspdUp'), 0);
});

test('普通攻速增益與兩組疊層並存，刷新時不放大單層值或覆蓋真言層數', () => {
  const { c, p, crit } = setup(['rw_awakening', 'rw_galeeye']);
  const original = JSON.stringify(c.STATUS.aspdUp);
  c.applyStatus(p, 'aspdUp', { val: 25, dur: 8 });
  for (let i = 0; i < 6; i++) crit();
  assert.equal(c.buffVal(p, 'aspdUp'), 109);
  c.applyStatus(p, 'aspdUp', { val: 10, dur: 8 });
  assert.equal(c.buffVal(p, 'aspdUp'), 94);
  assert.equal(p.buffs.aspdUp.stacks, 1);
  assert.equal(JSON.stringify(c.STATUS.aspdUp), original, '共用狀態資料不被改寫');
  const rows = c.statusEntries(p).filter(e => e.effect === 'stat' && /攻速/.test(e.name));
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(e => e.sid)).size, 3, '狀態列識別各來源，避免同ID徽章互相覆蓋');
  assert.deepEqual(Array.from(rows, e => [e.name, e.val, e.stacks]).sort(), [
    ['攻速', 10, 1], ['驚蟄·攻速', 36, 3], ['風暴之眼·攻速', 48, 4]
  ].sort());
  assert.equal(c.activePlayerBuffs(p).filter(e => c.buffLabel(e.key).includes('攻速')).length, 3);
  c.GT = 4;
  assert.equal(c.buffVal(p, 'aspdUp'), 10);
});

test('未命中即使標記暴擊也不疊層；滿層仍會刷新到期時間', () => {
  const { c, p, st, crit } = setup(['rw_awakening']);
  c.rwOnBasicAttack(p, c.FIELD.monster, { miss: true, dmg: 0, crit: true }, 'mv-float', st);
  assert.equal(c.buffVal(p, 'aspdUp'), 0);
  for (let i = 0; i < 3; i++) crit();
  c.GT = 2;
  crit();
  assert.equal(c.buffVal(p, 'aspdUp'), 36);
  const row = c.statusEntries(p).find(e => e.name === '驚蟄·攻速');
  assert.equal(row.until, 5);
  assert.equal(row.stacks, 3);
  c.GT = 4;
  assert.equal(c.buffVal(p, 'aspdUp'), 36);
  c.GT = 5;
  assert.equal(c.buffVal(p, 'aspdUp'), 0);
  assert.equal(c.statusEntries(p).some(e => e.name === '驚蟄·攻速'), false);
});

test('疊層定義跟隨配置，無效來源不可捏造狀態', () => {
  const { c, p, crit } = setup(['rw_awakening']);
  Object.assign(c.RUNEWORD_BY_ID.rw_awakening.procs[0].acts[0], { val: 7, max: 2, sec: 5 });
  crit(); crit(); crit();
  assert.equal(c.buffVal(p, 'aspdUp'), 14);
  const row = c.statusEntries(p).find(e => e.name === '驚蟄·攻速');
  assert.equal(row.stacks, 2);
  assert.equal(row.dur, 5);
  for (const sid of ['rw:no-word:aspdUp', 'rw:rw_awakening:no-status', 'rw:rw_awakening:shield', 'rw:rw_awakening:aspdUp:extra']) {
    assert.equal(c.statusDef(sid), null);
    assert.equal(c.applyStatus(p, sid), false);
  }
});

test('重複同組真言只觸發一次，層數由既有聚合器去重', () => {
  const { c, p, crit } = setup(['rw_awakening']);
  const w = c.RUNEWORD_BY_ID.rw_awakening;
  w.bases = ['any'];
  c.G.equipment.ring = wordItem(c, w.id, { slot: 'ring', rarity: rarityForSlots(c, 3) });
  c.markStatsDirty();
  assert.equal(c.getStats().rw.procs.length, 1);
  crit();
  assert.equal(c.buffVal(p, 'aspdUp'), 12);
  crit();
  assert.equal(c.buffVal(p, 'aspdUp'), 24);
});

test('正式Worker入口產生的疊層快照可在主執行緒重建數值與狀態列', () => {
  const { createEngine } = require('../scripts/sim/engine.js');
  const engine = createEngine({ seed: 1 }).boot();
  const c = engine.ctx;
  for (const id of ['rw_awakening', 'rw_galeeye']) {
    const w = c.RUNEWORD_BY_ID[id];
    const it = wordItem(c, id, { rarity: rarityForSlots(c, w.runes.length, c.rwWordTwoHandOnly(w)) });
    c.G.equipment[slotFor(c, it)] = it;
  }
  c.markStatsDirty();
  const st = c.getStats();
  const p = c.FIELD.player = c.newPlayerEntity(st);
  const e = { hp: 1e12, maxHp: 1e12, buffs: {}, effects: {}, dots: [], resist: {} };
  c.FIELD.monsters = [e]; c.FIELD.monster = e;
  for (let i = 0; i < 4; i++) c.rwOnBasicAttack(p, e, { miss: false, dmg: 1, crit: true }, 'mv-float', st);
  const panel = JSON.parse(JSON.stringify(engine.panel('battle')));
  const main = loadRuneEnv();
  main.GT = panel.gt;
  const snapshotPlayer = panel.field.player;
  assert.equal(main.buffVal(snapshotPlayer, 'aspdUp'), 84);
  const rows = main.statusEntries(snapshotPlayer).filter(e => e.sid.startsWith('rw:'));
  assert.deepEqual(Array.from(rows, e => [e.name, e.val, e.stacks, e.dur]).sort(), [
    ['驚蟄·攻速', 36, 3, 3], ['風暴之眼·攻速', 48, 4, 4]
  ].sort());
  assert.equal(new Set(rows.map(e => e.sid)).size, 2);
});

test('正式狀態列渲染產生各自3／4層徽章、數值與倒數，到期各別移除', () => {
  const { c, p, crit } = setup(['rw_awakening', 'rw_galeeye']);
  for (let i = 0; i < 4; i++) crit();
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const ui = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
  const source = ui.slice(ui.indexOf('function battleBuffBadgeKey('), ui.indexOf('/* ---- 戰鬥區技能欄'));
  assert.ok(source.includes('function renderBattleBuffBar('));
  vm.runInContext(source, c, { filename: 'js/ui.js:buff-bar' });
  const bar = {
    children: [],
    appendChild(b) { this.children.push(b); },
    replaceChild(b, old) { this.children[this.children.indexOf(old)] = b; },
    removeChild(b) { this.children.splice(this.children.indexOf(b), 1); },
    get lastElementChild() { return this.children.at(-1); }
  };
  c.$id = () => bar;
  c.document.createElement = () => ({
    set innerHTML(html) {
      this.firstElementChild = { html, getAttribute() { return this.state.key; } };
    }
  });
  // DOM寫入器只記錄參數；狀態挑選、徽章文字與HTML均執行正式UI函式。
  c.syncBattleBuffBadge = (badge, state) => { badge.state = state; };
  c.cdDegString = ratio => Math.round(ratio * 360) + 'deg';
  c.renderBattleBuffBar(p, 0);
  assert.equal(bar.children.length, 2);
  const awakening = bar.children.find(b => b.state.name === '驚蟄·攻速');
  const gale = bar.children.find(b => b.state.name === '風暴之眼·攻速');
  assert.match(awakening.html, /bbb-stacks">3</);
  assert.match(gale.html, /bbb-stacks">4</);
  assert.match(awakening.state.ttDesc, /\+36%/);
  assert.match(gale.state.ttDesc, /\+48%/);
  assert.equal(awakening.state.until, 3);
  assert.equal(gale.state.until, 4);
  c.GT = 3;
  c.renderBattleBuffBar(p, 3);
  assert.equal(bar.children.length, 1);
  assert.equal(bar.children[0].state.name, '風暴之眼·攻速');
  c.GT = 4;
  c.renderBattleBuffBar(p, 4);
  assert.equal(bar.children.length, 0);
});

test('封魔塔普攻冷卻使用疊層後的同一攻速加成', () => {
  const { c, p, crit } = setup(['rw_awakening', 'rw_galeeye']);
  for (let i = 0; i < 4; i++) crit();
  const expectedRate = c.playerBasicAttackRate(p, c.getStats());
  c.G.player.gold = 1e30;
  c.startTowerFight(1);
  c.TOWER.introCd = 0;
  c.TOWER.player = p;
  p.atkCd = 10;
  c.TOWER.boss.atkCd = 10;
  c.pickAndCastSkill = () => null;
  c.tickLegendaryEffects = () => null;
  c.tickSkillSchedulers = () => {};
  c.towerTick(0.1);
  assert.ok(Math.abs(p.atkCd - (10 - 0.1 * expectedRate)) < 1e-10);
});
