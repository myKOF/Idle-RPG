'use strict';
const k=require('../preset-kit.cjs');
const crystal='codex-authored/icearrow/icicle.png';
function make(){
 const layers=[
  k.sprite({id:'cold-pressure',asset:k.A.glowSoft,size:175,alpha:.5,tint:'#4cb8ff',blend:'add',duration:.36,scaleOverLife:[[0,.1],[.2,.6],[1,1.3]],alphaOverLife:k.C.pop}),
  k.particle({id:'outward-frost',asset:k.A.smokeT,burst:14,lifetime:[.3,.65],spawnRadius:4,speed:[80,160],direction:0,spread:360,startPx:[36,65],tint:'#89ceee',alpha:.27,blend:'normal',scaleOverLife:[[0,.3],[.5,1],[1,1.5]],alphaOverLife:k.C.fadeInOut})
 ];
 // Long facets grow out of a shared center; irregular lengths avoid a mechanical wheel.
 for(let i=0;i<14;i++){
  const angle=i*360/14+(i%3-1)*5;
  layers.push(k.sprite({id:'radial-crystal-'+i,asset:crystal,anchor:{x:.1,y:.5},sizeX:96+(i%4)*17,sizeY:110+(i%3)*18,rotDeg:angle,z:i%2,delay:(i%3)*.012,duration:1,alpha:.94,tint:i%2?'#b1e7ff':'#e5faff',blend:'normal',scaleXOverLife:[[0,.05],[.12,1],[.62,1],[1,1.06]],scaleYOverLife:[[0,.2],[.12,1],[.62,1],[1,.8]],alphaOverLife:[[0,0],[.06,1],[.62,1],[1,0]]}));
 }
 layers.push(k.particle({id:'flying-ice-splinters',asset:crystal,burst:26,lifetime:[.25,.65],spawnRadius:8,speed:[130,265],direction:0,spread:360,startPx:[15,31],alignToVelocity:true,alpha:.9,blend:'normal',tint:'#bceeff',drag:1.5,scaleOverLife:[[0,.6],[.2,1],[1,.25]],alphaOverLife:[[0,1],[.45,1],[1,0]]}));
 layers.push(k.particle({id:'ice-glints',asset:'particle-pack/png-black-background/star_04.png',burst:18,lifetime:[.2,.55],spawnRadius:12,speed:[90,210],direction:0,spread:360,startPx:[6,13],alpha:.7,tint:'#e1faff',blend:'add',alphaOverLife:k.C.fadeOut}));
 layers.push(k.sprite({id:'white-core',asset:k.A.glowSoft,size:72,alpha:.75,tint:'#ecfcff',blend:'add',z:3,duration:.18,scaleOverLife:[[0,.25],[.2,1],[1,.1]],alphaOverLife:k.C.pop}));
 return {id:'burst-icearrow-crystal',duration:1.05,loop:false,sizing:{shape:'circle',radiusM:6,authored:{radius:150}},layers};
}
if(require.main===module)k.write(make());
module.exports={make};
