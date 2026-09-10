'use strict';
const fs=require('node:fs'),path=require('node:path');
const kit=require('../preset-kit.cjs');
const {A,sprite,particle}=kit;
function make(){
 const hit={id:'hit-bloodrage-glow',duration:.25,loop:false,sizing:{shape:'custom',widthM:6,heightM:7,authored:{width:60,height:70}},layers:[
  sprite({id:'crimson-bloom',asset:A.glowSoft,sizeX:76,sizeY:65,tint:'#b80828',alpha:.65,blend:'add',duration:.25,alphaOverLife:[[0,0],[.12,1],[.45,.6],[1,0]],scaleOverLife:[[0,.4],[.3,1],[1,1.15]]}),
  sprite({id:'red-light-pillar',asset:A.glowSoft,sizeX:22,sizeY:81,rotDeg:-13,tint:'#ff1537',alpha:.85,blend:'add',duration:.23,alphaOverLife:[[0,0],[.15,1],[.5,.65],[1,0]],scaleOverLife:[[0,.5],[.22,1],[1,.7]]}),
  sprite({id:'scarlet-flare',asset:A.glowSoft,sizeX:57,sizeY:13,rotDeg:12,tint:'#ff2944',alpha:.7,blend:'add',duration:.18,alphaOverLife:[[0,0],[.15,1],[1,0]]}),
  sprite({id:'rose-core',asset:A.glowSoft,size:18,tint:'#ff6675',alpha:.7,blend:'add',duration:.13,alphaOverLife:[[0,0],[.2,1],[1,0]]}),
  particle({id:'floating-red-light',asset:A.glowSoft,burst:7,duration:.25,lifetime:[.14,.25],spawnBox:[26,30],speed:[15,45],direction:-90,spread:65,startPx:[5,10],tint:'#f91b40',alpha:.65,blend:'add',alphaOverLife:[[0,0],[.2,1],[1,0]],scaleOverLife:[[0,.7],[.3,1],[1,.25]]})
 ]};
 const aura={id:'aura-bloodrage-fury',duration:1.4,loop:true,sizing:{shape:'custom',widthM:6,heightM:8,authored:{width:60,height:80}},layers:[
  particle({id:'blood-mist',asset:A.smokeT,y:-16,spawnBox:[36,12],rate:6,lifetime:[.6,1.1],speed:[18,33],direction:-90,spread:28,startPx:[24,38],rotationStart:[-1,1],tint:'#8f1732',alpha:.24,blend:'normal',alphaOverLife:[[0,0],[.3,.65],[1,0]],scaleOverLife:[[0,.5],[1,1.1]]}),
  particle({id:'rising-fury',asset:A.trace02H,y:-4,spawnBox:[43,6],rate:12,lifetime:[.3,.55],speed:[60,100],direction:-90,spread:20,startPx:[15,28],alignToVelocity:true,tint:'#fb264b',alpha:.46,blend:'add',alphaOverLife:[[0,0],[.2,1],[1,0]],scaleOverLife:[[0,.4],[.4,1],[1,.15]]}),
  particle({id:'blood-embers',asset:kit.alphaTwin(A.star04),y:-12,spawnBox:[46,34],rate:10,lifetime:[.4,.8],speed:[17,38],direction:-90,spread:80,startPx:[2,5],rotationStart:[0,6.28],rotationSpeed:[-2,2],tint:'#ff5874',alpha:.65,blend:'normal',alphaOverLife:[[0,0],[.2,1],[1,0]]})
 ]};
 const drain={id:'proj-bloodrage-drain',duration:.6,loop:true,sizing:{shape:'custom',widthM:3,heightM:2,authored:{width:30,height:20}},layers:[
  sprite({id:'crimson-tail',asset:A.glowSoft,x:-10,sizeX:38,sizeY:11,tint:'#bc1434',alpha:.45,blend:'add'}),
  sprite({id:'blood-pearl',asset:kit.alphaTwin(A.dot),size:11,tint:'#e92248',alpha:.95,blend:'normal'}),
  sprite({id:'pearl-glint',asset:A.glowSoft,x:2,y:-1,size:6,tint:'#ffb5bd',alpha:.65,blend:'add'}),
  particle({id:'drain-trail',asset:kit.alphaTwin(A.dot),x:-5,spawnBox:[9,5],rate:22,lifetime:[.12,.25],speed:[25,60],direction:180,spread:18,startPx:[2,4],tint:'#e82a51',alpha:.7,blend:'normal',alphaOverLife:[[0,.8],[1,0]],scaleOverLife:[[0,1],[1,.1]]})
 ]};
 [aura,hit,drain].forEach(p=>p.layers.forEach((l,i)=>l.zIndex=i));
 return [aura,hit,drain];
}
if(require.main===module)console.log(make().map(p=>kit.write(p)));
module.exports={make};
