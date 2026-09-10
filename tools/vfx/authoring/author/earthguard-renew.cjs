'use strict';
// 原創雙三角法陣；先在地平面旋轉，再投影，避免橢圓隨旋轉翻起。
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../../..');
const asset='codex-authored/earthguard/hexagram-orbit.png';
const size=320,count=96;
function draw(c,phase,variant){
 c.save();c.translate(size/2,size/2);c.scale(1,.65);c.rotate(phase);
 const dual=variant==='symbiosis';
 const pulse=.86+.14*Math.cos(phase*12);
 // 透明漸層形成地面溢光；六向排列確保序列首尾仍能無縫相接。
 c.save();c.globalAlpha=pulse;
 const pool=c.createRadialGradient(0,0,12,0,0,157);
 pool.addColorStop(0,'rgba(220,235,255,0.04)');pool.addColorStop(.58,'rgba(220,235,255,0.13)');pool.addColorStop(.86,'rgba(220,235,255,0.04)');pool.addColorStop(1,'rgba(220,235,255,0)');
 c.fillStyle=pool;c.fillRect(-160,-160,320,320);
 for(let i=0;i<6;i++){
  const a=-Math.PI/2+i*Math.PI/3,x=Math.cos(a)*108,y=Math.sin(a)*108;
  const rgb=dual?(i%2?'80,165,255':'255,65,105'):'220,235,255';
  const glow=c.createRadialGradient(x,y,0,x,y,48);
  glow.addColorStop(0,'rgba('+rgb+','+(.43*pulse)+')');glow.addColorStop(.38,'rgba('+rgb+',0.2)');glow.addColorStop(1,'rgba('+rgb+',0)');
  c.fillStyle=glow;c.beginPath();c.arc(x,y,48,0,Math.PI*2);c.fill();
 }
 const rim=c.createRadialGradient(0,0,121,0,0,158);
 rim.addColorStop(0,'rgba(220,235,255,0)');rim.addColorStop(.48,'rgba(220,235,255,0.32)');rim.addColorStop(1,'rgba(220,235,255,0)');
 c.fillStyle=rim;c.beginPath();c.arc(0,0,158,0,Math.PI*2);c.fill();c.restore();
 c.strokeStyle='#f5f8ff';c.lineCap='round';c.lineJoin='round';
 c.shadowColor='#dce8ff';c.shadowBlur=11;
 function circle(r,width){c.lineWidth=width;c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.stroke();}
 if(dual)c.strokeStyle='#67bdff';
 circle(140,1.5);circle(133,.8);
 if(dual)c.strokeStyle='#ff647f';
 circle(99,.8);
 for(let t=0;t<2;t++){
  if(dual)c.strokeStyle=t?'#67bdff':'#ff647f';
  c.lineWidth=2.2;c.beginPath();for(let j=0;j<3;j++){const a=-Math.PI/2+t*Math.PI/3+j*Math.PI*2/3;const x=Math.cos(a)*120,y=Math.sin(a)*120;j?c.lineTo(x,y):c.moveTo(x,y);}c.closePath();c.stroke();
 }
 circle(34,1);circle(29,.6);
 for(let i=0;i<6;i++){
  c.save();c.rotate(i*Math.PI/3);
  if(dual)c.strokeStyle=i%2?'#67bdff':'#ff647f';
  // 六組原創分岔符文與斷開的內環。
  c.lineWidth=1.4;c.beginPath();c.moveTo(0,-124);c.lineTo(0,-130);c.moveTo(-4,-126);c.lineTo(0,-129);c.lineTo(4,-126);c.stroke();
  c.beginPath();c.arc(0,0,88,-Math.PI/2+.09,-Math.PI/2+.35);c.stroke();
  c.beginPath();c.moveTo(0,-45);c.lineTo(4,-50);c.lineTo(0,-55);c.lineTo(-4,-50);c.closePath();c.stroke();
  for(let n=0;n<5;n++){c.save();c.rotate((n-2)*.13);c.lineWidth=.65;c.beginPath();c.moveTo(0,-136);c.lineTo(0,-139);c.stroke();c.restore();}
  c.restore();
 }
 c.restore();
}
function bake(variant){
 const {createCanvas}=require(process.env.VFX_CANVAS_MODULE||'@napi-rs/canvas');
 const atlas=createCanvas(size*8,size*12),c=atlas.getContext('2d');
 const id=variant==='symbiosis'?asset.replace('orbit','symbiosis'):asset;
 // 紅藍雙三角只有三向色彩對稱，因此一個循環轉 120 度並延長兩倍。
 const frames=variant==='symbiosis'?count*2:count;
 const target=frames===count?atlas:createCanvas(size*8,size*24),out=target.getContext('2d');
 for(let f=0;f<frames;f++){out.save();out.translate(f%8*size,Math.floor(f/8)*size);draw(out,f/count*Math.PI/3,variant);out.restore();}
 const buf=target.toBuffer('image/png'),library=require('../../vfx-library-root.cjs').resolveLibraryRoot({}).root;
 for(const base of [root+'/images/vfx/assets',library]){const dest=path.join(base,id);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,buf);}
 const file=root+'/vfx/asset-index.json',index=JSON.parse(fs.readFileSync(file));
 const entry={assetId:id,package:'codex-authored',relativePath:id,format:'png',fileSize:buf.length,contentHash:'sha256:'+crypto.createHash('sha256').update(buf).digest('hex'),facts:{dimensions:{width:size*8,height:size*frames/8},hasAlpha:true}};
 const at=index.assets.findIndex(a=>a.assetId===id);if(at<0)index.assets.push(entry);else index.assets[at]=entry;
 index.assetCount=index.assets.length;fs.writeFileSync(file,JSON.stringify(index,null,2)+'\n');
}
function make(){return {id:'aura-earthguard-hexagram',duration:8,loop:true,sizing:{shape:'circle',radiusM:8,authored:{radius:80}},layers:[{id:'white-hexagram-ground',type:'sprite',assetId:asset,scale:{x:80/140,y:80/140},alpha:.8,blendMode:'add',duration:8,sheet:{columns:8,rows:12,count,mode:'fps',fps:12,loop:true}}]};}
function evolution(variant){
 const p=make();p.id='aura-earthguard-'+variant;const l=p.layers[0];l.id=variant+'-hexagram-ground';
 if(variant==='symbiosis'){
  p.duration=l.duration=16;l.assetId=asset.replace('orbit','symbiosis');l.sheet.rows=24;l.sheet.count=192;
  p.sizing.radiusM=10;p.sizing.authored.radius=100;l.scale.x*=1.25;l.scale.y*=1.25;
 }else l.tint=variant==='life'?'#ffe070':'#62b6ff';
 return p;
}
if(require.main===module){bake();bake('symbiosis');const k=require('../preset-kit.cjs');k.write(make());for(const v of ['life','mana','symbiosis'])k.write(evolution(v));}
module.exports={draw,bake,make,evolution};
