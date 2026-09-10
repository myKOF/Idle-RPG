'use strict';
/* ============================================================
   vfx-runtime.test.cjs — VFX Preset 的遊戲端轉接層

   受測對象：js/vfx-runtime.js（Runtime Adapter）
   規格：docs/vfx/VFX_RUNTIME_ADAPTER.md §1（角色語意、主要角色、名目尺寸）

   為什麼用 NullBackend 而不是實機：這一層要驗的全是「決定」——
   哪個角色是主要角色、缺角色時有沒有退回舊畫法、擺在哪、縮放多少、
   場域有沒有依 area.id 合併、狀態光環有沒有隨快照收掉。
   這些在畫面上都長得差不多，只有比對後端實際收到的 transform 才驗得出來。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const VFXCore = require('../js/vfx-core.js');
const VFXRuntime = require('../js/vfx-runtime.js');

const REPO = path.resolve(__dirname, '..');

test('ROCKARMOR 前後半圈跨人物分層、共同中心與時鐘，放大移動續命後仍同步回收', () => {
 const p=JSON.parse(fs.readFileSync(path.join(REPO,'vfx/presets/aura-rockarmor-stone.json'),'utf8'));
 for(const scale of [1,2]) {
  let point={x:300,y:150};
  const {adapter,log}=makeAdapter([p],{profile:{scale},ctx:{footOf:()=>point,posOf:()=>point,playerPos:()=>point}});
  const spec={fxKind:'aura',variant:'rock-armor',targets:['pv-float'],dur:1,vfx:{ground:p.id}};
  assert.equal(adapter.tryPlay(spec),true);adapter.update(.3);
  const back=log.nodes.find(n=>n.spec.assetUrl?.includes('stone-guard-back.png'));
  const front=log.nodes.find(n=>n.spec.assetUrl?.includes('stone-guard-front.png'));
  assert.equal(back.tag,'zone');assert.equal(front.tag,'fx');
  for(let i=0;i<12;i++) {
   point={x:300+i*7,y:150-i*2};adapter.tryPlay(spec);adapter.update(.11);
   const bt=back.transforms.at(-1),ft=front.transforms.at(-1);
   assert.deepEqual(bt,ft,'前後圈必須使用相同中心、尺寸與動畫格');
   assert.equal(ft.x,point.x);assert.equal(ft.y,point.y-32*scale);
   assert.ok(Math.abs(ft.scaleX-.8724*scale)<1e-6);
  }
  assert.equal(log.nodes.filter(n=>n.spec.assetUrl?.includes('stone-guard-')).length,2,'續命不重播');
  adapter.update(4);assert.equal(adapter.stats().grounds,0);
  assert.equal(adapter.stats().fx.activeEffects,0);assert.equal(adapter.stats().zone.activeEffects,0);
 }
});

test('EARTH-REVERSAL 前後半圈跨人物分層、共同中心與時鐘，放大移動續命後仍同步回收', () => {
 const p=JSON.parse(fs.readFileSync(path.join(REPO,'vfx/presets/aura-earth-reversal.json'),'utf8'));
 for(const scale of [1,2]) {
  let point={x:300,y:150};
  const {adapter,log}=makeAdapter([p],{profile:{scale},ctx:{footOf:()=>point,posOf:()=>point,playerPos:()=>point}});
  const spec={fxKind:'aura',variant:'rock-armor',targets:['pv-float'],dur:1,vfx:{ground:p.id}};
  assert.equal(adapter.tryPlay(spec),true);adapter.update(.3);
  const back=log.nodes.find(n=>n.spec.assetUrl?.includes('stone-guard-blue-runes-back.png'));
  const front=log.nodes.find(n=>n.spec.assetUrl?.includes('stone-guard-blue-runes-front.png'));
  assert.equal(back.tag,'zone');assert.equal(front.tag,'fx');
  for(let i=0;i<12;i++) {
   point={x:300+i*7,y:150-i*2};adapter.tryPlay(spec);adapter.update(.11);
   const bt=back.transforms.at(-1),ft=front.transforms.at(-1);
   assert.deepEqual(bt,ft,'前後圈必須使用相同中心、尺寸與動畫格');
   assert.equal(ft.x,point.x);assert.equal(ft.y,point.y-32*scale);
   assert.ok(Math.abs(ft.scaleX-.8724*scale)<1e-6);
  }
  assert.equal(log.nodes.filter(n=>n.spec.assetUrl?.includes('stone-guard-')).length,2,'續命不重播');
  adapter.update(4);assert.equal(adapter.stats().grounds,0);
  assert.equal(adapter.stats().fx.activeEffects,0);assert.equal(adapter.stats().zone.activeEffects,0);
 }
});

test('TORNADO 持續場域本體定位縮放並跨節拍保持同一實例', () => {
 const p=JSON.parse(fs.readFileSync(path.join(REPO,'vfx/presets/fire-tornado-inferno.json'),'utf8'));
 const {adapter,log}=makeAdapter([p]);
 const spec={fxKind:'impact',variant:'pillar',dur:.5,area:{id:'fire-1',x:100,y:50,r:60},vfx:{field:p.id}};
 assert.equal(adapter.tryPlay(spec),true);adapter.update(.3);
 const body=log.nodes.find(n=>n.spec.assetUrl?.includes('fire-flow.png'));
 assert.equal(body.tag,'fx');
 const authored=p.layers.find(l=>l.id==='baked-fire-column');
 const t=body.transforms.at(-1);assert.equal(t.x,100+(authored.position?.x||0));assert.equal(t.y,50+(authored.position?.y||0));assert.equal(t.scaleX/authored.scale.x,t.scaleY/authored.scale.y);
 adapter.tryPlay(spec);adapter.update(.3);assert.equal(adapter.stats().played,1);
 adapter.update(3);assert.equal(adapter.stats().grounds,0);
});

test('FIREWALL 三柱沿火牆軸排列，直立等比、續命與回收', () => {
 const p=JSON.parse(fs.readFileSync(path.join(REPO,'vfx/presets/ground-firewall.json'),'utf8'));
 for(const angle of [0,Math.PI/4,Math.PI/2,Math.PI]) {
  const {adapter,log}=makeAdapter([p]);
  const spec={fxKind:'aura',variant:'firewall',dur:.5,area:{id:'wall',x:300,y:200,w:360,h:120,a:angle},vfx:{ground:p.id}};
  assert.equal(adapter.tryPlay(spec),true);adapter.update(.3);
  const bodies=log.nodes.filter(n=>n.spec.assetUrl?.includes('fire-flow.png'));
  assert.equal(bodies.length,3);
  bodies.forEach((b,i)=>{
   const t=b.transforms.at(-1);
   const authored=p.layers.find(l=>l.id==='column-'+i+'-baked-fire-column');
   assert.equal(b.tag,'fx');assert.equal(t.scaleX/authored.scale.x,t.scaleY/authored.scale.y);assert.equal(t.rotation,0);
   assert.ok(Math.abs(t.x-(300+Math.cos(angle)*(i-1)*96+(authored.position.x-(i-1)*p.sizing.authored.width*.8/3)*120/(p.sizing.authored.width/3)))<1e-6);
   assert.ok(Math.abs(t.y-(200+Math.sin(angle)*(i-1)*96))<1e-6);
  });
  adapter.tryPlay(spec);adapter.update(.3);assert.equal(adapter.stats().played,3);
  adapter.update(3);assert.equal(adapter.stats().grounds,0);
 }
});

test('TORNADO 0.3 秒升起與淡出，續命不重播進場', () => {
 const p=JSON.parse(fs.readFileSync(path.join(REPO,'vfx/presets/fire-tornado-inferno.json'),'utf8'));
 const {adapter,log}=makeAdapter([p]);
 const spec={fxKind:'impact',variant:'pillar',dur:.5,area:{id:'rise',x:0,y:0,r:60},vfx:{field:p.id}};
 adapter.tryPlay(spec);adapter.update(.15);
 const body=log.nodes.find(n=>n.spec.assetUrl?.includes('fire-flow.png'));
 const authored=p.layers.find(l=>l.id==='baked-fire-column');
 const alpha=authored.alpha===undefined?1:authored.alpha;
 assert.ok(Math.abs(body.transforms.at(-1).alpha/alpha-.5)<1e-6);
 assert.ok(Math.abs(body.transforms.at(-1).scaleX/authored.scale.x-.5*60/p.sizing.authored.radius)<1e-6);
 assert.ok(Math.abs(body.transforms.at(-1).scaleY/authored.scale.y-.5*60/p.sizing.authored.radius)<1e-6);
 adapter.update(.15);assert.equal(body.transforms.at(-1).alpha,alpha);
 adapter.tryPlay(spec);adapter.update(.15);assert.equal(body.transforms.at(-1).alpha,alpha);
 adapter.update(.95);assert.ok(Math.abs(body.transforms.at(-1).alpha/alpha-.5)<1e-6);
 assert.ok(Math.abs(body.transforms.at(-1).scaleX/authored.scale.x-.5*60/p.sizing.authored.radius)<1e-6);
 assert.ok(Math.abs(body.transforms.at(-1).scaleY/authored.scale.y-.5*60/p.sizing.authored.radius)<1e-6);
 adapter.update(.151);assert.equal(adapter.stats().grounds,0);
});

test('COUNTER 反擊從角色飛向敵人，追加子彈延遲 0.2 秒', () => {
 const p=JSON.parse(fs.readFileSync(path.join(REPO,'vfx/presets/proj-counter-ripple.json'),'utf8'));
 const {adapter,log}=makeAdapter([p]);
 const spec={fxKind:'strike',variant:'counter-riposte',targets:['mv-float-2'],travelMs:[200],vfx:{projectile:p.id}};
 assert.equal(adapter.tryPlay(spec),true);
 adapter.tryPlay({...spec,delayMs:200});
 adapter.update(.1);assert.equal(adapter.stats().played,1);
 const body=log.nodes.find(n=>n.spec.assetUrl===RESOLVER.resolve(p.layers[0].assetId));
 assert.ok(body.transforms.at(-1).x>0 && body.transforms.at(-1).x<300);
 adapter.update(.11);assert.equal(adapter.stats().played,2);
 adapter.update(1);assert.equal(adapter.stats().fx.activeEffects,0);
});

test('BLOODBLADE 核准爆破在命中目標播放並完整消退', () => {
  const preset = JSON.parse(fs.readFileSync(path.join(REPO,'vfx/presets/hit-bloodblade-burst.json'),'utf8'));
  const {adapter,log} = makeAdapter([preset]);
  assert.equal(adapter.tryPlay({fxKind:'slash',variant:'bloodblade',targets:['mv-float-2'],vfx:{attack:preset.id}}),true);
  adapter.update(.035);
  const spriteAssets = preset.layers.filter(l=>l.type==='sprite').map(l=>RESOLVER.resolve(l.assetId));
  const sprites = log.nodes.filter(n=>spriteAssets.includes(n.spec.assetUrl));
  assert.ok(sprites.length >= 4);
  for(const n of sprites){const t=n.transforms.at(-1);assert.equal(t.x,300);assert.equal(t.y,50);}
  assert.equal(adapter.stats().skipped,0);
  adapter.update(.265);
  const burst = log.nodes.find(n=>n.spec.assetUrl===RESOLVER.resolve(preset.layers.find(l=>l.id==='blood-burst').assetId));
  assert.ok(burst.transforms.at(-1).alpha > .7, '0.3 秒仍有清楚紅色主體');
  adapter.update(1);
  assert.equal(adapter.stats().fx.activeEffects,0);
});

test('FIELD 持續本體與地面提示分層、同 id 不互相替換，舊 ground 仍可用', () => {
  const {adapter,log}=makeAdapter([unitPreset('body',5),unitPreset('floor',5)]);
  const spec={fxKind:'aura',variant:'thunder-orb',dur:.35,area:{id:'orb-1',x:10,y:20,r:30},vfx:{field:'body',ground:'floor'}};
  assert.equal(adapter.tryPlay(spec),true);
  adapter.update(.01);
  assert.equal(adapter.stats().grounds,2);
  assert.ok(lastOf(log,'fx'));
  assert.ok(lastOf(log,'zone'));
  for(let i=0;i<4;i++){adapter.tryPlay(spec);adapter.update(.1);}
  assert.equal(adapter.stats().played,2,'重複節拍只續命，不重建本體或地面');
  adapter.update(2);
  assert.equal(adapter.stats().grounds,0,'本體與地面均到期回收');
  assert.equal(adapter.tryPlay({...spec,vfx:{ground:'floor'}}),true);
  assert.equal(adapter.stats().grounds,1);
  adapter.clear();
  assert.equal(adapter.stats().grounds,0);
});

test('GALE 月牙只在主目標播放，依半徑等比縮放、不壓扁或複製', () => {
  const moon = unitPreset('moon');
  moon.sizing = {shape:'custom',widthM:10,heightM:10,authored:{width:100,height:100,radius:50}};
  const {adapter, log} = makeAdapter([moon]);
  adapter.tryPlay({fxKind:'slash',variant:'gale-moon',targets:['mv-float-1','mv-float-2'],
    area:{x:100,y:50,r:75},vfx:{attack:'moon'}});
  adapter.update(.05);
  assert.equal(log.nodes.length,1);
  const t=log.nodes[0].transforms.at(-1);
  assert.equal(t.x,100); assert.equal(t.y,50);
  assert.equal(t.scaleX,1.5); assert.equal(t.scaleY,1.5);
  assert.equal(t.rotation,Math.atan2(50,100)-.15);
  for (const angle of [0,.15]) {
    adapter.tryPlay({fxKind:'slash',variant:'gale-moon',targets:['mv-float-1'],
      area:{x:100,y:50,r:75},vfx:{attack:'moon'}});
    adapter.update(.01);
    assert.equal(log.nodes.at(-1).transforms.at(-1).rotation,Math.atan2(50,100)+angle);
  }
  adapter.clear();
  adapter.tryPlay({fxKind:'slash',variant:'gale-moon',targets:['mv-float-1'],
    area:{x:100,y:50,r:75},vfx:{attack:'moon'}});
  adapter.update(.01);
  assert.equal(log.updates.at(-1).rotation,Math.atan2(50,100)-.15);
});

test('GALE 刃口隨施法者到目標的八方向旋轉，同座標保持有限角度', () => {
  const {adapter,log}=makeAdapter([unitPreset('moon')]);
  for (let i=0;i<8;i++) {
    adapter.clear();
    const a=i*Math.PI/4;
    const x=Math.cos(a)*100,y=Math.sin(a)*100;
    adapter.tryPlay({fxKind:'slash',variant:'gale-moon',targets:[],area:{x,y,r:50},vfx:{attack:'moon'}});
    adapter.update(.01);
    assert.equal(log.updates.at(-1).rotation,Math.atan2(y,x)-.15);
  }
  adapter.clear();
  adapter.tryPlay({fxKind:'slash',variant:'gale-moon',sourceId:'mv-float-2',targets:['mv-float-1'],vfx:{attack:'moon'}});
  adapter.update(.01);
  assert.equal(log.updates.at(-1).rotation,Math.PI-.15);
  adapter.clear();
  adapter.tryPlay({fxKind:'slash',variant:'gale-moon',targets:[],area:{x:0,y:0,r:50},vfx:{attack:'moon'}});
  adapter.update(.01);
  assert.equal(log.updates.at(-1).rotation,-.15);
});

test('THRUST 八方向各三條平行道，尺寸／位置來自事件，飛行物不預播命中', () => {
  const lance = unitPreset('lance');
  lance.sizing = { shape: 'rectangle', widthM: 12, heightM: 3, authored: { width: 120, height: 30 } };
  const { adapter, log } = makeAdapter([lance, unitPreset('hit')]);
  assert.equal(adapter.tryPlay({ fxKind: 'slash', variant: 'thrust-octagonal', projectile: true,
    targets: ['mv-float-1'], angle: Math.PI / 2, lineLength: 240, lineWidth: 60, travelMs: [1000],
    laneOffsets: [-30, 0, 30], directionCount: 8, vfx: { attack: 'lance', hit: 'hit' } }), true);
  adapter.update(0.01);
  assert.equal(log.nodes.length, 24);
  const transforms = log.nodes.map(n => n.transforms.at(-1));
  assert.ok(transforms.every(t => Math.abs(t.scaleX - 0.02) < 1e-8 && t.scaleY === 4 / 3));
  adapter.update(0.49);
  const moved = log.nodes.map(n => n.transforms.at(-1));
  assert.ok(moved.every(t => Math.abs(t.scaleX - 2 / 3) < 1e-8 && t.scaleY === 4 / 3));
  assert.ok(moved.some(t => Math.abs(t.x - 30) < 1e-8 && Math.abs(t.y - 40) < 1e-8));
  adapter.update(0.2);
  assert.ok(log.nodes.every(n => Math.abs(n.transforms.at(-1).scaleX - 2 / 3) < 1e-8));
  assert.ok(transforms.some(t => Math.abs(t.x - 30) < 1e-8 && Math.abs(t.y) < 1e-8));
  assert.equal(new Set(transforms.map(t => t.rotation.toFixed(4))).size, 8);
  adapter.clear(); assert.equal(adapter.stats().fx.activeEffects, 0);
});

test('THRUST 高塔直送 Adapter 的波次遵守 delayMs，clear 取消未播波次', () => {
  const { adapter, log } = makeAdapter([unitPreset('lance')]);
  const spec = { fxKind: 'slash', variant: 'thrust', lineLength: 120, lineWidth: 30,
    targets: ['mv-float-1'], angle: null, delayMs: 90, vfx: { attack: 'lance' } };
  assert.equal(adapter.tryPlay(spec), true);
  adapter.update(0.08); assert.equal(log.nodes.length, 0);
  adapter.update(0.02); assert.equal(log.nodes.length, 1);
  assert.equal(log.nodes[0].transforms.at(-1).rotation, Math.atan2(50, 100));
  adapter.tryPlay(spec); adapter.clear(); adapter.update(0.2);
  assert.equal(adapter.stats().fx.activeEffects, 0);
});

/* ---- 測試替身 ---------------------------------------------------------- */

