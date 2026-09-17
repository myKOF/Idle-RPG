'use strict';
const kit=require('../preset-kit.cjs');
const {A,sprite,particle}=kit;
function make(){
 const duration=.28;
 const grow=[[0,0],[2/7,1],[1,1]];
 const fade=[[0,0],[.12,1],[.38,1],[.62,.65],[1,0]];
 const base={blend:'add',duration,anchor:{x:0,y:.5},sizeX:200,scaleXOverLife:grow,alphaOverLife:fade};
 const layers=[
  sprite({...base,id:'violet-envelope',asset:'particle-pack/png-black-background/rotated/trace_06_rotated.png',sizeY:500,tint:'#7940ff',alpha:.75}),
  sprite({...base,id:'lavender-beam',asset:A.trace02H,sizeY:56,tint:'#c4a0ff',alpha:.8}),
  sprite({...base,id:'white-core',asset:A.trace02H,sizeY:18,tint:'#ffffff',alpha:1}),
  sprite({...base,id:'jagged-upper',asset:A.bolt04,sizeY:100,tint:'#ac77ff',alpha:1,y:-12}),
  sprite({...base,id:'jagged-white',asset:A.bolt04,sizeY:80,tint:'#f1ddff',alpha:1,y:12,
   alphaOverLife:[[0,0],[.15,1],[.3,.35],[.42,1],[.6,.5],[.7,1],[1,0]]}),
  sprite({...base,id:'coil-front',asset:A.bolt04,x:75,sizeX:120,sizeY:90,tint:'#c59aff',alpha:1,delay:.03,duration:.23}),
  sprite({...base,id:'coil-back',asset:A.bolt04,x:8,sizeX:105,sizeY:75,tint:'#ffffff',alpha:.8,delay:.015,duration:.23})
 ];
 for(let i=0;i<3;i++){
  const x=30+i*67,delay=.08*x/200;
  layers.push(particle({id:'electric-motes-'+i,asset:A.bolt06H,blend:'add',x,y:0,
   delay,duration:.14,lifetime:[.055,.12],burst:12,spawnBox:[45,60],speed:[18,45],direction:90,spread:180,
   startPx:[10,22],rotationStart:[-.8,.8],tint:i%2?'#ffffff':'#b998ff',alpha:.95,
   alphaOverLife:[[0,1],[.55,.9],[1,0]],scaleOverLife:[[0,1],[1,.3]]}));
 }
 // 延長 50%，只拉長光束與沿線分布，不放大寬度或單顆粒子。
 layers.forEach((l,i)=>{
  l.zIndex=i;
  if(l.position)l.position.x*=1.5;
  if(l.type==='sprite')l.scale.x*=1.5;
  if(l.spawn&&l.spawn.shape==='box')l.spawn.width*=1.5;
 });
 return {schemaVersion:1,id:'beam-gale-thunder-flash',duration,loop:false,
  sizing:{shape:'custom',widthM:30,heightM:10,authored:{width:300,height:100}},layers};
}
if(require.main===module)console.log(kit.write(make()));
module.exports={make};
