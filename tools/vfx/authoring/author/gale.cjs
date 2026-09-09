'use strict';
const kit=require('../preset-kit.cjs');
const {A,sprite,particle,deg}=kit;
function burst(){
  const flash=[[0,0],[0.09,1],[0.28,0.9],[1,0]];
  const base={blend:'add',duration:0.24,alphaOverLife:flash};
  const layers=[
    sprite({...base,id:'amber-halo',asset:A.glowSoft,size:108,tint:'#ffb339',alpha:0.5}),
    sprite({...base,id:'burst-spikes',asset:A.star08,size:136,rotDeg:18,tint:'#ffb844',alpha:1,scaleOverLife:[[0,0.4],[0.17,1],[1,1.12]]}),
    sprite({...base,id:'cross-spikes',asset:A.star08,size:96,rotDeg:-13,tint:'#fff0a3',alpha:0.9}),
    sprite({...base,id:'white-impact',asset:A.star04,size:72,tint:'#ffffff',alpha:1}),
    sprite({...base,id:'hot-core',asset:A.glowSoft,size:32,tint:'#fffdf0',alpha:1})
  ];
  for(let i=0;i<5;i++)layers.push(sprite({...base,id:'fracture-'+i,asset:A.bolt06H,
    x:Math.cos(i*1.25)*24,y:Math.sin(i*1.25)*24,sizeX:48,sizeY:9,
    rotation:i*1.25,tint:'#ffe2a0',alpha:0.55,delay:0.015+i*0.004}));
  layers.push(particle({id:'sparks',asset:A.trace02H,blend:'add',tint:'#ffd475',burst:9,
    duration:0.26,lifetime:[0.09,0.2],spawnRadius:8,speed:[70,160],direction:0,spread:360,
    startPx:[3,7],alignToVelocity:true,drag:4,alphaOverLife:[[0,1],[1,0]],scaleOverLife:[[0,1],[1,0.15]]}));
  layers.forEach((l,i)=>l.zIndex=i);
  return {id:'hit-gale-burst',duration:0.27,sizing:{shape:'custom',widthM:6,heightM:6,authored:{width:120,height:120}},layers};
}
function moon(){
  const base={blend:'add',duration:0.34,alphaOverLife:[[0,0],[0.12,1],[0.62,1],[1,0]],
    rotationOverLife:[[0,deg(-155)],[0.4,deg(-85)],[0.72,deg(-20)],[1,deg(15)]]};
  const layers=[
    sprite({...base,id:'violet-afterimage',asset:A.slash02,sizeX:212,sizeY:180,tint:'#7d36f3',alpha:0.44}),
    sprite({...base,id:'purple-crescent',asset:A.slash02,sizeX:202,sizeY:160,tint:'#aa55ff',alpha:1}),
    sprite({...base,id:'blue-blade',asset:A.slash01,sizeX:196,sizeY:152,tint:'#72bbff',alpha:1}),
    sprite({...base,id:'white-edge',asset:A.slash01,sizeX:190,sizeY:140,tint:'#eef7ff',alpha:1}),
    sprite({...base,id:'swing-trail',asset:A.slash01,x:-18,y:-7,sizeX:204,sizeY:164,tint:'#8058ff',alpha:0.55,delay:0.018,
      rotationOverLife:[[0,deg(-156)],[0.4,deg(-92)],[1,deg(0)]]}),
    sprite({...base,id:'outer-echo',asset:A.slash01,x:-32,y:-12,sizeX:180,sizeY:152,tint:'#577eff',alpha:0.32,delay:0.025,
      rotationOverLife:[[0,deg(-156)],[0.4,deg(-98)],[1,deg(-8)]]}),
    sprite({id:'falling-cut',asset:A.trace02H,x:11,y:12,sizeX:148,sizeY:8,rotDeg:67,
      blend:'add',tint:'#b2e4ff',alpha:0.8,duration:0.23,delay:0.025,
      alphaOverLife:[[0,0],[0.15,1],[1,0]]}),
    particle({id:'blade-fragments',asset:A.trace02H,x:12,y:14,blend:'add',tint:'#9ecaff',
      burst:12,delay:0.025,duration:0.3,lifetime:[0.12,0.24],spawnBox:[36,75],
      speed:[80,160],direction:70,spread:40,startPx:[3,8],alignToVelocity:true,drag:2,
      alphaOverLife:[[0,1],[1,0]],scaleOverLife:[[0,1],[1,0.15]]})
  ];layers.forEach((l,i)=>l.zIndex=i);
  return {id:'slash-gale-moon',duration:0.37,sizing:{shape:'custom',widthM:10,heightM:10,authored:{width:100,height:100,radius:50}},layers};
}
function write(){return [kit.write(burst()),kit.write(moon())];}
if(require.main===module)console.log(write().join('\n'));
module.exports={burst,moon,write};
