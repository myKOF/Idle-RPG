'use strict';
/* 3D 主角（內測）在戰鬥裡的動作規則。這些是看畫面才發現的問題（2026-10-27 內測回報），
   用原始碼比對把規則鎖住，避免之後改動又退回去。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const renderer = fs.readFileSync(require.resolve('../js/battle-renderer.js'), 'utf8');
const hero3d = fs.readFileSync(require.resolve('../js/hero3d.js'), 'utf8');

test('攻擊動作只播有用的一段：start／hit／end，不整段照播', () => {
  for (const name of ['attack1', 'attack2', 'cast']) {
    const m = hero3d.match(new RegExp(name + ':\\s*\\{[^}]*\\}'));
    assert.ok(m, name + ' 不在 CLIP_FOR');
    assert.match(m[0], /start: [\d.]+, hit: [\d.]+, end: [\d.]+/, name + ' 少了 start／hit／end');
  }
  /* 有 end 的動作到 end 就算播完，不等整段 clip */
  assert.match(hero3d, /currentCfg\.end && !currentCfg\.reverse && current\.time >= currentCfg\.end\) fireFinished\(\)/);
});

test('3D 普攻只用兩個動作、輪流出（不能再三選一讓其中一個佔 2/3）', () => {
  assert.match(renderer, /var HERO3D_ATTACKS = \['attack1', 'attack2'\]/);
  assert.match(renderer, /\(p\.body && p\.body\.hero3d\) \? HERO3D_ATTACKS : playerAttackAnimNames\(sheet\)/);
});

test('3D 施法：出手動作播放中不插施法動作；其餘時候快速播完（0.5 秒內）', () => {
  assert.match(renderer, /if \(!melee && p\.body && p\.body\.hero3d && HERO3D_ACTIONS\[p\.curAnim\]\) return;/);
  assert.match(renderer, /var HERO3D_CAST_MAX_MS = 500;/);
  assert.match(renderer, /p\.body\.naturalMs \/ HERO3D_CAST_MAX_MS/);
});

test('3D 出手動作一定是停下來播：有位移就立刻切跑步，不滑步', () => {
  assert.match(renderer, /p\.stillFor === 0 && HERO3D_ACTIONS\[p\.curAnim\]/);
  /* 看真正的位移，不看拖尾 0.22 秒的 p.walking */
  assert.doesNotMatch(renderer, /p\.walking && !p\.dead && p\.body\.hero3d/);
});

test('3D 起身：死亡動作倒著播，由復活倒數進度驅動（一般倒數與大地守護共用）', () => {
  /* seek 的 0..1 對倒著播的動作要反過來，否則起身會變成把死亡動作正著播 */
  assert.match(hero3d, /if \(currentCfg && currentCfg\.reverse\) fraction = 1 - fraction;/);
  assert.match(renderer, /function hero3dDriveRise\(p, progress\)/);
  assert.match(renderer, /if \(p\.body && p\.body\.hero3d\) hero3dDriveRise\(p, p\.deathFogK\)/);
  assert.match(renderer, /if \(p\.body && p\.body\.hero3d\) \{\s*hero3dDriveRise\(p, revivalProgress\)/);
  /* 倒下時把死亡動作加速到在倒數前段播完 */
  assert.match(renderer, /hero3dFitDie\(p, p\.deathFogDuration\)/);
  assert.match(renderer, /hero3dFitDie\(p, p\.revival\.endAt - p\.revival\.startAt\)/);
});
