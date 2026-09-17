'use strict';
/* ============================================================
   vfx-editor-hierarchy.test.cjs — Editor 的父子層級操作

   受測對象：
     tools/vfx/editor/hierarchy-model.js  掛上／卸下的數值換算、面板的樹、拖曳落點
     tools/vfx/editor/layer-model.js      改 id、貼上時的參照

   使用者的決定（2026-09-17）：掛上父物件時「畫面位置不動」——數值換算成父物件底下的
   區域值；時間軸跟著父物件，所以 delay 也要換算。

   「畫面不動」一律拿 Runtime 實際送給後端的節點數值比對（換之前 vs 換之後），
   不拿 hierarchy-model 自己的矩陣函式對答案：那只能證明它跟自己一致。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const H = require('../tools/vfx/editor/hierarchy-model.js');
const M = require('../tools/vfx/editor/layer-model.js');
const VFXCore = require('../js/vfx-core.js');

const REPO = path.resolve(__dirname, '..');
const RESOLVER = { has: () => true, resolve: (id) => '/' + id };

function preset(layers, extra) {
  return Object.assign({ schemaVersion: 1, id: 'fx', duration: 1, loop: false, layers: layers }, extra || {});
}
function sprite(id, extra) {
  return Object.assign({ id: id, type: 'sprite', assetId: id + '.png' }, extra || {});
}
function empty(id, extra) {
  return Object.assign({ id: id, type: 'empty' }, extra || {});
}
function particle(id, extra) {
  return Object.assign({
    id: id, type: 'particle', assetId: id + '.png', lifetime: 5, speed: [20, 60], spread: 360,
    emission: { mode: 'burst', count: 6 }
  }, extra || {});
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function errorsOf(p) { return VFXCore.validatePreset(p).errors.join('\n'); }

/* Runtime 在時間 t 送給每個節點的最後一份變換。用素材 URL 認圖層，同一層多個節點（粒子）照建立順序。 */
function framesAt(p, times) {
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
    out.push(nodes.filter((n) => n.last && n.last.visible).map(function (n) {
      const s = n.last;
      const skew = s.skewX || 0;
      return {
        url: n.url, x: s.x, y: s.y, alpha: s.alpha,
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
      assert.equal(m.url, n.url);
      ['x', 'y', 'a', 'b', 'c', 'd', 'alpha'].forEach(function (k) {
        assert.ok(Math.abs(m[k] - n[k]) <= eps, label + '：' + n.url + ' 的 ' + k + ' 在第 ' + i +
          ' 個時間點從 ' + n[k] + ' 變成 ' + m[k]);
      });
    });
  });
}

/* ---------------- 掛上時畫面不動 ---------------- */

test('PARENT-1 掛到轉了 90 度、放大 2 倍的父物件底下：數值換算成區域值，畫面不動', function () {
  const p = preset([
    empty('pivot', { position: { x: 100, y: 50 }, rotation: Math.PI / 2, scale: { x: 2, y: 2 } }),
    sprite('orb', { position: { x: 130, y: 50 } })
  ]);
  const before = framesAt(clone(p), [0.1, 0.5]);
  const r = H.attach(p, ['orb'], 'pivot');
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.notes, []);
  const orb = p.layers[1];
  assert.equal(orb.parent, 'pivot');
  /* 手算：(130,50) 減掉 (100,50) 得 (30,0)，反轉 90 度得 (0,-30)，縮回一半得 (0,-15)；
     角度 0 − 90° ＝ −90°；縮放 1 ÷ 2 ＝ 0.5 */
  assert.deepEqual(orb.position, { x: 0, y: -15 });
  assert.equal(orb.rotation, -1.570796);
  assert.deepEqual(orb.scale, { x: 0.5, y: 0.5 });
  assert.ok(VFXCore.validatePreset(p).ok, errorsOf(p));
  assertSameScreen(before, framesAt(p, [0.1, 0.5]), 1e-4, '掛上');
});

