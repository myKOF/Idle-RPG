'use strict';
/* ============================================================
   vfx-editor-layers.test.cjs — Editor 的 Layer 管理

   受測對象：
     tools/vfx/editor/layer-model.js    多選／排序／複製／拖曳的純資料運算
     tools/vfx/editor/layout-schema.js  分組資料的驗證、序列化與自癒
     tools/vfx/editor-server.cjs        PUT /vfx/layouts/<id>.json

   為什麼這些邏輯不在 editor.js 裡測：它原本埋在 IIFE 內、綁著 DOM，
   只能靠人工點擊確認。而多選範圍、deep clone、拖曳搬移正是最容易寫錯、
   又最難用肉眼看出錯的部分，所以抽成純函式模組，editor.js 只負責畫面。

   全檔反覆驗證的一條不變量：
     **這些操作全部不得改變 zIndex。**
   繪製順序由 zIndex 決定（後端是 container.sortableChildren = true），
   一旦有人在拖曳或排序時順手改了它，畫面就會在「只是整理一下圖層」時變樣。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const M = require('../tools/vfx/editor/layer-model.js');
const LS = require('../tools/vfx/editor/layout-schema.js');
const editorServer = require('../tools/vfx/editor-server.cjs');
const VFXCore = require('../js/vfx-core.js');

const REPO = path.resolve(__dirname, '..');

/* ---------------- 測試資料 ---------------- */

/* 兩個群組各兩層，外加兩個未分組的層。刻意讓 zIndex 與陣列順序不一致，
   這樣「動了陣列順序卻沒動 zIndex」才驗得出來。 */
function fixture() {
  const preset = {
    schemaVersion: 1, id: 'fx', duration: 2, loop: true,
    layers: [
      { id: 'bg', type: 'sprite', assetId: 'a.png', zIndex: 0 },
      { id: 'orb-a-glow', type: 'sprite', assetId: 'a.png', zIndex: 10 },
      { id: 'orb-a-core', type: 'sprite', assetId: 'b.png', zIndex: 20 },
      { id: 'orb-b-glow', type: 'sprite', assetId: 'a.png', zIndex: 10 },
      { id: 'orb-b-core', type: 'sprite', assetId: 'b.png', zIndex: 20 },
      { id: 'sparks', type: 'sprite', assetId: 'c.png', zIndex: 30 }
    ]
  };
  const layout = {
    schemaVersion: 1, presetId: 'fx',
    order: ['layer:bg', 'group:orb-a', 'group:orb-b', 'layer:sparks'],
    groups: [
      { id: 'orb-a', name: 'Orb A', layerIds: ['orb-a-glow', 'orb-a-core'] },
      { id: 'orb-b', name: 'Orb B', layerIds: ['orb-b-glow', 'orb-b-core'] }
    ]
  };
  return { preset, layout };
}

function rowsOf(preset, layout, sortMode) {
  const rec = LS.reconcile(preset.layers, layout);
  return M.sortRows(rec.rows, sortMode || 'creation');
}

function zSnapshot(preset) {
  return preset.layers.map(l => l.id + '=' + l.zIndex).sort().join(',');
}

function orderOf(preset) { return preset.layers.map(l => l.id).join(','); }

/* ============================================================
   選取
   ============================================================ */

test('L1 普通點擊只選一項，selected 與 active 一致', function () {
  const { preset, layout } = fixture();
  const vis = M.visibleKeys(rowsOf(preset, layout), {});
  const r = M.applyClick({ selected: [], active: null, anchor: null }, vis, 'layer:bg', {});
  assert.deepEqual(r.selected, ['layer:bg']);
  assert.equal(r.active, 'layer:bg');
  assert.equal(r.anchor, 'layer:bg');
});

test('L2 Ctrl 點擊是 toggle：加選、再點取消', function () {
  const { preset, layout } = fixture();
  const vis = M.visibleKeys(rowsOf(preset, layout), {});
  let s = M.applyClick({ selected: [], active: null, anchor: null }, vis, 'layer:bg', {});
  s = M.applyClick(s, vis, 'layer:orb-a-core', { ctrl: true });
  s = M.applyClick(s, vis, 'layer:sparks', { ctrl: true });
  assert.deepEqual(s.selected, ['layer:bg', 'layer:orb-a-core', 'layer:sparks']);

  /* 再 Ctrl 點中間那一項 → 只有它被移除，其餘不動 */
  s = M.applyClick(s, vis, 'layer:orb-a-core', { ctrl: true });
  assert.deepEqual(s.selected, ['layer:bg', 'layer:sparks']);
  assert.equal(s.active, 'layer:orb-a-core', 'active 指向剛才操作的那一項，即使它已被取消選取');
});

test('L3 Shift 範圍以目前可見列表為準，且 anchor 不會被移動', function () {
  const { preset, layout } = fixture();
  const vis = M.visibleKeys(rowsOf(preset, layout), {});
  let s = M.applyClick({ selected: [], active: null, anchor: null }, vis, 'group:orb-a', {});
  s = M.applyClick(s, vis, 'layer:orb-b-glow', { shift: true });
  assert.deepEqual(s.selected,
    ['group:orb-a', 'layer:orb-a-glow', 'layer:orb-a-core', 'group:orb-b', 'layer:orb-b-glow']);
  assert.equal(s.anchor, 'group:orb-a');

  /* 再 Shift 一次往回縮：anchor 沒被移動，所以範圍能變小。
     每次 Shift 都重設 anchor 的話，這個操作就做不到。 */
  s = M.applyClick(s, vis, 'layer:orb-a-core', { shift: true });
  assert.deepEqual(s.selected, ['group:orb-a', 'layer:orb-a-glow', 'layer:orb-a-core']);
  assert.equal(s.anchor, 'group:orb-a');
});

test('L4 群組收合時，Shift 範圍不得選到看不見的子項', function () {
  const { preset, layout } = fixture();
  const collapsed = { 'orb-a': true };
  const vis = M.visibleKeys(rowsOf(preset, layout), collapsed);
  assert.deepEqual(vis,
    ['layer:bg', 'group:orb-a', 'group:orb-b', 'layer:orb-b-glow', 'layer:orb-b-core',
      'layer:sparks'],
    '收合的群組不得展開子項');

  let s = M.applyClick({ selected: [], active: null, anchor: null }, vis, 'layer:bg', {});
  s = M.applyClick(s, vis, 'layer:orb-b-glow', { shift: true });
  assert.ok(!s.selected.some(k => k.indexOf('orb-a-') >= 0),
    '不得選到收合起來的 Orb A 子項：' + s.selected.join(','));
});

test('L5 selected 與 active 是兩件事', function () {
  const { preset, layout } = fixture();
  const vis = M.visibleKeys(rowsOf(preset, layout), {});
  let s = M.applyClick({ selected: [], active: null, anchor: null }, vis, 'layer:bg', {});
  s = M.applyClick(s, vis, 'layer:sparks', { ctrl: true });
  assert.equal(s.selected.length, 2);
  assert.equal(s.active, 'layer:sparks', '多選時 active 只有一個，Inspector 顯示它');
});

/* ============================================================
   排序
   ============================================================ */

test('L6 建立順序＝preset.layers 的順序', function () {
  const { preset, layout } = fixture();
  const rows = rowsOf(preset, layout, 'creation');
  assert.deepEqual(rows.map(r => r.kind + ':' + r.id),
    ['layer:bg', 'group:orb-a', 'group:orb-b', 'layer:sparks']);
});

test('L7 名稱排序是穩定的 A→Z，群組內也排序', function () {
  const { preset, layout } = fixture();
  const rows = rowsOf(preset, layout, 'name');
  assert.deepEqual(rows.map(r => r.kind === 'group' ? r.name : r.id),
    ['Orb A', 'Orb B', 'bg', 'sparks']);
  const a = rows.find(r => r.id === 'orb-a');
  assert.deepEqual(a.layerIds, ['orb-a-core', 'orb-a-glow'], '群組內也要 A→Z');
});

