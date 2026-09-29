"use strict";
// 使用落雷的連續主弧／分岔，不沿用有透明斷段的舊飛行圖集。
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../../../..');
function make(){
 const source=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets/bolt-thunderstrike-bluewhite.json'),'utf8'));
 const main=source.layers.find(l=>l.id==='white-core'),top=main.position.y,cx=main.position.x;
 const width=512*main.scale.y;
 const layers=source.layers.filter(l=>['blue-corona','white-core','side-fork'].includes(l.id)).map(l=>{
  const n=JSON.parse(JSON.stringify(l));n.position={x:(l.position?.y||0)-top,y:cx-(l.position?.x||0)};
  n.rotation=(l.rotation||0)-Math.PI/2;n.duration=.366;delete n.delay;delete n.scaleYOverLife;
  n.tint=l.id==='white-core'?'#fff8cf':l.id==='blue-corona'?'#ffd43b':'#ffbc32';
  n.alphaOverLife=[[0,1],[.9,1],[1,.8]];return n;
 });
 return {schemaVersion:1,id:'bolt-chain-travel-bluewhite',duration:.366,loop:false,
  deformation:{...source.deformation,axis:'x',start:0,end:width,layers:layers.map(l=>l.id)},
  sizing:{shape:'custom',widthM:width/10,heightM:10.6,authored:{width,height:106}},layers};
}
if(require.main===module){const p=make();fs.writeFileSync(path.join(root,'vfx/presets',p.id+'.json'),JSON.stringify(p,null,2)+'\n');
 fs.writeFileSync(path.join(root,'vfx/layouts',p.id+'.json'),JSON.stringify({schemaVersion:1,presetId:p.id,groups:[{id:p.id,name:p.id,layerIds:p.layers.map(l=>l.id)}],order:['group:'+p.id]},null,2)+'\n');}
module.exports={make};
