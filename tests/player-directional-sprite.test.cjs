'use strict';
/* ============================================================
   player-directional-sprite.test.cjs — 8 方向主角序列幀（2026-09-22 換成騎士）

   受測對象：
     tools/build_character_sprites.cjs   素材庫原圖 → 裁邊圖集＋先算好的輪廓＋幀定義
     images/sprites/knight/               上面那支的輸出（與素材庫同步）
     js/battle-renderer.js                多方向載入、轉向、死亡動作

   渲染器的函式用大括號配對挖出來放進 vm 跑，餵假的 body／sheet，看行為而不是比對字面。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'images/sprites/knight');
const raster = require('../tools/vfx/vfx-raster.cjs');
const tool = require('../tools/build_character_sprites.cjs');
const renderer = fs.readFileSync(path.join(REPO, 'js/battle-renderer.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'knight.json'), 'utf8'));

function fn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, '找不到 function ' + name);
  const open = src.indexOf('{', start);
  let depth = 1, end = open + 1;
  for (; depth; end++) { if (src[end] === '{') depth++; if (src[end] === '}') depth--; }
  return src.slice(start, end);
}

test('DIR-1 幀定義與圖集一致：每張圖＝trim × 幀數 × 方向數，輪廓圖同版面，站立點在格內', () => {
  const n = manifest.directions.length;
  assert.equal(n, 8);
  assert.deepEqual(manifest.directions, ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'], '列＝方向，正右方開始順時針');
  assert.ok(manifest.anchorX > 0 && manifest.anchorX < 1 && manifest.anchorY > 0 && manifest.anchorY < 1);
  assert.equal(manifest.bakedShadow, true);
  for (const name of ['idle', 'walk', 'attack1', 'attack2', 'cast', 'die']) {
    const a = manifest.anims[name];
    assert.ok(a && a.image && a.outline, name + ' 要有圖集與輪廓');
    const t = a.trim;
    assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= manifest.frameWidth && t.y + t.h <= manifest.frameHeight, name + ' 的 trim 超出格子');
    for (const file of [a.image, a.outline]) {
      const size = raster.pngSize(fs.readFileSync(path.join(OUT, file)));
      assert.deepEqual(size, { width: t.w * a.frames, height: t.h * n }, file + ' 的尺寸與幀定義對不上');
    }
    assert.ok((a.first || 0) < a.frames);
  }
  assert.equal(manifest.anims.die.hold, true, '死亡停在最後一幀');
  assert.deepEqual(manifest.anims.rise, { from: 'die', reverse: true, fps: manifest.anims.rise.fps, loop: false }, '起身＝倒地倒著播');
  const a3 = manifest.anims.attack3;
  assert.ok(a3 && a3.from === 'cast' && !a3.reverse && !a3.loop, '第三段普攻借用特殊攻擊 1（與施法同一套幀）');
  assert.ok(a3.first > manifest.anims.cast.first && a3.first < manifest.anims.cast.release,
    '當普攻用從比施法晚的地方開始，但要在釋放幀之前（出劍前留幾幀架式）');
  assert.ok(manifest.anims.walk.strideSpeed > 0, '跑步要記下腳步對上的移動速度');
});

test('DIR-2 遊戲裡的圖集與素材庫同步（素材庫不在這台電腦上就跳過）', (t) => {
  let res;
  try { res = tool.build('knight', { check: true }); } catch (e) {
    t.skip('素材庫解析不到：' + (e && e.message));
    return;
  }
  assert.deepEqual(res.changed, [], '改了素材庫的圖或工具的設定，要重跑 node tools/build_character_sprites.cjs knight');
});

test('DIR-3 影子與本體分得開：影子是純黑半透明；深色衣物是不透明的本體；刀光拖影兩者都不是', () => {
  assert.equal(tool.isShadowPx(0, 0, 0, 120), true, '影子');
  assert.equal(tool.isShadowPx(10, 8, 8, 200), true, '影子（接近黑）');
  assert.equal(tool.isShadowPx(8, 8, 8, 255), false, '不透明的深色＝本體的衣物，不是影子');
  assert.equal(tool.isBodyPx(8, 8, 8, 255), true);
  assert.equal(tool.isBodyPx(190, 190, 190, 160), false, '半透明的刀光不框輪廓');
  assert.equal(tool.isShadowPx(190, 190, 190, 160), false, '刀光也不是影子');
  assert.equal(tool.isBodyPx(0, 0, 0, 0), false);
});

test('DIR-4 輪廓只框本體不框影子：影子正下方沒有輪廓像素', () => {
  /* 站立（第 0 幀、朝下）影子在腳下右側一大塊。拿原圖找出「只有影子、沒有本體」而且離本體超過輪廓寬度的像素，
     那些位置的輪廓圖必須是透明的。 */
  const a = manifest.anims.idle;
  const body = raster.decodePng(fs.readFileSync(path.join(OUT, a.image)));
  const ring = raster.decodePng(fs.readFileSync(path.join(OUT, a.outline)));
  const t = a.trim, row = 2, col = 0, R = manifest.outlinePx;
  const at = (img, x, y) => ((row * t.h + y) * img.width + col * t.w + x) * 4;
  let shadowOnly = 0, ringOnShadow = 0;
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    const i = at(body, x, y);
    const [r, g, b, al] = body.rgba.slice(i, i + 4);
    if (!tool.isShadowPx(r, g, b, al)) continue;
    let nearBody = false;
    for (let dy = -R - 1; dy <= R + 1 && !nearBody; dy++) for (let dx = -R - 1; dx <= R + 1 && !nearBody; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= t.w || yy >= t.h) continue;
      const j = at(body, xx, yy);
      if (tool.isBodyPx(body.rgba[j], body.rgba[j + 1], body.rgba[j + 2], body.rgba[j + 3])) nearBody = true;
    }
    if (nearBody) continue;
    shadowOnly++;
    if (ring.rgba[at(ring, x, y) + 3]) ringOnShadow++;
  }
  assert.ok(shadowOnly > 50, '前提：這一格有一塊遠離本體的影子（' + shadowOnly + '）');
  assert.equal(ringOnShadow, 0, '影子上不能有輪廓');
});

