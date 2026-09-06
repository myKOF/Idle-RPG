'use strict';
/* ============================================================
   vfx-pixi-sheet.test.cjs — Pixi 後端的序列幀切圖

   受測對象：js/vfx-pixi-backend.js 的 createNode／updateNode／destroy

   為什麼要在 Node 裡測後端：序列幀最容易出的錯是「改到共用貼圖」——
   Pixi 的 Texture 是可以共用的物件，一個節點把 texture.frame 改掉，
   所有用同一張圖的節點會一起換格。那在畫面上是「別的特效跟著變」，
   而且只有在兩個特效剛好共用同一張素材時才發生，實機幾乎抓不到。
   後端接受注入 PIXI（createBackend 的 opts.PIXI），所以用替身就驗得到。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');

const VFXPixiBackend = require('../js/vfx-pixi-backend.js');

/* ---------------- PIXI 替身 ----------------
   只實作後端真的會用到的那幾樣：Texture／Rectangle／Sprite／TilingSprite／Assets。 */
function makePixi() {
  const created = [];                       // 建立過的 Texture（含每一格）
  class Rectangle {
    constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); }
  }
  class Texture {
    constructor(opts) {
      opts = opts || {};
      this.source = opts.source || { id: 'src' };
      this.frame = opts.frame || new Rectangle(0, 0, 512, 512);
      this.destroyed = false;
      created.push(this);
    }
    destroy() { this.destroyed = true; }
  }
  Texture.EMPTY = new Texture({ frame: new Rectangle(0, 0, 1, 1) });
  created.length = 0;                       // EMPTY 不算
  class Sprite {
    constructor(tex) { this.texture = tex; this.children = []; this.destroyed = false; }
    destroy() { this.destroyed = true; }
  }
  class TilingSprite extends Sprite {
    constructor(o) { super(o.texture); this.tilePosition = { set() {} }; }
  }
  const loaded = {};
  const Assets = {
    load: (url) => {
      loaded[url] = loaded[url] || new Texture({
        source: { id: url }, frame: new Rectangle(0, 0, 512, 256)
      });
      return Promise.resolve(loaded[url]);
    },
    unload: () => Promise.resolve()
  };
  return { Rectangle, Texture, Sprite, TilingSprite, Assets, __created: created };
}

function makeContainer() {
  return { sortableChildren: false, children: [], addChild(n) { this.children.push(n); },
    removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); },
    removeChildren() { this.children.length = 0; } };
}

function setup(PIXI) {
  const container = makeContainer();
  const backend = VFXPixiBackend.createBackend({ PIXI: PIXI, container: container });
  return { container, backend };
}

const SHEET_SPEC = {
  kind: 'sprite', assetUrl: '/a/flame.png', blendMode: 'add',
  sheet: { columns: 4, rows: 2 }
};

test('PSHEET-1 依格線切出每一格，各自是獨立的 Texture、共用同一個 source', async function () {
  const PIXI = makePixi();
  const { backend } = setup(PIXI);
  const node = backend.createNode(SHEET_SPEC);
  await Promise.resolve(); await Promise.resolve();   // 等貼圖載入的兩層 then

  const frames = node.__frames;
  assert.equal(frames.length, 8, '4×2 應該切出 8 格');
  /* 512×256 的圖切 4×2 → 每格 128×128 */
  assert.deepEqual(
    frames.map((t) => [t.frame.x, t.frame.y, t.frame.width, t.frame.height]),
    [[0, 0, 128, 128], [128, 0, 128, 128], [256, 0, 128, 128], [384, 0, 128, 128],
     [0, 128, 128, 128], [128, 128, 128, 128], [256, 128, 128, 128], [384, 128, 128, 128]]);
  assert.equal(new Set(frames.map((t) => t.source)).size, 1, '八格必須共用同一個 source');
});

