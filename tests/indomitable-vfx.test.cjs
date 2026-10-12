'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
const gold=require('../vfx/presets/st-indomitable-gold.json');
const light=require('../vfx/presets/pillar-indomitable-white.json');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(profile,groundScale){
 const nodes=[],foot={x:40,y:80};
 const backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.destroyed=true;}};
 const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},fxBackend:backend,zoneBackend:backend,airBackend:backend,billboardBackend:backend,
  profile,groundScale,ctx:{playerPos:()=>foot,posOf:()=>({x:foot.x,y:foot.y-50}),footOf:()=>foot}});
 rt.registerPresets([gold,light]);
 const play=(variant,id,dur)=>rt.tryPlay({fxKind:'aura',variant,targets:['tp-float'],dur,vfx:{ground:id}});
 return {rt,nodes,foot,play};
}
test('不屈護罩與白光：正式Preset合法、既有素材可匯出，白光2秒不循環',()=>{
 const ids=new Set(require('../vfx/shipped-assets.json').assets.map(a=>a.assetId));
 for(const p of [gold,light]){assert.equal(Core.validatePreset(p).ok,true);for(const l of p.layers){assert.ok(ids.has(l.assetId));assert.equal(l.perspective,false);assert.equal(l.cameraDepth,false);}}
 assert.equal(gold.loop,true);assert.equal(light.loop,false);near(light.duration,2);
 for(const layer of light.layers)near(layer.duration,2);
});
test('不屈特效：不同場景保持作者尺寸，跟隨腳底，白光2秒與護罩5秒各自回收',()=>{
 for(const groundScale of [.3,.65,1]){
  const {rt,nodes,foot,play}=fixture({scale:.4,areaScale:.2,groundR:45},groundScale);
  assert.equal(play('indomitable-guard',gold.id,5),true);assert.equal(play('indomitable-light',light.id,2),true);rt.update(.5);
  const ring=nodes.find(n=>n.spec.assetUrl.includes('ring_a'));
  const beam=nodes.find(n=>n.spec.assetUrl.includes('streaks_composed_b'));
  assert.ok(ring&&beam);near(ring.t.scaleX,gold.layers[2].scale.x);near(ring.t.scaleY,gold.layers[2].scale.y);
  near(ring.t.x,foot.x);near(ring.t.y,foot.y-58);assert.equal(ring.t.perspective,false);
  foot.x+=30;foot.y+=20;rt.update(.5);near(ring.t.x,foot.x);near(ring.t.y,foot.y-58);
  near(beam.t.x,foot.x);near(beam.t.y,foot.y-460);
  rt.update(.99);assert.notEqual(beam.t.visible,false);rt.update(.02);assert.equal(beam.t.visible,false);assert.notEqual(ring.t.visible,false);
  rt.update(2.98);assert.notEqual(ring.t.visible,false);rt.update(.02);assert.equal(ring.t.visible,false);assert.equal(rt.stats().grounds,0);
  rt.destroy();
 }
});
test('不屈白光：事件持續時間可配置，不依賴Preset固定秒數；零地板半徑也可播放',()=>{
 const {rt,nodes,play}=fixture({scale:.1,groundR:0},.65);
 assert.equal(play('indomitable-light',light.id,3),true);rt.update(2.5);
 const beam=nodes.find(n=>n.spec.assetUrl.includes('streaks_composed_b'));assert.ok(beam);assert.notEqual(beam.t.visible,false);
 rt.update(.51);assert.equal(beam.t.visible,false);rt.destroy();
});