test('PARENT-2 卸下（回到根層級）同樣不動；掛上再卸下回到原本的數值', function () {
  const p = preset([
    empty('pivot', { position: { x: 100, y: 50 }, rotation: Math.PI / 2, scale: { x: 2, y: 2 } }),
    sprite('orb', { position: { x: 130, y: 50 }, rotation: 0.25, scale: { x: 1.5, y: 0.75 } })
  ]);
  const original = clone(p.layers[1]);
  const before = framesAt(clone(p), [0.3]);
  assert.ok(H.attach(p, ['orb'], 'pivot').ok);
  assertSameScreen(before, framesAt(clone(p), [0.3]), 1e-4, '掛上');
  const r = H.attach(p, ['orb'], null);
  assert.ok(r.ok, r.error);
  const orb = p.layers[1];
  assert.equal(orb.parent, undefined, '卸下要刪掉 parent，不是寫 null');
  assert.deepEqual(orb.position, original.position);
  assert.ok(Math.abs(orb.rotation - original.rotation) < 2e-6, '角度 ' + orb.rotation);
  assert.ok(Math.abs(orb.scale.x - 1.5) < 2e-6 && Math.abs(orb.scale.y - 0.75) < 2e-6, JSON.stringify(orb.scale));
  assertSameScreen(before, framesAt(p, [0.3]), 1e-4, '卸下');
});

test('PARENT-2B 掛上再卸下不留殘差：中間那一步收過位數，回來仍是整齊的 0 與原本的倍率', function () {
  /* 2026-09-17 瀏覽器實測的情境：固定收四位小數時，卸下後 position 變成 { x: 0, y: 0.0001 } */
  const p = preset([
    empty('pivot', { position: { x: 40, y: -20 }, rotation: Math.PI / 6, scale: { x: 2, y: 2 } }),
    sprite('halo', { scale: { x: 0.1406, y: 0.1406 } })
  ]);
  assert.ok(H.attach(p, ['halo'], 'pivot').ok);
  assert.deepEqual(p.layers[1].position, { x: -12.3205, y: 18.6603 });
  assert.equal(p.layers[1].rotation, -0.523599);
  assert.deepEqual(p.layers[1].scale, { x: 0.0703, y: 0.0703 });
  assert.ok(H.attach(p, ['halo'], null).ok);
  assert.deepEqual(p.layers[1].position, { x: 0, y: 0 });
  assert.equal(p.layers[1].rotation, 0);
  assert.deepEqual(p.layers[1].scale, { x: 0.1406, y: 0.1406 });
});

test('PARENT-3 父物件非等比縮放、子物件有轉角：差異吸收在外層縮放裡，精確不失真', function () {
  const p = preset([
    empty('squash', { scale: { x: 2, y: 1 } }),
    sprite('orb', { rotation: Math.PI / 4 })
  ]);
  const before = framesAt(clone(p), [0.2]);
  const r = H.attach(p, ['orb'], 'squash');
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.notes, [], '這個情況存得下，不該報近似');
  const orb = p.layers[1];
  /* S(2,1) 底下要還原一個轉 45 度的正方形：S(0.5,1)·R(45°)。縮放維持 1，外層縮放吸收父物件的壓縮 */
  assert.deepEqual(orb.outerScale, { x: 0.5, y: 1 });
  assert.equal(orb.rotation, 0.785398);
  assert.equal(orb.scale, undefined, '縮放沒變就不要多寫一個欄位');
  assertSameScreen(before, framesAt(p, [0.2]), 1e-5, '非等比');
});