/* 記錄每一次 createNode／updateNode，用來檢查「畫在哪、多大」。 */
function recordingBackend(log, tag) {
  return {
    createNode(spec) { const n = { tag, spec, transforms: [] }; log.nodes.push(n); return n; },
    updateNode(node, t) {
      if (!t || t.visible === false) return;
      node.transforms.push({ x: t.x, y: t.y, rotation: t.rotation, scaleX: t.scaleX, scaleY: t.scaleY, alpha: t.alpha, frame: t.frame });
      log.updates.push({ tag, x: t.x, y: t.y, rotation: t.rotation, scaleX: t.scaleX, scaleY: t.scaleY });
    },
    destroyNode() {},
    destroy() {}
  };
}

const RESOLVER = { has: () => true, resolve: (id) => '/' + id };

/* 一份最小 preset：單一 sprite、不隨生命週期變形，
   這樣後端收到的 scale 就等於 Adapter 決定的 scale（乘上圖層自身的 1）。 */
function unitPreset(id, duration, loop) {
  return {
    schemaVersion: 1, id, duration: duration || 1, loop: !!loop,
    /* 每份 preset 用不同的 assetId：Core 會把同一種 nodeSpec 的節點放回池子重用，
       素材相同的話「新建了幾個節點」就分不出是哪一份特效。 */
    layers: [{ id: 'a', type: 'sprite', assetId: id + '.png', zIndex: 0, scale: { x: 1, y: 1 } }]
  };
}

const ENT = {
  'mv-float-1': { x: 100, y: 50 },
  'mv-float-2': { x: 300, y: 50 },
  'pv-float': { x: 0, y: 0 }
};

test('DUALDANCE 延遲後播放第二刀並使用交替角差',()=>{
 const {adapter,log}=makeAdapter([unitPreset('slash-dual')]);
 const spec={fxKind:'slash',variant:'dual-slash',targets:['mv-float-2'],vfx:{attack:'slash-dual'},angle:0};
 assert.equal(adapter.tryPlay(spec),true);adapter.update(.01);
 const first=log.nodes[0].transforms.at(-1).rotation;
 adapter.tryPlay({...spec,delayMs:200,angle:1.5});adapter.update(.19);
 assert.equal(adapter.stats().played,1);adapter.update(.02);
 assert.equal(adapter.stats().played,2);
 assert.ok(Math.abs(log.nodes.at(-1).transforms.at(-1).rotation-first-1.5)<1e-6);
});

