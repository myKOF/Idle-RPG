'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../js/vfx-runtime.js');
const Core = require('../js/vfx-core.js');
const root = path.resolve(__dirname, '..');
const preset = id => JSON.parse(fs.readFileSync(root + '/vfx/presets/' + id + '.json'));

test('缺尺寸的圓／方／長方與飛行物採米制標準', () => {
  for (const shape of ['circle', 'projectile-circle']) {
    assert.deepEqual(R.resolveSizing({ shape, authored: { radius: 60 } }), { scaleX: 1, scaleY: 1 });
    const s = R.resolveSizing({ shape, authored: { radius: 60 } }, { r: 100 });
    assert.equal(s.scaleX, 10 / 6); assert.equal(s.scaleY, 10 / 6);
  }
  for (const shape of ['square', 'projectile-square']) {
    assert.deepEqual(R.resolveSizing({ shape, authored: { width: 60, height: 60 } }), { scaleX: 1, scaleY: 1 });
  }
  assert.deepEqual(R.resolveSizing({ shape: 'rectangle', authored: { width: 60, height: 30 } }), { scaleX: 1, scaleY: 1 });
});
test('明訂尺寸優先，升級以實際長寬換算，單位可注入且不把射程当體積', () => {
  const p = preset('slash-thrust-lance');
  assert.deepEqual(R.resolveSizing(p.sizing), { scaleX: 1, scaleY: 1 });
  assert.deepEqual(R.resolveSizing(p.sizing, { w: 240, h: 60 }), { scaleX: 2, scaleY: 2 });
  assert.deepEqual(R.resolveSizing(p.sizing, null, 20), { scaleX: 2, scaleY: 2 });
  assert.deepEqual(R.resolveSizing(preset('ground-blizzard').sizing, { w: 200, h: 200 }), { scaleX: 1, scaleY: 2 });
  const wind = R.resolveSizing(preset('proj-wind-crescent').sizing, { w: 40, h: 80 });
  assert.equal(wind.scaleX * 96, 40); assert.equal(wind.scaleY * 104, 80);
});
test('雷球與火龍捲依自己的本體半徑縮放，不再誤除以通用半徑', () => {
  assert.deepEqual(R.resolveSizing(preset('ground-thunder-orb').sizing, { r: 30 }), { scaleX: 1, scaleY: 1 });
  const tornado = R.resolveSizing(preset('ground-tornado-fire').sizing, { r: 50 });
  assert.equal(tornado.scaleX, 50 / 28); assert.equal(tornado.scaleY, 50 / 28);
});
test('所有正式技能目錄與突刺變體都有合法且可序列化的尺寸契約', () => {
  const catalog = require('../tools/vfx/authoring/vfx-catalog.cjs').PRESETS;
  for (const id of Object.keys(catalog)) {
    const p = preset(id);
    assert.ok(p.sizing, id); assert.equal(Core.validatePreset(p).ok, true, id);
    const scale = R.resolveSizing(p.sizing);
    assert.ok(scale.scaleX > 0 && scale.scaleY > 0, id);
    assert.deepEqual(JSON.parse(Core.serialisePreset(p)).sizing, p.sizing);
  }
});
test('非法尺寸在 Core／Runtime 被拒絕，舊版未宣告尺寸的 Preset 保持相容', () => {
  const p = preset('slash-thrust-lance'); p.sizing.authored.width = 0;
  assert.equal(Core.validatePreset(p).ok, false);
  assert.throws(() => R.resolveSizing(p.sizing));
  delete p.sizing; assert.equal(Core.validatePreset(p).ok, true);
  assert.equal(R.resolveSizing(null), null);
});
test('三階採黃紅光，五階才有飛濺粒子；全部圖層維持單一根群組', () => {
  const base = preset('slash-thrust-lance'), red = preset('slash-thrust-empowered'), scatter = preset('slash-thrust-scatter');
  assert.notEqual(base.layers.find(l => l.id === 'shaft').tint, red.layers.find(l => l.id === 'shaft').tint);
  assert.equal(red.layers.some(l => l.type === 'particle'), false);
  assert.equal(scatter.layers.filter(l => l.type === 'particle').length, 1);
  for (const p of [base, red, scatter]) {
    const layout = JSON.parse(fs.readFileSync(root + '/vfx/layouts/' + p.id + '.json'));
    assert.equal(layout.groups.length, 1);
    assert.deepEqual(layout.groups[0].layerIds.slice().sort(), p.layers.map(l => l.id).sort());
  }
});

test('非等比尺寸在圖層旋轉之後作用，90 度／斜角／鏡像均保持世界幾何', () => {
  const index = JSON.parse(fs.readFileSync(root + '/vfx/shipped-assets.json'));
  for (const angle of [Math.PI/2, Math.PI/4]) for (const sign of [1,-1]) {
    let t;
    const rt = Core.createRuntime({resolver:Core.createIndexResolver(index,'/images/vfx/assets'),
      backend:{createNode:()=>({}),updateNode:(node,value)=>{if(value.visible)t={...value};},destroyNode:()=>{}}});
    const p=preset('slash-thrust-lance');
    p.layers=[{id:'geometry',type:'sprite',assetId:p.layers[0].assetId,rotation:angle,scale:{x:sign*2,y:3}}];
    rt.registerPreset(p);rt.play(p.id,{scaleX:2,scaleY:4,rotation:0.3});rt.update(0.1);
    const actual=[Math.cos(t.rotation)*t.scaleX,Math.sin(t.rotation)*t.scaleX,
      -Math.sin(t.rotation-t.skewX)*t.scaleY,Math.cos(t.rotation-t.skewX)*t.scaleY];
    const c=Math.cos(angle),s=Math.sin(angle),cp=Math.cos(0.3),sp=Math.sin(0.3);
    const a=4*c*sign,b=8*s*sign,cc=-6*s,d=12*c;
    const expected=[cp*a-sp*b,sp*a+cp*b,cp*cc-sp*d,sp*cc+cp*d];
    expected.forEach((v,i)=>assert.ok(Math.abs(v-actual[i])<1e-8));
    rt.destroy();
  }
});
