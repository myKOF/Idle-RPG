'use strict';
// Offline stone geometry: a shared atlas keeps the orbit inexpensive in battle.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../../..');
function bake(){
 const {createCanvas}=require(process.env.VFX_CANVAS_MODULE||'@napi-rs/canvas');
 const cell=192,count=64,atlas=createCanvas(cell*8,cell*8),out=atlas.getContext('2d');
 function polygon(c,pts,fill,stroke){c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1.4;c.stroke();}}
 for(let f=0;f<count;f++){
  const canvas=createCanvas(cell,cell),c=canvas.getContext('2d'),t=f/count*Math.PI*2;
  c.translate(96,96);c.scale(1.65,1.65);
  const plates=Array.from({length:6},(_,i)=>{const a=t+i*Math.PI/3;return{i,a,z:Math.sin(a)};}).sort((a,b)=>a.z-b.z);
  for(const {i,a,z} of plates){
   c.save();c.translate(Math.cos(a)*35,z*12+Math.sin(t*2+i)*2);c.scale(.64+.36*Math.abs(Math.cos(a)),.88+.12*z);c.rotate(Math.cos(a)*.16);
   const pts=[[-10,-12],[-5,-19],[7,-17],[13,-8],[11,10],[4,18],[-8,12],[-13,0]];
   const g=c.createLinearGradient(-12,-18,12,18);g.addColorStop(0,z<0?'#8b8270':'#c1ac86');g.addColorStop(.48,'#726855');g.addColorStop(1,'#363936');
   polygon(c,pts,g,'#282b29');
   polygon(c,[[-10,-12],[-5,-19],[7,-17],[2,-9],[-5,-6]],'#c2b492');
   polygon(c,[[7,-17],[13,-8],[11,10],[5,6],[2,-9]],'#514d43');
   polygon(c,[[-13,0],[-5,-6],[5,6],[4,18],[-8,12]],'#82775f');
   c.strokeStyle='#3b3930';c.lineWidth=1.3;c.beginPath();c.moveTo(-8,-10);c.lineTo(0,-5);c.lineTo(-2,2);c.lineTo(5,7);c.lineTo(4,14);c.stroke();
   c.globalAlpha=.55+.22*Math.sin(t*2+i);c.strokeStyle='#edba58';c.lineWidth=1;c.shadowColor='#dfa847';c.shadowBlur=3;
   c.beginPath();c.moveTo(-5,-9);c.lineTo(2,-5);c.lineTo(-1,1);c.lineTo(5,6);c.stroke();
   c.shadowBlur=0;c.globalAlpha=1;
   for(let q=0;q<5;q++){c.fillStyle=q%2?'#aaa080':'#504c40';c.fillRect(Math.sin(i*7+q*3)*7,Math.cos(i*5+q*2)*11,1.3,1.6);}
   c.restore();
  }
  // Small chips share the same orbit, with a slower vertical bob.
  for(let i=0;i<7;i++){const a=-t+i*6.28/7;c.save();c.translate(Math.cos(a)*44,Math.sin(a)*17+12);c.rotate(a);polygon(c,[[-2,-3],[2,-2],[3,1],[-1,3]],i%2?'#a99b7e':'#6e6552');c.restore();}
  out.drawImage(canvas,(f%8)*cell,Math.floor(f/8)*cell);
 }
 const id='codex-authored/rockarmor/stone-guard.png',buf=atlas.toBuffer('image/png');
 for(const dir of [root+'/images/vfx/assets',process.env.VFX_LIBRARY_ROOT||'D:/MyGame/effects-materials']){const dest=path.join(dir,id);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,buf);}
 const ip=root+'/vfx/asset-index.json',index=JSON.parse(fs.readFileSync(ip));
 const entry={assetId:id,package:'codex-authored',relativePath:id,format:'png',fileSize:buf.length,contentHash:'sha256:'+crypto.createHash('sha256').update(buf).digest('hex'),facts:{dimensions:{width:1536,height:1536},hasAlpha:true}};
 const at=index.assets.findIndex(a=>a.assetId===id);if(at<0)index.assets.push(entry);else index.assets[at]=entry;index.assetCount=index.assets.length;fs.writeFileSync(ip,JSON.stringify(index,null,2)+'\n');
 return id;
}
function make(){
 const k=require('../preset-kit.cjs');
 return {id:'aura-rockarmor-stone',duration:4,loop:true,sizing:{shape:'circle',radiusM:5,authored:{radius:50}},layers:[
  k.sprite({id:'earth-shadow',asset:k.alphaTwin(k.A.glowSoft),sizeX:50,sizeY:13,y:0,tint:'#281f13',alpha:.5,blend:'normal',duration:4}),
  k.sprite({id:'amber-underlight',asset:k.A.glowSoft,sizeX:39,sizeY:12,y:-2,tint:'#ba873e',alpha:.22,blend:'add',duration:4,alphaOverLife:[[0,.7],[.5,1],[1,.7]]}),
  {id:'orbiting-stone-plates',type:'sprite',assetId:'codex-authored/rockarmor/stone-guard.png',position:{x:0,y:-13.5},scale:{x:.27,y:.27},zIndex:2,alpha:1,blendMode:'normal',duration:4,sheet:{columns:8,rows:8,count:64,mode:'fps',fps:16,loop:true}},
  k.particle({id:'settling-dust',asset:k.A.smokeT,rate:5,maxParticles:8,lifetime:[.6,1.1],spawnBox:[34,3],speed:[5,12],direction:-90,spread:60,startPx:[6,10.5],tint:'#a18d69',alpha:.24,blend:'normal',duration:4,alphaOverLife:[[0,0],[.3,.6],[1,0]],scaleOverLife:[[0,.5],[1,1.2]]})
 ]};
}
if(require.main===module){bake();console.log(require('../preset-kit.cjs').write(make()));}
module.exports={bake,make};
