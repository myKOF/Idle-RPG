'use strict';
/* ============================================================
   vfx-editor-panes.test.cjs — VFX Editor 的多視窗預覽

   使用者的需求（2026-09-17）：
     1. 「新增視窗」把預覽區切成兩個，原本的在左、新的在右；最多四個（十字切開）
     2. 點哪個視窗焦點就到哪裡，在那裡載入特效、新增圖層——同時操作多份特效
     3. 視窗之間的圖層可以互相用：A 視窗複製 a1，到 B 視窗貼上
     4. Ctrl+點擊多選視窗，播放／暫停與預覽循環一起套用到選到的全部視窗

   受測對象：tools/vfx/editor/pane-model.js（純邏輯）。畫面接線的測試在最後一段。

   跨特效貼上「畫面不動」一律拿 Runtime 實際送給後端的節點數值比對（原本那份 vs 貼過去那份），
   不拿 pane-model 自己的換算對答案。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const P = require('../tools/vfx/editor/pane-model.js');
const H = require('../tools/vfx/editor/hierarchy-model.js');
const M = require('../tools/vfx/editor/layer-model.js');
const LS = require('../tools/vfx/editor/layout-schema.js');
const VFXCore = require('../js/vfx-core.js');

const REPO = path.resolve(__dirname, '..');
const RESOLVER = { has: () => true, resolve: (id) => '/' + id };

function preset(id, layers, extra) {
  return Object.assign({ schemaVersion: 1, id: id, duration: 1, loop: false, layers: layers }, extra || {});
}
function sprite(id, extra) {
  return Object.assign({ id: id, type: 'sprite', assetId: id + '.png' }, extra || {});
}
function empty(id, extra) {
  return Object.assign({ id: id, type: 'empty' }, extra || {});
}
function particle(id, extra) {
  return Object.assign({
    id: id, type: 'particle', assetId: id + '.png', lifetime: 0.5, speed: [20, 60], spread: 360,
    emission: { mode: 'burst', count: 4 }
  }, extra || {});
}
function rootLayout(p) {
  return { schemaVersion: 1, presetId: p.id,
    groups: [{ id: p.id, name: p.id, layerIds: p.layers.map((l) => l.id) }], order: ['group:' + p.id] };
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function errorsOf(p) { return VFXCore.validatePreset(p).errors.join('\n'); }

/* Runtime 在時間 t 送給每個節點的最後一份變換，只留 url 在 urls 裡的。 */
function framesAt(p, times, urls) {
  const nodes = [];
  const backend = {
    createNode: (spec) => { const n = { url: spec.assetUrl, last: null }; nodes.push(n); return n; },
    updateNode: (node, t) => { node.last = Object.assign({}, t); },
    destroyNode: () => {},
    destroy: () => {}
  };
  const rt = VFXCore.createRuntime({ backend: backend, resolver: RESOLVER });
  rt.registerPreset(p);
  rt.play(p.id, { seed: 7 });
  const out = [];
  let now = 0;
  times.forEach(function (t) {
    rt.update(t - now);
    now = t;
    out.push(nodes.filter((n) => n.last && n.last.visible && urls.indexOf(n.url) >= 0).map(function (n) {
      const s = n.last;
      const skew = s.skewX || 0;
      return {
        url: n.url, x: s.x, y: s.y,
        a: Math.cos(s.rotation) * s.scaleX, b: Math.sin(s.rotation) * s.scaleX,
        c: -Math.sin(s.rotation - skew) * s.scaleY, d: Math.cos(s.rotation - skew) * s.scaleY
      };
    }));
  });
  return out;
}

function assertSameScreen(before, after, eps, label) {
  assert.equal(after.length, before.length, label + '：時間點數量');
  before.forEach(function (frame, i) {
    assert.equal(after[i].length, frame.length, label + '：第 ' + i + ' 個時間點看得到的節點數 ' +
      frame.length + ' → ' + after[i].length);
    frame.forEach(function (n, j) {
      const m = after[i][j];
      ['x', 'y', 'a', 'b', 'c', 'd'].forEach(function (k) {
        assert.ok(Math.abs(m[k] - n[k]) <= eps, label + '：' + n.url + ' 的 ' + k + ' 在第 ' + i +
          ' 個時間點從 ' + n[k] + ' 變成 ' + m[k]);
      });
    });
  });
}