function makeAdapter(presets, over) {
  const log = { nodes: [], updates: [] };
  const adapter = VFXRuntime.create(Object.assign({
    core: VFXCore,
    resolver: RESOLVER,
    fxBackend: recordingBackend(log, 'fx'),
    zoneBackend: recordingBackend(log, 'zone'),
    ctx: {
      posOf: (id) => Object.assign({}, ENT[id] || { x: -999, y: -999 }),
      playerPos: () => ({ x: 0, y: 0 }),
      projectileTargetPoint: (id) => Object.assign({}, ENT[id] || { x: -999, y: -999 })
    }
  }, over || {}));
  adapter.registerPresets(presets);
  return { adapter, log };
}

test('METEOR 新版落地爆破只由命中事件播放一次',()=>{
 const {adapter}=makeAdapter([unitPreset('proj-meteor-inferno',2),unitPreset('burst-meteor-inferno')]);
 const vfx={projectile:'proj-meteor-inferno',hit:'burst-meteor-inferno'};
 adapter.tryPlay({fxKind:'rain',variant:'meteor',targets:['mv-float-2'],travelMs:[500],vfx});
 adapter.update(.6);assert.equal(adapter.stats().played,1);
 adapter.tryPlay({fxKind:'impact',targets:['mv-float-2','mv-float-3'],area:{x:100,y:100,r:150},vfx});
 assert.equal(adapter.stats().played,2);
});

/* 取某一層 tag 的最後一筆 transform */
function lastOf(log, tag) {
  for (let i = log.updates.length - 1; i >= 0; i--) if (log.updates[i].tag === tag) return log.updates[i];
  return null;
}

/* ============================================================
   ROLE — 主要角色的選擇（§1.1）
   ============================================================ */

test('BASIC-HIT 普攻及追加普攻忽略舊攻擊欄，只播放一次受擊', () => {
 const {adapter}=makeAdapter([unitPreset('hit-only'),unitPreset('old-slash')]);
 for(const variant of ['melee','melee-extra']) {
  const before=adapter.stats().played;
  assert.equal(adapter.tryPlay({cat:'basic',fxKind:'slash',variant,targets:['mv-float-2'],vfx:{attack:'old-slash',hit:'hit-only'}}),true);
  assert.equal(adapter.stats().played,before+1);
 }
 assert.equal(VFXRuntime.primaryRoleOf({cat:'basic',fxKind:'projectile'},{hit:'hit-only',projectile:'old-slash'}),'hit');
});

test('ROLE-1 各 fxKind 的主要角色與設計文件一致', function () {
  const R = VFXRuntime.primaryRoleOf;
  const all = { cast: 'c', attack: 'a', projectile: 'p', hit: 'h', ground: 'g' };
  assert.equal(R({ fxKind: 'projectile' }, all), 'projectile');
  assert.equal(R({ fxKind: 'slash' }, all), 'attack');
  assert.equal(R({ fxKind: 'strike' }, all), 'attack');
  assert.equal(R({ fxKind: 'burst' }, all), 'attack');
  assert.equal(R({ fxKind: 'beam' }, all), 'attack');
  assert.equal(R({ fxKind: 'curse' }, all), 'attack');
  assert.equal(R({ fxKind: 'aura' }, all), 'ground');
  assert.equal(R({ fxKind: 'selfBuff' }, all), 'cast');
  assert.equal(R({ fxKind: 'impact' }, all), 'hit');
});

test('ROLE-2 rain 與 chain 有飛行物就走飛行物，沒有才退回攻擊本體', function () {
  const R = VFXRuntime.primaryRoleOf;
  assert.equal(R({ fxKind: 'rain' }, { projectile: 'p', attack: 'a' }), 'projectile');
  assert.equal(R({ fxKind: 'rain' }, { attack: 'a' }), 'attack');
  assert.equal(R({ fxKind: 'chain' }, { projectile: 'p' }), 'projectile');
  assert.equal(R({ fxKind: 'chain' }, { attack: 'a' }), 'attack');
});

test('ROLE-3 變體特例：柱狀當場域、wind-burst 當攻擊、starfall-impact 只做受擊', function () {
  const R = VFXRuntime.primaryRoleOf;
  const all = { cast: 'c', attack: 'a', projectile: 'p', hit: 'h', ground: 'g' };
  assert.equal(R({ fxKind: 'impact', variant: 'pillar' }, all), 'ground');
  assert.equal(R({ fxKind: 'impact', variant: 'wind-burst' }, all), 'attack');
  assert.equal(R({ fxKind: 'burst', variant: 'wind-burst' }, all), 'attack');
  assert.equal(R({ fxKind: 'impact', variant: 'smite' }, all), 'attack');
  assert.equal(R({ fxKind: 'rain', variant: 'starfall-impact' }, all), 'hit');
});

test('ROLE-4 敵方攻擊：遠程走飛行物、近戰走攻擊本體', function () {
  const R = VFXRuntime.primaryRoleOf;
  const all = { attack: 'a', projectile: 'p', hit: 'h' };
  assert.equal(R({ fxKind: 'enemy-attack', variant: 'enemy-projectile' }, all), 'projectile');
  assert.equal(R({ fxKind: 'enemy-attack' }, all), 'attack');
});

/* ============================================================
   FALLBACK — 缺主要角色一律退回舊畫法
   ============================================================ */

test('FALLBACK-1 沒有 spec.vfx／缺主要角色／preset 沒註冊，都回 false', function () {
  const { adapter } = makeAdapter([unitPreset('hit-x')]);
  assert.equal(adapter.tryPlay({ fxKind: 'impact', targets: ['mv-float-1'] }), false, '沒有 vfx 欄位');
  assert.equal(adapter.tryPlay({ fxKind: 'impact', targets: ['mv-float-1'], vfx: { ground: 'hit-x' } }), false,
    'impact 的主要角色是 hit，只填 ground 不算');
  assert.equal(adapter.tryPlay({ fxKind: 'impact', targets: ['mv-float-1'], vfx: { hit: 'not-loaded' } }), false,
    'preset 沒有載入時不能假裝播了');
  assert.equal(adapter.tryPlay({ fxKind: 'impact', targets: ['mv-float-1'], vfx: { hit: 'hit-x' } }), true);
});

test('FALLBACK-2 受擊沒有任何目標時回 false（不能炸在原點）', function () {
  const { adapter } = makeAdapter([unitPreset('hit-x')]);
  assert.equal(adapter.tryPlay({ fxKind: 'impact', targets: [], vfx: { hit: 'hit-x' } }), false);
});

/* 這一組共用：把 budget 縮到極小，才驗得到「超預算時怎麼辦」。
   正式設定已經不節流了（見 BUDGET-1），所以不能靠預設值打爆它。 */
function tinyBudgetAdapter() {
  return makeAdapter([unitPreset('proj-x', 5)], { fxBudget: { maxActiveEffects: 3 } });
}
const SHOT = {
  fxKind: 'projectile', targets: [], angle: 0, lineLength: 300, travelMs: [4000],
  vfx: { projectile: 'proj-x' }
};

test('FALLBACK-3 超出 budget 時整則丟掉，不落回舊畫法', function () {
  /* 2026-09-06 實機回報：一次風刃齊射裡有幾道是 Preset、有幾道是舊的綠鐮刀。
     成因不是缺 preset，是 Core 的 maxActiveEffects 被打爆——play() 回 null，
     tryPlay 就回 false，於是那幾道改由 battle-renderer 的 drawWindCrescent 畫。
     兩種畫風並存比少一道明顯得多，所以超預算時要「吃掉」這一則。 */
  const { adapter } = tinyBudgetAdapter();
  let played = 0;
  for (let i = 0; i < 20; i++) if (adapter.tryPlay(Object.assign({}, SHOT))) played++;
  const s = adapter.stats();
  assert.ok(s.fx.droppedEffects > 0, '這一輪要真的打爆預算，否則這條沒驗到東西');
  assert.equal(played, 20, '每一則都要被接手——回 false 就會有舊畫法混進來');
  assert.equal(s.skipped, 0, '超預算不算「沒有 preset」，不能記成 skipped');
  assert.equal(s.dropped, s.fx.droppedEffects, '丟掉幾則要對得上 Core 丟掉幾個特效');
});

test('FALLBACK-4 超預算被吃掉，缺 preset 仍然退回舊畫法', function () {
  /* 上一條的反面：不能為了不混畫風就把「這份 preset 根本不存在」也吞掉，
     那會變成該有的特效整個不見。 */
  const { adapter } = tinyBudgetAdapter();
  for (let i = 0; i < 20; i++) adapter.tryPlay(Object.assign({}, SHOT));
  assert.ok(adapter.stats().fx.droppedEffects > 0, '預算已經滿了');
  assert.equal(adapter.tryPlay({
    fxKind: 'projectile', targets: [], angle: 0, lineLength: 300, travelMs: [400],
    vfx: { projectile: 'not-loaded' }
  }), false, '沒有這份 preset 就該退回舊畫法，與預算滿不滿無關');
});

test('BUDGET-1 正式設定不節流：畫面上同時幾百個特效也不丟', function () {
  /* 使用者決策 2026-09-06：效能節流先整個拿掉，等實機體感再決定數字。
     這一條釘住「預設不綁」——之後要重新開啟節流時它會紅，那正是提醒：
     改了數字就要一起想清楚「被丟掉的那幾則會不會被看出來」。 */
  const { adapter } = makeAdapter([unitPreset('proj-x', 5)]);
  for (let i = 0; i < 500; i++) adapter.tryPlay(Object.assign({}, SHOT));
  const s = adapter.stats();
  assert.equal(s.fx.droppedEffects, 0, '500 個同時存在也不該被丟掉');
  assert.equal(s.dropped, 0);
  assert.equal(s.played, 500);
  /* 上限仍然是個有限值（Core 的硬上限），只是高到不會綁住任何合理用途。 */
  assert.ok(isFinite(s.fx.budget.maxActiveEffects));
  assert.ok(s.fx.budget.maxActiveEffects >= 65536, '同時特效數不該再是節流點');
  assert.ok(s.zone.budget.maxActiveEffects >= 65536, '場域那一面也一樣');
});