/* ---- 渲染器：轉向 ---- */
function loadTurning() {
  const sets = {};
  for (const k of ['idle', 'walk']) sets[k] = [...Array(8)].map((_, d) => [...Array(12)].map((_, i) => k + ':' + d + ':' + i));
  const body = {
    currentFrame: 0, playing: true, animationSpeed: 0.5, calls: [],
    _tex: null,
    set textures(v) { this._tex = v; this.playing = false; this.currentFrame = 0; this.calls.push('textures'); },
    get textures() { return this._tex; },
    gotoAndPlay(f) { this.currentFrame = f; this.playing = true; this.calls.push('play:' + f); },
    gotoAndStop(f) { this.currentFrame = f; this.playing = false; this.calls.push('stop:' + f); }
  };
  const c = { Math, S: { sheets: { player: { dirAnims: sets, dirCount: 8 } } } };
  vm.createContext(c);
  vm.runInContext(['setEntityDir', 'dirFromVector', 'turnToward'].map((n) => fn(renderer, n)).join(';') +
    ';var DIR_TURN_HYSTERESIS_DEG = ' + /var DIR_TURN_HYSTERESIS_DEG = (\d+)/.exec(renderer)[1] + ';', c);
  const ent = { sheetName: 'player', dir: 0, texAnim: 'walk', body };
  return { c, ent, body, sets };
}

test('DIR-5 向量 → 方向格與素材的列順序一致（0＝右、順時針、螢幕 y 向下）', () => {
  const { c } = loadTurning();
  const cases = [[1, 0, 0], [1, 1, 1], [0, 1, 2], [-1, 1, 3], [-1, 0, 4], [-1, -1, 5], [0, -1, 6], [1, -1, 7]];
  for (const [dx, dy, want] of cases) assert.equal(c.dirFromVector(8, dx, dy), want, dx + ',' + dy);
});

test('DIR-6 移動轉向有遲滯：在兩格交界附近抖動不會來回換；出手面向目標則不遲疑', () => {
  const { c, ent } = loadTurning();
  const deg = (a) => [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)];
  c.turnToward(ent, ...deg(25), true);
  assert.equal(ent.dir, 0, '25° 還在「右」這一格的半寬＋遲滯之內');
  c.turnToward(ent, ...deg(30), true);
  assert.equal(ent.dir, 0);
  c.turnToward(ent, ...deg(36), true);
  assert.equal(ent.dir, 1, '超過 22.5°＋遲滯才轉到「右下」');
  c.turnToward(ent, ...deg(20), true);
  assert.equal(ent.dir, 1, '回頭也要過遲滯才轉回去');
  c.turnToward(ent, ...deg(20), false);
  assert.equal(ent.dir, 0, '出手面向目標：直接取最近的一格');
  c.turnToward(ent, 0, 0, false);
  assert.equal(ent.dir, 0, '零向量不轉');
});

test('DIR-7 換方向接著播同一幀、保留播放狀態與速度（跑步中轉彎腳步不重來）', () => {
  const { c, ent, body, sets } = loadTurning();
  body.currentFrame = 7; body.playing = true; body.animationSpeed = 0.73;
  c.setEntityDir(ent, 3);
  assert.equal(ent.dir, 3);
  assert.equal(body.textures, sets.walk[3]);
  assert.equal(body.currentFrame, 7);
  assert.equal(body.playing, true);
  assert.equal(body.animationSpeed, 0.73);
  /* 停住的動作（死亡停在最後一幀）轉向後仍然停著 */
  body.playing = false; body.currentFrame = 11;
  c.setEntityDir(ent, -1);
  assert.equal(ent.dir, 7, '負數取模');
  assert.equal(body.playing, false);
  assert.equal(body.currentFrame, 11);
});

