'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');
const root = path.resolve(__dirname, '..');
const sprite = (id, extra) => ({id, type:'sprite', assetId:id+'.png', ...extra});
const preset = layers => ({schemaVersion:1, id:'duration-test', duration:.48, loop:false, layers});
const visible = (nodes,id) => nodes.some(n=>n.spec.assetUrl===id+'.png'&&n.t&&n.t.visible);
function recorder() {
  const nodes=[];
  return {nodes, backend:{createNode(spec){const n={spec};nodes.push(n);return n;},
    updateNode(n,t){n.t={...t};},destroyNode(){},destroy(){}}};
}
function play(p, params) {
  const rec=recorder();
  const rt=Core.createRuntime({resolver:{resolve:id=>id},backend:rec.backend});
  rt.registerPreset(p);
  return {...rec,rt,handle:rt.play(p.id,params)};
}
test('舊根0.48秒不能截斷4秒圖層，原始輸入不被改寫',()=>{
  const p=preset([sprite('long',{duration:4}),sprite('short',{duration:.2})]);
  const before=JSON.stringify(p), {rt,nodes,handle}=play(p);
  rt.update(.6);assert.equal(visible(nodes,'long'),true);assert.equal(visible(nodes,'short'),false);
  rt.update(3.3);assert.equal(nodes[0].t.visible,true);assert.notEqual(rt.timeOf(handle),null);
  rt.update(.11);assert.equal(rt.timeOf(handle),null);assert.equal(nodes[0].t.visible,false);
  assert.equal(JSON.stringify(p),before);rt.destroy();
});
test('含delay的最後一層完整播完；總時長可隨圖層縮短',()=>{
  const p=preset([sprite('long',{delay:1,duration:4}),sprite('short',{duration:2})]);
  assert.equal(Core.derivePresetDuration(p),5);
  const {rt,nodes,handle}=play(p);rt.update(.5);assert.equal(visible(nodes,'long'),false);
  rt.update(4.4);assert.equal(visible(nodes,'long'),true);rt.update(.11);assert.equal(rt.timeOf(handle),null);rt.destroy();
  Core.syncPresetDuration(p);assert.equal(p.duration,5);
  p.layers[0].duration=.5;Core.syncPresetDuration(p);assert.equal(p.duration,2);
});
test('父子delay按層級累加，父層結束與停用規則仍生效',()=>{
  const p=preset([{id:'parent',type:'empty',delay:1,duration:2},
    sprite('child',{parent:'parent',delay:.5,duration:4}),
    sprite('disabled',{duration:50,enabled:false})]);
  assert.equal(Core.derivePresetDuration(p),3);
  const {rt,nodes,handle}=play(p);rt.update(1.4);assert.equal(visible(nodes,'child'),false);
  rt.update(1.5);assert.equal(nodes[0].t.visible,true);rt.update(.11);assert.equal(rt.timeOf(handle),null);rt.destroy();
  p.layers[0].enabled=false;p.layers.push(sprite('other',{duration:1}));
  assert.equal(Core.derivePresetDuration(p),1);
});
test('省略duration沿用舊預設，多次同步／序列化／重載不會累加delay',()=>{
  const p=preset([sprite('legacy',{delay:1}),sprite('long',{duration:4})]);
  Core.syncPresetDuration(p);assert.equal(p.duration,4);assert.equal(p.layers[0].duration,.48);
  for(let i=0;i<5;i++) {Core.syncPresetDuration(p);assert.equal(p.duration,4);}
  const reloaded=JSON.parse(Core.serialisePreset(p));Core.syncPresetDuration(reloaded);
  assert.deepEqual(reloaded,p);
  const only=preset([sprite('legacy',{delay:1})]);Core.syncPresetDuration(only);
  assert.equal(only.duration,1.48);Core.syncPresetDuration(only);assert.equal(only.duration,1.48);
});
test('Preset循環等到最晚圖層結束再重播；timeScale仍控制整體速度',()=>{
  const p=preset([sprite('body',{duration:4})]);p.loop=true;
  const a=play(p);a.rt.update(3.9);assert.equal(a.rt.timeOf(a.handle),3.9);
  a.rt.update(.2);assert.ok(Math.abs(a.rt.timeOf(a.handle)-.1)<1e-9);a.rt.destroy();
  p.loop=false;const b=play(p,{timeScale:2});b.rt.update(1.9);
  assert.equal(b.nodes[0].t.visible,true);b.rt.update(.11);assert.equal(b.rt.timeOf(b.handle),null);b.rt.destroy();
});
test('圖層自身loop持續存活，finish仍能回收',()=>{
  const p=preset([sprite('body',{delay:.1,duration:.3,loop:true})]);
  const {rt,nodes,handle}=play(p);rt.update(5);assert.equal(nodes[0].t.visible,true);
  assert.notEqual(rt.timeOf(handle),null);rt.finish(handle);rt.update(0);
  assert.equal(rt.timeOf(handle),null);rt.destroy();
});
test('粒子發射結束後自然播完尾巴，不因派生總時長被回收',()=>{
  const p=preset([{id:'tail',type:'particle',assetId:'tail.png',duration:.1,
    emission:{mode:'burst',count:1},lifetime:[1,1],speed:[0,0]}]);
  const {rt,nodes,handle}=play(p);rt.update(.01);rt.update(.49);
  assert.equal(nodes[0].t.visible,true);assert.notEqual(rt.timeOf(handle),null);
  rt.update(.6);assert.equal(rt.timeOf(handle),null);rt.destroy();
});
test('原始非法duration不被修成合法值，派生總時長超上限也明確拒絕',()=>{
  assert.throws(()=>play({...preset([sprite('body',{duration:4})]),duration:-1}),/不合法/);
  assert.throws(()=>play(preset([sprite('body',{delay:59,duration:4})])),/總時長不合法.*|硬上限/s);
});
test('正式真空迴旋以4秒測試時長在Core與遊戲Adapter均完整播放',()=>{
  const p=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets/slash-wind-spin.json')));
  assert.equal(p.layers.length,14);
  // 作者可在Editor調整時長；回歸情境在私有副本固定4秒，不限制正式檔案的值。
  p.layers.forEach(l=>{l.duration=4;});
  // 模擬尚未經新版Editor存檔的舊根值。
  p.duration=.48;
  const rec=recorder();const adapter=Runtime.create({core:Core,resolver:{resolve:id=>id,has:()=>true},
    fxBackend:rec.backend,ctx:{posOf:()=>({x:0,y:0}),footOf:()=>({x:0,y:0}),playerPos:()=>({x:0,y:0})}});
  adapter.registerPresets([p]);
  assert.equal(adapter.tryPlay({fxKind:'slash',variant:'wind-spin',area:{x:0,y:0,r:60},vfx:{attack:p.id}}),true);
  adapter.update(.6);assert.equal(adapter.stats().fx.activeEffects,1);
  adapter.update(3.3);assert.equal(adapter.stats().fx.activeEffects,1);
  assert.ok(rec.nodes.some(n=>n.t.visible&&n.t.alpha>0));
  adapter.update(.11);assert.equal(adapter.stats().fx.activeEffects,0);adapter.destroy();
});
test('Adapter以派生時長對齊事件dur，不再用舊根值計算timeScale',()=>{
  const p={...preset([sprite('body',{duration:4,alphaOverLife:[[0,1],[1,0]]})]),id:'pillar-light'};
  const rec=recorder(),adapter=Runtime.create({core:Core,resolver:{resolve:id=>id,has:()=>true},fxBackend:rec.backend,
    ctx:{posOf:()=>({x:0,y:0}),footOf:()=>({x:0,y:0}),playerPos:()=>({x:0,y:0})}});
  adapter.registerPresets([p]);adapter.tryPlay({fxKind:'slash',variant:'pillar',targets:['enemy'],dur:2,vfx:{attack:p.id}});
  adapter.update(1.9);assert.equal(adapter.stats().fx.activeEffects,1);
  assert.ok(Math.abs(rec.nodes[0].t.alpha-.05)<1e-9, '4秒曲線須按2秒事件完整播放，不能只播舊根0.48秒的片段');
  adapter.update(.11);assert.equal(adapter.stats().fx.activeEffects,0);adapter.destroy();
});
function extract(src,name) {
  const start=src.indexOf('function '+name+'(');assert.ok(start>=0);let depth=0;
  for(let i=src.indexOf('{',start);i<src.length;i++){
    if(src[i]==='{')depth++;else if(src[i]==='}'&&!--depth)return src.slice(start,i+1);
  }
  throw Error(name);
}
test('Editor修改先同步總時長，再作dirty／預覽／儲存，無效資料仍保留可修正',()=>{
  const src=fs.readFileSync(path.join(root,'tools/vfx/editor/editor.js'),'utf8');
  const p=preset([sprite('body',{duration:4})]),field={},seen=[];
  const ctx={state:{preset:p},ctx:{},VFXCore:Core,document:{querySelector:()=>field},
    refreshDirty:()=>seen.push(['dirty',p.duration]),markGizmoDirty(){},
    setValidation:(cls)=>seen.push([cls,p.duration]),rebuildPreview:()=>seen.push(['preview',p.duration])};
  vm.createContext(ctx);vm.runInContext(extract(src,'onPresetChanged'),ctx);ctx.onPresetChanged();
  assert.equal(p.duration,4);assert.equal(field.value,'4');assert.deepEqual(seen[0],['dirty',4]);
  assert.deepEqual(seen.at(-1),['preview',4]);
  assert.equal(JSON.parse(Core.serialisePreset(p)).duration,4);
  p.layers[0].duration=2;ctx.onPresetChanged();assert.equal(p.duration,2);
  p.layers[0].duration=-1;seen.length=0;ctx.onPresetChanged();
  assert.equal(p.layers[0].duration,-1);assert.ok(seen.some(a=>a[0]==='hint err'));
  assert.ok(!seen.some(a=>a[0]==='preview'));
});
