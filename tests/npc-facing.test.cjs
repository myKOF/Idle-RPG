'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { extractFunction } = require('./helpers/battle-scene.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'images/sprites/npc/npc.json'), 'utf8'));
// 依原圖的眼睛／鼻口方向人工核對，不能從待測metadata重算期望值。
const leftFacing = ['skull_candle', 'demon_eye', 'flying_demon_head', 'cheeky_devil', 'memento_skeleton', 'large_skull', 'imp', 'plague_flies'];

function setup(key) {
  const c = { console, performance, setTimeout, clearTimeout, navigator: { userAgent: 'node' } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/vendor/pixi.min.js'), 'utf8'), c);
  const P = c.PIXI, meta = manifest.chars[key], name = 'npc:' + key;
  const anims = {}, speeds = {}, defs = {};
  for (const [stem, def] of Object.entries(manifest.stems)) {
    if (def.char !== key) continue;
    const anim = stem.slice(key.length + 1);
    anims[anim] = Array.from({ length: def.frames }, () => P.Texture.EMPTY);
    speeds[anim] = def.fps / 60; defs[anim] = def;
  }
  c.S = { sheets: { [name]: { anims, speeds, manifest: { ...meta, anims: defs } } },
    entities: {}, player: null, layers: { world: new P.Container() }, W: 800, H: 500,
    later: { q: [] }, fx: [], floats: [], shake: 0, paused: false };
  c.target = { x: 0, y: 0 };
  Object.assign(c, { nowMs: () => 100, renderClock: () => 100, playerPos: () => c.target,
    tickScene() {}, syncGroundScroll() {}, syncOutline() {}, applyEntityBillboard() {}, syncNpcRankGlow() {},
    groundToScreenY: y => y, posSolve: e => ({ x: e.wx, y: e.wy }) });
  vm.runInContext(source.match(/var ENEMY_FADE_IN_SEC = [^;]+;/)[0], c);
  vm.runInContext(['makeAnimSprite', 'animFrames', 'setEntityDir', 'playAnim', 'tickEntityAnimation', 'updateFlashJolt', 'tickWorld']
    .map(n => extractFunction(source, n)).join('\n'), c);
  const body = c.makeAnimSprite(name, 'idle'); body.scale.set(1.5);
  const e = { body, root: new P.Container(), bodyWrap: new P.Container(), npcSprite: true, npcFacing: meta.facing,
    sheetName: name, curAnim: 'idle', baseAnim: 'idle', state: 'idle', wx: 100, wy: 0 };
  c.S.entities.npc = e;
  return { c, e, tick: () => c.tickWorld({ deltaMS: 16.7, deltaTime: 1 }) };
}

test('實際朝左的NPC不可標成朝右，包含毒蚊群；原本朝右的圖保持方向', () => {
  for (const key of leftFacing) assert.equal(manifest.chars[key].facing, -1, key);
  for (const key of ['burning_skull', 'burning_skull_blue', 'hell_giant', 'rat']) {
    assert.equal(manifest.chars[key].facing, 1, key);
  }
  for (const [key, meta] of Object.entries(manifest.chars)) assert.ok([-1, 1].includes(meta.facing), key);
});

test('毒蚊群四階級追擊、待機與攻擊均朝向玩家，跨越玩家後翻面，死亡保留原方向', () => {
  for (const scale of [1, 1.28, 2, 3]) {
    const { c, e, tick } = setup('plague_flies');
    e.body.scale.set(scale); e.state = 'entering'; e.enterT = 0; e.enterDur = 10;
    for (const playerX of [0, 200, 0]) {
      c.target.x = playerX; tick();
      assert.equal(e.curAnim, 'walk', '進場／追擊使用移動動畫');
      assert.equal(Math.sign(e.body.scale.x) * -1, Math.sign(playerX - e.wx), '實際原圖朝左，與metadata獨立驗證');
      assert.equal(Math.abs(e.body.scale.x), scale);
    }
    e.state = 'idle'; tick(); assert.equal(e.curAnim, 'idle');
    c.playAnim(e, 'attack'); c.target.x = 200; tick();
    assert.equal(e.curAnim, 'attack'); assert.equal(e.body.scale.x, -scale);
    c.playAnim(e, 'die'); e.state = 'dying'; e.realDeath = true; e.sprDie = true; e.dieDur = 1;
    c.target.x = 0; tick(); assert.equal(e.curAnim, 'die'); assert.equal(e.body.scale.x, -scale);
    e.body.destroy();
  }
});

test('正式tickWorld：左右兩側面向玩家，跨越玩家後翻面且不改變體型', () => {
  for (const key of [...leftFacing, 'male_damned', 'rat', 'burning_skull']) {
    const { c, e, tick } = setup(key);
    const original = (leftFacing.includes(key) || key === 'male_damned') ? -1 : 1;
    for (const enemyX of [100, -100, 100]) {
      e.wx = enemyX; tick();
      assert.equal(Math.sign(e.body.scale.x) * original, enemyX > 0 ? -1 : 1, key);
      assert.equal(Math.abs(e.body.scale.x), 1.5, key); assert.equal(e.body.scale.y, 1.5, key);
    }
    e.body.destroy();
  }
});

test('正式tickWorld：貼身遲滯、進場、攻擊、死亡與暫停保持既有轉向語意', () => {
  const { c, e, tick } = setup('large_skull');
  tick(); assert.equal(e.body.scale.x, 1.5);
  e.wx = -3; tick(); assert.equal(e.body.scale.x, 1.5, '貼身不抖動');
  e.wx = -100; e.state = 'entering'; e.enterT = 0; e.enterDur = 1;
  tick(); assert.equal(e.body.scale.x, -1.5, '進場轉向');
  e.state = 'idle'; c.playAnim(e, 'attack'); e.wx = 100;
  tick(); assert.equal(e.body.scale.x, 1.5); assert.equal(e.curAnim, 'attack');
  e.state = 'dying'; e.realDeath = true; e.sprDie = true; e.dieDur = 1; e.wx = -100;
  c.playAnim(e, 'die'); tick(); assert.equal(e.body.scale.x, 1.5, '屍體保留方向');
  e.state = 'idle'; c.S.paused = true; tick(); assert.equal(e.body.scale.x, 1.5);
  c.S.paused = false; tick(); assert.equal(e.body.scale.x, -1.5);
  e.body.destroy();
});