/* ============================================================
   PLACE — 擺在哪、多大（§1.1 的 Runtime 怎麼放 / §1.2 名目尺寸）
   ============================================================ */

test('PLACE-1 受擊爆點落在目標身上，範圍型放大 1.6 倍', function () {
  const { adapter, log } = makeAdapter([unitPreset('hit-x'), unitPreset('burst-x')]);
  adapter.tryPlay({ fxKind: 'impact', targets: ['mv-float-2'], vfx: { hit: 'hit-x' } });
  adapter.update(1 / 60);
  const t = lastOf(log, 'fx');
  assert.equal(t.x, 300); assert.equal(t.y, 50);
  assert.equal(t.scaleX, 1, '單體命中不放大');

  /* 範圍爆發：主要角色是 attack，同一則事件的 hit 是「每個目標身上的爆點」，
     那一份要放大——一顆隕石的落點不該和一刀砍中同樣大小。 */
  const before = log.nodes.length;
  adapter.tryPlay({
    fxKind: 'burst', targets: ['mv-float-2'], area: { x: 0, y: 0, r: 100 },
    vfx: { attack: 'burst-x', hit: 'hit-x' }
  });
  adapter.update(1 / 60);
  const fresh = log.nodes.slice(before).filter(n => n.transforms.length);
  assert.equal(fresh.length, 2, '攻擊本體與受擊爆點各一份');
  assert.equal(fresh[1].transforms[0].scaleX, 1.6, '範圍型命中放大 1.6 倍');
});

test('PLACE-2 範圍爆發放在範圍中心，圓形 scale = r/100、矩形 scaleX = w/200', function () {
  const { adapter, log } = makeAdapter([unitPreset('burst-x')]);
  adapter.tryPlay({
    fxKind: 'burst', targets: ['mv-float-1'], area: { x: 40, y: 60, r: 250 }, vfx: { attack: 'burst-x' }
  });
  adapter.update(1 / 60);
  let t = lastOf(log, 'fx');
  assert.equal(t.x, 40); assert.equal(t.y, 60);
  assert.equal(t.scaleX, 2.5, 'r 250 → scale 2.5');

  adapter.tryPlay({
    fxKind: 'aura', area: { id: 'g1', x: 0, y: 0, w: 400, h: 50, a: 0.5 }, dur: 0.5,
    vfx: { ground: 'burst-x' }
  });
  adapter.update(1 / 60);
  t = lastOf(log, 'zone');
  assert.equal(t.scaleX, 2, 'w 400 → scaleX 2');
  assert.equal(t.scaleY, 0.5, 'h 50 → scaleY 0.5');
  assert.equal(+t.rotation.toFixed(3), 0.5, 'area.a 就是旋轉角');
});

test('PLACE-3 光束沿 +X 拉到目標：scaleX = 距離/200，rotation 對準', function () {
  const { adapter, log } = makeAdapter([unitPreset('beam-x')]);
  /* 玩家在 (0,0)、目標在 (300,50) → 距離 √(300²+50²) ≈ 304.14 */
  adapter.tryPlay({ fxKind: 'beam', targets: ['mv-float-2'], vfx: { attack: 'beam-x' } });
  adapter.update(1 / 60);
  const t = lastOf(log, 'fx');
  const dist = Math.sqrt(300 * 300 + 50 * 50);
  assert.equal(+t.scaleX.toFixed(4), +(dist / 200).toFixed(4));
  assert.equal(+t.rotation.toFixed(4), +Math.atan2(50, 300).toFixed(4));
  assert.equal(t.x, 0, '光束的根部在起點');
});

test('PLACE-4 施放特效跟著玩家走', function () {
  let px = 0;
  const { adapter, log } = makeAdapter([unitPreset('cast-x', 2)], {
    ctx: {
      posOf: (id) => (id === 'pv-float' ? { x: px, y: 0 } : { x: 0, y: 0 }),
      playerPos: () => ({ x: px, y: 0 }),
      projectileTargetPoint: () => ({ x: 0, y: 0 })
    }
  });
  adapter.tryPlay({ fxKind: 'selfBuff', dur: 1, vfx: { cast: 'cast-x' } });
  adapter.update(1 / 60);
  assert.equal(lastOf(log, 'fx').x, 0);
  px = 77;
  adapter.update(1 / 60);
  assert.equal(lastOf(log, 'fx').x, 77, '玩家移動後施放光環要跟上');
});

/* ============================================================
   MOVE — 飛行物逐幀前進
   ============================================================ */

test('MOVE-1 飛行物從玩家飛到目標，抵達後收掉', function () {
  const { adapter, log } = makeAdapter([unitPreset('proj-x', 2)]);
  adapter.tryPlay({
    fxKind: 'projectile', targets: ['mv-float-2'], travelMs: [500], vfx: { projectile: 'proj-x' }
  });
  assert.equal(adapter.stats().projectiles, 1);
  adapter.update(0.25);
  const mid = lastOf(log, 'fx');
  assert.equal(mid.x, 150, '半程在起點與目標的中間');
  assert.equal(mid.y, 25);
  adapter.update(0.25);
  assert.equal(adapter.stats().projectiles, 0, '抵達後不再持有');
});

test('MOVE-2 連鎖段從前一個目標出發，不是從玩家', function () {
  const { adapter, log } = makeAdapter([unitPreset('proj-x', 2)]);
  adapter.tryPlay({
    fxKind: 'chain', targets: ['mv-float-1', 'mv-float-2'], travelMs: [0, 400],
    vfx: { projectile: 'proj-x' }
  });
  adapter.update(1 / 60);
  const t = lastOf(log, 'fx');
  assert.ok(t.x >= 100 && t.x < 300, '起點是 mv-float-1（x=100），不是玩家（x=0），收到：' + t.x);
});

/* AI_RULES 8.3.1：轉彎不得折角。連鎖的第二段起要接上一段的航向，
   整條鏈因此是一條連續彎過去的線，而不是每個彈射點在一幀之內折一次角。 */
test('MOVE-2c 連鎖的下一段以上一段的航向為起始切線（不折角）', function () {
  const { adapter, log } = makeAdapter([unitPreset('proj-x', 4)]);
  const chain = (a, b) => ({
    fxKind: 'chain', targets: [a, b], travelMs: [0, 400], vfx: { projectile: 'proj-x' }
  });
  /* 第一段：玩家(0,0) → mv-float-1(100,50)，航向約 +27 度。 */
  adapter.tryPlay({ fxKind: 'projectile', targets: ['mv-float-1'], travelMs: [200],
    vfx: { projectile: 'proj-x' } });
  for (let i = 0; i < 14; i++) adapter.update(1 / 60);   // 飛完並記下抵達航向
  assert.equal(adapter.stats().projectiles, 0, '第一段要先抵達');

  /* 第二段：mv-float-1(100,50) → mv-float-2(300,50)，弦是正右方。
     若照直線畫，方向會在銜接處從 +27 度跳到 0 度；接上航向之後，
     出發的頭幾幀必須仍朝著上一段的方向（也就是 y 要先繼續往下走）。 */
  adapter.tryPlay(chain('mv-float-1', 'mv-float-2'));
  adapter.update(1 / 60);
  const first = lastOf(log, 'fx');
  assert.ok(first.y > 50 + 0.05,
    '轉彎要從上一段的航向切出去（y 應先繼續往下），收到 y=' + first.y);

  /* 終點仍是模擬層的目標點、抵達時刻仍是事件的 travelMs：路徑彎了，時序不變。 */
  for (let i = 0; i < 21; i++) adapter.update(1 / 60);
  assert.equal(adapter.stats().projectiles, 1, 'travelMs 之前還在飛');
  for (let i = 0; i < 3; i++) adapter.update(1 / 60);
  assert.equal(adapter.stats().projectiles, 0, '仍在 travelMs 那一刻抵達');
  const last = lastOf(log, 'fx');
  assert.ok(Math.abs(last.x - 300) < 1 && Math.abs(last.y - 50) < 1,
    '終點仍是目標座標，收到 ' + last.x + ',' + last.y);
});

/* 沿路不得有折角，也不得有「停一下再彈出去」的近乎靜止點。 */
test('MOVE-2d 連鎖的轉彎路徑處處連續（沒有折角、沒有停頓）', function () {
  const { adapter, log } = makeAdapter([unitPreset('proj-x', 4)]);
  adapter.tryPlay({ fxKind: 'projectile', targets: ['mv-float-1'], travelMs: [200],
    vfx: { projectile: 'proj-x' } });
  for (let i = 0; i < 14; i++) adapter.update(1 / 60);
  adapter.tryPlay({ fxKind: 'chain', targets: ['mv-float-1', 'mv-float-2'],
    travelMs: [0, 400], vfx: { projectile: 'proj-x' } });

  const pts = [];
  for (let i = 0; i < 24; i++) {
    adapter.update(1 / 60);
    const t = lastOf(log, 'fx');
    pts.push({ x: t.x, y: t.y });
  }
  let maxTurn = 0, minStep = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const a1 = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    const a2 = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
    maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1))));
    minStep = Math.min(minStep, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  assert.ok(maxTurn < 0.25, '沿路不得有折角，實測最大單幀轉角 ' + maxTurn.toFixed(3));
  assert.ok(minStep > 0.5, '路徑上不得出現近乎停止的點，實測最小步長 ' + minStep.toFixed(3));
});

test('MOVE-2b 敵方出手的投射物從攻擊者身上出發，不是從玩家', function () {
  const { adapter, log } = makeAdapter([unitPreset('proj-x', 2)]);
  adapter.tryPlay({
    fxKind: 'enemy-attack', variant: 'enemy-projectile', sourceId: 'mv-float-2',
    targets: ['pv-float'], travelMs: [400], vfx: { projectile: 'proj-x' }
  });
  adapter.update(1 / 60);
  const t = lastOf(log, 'fx');
  assert.ok(t.x > 200, '起點應該在攻擊者（x=300）附近而不是玩家（x=0），收到：' + t.x);
});

