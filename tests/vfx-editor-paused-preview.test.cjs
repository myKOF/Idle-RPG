'use strict';
/* ============================================================
   vfx-editor-paused-preview.test.cjs — 暫停中改參數，預覽不能消失

   2026-09-16 使用者回報：VFX Editor 暫停時編輯特效（例如改 position），
   預覽整個消失，只剩 gizmo 的框。

   原因：改任何參數都走 rebuildPreview()——stopAll() 把舊的畫面物件收回池子，
   再 play(startTime) 重播一份。但 Core 的 play() 只建立狀態，畫面物件要等第一次
   update() 才生出來；而 ticker 暫停時第一行就 return，不呼叫 update。

   受測對象：tools/vfx/editor/editor.js 的 rebuildPreview 與 playPreview。
   兩個函式從原始碼挖出來，接上真的 VFX Core 與記錄型後端在 vm 裡跑，
   驗的是「後端實際收到什麼」，而不是程式碼裡有沒有某個字。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const VFXCore = require('../js/vfx-core.js');

const REPO = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');

/* 從 function 關鍵字開始數大括號，挖出整個函式。改名時這裡會直接失敗，不會靜靜跳過。 */
function extractFunction(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, '找不到 function ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(name + ' 的大括號沒有配對');
}

function spritePreset(x) {
  return {
    schemaVersion: 1, id: 'fx', duration: 1, loop: false,
    layers: [{ id: 'a', type: 'sprite', assetId: 'x.png', zIndex: 0,
      position: { x: x, y: 0 }, scale: { x: 1, y: 1 } }]
  };
}

/* Editor 預覽的最小組合：真的 Core ＋ 記錄每個節點最後一次 transform 的後端。 */
function editorPreview() {
  const nodes = [];
  const backend = {
    createNode: (spec) => { const n = { spec: spec, last: null }; nodes.push(n); return n; },
    updateNode: (node, t) => { node.last = Object.assign({}, t); },
    destroyNode: () => {}, destroy: () => {}
  };
  const runtime = VFXCore.createRuntime({
    backend: backend, resolver: { has: () => true, resolve: (id) => '/' + id }
  });
  const ctx = {
    state: { runtime: runtime, preset: spritePreset(0), playing: true, handle: null },
    $: () => ({ className: '', textContent: '' }),
    PREVIEW_SEED: 12345
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(SRC, 'playPreview') + '\n' + extractFunction(SRC, 'rebuildPreview') +
    '\nthis.rebuildPreview = rebuildPreview;', ctx);
  return {
    ctx: ctx, runtime: runtime,
    visible: () => nodes.filter((n) => n.last && n.last.visible)
  };
}

test('PAUSE-1 暫停中改參數：重建完馬上就有這一格，不必等 ticker', function () {
  const ed = editorPreview();
  ed.ctx.rebuildPreview();                                   // 開啟 preset，開始播放
  for (let i = 0; i < 10; i++) ed.runtime.update(1 / 40);    // ticker 播到 0.25 秒
  assert.equal(ed.visible().length, 1, '播放中應該看得到圖層');

  ed.ctx.state.playing = false;                              // 按下暫停
  const pausedAt = ed.runtime.timeOf(ed.ctx.state.handle);
  ed.ctx.state.preset = spritePreset(8);                     // Inspector 改 position.x
  ed.ctx.rebuildPreview();                                   // onPresetChanged／previewSoon 都走這裡
  /* 暫停時 ticker 不呼叫 update，所以這裡刻意不補任何 update */

  const shown = ed.visible();
  assert.equal(shown.length, 1, '暫停中改完參數，預覽不能整個消失');
  assert.equal(shown[0].last.x, 8, '畫出來的要是改過之後的參數');
  assert.ok(Math.abs(ed.runtime.timeOf(ed.ctx.state.handle) - pausedAt) < 1e-9,
    '暫停中重建不能讓播放頭前進：畫面要停在原本那一格');
});

test('PAUSE-2 暫停中連續改好幾次，畫面始終只有一份、而且是最新的', function () {
  const ed = editorPreview();
  ed.ctx.rebuildPreview();
  for (let i = 0; i < 10; i++) ed.runtime.update(1 / 40);
  ed.ctx.state.playing = false;
  [3, 5, 12].forEach(function (x) {
    ed.ctx.state.preset = spritePreset(x);
    ed.ctx.rebuildPreview();
    const shown = ed.visible();
    assert.equal(shown.length, 1, 'x=' + x + '：畫面上要剛好一份（0 份是預覽消失，多份是舊的沒收掉）');
    assert.equal(shown[0].last.x, x);
  });
});