test('PARENT-4 真正存不下的斜切：報 skew，位置仍精確，形狀取最接近的', function () {
  const p = preset([
    empty('n', { rotation: Math.PI / 6, scale: { x: 2, y: 1 } }),
    sprite('orb', { position: { x: 40, y: 10 }, rotation: Math.PI / 4, outerScale: { x: 1, y: 0.5 } })
  ]);
  const before = framesAt(clone(p), [0.2])[0][0];
  const r = H.attach(p, ['orb'], 'n');
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.notes, [{ id: 'orb', kind: 'skew' }]);
  assert.ok(VFXCore.validatePreset(p).ok, errorsOf(p));
  const after = framesAt(p, [0.2])[0][0];
  assert.ok(Math.abs(after.x - before.x) < 1e-3 && Math.abs(after.y - before.y) < 1e-3, '位置要精確');
  const err = Math.sqrt(['a', 'b', 'c', 'd'].reduce((s, k) => s + (after[k] - before[k]) ** 2, 0));
  /* 只沿用原本外層縮放、硬拆角度的作法誤差是 0.9；取最接近的一組是 0.04 左右 */
  assert.ok(err < 0.1, '形狀誤差 ' + err);
  assert.ok(H.describeNotes(r.notes)[0].indexOf('斜切') >= 0);
});

test('PARENT-5 鏡像父物件（scale.x = -1）：子物件改成翻 X 軸、角度反向，不是轉半圈的寫法', function () {
  const p = preset([
    empty('mirror', { scale: { x: -1, y: 1 } }),
    sprite('orb', { position: { x: 10, y: 5 }, rotation: 0.5 })
  ]);
  const before = framesAt(clone(p), [0.2]);
  assert.ok(H.attach(p, ['orb'], 'mirror').ok);
  const orb = p.layers[1];
  assert.deepEqual(orb.position, { x: -10, y: 5 });
  assert.equal(orb.rotation, -0.5);
  assert.deepEqual(orb.scale, { x: -1, y: 1 });
  assertSameScreen(before, framesAt(p, [0.2]), 1e-9, '鏡像');
});

test('PARENT-6 父物件只有位移時只改 position：角度與縮放一個位元都不動', function () {
  const p = preset([
    empty('slide', { position: { x: 100, y: 50 } }),
    sprite('orb', { position: { x: 130.5, y: 20 }, rotation: 0.1234567890123, scale: { x: 1.1111111111, y: 2 } })
  ]);
  const before = framesAt(clone(p), [0.4]);
  assert.ok(H.attach(p, ['orb'], 'slide').ok);
  const orb = p.layers[1];
  assert.deepEqual(orb.position, { x: 30.5, y: -30 });
  assert.equal(orb.rotation, 0.1234567890123);
  assert.deepEqual(orb.scale, { x: 1.1111111111, y: 2 });
  assertSameScreen(before, framesAt(p, [0.4]), 1e-9, '位移');
});

test('PARENT-7 掛到原點、沒有任何變換的父物件：除了 parent 什麼都不改', function () {
  const p = preset([empty('null'), sprite('orb', { position: { x: 12.3456789, y: -4 }, rotation: 0.3 })]);
  const text = VFXCore.serialisePreset(p);
  assert.ok(H.attach(p, ['orb'], 'null').ok);
  const expected = JSON.parse(text);
  expected.layers[1].parent = 'null';
  assert.equal(VFXCore.serialisePreset(p), VFXCore.serialisePreset(expected));
});

test('PARENT-8 粒子層：換算發射點位置；父物件只有位移時粒子畫面完全一樣', function () {
  const p = preset([empty('slide', { position: { x: 50, y: 20 } }), particle('sparks', { position: { x: 80, y: 20 } })]);
  const before = framesAt(clone(p), [0.2, 0.6]);
  const r = H.attach(p, ['sparks'], 'slide');
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(p.layers[1].position, { x: 30, y: 0 });
  assertSameScreen(before, framesAt(p, [0.2, 0.6]), 1e-9, '粒子');
});