test('DIR-8 死亡：有 die 的素材播 die 停在最後一幀、不轉 90 度；起身倒著播；舊素材照舊旋轉', () => {
  /* playAnim：hold 的動作沒有 onComplete，curAnim 留著（走路／站立的切換看到它就不覆蓋） */
  const played = [];
  const body = { textures: null, animationSpeed: 0, loop: true, onComplete: 'x', gotoAndPlay(f) { played.push(f); } };
  const sheet = {
    manifest: { anims: { die: { loop: false, hold: true }, rise: { loop: false }, idle: { loop: true } } },
    anims: { die: ['d0'], rise: ['r0'], idle: ['i0'] }, dirAnims: { die: [['d0'], ['d1']], rise: [['r0'], ['r1']], idle: [['i0'], ['i1']] },
    speeds: { die: 0.25, rise: 0.5, idle: 0.25 }
  };
  const c = { S: { sheets: { player: sheet } } };
  vm.createContext(c);
  vm.runInContext(fn(renderer, 'animFrames') + ';' + fn(renderer, 'playAnim'), c);
  const ent = { sheetName: 'player', body, dir: 1, curAnim: 'idle', baseAnim: 'idle' };
  c.playAnim(ent, 'die');
  assert.equal(ent.curAnim, 'die');
  assert.deepEqual(body.textures, ['d1'], '用目前方向的那一組');
  assert.equal(body.onComplete, null, '播完停住，不回站立');
  c.playAnim(ent, 'rise', 'idle');
  assert.equal(typeof body.onComplete, 'function', '起身播完回站立');
  body.onComplete();
  assert.equal(ent.curAnim, 'idle');

  /* 接線：倒地播 die、起身播 rise；旋轉只給沒有死亡動作的舊素材 */
  assert.match(renderer, /playAnim\(p, p\.dieAnim \? 'die' : 'idle'\)/);
  assert.match(renderer, /playAnim\(p, \(p\.dieAnim && S\.sheets\[p\.sheetName\]\.anims\.rise\) \? 'rise' : 'idle', 'idle'\)/);
  assert.match(renderer, /if \(!p\.dieAnim\) \{[\s\S]*?p\.bodyWrap\.rotation = -\(Math\.PI \/ 2\)/);
  /* 多方向素材不翻面、影子在圖裡不另畫橢圓 */
  assert.match(renderer, /p\.bodyWrap\.scale\.x = \(!p\.directional && p\.facing < 0\) \? -1 : 1/);
  assert.match(renderer, /if \(!manifest\.bakedShadow\) \{[\s\S]*?shadow\.ellipse/);
});

test('DIR-9 借用幀的動作：同一批 Texture 從 first 切起（輪廓照樣查得到）；倒轉的起身不受影響', async () => {
  /* loadDirectionalSheet 整支拿來跑，PIXI 換成只記錄切格位置的假物件 */
  function Rectangle(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; }
  function Texture(o) { this.frame = o.frame; this.source = o.source; }
  const PIXI = {
    Rectangle, Texture,
    Assets: { load: (url) => Promise.resolve({ source: { url, scaleMode: '' } }) }
  };
  const c = { PIXI, Map, Promise, Math, S: { sheets: {} } };
  vm.createContext(c);
  vm.runInContext(fn(renderer, 'loadDirectionalSheet'), c);
  await c.loadDirectionalSheet('player', 'images/sprites/knight/knight', manifest, { outline: true });
  const sheet = c.S.sheets.player;
  const cast = manifest.anims.cast, a3 = manifest.anims.attack3, die = manifest.anims.die;
  for (let d = 0; d < manifest.directions.length; d++) {
    const castFrames = sheet.dirAnims.cast[d];
    const a3Frames = sheet.dirAnims.attack3[d];
    assert.equal(castFrames.length, cast.frames - cast.first);
    assert.equal(a3Frames.length, cast.frames - a3.first, '方向 ' + d + '：從原幀號 first 開始');
    a3Frames.forEach((t, i) => assert.equal(t, castFrames[i + (a3.first - cast.first)], '同一個 Texture 物件，不另外切'));
    assert.equal(a3Frames[0].frame.x, a3.first * cast.trim.w, '第一幀就是素材的第 ' + a3.first + ' 幀');
    assert.equal(a3Frames[0].frame.y, d * cast.trim.h);
    assert.ok(a3Frames.every((t) => sheet.outline.map.has(t)), '輪廓對照表查得到');
    const rise = sheet.dirAnims.rise[d];
    assert.equal(rise.length, die.frames, '起身沒有 first：整段倒著播');
    assert.equal(rise[0], sheet.dirAnims.die[d][die.frames - 1]);
  }
  assert.ok(Math.abs(sheet.speeds.attack3 - a3.fps / 60) < 1e-12);
  assert.equal(sheet.anims.attack3, sheet.dirAnims.attack3[manifest.defaultDirection]);
});
