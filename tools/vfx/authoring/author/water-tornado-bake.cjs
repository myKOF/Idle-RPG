'use strict';
// Offline rasterisation: gameplay shares the resulting atlas, never generates pixels.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {createCanvas}=require(process.env.VFX_CANVAS_MODULE||'@napi-rs/canvas');
const root=path.resolve(__dirname,'../../../..');
const gen=require(root+'/js/vfx-water-tornado.js');
const core=require(root+'/js/vfx-core.js');
const source=require('./water-tornado-source.json');
const library=require('../../vfx-library-root.cjs').resolveLibraryRoot({libraryId:'effects-materials'}).root;
const side=256,count=80,fps=20,origin={x:128,y:176};
const atlas=createCanvas(side*10,side*8),ac=atlas.getContext('2d');
function paint(ctx,commands){for(const c of commands){const v=c.color;ctx.fillStyle=ctx.strokeStyle=`rgba(${v.slice(0,3).map(x=>Math.round(Math.max(0,Math.min(255,x)))).join(',')},${Math.max(0,Math.min(1,v[3]/255))})`;ctx.beginPath();if(c.ellipse)ctx.ellipse(...c.ellipse,0,0,Math.PI*2);else c.points.forEach((pt,i)=>i?ctx.lineTo(...pt):ctx.moveTo(...pt));if(c.line){ctx.lineWidth=c.line;ctx.stroke();}else{ctx.closePath();ctx.fill();}}}
const layers=source.layers.filter(l=>l.water&&l.enabled!==false).sort((a,b)=>(a.zIndex||0)-(b.zIndex||0));
for(const l of layers)if(l.radiusProfile)for(let i=0;i<64;i++)if(core.radiusProfileScale(l.radiusProfile,(i+.5)/64)!==1)throw Error('Non-identity profile requires a strip raster pass');
for(let f=0;f<count;f++){
 const frame=createCanvas(side,side),fc=frame.getContext('2d');
 for(const l of layers){
  const surface=createCanvas(320,320),ctx=surface.getContext('2d'),temp=createCanvas(320,320);
  const s=gen.sample(l.water.part,f/fps*(l.water.speed||1),l.water.density);
  if(s.pixels){const img=ctx.createImageData(320,320);img.data.set(s.pixels);ctx.putImageData(img,0,0);}
  ctx.save();ctx.scale(.5,.5);paint(ctx,s.commands);ctx.restore();
  const groups=s.blur?[{source:surface,blur:s.blur,alpha:1}]:s.groups;
  if(groups)for(const [i,g] of groups.entries()){
   const n=Math.max(16,Math.min(160,Math.round(320/(1+g.blur))));temp.width=n;temp.height=n;
   const tc=temp.getContext('2d');
   if(g.source)tc.drawImage(g.source,0,0,n,n);else{tc.scale(n/640,n/640);paint(tc,g.commands);}
   if(g.source&&i===0)ctx.clearRect(0,0,320,320);
   ctx.save();ctx.globalAlpha=g.alpha;ctx.globalCompositeOperation=groups.length>1?'lighter':'source-over';ctx.drawImage(temp,0,0,320,320);ctx.restore();
  }
  const sx=l.scale?.x??1,sy=l.scale?.y??1,ax=l.anchor?.x??.5,ay=l.anchor?.y??.5;
  fc.globalAlpha=l.alpha??1;fc.globalCompositeOperation=l.blendMode==='add'?'lighter':'source-over';
  fc.drawImage(surface,origin.x+(l.position?.x||0)-320*sx*ax,origin.y+(l.position?.y||0)-320*sy*ay,320*sx,320*sy);
 }
 ac.drawImage(frame,(f%10)*side,Math.floor(f/10)*side);
}
const id='codex-authored/tornado/water-flow.png',buf=atlas.toBuffer('image/png');
const dest=path.join(library,id);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,buf);
const ip=path.join(root,'vfx/asset-index.json'),index=JSON.parse(fs.readFileSync(ip));
const entry={assetId:id,package:'codex-authored',relativePath:id,format:'png',fileSize:buf.length,contentHash:'sha256:'+crypto.createHash('sha256').update(buf).digest('hex'),facts:{dimensions:{width:side*10,height:side*8},hasAlpha:true}};
const at=index.assets.findIndex(a=>a.assetId===id);if(at<0)index.assets.push(entry);else index.assets[at]=entry;index.assetCount=index.assets.length;fs.writeFileSync(ip,JSON.stringify(index,null,2)+'\n');
const p={...source,layers:source.layers.filter(l=>!l.water).concat([{id:'baked-water-column',type:'sprite',enabled:true,assetId:id,zIndex:1,scale:{x:1,y:1},anchor:{x:origin.x/side,y:origin.y/side},alpha:1,tint:'#ffffff',blendMode:'normal',duration:4,sheet:{columns:10,rows:8,count,mode:'fps',fps,loop:true}}])};
const valid=core.validatePreset(p);if(!valid.ok)throw Error(JSON.stringify(valid));
fs.writeFileSync(path.join(root,'vfx/presets/field-water-tornado.json'),core.serialisePreset(p));
console.log('Baked '+count+' frames; '+buf.length+' bytes; '+dest);
