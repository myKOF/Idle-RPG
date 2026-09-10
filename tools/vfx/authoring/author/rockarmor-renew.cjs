'use strict';
// Offline stone geometry: a shared atlas keeps the orbit inexpensive in battle.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../../..');
function bake(half){
 const {createCanvas}=require(process.env.VFX_CANVAS_MODULE||'@napi-rs/canvas');
 const cell=192,count=64,atlas=createCanvas(cell*8,cell*8),out=atlas.getContext('2d');
 function polygon(c,pts,fill,stroke){c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1.4;c.stroke();}}
 for(let f=0;f<count;f++){
  const canvas=createCanvas(cell,cell),c=canvas.getContext('2d'),t=f/count*Math.PI*2;
  c.translate(96,96);c.scale(1.65,1.65);
  const plates=Array.from({length:6},(_,i)=>{const a=t+i*Math.PI/3;return{i,a,z:Math.sin(a)};}).sort((a,b)=>a.z-b.z);
  for(const {i,a,z} of plates){
   if(half && (z>=0)!==(half==='front'))continue;
   c.save();c.translate(Math.cos(a)*42,z*14.4+Math.sin(t*2+i)*2);c.scale(.64+.36*Math.abs(Math.cos(a)),.88+.12*z);c.rotate(Math.cos(a)*.16);
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
  for(let i=0;i<7;i++){const a=-t+i*6.28/7;if(half && (Math.sin(a)>=0)!==(half==='front'))continue;c.save();c.translate(Math.cos(a)*52.8,Math.sin(a)*20.4+12);c.rotate(a);polygon(c,[[-2,-3],[2,-2],[3,1],[-1,3]],i%2?'#a99b7e':'#6e6552');c.restore();}
  out.drawImage(canvas,(f%8)*cell,Math.floor(f/8)*cell);
 }
 const id='codex-authored/rockarmor/stone-guard'+(half?'-'+half:'')+'.png',buf=atlas.toBuffer('image/png');
 for(const dir of [root+'/images/vfx/assets',process.env.VFX_LIBRARY_ROOT||require('../../vfx-library-root.cjs').resolveLibraryRoot({}).root]){const dest=path.join(dir,id);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,buf);}
 const ip=root+'/vfx/asset-index.json',index=JSON.parse(fs.readFileSync(ip));
 const entry={assetId:id,package:'codex-authored',relativePath:id,format:'png',fileSize:buf.length,contentHash:'sha256:'+crypto.createHash('sha256').update(buf).digest('hex'),facts:{dimensions:{width:1536,height:1536},hasAlpha:true}};
 const at=index.assets.findIndex(a=>a.assetId===id);if(at<0)index.assets.push(entry);else index.assets[at]=entry;index.assetCount=index.assets.length;fs.writeFileSync(ip,JSON.stringify(index,null,2)+'\n');
 return id;
}
function make(){
 // Preserve editor-approved sizes; both halves share exactly the same pivot and sheet clock.
 const p=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets/aura-rockarmor-stone.json'),'utf8'));
 const body=p.layers.find(l=>l.id==='orbiting-stone-plates'||l.id==='orbiting-stone-plates-back');
 const halves=['back','front'].map(half=>({...body,id:'orbiting-stone-plates-'+half,assetId:'codex-authored/rockarmor/stone-guard-'+half+'.png',position:{x:0,y:-32}}));
 p.layers=p.layers.filter(l=>!l.id.startsWith('orbiting-stone-plates'));
 for(const l of p.layers)l.position={x:0,y:l.id==='amber-underlight'?-2:0};
 p.layers.splice(2,0,...halves);
 return p;
}
if(require.main===module){bake('back');bake('front');console.log(require('../preset-kit.cjs').write(make()));}
module.exports={bake,make};
