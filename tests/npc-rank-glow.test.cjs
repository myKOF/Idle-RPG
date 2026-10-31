'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { extractFunction } = require('./helpers/battle-scene.cjs');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');

function setup() {
  const c = { console, performance, setTimeout, clearTimeout, navigator: { userAgent: 'node' } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/vendor/pixi.min.js'), 'utf8'), c);
  vm.runInContext(src.slice(src.indexOf('  var NPC_RANK_MASKS'), src.indexOf('  function npcRankStyle')) +
    ['npcRankStyle', 'syncNpcRankGlow', 'refreshMobBody', 'destroyEntity'].map(n => extractFunction(src, n)).join('\n'), c);
  const P = c.PIXI;
  const tex = (w, h) => new P.Texture({ source: new P.TextureSource({ width: w, height: h }) });
  const frameA = tex(64, 40), frameB = tex(64, 40);
  const maps = new Map([frameA, frameB].map(frame => [frame, {
    inner: tex(140, 92), outer: tex(140, 92), width: 64, height: 40, k: 2, pad: 6
  }]));
  c.buildNpcRankMasks = frame => maps.get(frame) || null;
  const rootNode = new P.Container(), wrap = new P.Container(), body = new P.Sprite(frameA);
  rootNode.addChild(wrap); wrap.addChild(body); body.anchor.set(.5, 1);
  const ent = { id: 'npc', root: rootNode, bodyWrap: wrap, body, data: { elite: true },
    visScale: 2, wx: 0, wy: 0, hitHeight: 64 };
  c.S = { entities: { npc: ent }, lastPos: {} }; c.nowMs = () => 100;
  return { c, P, ent, maps, frameA, frameB };
}

test('NPC階級以boss／tower優先，其次高級菁英與菁英；普通／小兵／召喚物無覆光', () => {
  const { c } = setup();
  for (const data of [{}, { _gRole: 'minion' }, { _gRole: 'summon', _size: 2 }]) assert.equal(c.npcRankStyle(data), null);
  for (const data of [{ elite: true }, { _tier: 'elite' }]) assert.equal(c.npcRankStyle(data).rim, 0x329dff);
  assert.equal(c.npcRankStyle({ elite: true, _tier: 'elite_adv' }).inner, 0xffe878);
  for (const data of [{ isBoss: true, elite: true }, { _tier: 'boss' }, { _tier: 'tower' }]) {
    assert.equal(c.npcRankStyle(data).rim, 0xff3020);
    assert.equal(c.npcRankStyle(data).inner, 0xffb43c);
  }
});

test('覆光與本體共用bodyWrap；成長、翻面、anchor與非零pivot各點世界位置一致', () => {
  const { c, ent } = setup(), b = ent.body;
  ent.root.position.set(230, 170); ent.root.scale.set(1.3);
  ent.bodyWrap.position.set(-3, 2); ent.bodyWrap.rotation = .34; ent.bodyWrap.scale.set(1.2, .55);
  b.position.set(5, -8); b.rotation = -.2; b.skew.set(.04, -.1); b.pivot.set(3, 5);
  for (const scale of [1, 1.8, -2]) {
    b.scale.set(scale, Math.abs(scale)); b.anchor.set(.3, .85); c.syncNpcRankGlow(ent);
    for (const sp of [ent.rankGlow.outer, ent.rankGlow.inner]) {
      assert.equal(sp.parent, ent.bodyWrap);
      for (const [x, y] of [[0, 0], [32, 20], [64, 40]]) {
        // Sprite局部座標以anchor為原點；mask額外有padding且解析度為本體兩倍。
        const a = b.toGlobal({ x: x - b.anchor.x * 64, y: y - b.anchor.y * 40 });
        const z = sp.toGlobal({ x: x * 2 + 6 - sp.anchor.x * 140, y: y * 2 + 6 - sp.anchor.y * 92 });
        assert.ok(Math.hypot(a.x - z.x, a.y - z.y) < 1e-5);
      }
    }
  }
});

test('換幀使用該幀遮罩；階級／受擊alpha／visible即時同步，缺幀不殘留舊輪廓', () => {
  const { c, ent, maps, frameB, P } = setup();
  c.syncNpcRankGlow(ent); const glow = ent.rankGlow;
  ent.body.texture = frameB; ent.body.alpha = .95; ent.body.visible = false;
  ent.data._tier = 'elite_adv'; c.syncNpcRankGlow(ent);
  assert.equal(ent.rankGlow, glow); assert.equal(glow.inner.texture, maps.get(frameB).inner);
  assert.equal(glow.inner.tint, 0xffe878); assert.equal(glow.inner.alpha, .76); assert.equal(glow.outer.alpha, .76); assert.equal(glow.inner.visible, false);
  ent.data._tier = 'elite'; c.syncNpcRankGlow(ent);
  assert.equal(glow.inner.alpha, .76); assert.equal(glow.outer.alpha, .76);
  ent.data.isBoss = true; c.syncNpcRankGlow(ent);
  assert.equal(glow.inner.alpha, .95); assert.equal(glow.outer.alpha, .95);
  assert.equal(ent.body.alpha, .95);
  ent.body.texture = P.Texture.EMPTY; c.syncNpcRankGlow(ent);
  assert.equal(glow.inner.visible, false); assert.equal(glow.outer.visible, false);
  ent.body.texture = frameB; ent.body.visible = true; c.syncNpcRankGlow(ent);
  assert.equal(glow.inner.visible, true);
});

test('圖片晚載替換本體後輪廓更新、成長基準重設；普通怪不建立覆層', () => {
  const { c, ent, P, frameB, maps } = setup();
  c.syncNpcRankGlow(ent); const oldBody = ent.body;
  ent.eliteDeco = { baseScale: 9 };
  c.makeMobBody = () => { const b = new P.Sprite(frameB); b.scale.set(.45); return b; };
  c.refreshMobBody(ent);
  assert.equal(oldBody.destroyed, true); assert.equal(ent.eliteDeco.baseScale, .45);
  assert.equal(ent.rankGlow.inner.texture, maps.get(frameB).inner);
  assert.equal(ent.bodyWrap.children[0], ent.body);
  ent.data = {}; c.syncNpcRankGlow(ent);
  assert.equal(ent.rankGlow, null); assert.equal(ent.bodyWrap.children.length, 1);
});

test('死亡／換場銷毀覆層但不銷毀共用貼圖；重複同步不新增節點', () => {
  const { c, ent, maps, frameA } = setup(); c.syncNpcRankGlow(ent);
  const glow = ent.rankGlow;
  for (let i = 0; i < 600; i++) c.syncNpcRankGlow(ent);
  assert.equal(ent.bodyWrap.children.length, 3);
  ent.root.alpha = .2; ent.bodyWrap.scale.set(1.18, .5);
  assert.equal(glow.outer.parent.parent.alpha, .2);
  c.destroyEntity('npc');
  assert.equal(glow.outer.destroyed, true); assert.equal(glow.inner.destroyed, true);
  assert.equal(maps.get(frameA).inner.destroyed, false); assert.equal(c.S.entities.npc, undefined);
});