test('L8 排序不得改動 preset、layout 或 zIndex（VIEW SORT ≠ RENDER ORDER）', function () {
  const { preset, layout } = fixture();
  const presetBefore = JSON.stringify(preset);
  const layoutBefore = JSON.stringify(layout);
  const zBefore = zSnapshot(preset);

  const rec = LS.reconcile(preset.layers, layout);
  const sorted = M.sortRows(rec.rows, 'name');
  sorted[0].name = 'MUTATED';                 // 動排序結果也不該影響來源
  sorted[0].layerIds && sorted[0].layerIds.push('ghost');

  assert.equal(JSON.stringify(preset), presetBefore, 'preset 不得被動到');
  assert.equal(JSON.stringify(layout), layoutBefore, 'layout 不得被動到');
  assert.equal(zSnapshot(preset), zBefore, 'zIndex 不得被動到');
});

/* ============================================================
   Copy / Paste
   ============================================================ */

test('L9 單層 copy/paste：新 id 唯一，內容相同', function () {
  const { preset, layout } = fixture();
  const clip = M.copySelection(preset, layout, ['layer:bg']);
  assert.equal(clip.items.length, 1);
  const keys = M.pasteClipboard(preset, layout, clip);
  assert.deepEqual(keys, ['layer:bg-copy']);
  const copy = M.layerById(preset, 'bg-copy');
  assert.equal(copy.assetId, 'a.png');
  assert.equal(copy.zIndex, 0);
  const ids = preset.layers.map(l => l.id);
  assert.equal(ids.length, new Set(ids).size, 'id 必須唯一');
});

test('L10 多選 copy/paste', function () {
  const { preset, layout } = fixture();
  const clip = M.copySelection(preset, layout, ['layer:bg', 'layer:sparks']);
  const keys = M.pasteClipboard(preset, layout, clip);
  assert.deepEqual(keys, ['layer:bg-copy', 'layer:sparks-copy']);
  assert.equal(preset.layers.length, 8);
});

test('L11 Group copy/paste：整組複製，子 id 全部重新產生', function () {
  const { preset, layout } = fixture();
  const clip = M.copySelection(preset, layout, ['group:orb-a']);
  const keys = M.pasteClipboard(preset, layout, clip);
  assert.deepEqual(keys, ['group:orb-a-copy']);

  const g = M.groupById(layout, 'orb-a-copy');
  assert.equal(g.name, 'Orb A Copy');
  assert.deepEqual(g.layerIds, ['orb-a-glow-copy', 'orb-a-core-copy']);

  const ids = preset.layers.map(l => l.id);
  assert.equal(ids.length, new Set(ids).size, 'layer id 必須唯一');
  const gids = layout.groups.map(x => x.id);
  assert.equal(gids.length, new Set(gids).size, 'group id 必須唯一');
});

test('L12 群組與其成員同時被選時，成員不會被複製兩次', function () {
  const { preset, layout } = fixture();
  const clip = M.copySelection(preset, layout,
    ['group:orb-a', 'layer:orb-a-glow', 'layer:orb-a-core']);
  assert.equal(clip.items.length, 1, '只該有那一個群組');
  M.pasteClipboard(preset, layout, clip);
  assert.equal(preset.layers.length, 8, '6 + 2，不是 6 + 4');
});

test('L13 deep copy：改副本不影響原件（不共用可變引用）', function () {
  const { preset, layout } = fixture();
  preset.layers[1].position = { x: 1, y: 2 };
  preset.layers[1].alphaOverLife = [[0, 0], [1, 1]];
  const before = JSON.stringify(M.layerById(preset, 'orb-a-glow'));

  const clip = M.copySelection(preset, layout, ['group:orb-a']);
  M.pasteClipboard(preset, layout, clip);

  const copy = M.layerById(preset, 'orb-a-glow-copy');
  copy.position.x = 999;
  copy.alphaOverLife[0][1] = 0.5;
  copy.zIndex = 777;

  assert.equal(JSON.stringify(M.layerById(preset, 'orb-a-glow')), before,
    '原件必須一個欄位都沒變');
});

test('L14 剪貼簿內容與 preset 也不共用引用', function () {
  const { preset, layout } = fixture();
  preset.layers[0].position = { x: 1, y: 1 };
  const clip = M.copySelection(preset, layout, ['layer:bg']);
  preset.layers[0].position.x = 42;           // 複製之後才改原件
  M.pasteClipboard(preset, layout, clip);
  assert.equal(M.layerById(preset, 'bg-copy').position.x, 1,
    '剪貼簿必須是複製當下的快照');
});

test('L15 刪除複製出來的群組，原件完全不受影響', function () {
  const { preset, layout } = fixture();
  const before = JSON.stringify(preset.layers.filter(l => l.id.indexOf('orb-a-') === 0));
  const layoutBefore = JSON.stringify(M.groupById(layout, 'orb-a'));

  const clip = M.copySelection(preset, layout, ['group:orb-a']);
  M.pasteClipboard(preset, layout, clip);
  M.deleteSelection(preset, layout, ['group:orb-a-copy']);

  assert.equal(preset.layers.length, 6, '回到原本的層數');
  assert.equal(preset.layers.filter(l => l.id.indexOf('copy') >= 0).length, 0, '沒有殘留副本');
  assert.equal(JSON.stringify(preset.layers.filter(l => /^orb-a-[a-z]+$/.test(l.id))), before);
  assert.equal(JSON.stringify(M.groupById(layout, 'orb-a')), layoutBefore);
});

test('L16 連續複製不會疊成 a-copy-copy-copy', function () {
  const { preset, layout } = fixture();
  let clip = M.copySelection(preset, layout, ['layer:bg']);
  M.pasteClipboard(preset, layout, clip);
  clip = M.copySelection(preset, layout, ['layer:bg-copy']);
  M.pasteClipboard(preset, layout, clip);
  const ids = preset.layers.map(l => l.id);
  assert.ok(ids.indexOf('bg-copy-2') >= 0, '應該是 bg-copy-2，實際：' + ids.join(','));
  assert.ok(ids.indexOf('bg-copy-copy') < 0);
});

/* ============================================================
   拖曳
   ============================================================ */

test('L17 群組內重新排序，zIndex 不變', function () {
  const { preset, layout } = fixture();
  const zBefore = zSnapshot(preset);
  M.applyDrop(preset, layout, ['layer:orb-a-core'], 'layer:orb-a-glow', 'before');
  assert.deepEqual(M.groupById(layout, 'orb-a').layerIds, ['orb-a-core', 'orb-a-glow']);
  assert.equal(zSnapshot(preset), zBefore, 'zIndex 不得改變');
  assert.equal(preset.layers.length, 6);
});

test('L18 把 root 的層拖進群組', function () {
  const { preset, layout } = fixture();
  const zBefore = zSnapshot(preset);
  M.applyDrop(preset, layout, ['layer:sparks'], 'group:orb-b', 'into');
  assert.deepEqual(M.groupById(layout, 'orb-b').layerIds,
    ['orb-b-glow', 'orb-b-core', 'sparks']);
  assert.equal(M.groupOfLayer(layout, 'sparks').id, 'orb-b');
  assert.equal(zSnapshot(preset), zBefore);
});

test('L19 把層從群組拖回 root', function () {
  const { preset, layout } = fixture();
  const presetBefore = JSON.stringify(preset);
  /* 丟到 root 的某一層前面 → 目標不屬於任何群組，所以自己也脫離群組 */
  M.applyDrop(preset, layout, ['layer:orb-a-core'], 'layer:bg', 'before');
  assert.equal(M.groupOfLayer(layout, 'orb-a-core'), null, '應該已不屬於任何群組');
  assert.deepEqual(M.groupById(layout, 'orb-a').layerIds, ['orb-a-glow']);
  /* authoring order 在 layout，不在 preset */
  assert.equal(layout.order.indexOf('layer:orb-a-core'), 0, 'layout.order 排到最前面');
  assert.equal(JSON.stringify(preset), presetBefore, 'preset 一個 byte 都不得變');
});