/* A 視窗複製、B 視窗貼上，走 editor 會走的那條路 */
function pasteAcross(src, srcLayout, keys, dst, dstLayout, activeKey) {
  const clip = P.portableClipboard(src, srcLayout, keys);
  const newKeys = M.pasteClipboard(dst, dstLayout, clip, P.foreignPasteAnchor(dst, dstLayout, activeKey), { keepIds: true });
  return { clip: clip, newKeys: newKeys };
}

/* ---------------- 版面 ---------------- */

test('PANE-1 一個佔滿、兩個左右並排、三個時第三個橫跨下排、四個田字；最多四個', function () {
  assert.equal(P.MAX_PANES, 4);
  assert.deepEqual(P.gridLayout(1), { cols: 1, rows: 1, spans: [1] });
  assert.deepEqual(P.gridLayout(2), { cols: 2, rows: 1, spans: [1, 1] }, '原本的在左、新的在右');
  assert.deepEqual(P.gridLayout(3), { cols: 2, rows: 2, spans: [1, 1, 2] });
  assert.deepEqual(P.gridLayout(4), { cols: 2, rows: 2, spans: [1, 1, 1, 1] }, '十字切成四格');
  assert.deepEqual(P.gridLayout(0), P.gridLayout(1), '至少一個');
  assert.deepEqual(P.gridLayout(9), P.gridLayout(4), '超過上限就當四個');
});

/* ---------------- 焦點與多選 ---------------- */

test('PANE-2 一般點擊：點沒選到的只選它；點已在多選裡的只換焦點，多選不動', function () {
  assert.deepEqual(P.clickPane({ focused: 1, selected: [1] }, 2, {}), { focused: 2, selected: [2] });
  assert.deepEqual(P.clickPane({ focused: 1, selected: [1, 3] }, 2, {}), { focused: 2, selected: [2] },
    '點多選外面的視窗＝重新單選');
  /* 兩格一起播著比對時，在其中一格拖圖層不該把另一格踢出同步播放 */
  assert.deepEqual(P.clickPane({ focused: 1, selected: [1, 3] }, 3, {}), { focused: 3, selected: [1, 3] });
  assert.deepEqual(P.clickPane({ focused: 1, selected: [1] }, 1, {}), { focused: 1, selected: [1] });
});

test('PANE-3 Ctrl+點擊：沒選到就加入並取得焦點；選到就移出，焦點被移出時交給最後加入的', function () {
  assert.deepEqual(P.clickPane({ focused: 1, selected: [1] }, 2, { ctrl: true }), { focused: 2, selected: [1, 2] });
  assert.deepEqual(P.clickPane({ focused: 2, selected: [1, 2] }, 4, { ctrl: true }),
    { focused: 4, selected: [1, 2, 4] });
  assert.deepEqual(P.clickPane({ focused: 4, selected: [1, 2, 4] }, 2, { ctrl: true }),
    { focused: 4, selected: [1, 4] }, '移出沒有焦點的那一個，焦點不動');
  assert.deepEqual(P.clickPane({ focused: 4, selected: [1, 2, 4] }, 4, { ctrl: true }),
    { focused: 2, selected: [1, 2] }, '移出焦點視窗，焦點交給剩下裡最後加入的');
  assert.deepEqual(P.clickPane({ focused: 1, selected: [1] }, 1, { ctrl: true }),
    { focused: 1, selected: [1] }, '只剩一個時不能移出——焦點視窗一定在多選裡');
  const before = { focused: 1, selected: [1, 2] };
  P.clickPane(before, 3, { ctrl: true });
  assert.deepEqual(before, { focused: 1, selected: [1, 2] }, '不得改到傳進來的物件');
});

