'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js'),Layers=require('../tools/vfx/editor/layer-model.js');
const read=id=>JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../vfx/presets',id+'.json'),'utf8'));
const preset=id=>({schemaVersion:1,id,duration:2,loop:false,layers:[{id:'body',type:'sprite',assetId:'test.png'}]});
function adapter(presets){
  const nodes=[];
  const backend={createNode:spec=>{const n={spec};nodes.push(n);return n;},updateNode:(n,t)=>{n.t={...t};},destroyNode:()=>{},destroy:()=>{}};
  const runtime=Runtime.create({core:Core,fxBackend:backend,resolver:{has:()=>true,resolve:id=>id},
    ctx:{posOf:id=>id==='pv-float'?{x:0,y:0}:{x:300,y:0},footOf:()=>({x:0,y:0}),playerPos:()=>({x:0,y:0}),chainPoint:id=>id==='pv-float'?{x:0,y:0}:{x:300,y:0}}});
  runtime.registerPresets(presets);return {runtime,nodes};
}
test('全目錄 Preset 通過驗證；新增控制不要求改寫 238 份素材',()=>{
  for(const file of fs.readdirSync(require('node:path').join(__dirname,'../vfx/presets')).filter(f=>f.endsWith('.json'))){
    const p=read(file.slice(0,-5));assert.deepEqual(Core.validatePreset(p).errors,[],file);
    assert.deepEqual(JSON.parse(Core.serialisePreset(p)),p);
  }
});
test('所有播放參數可往返；錯字、型別、非有限值與越界不能存入',()=>{
  const p=preset('test');p.playback=Object.fromEntries(Object.entries(Core.PLAYBACK_FIELDS).map(([k,f])=>[k,f.default]));
  assert(Core.validatePreset(p).ok);assert.deepEqual(JSON.parse(Core.serialisePreset(p)).playback,p.playback);
  for(const [key,f] of Object.entries(Core.PLAYBACK_FIELDS)){
    for(const value of [null,{},NaN,typeof f.default==='number'?f.max+1:42]){
      assert.equal(Core.validatePreset({...p,playback:{[key]:value}}).ok,false,key+' '+value);
    }
  }
  assert.equal(Core.validatePreset({...p,playback:{typo:1}}).ok,false);
});
test('鏡射中心可固定在圖層原始高度；關閉振幅與抖動後位置可精確預期',()=>{
  const config={axis:'x',start:0,end:100,amplitude:0,widthJitter:0,mirror:true,layers:['body']};
  let point=Core.deformPoint({config,mirror:-1,width:1,phase:0},50,-30,{});assert.equal(point.y,30);
  point=Core.deformPoint({config:{...config,pivot:-30},mirror:-1,width:1,phase:0},50,-30,{});assert.equal(point.y,-30);
  assert.equal(Core.validatePreset({...preset('test'),deformation:{...config,mirrorChance:2}}).ok,false);
});
test('未填變形新參數與原公式完全一致',()=>{
  const config={axis:'x',start:-40,end:80,amplitude:9,widthJitter:.07,mirror:true,layers:['body']};
  for(const x of [-40,0,40,80])for(const mirror of [-1,1]){
    const phase=.37,q=(x+40)/120;
    const expected=-30*mirror*1.03+Math.sin(Math.PI*q)*9*(Math.sin(q*9+phase)*.7+Math.sin(q*19+phase*.7)*.3);
    assert(Math.abs(Core.deformPoint({config,phase,mirror,width:1.03},x,-30,{}).y-expected)<1e-12);
  }
});
test('圖層改名同步更新 deformation，仍能通過驗證及存檔',()=>{
  const p=read('aura-lightning-relay');Layers.renameLayer(p,null,'web','renamed-web');
  assert(p.deformation.layers.includes('renamed-web'));assert(Core.validatePreset(p).ok);
});
test('範圍受擊倍率實際進入渲染變換',()=>{
  const p=preset('test');p.playback={hitScale:2.5};const {runtime,nodes}=adapter([p]);
  runtime.tryPlay({fxKind:'burst',targets:['enemy'],vfx:{hit:p.id}});runtime.update(.01);
  assert.equal(nodes[0].t.scaleX,2.5);runtime.destroy();
});
test('天降高度與角度使用 Preset，抵達時刻仍遵循事件',()=>{
  const p=preset('proj-meteor-inferno');p.playback={fallHeight:200,fallAngle:90};const {runtime,nodes}=adapter([p]);
  runtime.tryPlay({fxKind:'rain',targets:['enemy'],area:{x:300,y:0},travelMs:[1000],hit:false,vfx:{projectile:p.id}});runtime.update(.5);
  assert(Math.abs(nodes[0].t.x-300)<1e-6);assert(Math.abs(nodes[0].t.y+100)<1e-6);
  runtime.update(.5);assert.equal(runtime.stats().projectiles,0);runtime.destroy();
});
test('雷鏈長度和尖端比例可調，停止鏈仍立即清除',()=>{
  const p=read('bolt-chain-travel-bluewhite');p.playback={chainLengthM:20,tipTaper:.25};const {runtime,nodes}=adapter([p]);
  runtime.tryPlay({fxKind:'chain',variant:'lightning-chain',targets:['pv-float','enemy'],travelMs:[0,1000],lineLength:180,hit:false,
    area:{chainId:'test',homingSpeed:300},vfx:{attack:p.id}});runtime.update(.2);
  const t=nodes.find(n=>n.t?.deformation)?.t;assert(t);assert(Math.abs(t.deformation.clipTaper-p.sizing.authored.width*.25)<1e-6);
  assert(Math.abs(t.deformation.scaleX-200/p.sizing.authored.width)<1e-6);
  runtime.tryPlay({fxKind:'chain',variant:'lightning-chain-end',area:{chainId:'test'},vfx:{}});
  assert.equal(runtime.stats().fx.activeEffects,0);runtime.destroy();
});
test('天地逆返關閉繼承時保留自己的圖層；開啟時採使用者配色',()=>{
  const source=preset('aura-rockarmor-stone');source.layers[0].id='stone-1-rune';source.layers[0].tint='#ffffff';
  for(const inherit of [false,true]){
    const p=preset('aura-earth-reversal');p.layers[0].tint='#ff0000';p.playback={inheritGeometry:inherit,runeTint:'#00ff00'};
    const {runtime,nodes}=adapter([source,p]);runtime.tryPlay({fxKind:'slash',targets:['enemy'],hit:false,vfx:{attack:p.id}});runtime.update(.01);
    assert.equal(nodes[0].t.tint,inherit?0x00ff00:0xff0000);runtime.destroy();
  }
});
function extract(src,name){const start=src.indexOf('function '+name+'(');assert(start>=0);let depth=0;for(let i=src.indexOf('{',start);i<src.length;i++){if(src[i]==='{')depth++;else if(src[i]==='}'&&!--depth)return src.slice(start,i+1);}throw Error(name);}
test('編輯參數驗證後才寫入；保持圖層參照，無效值不污染其他 Inspector 欄位',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../tools/vfx/editor/editor.js'),'utf8');
  const p=read('aura-lightning-relay'),layer=p.layers[0],history=[],errors=[];
  const ctx={state:{preset:p},VFXCore:Core,showSaveError:(...e)=>errors.push(e),edit:(label,fn)=>{history.push(label);fn();},onPresetChanged:()=>{}};
  vm.createContext(ctx);vm.runInContext(extract(src,'commitCodeControl'),ctx);
  assert.equal(ctx.commitCodeControl(['deformation','mirror'],false),true);assert.equal(p.deformation.mirror,false);
  assert.equal(ctx.state.preset.layers[0],layer);assert.equal(history.length,1);
  assert.equal(ctx.commitCodeControl(['deformation','widthJitter'],10),false);assert.equal(p.deformation.widthJitter,.07);
  assert.equal(ctx.commitCodeControl(['playback','tipTaper'],0),true);assert.equal(p.playback.tipTaper,0);
  assert.equal(errors.length,1);
});
test('正式儲存管線保存播放與變形控制，重載後保持原值',()=>{
  const path=require('node:path'),os=require('node:os');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-vfx-controls-save-'));
  try{
    fs.mkdirSync(path.join(root,'vfx/presets'),{recursive:true});
    const p=read('aura-lightning-relay');p.playback={hitScale:2.5,sceneProjection:false};p.deformation.mirror=false;p.deformation.pivot=-30;
    const save=require('../tools/vfx/editor-server.cjs').__testOnly.savePresetText;
    assert.equal(save({repoRoot:root},p.id,Core.serialisePreset(p)).status,200);
    const loaded=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets',p.id+'.json'),'utf8'));
    assert.deepEqual(loaded,p);assert(Core.validatePreset(loaded).ok);
  }finally{
    const checked=fs.realpathSync(root),base=fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(checked),base);assert(path.basename(checked).startsWith('codex-vfx-controls-save-'));
    fs.rmSync(checked,{recursive:true,force:true});
  }
});
test('場域出場時間可調為零，不產生 NaN 或被預設值覆蓋',()=>{
  const p=preset('aura-rockarmor-stone');p.loop=true;p.playback={fieldEnter:0,fieldExit:0};
  const {runtime,nodes}=adapter([p]);runtime.tryPlay({fxKind:'aura',targets:['pv-float'],dur:1,vfx:{ground:p.id}});runtime.update(.01);
  assert.equal(nodes[0].t.alpha,1);assert(Number.isFinite(nodes[0].t.scaleX));runtime.destroy();
});
test('火牆新間距不被原圖拆柱抵銷',()=>{
  for(const spacing of [.8,1.2]){
    const p=preset('ground-firewall');p.loop=true;p.playback={wallSpacing:spacing};
    p.sizing={shape:'custom',widthM:30,heightM:12,authored:{width:300,height:120}};
    p.layers=[0,1,2].map(i=>({id:'column-'+i+'-body',type:'sprite',assetId:'column.png',position:{x:(i-1)*80,y:0}}));
    const {runtime,nodes}=adapter([p]);runtime.tryPlay({fxKind:'aura',area:{id:'wall',x:0,y:0,w:300,h:120,a:0},dur:2,vfx:{ground:p.id}});runtime.update(.4);
    assert.deepEqual(nodes.map(n=>n.t.x).sort((a,b)=>a-b),[-100*spacing,0,100*spacing]);runtime.destroy();
  }
});