test('L20 拖動整個群組時，它的成員一起搬', function () {
  const { preset, layout } = fixture();
  const presetBefore = JSON.stringify(preset);
  M.applyDrop(preset, layout, ['group:orb-b'], 'layer:bg', 'before');
  assert.equal(layout.order[0], 'group:orb-b', 'layout.order 裡群組排到最前面');
  assert.deepEqual(M.groupById(layout, 'orb-b').layerIds, ['orb-b-glow', 'orb-b-core'],
    '群組成員關係不變');
  assert.equal(JSON.stringify(preset), presetBefore, 'preset 一個 byte 都不得變');
});

test('L21 拖曳只改 authoring order 與分組，不改任何渲染欄位', function () {
  const { preset, layout } = fixture();
  const renderBefore = preset.layers.map(l => JSON.stringify({
    id: l.id, zIndex: l.zIndex, assetId: l.assetId, type: l.type
  })).sort().join('|');

  M.applyDrop(preset, layout, ['layer:sparks'], 'group:orb-a', 'into');
  M.applyDrop(preset, layout, ['layer:orb-a-glow'], 'layer:bg', 'after');

  const renderAfter = preset.layers.map(l => JSON.stringify({
    id: l.id, zIndex: l.zIndex, assetId: l.assetId, type: l.type
  })).sort().join('|');
  assert.equal(renderAfter, renderBefore, '渲染相關欄位一個都不得變');
});

test('L22 丟回自己身上不做任何事', function () {
  const { preset, layout } = fixture();
  const before = JSON.stringify({ preset, layout });
  const did = M.applyDrop(preset, layout, ['layer:bg'], 'layer:bg', 'before');
  assert.equal(did, false);
  assert.equal(JSON.stringify({ preset, layout }), before);
});

/* ============================================================
   群組
   ============================================================ */

test('L23 組成群組：新 id 不帶 -copy，撞名才加序號', function () {
  const { preset, layout } = fixture();
  const gid = M.groupLayers(layout, ['bg', 'sparks'], 'Orb A');
  assert.equal(gid, 'orb-a-2', '已有 orb-a，所以是 orb-a-2');
  const fresh = { schemaVersion: 1, presetId: 'x', groups: [] };
  assert.equal(M.groupLayers(fresh, ['a'], 'Orb A'), 'orb-a', '沒撞名就用原本的 slug');
});

test('L24 一個 layer 只能屬於一個群組', function () {
  const { preset, layout } = fixture();
  M.groupLayers(layout, ['orb-a-glow', 'bg'], '新群組');
  assert.deepEqual(M.groupById(layout, 'orb-a').layerIds, ['orb-a-core'],
    '必須從舊群組移除');
  const all = layout.groups.reduce((a, g) => a.concat(g.layerIds), []);
  assert.equal(all.length, new Set(all).size, '不得有 layer 同時屬於兩個群組');
});

test('L25 解散群組只刪群組，圖層留著', function () {
  const { preset, layout } = fixture();
  M.ungroup(layout, ['orb-a']);
  assert.equal(M.groupById(layout, 'orb-a'), null);
  assert.equal(preset.layers.length, 6, '圖層一個都不能少');
  assert.ok(M.layerById(preset, 'orb-a-glow'));
});

test('L26 刪除群組會連同成員一起刪', function () {
  const { preset, layout } = fixture();
  M.deleteSelection(preset, layout, ['group:orb-a']);
  assert.equal(preset.layers.length, 4);
  assert.equal(M.layerById(preset, 'orb-a-glow'), null);
  assert.equal(M.groupById(layout, 'orb-a'), null);
});

test('L27 空掉的群組會被清掉', function () {
  const { preset, layout } = fixture();
  M.applyDrop(preset, layout, ['layer:orb-a-glow'], 'group:orb-b', 'into');
  M.applyDrop(preset, layout, ['layer:orb-a-core'], 'group:orb-b', 'into');
  assert.equal(M.groupById(layout, 'orb-a'), null, 'Orb A 已經沒有成員，應被移除');
});

/* ============================================================
   自癒：layout 與 preset 對不上時
   ============================================================ */

test('L28 layout 指到不存在的 layer → 安靜忽略，不是錯誤', function () {
  const { preset, layout } = fixture();
  layout.groups[0].layerIds.push('ghost-layer');
  const rec = LS.reconcile(preset.layers, layout);
  const g = rec.groups.find(x => x.id === 'orb-a');
  assert.deepEqual(g.layerIds, ['orb-a-glow', 'orb-a-core'], '幽靈 id 被丟掉');
  const total = rec.rows.filter(r => r.kind === 'layer').length +
    rec.rows.filter(r => r.kind === 'group').reduce((a, r) => a + r.layerIds.length, 0);
  assert.equal(total, preset.layers.length, '每個實際存在的 layer 剛好出現一次');
});

test('L29 沒被任何群組收的 layer 自動留在 root', function () {
  const { preset, layout } = fixture();
  layout.groups = [];
  const rec = LS.reconcile(preset.layers, layout);
  assert.equal(rec.rows.length, preset.layers.length);
  assert.ok(rec.rows.every(r => r.kind === 'layer'));
});

test('L30 同一個 layer 被兩個群組收：第一個有效，其餘忽略', function () {
  const { preset, layout } = fixture();
  layout.groups[1].layerIds.push('orb-a-glow');
  const rec = LS.reconcile(preset.layers, layout);
  assert.deepEqual(rec.groups.find(g => g.id === 'orb-a').layerIds,
    ['orb-a-glow', 'orb-a-core']);
  assert.deepEqual(rec.groups.find(g => g.id === 'orb-b').layerIds,
    ['orb-b-glow', 'orb-b-core']);
});

/* ============================================================
   layout schema
   ============================================================ */

test('L31 layout 驗證：未知欄位、重複 id、跨群組重複 layer 都要擋', function () {
  const ok = LS.validateLayout({ schemaVersion: 1, presetId: 'x', groups: [] });
  assert.ok(ok.ok, JSON.stringify(ok.errors));

  const unknown = LS.validateLayout({ schemaVersion: 1, presetId: 'x', groups: [], extra: 1 });
  assert.ok(!unknown.ok && unknown.errors.some(e => /extra/.test(e)));

  const dupGroup = LS.validateLayout({
    schemaVersion: 1, presetId: 'x',
    groups: [{ id: 'g', name: 'G', layerIds: [] }, { id: 'g', name: 'G2', layerIds: [] }]
  });
  assert.ok(!dupGroup.ok && dupGroup.errors.some(e => /群組 id 重複/.test(e)));

  const dupLayer = LS.validateLayout({
    schemaVersion: 1, presetId: 'x',
    groups: [{ id: 'a', name: 'A', layerIds: ['l1'] }, { id: 'b', name: 'B', layerIds: ['l1'] }]
  });
  assert.ok(!dupLayer.ok && dupLayer.errors.some(e => /重複收進多個群組/.test(e)));

  const badId = LS.validateLayout({
    schemaVersion: 1, presetId: 'x', groups: [{ id: 'Bad Id', name: 'X', layerIds: [] }]
  });
  assert.ok(!badId.ok);
});