test('MOVE-3b 被閃避／無敵擋下的攻擊不畫受擊爆點', function () {
  const { adapter } = makeAdapter([unitPreset('proj-x', 2), unitPreset('hit-x')]);
  adapter.tryPlay({
    fxKind: 'enemy-attack', variant: 'enemy-projectile', sourceId: 'mv-float-2',
    targets: ['pv-float'], travelMs: [200], hit: false,
    vfx: { projectile: 'proj-x', hit: 'hit-x' }
  });
  assert.equal(adapter.stats().pending, 0, 'hit:false 時不排受擊');
});

test('MOVE-4 方向型飛行物：沒有任何目標也要接手，並沿 angle 飛滿 lineLength', function () {
  const { adapter, log } = makeAdapter([unitPreset('blade-x', 2)]);
  /* 風刃是「朝某個方位射出」——四方向齊射時路徑上可能一個敵人都沒有。
     這裡若退回 false，同一個技能就會同時出現新舊兩種畫面（2026-09-03 實機回報）。 */
  const ok = adapter.tryPlay({
    fxKind: 'projectile', variant: 'wind-blade', targets: [],
    angle: 0, lineLength: 300, lineWidth: 40, travelMs: [500],
    vfx: { projectile: 'blade-x' }
  });
  assert.equal(ok, true, '沒有目標也必須接手');
  adapter.update(0.25);
  const mid = lastOf(log, 'fx');
  /* 起點是 playerPos（替身 (0,0)），角度 0 → 半程應在 x=150 */
  assert.ok(Math.abs(mid.x - 150) < 2, '半程要在方位上飛一半，實際 x=' + Math.round(mid.x));
  assert.ok(Math.abs(mid.y) < 2, '角度 0 不該有 y 位移，實際 y=' + Math.round(mid.y));
  adapter.update(0.3);
  assert.equal(adapter.stats().projectiles, 0, '飛滿 lineLength 就結束');
});

test('MOVE-5 方向型飛行物不追目標：有敵人也照著方位飛', function () {
  const { adapter, log } = makeAdapter([unitPreset('blade-x', 2)]);
  /* 目標在 (300,50)，但模擬層的方位是 0（正右）——判定走的是那條直線，
     畫面轉去追人就會與判定分家（AI_RULES 8.3）。 */
  adapter.tryPlay({
    fxKind: 'projectile', variant: 'wind-blade', targets: ['mv-float-2'],
    angle: 0, lineLength: 300, travelMs: [500], vfx: { projectile: 'blade-x' }
  });
  /* 不要剛好推到 k=1：抵達的那一幀特效已經被收掉，後端不會再收到 transform。 */
  adapter.update(0.4);
  const end = lastOf(log, 'fx');
  assert.ok(Math.abs(end.y) < 2, '不該被目標的 y=50 拉過去，實際 y=' + Math.round(end.y));
  assert.ok(end.x > 200, '要沿方位飛出去，實際 x=' + Math.round(end.x));
});

test('MOVE-3 帶飛行物的事件，受擊爆點等它抵達才播', function () {
  const { adapter, log } = makeAdapter([unitPreset('proj-x', 2), unitPreset('hit-x')]);
  adapter.tryPlay({
    fxKind: 'projectile', targets: ['mv-float-2'], travelMs: [400],
    vfx: { projectile: 'proj-x', hit: 'hit-x' }
  });
  assert.equal(adapter.stats().pending, 1, '受擊先排隊');
  const playedBefore = adapter.stats().played;
  adapter.update(0.3);
  assert.equal(adapter.stats().played, playedBefore, '0.3s < 0.4s：還沒抵達就不該播受擊');
  adapter.update(0.15);
  assert.equal(adapter.stats().pending, 0);
  assert.equal(adapter.stats().played, playedBefore + 1, '抵達後才播受擊');
});

/* ============================================================
   GROUND — 場域依 area.id 合併與續命
   ============================================================ */

test('GROUND-1 同一個 area.id 的連續事件只維持一份，並追上最新位置', function () {
  const { adapter, log } = makeAdapter([unitPreset('ground-x', 1, true)]);
  const ev = (x) => ({ fxKind: 'aura', area: { id: 'sg-ground-7', x, y: 0, r: 100 }, dur: 0.5, vfx: { ground: 'ground-x' } });
  adapter.tryPlay(ev(10));
  adapter.update(0.1);
  const nodesAfterFirst = log.nodes.length;
  adapter.tryPlay(ev(60));
  adapter.update(0.1);
  assert.equal(adapter.stats().grounds, 1, '合併成同一份');
  assert.equal(log.nodes.length, nodesAfterFirst, '沒有重建節點');
  /* 事件不得把畫面直接搬到新座標：那就是一格一格的來源。 */
  const oneFrame = lastOf(log, 'zone').x;
  assert.ok(oneFrame > 10 && oneFrame < 60, '一幀內只能逐步逼近，不得瞬移：' + oneFrame);
  for (let i = 0; i < 60; i++) adapter.update(1 / 60);
  assert.ok(Math.abs(lastOf(log, 'zone').x - 60) < 0.5, '足夠的時間後要完全追上權威座標');
});

/* AI_RULES 8.3.1：移動場域不得把離散事件畫成一格一格的跳動。
   事件的到達節奏本身就不均匀（Worker 是批次送出的，場域另有自己的節拍），
   而雷球那種節拍（每 0.35 秒一則）比「逼近所需的時間」還長——只做逼近的話
   會追上、停住、再衝一段。這裡用時間對不齊的事件序列回放，釘住兩件事：
   畫面每一幀都在走，而且走的速度就是模擬層的速度。 */
test('GROUND-1b 事件到達節奏不均時，畫面仍以模擬層的速度連續前進', function () {
  const { adapter, log } = makeAdapter([unitPreset('ground-x', 1, true)]);
  /* 雷球的量級：速度 60px/s、節拍 0.35s、沿 +X 直線飛向 300px 外的落點。
     事件被 0.2s 的批次量化後，到達時刻與它描述的模擬時刻對不齊。 */
  const SPEED = 60, FRAME = 1 / 60, DEST = 300;
  const packets = [
    { at: 0.4, simT: 0.4 }, { at: 0.8, simT: 0.7 },
    { at: 1.2, simT: 1.1 }, { at: 1.4, simT: 1.4 }, { at: 1.8, simT: 1.75 }
  ];
  let next = 0;
  const xs = [];
  for (let frame = 1; frame <= 120; frame++) {
    while (next < packets.length && packets[next].at <= frame * FRAME) {
      adapter.tryPlay({
        fxKind: 'aura', dur: 0.35,
        area: { id: 'orb-1', x: packets[next].simT * SPEED, y: 0, r: 30,
          speed: SPEED, moveA: 0, destX: DEST, destY: 0 },
        vfx: { ground: 'ground-x' }
      });
      next++;
    }
    adapter.update(FRAME);
    const at = lastOf(log, 'zone');
    if (at) xs.push(at.x);          // 第一則事件之前場域還不存在
  }
  /* 出生的那一幀畫面值＝權威值（沒有推算歷史），不計入步長統計。 */
  const steps = xs.slice(2).map((v, i) => v - xs[i + 1]);
  assert.ok(steps.every((d) => d > 1e-6), '每一幀都要在前進，不得出現靜止畫格');
  /* 修正殘差時仍必須把速度壓在行進速度附近（GROUND_CORRECT_MAX_RATIO），
     否則就算沒有靜止畫格，畫面一樣是忽快忽慢。 */
  const perFrame = SPEED * FRAME;
  assert.ok(Math.max.apply(null, steps) <= perFrame * 1.31,
    '單幀位移不得遠超過模擬層的速度（那就是在瞬移補距離）');
  assert.ok(Math.min.apply(null, steps) >= perFrame * 0.69,
    '也不得慢到近乎停頓：兩則事件之間要靠推算自走撐住');
});

/* 抵達落點就停駐（雷球飛到定點後停留）：事件不再帶 dest，畫面也必須停。 */
test('GROUND-1c 落點抵達後畫面跟著停駐，不會自己飄過頭', function () {
  const { adapter, log } = makeAdapter([unitPreset('ground-x', 1, true)]);
  const moving = { fxKind: 'aura', dur: 0.35, vfx: { ground: 'ground-x' },
    area: { id: 'orb-2', x: 0, y: 0, r: 30, speed: 60, moveA: 0, destX: 30, destY: 0 } };
  adapter.tryPlay(moving);
  for (let i = 0; i < 60; i++) adapter.update(1 / 60);
  assert.ok(Math.abs(lastOf(log, 'zone').x - 30) < 1, '自走到落點就停，不越過');
  /* 停駐後的事件不帶運動語意。 */
  adapter.tryPlay({ fxKind: 'aura', dur: 0.35, vfx: { ground: 'ground-x' },
    area: { id: 'orb-2', x: 30, y: 0, r: 30 } });
  for (let i = 0; i < 60; i++) adapter.update(1 / 60);
  assert.ok(Math.abs(lastOf(log, 'zone').x - 30) < 0.5, '停駐後不得再前進');
});

/* 場域半徑的擴增（沼澤漫延、烈陽星環）同樣不得一拍跳一級。 */
test('GROUND-1d 半徑擴增是逐幀逼近，不是每則事件跳一級', function () {
  const { adapter, log } = makeAdapter([unitPreset('ground-x', 1, true)]);
  const ev = (r) => ({ fxKind: 'aura', dur: 0.5, vfx: { ground: 'ground-x' },
    area: { id: 'mire-1', x: 0, y: 0, r } });
  adapter.tryPlay(ev(100));
  adapter.update(0.1);
  adapter.tryPlay(ev(200));
  adapter.update(1 / 60);
  const oneFrame = lastOf(log, 'zone').scaleX;
  assert.ok(oneFrame > 1 && oneFrame < 2, '一幀之內只能逼近一部分：' + oneFrame);
  for (let i = 0; i < 60; i++) adapter.update(1 / 60);
  assert.ok(Math.abs(lastOf(log, 'zone').scaleX - 2) < 0.01, '足夠的時間後要完全追上');
});

test('GROUND-2 事件停了之後場域會自己收掉（容忍一次遺失）', function () {
  const { adapter } = makeAdapter([unitPreset('ground-x', 1, true)]);
  adapter.tryPlay({ fxKind: 'aura', area: { id: 'g', x: 0, y: 0, r: 100 }, dur: 0.5, vfx: { ground: 'ground-x' } });
  adapter.update(0.5);
  assert.equal(adapter.stats().grounds, 1, '一拍之後還在（不能因為一次沒續命就消失）');
  adapter.update(1.0);
  assert.equal(adapter.stats().grounds, 0, '久沒續命就收掉');
});