test('PANE-4 關掉視窗之後：焦點與多選都不能指向不存在的視窗', function () {
  const order = [1, 2, 3, 4];
  assert.deepEqual(P.afterClose({ focused: 2, selected: [2] }, 3, order), { focused: 2, selected: [2] },
    '關掉別的視窗，焦點不動');
  assert.deepEqual(P.afterClose({ focused: 2, selected: [1, 3, 2] }, 3, order), { focused: 2, selected: [1, 2] });
  assert.deepEqual(P.afterClose({ focused: 3, selected: [1, 4, 3] }, 3, order), { focused: 4, selected: [1, 4] },
    '焦點被關掉時交給多選裡最後加入的');
  assert.deepEqual(P.afterClose({ focused: 3, selected: [3] }, 3, order), { focused: 2, selected: [2] },
    '多選裡沒有別人時交給畫面上的前一格');
  assert.deepEqual(P.afterClose({ focused: 1, selected: [1] }, 1, order), { focused: 2, selected: [2] },
    '第一格沒有前一格，交給後一格');
  assert.deepEqual(P.afterClose({ focused: 1, selected: [1] }, 1, [1]), { focused: null, selected: [] });
});

test('PANE-5 多選時工具列的顯示：有一個在播就是「暫停」；預覽循環全開才打勾、混合時標出來', function () {
  assert.deepEqual(P.playbackState([{ playing: true, previewLoop: true }, { playing: false, previewLoop: true }]),
    { playing: true, loop: true, loopMixed: false });
  assert.deepEqual(P.playbackState([{ playing: false, previewLoop: true }, { playing: false, previewLoop: false }]),
    { playing: false, loop: false, loopMixed: true });
  assert.deepEqual(P.playbackState([{ playing: false, previewLoop: false }]),
    { playing: false, loop: false, loopMixed: false });
  assert.deepEqual(P.playbackState([]), { playing: false, loop: false, loopMixed: false });
});

/* ---------------- 網址 ---------------- */

test('PANE-6 網址記住每個視窗的特效：舊的 ?preset=<id> 照樣能開；不合規則與重複的丟掉；最多四個', function () {
  const ok = (id) => /^[a-z0-9][a-z0-9-]*$/.test(id);
  assert.deepEqual(P.presetsFromSearch('?preset=demo-basic', ok), { ids: ['demo-basic'], focus: 0 });
  assert.deepEqual(P.presetsFromSearch('?preset=a&preset=b&focus=2', ok), { ids: ['a', 'b'], focus: 1 });
  assert.deepEqual(P.presetsFromSearch('?preset=a&preset=..%2Fx&preset=a&preset=b', ok), { ids: ['a', 'b'], focus: 0 },
    '網址是外部輸入：../ 不能拿去組檔案路徑');
  assert.deepEqual(P.presetsFromSearch('?preset=a&preset=b&preset=c&preset=d&preset=e', ok).ids, ['a', 'b', 'c', 'd']);
  assert.deepEqual(P.presetsFromSearch('?preset=a&focus=5', ok), { ids: ['a'], focus: 0 }, '超出範圍的 focus 不理');
  assert.deepEqual(P.presetsFromSearch('', ok), { ids: [], focus: 0 });
});

test('PANE-7 寫回網址：空白與還沒進 repo 的視窗不寫，focus 跟著換算', function () {
  assert.equal(P.searchFor(['a'], 0), '?preset=a', '只有一個視窗時與原本的網址一模一樣');
  assert.equal(P.searchFor(['a', 'b'], 1), '?preset=a&preset=b&focus=2');
  assert.equal(P.searchFor(['a', null, 'c'], 2), '?preset=a&preset=c&focus=2', '中間的空白視窗不佔序號');
  assert.equal(P.searchFor(['a', null], 1), '?preset=a', '焦點在空白視窗時不帶 focus');
  assert.equal(P.searchFor([null], 0), '');
  const ok = (id) => /^[a-z0-9][a-z0-9-]*$/.test(id);
  assert.deepEqual(P.presetsFromSearch(P.searchFor(['x-1', 'y', 'z'], 2), ok), { ids: ['x-1', 'y', 'z'], focus: 2 },
    '寫出去再讀回來要一樣');
});

