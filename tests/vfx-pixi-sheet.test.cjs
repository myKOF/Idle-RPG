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

test('WARP-CLIP 移動裁切同步UV，保留內部比例且可清除裁切重用',async()=>{
 const PIXI=makePixi();
 PIXI.MeshGeometry=class{constructor(o){Object.assign(this,o)}getBuffer(){return {update(){}}}};
 PIXI.Mesh=class extends PIXI.Sprite{constructor(o){super(o.texture);this.geometry=o.geometry;this.position=this.scale=this.skew={set(){}}}};
 const {backend}=setup(PIXI),node=backend.createNode({kind:'deformed',warpAxis:'x',assetUrl:'/bolt.png'});
 await Promise.resolve();await Promise.resolve();node.texture.orig={width:512,height:256};
 const variation={config:{axis:'x',start:0,end:512,amplitude:0},mirror:1,width:1,phase:0};
 for(const rotated of [false,true]){
  const w={a:rotated?0:1,b:rotated?-1:0,c:rotated?2:0,d:rotated?0:1,x:0,y:0,variation,originX:0,originY:0,rotation:0,scaleX:1,scaleY:1};
  const t={deformation:w,anchorX:0,anchorY:0};backend.updateNode(node,t);
  const original=Array.from(node.__warp.positions),uv=Array.from(node.__warp.uvs);
  w.clipMin=100;w.clipMax=400;backend.updateNode(node,t);
  for(let i=0;i<original.length;i+=2){
   const actual=node.__warp.positions[i];
   assert.ok(actual>=99.999 && actual<=400.001);
   const texX=node.__warp.uvs[i]*512,texY=node.__warp.uvs[i+1]*256;
   assert.ok(Math.abs(actual-(w.a*texX+w.c*texY))<.001,'裁切後UV與原素材座標一對一，不拉伸');
  }
  delete w.clipMin;delete w.clipMax;backend.updateNode(node,t);
  assert.deepEqual(Array.from(node.__warp.uvs),uv);assert.deepEqual(Array.from(node.__warp.positions),original);
 }
});

test('WARP-MOTION 相同變形物件隨時間刷新GPU頂點，暫停保留快取',async()=>{
 const PIXI=makePixi();let writes=0;
 PIXI.MeshGeometry=class{constructor(o){Object.assign(this,o)}getBuffer(){return {update(){writes++;}}}};
 PIXI.Mesh=class extends PIXI.Sprite{constructor(o){super(o.texture);this.geometry=o.geometry;this.position=this.scale=this.skew={set(){}}}};
 const {backend}=setup(PIXI),n=backend.createNode({kind:'deformed',warpAxis:'x',assetUrl:'/animated.png'});
 await Promise.resolve();await Promise.resolve();n.texture.orig={width:512,height:256};
 const variation={config:{axis:'x',start:0,end:512,amplitude:0,motionAmplitude:16},mirror:1,width:1,phase:0,
  motionKey:0,motionTime:0};
 const w={a:1,b:0,c:0,d:1,x:0,y:0,originX:0,originY:0,rotation:0,scaleX:1,scaleY:1,variation};
 const t={deformation:w,anchorX:0,anchorY:.5};backend.updateNode(n,t);const before=Array.from(n.__warp.positions);
 const oldWrites=writes;backend.updateNode(n,t);assert.equal(writes,oldWrites);
 variation.phase=2;variation.motionKey=1;variation.motionTime=1;backend.updateNode(n,t);
 assert.ok(writes>oldWrites);assert.notDeepEqual(Array.from(n.__warp.positions),before);
});

test('WARP-TIP 裁切端點收束到軸心，內側保留寬度與UV',async()=>{
 const PIXI=makePixi();PIXI.MeshGeometry=class{constructor(o){Object.assign(this,o)}getBuffer(){return {update(){}}}};
 PIXI.Mesh=class extends PIXI.Sprite{constructor(o){super(o.texture);this.geometry=o.geometry;this.position=this.scale=this.skew={set(){}}}};
 const {backend}=setup(PIXI),n=backend.createNode({kind:'deformed',warpAxis:'x',assetUrl:'/tip.png'});
 await Promise.resolve();await Promise.resolve();n.texture.orig={width:512,height:256};
 const w={a:1,b:0,c:0,d:1,x:0,y:0,originX:0,originY:0,rotation:0,scaleX:1,scaleY:1,
 variation:{config:{axis:'x',start:0,end:512,amplitude:0},mirror:1,width:1,phase:0},clipMin:100,clipMax:400,clipTaper:60};
 backend.updateNode(n,{deformation:w,anchorX:0,anchorY:.5});
 let ends=0,interior=0;
 for(let i=0;i<n.__warp.positions.length;i+=2){const x=n.__warp.positions[i],y=n.__warp.positions[i+1];
 if(x===100||x===400){assert.ok(Math.abs(y)<1e-6);ends++;}
 if(x>160&&x<340&&Math.abs(y)>100)interior++;
 }
 assert.ok(ends>0&&interior>0,'兩端尖細，內部不壓成線');
});