/* ============================================================
   ORBIT — 環繞場域（軌道環 ＋ 沿環公轉的環繞體）
   ============================================================ */

/* 環繞事件：模擬層 sgOrbitEmitVfx 的形狀 */
/* 環繞圓心＝玩家腳底往上 12px。替身的 ctx 沒有給 footOf，Adapter 會退回 posOf，
   而 posOf('pv-float') 是 (0,0)——順帶驗到「沒有 footOf 就退回 posOf」這條相容規則。 */
const ORBIT_CENTRE = { x: 0, y: -12 };
test('ORBIT 伴生沿母體後方公轉，新增／消耗保留母體身份與相位', () => {
  const { adapter, log } = makeAdapter([unitPreset('orb-x', 1, true), unitPreset('child-x', 1, true)]);
  const mother = { id: 1, phase: 0, radiusBase: 100, companion: false, parentId: null };
  const child = { id: 2, phase: -.5, radiusBase: 100, companion: true, parentId: 1 };
  const area = { id: 'pair-1', r: 100, orbR: 20, spinRate: Math.PI, orbitAge: 0,
    members: [mother], companionGap: 10, companionPreset: 'child-x' };
  const event = a => orbitEvent({ area: a, vfx: { projectile: 'orb-x' } });
  assert.equal(adapter.tryPlay(event(area)), true);
  adapter.update(.5);
  const node = log.nodes.find(n => n.spec.assetUrl === '/orb-x.png');
  const before = node.transforms.at(-1);
  assert.equal(adapter.tryPlay(event({ ...area, orbitAge: .5, members: [mother, child] })), true);
  adapter.update(0);
  assert.equal(node.transforms.at(-1).x, before.x, '補送伴生不重排母體角度');
  const childNode = log.nodes.find(n => n.spec.assetUrl === '/child-x.png');
  const ct = childNode.transforms.at(-1);
  assert.ok(Math.abs(ct.x - Math.cos(Math.PI * .5 - .5) * 100) < 1e-8);
  assert.ok(Math.abs(ct.y - (Math.sin(Math.PI * .5 - .5) * 100 * .62 - 12)) < 1e-8);
  assert.equal(adapter.stats().played, 2);
  adapter.tryPlay(event({ ...area, orbitAge: .5, members: [mother] }));
  adapter.update(.1);
  assert.equal(adapter.stats().fx.activeEffects, 1);
  assert.equal(adapter.stats().played, 2, '消耗不重播母體');
  adapter.tryPlay(event({ ...area, members: [] }));
  assert.equal(adapter.stats().orbits, 0);
  assert.equal(adapter.stats().fx.activeEffects, 0);
});

test('ORBIT 逐團事件支援超過舊均分上限、晚加入及反向母子', () => {
  const { adapter, log } = makeAdapter([unitPreset('orb-x', 1, true), unitPreset('child-x', 1, true)]);
  const members = Array.from({ length: 16 }, (_, i) => ({ id: i + 1, phase: i * .3,
    radiusBase: 60, companion: i % 2 === 1, parentId: i % 2 ? i : null }));
  const area = { id: 'crowd', r: 100, orbR: 20, spinRate: -2, orbitAge: 3,
    grow: 20, spiral: 1, growMax: 200, companionGap: 10, companionPreset: 'child-x', members };
  adapter.tryPlay(orbitEvent({ area, vfx: { projectile: 'orb-x' } }));
  adapter.update(0);
  assert.equal(adapter.stats().fx.activeEffects, 16);
  const actual = log.nodes.filter(n => n.spec.assetUrl === '/child-x.png')[0].transforms.at(-1);
  const pose = VFXRuntime.sampleOrbitMember(area, 3, 1);
  assert.equal(pose.radius, 120);
  assert.ok(Math.abs(pose.angle - (-6 + 50 / 120)) < 1e-8);
  assert.ok(Math.abs(actual.x - Math.cos(pose.angle) * pose.radius) < 1e-8);
  adapter.update(4.1);
  assert.equal(adapter.stats().orbits, 0);
});

function orbitRadius(t) {
  const rx = t.x - ORBIT_CENTRE.x;
  const ry = (t.y - ORBIT_CENTRE.y) / 0.62;
  return Math.sqrt(rx * rx + ry * ry);
}

function orbitEvent(over) {
  return Object.assign({
    fxKind: 'aura', variant: 'firehunt', elem: 'fire', dur: 4,
    area: { id: 'orbit-1', x: 0, y: 0, r: 100, orbR: 20, orbs: 3, spin: 1, spinRate: Math.PI },
    vfx: { ground: 'ring-x', projectile: 'orb-x' }
  }, over || {});
}

test('ORBIT-1 沒有環繞體 preset 就整則交還舊畫法（只畫軌道環會弄丟環繞體）', function () {
  const { adapter } = makeAdapter([unitPreset('ring-x', 1, true)]);
  const ok = adapter.tryPlay(orbitEvent({ vfx: { ground: 'ring-x' } }));
  assert.equal(ok, false);
  assert.equal(adapter.stats().orbits, 0);
  assert.equal(adapter.stats().grounds, 0, '不能只留下軌道環');
});

test('ORBIT-2 軌道環進 zone 層、N 個環繞體進 fx 層，並沿橢圓公轉', function () {
  const { adapter, log } = makeAdapter([unitPreset('ring-x', 1, true), unitPreset('orb-x', 1, true)]);
  assert.equal(adapter.tryPlay(orbitEvent()), true);
  assert.equal(adapter.stats().orbits, 1);
  adapter.update(1 / 60);

  const ring = lastOf(log, 'zone');
  assert.equal(+ring.scaleX.toFixed(3), 1, '軌道環 scale = r/100');

  /* 三團等分在半徑 100、縱向壓 0.62 的橢圓上 */
  const orbs = log.updates.filter(u => u.tag === 'fx').slice(-3);
  assert.equal(orbs.length, 3);
  orbs.forEach(function (o) {
    assert.ok(Math.abs(orbitRadius(o) - 100) < 1.5,
      '環繞體要落在半徑 100 的橢圓上，實際 ' + Math.round(orbitRadius(o)));
    assert.equal(+o.scaleX.toFixed(3), 1, '環繞體 scale = orbR/20');
  });

  /* 公轉：轉半圈（spinRate = π）之後位置必須變 */
  const before = lastOf(log, 'fx');
  adapter.update(1);
  const after = lastOf(log, 'fx');
  assert.ok(Math.abs(after.x - before.x) > 1 || Math.abs(after.y - before.y) > 1, '環繞體要動');
});

test('ORBIT-3 同一道的補送事件只續命，不會愈疊愈多團', function () {
  const { adapter } = makeAdapter([unitPreset('ring-x', 1, true), unitPreset('orb-x', 1, true)]);
  adapter.tryPlay(orbitEvent());
  adapter.update(0.5);
  const first = adapter.stats();
  adapter.tryPlay(orbitEvent());               // 【再生】延長時模擬層會補送同一道
  adapter.update(0.5);
  const again = adapter.stats();
  assert.equal(again.orbits, 1, '同一道只保留一組');
  assert.equal(again.played, first.played, '沒有再建立新的環繞體');
});

test('ORBIT-4 團數變了就多退少補；到期整組收掉', function () {
  const { adapter } = makeAdapter([unitPreset('ring-x', 1, true), unitPreset('orb-x', 1, true)]);
  adapter.tryPlay(orbitEvent());
  adapter.update(0.1);
  adapter.tryPlay(orbitEvent({ area: { id: 'orbit-1', x: 0, y: 0, r: 100, orbR: 20, orbs: 5, spin: 1, spinRate: Math.PI } }));
  adapter.update(0.1);
  assert.equal(adapter.stats().orbits, 1);
  adapter.update(12);                          // 超過 ORBIT_MAX_SEC
  assert.equal(adapter.stats().orbits, 0, '到期整組收掉');
});

test('ORBIT-4b startAng 決定起始角：虛空鋸刃的每一片才不會疊在一起', function () {
  const { adapter, log } = makeAdapter([unitPreset('ring-x', 20, true), unitPreset('orb-x', 20, true)]);
  /* 模擬層 sgOrbitStep 算接觸用的就是 startAng + 2π·k/count，顯示層必須同角度。 */
  adapter.tryPlay(orbitEvent({
    dur: 12, area: { id: 'disc-0', x: 0, y: 0, r: 100, orbR: 20, orbs: 1, spin: 1, spinRate: 0, startAng: 0 }
  }));
  adapter.tryPlay(orbitEvent({
    dur: 12, area: { id: 'disc-1', x: 0, y: 0, r: 100, orbR: 20, orbs: 1, spin: 1, spinRate: 0, startAng: Math.PI }
  }));
  adapter.update(1 / 60);
  assert.equal(adapter.stats().orbits, 2, '兩片各自成組');
  const last2 = log.updates.filter(u => u.tag === 'fx').slice(-2);
  assert.ok(Math.abs(last2[0].x - last2[1].x) > 150,
    '相差 180° 的兩片必須落在圓的兩側，實際 x 差 ' + Math.abs(last2[0].x - last2[1].x).toFixed(1));
});

test('ORBIT-5 半徑成長與體積成長沿用模擬層的曲線', function () {
  /* preset 壽命要蓋過取樣時間，否則取樣那一幀圖層已經結束（visible:false，後端收不到 transform）。 */
  const { adapter, log } = makeAdapter([unitPreset('ring-x', 20, true), unitPreset('orb-x', 20, true)]);
  /* grow 40px/s、上限 200；體積 2 秒內長到 2 倍 */
  adapter.tryPlay(orbitEvent({
    dur: 12,
    area: { id: 'g', x: 0, y: 0, r: 100, orbR: 20, orbs: 1, spin: 1, spinRate: 0, grow: 40, growMax: 200, orbGrowTo: 2, orbGrowSec: 2 }
  }));
  adapter.update(1);
  const at1 = lastOf(log, 'fx');
  assert.equal(+at1.scaleX.toFixed(2), 1.5, '1 秒時體積長到 1.5 倍');
  assert.ok(Math.abs(orbitRadius(at1) - 140) < 2, '1 秒時環半徑 100 + 40 = 140，實際 ' + Math.round(orbitRadius(at1)));
  adapter.update(5);
  const at6 = lastOf(log, 'fx');
  assert.ok(Math.abs(orbitRadius(at6) - 200) < 2, '外擴上限 200，實際 ' + Math.round(orbitRadius(at6)));
});