test('PSHEET-2 換格是換 texture 的指向，不是改貼圖自己的 frame', async function () {
  /* 這一條是整組的核心。若實作成 node.texture.frame = …，
     底下的 snapshot 會跟著變——而那張貼圖是所有節點共用的。 */
  const PIXI = makePixi();
  const { backend } = setup(PIXI);
  const a = backend.createNode(SHEET_SPEC);
  const b = backend.createNode(SHEET_SPEC);
  await Promise.resolve(); await Promise.resolve();

  const snapshot = a.__frames.map((t) => Object.assign({}, t.frame));
  backend.updateNode(a, { visible: true, frame: 5 });
  backend.updateNode(b, { visible: true, frame: 1 });

  assert.equal(a.texture, a.__frames[5]);
  assert.equal(b.texture, b.__frames[1]);
  assert.deepEqual(a.__frames.map((t) => Object.assign({}, t.frame)), snapshot,
    '有人改到了共用貼圖的 frame——所有用同一張圖的特效會一起換格');
  assert.equal(a.__frames, b.__frames, '同一張圖同一種格線只該切一次（快取）');
});

test('PSHEET-3 貼圖還沒載完就收到幀號時，載完要補上而不是停在第 0 格', async function () {
  /* Assets.load 是非同步的，這期間 update 已經跑過好幾幀。
     沒有把最後的幀號記下來的話，動畫會從第 0 格突然跳到當下那一格。 */
  const PIXI = makePixi();
  const { backend } = setup(PIXI);
  const node = backend.createNode(SHEET_SPEC);
  backend.updateNode(node, { visible: true, frame: 6 });   // 貼圖還沒到
  assert.equal(node.__frameWanted, 6);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(node.texture, node.__frames[6], '載完應該直接補到第 6 格');
});

test('PSHEET-4 幀號超出範圍時夾住，不會拿到 undefined 貼圖', async function () {
  const PIXI = makePixi();
  const { backend } = setup(PIXI);
  const node = backend.createNode(SHEET_SPEC);
  await Promise.resolve(); await Promise.resolve();
  backend.updateNode(node, { visible: true, frame: 99 });
  assert.equal(node.texture, node.__frames[7]);
  backend.updateNode(node, { visible: true, frame: -3 });
  assert.equal(node.texture, node.__frames[0]);
});

test('PSHEET-5 沒有 sheet 的節點行為完全不變', async function () {
  const PIXI = makePixi();
  const { backend } = setup(PIXI);
  const node = backend.createNode({ kind: 'sprite', assetUrl: '/a/plain.png', blendMode: 'normal' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(node.__frames, undefined, '不該替它切圖');
  assert.equal(node.texture.frame.width, 512, '就是整張圖');
  backend.updateNode(node, { visible: true, x: 1, y: 2 });
  assert.equal(node.texture.frame.width, 512, 'frame 欄位不存在時不該動貼圖');
});

test('PSHEET-6 銷毀單一節點不會連帶毀掉共用的格子貼圖', async function () {
  /* 切好的格子是整個 backend 共用的。跟著單一節點一起 destroy，
     下一個節點就會拿到已經被銷毀的貼圖——畫面上是整片空白。 */
  const PIXI = makePixi();
  const { backend } = setup(PIXI);
  const a = backend.createNode(SHEET_SPEC);
  await Promise.resolve(); await Promise.resolve();
  const frames = a.__frames;
  backend.destroyNode(a);
  assert.equal(a.__frames, null, '節點自己要放掉指向');
  assert.deepEqual(frames.map((t) => t.destroyed), frames.map(() => false),
    '共用的格子不該被單一節點帶走');

  const b = backend.createNode(SHEET_SPEC);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(b.__frames, frames, '新節點應該拿到同一組快取');
});

test('PSHEET-7 backend.destroy() 才釋放所有格子貼圖', async function () {
  const PIXI = makePixi();
  const { backend } = setup(PIXI);
  const node = backend.createNode(SHEET_SPEC);
  await Promise.resolve(); await Promise.resolve();
  const frames = node.__frames;
  backend.destroy();
  assert.ok(frames.every((t) => t.destroyed), '收攤時要把切出來的 Texture 收掉');
});
