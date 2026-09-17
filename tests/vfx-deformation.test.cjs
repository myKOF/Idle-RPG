'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Core=require('../js/vfx-core.js');
function preset(){return {schemaVersion:1,id:'joined',duration:1,layers:[
 {id:'upper',type:'sprite',assetId:'a',position:{x:0,y:-100}},
 {id:'lower',type:'sprite',assetId:'a'}],
 deformation:{axis:'y',start:-200,end:0,amplitude:10,widthJitter:.07,mirror:true,layers:['upper','lower']}};}
function run(seed,params={}){
 const nodes=[],backend={createNode(s){const n={spec:s};nodes.push(n);return n;},updateNode(n,t){n.t=structuredClone(t);},destroyNode(){},destroy(){}};
 const rt=Core.createRuntime({backend,resolver:{resolve:x=>x,has:()=>true}});rt.registerPreset(preset());
 const h=rt.play('joined',{seed,...params});rt.update(.1);return {rt,h,nodes};
}
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
test('DEFORM 正式Preset全數合法，已拒絕的受擊預覽不接入',()=>{
 const dir=path.join(__dirname,'../vfx/presets');let count=0;
 for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.json'))){const p=JSON.parse(fs.readFileSync(path.join(dir,f)));if(!p.deformation)continue;count++;assert.deepEqual(Core.validatePreset(p).errors,[],f);assert.equal(Core.serialisePreset(JSON.parse(Core.serialisePreset(p))),Core.serialisePreset(p));}
 assert.ok(count>=22);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'hit-thunderstrike-bluewhite.json'))).deformation,undefined);
});