test('RAIN-1 天降飛行物同時放下落點預警', function () {
  const { adapter } = makeAdapter([unitPreset('proj-x', 2), unitPreset('mark-x', 1, true)]);
  const ok = adapter.tryPlay({
    fxKind: 'rain', variant: 'meteor', targets: ['mv-float-2'], travelMs: [500], dur: 1.14,
    area: { id: 'meteor-mark-1', x: 300, y: 50, r: 150 },
    vfx: { projectile: 'proj-x', ground: 'mark-x' }
  });
  assert.equal(ok, true);
  assert.equal(adapter.stats().projectiles, 1, '殞石在飛');
  assert.equal(adapter.stats().grounds, 1, '地上要有那一圈預警');
});

test('RAIN-2 打到多個敵人的天降仍然從天上落下，不會被當成連鎖段', function () {
  /* 地爆天星打的是全場，targets 是所有敵人。chained 判定若只看
     targets.length >= 2，起點會變成 ids[0] 的位置、終點是 ids[1]，
     於是巨型隕石在兩個敵人之間橫著滑過去。 */
  const { adapter, log } = makeAdapter([unitPreset('proj-x', 2)]);
  const ok = adapter.tryPlay({
    fxKind: 'rain', variant: 'meteor-starfall',
    targets: ['mv-float-1', 'mv-float-2'], travelMs: [600, 600], dur: 1.2,
    vfx: { projectile: 'proj-x' }
  });
  assert.equal(ok, true);
  adapter.update(1 / 60);
  const first = log.updates.find((u) => u.tag === 'fx');
  /* 落點是 targets[0]（y=50），出生點在它正上方 500px。 */
  assert.ok(first.y < -300, '應該從天上開始落下，實得 y=' + Math.round(first.y));
  assert.ok(Math.abs(first.x - 100) < 2, 'x 應該對齊落點 100，實得 ' + Math.round(first.x));
});

test('RAIN-3 沒有 area 的天降照樣放下落點影子', function () {
  /* 地爆天星不掛在任何敵人身上，模擬層因此不給 area。
     原本的條件要求 spec.area，落地影子就永遠不出現。 */
  const { adapter } = makeAdapter([unitPreset('proj-x', 2), unitPreset('shadow-x', 5, true)]);
  const ok = adapter.tryPlay({
    fxKind: 'rain', variant: 'meteor-starfall',
    targets: ['mv-float-1'], travelMs: [600], dur: 1.2,
    vfx: { projectile: 'proj-x', ground: 'shadow-x' }
  });
  assert.equal(ok, true);
  assert.equal(adapter.stats().grounds, 1, '沒有 area 也要有落點影子');
});

test('RAIN-4 一般飛行物不會因為表格填了地板特效就多畫一個場域', function () {
  /* RAIN-3 放寬的條件只針對天降。焚世領域那種「飛行物 + 地板場域」的組合
     仍然要由 area 決定，否則每一發火球都會在敵人腳下留一塊場域。 */
  const { adapter } = makeAdapter([unitPreset('proj-x', 2), unitPreset('field-x', 5, true)]);
  adapter.tryPlay({
    fxKind: 'projectile', targets: ['mv-float-1'], travelMs: [400],
    vfx: { projectile: 'proj-x', ground: 'field-x' }
  });
  assert.equal(adapter.stats().grounds, 0, '沒有 area 的一般飛行物不該自己長出場域');
});

/* ============================================================
   PROFILE — 表面尺寸規則（高塔的卡片版面用）
   ============================================================ */

test('PROFILE-1 預設全部是 1：野外的行為與加入 profile 之前完全相同', function () {
  const { adapter, log } = makeAdapter([unitPreset('hit-x')]);
  adapter.tryPlay({ fxKind: 'impact', targets: ['mv-float-2'], vfx: { hit: 'hit-x' } });
  adapter.update(1 / 60);
  assert.equal(lastOf(log, 'fx').scaleX, 1);
});

test('PROFILE-2 scale 縮角色身上的東西、areaScale 縮帶 area 的東西', function () {
  const { adapter, log } = makeAdapter([unitPreset('hit-x'), unitPreset('burst-x')],
    { profile: { scale: 0.5, areaScale: 0.25 } });
  adapter.tryPlay({ fxKind: 'impact', targets: ['mv-float-2'], vfx: { hit: 'hit-x' } });
  adapter.update(1 / 60);
  assert.equal(lastOf(log, 'fx').scaleX, 0.5, '受擊吃 scale');

  adapter.tryPlay({ fxKind: 'burst', targets: ['mv-float-2'], area: { x: 0, y: 0, r: 200 }, vfx: { attack: 'burst-x' } });
  adapter.update(1 / 60);
  /* r 200 → 2 倍，再乘 areaScale 0.25 */
  assert.equal(lastOf(log, 'fx').scaleX, 0.5, '範圍吃 areaScale');
});

test('PROFILE-3 skyScale 同時縮天降的體積與出生高度', function () {
  const { adapter, log } = makeAdapter([unitPreset('bolt-x', 2)], { profile: { skyScale: 0.2 } });
  adapter.tryPlay({
    fxKind: 'rain', targets: ['mv-float-2'], travelMs: [400], vfx: { projectile: 'bolt-x' }
  });
  adapter.update(1 / 60);
  const t = lastOf(log, 'fx');
  assert.equal(+t.scaleX.toFixed(3), 0.2, '天降吃 skyScale');
  /* 落點在 (300,50)；出生高度 500×0.2 = 100 → 起點 y ≈ -50，第一幀還在起點附近 */
  assert.ok(t.y < 0, '出生點要跟著縮，否則會先看到一段空白才落下來，實際 y=' + Math.round(t.y));
  assert.ok(t.y > -60, '縮完之後不該還在 500px 之外，實際 y=' + Math.round(t.y));
});

test('PROFILE-4 沒有 area 的場域：畫在目標腳底，大小由 groundR 決定', function () {
  /* 自身增益光殼（暴風屏障、岩甲、狂血…）沒有判定半徑，模擬層不會給 area。
     野外取名目半徑＝照 Preset 原尺寸畫；不接手的話這些會退回舊畫法，
     於是同一場戰鬥裡新舊兩套光殼並存（2026-09-03 實機回報的同一類問題）。 */
  const noArea = { fxKind: 'aura', variant: 'mire', dur: 0.5, targets: ['mv-float-2'], vfx: { ground: 'ground-x' } };
  const plain = makeAdapter([unitPreset('ground-x', 1, true)]);
  assert.equal(plain.adapter.tryPlay(noArea), true, '野外也要接手');
  plain.adapter.update(1 / 60);
  const f = lastOf(plain.log, 'zone');
  assert.equal(f.x, 300, '畫在目標腳底（替身的 posOf 就是 (300,50)）');
  assert.equal(+f.scaleX.toFixed(3), 1, '野外名目半徑 100 → 原尺寸');

  const tower = makeAdapter([unitPreset('ground-x', 1, true)], { profile: { groundR: 70 } });
  assert.equal(tower.adapter.tryPlay(noArea), true);
  tower.adapter.update(1 / 60);
  const t = lastOf(tower.log, 'zone');
  assert.equal(t.x, 300, '畫在目標腳底');
  assert.equal(+t.scaleX.toFixed(3), 0.7, '名目半徑 70 → scale 0.7');

  /* 0 仍然是「不畫」：留給還沒決定尺寸規則的新版面。 */
  const off = makeAdapter([unitPreset('ground-x', 1, true)], { profile: { groundR: 0 } });
  assert.equal(off.adapter.tryPlay(noArea), false, 'groundR 0 維持退回舊畫法');
});

/* ============================================================
   STATUS — 狀態光環由 5Hz 快照 reconcile
   ============================================================ */

test('STATUS-1 狀態出現時建立、消失時立刻收掉，重複快照不重建', function () {
  global.statusVfxPreset = (sid, role) => (role === 'aura' && sid === 'sgBurn' ? 'st-burn' : '');
  const { adapter, log } = makeAdapter([unitPreset('st-burn', 1, true)]);
  adapter.syncStatuses([{ key: 'mv-float-1', sids: ['sgBurn'] }]);
  adapter.update(0.1);
  assert.equal(adapter.stats().auras, 1);
  const nodes = log.nodes.length;

  adapter.syncStatuses([{ key: 'mv-float-1', sids: ['sgBurn'] }]);
  adapter.update(0.1);
  assert.equal(adapter.stats().auras, 1, '同一個狀態不重建');
  assert.equal(log.nodes.length, nodes);

  adapter.syncStatuses([{ key: 'mv-float-1', sids: [] }]);
  assert.equal(adapter.stats().auras, 0, '狀態消失就立刻收掉，不等逾時');
  delete global.statusVfxPreset;
});

test('STATUS-2 狀態表沒填持續特效時不播', function () {
  global.statusVfxPreset = () => '';
  const { adapter } = makeAdapter([unitPreset('st-burn', 1, true)]);
  adapter.syncStatuses([{ key: 'mv-float-1', sids: ['sgBurn'] }]);
  assert.equal(adapter.stats().auras, 0);
  delete global.statusVfxPreset;
});

/* ============================================================
   CATALOG — 表格引用到的 preset 必須真的存在
   ============================================================ */

