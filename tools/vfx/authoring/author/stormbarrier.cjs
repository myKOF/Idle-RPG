'use strict';
const k=require('../preset-kit.cjs');
function make(){
 const p={schemaVersion:1,id:'ground-storm-barrier',duration:2,loop:true,sizing:{shape:'circle',radiusM:6,authored:{radius:180}},layers:[]};
 const add=(id,asset,pos,scale,tint,alpha,z)=>{const l={id,type:'sprite',assetId:asset,position:pos,scale,anchor:{x:.5,y:.5},tint,alpha,zIndex:z,blendMode:'add',duration:2};p.layers.push(l);return l;};
 for(let i=0;i<2;i++){const l=add('floor-spiral-'+i,k.A.twirl03,{x:0,y:0},{x:.7-i*.1,y:.7-i*.1},i?'#82ffdb':'#409eea',i?.65:.75,i);l.outerScale={x:1,y:.38};l.rotation=i*Math.PI;l.rotationOverLife=[[0,0],[1,-Math.PI*.5]];}
 for(let i=0;i<12;i++){const a=i*Math.PI*2/12,y=Math.sin(a)*58;const l=add('ascending-light-'+i,'codex-authored/stormbarrier/rising-light.png',{x:Math.cos(a)*150,y:y+8},{x:.42,y:.43+(i%3)*.055},i%3?'#41cadd':'#599dff',.55,y>0?100+i:3+i);l.anchor={x:.5,y:1};l.alphaOverLife=Array.from({length:9},(_,j)=>[j/8,.58+.42*Math.sin((j/8*2+i/12)*Math.PI)**2]);l.offsetYOverLife=[[0,0],[.5,-7],[1,0]];}
 for(let i=0;i<10;i++){const a=i*2.399,y=Math.sin(a)*55;const l=add('rising-mote-'+i,k.A.dot,{x:Math.cos(a)*145,y:y-6},{x:.01,y:.01},i%2?'#b6ffed':'#89cfff',.75,130+i);l.delay=i*.09;l.duration=.65;l.offsetYOverLife=[[0,0],[1,-90]];l.alphaOverLife=[[0,0],[.2,1],[1,0]];}
 p.layers.sort((a,b)=>a.zIndex-b.zIndex);return p;
}
if(require.main===module){const fs=require('fs'),p=make(),core=require('../../../../js/vfx-core.js');fs.writeFileSync(k.REPO+'/vfx/presets/'+p.id+'.json',core.serialisePreset(p));k.writeRootGroupLayout(p);}module.exports={make};