/* ---------------- 空白特效 ---------------- */

test('PANE-8 空白特效的暫時名字避開已有的名字', function () {
  assert.equal(P.blankPresetId([]), 'new-effect');
  assert.equal(P.blankPresetId(['new-effect']), 'new-effect-2');
  assert.equal(P.blankPresetId(['new-effect', 'new-effect-2', 'new-effect-4']), 'new-effect-3');
  assert.equal(require('../tools/vfx/editor/preset-id-policy.js').presetIdProblem(P.blankPresetId(['new-effect'])), null,
    '暫時的名字本身要能當檔名');
});

test('PANE-9 空白特效只差「還沒有圖層」：加一層就是合法的 preset', function () {
  const p = P.blankPreset('new-effect');
  assert.deepEqual(VFXCore.validatePreset(p).errors, ['preset.layers 不得為空']);
  p.layers.push(sprite('ring'));
  assert.equal(errorsOf(p), '', '其餘欄位都要合法，第一層加進去就能註冊進預覽');
});

/* ---------------- 跨特效的剪貼簿 ---------------- */

test('PANE-10 沒有父子關係的圖層：與同一份特效裡複製的內容相同，而且不改原本那份', function () {
  const a = preset('fx-a', [sprite('a1', { position: { x: 10, y: 5 } }), sprite('a2')]);
  const layout = rootLayout(a);
  const before = clone(a);
  const clip = P.portableClipboard(a, layout, ['layer:a1']);
  assert.deepEqual(clip.items, M.copySelection(a, layout, ['layer:a1']).items);
  assert.deepEqual(clip.notes, []);
  assert.deepEqual(a, before, '換算在複本上做');
  assert.equal(P.portableClipboard(a, layout, []), null, '什麼都沒選就沒有剪貼簿');
});

test('PANE-11 父物件沒一起複製：貼到另一份特效改成根層級，畫面位置、角度、大小與出現時間不變', function () {
  const a = preset('fx-a', [
    empty('pivot', { position: { x: 100, y: 50 }, rotation: Math.PI / 2, scale: { x: 2, y: 2 }, delay: 0.2 }),
    sprite('orb', { parent: 'pivot', position: { x: 15, y: -5 }, rotation: 0.3, delay: 0.1 })
  ]);
  const b = preset('fx-b', [sprite('ring')]);
  const bLayout = rootLayout(b);
  const before = framesAt(clone(a), [0.35, 0.6], ['/orb.png']);
  const r = pasteAcross(a, rootLayout(a), ['layer:orb'], b, bLayout, 'layer:ring');
  const pasted = M.layerById(b, 'orb');
  assert.ok(pasted, '貼上了');
  assert.equal(pasted.parent, undefined, 'B 裡沒有 pivot，不能帶著指不到的 parent');
  assert.equal(pasted.delay, 0.3, '出現時間＝父物件的 delay 加自己的');
  assert.deepEqual(r.clip.notes, [{ id: 'orb', kind: 'detached' }]);
  assert.equal(errorsOf(b), '', '貼完要存得了檔');
  assertSameScreen(before, framesAt(clone(b), [0.35, 0.6], ['/orb.png']), 1e-4, '貼到另一份特效');
  assert.equal(M.layerById(a, 'orb').parent, 'pivot', '原本那份的父子關係不動');
});

