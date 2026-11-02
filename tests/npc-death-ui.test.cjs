'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { extractFunction } = require('./helpers/battle-scene.cjs');
const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');

function setup() {
  const c = { console, performance, setTimeout, clearTimeout, navigator: { userAgent: 'node' } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/vendor/pixi.min.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/battle-elite.js'), 'utf8'), c);
  const P = c.PIXI;
  const sheet = { anims: {}, speeds: {}, manifest: { anims: {} } };
  for (const action of ['idle', 'die']) {
    sheet.anims[action] = Array(4).fill(P.Texture.EMPTY);
    sheet.speeds[action] = 1;
    sheet.manifest.anims[action] = { frames: 4, loop: action === 'idle', hold: action === 'die' };
  }
  c.S = { sheets: { 'npc:test': sheet }, entities: {}, lastPos: {}, player: null, paused: false };
  Object.assign(c, { nowMs: () => 100, documentHidden: () => false, syncZone() {}, posTrack() {},
    enemyNameText: d => d.name, statusTextOf: () => '', syncVfxStatuses() {}, LASTPOS_KEEP_MS: 3000 });
  vm.runInContext(renderer.slice(renderer.indexOf('  var NPC_RANK_MASKS'), renderer.indexOf('  function npcRankStyle')) +
    ['npcRankStyle', 'syncNpcRankGlow', 'drawHpBar', 'drawBossBar', 'removeBossBar', 'entityCenterHeight',
      'startDeath', 'destroyEntity', 'makeAnimSprite', 'animFrames', 'playAnim', 'tickEntityAnimation', 'reconcileBattle']
      .map(n => extractFunction(renderer, n)).join('\n'), c);
  c.buildNpcRankMasks = () => ({ inner: P.Texture.EMPTY, outer: P.Texture.EMPTY, width: 1, height: 1, k: 1, pad: 0 });
  const elite = c.BattleElite.create({ PIXI: P, layer: new P.Container() });
  function enemy(data = {}, sprite = true) {
    const d = { floatSel: 'npc', name: 'NPC', level: 1, hp: 100, maxHp: 100, shield: 10, _gid: 1, ...data };
    const rootNode = new P.Container(), view = new P.Container(), wrap = new P.Container();
    const body = sprite ? c.makeAnimSprite('npc:test', 'idle') : new P.Sprite(P.Texture.EMPTY);
    const e = { id: d.floatSel, data: d, state: 'idle', root: rootNode, view, bodyWrap: wrap, body,
      hpBar: new P.Graphics(), barW: 48, hpShown: -1, shieldShown: -1, visScale: 1,
      nameText: { text: d.name }, statusText: { text: '' }, hitHeight: 64,
      npcSprite: sprite, sheetName: sprite ? 'npc:test' : '', curAnim: sprite ? 'idle' : '',
      isBoss: !!d.isBoss, isElite: !d.isBoss && !!d.elite };
    rootNode.addChild(view); view.addChild(wrap, e.hpBar); wrap.addChild(body);
    c.S.entities[e.id] = e;
    c.drawHpBar(e); c.syncNpcRankGlow(e); elite.update(c.S.entities, .016, 100);
    return e;
  }
  return { c, elite, enemy };
}

function hidden(e) {
  assert.equal(e.hpBar.visible, false, '整份血條含護盾、背景與框隱藏');
  assert.equal(e.eliteDeco.ring.visible, false, '腳下光圈隱藏');
  if (e.rankGlow) {
    assert.equal(e.rankGlow.outer.visible, false, '階級外框隱藏');
    assert.equal(e.rankGlow.inner.visible, false, '階級內覆光隱藏');
  }
  assert.equal(e.root.destroyed, false, '本體仍留給死亡動畫');
  assert.equal(e.body.visible, true);
}

test('NPC死亡入口同步隱藏光圈／整份血條／階級框，暫停不延遲，死亡動畫照常播完停幀', () => {
  for (const data of [{}, { elite: true }, { elite: true, _tier: 'elite_adv' }, { isBoss: true }]) {
    const { c, elite, enemy } = setup(), e = enemy(data);
    assert.equal(e.hpBar.visible, true); assert.equal(e.eliteDeco.ring.visible, true);
    if (e.rankGlow) assert.equal(e.rankGlow.outer.visible, true);
    c.S.paused = true;
    c.startDeath(e, true);
    hidden(e); assert.equal(e.curAnim, 'die'); assert.equal(e.body.playing, true);
    c.tickEntityAnimation(e, { deltaTime: 1 }, 0);
    assert.equal(e.body.currentFrame, 0);
    for (let i = 0; i < 6; i++) {
      c.S.paused = false;
      c.tickEntityAnimation(e, { deltaTime: 1 }, .016);
      e.hpShown = -1; c.drawHpBar(e); c.syncNpcRankGlow(e);
      elite.update(c.S.entities, .016, 200 + i);
      hidden(e);
    }
    assert.equal(e.body.currentFrame, 3); assert.equal(e.body.playing, false);
    e.root.destroy({ children: true }); elite.destroy();
  }
});

test('死亡快照、重複快照及未持留的死亡離場都隱藏；同ID新生的血條／光圈／框正常', () => {
  for (const hold of [true, false]) {
    const { c, elite, enemy } = setup(), e = enemy({ elite: true });
    const d = { ...e.data, hp: 0, _rewarded: true, _deathClearCd: hold ? .8 : 0 };
    const panel = { stage: { zone: 'desert' } };
    c.reconcileBattle(panel, { monsters: [d] }); hidden(e);
    c.reconcileBattle(panel, { monsters: [d] }); hidden(e);
    c.makeEnemy = fresh => enemy(fresh);
    c.reconcileBattle(panel, { monsters: [{ ...e.data, hp: 100 }] });
    const fresh = c.S.entities.npc;
    assert.notEqual(fresh, e); assert.equal(e.root.destroyed, true);
    assert.equal(fresh.hpBar.visible, true); assert.equal(fresh.eliteDeco.ring.visible, true);
    assert.equal(fresh.rankGlow.outer.visible, true);
    fresh.root.destroy({ children: true }); elite.destroy();
  }
});

test('零血量尚未進死亡狀態也不顯示血條／群組環，缺死亡素材退路與背景清理保持', () => {
  const { c, elite, enemy } = setup(), e = enemy({ elite: true }, false);
  e.data.hp = 0; c.drawHpBar(e); elite.update(c.S.entities, .016, 200);
  assert.equal(e.hpBar.visible, false); assert.equal(e.eliteDeco.ring.visible, false);
  c.startDeath(e, true); hidden(e); assert.equal(e.sprDie, undefined);
  c.documentHidden = () => true; c.startDeath(e, true);
  assert.equal(c.S.entities.npc, undefined); assert.equal(e.root.destroyed, true);
  elite.destroy();
});