test('PARENT-9 粒子層掛到會轉的父物件：發射點位置仍然換算，並告知旋轉縮放會套到粒子上', function () {
  const p = preset([
    empty('spin', { position: { x: 50, y: 0 }, rotation: Math.PI / 2 }),
    particle('sparks', { position: { x: 50, y: 30 } })
  ]);
  const r = H.attach(p, ['sparks'], 'spin');
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.notes, [{ id: 'sparks', kind: 'particle' }]);
  /* (50,30) 減 (50,0) 得 (0,30)，反轉 90 度得 (30,0) */
  assert.deepEqual(p.layers[1].position, { x: 30, y: 0 });
  assert.equal(p.layers[1].rotation, undefined, '粒子層的 rotation 轉的是每顆粒子的圖，不拿來抵銷父物件');
});

/* ---------------- 時間軸 ---------------- */

test('PARENT-10 delay 換算成從父物件出現起算：出現、消失的時刻不變', function () {
  const p = preset([empty('late', { delay: 0.3 }), sprite('orb', { delay: 0.5, duration: 0.3 })]);
  const times = [0.45, 0.55, 0.75, 0.85];
  const before = framesAt(clone(p), times);
  assert.deepEqual(before.map((f) => f.length), [0, 1, 1, 0], '前提：0.5～0.8 秒可見');
  const r = H.attach(p, ['orb'], 'late');
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.notes, []);
  assert.equal(p.layers[1].delay, 0.2);
  assertSameScreen(before, framesAt(p, times), 1e-9, '時間軸');
});

test('PARENT-11 父物件比子物件晚出現：delay 夾到 0 並告知；父物件先結束：告知會被切掉', function () {
  const early = preset([empty('late', { delay: 0.3 }), sprite('orb', { delay: 0.1 })]);
  const r1 = H.attach(early, ['orb'], 'late');
  assert.ok(r1.ok);
  assert.equal(early.layers[1].delay, 0);
  assert.deepEqual(r1.notes, [{ id: 'orb', kind: 'delay' }]);

  const cut = preset([empty('short', { duration: 0.4 }), sprite('orb', { delay: 0.2, duration: 0.5 })]);
  const r2 = H.attach(cut, ['orb'], 'short');
  assert.deepEqual(r2.notes, [{ id: 'orb', kind: 'clipped' }]);

  /* 父子都用預設長度（整個特效）：根層級本來就在特效結束時被切掉，不是新的損失，不該報 */
  const plain = preset([empty('whole'), sprite('orb', { delay: 0.2 })]);
  assert.deepEqual(H.attach(plain, ['orb'], 'whole').notes, []);
});

/* ---------------- 擋下不合法的操作 ---------------- */

test('PARENT-12 會成環、超過深度、拆開子發射器的掛法一律擋下，而且什麼都不改', function () {
  const p = preset([empty('a'), empty('b', { parent: 'a' }), sprite('c', { parent: 'b', position: { x: 5, y: 0 } })]);
  const text = VFXCore.serialisePreset(p);
  const loop = H.attach(p, ['a'], 'c');
  assert.equal(loop.ok, false);
  assert.match(loop.error, /環/);
  assert.equal(VFXCore.serialisePreset(p), text, '擋下時不得留下半套修改');

  const chain = [empty('e0')];
  for (let i = 1; i <= VFXCore.MAX_PARENT_DEPTH; i++) chain.push(empty('e' + i, { parent: 'e' + (i - 1) }));
  chain.push(sprite('leaf'));
  const deep = preset(chain);
  assert.ok(VFXCore.validatePreset(deep).ok, '前提：最深那層剛好 8 個祖先');
  const tooDeep = H.attach(deep, ['leaf'], 'e' + VFXCore.MAX_PARENT_DEPTH);
  assert.equal(tooDeep.ok, false);
  assert.match(tooDeep.error, /超過 8 層/);

  const se = preset([
    empty('pivot'),
    particle('src', { subEmitter: { layer: 'puff', on: 'death', count: 1 } }),
    particle('puff', { emission: { mode: 'sub' } })
  ]);
  const apart = H.attach(se, ['src'], 'pivot');
  assert.equal(apart.ok, false);
  assert.match(apart.error, /子發射器/);
  const together = H.attach(se, ['src', 'puff'], 'pivot');
  assert.ok(together.ok, together.error);
  assert.ok(VFXCore.validatePreset(se).ok, errorsOf(se));
});

