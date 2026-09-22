'use strict';
/* ============================================================
   player-cast-act.test.cjs — 技能施法動作（協議 v36 act:'cast'，2026-09-22）

   需求：主角換成騎士之後，特殊攻擊 1（Special1）當作遊戲裡的施法動作；原本技能沒有施法動作。
   原因：技能特效大多交給 Preset 播，onVfx 在 Preset 接手之後就不再碰角色。

   鏈：js/skills.js beginSkillCast（施放硬直起點）→ shim.js emitPlayerAct → visual 訊息
       → js/ui.js handleWorkerUiEvents → BattleRenderer.onAct → playerAttackAnim('cast', …, lockMs)
   每一段都挖出函式放進 vm 跑，餵假的依賴，看行為。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const skills = read('js/skills.js');
const renderer = read('js/battle-renderer.js');
const ui = read('js/ui.js');

function fn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, '找不到 function ' + name);
  const open = src.indexOf('{', start);
  let depth = 1, end = open + 1;
  for (; depth; end++) { if (src[end] === '{') depth++; if (src[end] === '}') depth--; }
  return src.slice(start, end);
}

function loadBeginCast(castSec, execResult) {
  const acts = [], executed = [];
  const c = {
    Math, SKILL_CAST_RT: [],
    skillCastInProgress: () => false, dequeueSkillReady() {}, requeueSkillAfterFailedCast() {},
    skillCastTimeFor: () => castSec,
    executeSkillCastJob: (job) => { executed.push(job.skillId); return execResult; },
    bfPickPrimary: (list, locked) => (locked && list.indexOf(locked) >= 0 ? locked : list[list.length - 1]),
    emitPlayerAct: (...args) => acts.push(args)
  };
  vm.createContext(c);
  vm.runInContext(fn(skills, 'skillCastActEmit') + ';' + fn(skills, 'beginSkillCast'), c);
  return { c, acts, executed };
}

test('CAST-1 有施放硬直：硬直一開始就送 act:cast，帶硬直秒數與主要目標（鎖定目標優先）', () => {
  const { c, acts, executed } = loadBeginCast(0.2, { dmg: 1 });
  const a = { hp: 10 }, b = { hp: 10 }, dead = { hp: 0 };
  const pEnt = { _lockTarget: a };
  const res = c.beginSkillCast({ pEnt, target: [dead, b, a], skillId: 'fireball', kind: 'skill2', floatSel: 'mv-float' });
  assert.equal(res.casting, true);
  assert.deepEqual(executed, [], '硬直期間技能還沒放出去');
  assert.equal(acts.length, 1);
  assert.equal(acts[0][0], 'cast');
  assert.equal(acts[0][1], 'mv-float');
  assert.equal(acts[0][2], a, '面向鎖定目標');
  assert.equal(acts[0][3], 0.2, '顯示層用硬直長度把釋放幀對到特效出現的那一刻');

  const other = loadBeginCast(0.2, { dmg: 1 });
  other.c.beginSkillCast({ pEnt: {}, target: [dead, b], skillId: 'x', floatSel: 'mv-float' });
  assert.equal(other.acts[0][2], b, '沒有鎖定：交給 bfPickPrimary，死掉的不算');
});

test('CAST-2 沒有硬直：技能放出去之後才送（失敗的不播）', () => {
  let r = loadBeginCast(0, { dmg: 5 });
  r.c.beginSkillCast({ pEnt: {}, target: { hp: 3 }, skillId: 'thrust', floatSel: 'mv-float' });
  assert.equal(r.acts.length, 1);
  assert.equal(r.acts[0][3], 0);
  r = loadBeginCast(0, null);
  r.c.beginSkillCast({ pEnt: {}, target: { hp: 3 }, skillId: 'thrust', floatSel: 'mv-float' });
  assert.equal(r.acts.length, 0, '沒放成功（例如距離不夠）就不擺施法姿勢');
});

test('CAST-3 shim：act 走低延遲 visual 批次，只帶圖層 id 與毫秒數', () => {
  const context = {};
  context.self = context;
  vm.createContext(context);
  vm.runInContext(read('js/worker/shim.js'), context);
  context.playerEventFloatTarget = (sel) => (sel === 'mv-float' ? 'pv-float' : 'tp-float');
  context.enemyEventFloatTarget = (ent) => ent.floatSel;
  context.emitPlayerAct('cast', 'mv-float', { floatSel: 'mv-float-7', hp: 5 }, 0.2);
  const urgent = JSON.parse(JSON.stringify(context.shimDrainUrgentVisualEvents()));
  assert.deepEqual(urgent, [{ act: 'cast', elId: 'pv-float', target: 'mv-float-7', lockMs: 200, kind: 'act' }]);
  context.emitPlayerAct('cast', 'tb-float', null, 0);
  const second = JSON.parse(JSON.stringify(context.shimDrainUrgentVisualEvents()));
  assert.deepEqual(second, [{ act: 'cast', elId: 'tp-float', target: null, lockMs: 0, kind: 'act' }]);
});

test('CAST-4 主執行緒：act 事件直接交給戰鬥渲染器；背景分頁不轉', () => {
  const got = [];
  const c = { BattleRenderer: { onAct: (ev) => got.push(ev.act) }, suspended: false };
  c.uiRenderingSuspended = () => c.suspended;
  vm.createContext(c);
  vm.runInContext(fn(ui, 'handleWorkerUiEvents'), c);
  c.handleWorkerUiEvents([{ kind: 'act', act: 'cast', elId: 'pv-float' }]);
  assert.deepEqual(got, ['cast']);
  c.suspended = true;
  c.handleWorkerUiEvents([{ kind: 'act', act: 'cast', elId: 'pv-float' }]);
  assert.deepEqual(got, ['cast'], '背景分頁什麼都不畫');
});

function loadOnAct() {
  const calls = [], turns = [], timers = [];
  const p = { root: { x: 0, y: 0 }, dead: false, revival: null, facing: 1 };
  const c = {
    Math, POS_BUFFER_MS: 120,
    S: { ready: true, player: p, entities: { 'mv-float-3': { root: { x: -40, y: 30 } } } },
    documentHidden: () => false,
    setTimeout: (f, ms) => timers.push([f, ms]),
    turnToward: (ent, dx, dy, sticky) => turns.push([dx, dy, sticky]),
    playerAttackAnim: (...args) => calls.push(args)
  };
  vm.createContext(c);
  vm.runInContext(fn(renderer, 'onAct'), c);
  return { c, p, calls, turns, timers };
}

test('CAST-5 渲染器 onAct：延後 POS_BUFFER_MS（與特效同步）、面向目標、播施法並帶硬直；高塔與死亡時略過', () => {
  const { c, p, calls, turns, timers } = loadOnAct();
  c.onAct({ act: 'cast', elId: 'pv-float', target: 'mv-float-3', lockMs: 200 });
  assert.equal(calls.length, 0, '先延後，與特效同一套顯示延遲');
  assert.equal(timers[0][1], 120);
  timers[0][0]();
  assert.deepEqual(turns, [[-40, 30, false]], '腳底對腳底面向目標，不帶遲滯');
  assert.equal(p.facing, -1);
  assert.deepEqual(calls, [['cast', 'mv-float-3', 0, 200]]);

  c.onAct({ act: 'cast', elId: 'tp-float', target: 'tb-float', lockMs: 200, _buffered: true });
  p.dead = true;
  c.onAct({ act: 'cast', elId: 'pv-float', target: null, lockMs: 0, _buffered: true });
  assert.equal(calls.length, 1, '高塔不在這個渲染器；倒地時不擺施法姿勢');
});

test('CAST-6 施法動作的「釋放」幀對到硬直結束：預設 0.2 秒剛好 30 fps；上下限夾住', () => {
  const manifest = JSON.parse(read('images/sprites/knight/knight.json'));
  const cast = manifest.anims.cast;
  assert.ok(cast.release > cast.first, '幀定義要有 release（Special1 第 8 幀釋放）');
  const anims = {};
  for (const [k, a] of Object.entries(manifest.anims)) if (a.frames) anims[k] = new Array(a.frames - (a.first || 0)).fill(0);
  const p = { sheetName: 'player', body: { animationSpeed: 1 }, dead: false, curAnim: 'idle' };
  const c = {
    Math, S: { player: p, sheets: { player: { manifest, anims } } },
    playAnim(ent, name) { ent.curAnim = name; p.body.animationSpeed = manifest.anims[name].fps / 60; }
  };
  vm.createContext(c);
  vm.runInContext('var CAST_FPS_MIN = ' + /CAST_FPS_MIN = (\d+)/.exec(renderer)[1] + ', CAST_FPS_MAX = ' +
    /CAST_FPS_MAX = (\d+)/.exec(renderer)[1] + ';' + fn(renderer, 'playerAttackAnimNames') + ';' + fn(renderer, 'playerAttackAnim'), c);
  const fpsFor = (leadMs) => { p.curAnim = 'idle'; c.playerAttackAnim('cast', null, 0, leadMs); return p.body.animationSpeed * 60; };
  assert.equal(p.curAnim, 'idle');
  const frames = cast.release - cast.first;
  assert.ok(Math.abs(fpsFor(200) - frames / 0.2) < 1e-9, 'first→release 在硬直內播完');
  assert.ok(Math.abs(fpsFor(200) - 30) < 1e-9, '預設硬直 0.2 秒 ＝ 30 fps，與其他動作同速');
  assert.equal(fpsFor(20), 60, '硬直很短：上限 60 fps，不快成一閃');
  assert.equal(fpsFor(5000), 12, '硬直很長：下限 12 fps，不慢成停格');
  assert.equal(fpsFor(0), cast.fps, '沒有硬直：照幀定義的 fps');
});

test('CAST-7 技能特效事件不再帶動角色動作（避免同一次施放一直重播）；普攻照舊', () => {
  const animations = [];
  const c = {
    S: { ready: true, player: { root: { x: 0, y: 0 } }, entities: {}, vfxrt: { tryPlay: () => false } },
    areaRect: () => null, documentHidden: () => false, vfxTargetsLive: () => true, posOf: () => ({ x: 10, y: 0 }),
    turnToward() {}, playerAttackAnim: (...args) => animations.push(args)
  };
  vm.createContext(c);
  vm.runInContext(fn(renderer, 'shouldAnimatePlayer') + ';' + fn(renderer, 'onVfx'), c);
  for (const cat of ['magic', 'phys']) {
    /* 後面的程式畫法缺依賴會丟錯；角色動作在那之前就決定了，所以只看有沒有被叫到 */
    try { c.onVfx({ _buffered: true, fxKind: 'slash', cat, targets: ['enemy'], dur: 0.3 }); } catch (e) { /* 畫法缺依賴 */ }
  }
  assert.deepEqual(animations, [], '技能的施法動作只由 act 事件驅動');
  c.S.vfxrt.tryPlay = () => true;
  c.onVfx({ _buffered: true, fxKind: 'slash', cat: 'basic', variant: 'melee', targets: ['enemy'], dur: 0.125 });
  assert.deepEqual(animations, [['melee', 'enemy', 0.125]]);
});