test('WARP-ROTATED 真實雷鏈旋轉與半幅裁切仍有17個縱向取樣，波峰隨時間改變',async()=>{
 const PIXI=makePixi();PIXI.MeshGeometry=class{constructor(o){Object.assign(this,o)}getBuffer(){return {update(){}}}};
 PIXI.Mesh=class extends PIXI.Sprite{constructor(o){super(o.texture);this.geometry=o.geometry;this.position=this.scale=this.skew={set(){}}}};
 const {backend}=setup(PIXI),n=backend.createNode({kind:'deformed',warpAxis:'x',assetUrl:'/spark_05.png'});
 await Promise.resolve();await Promise.resolve();n.texture.orig={width:512,height:512};
 const variation={config:{axis:'x',start:0,end:542.464,amplitude:0,motionAmplitude:40},mirror:1,width:1,phase:0,
 motionKey:0,motionTime:0};
 const w={a:0,b:-.459,c:2.0455,d:0,x:5.8781,y:3.6442,originX:0,originY:0,rotation:0,scaleX:1/3,scaleY:1/3,
 variation,clipMin:80,clipMax:542.464,clipTaper:20};
 const t={deformation:w,anchorX:.5,anchorY:0};backend.updateNode(n,t);
 const before=Array.from(n.__warp.positions);
 const xs=new Set(before.filter((_,i)=>i%2===0).map(x=>x.toFixed(3)));
 assert.equal(xs.size,17,'縱向樣本不能因PNG旋轉／裁切退化成2到3點');
 variation.phase=2;variation.motionKey=1;variation.motionTime=1;backend.updateNode(n,t);
 const deltas=[];
 for(let i=0;i<before.length;i+=2){assert.equal(n.__warp.positions[i],before[i]);deltas.push(n.__warp.positions[i+1]-before[i+1]);}
 assert.ok(Math.min(...deltas)<-10 && Math.max(...deltas)>10,'同一幀有反向位移，不能只是整體平移或縮放');
 assert.equal(n.__warp.positions.length/2,85,'保留小網格批次頂點預算');
});


test('WARP-SHIPPED 正式金色與紫色Preset經Core送到GPU，停止位移仍持續變形',async()=>{
 const Core=require('../js/vfx-core.js');
 for(const id of ['bolt-chain-travel-bluewhite','bolt-chain-travel-bluewhite-08']){
  const p=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'../vfx/presets',id+'.json'),'utf8'));
  const PIXI=makePixi();PIXI.MeshGeometry=class{constructor(o){Object.assign(this,o)}getBuffer(){return {update(){}}}};
  PIXI.Mesh=class extends PIXI.Sprite{constructor(o){super(o.texture);this.geometry=o.geometry;this.position=this.scale=this.skew={set(){}}}};
  const {backend,container}=setup(PIXI);
  const rt=Core.createRuntime({backend,resolver:{resolve:x=>x,has:()=>true}});
  rt.registerPreset(p);rt.play(id,{seed:123,loop:true,scaleX:1/3,scaleY:1/3,clipX:{min:80,max:542.464,taper:20}});
  rt.update(0);await Promise.resolve();await Promise.resolve();
  for(const n of container.children)n.texture.orig={width:512,height:512};
  rt.update(.1);const nodes=container.children.filter(n=>n.__warp);
  assert.ok(nodes.length>=2);
  const before=nodes.map(n=>Array.from(n.__warp.positions));
  let peak=0;const mirrors=new Set(),widths=new Set();
  for(let frame=0;frame<60;frame++){
   rt.update(1/60);
   const n=nodes[0];assert.ok(n.visible);
   const shape=n.__warp.cache.variation;mirrors.add(shape.mirror);widths.add(shape.width);
   assert.ok(Math.abs(shape.mirror*shape.width)>.8,"GPU鏡像切換不能穿越零寬度");
   const delta=Array.from(n.__warp.positions).filter((_,i)=>i%2).map((y,i)=>y-before[0][i*2+1]);
   peak=Math.max(peak,Math.max(...delta.map(Math.abs))/3);
  }
  assert.ok(peak>8,id+' 固定位置播放一秒，遊戲等比縮放後彎曲差異超過8px');
  assert.equal(mirrors.size,2);assert.ok(widths.size>5);
 }
});
