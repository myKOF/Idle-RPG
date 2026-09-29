'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Core=require('../js/vfx-core.js');
function preset(){return {schemaVersion:1,id:'joined',duration:1,layers:[
 {id:'upper',type:'sprite',assetId:'a',position:{x:0,y:-100}},
 {id:'lower',type:'sprite',assetId:'a'}],
 deformation:{axis:'y',start:-200,end:0,amplitude:10,widthJitter:.07,mirror:true,layers:['upper','lower']}};}
function run(seed,params={},motion){
 const nodes=[],backend={createNode(s){const n={spec:s};nodes.push(n);return n;},updateNode(n,t){n.t=structuredClone(t);},destroyNode(){},destroy(){}};
 const rt=Core.createRuntime({backend,resolver:{resolve:x=>x,has:()=>true}});const p=preset();Object.assign(p.deformation,motion);rt.registerPreset(p);
 const h=rt.play('joined',{seed,...params});rt.update(.1);return {rt,h,nodes};
}
test('DEFORM-MOTION 波形隨時間改變，圖層共用、端點固定且關閉後維持舊形狀',()=>{
 const a=run(12,{loop:true},{motionSpeed:12,motionAmplitude:16});
 const sample=()=>[-170,-135,-70,-35].map(y=>Core.deformPoint(a.nodes[0].t.deformation.variation,0,y,{}).x);
 const before=sample();a.rt.update(.09);assert.notDeepEqual(sample(),before);
 assert.deepEqual(a.nodes[0].t.deformation.variation,a.nodes[1].t.deformation.variation);
 for(const y of [-200,0])assert.ok(Math.abs(Core.deformPoint(a.nodes[0].t.deformation.variation,0,y,{}).x)<1e-9);
 for(const motion of [{motionSpeed:0,motionAmplitude:16},{motionSpeed:12,motionAmplitude:0}]){
  const b=run(12,{loop:true},motion),v=b.nodes[0].t.deformation.variation;
  const old=Core.deformPoint(v,0,-75,{});b.rt.update(.3);
  assert.deepEqual(Core.deformPoint(b.nodes[0].t.deformation.variation,0,-75,{}),old);
 }
});
test('DEFORM-MOTION 相同seed與總時間不依FPS；跨循環不重置、暫停與重用可重現',()=>{
 const motion={motionSpeed:12,motionAmplitude:16},a=run(123,{loop:true},motion),b=run(123,{loop:true},motion);
 a.rt.update(1.17);for(let i=0;i<117;i++)b.rt.update(.01);
 const point=r=>Core.deformPoint(r.nodes[0].t.deformation.variation,0,-83,{}).x;
 assert.ok(Math.abs(point(a)-point(b))<1e-8);
 const before=point(a);a.rt.update(0);assert.equal(point(a),before);
 const c=run(123,{loop:true},motion);c.rt.update(.899999);c.rt.update(.000002);
 assert.equal(c.nodes[0].t.deformation.variation.motionKey,12,'跨1秒循環邊界仍使用總時間，不重置出生形狀');
 const v=run(123,{loop:true},motion);const first=point(v);v.rt.stop(v.h);v.rt.play('joined',{seed:123,loop:true});v.rt.update(.1);
 assert.equal(point(v),first);
});
test('DEFORM-MOTION 設定可序列化，拒絕負速度及超大幅度',()=>{
 const p=preset();Object.assign(p.deformation,{motionSpeed:12,motionAmplitude:16});
 assert.ok(Core.validatePreset(p).ok);assert.deepEqual(JSON.parse(Core.serialisePreset(p)),p);
 for(const bad of [{motionSpeed:-1},{motionSpeed:Infinity},{motionAmplitude:31}])assert.equal(Core.validatePreset({...p,deformation:{...p.deformation,...bad}}).ok,false);
 const editor=fs.readFileSync(path.join(__dirname,'../tools/vfx/editor/editor.js'),'utf8');
 assert.ok(editor.includes('Object.keys(VFXCore.DEFORMATION_FIELDS)'),'編輯器使用相同欄位定義');
});
test('DEFORM 同seed可重現，每次施放使用獨立變形，圖層共用參數',()=>{
 const a=run(12),b=run(12),c=run(99);
 assert.deepEqual(a.nodes[0].t.deformation,b.nodes[0].t.deformation);
 assert.notDeepEqual(a.nodes[0].t.deformation.variation,c.nodes[0].t.deformation.variation);
 assert.deepEqual(a.nodes[0].t.deformation.variation,a.nodes[1].t.deformation.variation);
 assert.equal(a.nodes[0].spec.kind,'deformed');
});
test('DEFORM 端點固定、接縫共享同座標，移動旋轉與非等比縮放不改变區域變形',()=>{
 const a=run(12),b=run(12,{position:{x:200,y:80},rotation:1,scaleX:2,scaleY:.5});
 const v=a.nodes[0].t.deformation.variation;
 for(const y of [-200,0]){const p=Core.deformPoint(v,0,y,{});assert.ok(Math.abs(p.x)<1e-10);assert.equal(p.y,y);}
 for(let i=0;i<2;i++)for(const k of ['a','b','c','d','x','y'])assert.ok(Math.abs(a.nodes[i].t.deformation[k]-b.nodes[i].t.deformation[k])<1e-10);
 const world=(n,x,y)=>{const w=n.t.deformation;return Core.deformPoint(w.variation,w.a*x+w.c*y+w.x,w.b*x+w.d*y+w.y,{});};
 assert.deepEqual(world(a.nodes[0],0,50),world(a.nodes[1],0,-50));
});
test('DEFORM 水平光束保留長度，鏡像只改橫向',()=>{
 const v=run(42).nodes[0].t.deformation.variation;v.config.axis='x';v.config.start=0;v.config.end=300;
 for(const x of [0,75,150,300])assert.equal(Core.deformPoint(v,x,0,{}).x,x);
 assert.ok(Math.abs(Core.deformPoint(v,300,0,{}).y)<1e-10);
});
test('DEFORM 驗證與序列化：拒絕未知圖層、粒子、非法範圍及幅度，保留設定',()=>{
 const p=preset();assert.ok(Core.validatePreset(p).ok);
 assert.deepEqual(JSON.parse(Core.serialisePreset(p)).deformation,p.deformation);
 for(const f of [p=>p.deformation.end=-300,p=>p.deformation.amplitude=100,p=>p.deformation.layers=['missing'],p=>p.deformation.widthJitter=1,p=>p.deformation.layers.push('upper'),p=>p.deformation.bad=1]){
  const q=preset();f(q);assert.equal(Core.validatePreset(q).ok,false);
 }
});
test('DEFORM 回收重用後換seed，不殘留上一道形狀',()=>{
 const a=run(12),old=a.nodes[0].t.deformation.variation;a.rt.stop(a.h);a.rt.play('joined',{seed:99});a.rt.update(.1);
 const active=a.nodes.filter(n=>n.t.visible);assert.equal(active.length,2);assert.notDeepEqual(active[0].t.deformation.variation,old);
});
test('DEFORM 正式Preset全數合法且可往返，落雷受擊沿用已核准的雷電變形',()=>{
 const dir=path.join(__dirname,'../vfx/presets');let count=0;
 for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.json'))){const p=JSON.parse(fs.readFileSync(path.join(dir,f)));if(!p.deformation)continue;count++;assert.deepEqual(Core.validatePreset(p).errors,[],f);assert.equal(Core.serialisePreset(JSON.parse(Core.serialisePreset(p))),Core.serialisePreset(p));}
 assert.ok(count>=22);const hit=JSON.parse(fs.readFileSync(path.join(dir,'hit-thunderstrike-bluewhite.json')));
 assert.ok(hit.deformation);assert.ok(hit.layers.some(l=>l.type==='particle'),'已核准的藍白粒子飛濺保留');
});


