'use strict';
/* ============================================================
   vfx-tower.test.cjs — 高塔的 VFX Preset 疊層

   受測對象：js/vfx-tower.js（第二個 Pixi 表面）與它的三處接線。

   這一層的主體是 DOM 幾何與 Pixi 生命週期，在 Node 裡跑不動；
   真正能自動驗的是**契約**：
     - 尺寸規則存在且分成三個係數（三種名目基準，用同一個數字縮會顧此失彼）
     - ui.js 的事件分流順序：野外 → 高塔疊層 → DOM 舊畫法
     - 面板重繪時 reconcile 狀態光環、離開戰鬥時清乾淨
     - 載入順序（疊層要在 ui.js 之前）
   幾何本身由 tests/vfx-runtime.test.cjs 的 PROFILE 四條負責（同一個 Adapter）。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const VFXTower = require('../js/vfx-tower.js');

test('TOWER-1 尺寸規則分成三個係數，各自對應一種名目基準', function () {
  const p = VFXTower.PROFILE;
  ['scale', 'areaScale', 'skyScale', 'groundR'].forEach(function (k) {
    assert.equal(typeof p[k], 'number', k + ' 必須是數字');
  });
  /* 卡片只有 202px 寬，而範圍類的名目直徑是 200px、天降是 500px 高——
     這兩個一定要縮，不縮就會爆框。角色身上的（名目身高 60px vs 人像 72px）則不必。 */
  assert.ok(p.areaScale < 1, '範圍類必須縮');
  assert.ok(p.skyScale < 1, '天降必須縮');
  assert.ok(p.groundR > 0, '高塔的事件沒有 area，場域要有一個名目半徑才畫得出來');
});

test('TOWER-2 模組不在載入時碰 DOM（Node 裡 require 得起來）', function () {
  assert.equal(typeof VFXTower.onVfx, 'function');
  assert.equal(typeof VFXTower.sync, 'function');
  assert.equal(typeof VFXTower.stop, 'function');
  /* 沒有 document 時也不能炸：事件進來一律回 false，交給 DOM 舊畫法。 */
  assert.equal(VFXTower.onVfx(null), false);
  assert.equal(VFXTower.onVfx({ targets: ['mv-float-1'] }), false, '野外定址不歸它管');
});

test('TOWER-3 ui.js 的事件分流順序：野外 → 高塔疊層 → DOM 舊畫法', function () {
  const ui = read('js/ui.js');
  const at = {
    field: ui.indexOf('BattleRenderer.wantsVfx(event)'),
    tower: ui.indexOf('VFXTower.onVfx(event)'),
    dom: ui.indexOf('playCombatVfx(event)')
  };
  assert.ok(at.field > 0 && at.tower > 0 && at.dom > 0, '三條路徑都要在');
  assert.ok(at.field < at.tower, '野外先問');
  assert.ok(at.tower < at.dom, '高塔疊層要在 DOM 舊畫法之前——它回 false 才輪到 DOM');
});

test('TOWER-4 面板重繪時 reconcile 狀態光環，離開戰鬥時清乾淨', function () {
  const ui = read('js/ui.js');
  assert.match(ui, /VFXTower\.sync\(p, b\)/, 'renderTowerFight 要把玩家與 BOSS 交給疊層 reconcile');
  assert.match(ui, /fightBox\.style\.display = 'none';[\s\S]{0,300}?VFXTower\.stop\(\)/,
    '收起戰鬥區時要清掉疊層上還在跑的特效');
});

test('TOWER-5 index.html 在 ui.js 之前載入疊層，且版號有跟著改', function () {
  const html = read('index.html');
  const at = { tower: html.indexOf('js/vfx-tower.js'), ui: html.indexOf('js/ui.js') };
  assert.ok(at.tower > 0, 'index.html 要載入 js/vfx-tower.js');
  assert.ok(at.tower < at.ui, '疊層要在 ui.js 之前——ui.js 的分流會直接用到它');
  /* 版號釘住：改了檔卻沒換版號，測試者會跑到快取舊檔。 */
  assert.match(html, /js\/vfx-runtime\.js\?v=1\.0\.2/);
  assert.match(html, /js\/vfx-tower\.js\?v=1\.0\.0/);
  assert.match(html, /js\/ui\.js\?v=1\.0\.58/);
});
