'use strict';
const k=require('../preset-kit.cjs'),{A,sprite,particle}=k;
function make(){
 const fire={id:'proj-fireball-ember',duration:1,loop:true,sizing:{shape:'custom',widthM:6,heightM:6,authored:{width:60,height:60}},layers:[
  particle({id:'rolling-flame-tail',asset:A.flame04,rate:36,duration:1,lifetime:[.18,.38],spawnBox:[20,22],x:-16,speed:[110,200],direction:180,spread:22,startPx:[45,72],rotationStart:[-.6,.6],rotationSpeed:[-1.5,1.5],tint:'#ff6a13',alpha:.72,blend:'add',alphaOverLife:[[0,0],[.15,.9],[.55,.6],[1,0]],scaleOverLife:[[0,.6],[.25,1],[1,.15]]}),
  sprite({id:'ember-shell',asset:A.fire01,size:73,tint:'#ff651a',alpha:.8,blend:'add'}),
  sprite({id:'molten-heart',asset: k.alphaTwin(A.dot),size:40,tint:'#ffcf64',alpha:.95,blend:'normal'}),
  particle({id:'surface-flames',asset:A.flame04,rate:20,duration:1,lifetime:[.12,.25],spawnBox:[20,24],speed:[15,40],direction:180,spread:90,startPx:[30,46],rotationStart:[0,6.28],tint:'#ffb82e',alpha:.6,blend:'add',alphaOverLife:[[0,0],[.3,1],[1,0]]}),
  particle({id:'trailing-embers',asset:k.alphaTwin(A.dot),rate:17,duration:1,lifetime:[.2,.4],x:-20,spawnBox:[20,26],speed:[130,230],direction:180,spread:34,startPx:[2,5],tint:'#ffa52b',alpha:.85,blend:'normal',alphaOverLife:[[0,1],[1,0]]})
 ]};
 const hit={id:'hit-fireball-rupture',duration:.48,loop:false,sizing:{shape:'custom',widthM:12,heightM:12,authored:{width:120,height:120}},layers:[
  particle({id:'dark-smoke-puffs',asset:A.smokeT,burst:7,duration:.48,lifetime:[.3,.48],spawnBox:[22,18],speed:[35,85],direction:-90,spread:240,startPx:[40,70],rotationStart:[0,6.28],tint:'#594543',alpha:.48,blend:'normal',alphaOverLife:[[0,0],[.3,.65],[1,0]],scaleOverLife:[[0,.4],[1,1.2]]}),
  particle({id:'orange-fire-lobes',asset:A.fire01,burst:8,duration:.36,lifetime:[.2,.36],spawnBox:[24,20],speed:[55,135],direction:0,spread:360,startPx:[40,76],rotationStart:[0,6.28],rotationSpeed:[-2,2],tint:'#ff6c16',alpha:.65,blend:'add',alphaOverLife:[[0,0],[.12,.85],[.5,.7],[1,0]],scaleOverLife:[[0,.5],[.3,1],[1,.7]]}),
  sprite({id:'brief-hot-core',asset:A.fire01,size:62,tint:'#ffd176',alpha:.75,blend:'add',duration:.13,alphaOverLife:[[0,0],[.18,1],[1,0]]}),
  particle({id:'flying-sparks',asset:A.trace02H,burst:13,duration:.4,lifetime:[.18,.4],spawnBox:[14,14],speed:[110,250],direction:0,spread:360,startPx:[10,25],alignToVelocity:true,tint:'#ffb840',alpha:.85,blend:'add',alphaOverLife:[[0,1],[1,0]],scaleOverLife:[[0,1],[1,.1]]})
 ]};[fire,hit].forEach(p=>p.layers.forEach((l,i)=>l.zIndex=i));return [fire,hit];
}
if(require.main===module)console.log(make().map(p=>k.write(p)));
module.exports={make};