test('DEFORM-RESHAPE 出生與飛行同一生成器，完整重抽鏡像、寬度、相位且不插值壓扁',()=>{
 const seed=123,motion={motionSpeed:10,motionAmplitude:10};
 const born=run(seed,{loop:true},{motionSpeed:5,motionAmplitude:10}).nodes[0].t.deformation.variation;
 const staticBorn=run(seed,{loop:true}).nodes[0].t.deformation.variation;
 assert.equal(born.motionKey,0);
 for(const field of ['phase','mirror','width'])assert.equal(born[field],staticBorn[field]);
 for(const y of [-190,-150,-80,-10])assert.deepEqual(Core.deformPoint(born,4,y,{}),Core.deformPoint(staticBorn,4,y,{}));
 const a=run(seed,{loop:true},motion),mirrors=new Set(),widths=new Set(),phases=new Set();
 for(let key=1;key<=25;key++){
  const w=a.nodes[0].t.deformation.variation;
  assert.equal(w.motionKey,key);
  const birth=run((seed^Math.imul(key,0x9e3779b9))>>>0,{loop:true}).nodes[0].t.deformation.variation;
  for(const field of ['phase','mirror','width'])assert.equal(w[field],birth[field],field+' 與重新出生使用同樣抽樣');
  mirrors.add(w.mirror);widths.add(w.width);phases.add(w.phase);
  assert.ok(w.width>=.93 && w.width<=1.07);assert.ok(w.mirror===1||w.mirror===-1);
  const revision=w.motionTime;a.rt.update(.04);
  const middle=a.nodes[0].t.deformation.variation;
  assert.equal(middle.motionTime,revision);assert.equal(middle.mirror,w.mirror);assert.equal(middle.width,w.width);
  assert.deepEqual(a.nodes[0].t.deformation.variation,a.nodes[1].t.deformation.variation);
  a.rt.update(.06);
 }
 assert.equal(mirrors.size,2);assert.ok(widths.size>20&&phases.size>20);
});

test('DEFORM-RESHAPE 尊重關閉鏡射機率、寬度與相位隨機參數',()=>{
 const a=run(123,{loop:true},{motionSpeed:12,motionAmplitude:10,mirrorChance:0,widthJitter:0,phaseRandom:0,phase:1});
 for(let i=0;i<30;i++){
  const w=a.nodes[0].t.deformation.variation;
  assert.equal(w.mirror,1);assert.equal(w.width,1);assert.equal(w.phase,1);
  a.rt.update(.1);
 }
});

 test('兩端尖細收束在編輯器與遊戲共用變形座標，中心維持原寬度',()=>{
  for(const axis of ['x','y']){
   const w={config:{axis,start:0,end:400,amplitude:0,tipTaper:.12},mirror:1,width:1,phase:0};
   for(const along of [0,400]){
    const p=Core.deformPoint(w,axis==='x'?along:20,axis==='x'?20:along,{});
    assert.equal(axis==='x'?p.y:p.x,0);
   }
   const p=Core.deformPoint(w,axis==='x'?200:20,axis==='x'?20:200,{});
   assert.equal(axis==='x'?p.y:p.x,20);
  }
 });

test('金色雷鏈製作寬度與素材實際幾何一致，光暈也收尖',()=>{
 const p=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/bolt-chain-lightning.json'),'utf8'));
 assert.equal(p.sizing.authored.width,512*p.layers[0].scale.x);
 assert.equal(p.deformation.end-p.deformation.start,p.sizing.authored.width);
 assert.ok(p.deformation.tipTaper>0);
 assert.deepEqual(new Set(p.deformation.layers),new Set(p.layers.map(l=>l.id)));
});
