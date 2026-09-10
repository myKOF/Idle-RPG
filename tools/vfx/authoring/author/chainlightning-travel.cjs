'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../../..'),id='codex-authored/lightning/chain-travel.png';
async function bake(){
 const {createCanvas,loadImage}=require(process.env.VFX_CANVAS_MODULE||'@napi-rs/canvas');
 const indexFile=root+'/vfx/asset-index.json',index=JSON.parse(fs.readFileSync(indexFile));
 const library=require('../../vfx-library-root.cjs').resolveLibraryRoot({}).root;
 const entry=index.assets.find(a=>a.assetId==='particle-pack/png-black-background/rotated/spark_05_rotated.png');
 const im=await loadImage(fs.readFileSync(path.join(library,entry.relativePath)));
 const base=createCanvas(256,128),b=base.getContext('2d');b.drawImage(im,0,0,256,128);
 // 將黑底電弧轉成透明的藍白發光紋理，保留原圖折線。
 const pixels=b.getImageData(0,0,256,128);
 for(let i=0;i<pixels.data.length;i+=4){let v=pixels.data[i]/255;pixels.data[i]=110+145*v;pixels.data[i+1]=190+65*v;pixels.data[i+2]=255;pixels.data[i+3]=Math.round(v*255);}
 b.putImageData(pixels,0,0);
 const atlas=createCanvas(256*6,128*3),out=atlas.getContext('2d');
 for(let f=0;f<18;f++){
  const c=createCanvas(256,128),x=c.getContext('2d');x.drawImage(base,0,0);
  const head=(f+1)/11*256,tail=head-120;
  const mask=x.createLinearGradient(0,0,256,0);
  for(let n=0;n<=256;n+=4){const a=Math.max(0,Math.min(1,(n-tail)/65,(head-n)/9));mask.addColorStop(n/256,'rgba(255,255,255,'+a+')');}
  x.globalCompositeOperation='destination-in';x.fillStyle=mask;x.fillRect(0,0,256,128);
  out.drawImage(c,f%6*256,Math.floor(f/6)*128);
 }
 const buf=atlas.toBuffer('image/png');
 for(const basePath of [root+'/images/vfx/assets',library]){const dest=path.join(basePath,id);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,buf);}
 const asset={assetId:id,relativePath:id,package:'codex-authored',format:'png',fileSize:buf.length,contentHash:'sha256:'+crypto.createHash('sha256').update(buf).digest('hex'),facts:{dimensions:{width:1536,height:384},hasAlpha:true}};
 const i=index.assets.findIndex(a=>a.assetId===id);if(i<0)index.assets.push(asset);else index.assets[i]=asset;index.assetCount=index.assets.length;fs.writeFileSync(indexFile,JSON.stringify(index,null,2)+'\n');
}
function make(){return {id:'bolt-chain-travel-bluewhite',duration:.3,loop:false,sizing:{shape:'custom',widthM:20,heightM:4,authored:{width:200,height:40}},layers:[{id:'travelling-electric-front',type:'sprite',assetId:id,anchor:{x:0,y:.5},scale:{x:200/256,y:90/128},alpha:1,blendMode:'add',duration:.3,sheet:{columns:6,rows:3,count:18,mode:'fps',fps:60,loop:false}}]};}
if(require.main===module)bake().then(()=>require('../preset-kit.cjs').write(make()));
module.exports={bake,make};