test('PARENT-13 可選的父物件：排除自己、自己的子孫，以及掛上去會超過深度的', function () {
  const p = preset([empty('a'), empty('b', { parent: 'a' }), sprite('c', { parent: 'b' }), sprite('d')]);
  assert.deepEqual(H.eligibleParents(p, ['b']), ['a', 'd']);
  assert.deepEqual(H.eligibleParents(p, ['a', 'd']), []);
  assert.deepEqual(H.eligibleParents(p, ['c']), ['a', 'b', 'd']);

  const chain = [empty('e0')];
  for (let i = 1; i < VFXCore.MAX_PARENT_DEPTH; i++) chain.push(empty('e' + i, { parent: 'e' + (i - 1) }));
  chain.push(empty('top'), empty('kid', { parent: 'top' }));
  const deep = preset(chain);
  /* top 底下還有一層：掛到有 7 個祖先的 e7 底下，kid 會有 9 個祖先 */
  assert.ok(H.eligibleParents(deep, ['top']).indexOf('e' + (VFXCore.MAX_PARENT_DEPTH - 1)) < 0);
  assert.ok(H.eligibleParents(deep, ['top']).indexOf('e' + (VFXCore.MAX_PARENT_DEPTH - 2)) >= 0);
});

/* ---------------- Layers 面板的樹 ---------------- */

function treeShape(tree) {
  return tree.map(function (r) {
    if (r.kind === 'group') return 'G:' + r.id;
    return '  '.repeat(r.depth) + r.id + (r.collapsed ? ' [+]' : '') +
      (r.parentElsewhere ? ' (↑' + r.parentElsewhere + ')' : '') + (r.parentOff ? ' (off)' : '');
  });
}

test('PARENT-14 子物件縮排在父物件底下；收合父物件就不列子孫；Shift 範圍選取照畫面順序', function () {
  const p = preset([sprite('c', { parent: 'b' }), sprite('a'), sprite('b', { parent: 'a' }), sprite('d', { parent: 'a' }), sprite('z')]);
  const rows = [{ kind: 'group', id: 'g', name: 'G', layerIds: ['a', 'c', 'b', 'd'] }, { kind: 'layer', id: 'z' }];
  assert.deepEqual(treeShape(H.treeRows(p, rows, {})), ['G:g', 'a', '  b', '    c', '  d', 'z']);
  const folded = H.treeRows(p, rows, { 'layer:a': true });
  assert.deepEqual(treeShape(folded), ['G:g', 'a [+]', 'z']);
  assert.deepEqual(H.visibleKeys(folded), ['group:g', 'layer:a', 'layer:z']);
  assert.deepEqual(treeShape(H.treeRows(p, rows, { g: true })), ['G:g', 'z'], '群組收合沿用原本的鍵');
  /* 沒有子物件的層被記成收合：不顯示 [+]，也不影響任何東西 */
  assert.deepEqual(treeShape(H.treeRows(p, rows, { 'layer:z': true })), ['G:g', 'a', '  b', '    c', '  d', 'z']);
});

test('PARENT-15 父物件在別的群組：子物件留在自己的位置並標出父物件；祖先停用時標 off；手改出來的環不會讓圖層消失', function () {
  const p = preset([sprite('a', { enabled: false }), sprite('b', { parent: 'a' }), sprite('x', { parent: 'a' }),
    sprite('p', { parent: 'q' }), sprite('q', { parent: 'p' })]);
  const rows = [
    { kind: 'group', id: 'g1', name: 'G1', layerIds: ['a', 'b'] },
    { kind: 'group', id: 'g2', name: 'G2', layerIds: ['x', 'p', 'q'] }
  ];
  assert.deepEqual(treeShape(H.treeRows(p, rows, {})),
    ['G:g1', 'a', '  b (off)', 'G:g2', 'x (↑a) (off)', 'p', '  q']);
});