test('CATALOG-1 三張表與普攻預設引用的 preset 檔案全部存在且合法', function () {
  /* 直接讀正式資料，不用替身：這條要驗的就是「表上填的檔名真的有檔案」。 */
  const sandbox = {};
  ['data.js', 'skills.js', 'skills2.js', 'status.js'].forEach(function (f) {
    const src = fs.readFileSync(path.join(REPO, 'js', f), 'utf8');
    ['SKILLS', 'SKILLS2', 'STATUS', 'VFX_COMBAT_DEFAULTS'].forEach(function (name) {
      const m = new RegExp('^var ' + name + ' = ', 'm').exec(src);
      if (!m) return;
      const body = extractLiteral(src, m.index + m[0].length);
      if (body) sandbox[name] = eval('(' + body + ')');   // eslint-disable-line no-eval
    });
  });
  Object.assign(global, sandbox);
  const ids = VFXRuntime.collectPresetIds();
  assert.ok(ids.length >= 100, '表格應該引用了大量 preset，實際：' + ids.length);
  ids.forEach(function (id) {
    const p = path.join(REPO, 'vfx', 'presets', id + '.json');
    assert.ok(fs.existsSync(p), '表格引用了不存在的 preset：' + id);
    const preset = JSON.parse(fs.readFileSync(p, 'utf8'));
    const res = VFXCore.validatePreset(preset);
    assert.ok(res.ok, id + ' 不合法：' + (res.errors || []).join('；'));
  });
  ['SKILLS', 'SKILLS2', 'STATUS', 'VFX_COMBAT_DEFAULTS'].forEach(function (k) { delete global[k]; });
});

test('CATALOG-2 shipped-assets 涵蓋所有 preset 用到的素材', function () {
  const index = JSON.parse(fs.readFileSync(path.join(REPO, 'vfx', 'shipped-assets.json'), 'utf8'));
  const shipped = new Set((index.assets || []).map(a => a.assetId));
  const dir = path.join(REPO, 'vfx', 'presets');
  fs.readdirSync(dir).filter(f => /\.json$/.test(f)).forEach(function (f) {
    const preset = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    preset.layers.forEach(function (l) {
      if (l.type === 'procedural' && l.effect === 'waterTornado') {
        assert.ok(require('../js/vfx-core.js').validatePreset(preset).ok, f + ' 程序圖層必須合法');
        assert.equal(l.assetId, undefined);
        return;
      }
      assert.ok(shipped.has(l.assetId),
        f + ' 用到未匯出的素材：' + l.assetId + '（跑 node tools/vfx/export-assets.cjs）');
    });
  });
});

test('CATALOG-3 每一份 preset 都有單一根群組的 layout（使用者規則）', function () {
  const LS = require('../tools/vfx/editor/layout-schema.js');
  const dir = path.join(REPO, 'vfx', 'presets');
  fs.readdirSync(dir).filter(f => /\.json$/.test(f)).forEach(function (f) {
    const preset = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const lp = path.join(REPO, 'vfx', 'layouts', preset.id + '.json');
    assert.ok(fs.existsSync(lp), preset.id + ' 沒有 layout（kit.write 會自動產生）');
    const layout = JSON.parse(fs.readFileSync(lp, 'utf8'));
    assert.ok(LS.validateLayout(layout).ok, preset.id + ' 的 layout 不合法');
    const rows = LS.reconcile(preset.layers, layout).rows;
    assert.equal(rows.length, 1, preset.id + ' 的頂層應該只有一個群組，實際 ' + rows.length + ' 列');
    assert.equal(rows[0].kind, 'group', preset.id + ' 的頂層那一列必須是群組');
    assert.equal(rows[0].layerIds.length, preset.layers.length,
      preset.id + ' 的群組沒有收下全部圖層');
  });
});

/* 從 `var NAME = ` 之後抓出完整的物件字面值（字串感知的括號配對）。 */
function extractLiteral(src, from) {
  let i = from, depth = 0, q = null, started = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === '\'' || c === '`') { q = c; continue; }
    if (c === '{' || c === '[') { depth++; started = true; continue; }
    if (c === '}' || c === ']') { depth--; if (started && depth === 0) return src.slice(from, i + 1); }
  }
  return null;
}


test('CLEAVE 四方向從中心飛行，保持本體尺寸、不預播命中，連斬延遲可取消', () => {
  const {adapter,log}=makeAdapter([unitPreset('arc'),unitPreset('hit')]);
  const spec={fxKind:'slash',variant:'cleave-cross-shockwave',projectile:true,
    angle:0,lineLength:240,directionRanges:[240,240,240,240],rangeScale:2,
    targets:['mv-float-1'],vfx:{attack:'arc',hit:'hit'}};
  adapter.tryPlay(spec);adapter.update(0.1);
  assert.equal(log.nodes.length,4);
  assert.ok(log.nodes.every(n=>n.transforms.at(-1).scaleX===2));
  assert.ok(log.nodes.some(n=>Math.abs(n.transforms.at(-1).x-24)<1e-8));
  adapter.update(0.2);
  assert.ok(log.nodes.some(n=>Math.abs(n.transforms.at(-1).x-72)<1e-8));
  assert.ok(log.nodes.every(n=>n.transforms.at(-1).scaleX===2));
  adapter.tryPlay({...spec,delayMs:90});adapter.clear();adapter.update(1);
  assert.equal(adapter.stats().fx.activeEffects,0);
});

test('MIRE 泥流依權威長寬縮放、保持地板層、續命不重播並回收',()=>{
 const p=JSON.parse(fs.readFileSync(path.join(REPO,'vfx/presets/ground-mire-earth.json'),'utf8'));
 const {adapter,log}=makeAdapter([p]);const s={fxKind:'aura',variant:'mire',dur:2,area:{id:'mire-test',x:100,y:200,w:120,h:180},vfx:{ground:p.id}};
 assert.equal(adapter.tryPlay(s),true);adapter.update(.3);
 const n=log.nodes.find(n=>n.spec.assetUrl?.includes('mud-flow.png')),t=n.transforms.at(-1);
 assert.equal(n.tag,'zone');assert.equal(t.x,100);assert.equal(t.y,200);
 assert.ok(Math.abs(t.scaleX-120/256)<.0001);assert.ok(Math.abs(t.scaleY-180/256)<.0001);
 adapter.tryPlay(s);adapter.update(.3);assert.equal(adapter.stats().played,1);
 adapter.update(5);assert.equal(adapter.stats().grounds,0);
});

test('MIRE 進化維持三成強度、權威矩形與續命，熔岩粒子同比降低',()=>{
 for(const id of ['ground-mire-venom','ground-mire-magma']){
  const p=JSON.parse(fs.readFileSync(path.join(REPO,'vfx/presets/'+id+'.json'),'utf8'));assert.equal(p.layers[0].alpha,.3);
  if(id.endsWith('magma')){assert.ok(Math.abs(p.layers[1].alpha-.216)<1e-8);assert.equal(p.layers[2].alpha,.24);}
  const {adapter,log}=makeAdapter([p]),s={fxKind:'aura',variant:'mire',dur:2,area:{id:'mire-evo',x:120,y:160,w:180,h:240},vfx:{ground:id}};
  assert.equal(adapter.tryPlay(s),true);adapter.update(.3);
  const body=log.nodes.find(n=>n.spec.assetUrl?.includes('mud-flow-')),t=body.transforms.at(-1);
  assert.equal(body.tag,'zone');assert.equal(t.alpha,.3);assert.equal(t.x,120);assert.equal(t.y,160);assert.ok(Math.abs(t.scaleX-180/256)<.0001);assert.ok(Math.abs(t.scaleY-240/256)<.0001);
  adapter.tryPlay(s);adapter.update(.3);assert.equal(adapter.stats().played,1);adapter.update(5);assert.equal(adapter.stats().grounds,0);
 }
});

test('EARTHGUARD 法陣固定腳底、八米半徑且續命不重播',()=>{
 const p=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/aura-earthguard-hexagram.json'),'utf8'));
 let foot={x:24,y:35};const {adapter,log}=makeAdapter([p],{ctx:{playerPos:()=>foot,posOf:()=>foot,footOf:()=>foot}});
 const spec={fxKind:'aura',targets:['pv-float'],vfx:{ground:p.id},dur:.25,area:{id:'sg-earthguard-aura',r:80,follow:true}};
 assert.equal(adapter.tryPlay(spec),true);adapter.update(.1);
 let n=log.nodes.find(n=>n.tag==='zone');assert.ok(n);assert.equal(log.nodes.filter(n=>n.tag==='fx').length,0);
 let t=n.transforms.at(-1);assert.equal(t.x,24);assert.equal(t.y,35);assert.ok(Math.abs(t.scaleX-80/140)<1e-6);
 foot={x:55,y:72};adapter.tryPlay(spec);adapter.update(.1);t=n.transforms.at(-1);assert.equal(t.x,55);assert.equal(t.y,72);assert.equal(adapter.stats().grounds,1);assert.ok(t.frame>0);
 adapter.update(2);assert.equal(adapter.stats().grounds,0);
});

test('EARTHGUARD 變色替換同一場域，第七階只放大四分之一',()=>{
 const presets=['hexagram','life','mana','symbiosis'].map(v=>JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/aura-earthguard-'+v+'.json'),'utf8')));
 const {adapter,log}=makeAdapter(presets);
 for(const p of presets){
  const radius=p.id.endsWith('symbiosis')?100:80;
  assert.equal(adapter.tryPlay({fxKind:'aura',targets:['pv-float'],vfx:{ground:p.id},dur:.25,area:{id:'sg-earthguard-aura',r:radius,follow:true}}),true);adapter.update(.1);
  assert.equal(adapter.stats().grounds,1);const t=log.nodes.at(-1).transforms.at(-1);assert.ok(Math.abs(t.scaleX-radius/140)<1e-6);
 }
});

test('CHAIN 藍白連線走 beam 並保持兩端距離，延遲段不當作飛行物回收',()=>{
 const p=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/bolt-chain-bluewhite.json'),'utf8'));
 const {adapter,log}=makeAdapter([p]);
 const s={fxKind:'chain',targets:['mv-float-1','mv-float-2'],vfx:{attack:p.id}};
 adapter.tryPlay(s);adapter.tryPlay({...s,delayMs:200});adapter.update(.1);
 assert.equal(adapter.stats().played,1);assert.equal(adapter.stats().projectiles,0);
 const t=log.nodes[0].transforms.at(-1);assert.equal(t.x,100);assert.equal(t.y,50);assert.equal(t.rotation,0);assert.ok(Math.abs(t.scaleX-200/512)<.001);
 adapter.update(.11);assert.equal(adapter.stats().played,2);adapter.update(1);assert.equal(adapter.stats().fx.activeEffects,0);
});