test('PANE-12 父物件與子物件一起複製：父子關係跟著過去，數值不換算', function () {
  const a = preset('fx-a', [
    empty('pivot', { position: { x: 100, y: 50 }, rotation: 0.5 }),
    sprite('orb', { parent: 'pivot', position: { x: 15, y: -5 } })
  ]);
  const b = preset('fx-b', [sprite('pivot'), sprite('orb')]);
  const bLayout = rootLayout(b);
  const before = framesAt(clone(a), [0.4], ['/orb.png']);
  const r = pasteAcross(a, rootLayout(a), ['layer:pivot'], b, bLayout, 'layer:orb');
  assert.deepEqual(r.clip.notes, []);
  assert.deepEqual(r.newKeys, ['layer:pivot-2', 'layer:orb-2'], '選父物件就連子物件一起；B 裡撞名的要改名');
  const child = M.layerById(b, 'orb-2');
  assert.equal(child.parent, 'pivot-2', '掛在副本底下，不是 B 裡剛好同名的那一層');
  assert.deepEqual(child.position, { x: 15, y: -5 });
  assert.equal(errorsOf(b), '');
  const after = framesAt(clone(b), [0.4], ['/orb.png']);
  /* B 自己也有一層 orb.png（沒有父物件、在原點）：比對副本那一個節點 */
  assertSameScreen(before, [after[0].filter((n) => Math.abs(n.x) > 1e-6 || Math.abs(n.y) > 1e-6)], 1e-4,
    '父子一起貼過去');
});

test('PANE-13 子發射器：目標沒一起複製就拿掉；一起複製就改指向副本；只複製目標時照樣貼', function () {
  function source() {
    return preset('fx-a', [
      particle('spark', { subEmitter: { layer: 'burst' } }),
      particle('burst', { emission: { mode: 'sub', count: 3 } })
    ]);
  }
  const b1 = preset('fx-b', [sprite('ring')]);
  const r1 = pasteAcross(source(), rootLayout(source()), ['layer:spark'], b1, rootLayout(b1), 'layer:ring');
  assert.equal(M.layerById(b1, 'spark').subEmitter, undefined, 'B 裡沒有 burst');
  assert.deepEqual(r1.clip.notes, [{ id: 'spark', kind: 'subEmitter' }]);
  assert.equal(errorsOf(b1), '');

  const b2 = preset('fx-b', [sprite('ring'), particle('burst')]);
  pasteAcross(source(), rootLayout(source()), ['layer:spark', 'layer:burst'], b2, rootLayout(b2), 'layer:ring');
  assert.equal(M.layerById(b2, 'spark').subEmitter.layer, 'burst-2',
    '一起複製的要指向副本，不是 B 裡剛好同名的那一層');
  assert.equal(M.layerById(b2, 'burst').subEmitter, undefined);

  const a3 = source();
  const b3 = preset('fx-b', [sprite('ring')]);
  const r3 = pasteAcross(a3, rootLayout(a3), ['layer:burst'], b3, rootLayout(b3), 'layer:ring');
  assert.deepEqual(r3.clip.notes, [], '目標層本身沒有要改的欄位');
  assert.equal(M.layerById(b3, 'burst').emission.mode, 'sub', '不替使用者猜要不要改掉 sub 模式');
  assert.equal(a3.layers[0].subEmitter.layer, 'burst', '原本那份的子發射器不動');
});

test('PANE-14 複製群組：攤成圖層貼進目標的根群組，不多出第二個群組', function () {
  const a = preset('fx-a', [sprite('a1'), sprite('a2'), empty('pivot'), sprite('a3', { parent: 'pivot' })]);
  const aLayout = {
    schemaVersion: 1, presetId: 'fx-a',
    groups: [{ id: 'fx-a', name: 'fx-a', layerIds: ['a1', 'a2', 'pivot'] }],
    order: ['group:fx-a', 'layer:a3']
  };
  const clip = P.portableClipboard(a, aLayout, ['group:fx-a']);
  assert.ok(clip.items.every((it) => it.kind === 'layer'), '全部是圖層項目');
  assert.deepEqual(clip.items.map((it) => it.layer.id), ['a1', 'a2', 'pivot', 'a3'],
    '群組外的子物件跟著父物件一起來');

  const b = preset('fx-b', [sprite('ring'), sprite('glow')]);
  const bLayout = rootLayout(b);
  const keys = M.pasteClipboard(b, bLayout, clip, P.foreignPasteAnchor(b, bLayout, 'group:fx-b'), { keepIds: true });
  assert.equal(bLayout.groups.length, 1, '仍然只有一個根群組');
  assert.deepEqual(bLayout.groups[0].layerIds, ['ring', 'glow', 'a1', 'a2', 'pivot', 'a3'],
    '選的是群組列時排在根群組最後面');
  assert.deepEqual(bLayout.order, ['group:fx-b'], '根層級不能多出散落的圖層');
  assert.equal(keys.length, 4);
  assert.equal(M.layerById(b, 'a3').parent, 'pivot');
  assert.equal(errorsOf(b), '');
  const rec = LS.reconcile(b.layers, bLayout);
  assert.equal(rec.rows.length, 1, '面板上一列＝一個特效');
});