test('PARENT-16 名稱排序時兄弟之間也照名稱排', function () {
  const p = preset([sprite('root'), sprite('zeta', { parent: 'root' }), sprite('alpha', { parent: 'root' })]);
  const rows = M.sortRows([{ kind: 'group', id: 'g', name: 'G', layerIds: ['root', 'zeta', 'alpha'] }], 'name');
  assert.deepEqual(treeShape(H.treeRows(p, rows, {})), ['G:g', 'root', '  alpha', '  zeta']);
});

/* ---------------- 複製、刪除帶著子物件 ---------------- */

test('PARENT-17 複製與刪除：選到父物件就連子孫一起（跟群組帶著成員一樣）', function () {
  const p = preset([sprite('a'), sprite('b', { parent: 'a' }), sprite('c', { parent: 'b' }), sprite('d')]);
  const layout = { schemaVersion: 1, presetId: 'fx', order: ['group:g'], groups: [{ id: 'g', name: 'G', layerIds: ['a', 'b', 'c', 'd'] }] };
  assert.deepEqual(H.withDescendants(p, layout, ['layer:b']), ['layer:b', 'layer:c']);
  assert.deepEqual(H.withDescendants(p, layout, ['layer:c', 'layer:a']), ['layer:c', 'layer:a', 'layer:b']);
  /* 群組已經帶著成員，只補成員在群組外的子孫 */
  const two = { schemaVersion: 1, presetId: 'fx', order: ['group:g', 'group:h'],
    groups: [{ id: 'g', name: 'G', layerIds: ['a', 'b'] }, { id: 'h', name: 'H', layerIds: ['c', 'd'] }] };
  assert.deepEqual(H.withDescendants(p, two, ['group:g']), ['group:g', 'layer:c']);

  const doomed = H.withDescendants(p, layout, ['layer:a']);
  M.deleteSelection(p, layout, doomed);
  assert.deepEqual(p.layers.map((l) => l.id), ['d']);
  assert.ok(VFXCore.validatePreset(p).ok, errorsOf(p));
});

test('PARENT-18 貼上：一起複製的父子，副本掛在副本底下；沒一起複製的父物件還在就維持', function () {
  const p = preset([empty('pivot'), sprite('orb', { parent: 'pivot', position: { x: 10, y: 0 } }), sprite('solo')]);
  const layout = { schemaVersion: 1, presetId: 'fx', order: ['group:g'], groups: [{ id: 'g', name: 'G', layerIds: ['pivot', 'orb', 'solo'] }] };
  const both = M.copySelection(p, layout, H.withDescendants(p, layout, ['layer:pivot']));
  M.pasteClipboard(p, layout, both, 'layer:solo');
  const byId = Object.fromEntries(p.layers.map((l) => [l.id, l]));
  assert.equal(byId['orb-copy'].parent, 'pivot-copy');
  assert.equal(byId['pivot-copy'].parent, undefined);

  const childOnly = M.copySelection(p, layout, ['layer:orb']);
  M.pasteClipboard(p, layout, childOnly, 'layer:orb');
  assert.equal(p.layers[p.layers.length - 1].parent, 'pivot', '父物件還在：副本是原子物件的兄弟');

  /* 父物件已經不在了（例如複製之後刪掉）：拿掉 parent，否則存不了檔 */
  const orphan = M.copySelection(p, layout, ['layer:orb']);
  M.deleteSelection(p, layout, H.withDescendants(p, layout, ['layer:pivot']));
  M.pasteClipboard(p, layout, orphan, null);
  assert.equal(p.layers[p.layers.length - 1].parent, undefined);
  assert.ok(VFXCore.validatePreset(p).ok, errorsOf(p));
});

