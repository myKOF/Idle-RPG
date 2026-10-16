'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
const pixi = fs.readFileSync(path.join(root, 'js/vendor/pixi.min.js'), 'utf8');
function source(name) {
  const start = renderer.indexOf('function ' + name + '('), open = renderer.indexOf('{', start);
  assert.ok(start >= 0); let depth = 1, end = open + 1;
  while (depth) { if (renderer[end] === '{') depth++; if (renderer[end] === '}') depth--; end++; }
  return renderer.slice(start, end);
}
function setup() {
  const c = { console, setTimeout, clearTimeout, performance, navigator: { userAgent: 'node' } };
  vm.createContext(c); vm.runInContext(pixi, c);
  const frames = n => Array(n).fill(c.PIXI.Texture.EMPTY);
  const sheet = { anims: { idle: frames(8), walk: frames(8), attack: frames(4), die: frames(4) },
    speeds: { idle: .5, walk: .5, attack: 1, die: 1 },
    manifest: { anims: { idle: { loop: true }, walk: { loop: true }, attack: { loop: false }, die: { loop: false, hold: true } } } };
  c.S = { sheets: { player: sheet, boss: sheet } };
  vm.runInContext(['makeAnimSprite', 'animFrames', 'playAnim', 'tickEntityAnimation', 'setEntityDir'].map(source).join('\n'), c);
  return c;
}
test('真實Pixi人物與BOSS不註冊shared ticker；戰鬥暫停保留目前幀及小數進度，恢復接續', () => {
  const c = setup(), ticker = { deltaTime: 1 };
  for (const sheetName of ['player', 'boss']) {
    const e = { sheetName, body: c.makeAnimSprite(sheetName, 'walk'), curAnim: 'walk' };
    assert.equal(e.body.autoUpdate, false); assert.equal(e.body.playing, true);
    assert.equal(c.PIXI.Ticker.shared.count, 0);
    c.tickEntityAnimation(e, ticker, .016); const before = e.body._currentTime;
    assert.equal(before, .5);
    for (let i = 0; i < 600; i++) c.tickEntityAnimation(e, ticker, 0);
    assert.equal(e.body._currentTime, before); assert.equal(e.body.currentFrame, 0);
    c.tickEntityAnimation(e, ticker, .016); assert.equal(e.body._currentTime, 1); assert.equal(e.body.currentFrame, 1);
    e.body.destroy();
  }
});
test('暫停期間收到出手動作也不自行播放，解除後完成一次並回到原基礎動作', () => {
  const c = setup(), e = { sheetName: 'player', body: c.makeAnimSprite('player', 'idle'), baseAnim: 'walk' };
  c.playAnim(e, 'attack');
  for (let i = 0; i < 600; i++) c.tickEntityAnimation(e, { deltaTime: 1 }, 0);
  assert.equal(e.curAnim, 'attack'); assert.equal(e.body.currentFrame, 0);
  for (let i = 0; i < 4; i++) c.tickEntityAnimation(e, { deltaTime: 1 }, .016);
  assert.equal(e.curAnim, 'walk'); assert.equal(e.body.currentFrame, 0); assert.equal(e.body.autoUpdate, false);
  e.body.destroy();
});
test('死亡停在最後幀與手動停止的起身動作不被戰鬥更新重新播放', () => {
  const c = setup(), e = { sheetName: 'player', body: c.makeAnimSprite('player', 'idle') };
  c.playAnim(e, 'die');
  for (let i = 0; i < 4; i++) c.tickEntityAnimation(e, { deltaTime: 1 }, .016);
  assert.equal(e.body.currentFrame, 3); assert.equal(e.body.playing, false);
  c.tickEntityAnimation(e, { deltaTime: 20 }, .05); assert.equal(e.body.currentFrame, 3);
  e.body.gotoAndStop(1); c.tickEntityAnimation(e, { deltaTime: 20 }, .05);
  assert.equal(e.body.currentFrame, 1); assert.equal(e.body.playing, false);
  e.body.destroy(); assert.doesNotThrow(() => c.tickEntityAnimation(e, { deltaTime: 1 }, .016));
});
test('正式戰鬥更新以暫停後的dt控制兩邊角色，沒有停掉全域ticker或背景生產', () => {
  const tick = source('tickWorld');
  assert.ok(tick.indexOf('if (S.paused) dt = 0') < tick.indexOf('tickEntityAnimation(p, ticker, dt)'));
  assert.match(tick, /if \(dt <= 0\) continue;\s*tickEntityAnimation\(e, ticker, dt\)/);
  assert.doesNotMatch(tick, /Ticker\.shared\.stop|GameClock\.setPaused/);
});
