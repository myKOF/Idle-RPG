'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Core=require('../js/vfx-core.js'),Adapter=require('../js/vfx-runtime.js');
const ids=['aura-rockarmor-stone','aura-earth-reversal','aura-rockarmor-stone-08','aura-rockarmor-stone-09','aura-rockarmor-stone-10'];
const read=id=>JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets',id+'.json'),'utf8'));
function recorder(){const nodes=[];return {nodes,backend:{createNode(spec){const n={spec,t:null};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.dead=true;}}};}
const resolver={resolve:id=>id,has:()=>true};
function close(a,b){assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);}

test('sortByY：排序直接共用位置／投影，逐幀跨圈一致，未設定維持原值，序列化／驗證嚴格',()=>{
 const p={schemaVersion:1,id:'depth-curve',duration:1,loop:true,layers:[{id:'moving',type:'sprite',assetId:'test/stone.png',zIndex:1000,sortByY:true,position:{x:0,y:-30},offsetYOverLife:[[0,-10],[.5,10],[1,-10]]},
  {id:'old',type:'sprite',assetId:'test/stone.png',zIndex:7}]};
 const rec=recorder(),rt=Core.createRuntime({backend:rec.backend,resolver});rt.registerPreset(p);const h=rt.play(p.id,{position:{x:0,y:70}});
 rt.update(.25);close(rec.nodes[0].t.zIndex,970);assert.equal(rec.nodes[1].t.zIndex,7);
 rt.update(.25);close(rec.nodes[0].t.zIndex,980);rt.update(1);close(rec.nodes[0].t.zIndex,980);
 rt.setTransform(h,{position:{x:0,y:110},scaleY:2});rt.update(0);close(rec.nodes[0].t.y,70);close(rec.nodes[0].t.zIndex,960);
 const round=JSON.parse(Core.serialisePreset(p));assert.equal(round.layers[0].sortByY,true);
 for(const invalid of ['yes',0,NaN,{}]){const q=structuredClone(p);q.layers[0].sortByY=invalid;assert.equal(Core.validatePreset(q).ok,false);}
 const empty=structuredClone(p);empty.layers[0]={id:'empty',type:'empty',sortByY:true};assert.equal(Core.validatePreset(empty).ok,false);
 rt.destroy();
});

test('sortByY共用父子旋轉、實例縮放、地面投影與粒子運動，修改軌跡不用同步第二份排序資料',()=>{
 for(const projected of [false,true]){
  const rec=recorder(),rt=Core.createRuntime({backend:rec.backend,resolver});
  const stone={id:'stone',type:'sprite',parent:'pivot',assetId:'test/stone.png',position:{x:10,y:0},sortByY:true,zIndex:1000};
  if(projected)stone.projection={x:1,y:.5};
  rt.registerPreset({schemaVersion:1,id:'parent-depth',duration:1,layers:[{id:'pivot',type:'empty',rotation:Math.PI/2},stone]});
  rt.play('parent-depth',{position:{x:100,y:200},scale:2});rt.update(.2);
  close(rec.nodes[0].t.y,projected?210:220);close(rec.nodes[0].t.zIndex,projected?1010:1020);rt.destroy();
 }
 const rec=recorder(),rt=Core.createRuntime({backend:rec.backend,resolver});
 rt.registerPreset({schemaVersion:1,id:'particle-depth',duration:1,layers:[{id:'p',type:'particle',assetId:'test/p.png',zIndex:7,sortByY:true,
  emission:{mode:'burst',count:1},lifetime:1,startScale:1,speed:10,direction:90,spread:0,worldSpace:false}]});
 rt.play('particle-depth',{position:{x:0,y:70}});rt.update(.25);close(rec.nodes[0].t.zIndex,9.5);close(rec.nodes[0].t.y,72.5);rt.destroy();
});

test('六塊石碑在Editor按實際軌道深度換序，每塊plate／glow／rune不互相拆散',()=>{
 for(const id of ids){
  const p=read(id),rec=recorder(),rt=Core.createRuntime({backend:rec.backend,resolver});rt.registerPreset(p);rt.play(id);
  for(let frame=0;frame<165;frame++){
   rt.update(.05);const stones=[];
   for(let i=0;i<6;i++){
    const parts=rec.nodes.slice(i*3,i*3+3).map(n=>n.t);const z=parts[0].zIndex;
    close(parts[1].zIndex-z,.001);close(parts[2].zIndex-z,.002);
    close(parts[0].y,parts[1].y);close(parts[0].y,parts[2].y);
    close(z-1000,parts[0].y);
    stones.push(parts[0]);
   }
   const ordered=stones.slice().sort((a,b)=>a.zIndex-b.zIndex);
   for(let i=1;i<ordered.length;i++)assert.ok(ordered[i].y>=ordered[i-1].y-1e-7,id+' 遠側先畫、近側後畫');
   assert.ok(rec.nodes.slice(18).every(n=>n.t.zIndex<Math.min(...stones.map(s=>s.zIndex))),'底光不蓋住遠側石碑');
  }
  rt.destroy();
 }
});

test('近側石碑走角色輪廓前的專用後端，遠側維持後方；續命移動不重播且清理完整',()=>{
 for(const id of ids){
  const fx=recorder(),zone=recorder(),front=recorder();let point={x:300,y:200};
  const a=Adapter.create({core:Core,resolver,fxBackend:fx.backend,zoneBackend:zone.backend,actorFrontBackend:front.backend,
   ctx:{footOf:()=>point,posOf:()=>point,playerPos:()=>point}});a.registerPresets([read(id)]);
  const spec={fxKind:'aura',variant:'rock-armor',targets:['pv-float'],dur:1,vfx:{ground:id}};
  const seen=new Set();
  for(let f=0;f<165;f++){
   point={x:300+f,y:200+f*.2};assert.equal(a.tryPlay(spec),true);a.update(.05);
   assert.equal(fx.nodes.length,0,'近側不可再進會被角色輪廓蓋住的普通fx層');
   assert.equal(front.nodes.length,18);assert.equal(zone.nodes.length,read(id).layers.length);
   for(let i=0;i<18;i++){
    const n=front.nodes[i].t,b=zone.nodes[i].t;
    close(n.x,b.x);close(n.y,b.y);close(n.zIndex,b.zIndex);assert.ok(n.sortY>point.y);assert.ok(b.sortY<point.y);
    if(n.alpha>.5)seen.add('front');if(b.alpha>.5)seen.add('back');
   }
  }
  assert.deepEqual([...seen].sort(),['back','front']);a.clear();
  assert.equal(a.stats().actorFront.activeEffects,0);assert.equal(a.stats().zone.activeEffects,0);
  assert.ok(front.nodes.every(n=>n.t.visible===false),'清理後節點隱藏並回到原生池');a.destroy();
  assert.ok(front.nodes.every(n=>n.dead),'destroy後釋放池內節點');
 }
});

test('玩家輪廓仍保留穿透功能，只有岩甲近側容器放在輪廓之後',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../js/battle-renderer.js'),'utf8');
 assert.ok(s.indexOf('world.addChild(outlineLayer);')<s.indexOf('world.addChild(actorFront);'));
 assert.match(s,/actorFrontContainer: S\.layers\.actorFront/);assert.match(s,/S\.layers\.outline\.addChild\(sp\)/);
});