test('PARENT-19 貼上：一起複製的子發射器改打副本；只複製來源層時照舊打原本的目標', function () {
  const p = preset([
    particle('src', { subEmitter: { layer: 'puff', on: 'death', count: 1 } }),
    particle('puff', { emission: { mode: 'sub' } })
  ]);
  const layout = { schemaVersion: 1, presetId: 'fx', order: ['layer:src', 'layer:puff'], groups: [] };
  M.pasteClipboard(p, layout, M.copySelection(p, layout, ['layer:src', 'layer:puff']), null);
  const byId = Object.fromEntries(p.layers.map((l) => [l.id, l]));
  assert.equal(byId['src-copy'].subEmitter.layer, 'puff-copy');
  assert.equal(byId['src'].subEmitter.layer, 'puff', '原本那一份不能被改到');
});

test('PARENT-20 改圖層 id：子物件的 parent 與子發射器的目標跟著改', function () {
  const p = preset([
    empty('pivot'), sprite('orb', { parent: 'pivot' }),
    particle('src', { parent: 'pivot', subEmitter: { layer: 'puff', on: 'death', count: 1 } }),
    particle('puff', { parent: 'pivot', emission: { mode: 'sub' } })
  ]);
  const layout = { schemaVersion: 1, presetId: 'fx', order: ['group:g'], groups: [{ id: 'g', name: 'G', layerIds: ['pivot', 'orb', 'src', 'puff'] }] };
  assert.ok(M.renameLayer(p, layout, 'pivot', 'hub'));
  assert.ok(M.renameLayer(p, layout, 'puff', 'smoke'));
  assert.deepEqual(p.layers.map((l) => l.parent || null), [null, 'hub', 'hub', 'hub']);
  assert.equal(p.layers[2].subEmitter.layer, 'smoke');
  assert.ok(VFXCore.validatePreset(p).ok, errorsOf(p));
});

/* ---------------- 拖曳 ---------------- */

function dragFixture() {
  const p = preset([
    empty('a', { position: { x: 100, y: 0 } }),
    sprite('b', { parent: 'a', position: { x: 10, y: 0 } }),
    sprite('c', { parent: 'a', position: { x: 20, y: 0 } }),
    sprite('d', { position: { x: 5, y: 5 } }),
    sprite('e', { position: { x: 50, y: 50 } })
  ]);
  const layout = { schemaVersion: 1, presetId: 'fx', order: ['group:g', 'group:h'],
    groups: [{ id: 'g', name: 'G', layerIds: ['a', 'b', 'c', 'd'] }, { id: 'h', name: 'H', layerIds: ['e'] }] };
  return { p, layout };
}
function parents(p) { return Object.fromEntries(p.layers.map((l) => [l.id, l.parent || null])); }

test('PARENT-21 拖到圖層列中段：成為它的最後一個子物件，排在它整棵子樹後面，位置換算', function () {
  const { p, layout } = dragFixture();
  const r = H.applyDrop(p, layout, ['layer:d'], 'layer:a', 'into');
  assert.ok(r.ok, r.error);
  assert.equal(r.parentChanged, true);
  assert.equal(parents(p).d, 'a');
  assert.deepEqual(layout.groups[0].layerIds, ['a', 'b', 'c', 'd']);
  assert.deepEqual(p.layers[3].position, { x: -95, y: 5 });

  /* 別的群組的圖層拖進來：換群組，排在子樹後面 */
  const r2 = H.applyDrop(p, layout, ['layer:e'], 'layer:b', 'into');
  assert.ok(r2.ok, r2.error);
  assert.equal(parents(p).e, 'b');
  assert.deepEqual(layout.groups.map((g) => g.id + ':' + g.layerIds.join(',')), ['g:a,b,e,c,d']);
});