test('PANE-15 貼上的插入點：選著一層排在它後面；空白特效沒有群組就照原本的規則', function () {
  const b = preset('fx-b', [sprite('ring'), sprite('glow')]);
  const layout = rootLayout(b);
  assert.equal(P.foreignPasteAnchor(b, layout, 'layer:ring'), 'layer:ring');
  assert.equal(P.foreignPasteAnchor(b, layout, 'group:fx-b'), 'layer:glow');
  assert.equal(P.foreignPasteAnchor(b, layout, null), 'layer:glow', '什麼都沒選也進根群組');
  assert.equal(P.foreignPasteAnchor(b, layout, 'layer:gone'), 'layer:glow', '選著的層已經不在了');

  const blank = P.blankPreset('new-effect');
  const blankLayout = LS.emptyLayout('new-effect');
  assert.equal(P.foreignPasteAnchor(blank, blankLayout, null), null);
  const a = preset('fx-a', [sprite('a1')]);
  M.pasteClipboard(blank, blankLayout, P.portableClipboard(a, rootLayout(a), ['layer:a1']),
    P.foreignPasteAnchor(blank, blankLayout, null), { keepIds: true });
  assert.deepEqual(blank.layers.map((l) => l.id), ['a1'], '空白特效也貼得進去');
  assert.equal(errorsOf(blank), '', '貼進第一層之後就是合法的 preset');

  const split = { schemaVersion: 1, presetId: 'fx-b',
    groups: [{ id: 'g1', name: 'g1', layerIds: ['ring'] }, { id: 'g2', name: 'g2', layerIds: ['glow'] }],
    order: ['group:g1', 'group:g2'] };
  assert.equal(P.foreignPasteAnchor(b, split, 'group:g2'), 'group:g2', '使用者自己分了好幾組時不猜要放哪一組');
});

test('PANE-16 說明文字：跨特效的原因講清楚，父子層級換算的原因沿用 hierarchy-model', function () {
  const lines = P.describeNotes([{ id: 'orb', kind: 'detached' }, { id: 'spark', kind: 'subEmitter' },
    { id: 'ring', kind: 'skew' }]);
  assert.equal(lines.length, 3);
  assert.ok(/^orb：/.test(lines[0]) && /根層級/.test(lines[0]) && /透明度/.test(lines[0]));
  assert.ok(/^spark：/.test(lines[1]) && /subEmitter/.test(lines[1]));
  assert.equal(lines[2], H.describeNotes([{ id: 'ring', kind: 'skew' }])[0]);
});

test('PANE-17 父物件非等比縮放造成的斜切：卸下時照樣換算並附上原因', function () {
  const a = preset('fx-a', [
    empty('pivot', { rotation: Math.PI / 6, scale: { x: 2, y: 1 } }),
    sprite('orb', { parent: 'pivot', rotation: Math.PI / 4, position: { x: 4, y: 2 } })
  ]);
  const b = preset('fx-b', [sprite('ring')]);
  const r = pasteAcross(a, rootLayout(a), ['layer:orb'], b, rootLayout(b), null);
  assert.deepEqual(r.clip.notes.map((n) => n.kind).sort(), ['detached', 'skew']);
  assert.equal(M.layerById(b, 'orb').parent, undefined);
  assert.equal(errorsOf(b), '');
});
