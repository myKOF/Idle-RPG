'use strict';
// 地板泥流：固定不規則方形岸線，週期性流場與泥泡只改變表面。
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../../..');
function bake(){
 const {createCanvas,ImageData}=require(process.env.VFX_CANVAS_MODULE||'@napi-rs/canvas');
 const size=256,count=48,atlas=createCanvas(size*8,size*6),out=atlas.getContext('2d');
 const clamp=x=>Math.max(0,Math.min(1,x));
 function hash(x,y){let h=Math.imul(x,374761393)+Math.imul(y,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;}
 function noise(x,y){const a=Math.floor(x),b=Math.floor(y);let u=x-a,v=y-b;u=u*u*(3-2*u);v=v*v*(3-2*v);return (hash(a,b)*(1-u)+hash(a+1,b)*u)*(1-v)+(hash(a,b+1)*(1-u)+hash(a+1,b+1)*u)*v;}
 for(let f=0;f<count;f++){
  const phase=f/count*Math.PI*2,frame=createCanvas(size,size),c=frame.getContext('2d'),buf=new Uint8ClampedArray(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const u=(x-128)/116,v=(y-128)/116;
   const boundary=Math.pow(Math.pow(Math.abs(u),8)+Math.pow(Math.abs(v),8),1/8)+.035*Math.sin(u*19+v*7)+.024*Math.cos(v*25-u*6)+.012*Math.sin(u*55+v*41);
   const a=clamp((.99-boundary)/.06);if(!a)continue;
   const grain=hash(x,y)-.5;
   const wx=u*6+.7*Math.cos(phase)+noise(u*3+7,v*3)*2,wy=v*6+.7*Math.sin(phase)+noise(u*3,v*3+8)*2;
   const flow=(noise(wx,wy)-.5)*3+(noise(wx*2,wy*2)-.5)*.5;
   const ridges=Math.pow(1-Math.abs(noise(wx*1.4+5,wy*1.4)*2-1),15);
   const bank=clamp((boundary-.77)/.13),wet=(1-bank)*(flow*24+ridges*14),shade=bank*(5+noise(u*26,v*26)*18);
   const i=(y*size+x)*4;
   buf[i]=86+wet+shade+grain*3;buf[i+1]=68+wet*.85+shade*.8+grain*3;buf[i+2]=43+wet*.55+shade*.5+grain*2;buf[i+3]=Math.round(a*244);
  }
  c.putImageData(new ImageData(buf,size,size),0,0);
  for(let b=0;b<7;b++){
   const life=(f/count*2+b*.173)%1;if(life>.72)continue;
   const x=128+Math.sin(b*8.3)*76,y=128+Math.cos(b*4.7)*76,r=1+Math.sin(life/.72*Math.PI)*4;
   c.globalAlpha=Math.sin(life/.72*Math.PI)*.52;c.fillStyle='#403324';c.beginPath();c.ellipse(x,y,r,r*.58,0,0,Math.PI*2);c.fill();
   c.strokeStyle='#b29a69';c.lineWidth=.8;c.beginPath();c.ellipse(x,y-1,r,r*.58,0,Math.PI,Math.PI*1.85);c.stroke();
  }
  out.drawImage(frame,(f%8)*size,Math.floor(f/8)*size);
 }
 const id='codex-authored/mire/mud-flow.png',buf=atlas.toBuffer('image/png');
 const library=require('../../vfx-library-root.cjs').resolveLibraryRoot({}).root;
 for(const base of [root+'/images/vfx/assets',library]){const dest=path.join(base,id);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,buf);}
 const p=root+'/vfx/asset-index.json',index=JSON.parse(fs.readFileSync(p));
 const entry={assetId:id,package:'codex-authored',relativePath:id,format:'png',fileSize:buf.length,contentHash:'sha256:'+crypto.createHash('sha256').update(buf).digest('hex'),facts:{dimensions:{width:2048,height:1536},hasAlpha:true}};
 const at=index.assets.findIndex(a=>a.assetId===id);if(at<0)index.assets.push(entry);else index.assets[at]=entry;
 index.assetCount=index.assets.length;fs.writeFileSync(p,JSON.stringify(index,null,2)+'\n');
}
function make(){return {id:'ground-mire-earth',duration:4,loop:true,sizing:{shape:'rectangle',widthM:10,heightM:10,authored:{width:120,height:120}},layers:[
 {id:'flowing-earth-mud',type:'sprite',assetId:'codex-authored/mire/mud-flow.png',scale:{x:120/256,y:120/256},alpha:1,blendMode:'normal',duration:4,sheet:{columns:8,rows:6,count:48,mode:'fps',fps:12,loop:true}}
]};}
if(require.main===module){bake();require('../preset-kit.cjs').write(make());}
module.exports={bake,make};