test('PARENT-22 拖到圖層列上下緣：成為它的兄弟（同一個父物件）；拖到根層級的圖層旁邊就是卸下', function () {
  const { p, layout } = dragFixture();
  assert.ok(H.applyDrop(p, layout, ['layer:d'], 'layer:c', 'before').ok);
  assert.equal(parents(p).d, 'a');
  assert.deepEqual(layout.groups[0].layerIds, ['a', 'b', 'd', 'c']);

  assert.ok(H.applyDrop(p, layout, ['layer:b'], 'layer:a', 'before').ok);
  assert.equal(parents(p).b, null);
  assert.deepEqual(p.layers[1].position, { x: 110, y: 0 }, '卸下時換回特效座標');
  assert.deepEqual(layout.groups[0].layerIds, ['b', 'a', 'd', 'c']);
});

test('PARENT-23 拖父物件：沒選到的子物件跟著走；父子一起選時子物件不會被攤平', function () {
  const { p, layout } = dragFixture();
  assert.ok(H.applyDrop(p, layout, ['layer:a'], 'layer:e', 'after').ok);
  assert.deepEqual(layout.groups.map((g) => g.id + ':' + g.layerIds.join(',')), ['g:d', 'h:e,a,b,c']);
  assert.deepEqual(parents(p), { a: null, b: 'a', c: 'a', d: null, e: null });

  const f = dragFixture();
  const r = H.applyDrop(f.p, f.layout, ['layer:b', 'layer:a'], 'layer:d', 'into');
  assert.ok(r.ok, r.error);
  assert.deepEqual(parents(f.p), { a: 'd', b: 'a', c: 'a', d: null, e: null });
  assert.deepEqual(f.layout.groups[0].layerIds, ['d', 'a', 'b', 'c']);
});

test('PARENT-24 拖到群組列：回到根層級；拖到自己的子孫上一律擋下且不改任何東西', function () {
  const { p, layout } = dragFixture();
  const r = H.applyDrop(p, layout, ['layer:c'], 'group:h', 'into');
  assert.ok(r.ok, r.error);
  assert.equal(parents(p).c, null);
  assert.deepEqual(p.layers[2].position, { x: 120, y: 0 });
  assert.deepEqual(layout.groups[1].layerIds, ['e', 'c']);

  const f = dragFixture();
  const snapshot = JSON.stringify([f.p, f.layout]);
  ['into', 'before', 'after'].forEach(function (mode) {
    assert.match(H.dropProblem(f.p, f.layout, ['layer:a'], 'layer:b', mode) || '', /自己/, mode);
    assert.equal(H.applyDrop(f.p, f.layout, ['layer:a'], 'layer:b', mode).ok, false, mode);
  });
  assert.equal(JSON.stringify([f.p, f.layout]), snapshot);
  assert.equal(H.dropProblem(f.p, f.layout, ['group:h'], 'layer:b', 'into'), '群組不能掛到圖層底下');
  assert.equal(H.dropProblem(f.p, f.layout, ['layer:d'], 'layer:a', 'into'), null);
});

test('PARENT-25 只在同一個父物件底下換順序：parent 不動、數值不換算', function () {
  const { p, layout } = dragFixture();
  const before = clone(p);
  const r = H.applyDrop(p, layout, ['layer:c'], 'layer:b', 'before');
  assert.ok(r.ok, r.error);
  assert.equal(r.parentChanged, false);
  assert.deepEqual(p, before);
  assert.deepEqual(layout.groups[0].layerIds, ['a', 'c', 'b', 'd']);
});

/* ---------------- 接線 ---------------- */

test('PARENT-26 index.html 載入順序：layer-model → hierarchy-model → editor.js，並列進 checkModules', function () {
  const html = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/index.html'), 'utf8');
  const at = (name) => html.indexOf('src="/tools/vfx/editor/' + name);
  assert.ok(at('hierarchy-model.js') > 0, 'index.html 要載入 hierarchy-model.js');
  assert.ok(at('layer-model.js') < at('hierarchy-model.js') && at('layout-schema.js') < at('hierarchy-model.js'));
  assert.ok(at('hierarchy-model.js') < at('editor.js'));
  const editor = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  assert.ok(/\['VFXHierarchyModel', 'tools\/vfx\/editor\/hierarchy-model\.js'\]/.test(editor));
});
