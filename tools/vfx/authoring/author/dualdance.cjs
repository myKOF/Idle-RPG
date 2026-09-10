'use strict';
const kit=require('../preset-kit.cjs');
const {A,sprite,particle}=kit;
function make(){
 const fade=[[0,0],[.1,1],[.6,.8],[1,0]];
 const p={id:'slash-dualdance-cross',duration:.36,loop:false,sizing:{shape:'custom',widthM:13,heightM:13,authored:{width:130,height:130}},layers:[
  sprite({id:'gold-blade-body',asset:kit.alphaTwin('particle-pack/png-black-background/slash_02.png'),sizeX:152,sizeY:108,rotDeg:-38,tint:'#e8a323',alpha:1,blend:'normal',duration:.36,alphaOverLife:fade,scaleOverLife:[[0,.7],[.25,1],[1,1.06]]}),
  sprite({id:'ivory-cutting-edge',asset:kit.alphaTwin('particle-pack/png-black-background/slash_02.png'),sizeX:147,sizeY:68,rotDeg:-38,tint:'#fff0a4',alpha:.92,blend:'normal',duration:.3,alphaOverLife:fade,scaleOverLife:[[0,.65],[.23,1],[1,1.1]]}),
  sprite({id:'fine-gold-echo',asset:kit.alphaTwin('particle-pack/png-black-background/slash_02.png'),x:-5,y:7,sizeX:168,sizeY:38,rotDeg:-38,tint:'#e9a62a',alpha:.7,blend:'normal',delay:.025,duration:.25,alphaOverLife:fade}),
  sprite({id:'hot-gold-blade',asset:'particle-pack/png-black-background/slash_02.png',sizeX:149,sizeY:58,rotDeg:-38,tint:'#ffd978',alpha:.52,blend:'add',duration:.24,alphaOverLife:fade,scaleOverLife:[[0,.6],[.2,1],[1,1.08]]}),
  sprite({id:'contact-flash',asset:kit.alphaTwin(A.star04),sizeX:34,sizeY:23,rotDeg:18,tint:'#fff2b0',alpha:.9,blend:'normal',duration:.12,alphaOverLife:[[0,0],[.15,1],[1,0]]}),
  particle({id:'short-gold-sparks',asset:A.trace02H,burst:16,duration:.24,lifetime:[.12,.24],spawnBox:[18,14],speed:[140,290],direction:-35,spread:150,startPx:[14,30],alignToVelocity:true,tint:'#ffd265',alpha:.7,blend:'add',alphaOverLife:[[0,1],[.45,.8],[1,0]],scaleOverLife:[[0,1],[1,.15]]}),
  particle({id:'gold-dust',asset:kit.alphaTwin(A.dot),burst:10,duration:.28,lifetime:[.17,.28],spawnBox:[22,12],speed:[25,65],direction:140,spread:110,startPx:[3,6],tint:'#eab643',alpha:.8,blend:'normal',alphaOverLife:[[0,1],[1,0]]})
 ]};p.layers.forEach((l,i)=>l.zIndex=i);return p;
}
if(require.main===module){const p=make();console.log(kit.write(p));p.id='slash-dual';console.log(kit.write(p));}
module.exports={make};