test('L32 layout canonical 序列化是決定性的', function () {
  const a = { schemaVersion: 1, presetId: 'x',
    groups: [{ layerIds: ['b', 'a'], name: 'G', id: 'g' }] };
  const b = { presetId: 'x', groups: [{ id: 'g', name: 'G', layerIds: ['b', 'a'] }],
    schemaVersion: 1 };
  assert.equal(LS.serialiseLayout(a), LS.serialiseLayout(b), '欄位順序不同不得產生不同 bytes');
  assert.equal(LS.serialiseLayout(a), LS.serialiseLayout(JSON.parse(LS.serialiseLayout(a))),
    '冪等');
  assert.equal(LS.serialiseLayout(a).slice(-1), '\n');
});

/* ============================================================
   鍵盤安全
   ============================================================ */

test('L33 焦點在文字輸入時不得攔截 Ctrl+C / Ctrl+V', function () {
  const textLike = [
    { tagName: 'INPUT', type: 'text' },
    { tagName: 'INPUT', type: 'search' },
    { tagName: 'INPUT', type: 'number' },
    { tagName: 'INPUT' },                       // 未指定 type 等同 text
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true }
  ];
  textLike.forEach(function (el) {
    assert.equal(M.isTextEntry(el), true,
      JSON.stringify(el) + ' 是文字輸入，必須放行原生複製貼上');
  });

  const notText = [
    { tagName: 'INPUT', type: 'checkbox' },
    { tagName: 'INPUT', type: 'color' },
    { tagName: 'INPUT', type: 'range' },
    { tagName: 'BUTTON' },
    { tagName: 'DIV' },
    null
  ];
  notText.forEach(function (el) {
    assert.equal(M.isTextEntry(el), false,
      JSON.stringify(el) + ' 不是文字輸入，可以攔截');
  });
});

/* ============================================================
   與 Preset 的關係：不得污染
   ============================================================ */

test('L34 Core Schema 沒有 groups 欄位，分組不進 preset', function () {
  const src = fs.readFileSync(path.join(REPO, 'js', 'vfx-core.js'), 'utf8');
  assert.ok(!/PRESET_FIELDS\s*=\s*\[[^\]]*groups/.test(src),
    'preset schema 不得出現 groups');
  /* 反面確認：真的加進去會被 Core 擋下來 */
  const p = JSON.parse(fs.readFileSync(
    path.join(REPO, 'vfx', 'presets', 'demo-basic.json'), 'utf8'));
  p.groups = [];
  const r = VFXCore.validatePreset(p);
  assert.ok(!r.ok && r.errors.some(e => /groups/.test(e)),
    'Core 必須拒絕 preset 裡的 groups');
});

test('L35 所有分組操作跑完，preset 仍通過 validatePreset 且序列化穩定', function () {
  const p = JSON.parse(fs.readFileSync(
    path.join(REPO, 'vfx', 'presets', 'lightning-orb-field.json'), 'utf8'));
  const layout = JSON.parse(fs.readFileSync(
    path.join(REPO, 'vfx', 'layouts', 'lightning-orb-field.json'), 'utf8'));
  const zBefore = zSnapshot(p);

  const clip = M.copySelection(p, layout, ['group:orb-a']);
  M.pasteClipboard(p, layout, clip);
  M.deleteSelection(p, layout, ['group:orb-a-copy']);
  M.applyDrop(p, layout, ['layer:sparkles'], 'group:orb-b', 'into');
  M.applyDrop(p, layout, ['layer:sparkles'], 'layer:field-glow', 'after');

  const r = VFXCore.validatePreset(p);
  assert.ok(r.ok, '仍必須合法：' + r.errors.join('; '));
  assert.equal(zSnapshot(p), zBefore, 'zIndex 全程不變');
  assert.equal(VFXCore.serialisePreset(p), VFXCore.serialisePreset(JSON.parse(
    VFXCore.serialisePreset(p))), 'canonical 序列化仍冪等');
});

test('L36 lightning-orb-field 的正式 hierarchy 與 preset 完全對得上', function () {
  const p = JSON.parse(fs.readFileSync(
    path.join(REPO, 'vfx', 'presets', 'lightning-orb-field.json'), 'utf8'));
  const layout = JSON.parse(fs.readFileSync(
    path.join(REPO, 'vfx', 'layouts', 'lightning-orb-field.json'), 'utf8'));

  assert.ok(LS.validateLayout(layout).ok);
  assert.equal(layout.presetId, p.id);

  const rec = LS.reconcile(p.layers, layout);
  const inGroups = rec.groups.reduce((a, g) => a.concat(g.layerIds), []);
  const rootLayers = rec.rows.filter(r => r.kind === 'layer').map(r => r.id);
  assert.equal(inGroups.length + rootLayers.length, p.layers.length,
    '每個 layer 剛好出現一次');
  assert.deepEqual(rootLayers, ['field-glow', 'sparkles'], '未分組的應該只有這兩層');
  assert.equal(rec.groups.length, 7, 'Orb A～G');
  rec.groups.forEach(function (g) {
    assert.equal(g.layerIds.length, 4, g.name + ' 應該有 4 層（glow/body/core/arc）');
  });
});

/* ============================================================
   伺服器：layout 的存檔與持久化
   ============================================================ */

function makeSandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-layers-'));
  const repoRoot = path.join(base, 'repo');
  fs.mkdirSync(path.join(repoRoot, 'vfx', 'presets'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'vfx', 'layouts'), { recursive: true });
  return { base, repoRoot };
}

function withServer(sb) {
  const server = editorServer.__testOnly.createServer({
    repoRoot: sb.repoRoot, assetRoots: {}
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ server, port: server.address().port });
    });
  });
}

