'use strict';
const k=require('../preset-kit.cjs'),{A,sprite,particle}=k;
function make(){
 const [p,h]=require('./fireball-renew.cjs').make();
 p.id='proj-meteor-inferno';p.sizing={shape:'custom',widthM:14,heightM:14,authored:{width:60,height:60}};
 p.layers=p.layers.filter(l=>!['molten-heart','ember-shell','surface-flames'].includes(l.id));
 const tail=p.layers.find(l=>l.id==='rolling-flame-tail');tail.lifetime=[.35,.65];tail.speed=[180,280];tail.position={x:-20,y:0};
 p.layers.unshift(particle({id:'smoke-wake',asset:A.smokeT,rate:12,duration:1,lifetime:[.7,1.05],x:-30,spawnBox:[15,25],speed:[140,210],direction:180,spread:18,startPx:[48,82],rotationStart:[0,6.28],tint:'#554440',alpha:.48,blend:'normal',alphaOverLife:[[0,0],[.2,.7],[1,0]],scaleOverLife:[[0,.5],[1,1.3]]}));
 p.layers.push(sprite({id:'meteor-flame-halo',asset:A.fire01,size:110,tint:'#ff6c0c',alpha:1,blend:'add',duration:1,alphaOverLife:[[0,.8],[.3,1],[.7,.85],[1,.8]],rotationOverLife:[[0,0],[1,.5]]}));
 p.layers.push(sprite({id:'meteor-halo-gold-rim',asset:k.alphaTwin(A.ringThin),size:72,tint:'#ffb72c',alpha:.9,blend:'add',duration:1,alphaOverLife:[[0,.85],[.5,1],[1,.85]]}));
 p.layers.push(sprite({id:'cracked-meteor-core',asset:'codex-authored/meteor/meteor-stylized.png',size:23.4,tint:'#ffffff',alpha:1,blend:'screen'}));
 // 分散的表面火舌各自生成與消退，岩石底圖不跟著閃爍。
 for(const [i,x,y,dir] of [[0,-12,-15,-55],[1,8,-10,-135],[2,-5,7,-35],[3,14,15,-115],[4,-17,15,-70]]){
  p.layers.push(particle({id:'lava-flow-'+i,asset:A.flame04,x,y,rate:7,duration:1,lifetime:[.28,.5],spawnBox:[5,4],speed:[30,50],direction:180,spread:10,startPx:[10,19],rotationStart:[-.7,.7],rotationSpeed:[-.5,.5],tint:'#ff9d24',alpha:.25,blend:'add',alphaOverLife:[[0,0],[.3,.8],[.65,.6],[1,0]],scaleOverLife:[[0,.4],[.4,1],[1,.2]]}));
 }
 h.id='burst-meteor-inferno';h.duration=.7;h.sizing={shape:'custom',widthM:30,heightM:30,authored:{width:120,height:120}};
 h.layers.unshift(sprite({id:'ground-heat-wave',asset:k.alphaTwin(A.ringThin),sizeX:125,sizeY:62,tint:'#e97726',alpha:.7,blend:'normal',duration:.55,alphaOverLife:[[0,0],[.12,1],[1,0]],scaleOverLife:[[0,.15],[.45,1],[1,1.4]]}));
 h.layers.push(particle({id:'ascending-impact-flames',asset:A.flame04,burst:9,duration:.5,lifetime:[.25,.5],spawnBox:[42,15],speed:[70,145],direction:-90,spread:75,startPx:[40,75],rotationStart:[-.6,.6],tint:'#ff8a25',alpha:.65,blend:'add',alphaOverLife:[[0,0],[.2,1],[1,0]],scaleOverLife:[[0,.7],[.4,1],[1,.3]]}));
 for(let i=0;i<12;i++){
  const a=i*Math.PI/6,vx=Math.cos(a)*155,vy=Math.sin(a)*75,v=Math.hypot(vx,vy);
  h.layers.push(particle({id:'expanding-fire-wave-'+i,asset:A.flame04,burst:2,delay:.04,duration:.58,lifetime:[.45,.58],spawnBox:[4,3],speed:[v*.9,v],direction:Math.atan2(vy,vx)*180/Math.PI,spread:8,startPx:[25,38],rotationStart:[0,6.28],tint:'#ff931f',alpha:.65,blend:'add',alphaOverLife:[[0,0],[.18,.9],[.65,.75],[1,0]],scaleOverLife:[[0,.35],[.45,1],[1,.7]]}));
 }
 [p,h].forEach(x=>x.layers.forEach((l,i)=>l.zIndex=i));return [p,h];
}
if(require.main===module)console.log(make().map(p=>k.write(p)));
module.exports={make};
