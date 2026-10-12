'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Core=require('../js/vfx-core'),Runtime=require('../js/vfx-runtime');
function setup(preset,point={x:100,y:80}){
 const calls=[],nodes=[];
 const core={...Core,createRuntime(options){
  const rt=Core.createRuntime(options),play=rt.play;
  return {...rt,play(id,params){calls.push({id,params});return play(id,params);}};
 }};
 const a=Runtime.create({core,resolver:{has:()=>true,resolve:id=>id},
  fxBackend:{createNode(spec){const n={spec,transforms:[]};nodes.push(n);return n;},updateNode(n,t){n.transforms.push({...t});},destroyNode(){},destroy(){}},
  ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>point,footOf:id=>id==='pv-float'?{x:0,y:0}:point}});
 a.registerPresets([preset]);return {a,calls,nodes};
}
const read=id=>JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets',id+'.json'),'utf8'));
test('GALE 本體、爆散、月牙閃、千鳥與雷神之怒在八方目標均保留製作方向、範圍與局部動畫',()=>{
 for(const [id,variant] of [['hit-gale-burst','gale-burst'],['hit-gale-burst-diffusion','gale-burst'],['hit-gale-burst-07-moon','gale-moon'],['hit-gale-burst-10-bird','gale-moon'],['hit-gale-burst-10-bird','gale-chidori'],['bolt-sky-purple','thunder-strike']]){
  const preset=read(id);let baseline;
  for(let i=0;i<8;i++){
   const point={x:100*Math.cos(i*Math.PI/4),y:100*Math.sin(i*Math.PI/4)},h=setup(preset,point);
   assert.equal(h.a.tryPlay({fxKind:variant==='thunder-strike'?'rain':'slash',variant,area:{...point,r:100},targets:[],vfx:{attack:id}}),true);
   h.a.update(.05);assert.equal(h.calls[0].params.rotation,0,id+' 不隨目標旋轉');
   const frames=h.nodes.filter(n=>n.spec.kind==='sprite'&&n.transforms.length).map(n=>{const t=n.transforms.at(-1);return {rotation:t.rotation,scaleX:t.scaleX,scaleY:t.scaleY,skewX:t.skewX,perspective:t.perspective};});
   assert.ok(frames.length>0);
   if(baseline)assert.deepEqual(frames,baseline,id+' 作者旋轉、傾角及尺寸不變');else baseline=frames;
   assert.equal(h.calls[0].params.position.x,point.x);assert.equal(h.calls[0].params.position.y,point.y);h.a.destroy();
  }
 }
});
test('GALE 敵身爆散的立即與延遲播放均不加面敵角，保留作者局部旋轉',()=>{
 const p={schemaVersion:1,id:'custom-gale',duration:1,layers:[{id:'body',type:'sprite',assetId:'body.png',rotation:.37,perspective:false}]};
 for(const variant of ['gale-burst','thunder-strike'])for(const travelMs of [0,200]){
  const h=setup(p);h.a.tryPlay({fxKind:variant==='thunder-strike'?'rain':'slash',variant,angle:1.2,targets:['enemy'],travelMs:[travelMs],vfx:{attack:p.id}});
  h.a.update(.25);assert.equal(h.calls[0].params.rotation,0);assert.ok(Math.abs(h.nodes[0].transforms.at(-1).rotation-.37)<1e-8);h.a.destroy();
 }
});
test('GALE 霹靂一閃正式素材在八方維持貫穿路徑，本體不受該路徑轉向',()=>{
 for(let i=0;i<8;i++){
  const angle=i*Math.PI/4,h=setup(read('beam-gale-thunder-flash'));
  h.a.tryPlay({fxKind:'slash',variant:'gale-thunder-flash',area:{x:10,y:20,w:100,h:10,a:angle},travelMs:[80],vfx:{attack:'beam-gale-thunder-flash'}});
  assert.equal(h.calls[0].params.rotation,angle);h.a.destroy();
 }
});
test('GALE 霹靂一閃及其他一般攻擊仍遵守明確攻擊方向',()=>{
 const p={schemaVersion:1,id:'custom-attack',duration:1,layers:[{id:'body',type:'sprite',assetId:'body.png'}]};
 for(const spec of [{fxKind:'slash',variant:'gale-thunder-flash',area:{x:10,y:20,w:100,h:10,a:1.2},travelMs:[200]},
  {fxKind:'slash',variant:'other-attack',angle:1.2,targets:['enemy']}]){
  const h=setup(p);h.a.tryPlay({...spec,vfx:{attack:p.id}});h.a.update(.05);assert.equal(h.calls[0].params.rotation,1.2);h.a.destroy();
 }
});
