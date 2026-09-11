'use strict';
const k=require('../preset-kit.cjs'),{A,sprite,particle}=k;
function make(){
 const p={id:'proj-thunderfall-sky',duration:2,loop:true,sizing:{shape:'projectile-circle',authored:{radius:55}},layers:[
  sprite({id:'ion-wake',asset:A.trace02H,x:-110,sizeX:330,sizeY:100,tint:'#4773ed',alpha:.7,blend:'add',duration:2}),
  sprite({id:'blue-corona',asset:A.glowSoft,size:195,tint:'#305aff',alpha:.8,blend:'add',duration:2,scaleOverLife:k.C.breathe(.07)}),
  sprite({id:'dense-core',asset:A.orbObsidian,size:110,tint:'#344c9d',alpha:1,blend:'normal',duration:2,rotationOverLife:k.C.spin(.2)}),
  sprite({id:'charged-shell',asset:k.alphaTwin(A.ringThin),size:102,tint:'#729dff',alpha:.8,blend:'add',duration:2,scaleOverLife:k.C.breathe(.05)}),
  sprite({id:'plasma-heart',asset:A.flare30,size:115,tint:'#c9e3ff',alpha:.58,blend:'add',duration:2,rotationOverLife:k.C.spin(-.17)}),
  particle({id:'surface-forks',asset:A.bolt05H,rate:17,maxParticles:4,lifetime:[.16,.27],spawnRadius:24,speed:[0,6],spread:360,startPx:[85,130],rotationStart:[0,6.28],tint:'#d5eaff',alpha:.85,blend:'add',duration:2,alphaOverLife:[[0,0],[.2,1],[.6,.8],[1,0]]}),
  particle({id:'trailing-charge',asset:A.dot,x:-24,rate:24,maxParticles:14,lifetime:[.25,.5],spawnBox:[16,38],speed:[140,230],direction:180,spread:12,startPx:[2,5],tint:'#7ebeff',alpha:.8,blend:'add',duration:2,alphaOverLife:[[0,0],[.15,1],[1,0]]})
 ]};
 for(let i=0;i<5;i++)p.layers.unshift(sprite({id:'lightning-stream-'+i,asset:A.bolt05H,x:-65-i*26,y:(i-2)*13,sizeX:195+i*22,sizeY:38-i*5,tint:i===1?'#d2e6ff':'#758aff',alpha:.55,blend:'add',duration:2,alphaOverLife:[[0,.55],[.25,1],[.5,.55],[.75,.9],[1,.55]]}));
 const wake=particle({id:'fragmenting-electric-wake',asset:A.bolt05H,x:-55,rate:16,maxParticles:12,lifetime:[.28,.5],spawnBox:[40,48],speed:[60,125],direction:180,spread:18,startPx:[55,115],rotationStart:[-.3,.3],tint:'#a4c9ff',alpha:.48,blend:'add',duration:2,alphaOverLife:[[0,0],[.2,1],[.6,.55],[1,0]],scaleOverLife:[[0,.75],[1,.2]]});
 wake.worldSpace=true;p.layers.unshift(wake);
 p.layers.unshift(sprite({id:'violet-ion-envelope',asset:A.trace02H,x:-145,sizeX:380,sizeY:115,tint:'#6555ed',alpha:.4,blend:'add',duration:2}));
 const h={id:'hit-thunderfall-impact',duration:.7,loop:false,sizing:{shape:'circle',radiusM:15,authored:{radius:150}},layers:[
  sprite({id:'impact-core',asset:A.flash,sizeX:140,sizeY:95,tint:'#d9edff',alpha:.8,blend:'add',duration:.25,alphaOverLife:k.C.pop,scaleOverLife:[[0,.3],[1,1.1]]}),
  sprite({id:'pressure-wave',asset:k.alphaTwin(A.ringThin),sizeX:300,sizeY:125,tint:'#87baff',alpha:.65,blend:'add',duration:.65,scaleOverLife:[[0,.12],[.5,.85],[1,1.2]],alphaOverLife:[[0,0],[.13,1],[.6,.55],[1,0]]}),
  particle({id:'electric-debris',asset:A.dot,burst:18,maxParticles:18,lifetime:[.25,.6],spawnRadius:8,speed:[110,240],spread:360,gravity:{x:0,y:160},startPx:[2,5],tint:'#abd7ff',blend:'add',duration:.65,alphaOverLife:k.C.fadeOut})
 ]};
 for(let i=0;i<7;i++){const a=i*Math.PI*2/7+.15;h.layers.push(sprite({id:'ground-fork-'+i,asset:A.bolt05H,x:Math.cos(a)*63,y:Math.sin(a)*27,sizeX:145,sizeY:29,rotation:a,tint:i%2?'#7697ff':'#d3e5ff',alpha:.6,blend:'add',delay:i%3*.025,duration:.42,scaleOverLife:[[0,.35],[.3,1],[1,1.2]],alphaOverLife:[[0,0],[.18,1],[.5,.75],[1,0]]}));}
 // 寬電弧包住細電流，分開的相位讓尾焰持續翻動而非同步閃爍。
 for(let i=0;i<4;i++)p.layers.unshift(sprite({id:'crown-fork-'+i,asset:A.bolt05H,x:-75-i*32,y:(i%2?1:-1)*(24+i*5),sizeX:240+i*25,sizeY:70-i*7,rotation:(i%2?1:-1)*.13,tint:i%2?'#a8dcff':'#7974ff',alpha:.85,blend:'add',duration:2,alphaOverLife:[[0,.65],[.2+i*.05,1],[.65,.5],[1,.65]],scaleYOverLife:[[0,.75],[.45,1.3],[1,.75]]}));
 p.layers.unshift(sprite({id:'white-current-spine',asset:A.trace02H,x:-100,sizeX:315,sizeY:44,tint:'#d9f2ff',alpha:.85,blend:'add',duration:2}));
 wake.emission.rate=24;wake.maxParticles=16;wake.alpha=.7;wake.startScale=[k.px(80),k.px(150)];
 h.duration=.95;
 h.layers.find(l=>l.id==='pressure-wave').alpha=.95;
 h.layers.find(l=>l.id==='pressure-wave').duration=.85;
 h.layers.unshift(sprite({id:'shockwave-outer',asset:k.alphaTwin(A.ringThin),sizeX:370,sizeY:155,tint:'#6977ff',alpha:.8,blend:'add',delay:.09,duration:.8,scaleOverLife:[[0,.15],[.4,.8],[1,1.15]],alphaOverLife:[[0,0],[.12,1],[.5,.65],[1,0]]}));
 h.layers.unshift(sprite({id:'ground-plasma',asset:A.glowSoft,sizeX:290,sizeY:105,tint:'#496aff',alpha:.8,blend:'add',duration:.7,scaleOverLife:[[0,.2],[.2,1],[1,1.25]],alphaOverLife:[[0,0],[.15,1],[.5,.55],[1,0]]}));
 h.layers.push(particle({id:'upward-discharge',asset:A.bolt05H,burst:7,maxParticles:7,lifetime:[.25,.48],spawnBox:[35,10],speed:[85,180],direction:-90,spread:70,startPx:[65,115],rotationStart:[-2,-1],tint:'#c7eaff',alpha:.7,blend:'add',duration:.6,alphaOverLife:[[0,0],[.15,1],[1,0]],scaleOverLife:[[0,.7],[1,.15]]}));
 for(let i=0;i<8;i++){const a=i*Math.PI/4,vx=Math.cos(a)*190,vy=Math.sin(a)*80;h.layers.push(particle({id:'traveling-ground-arc-'+i,asset:A.bolt05H,burst:2,maxParticles:2,lifetime:[.45,.7],spawnRadius:5,speed:[Math.hypot(vx,vy),Math.hypot(vx,vy)],direction:Math.atan2(vy,vx)*180/Math.PI,spread:8,startPx:[45,80],rotationStart:[a-.2,a+.2],tint:'#94bcff',alpha:.8,blend:'add',duration:.8,alphaOverLife:[[0,0],[.18,1],[.65,.65],[1,0]],scaleOverLife:[[0,.3],[.4,1],[1,.65]]}));}
 [p,h].forEach(p=>p.layers.forEach((l,i)=>l.zIndex=i));return [p,h];
}
if(require.main===module)console.log(make().map(p=>k.write(p)));
module.exports={make};
