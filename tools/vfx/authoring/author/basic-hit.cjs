'use strict';
const kit=require('../preset-kit.cjs');
const {A,sprite,particle}=kit;
function make(){
 const fade=[[0,0],[.12,1],[.4,.65],[1,0]];
 const layers=[
  sprite({id:'gold-fracture',asset:kit.alphaTwin(A.star08),size:42,rotDeg:19,tint:'#ffd36b',alpha:.75,blend:'normal',duration:.22,alphaOverLife:fade,scaleOverLife:[[0,.35],[.2,1],[1,1.15]]}),
  sprite({id:'ivory-impact',asset:kit.alphaTwin(A.star04),size:25,rotDeg:-17,tint:'#fff2cd',alpha:.85,blend:'normal',duration:.16,alphaOverLife:fade,scaleOverLife:[[0,.3],[.2,1],[1,.7]]}),
  sprite({id:'gold-afterburst',asset:kit.alphaTwin(A.star08),size:34,rotDeg:61,tint:'#e9a83d',alpha:.42,blend:'normal',delay:.035,duration:.18,alphaOverLife:fade,scaleOverLife:[[0,.3],[.25,.85],[1,1.3]]}),
  sprite({id:'tiny-heart',asset:A.glowSoft,size:11,tint:'#fff9e7',alpha:.5,blend:'screen',duration:.045,alphaOverLife:fade}),
  particle({id:'gold-chips',asset:kit.alphaTwin(A.dot),burst:10,duration:.25,lifetime:[.16,.25],spawnRadius:2,speed:[95,180],direction:0,spread:360,drag:6,startPx:[1.5,3],tint:'#ffe2a0',alpha:.75,blend:'normal',alphaOverLife:[[0,1],[.5,.7],[1,0]],scaleOverLife:[[0,1],[1,.2]]}),
  particle({id:'gold-splinters',asset:A.trace02H,burst:6,duration:.23,lifetime:[.12,.23],spawnRadius:2,speed:[110,200],direction:0,spread:360,drag:5,startPx:[9,15],alignToVelocity:true,tint:'#ffd77c',alpha:.48,blend:'add',alphaOverLife:[[0,0],[.12,1],[.5,.55],[1,0]],scaleOverLife:[[0,.5],[.2,1],[1,.25]]})
 ];layers.forEach((l,i)=>{
  l.zIndex=i;
  if(l.scale){l.scale.x*=2;l.scale.y*=2;}
  if(l.type==='particle'){
   l.startScale=l.startScale.map(v=>v*2);
   l.speed=l.speed.map(v=>v*2);
   l.spawn.radius*=2;
  }
 });
 return {id:'hit-basic-burst',duration:.25,sizing:{shape:'custom',widthM:6,heightM:6,authored:{width:60,height:60}},layers};
}
if(require.main===module)console.log(kit.write(make()));
module.exports={make};
