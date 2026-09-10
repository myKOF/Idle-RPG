'use strict';
const k=require('../preset-kit.cjs');
function bolt(){
 const layers=[];
 for(const [id,w,tint,alpha] of [['blue-corona',106,'#469fff',.85],['white-core',82,'#effaff',1]]){
  layers.push(k.sprite({id,asset:k.A.bolt05,sizeX:w,sizeY:330,anchor:{x:.5,y:0},y:-330,tint,alpha,blend:'add',duration:.42/1.3,scaleYOverLife:[[0,0],[.4,1],[1,1]],alphaOverLife:[[0,0],[.05,1],[.4,1],[.52,.45],[.62,.9],[1,0]]}));
 }
 layers.push(k.sprite({id:'side-fork',asset:k.A.bolt04,sizeX:110,sizeY:130,x:22,y:-140,tint:'#9baaff',alpha:.48,blend:'add',delay:.08/1.3,duration:.23/1.3,alphaOverLife:k.C.fadeInOut}));
 return {id:'bolt-thunderstrike-bluewhite',duration:.42/1.3,loop:false,layers};
}
function hit(){return {id:'hit-thunderstrike-bluewhite',duration:.48,loop:false,layers:[
 k.sprite({id:'blue-impact-glow',asset:k.A.glowSoft,sizeX:132,sizeY:62,tint:'#388fff',alpha:.8,blend:'add',duration:.36,alphaOverLife:k.C.pop,scaleOverLife:[[0,.3],[.25,1],[1,1.2]]}),
 k.sprite({id:'white-impact-core',asset:k.A.flash,sizeX:65,sizeY:52,y:-8,tint:'#effbff',alpha:1,blend:'add',duration:.2,alphaOverLife:k.C.pop}),
 k.sprite({id:'electric-burst',asset:k.A.bolt04,sizeX:130,sizeY:94,y:-22,tint:'#83d9ff',alpha:1,blend:'add',duration:.36,alphaOverLife:[[0,1],[.3,.8],[.5,1],[1,0]],scaleOverLife:[[0,.35],[.35,1],[1,1.2]]}),
 k.sprite({id:'violet-ground-arcs',asset:k.A.bolt04,sizeX:112,sizeY:36,tint:'#a088ff',alpha:.55,blend:'add',duration:.38,alphaOverLife:k.C.fadeInOut,scaleOverLife:[[0,.3],[.4,1],[1,1.25]]}),
 k.sprite({id:'shock-ring',asset:k.A.ringA,sizeX:140,sizeY:48,tint:'#92d4ff',alpha:.65,blend:'add',duration:.4,alphaOverLife:[[0,.8],[1,0]],scaleOverLife:[[0,.1],[.5,.8],[1,1.15]]})
]};}
if(require.main===module){k.write(bolt());k.write(hit());}
module.exports={bolt,hit};