function request(port, opts, body) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      host: '127.0.0.1', port, method: opts.method || 'GET', path: opts.path,
      headers: opts.headers || {}, agent: false
    }, function (res) {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function putLayout(port, id, body) {
  return request(port, {
    method: 'PUT', path: '/vfx/layouts/' + id + '.json',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
}

async function withSandbox(fn) {
  const sb = makeSandbox();
  const h = await withServer(sb);
  try { await fn(sb, h); }
  finally {
    await new Promise(r => h.server.close(r));
    try { fs.rmSync(sb.base, { recursive: true, force: true }); } catch (e) { }
  }
}

test('L37 layout 存檔後可以原樣讀回（hierarchy 持久化）', async function () {
  await withSandbox(async function (sb, h) {
    const layout = { schemaVersion: 1, presetId: 'fx',
      groups: [{ id: 'orb-a', name: 'Orb A', layerIds: ['x', 'y'] }] };
    const res = await putLayout(h.port, 'fx', JSON.stringify(layout));
    assert.equal(res.status, 200, res.text);

    const file = path.join(sb.repoRoot, 'vfx', 'layouts', 'fx.json');
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text, LS.serialiseLayout(layout), '落檔的是 canonical 形式');
    assert.deepEqual(JSON.parse(text), layout);

    /* 再存一次相同內容 → bytes 完全一樣 */
    const again = await putLayout(h.port, 'fx', text);
    assert.equal(again.status, 200);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  });
});

test('L38 不合法的 layout 一律拒絕，且不寫檔', async function () {
  await withSandbox(async function (sb, h) {
    const file = path.join(sb.repoRoot, 'vfx', 'layouts', 'fx.json');
    const bad = [
      '{ not json',
      JSON.stringify({ schemaVersion: 99, presetId: 'fx', groups: [] }),
      JSON.stringify({ schemaVersion: 1, presetId: 'fx', groups: [], extra: 1 }),
      JSON.stringify({ schemaVersion: 1, presetId: 'other', groups: [] }),
      JSON.stringify({ schemaVersion: 1, presetId: 'fx',
        groups: [{ id: 'a', name: 'A', layerIds: ['l'] }, { id: 'b', name: 'B', layerIds: ['l'] }] })
    ];
    for (const body of bad) {
      const res = await putLayout(h.port, 'fx', body);
      assert.equal(res.status, 400, '應拒絕：' + body.slice(0, 50));
      assert.ok(!fs.existsSync(file), '不得產生檔案');
    }
  });
});

test('L39 layout 路由的 id 白名單與 preset 同一套（路徑穿越）', async function () {
  await withSandbox(async function (sb, h) {
    const hostile = ['..', '../x', '%2e%2e', 'a/b', 'a\\b', 'C:/x', 'A', 'con', ''];
    for (const id of hostile) {
      const res = await putLayout(h.port, id, '{}');
      assert.equal(res.status, 400, '應拒絕 layout id：' + JSON.stringify(id));
    }
    const files = fs.readdirSync(path.join(sb.repoRoot, 'vfx', 'layouts'));
    assert.deepEqual(files, [], '不得產生任何檔案');
  });
});

test('L40 layout 與 preset 是兩個獨立目錄，互不干擾', async function () {
  await withSandbox(async function (sb, h) {
    const preset = JSON.parse(fs.readFileSync(
      path.join(REPO, 'vfx', 'presets', 'demo-basic.json'), 'utf8'));
    const body = JSON.stringify(preset);
    const r1 = await request(h.port, {
      method: 'PUT', path: '/vfx/presets/demo-basic.json',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, body);
    assert.equal(r1.status, 200, r1.text);

    const layout = JSON.stringify({ schemaVersion: 1, presetId: 'demo-basic',
      groups: [{ id: 'g', name: 'G', layerIds: ['bg'] }] });
    const r2 = await putLayout(h.port, 'demo-basic', layout);
    assert.equal(r2.status, 200, r2.text);

    assert.ok(fs.existsSync(path.join(sb.repoRoot, 'vfx', 'presets', 'demo-basic.json')));
    assert.ok(fs.existsSync(path.join(sb.repoRoot, 'vfx', 'layouts', 'demo-basic.json')));
    /* export-assets 只掃 vfx/presets，所以 layout 不會被當成一份 preset */
    assert.deepEqual(fs.readdirSync(path.join(sb.repoRoot, 'vfx', 'presets')),
      ['demo-basic.json']);
  });
});

test('L41 editor.js 不得自己再寫一份 layer 運算（只能委派給 layer-model）', function () {
  const src = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8');
  assert.ok(/var M = VFXLayerModel;/.test(src), 'editor.js 必須載入共用模組');
  ['applyClick', 'applyDrop', 'pasteClipboard', 'copySelection', 'deleteSelection',
    'groupLayers', 'sortRows', 'visibleKeys', 'isTextEntry'].forEach(function (fn) {
    assert.ok(new RegExp('M\\.' + fn + '\\(').test(src),
      'editor.js 必須呼叫 M.' + fn + '，而不是自己實作一份');
  });
  const html = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'index.html'), 'utf8');
  assert.ok(/layer-model\.js/.test(html) && /layout-schema\.js/.test(html),
    'Editor 頁面必須載入這兩個共用模組');
});

/* ============================================================
   Codex Full Review 修正的回歸保護

   最重要的一組：**實際 runtime 輸出**的比對。
   先前只比對「zIndex / assetId / position / scale / alpha 有沒有變」，
   結論是「拖曳不改畫面」——那個結論是錯的，因為它比的是欄位不是輸出。
   Core 的粒子亂數種子綁在 preset.layers 的陣列索引上
   （rng: makeRng(effect.seed + i * 0x9E3779B9)），相同 zIndex 的繪製順序
   又由 child 加入順序決定，所以重排陣列會改變畫面。
   下面改成跑真的 runtime、記錄每一幀每個 node 收到的完整 transform。
   ============================================================ */

const crypto = require('node:crypto');

/* 記錄式後端：把 runtime 實際送給繪圖層的每一筆 transform 收集起來。
   node id 依建立順序不同，所以指紋排序後再比——比較的是「畫面上有什麼」，
   不是「以什麼順序被建立」。 */
function renderFingerprint(preset) {
  const shipped = JSON.parse(fs.readFileSync(
    path.join(REPO, 'vfx', 'shipped-assets.json'), 'utf8'));
  const log = [];
  let nextId = 1;
  const r3 = v => (v === undefined ? '-' : Math.round(v * 1000) / 1000);
  const backend = {
    createNode() { return nextId++; },
    updateNode(node, t) {
      log.push([t.visible, r3(t.x), r3(t.y), r3(t.rotation), r3(t.scaleX), r3(t.scaleY),
        r3(t.alpha), t.tint, t.zIndex].join(','));
    },
    destroyNode() { },
    destroy() { }
  };
  const rt = VFXCore.createRuntime({
    backend,
    resolver: VFXCore.createIndexResolver(shipped, shipped.baseUrl)
  });
  rt.registerPreset(preset);
  rt.play(preset.id, { position: { x: 0, y: 0 }, seed: 12345 });
  for (let i = 0; i < 120; i++) rt.update(1 / 60);
  const sorted = log.slice().sort();
  return {
    hash: crypto.createHash('sha256').update(sorted.join('|')).digest('hex'),
    lines: log.length
  };
}

function realPreset() {
  return JSON.parse(fs.readFileSync(
    path.join(REPO, 'vfx', 'presets', 'lightning-orb-field.json'), 'utf8'));
}
function realLayout() {
  return JSON.parse(fs.readFileSync(
    path.join(REPO, 'vfx', 'layouts', 'lightning-orb-field.json'), 'utf8'));
}

test('R1 指紋函式本身有鑑別力（重排 preset.layers 會被抓到）', function () {
  /* 這個測試證明 R2 不是因為指紋遲鈍才通過。
     直接重排陣列——正是舊版拖曳做的事——指紋必須改變。 */
  const a = realPreset();
  const before = renderFingerprint(a);
  const b = realPreset();
  const moved = b.layers.splice(b.layers.length - 1, 1)[0];
  b.layers.unshift(moved);
  const after = renderFingerprint(b);
  assert.notEqual(after.hash, before.hash,
    '重排 preset.layers 必須改變輸出，否則這個指紋量不到東西');
});

test('R2 純 authoring 拖曳後，runtime 指紋完全相同', function () {
  const preset = realPreset();
  const layout = realLayout();
  const before = renderFingerprint(preset);
  const presetJsonBefore = JSON.stringify(preset);

  /* 一整串 authoring 操作：群組排序、群組內排序、拖進群組、拖出群組 */
  M.applyDrop(preset, layout, ['group:orb-g'], 'group:orb-a', 'before');
  M.applyDrop(preset, layout, ['layer:orb-a-core'], 'layer:orb-a-glow', 'before');
  M.applyDrop(preset, layout, ['layer:sparkles'], 'group:orb-b', 'into');
  M.applyDrop(preset, layout, ['layer:sparkles'], 'layer:field-glow', 'after');
  M.applyDrop(preset, layout, ['group:orb-c'], 'layer:field-glow', 'before');

  assert.equal(JSON.stringify(preset), presetJsonBefore,
    'preset JSON 必須 byte-identical——authoring 操作不得碰它');
  const after = renderFingerprint(preset);
  assert.equal(after.hash, before.hash, 'runtime transform 指紋必須完全相同');
  assert.equal(after.lines, before.lines, 'transform 筆數也必須相同');
});

test('R3 相同 zIndex 的圖層不受 authoring 重排影響', function () {
  const preset = realPreset();
  const layout = realLayout();
  /* lightning-orb-field 有四組各 7 層共用同一個 zIndex，正是最危險的情境 */
  const byZ = {};
  preset.layers.forEach(l => { const z = l.zIndex || 0; (byZ[z] = byZ[z] || []).push(l.id); });
  const shared = Object.keys(byZ).filter(z => byZ[z].length > 1);
  assert.ok(shared.length >= 3, '這份 preset 應該有多組相同 zIndex：' + shared.join(','));

  const before = renderFingerprint(preset);
  const ids = byZ[shared[0]];
  M.applyDrop(preset, layout, ['layer:' + ids[ids.length - 1]], 'layer:' + ids[0], 'before');
  assert.equal(renderFingerprint(preset).hash, before.hash,
    '相同 zIndex 的層被 authoring 重排後，輸出仍必須相同');
});

test('R4 群組／收合／選取都不改 preset', function () {
  const preset = realPreset();
  const layout = realLayout();
  const before = JSON.stringify(preset);
  M.groupLayers(layout, ['field-glow', 'sparkles'], '雜項');
  M.ungroup(layout, ['orb-a']);
  M.sortRows(LS.reconcile(preset.layers, layout).rows, 'name');
  M.visibleKeys(LS.reconcile(preset.layers, layout).rows, { 'orb-b': true });
  assert.equal(JSON.stringify(preset), before, 'preset 不得被任何 authoring 操作改到');
});

/* ---- MAJOR 1：改 id ---- */

test('R5 改 layer id 時，群組成員關係與 order 都跟著更新', function () {
  const { preset, layout } = fixture();
  const ok = M.renameLayer(preset, layout, 'orb-a-core', 'orb-a-heart');
  assert.equal(ok, true);
  assert.equal(M.layerById(preset, 'orb-a-core'), null);
  assert.ok(M.layerById(preset, 'orb-a-heart'));
  assert.deepEqual(M.groupById(layout, 'orb-a').layerIds, ['orb-a-glow', 'orb-a-heart'],
    '改名後仍留在 Orb A');
  const rec = LS.reconcile(preset.layers, layout);
  const g = rec.groups.find(x => x.id === 'orb-a');
  assert.equal(g.layerIds.length, 2, '群組成員數不得因改名而減少');
  assert.ok(!rec.rows.some(r => r.kind === 'layer' && r.id === 'orb-a-heart'),
    '不得跑到 root');
});

test('R6 改 root 層的 id，order 參照也要更新', function () {
  const { preset, layout } = fixture();
  M.renameLayer(preset, layout, 'bg', 'background');
  assert.ok(layout.order.indexOf('layer:background') >= 0);
  assert.equal(layout.order.indexOf('layer:bg'), -1, '舊 key 必須被換掉');
  const rec = LS.reconcile(preset.layers, layout);
  assert.equal(rec.rows[0].id, 'background', '仍在原本的位置');
});

/* ---- MAJOR 4：群組副本名稱長度 ---- */

test('R7 群組副本名稱永遠不超過 schema 上限', function () {
  const max = LS.LIMITS.maxNameLength;
  [1, 10, 58, 59, 60, 63, 64].forEach(function (len) {
    const name = 'X'.repeat(len);
    const out = M.copyName(name, {});
    assert.ok(out.length <= max,
      len + ' 字的名稱複製後變成 ' + out.length + ' 字，超過上限 ' + max);
    assert.ok(/ Copy$/.test(out), '應以 " Copy" 結尾：' + out);
  });
});

test('R8 重複複製產生序號而不是 Copy Copy Copy', function () {
  const taken = {};
  const a = M.copyName('Orb A', taken);
  const b = M.copyName('Orb A', taken);
  const c = M.copyName(a, taken);
  assert.equal(a, 'Orb A Copy');
  assert.equal(b, 'Orb A Copy 2');
  assert.equal(c, 'Orb A Copy 3', '從副本再複製也不得疊成 Copy Copy');
  assert.ok(!/Copy Copy/.test(c));
});

test('R9 長名稱多次複製，每一份都合法且不重複', function () {
  const layout = { schemaVersion: 1, presetId: 'x', order: [], groups: [] };
  const preset = { id: 'x', layers: [{ id: 'a' }] };
  layout.groups.push({ id: 'g', name: 'Y'.repeat(63), layerIds: ['a'] });
  layout.order.push('group:g');
  for (let i = 0; i < 3; i++) {
    const clip = M.copySelection(preset, layout, ['group:g']);
    M.pasteClipboard(preset, layout, clip);
  }
  const names = layout.groups.map(g => g.name);
  assert.equal(names.length, 4);
  names.forEach(n => assert.ok(n.length <= LS.LIMITS.maxNameLength, n.length + ' 字：' + n));
  assert.equal(new Set(names).size, names.length, '名稱不得重複：' + names.join(' | '));
  const v = LS.validateLayout(layout);
  assert.ok(v.ok, JSON.stringify(v.errors));
});

/* ---- MAJOR 5：指示線與 model 一致 ---- */

test('R10 UI 顯示的落點模式與 model 實際行為一致', function () {
  /* 群組不能丟進群組（這一版不支援巢狀），所以 into 必須被判為不允許，
     UI 才不會顯示一個做不到的指示線。 */
  assert.equal(M.dropModeAllowed(['group:a'], 'group:b', 'into'), false);
  assert.equal(M.dropModeAllowed(['layer:x'], 'group:b', 'into'), true);
  assert.equal(M.dropModeAllowed(['layer:x'], 'layer:y', 'into'), false, '圖層不是容器');
  ['before', 'after'].forEach(m => {
    assert.equal(M.dropModeAllowed(['group:a'], 'group:b', m), true);
  });

  /* model 端：不允許的 into 直接拒絕，不靜默降級 */
  const { preset, layout } = fixture();
  const snapshot = JSON.stringify({ preset, layout });
  assert.equal(M.applyDrop(preset, layout, ['group:orb-a'], 'group:orb-b', 'into'), false);
  assert.equal(JSON.stringify({ preset, layout }), snapshot, '被拒絕的操作不得有副作用');

  /* editor.js 的指示線必須呼叫同一個判斷函式 */
  const src = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8');
  const fn = src.slice(src.indexOf('function dropModeFor('), src.indexOf('function performDrop('));
  assert.ok(/M\.dropModeAllowed\(/.test(fn),
    'dropModeFor 必須用 model 的 dropModeAllowed 判斷，不能自己另有一套');
});

/* ---- MINOR 2：純 authoring 不重建 runtime ---- */

test('R11 拖曳不觸發 preview runtime 重建', function () {
  const src = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8');
  /* 註解裡會寫「這裡刻意不呼叫 onPresetChanged()」，直接搜字串會打到它。
     先把註解剝掉，斷言的才是真正的程式碼。 */
  const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const fn = stripComments(src.slice(src.indexOf('function performDrop('),
    src.indexOf('function dropEmptyGroups(')));
  assert.ok(fn.length > 100, '切片要真的涵蓋 performDrop');
  assert.ok(!/onPresetChanged\s*\(/.test(fn),
    'performDrop 不得呼叫 onPresetChanged——那會停掉並重建整個 preview runtime');
  assert.ok(/renderLayerList\s*\(/.test(fn), '但仍要重畫圖層列表');

  ['function groupSelection(', 'function ungroupSelection('].forEach(function (marker) {
    const at = src.indexOf(marker);
    assert.ok(at > 0, marker);
    const body = stripComments(src.slice(at, src.indexOf('\n  }', at)));
    assert.ok(!/onPresetChanged\s*\(/.test(body), marker + ' 不得重建 runtime');
  });
});

/* ---- MAJOR 3：presetId 不符 ---- */

test('R12 layout 的 presetId 與目前 preset 不符時不得套用', function () {
  const src = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8');
  const fn = src.slice(src.indexOf('function loadLayout('), src.indexOf('function markLayoutDirty('));
  assert.ok(/raw\.presetId !== presetId/.test(fn), 'loadLayout 必須比對 presetId');
  assert.ok(/emptyLayout\(presetId\)/.test(fn), '不符時退回空 layout');
  assert.ok(/error:/.test(fn), '必須把原因說出來，不能安靜變成空白');
  assert.ok(!/serialiseLayout/.test(fn), '不得自動覆寫壞掉的檔案');
});

/* ---- MAJOR 2：存檔競態 ---- */

test('R13 layout 存檔採 revision 語意，飛行中的改動不會被當成已存檔', function () {
  const src = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8');
  const save = src.slice(src.indexOf('function saveLayout('),
    src.indexOf('/* ---------------- 收合狀態'));
  assert.ok(/var sentAt = state\.layoutRevision/.test(save), '送出時必須記下版本號');
  assert.ok(/state\.layoutRevision \|\| 0\) === sentAt/.test(save),
    '只有版本號沒變才能清 dirty');
  assert.ok(!/^\s*state\.layoutDirty = false;\s*$/m.test(save.replace(/if \([^)]*\) /g, '')),
    '不得無條件清 dirty');
  const mark = src.slice(src.indexOf('function markLayoutDirty('),
    src.indexOf('function saveLayout('));
  assert.ok(/layoutRevision = \(state\.layoutRevision \|\| 0\) \+ 1/.test(mark),
    '每次改動都要 +1');
});

/* ---- MINOR 1：壞掉的 layout ---- */

test('R14 壞掉的 layout 退回 deterministic root view，且不動 preset', function () {
  const preset = realPreset();
  const before = JSON.stringify(preset);
  const broken = {
    schemaVersion: 1, presetId: 'lightning-orb-field',
    groups: [{ id: 'a', name: 'A', layerIds: ['x'] }, { id: 'a', name: 'B', layerIds: ['y'] }]
  };
  assert.ok(!LS.validateLayout(broken).ok, '這份 layout 應該是不合法的');

  const rec = LS.reconcile(preset.layers, LS.emptyLayout('lightning-orb-field'));
  assert.equal(rec.rows.length, preset.layers.length, '每個 layer 剛好出現一次');
  assert.ok(rec.rows.every(r => r.kind === 'layer'));
  assert.equal(JSON.stringify(preset), before, 'preset 不得被影響');
});

/* ---- order 的自癒與驗證 ---- */

test('R15 order 裡的幽靈項目與遺漏項目都能自癒', function () {
  const { preset, layout } = fixture();
  layout.order = ['layer:ghost', 'group:nope', 'group:orb-b'];
  const rec = LS.reconcile(preset.layers, layout);
  const seen = [];
  rec.rows.forEach(r => {
    if (r.kind === 'layer') seen.push(r.id);
    else r.layerIds.forEach(id => seen.push(id));
  });
  assert.equal(seen.length, preset.layers.length, '每個 layer 剛好出現一次');
  assert.equal(new Set(seen).size, seen.length, '不得重複');
  assert.equal(rec.rows[0].id, 'orb-b', 'order 有提到的排在前面');
});

test('R16 layout.order 的驗證：格式與重複', function () {
  const base = { schemaVersion: 1, presetId: 'x', groups: [] };
  assert.ok(LS.validateLayout(Object.assign({}, base, { order: ['layer:a', 'group:b'] })).ok);
  const badKey = LS.validateLayout(Object.assign({}, base, { order: ['nope'] }));
  assert.ok(!badKey.ok && badKey.errors.some(e => /layer:<id>/.test(e)));
  const dup = LS.validateLayout(Object.assign({}, base, { order: ['layer:a', 'layer:a'] }));
  assert.ok(!dup.ok && dup.errors.some(e => /重複/.test(e)));
});

test('R17 order 存檔後可原樣讀回', async function () {
  await withSandbox(async function (sb, h) {
    const layout = {
      schemaVersion: 1, presetId: 'fx',
      groups: [{ id: 'g', name: 'G', layerIds: ['b'] }],
      order: ['layer:a', 'group:g', 'layer:c']
    };
    const res = await putLayout(h.port, 'fx', JSON.stringify(layout));
    assert.equal(res.status, 200, res.text);
    const text = fs.readFileSync(path.join(sb.repoRoot, 'vfx', 'layouts', 'fx.json'), 'utf8');
    assert.deepEqual(JSON.parse(text).order, layout.order);
    assert.equal(text, LS.serialiseLayout(layout), 'canonical');
  });
});

/* ============================================================
   第二批 Production UX
     P  貼上的插入位置（以 active 為錨點，不是丟到列表最下面）
     D  Delete 鍵刪除，且不能吃掉輸入框裡的文字刪除
     K  Asset Picker（選 assetId，不選檔案系統路徑）

   同一條不變量繼續適用：這些都是 authoring 操作，
   **不得改變 zIndex，也不得重排 preset.layers**。
   ============================================================ */

/* 只看程式碼，不看註解：註解裡出現的字串不算實作。 */
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('P1 貼上落在 active 的下一列，不是整個列表的最後', function () {
  const { preset, layout } = fixture();
  const z = zSnapshot(preset);
  const clip = M.copySelection(preset, layout, ['layer:sparks']);
  M.pasteClipboard(preset, layout, clip, 'layer:bg');
  assert.deepEqual(layout.order,
    ['layer:bg', 'layer:sparks-copy', 'group:orb-a', 'group:orb-b', 'layer:sparks'],
    '副本要緊接在 active 的 layer:bg 後面');
  /* 貼上一定會多一層，所以只比對「原本就在的那些層」的 zIndex */
  const kept = preset.layers.filter(l => l.id !== 'sparks-copy');
  assert.equal(zSnapshot({ layers: kept }), z, '既有圖層的 zIndex 不得改變');
});

test('P2 沒有 active 時才追加到最後（維持舊行為）', function () {
  const { preset, layout } = fixture();
  const clip = M.copySelection(preset, layout, ['layer:bg']);
  M.pasteClipboard(preset, layout, clip, null);
  assert.equal(layout.order[layout.order.length - 1], 'layer:bg-copy');
});

test('P3 active 在群組裡時，圖層副本貼進同一個群組', function () {
  const { preset, layout } = fixture();
  const clip = M.copySelection(preset, layout, ['layer:orb-a-glow']);
  M.pasteClipboard(preset, layout, clip, 'layer:orb-a-core');
  const g = M.groupById(layout, 'orb-a');
  assert.deepEqual(g.layerIds, ['orb-a-glow', 'orb-a-core', 'orb-a-glow-copy'],
    '要插在 active 的 orb-a-core 之後，仍留在群組內');
  assert.ok(layout.order.indexOf('layer:orb-a-glow-copy') < 0,
    '群組成員不得同時出現在頂層 order');
});

test('P4 群組副本插在來源群組之後（這版沒有巢狀群組）', function () {
  const { preset, layout } = fixture();
  const clip = M.copySelection(preset, layout, ['group:orb-a']);
  M.pasteClipboard(preset, layout, clip, 'group:orb-a');
  assert.equal(layout.order[1], 'group:orb-a', '來源仍在原位');
  assert.equal(M.keyKind(layout.order[2]), 'group', '副本緊接在後');
  assert.notEqual(layout.order[2], 'group:orb-a');
});

test('P5 active 是群組內的圖層時，群組副本落在該群組之後而不是群組裡', function () {
  const { preset, layout } = fixture();
  const clip = M.copySelection(preset, layout, ['group:orb-b']);
  M.pasteClipboard(preset, layout, clip, 'layer:orb-a-core');
  assert.equal(M.keyKind(layout.order[2]), 'group');
  assert.equal(layout.order[2].indexOf('group:orb-b'), 0, '副本 id 由 orb-b 衍生');
  const copyId = M.keyId(layout.order[2]);
  assert.ok(!M.groupById(layout, 'orb-a').layerIds.some(function (id) {
    return M.groupById(layout, copyId).layerIds.indexOf(id) >= 0;
  }), '不得把副本的成員塞進 orb-a');
});

test('P6 多選貼上時保持原本的相對順序', function () {
  const { preset, layout } = fixture();
  const clip = M.copySelection(preset, layout, ['layer:bg', 'layer:sparks']);
  M.pasteClipboard(preset, layout, clip, 'group:orb-a');
  const at = layout.order.indexOf('group:orb-a');
  assert.deepEqual(layout.order.slice(at + 1, at + 3), ['layer:bg-copy', 'layer:sparks-copy'],
    '兩份副本依序排在錨點之後，順序與來源一致');
});

test('P7 貼上只是新增，不重排 preset.layers（runtime 指紋不受既有層影響）', function () {
  const { preset, layout } = fixture();
  const before = orderOf(preset);
  const clip = M.copySelection(preset, layout, ['layer:sparks']);
  M.pasteClipboard(preset, layout, clip, 'layer:bg');
  assert.equal(orderOf(preset).indexOf(before), 0,
    '既有圖層的陣列順序完全不動，新的一律接在尾端');
});

test('D1 Delete 刪掉整個選取集合', function () {
  const { preset, layout } = fixture();
  M.deleteSelection(preset, layout, ['layer:bg', 'layer:sparks']);
  assert.equal(M.layerById(preset, 'bg'), null);
  assert.equal(M.layerById(preset, 'sparks'), null);
  assert.equal(preset.layers.length, 4);
});

test('D2 刪群組會連成員一起刪，不留孤兒圖層', function () {
  const { preset, layout } = fixture();
  M.deleteSelection(preset, layout, ['group:orb-a']);
  assert.equal(M.groupById(layout, 'orb-a'), null);
  assert.equal(M.layerById(preset, 'orb-a-glow'), null);
  assert.equal(M.layerById(preset, 'orb-a-core'), null);
  assert.ok(layout.order.indexOf('group:orb-a') < 0);
});

test('D3 Delete 只在沒有文字焦點時作用（輸入框保留原生刪字）', function () {
  /* isTextEntry 是唯一的守門員，這裡直接驗它認得所有會打字的東西 */
  const cases = [
    [{ tagName: 'INPUT', type: 'text' }, true, '文字框'],
    [{ tagName: 'INPUT', type: 'search' }, true, '搜尋框'],
    [{ tagName: 'INPUT', type: 'number' }, true, '數值框'],
    [{ tagName: 'TEXTAREA' }, true, 'JSON 參數框'],
    [{ tagName: 'SELECT' }, true, '下拉'],
    [{ tagName: 'DIV', isContentEditable: true }, true, 'contenteditable'],
    [{ tagName: 'INPUT', type: 'checkbox' }, false, '核取方塊'],
    [{ tagName: 'INPUT', type: 'range' }, false, '滑桿'],
    [{ tagName: 'INPUT', type: 'color' }, false, '色票'],
    [{ tagName: 'DIV' }, false, '一般容器'],
    [null, false, '沒有焦點']
  ];
  cases.forEach(function (c) {
    assert.equal(M.isTextEntry(c[0]), c[1], c[2] + ' 的判定不對');
  });
});

test('D4 editor.js 的 Delete 分支擋在 isTextEntry 之後', function () {
  const src = noComments(fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8'));
  const body = src.slice(src.indexOf('function onKeyDown'));
  const guard = body.indexOf('isTextEntry(document.activeElement)');
  const del = body.indexOf("k === 'delete'");
  assert.ok(guard >= 0 && del >= 0, 'onKeyDown 要同時有守門與 Delete 分支');
  assert.ok(guard < del, 'isTextEntry 必須先擋，否則在輸入框裡按 Delete 會刪掉圖層');
});

test('D5 Delete 後焦點落在鄰近一列，而不是整個清空', function () {
  const src = noComments(fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8'));
  /* 實際刪除的邏輯在 deleteSelectionInner——外層只是把它包成一筆歷史。 */
  const fn = src.slice(src.indexOf('function deleteSelectionInner'));
  const end = fn.indexOf('\n  }');
  assert.ok(/survivor/.test(fn.slice(0, end)),
    'deleteSelection 要挑一個倖存列接手焦點');
});

test('K1 Inspector 的 assetId 欄位提供 Asset Picker 按鈕', function () {
  const src = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8');
  assert.ok(/openPicker\(layer, f\.key\)/.test(src), 'assetId 欄位要能開啟 Picker');
  const html = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'index.html'), 'utf8');
  ['picker', 'picker-list', 'picker-preview', 'picker-meta', 'picker-apply', 'picker-close']
    .forEach(function (id) {
      assert.ok(new RegExp('id="' + id + '"').test(html), 'Picker 缺少 #' + id);
    });
});

test('K2 Picker 重用 filterAssets，沒有第二套搜尋實作', function () {
  const src = noComments(fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8'));
  assert.equal((src.match(/function filterAssets\(/g) || []).length, 1,
    '只能有一份 filterAssets');
  assert.equal((src.match(/function currentAssetFilters\(/g) || []).length, 1,
    '只能有一份篩選讀取');
  assert.ok(/filterAssets\('pf-'/.test(src), 'Picker 必須呼叫同一個 filterAssets');
  assert.ok(/filterAssets\('f-'/.test(src), 'Asset Browser 也走同一個');
  /* 兩組控制項的欄位必須一一對應，否則共用的讀取函式會拿到 undefined */
  const html = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'index.html'), 'utf8');
  ['text', 'usage', 'shape', 'element', 'tag', 'high'].forEach(function (f) {
    assert.ok(new RegExp('id="f-' + f + '"').test(html), '缺少 f-' + f);
    assert.ok(new RegExp('id="pf-' + f + '"').test(html), '缺少 pf-' + f);
  });
});

test('K3 Picker 寫回的是 index 裡的 assetId，不是檔案系統路徑', function () {
  const src = noComments(fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8'));
  assert.ok(!/type\s*=\s*'file'/.test(src) && !/showOpenFilePicker/.test(src),
    '不得用作業系統的檔案選擇器：那會選到本機絕對路徑，寫進 Preset 就不可攜');
  /* 候選清單只可能來自 semantics.records，那份的 assetId 一律是 index 的 id。
     套用時把選中的 assetId 寫進圖層的那個欄位——變數名稱不重要，
     重要的是來源是 picker.selected，不是任何檔案系統路徑。 */
  const applyFn = src.slice(src.indexOf('function applyPicker'));
  const applyBody = applyFn.slice(0, applyFn.indexOf('\n  }'));
  assert.ok(/picker\.selected/.test(applyBody), '套用的值必須來自 Picker 的選取');
  assert.ok(/\[field\] = value|picker\.layer\[picker\.field\] = picker\.selected/.test(applyBody),
    'applyPicker 要把選中的 assetId 寫進圖層欄位');
  const index = JSON.parse(fs.readFileSync(
    path.join(REPO, 'vfx', 'asset-index.json'), 'utf8'));
  const bad = index.assets.filter(function (a) {
    return /^[A-Za-z]:[\\/]/.test(a.assetId) || a.assetId.indexOf('\\') >= 0;
  });
  assert.equal(bad.length, 0, 'index 裡不得有絕對路徑或反斜線形式的 assetId');
});

test('K4 Picker 的 blend／tintable 直接用共用推導，不抄第二份規則', function () {
  const vocab = require('../tools/vfx/vfx-semantic-vocab.cjs');
  const src = noComments(fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8'));
  assert.ok(/VFXSemanticVocab\.blendModeFromFacts\(/.test(src));
  assert.ok(/VFXSemanticVocab\.tintableFromFacts\(/.test(src));
  assert.ok(!/blackBackground/.test(src),
    'editor.js 不得自己再寫一次 backgroundVariant → blendMode 的對應');
  /* 這個模組現在同時被 Node 與瀏覽器載入，兩邊都必須拿得到同一份 */
  assert.equal(typeof vocab.blendModeFromFacts, 'function');
  assert.equal(vocab.blendModeFromFacts({ backgroundVariant: 'blackBackground' }), 'additive');
  const html = fs.readFileSync(
    path.join(REPO, 'tools', 'vfx', 'editor', 'index.html'), 'utf8');
  assert.ok(/vfx-semantic-vocab\.cjs/.test(html), 'Editor 頁面要載入詞彙模組');
});
