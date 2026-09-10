'use strict';
// Bake the approved procedural construction once; gameplay keeps live particles.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {createCanvas}=require(process.env.VFX_CANVAS_MODULE || '@napi-rs/canvas');
const root=path.resolve(__dirname,'../../../..');
const gen=require(root+'/js/vfx-water-tornado.js');
const source=JSON.parse(fs.readFileSync(root+'/vfx/presets/field-fire-tornado.json'));
if(!source.layers.some(l=>l.water))throw Error('Run fire-tornado-renew.cjs before baking');
const atlas=createCanvas(2560,2048),ac=atlas.getContext('2d');
function paint(ctx,commands){for(const c of commands){const v=c.color;ctx.fillStyle=ctx.strokeStyle=`rgba(${v.slice(0,3).map(x=>Math.round(Math.max(0,Math.min(255,x)))).join(',')},${Math.max(0,Math.min(1,v[3]/255))})`;ctx.beginPath();if(c.ellipse)ctx.ellipse(...c.ellipse,0,0,Math.PI*2);else c.points.forEach((pt,i)=>i?ctx.lineTo(...pt):ctx.moveTo(...pt));if(c.line){ctx.lineWidth=c.line;ctx.stroke();}else{ctx.closePath();ctx.fill();}}}
for(let f=0;f<80;f++){
 const frame=createCanvas(320,320);
 const fc=frame.getContext('2d');fc.clearRect(0,0,320,320);
 for(const l of source.layers.filter(l=>l.water).sort((a,b)=>a.zIndex-b.zIndex)){
  const surface=createCanvas(320,320),temp=createCanvas(320,320);
  const s=gen.sample(l.water.part,f/20,1,'fire'),ctx=surface.getContext('2d');ctx.resetTransform();ctx.clearRect(0,0,320,320);
  if(s.pixels){const img=ctx.createImageData(320,320);img.data.set(s.pixels);ctx.putImageData(img,0,0);}
  ctx.save();ctx.scale(.5,.5);paint(ctx,s.commands);ctx.restore();
  const groups=s.groups||(s.blur?[{source:surface,blur:s.blur,alpha:1}]:null);
  if(groups)groups.forEach((g,i)=>{const tc=temp.getContext('2d');tc.resetTransform();tc.clearRect(0,0,320,320);if(g.source)tc.drawImage(g.source,0,0);else{tc.save();tc.scale(.5,.5);paint(tc,g.commands);tc.restore();}if(i===0)ctx.clearRect(0,0,320,320);ctx.save();ctx.filter=`blur(${g.blur/2}px)`;ctx.globalAlpha=g.alpha;ctx.globalCompositeOperation=groups.length>1?'lighter':'source-over';ctx.drawImage(temp,0,0);ctx.restore();});
  fc.globalAlpha=l.alpha??1;fc.globalCompositeOperation=l.blendMode==='add'?'screen':'source-over';fc.drawImage(surface,0,0);
 }
 const bright=fc.getImageData(0,0,320,320);
 for(let i=0;i<bright.data.length;i+=4)for(let c=0;c<3;c++)bright.data[i+c]=Math.min(255,bright.data[i+c]*1.3);
 fc.putImageData(bright,0,0);
 ac.drawImage(frame,(f%10)*256,Math.floor(f/10)*256,256,256);
}
const id='codex-authored/tornado/fire-flow.png',buf=atlas.toBuffer('image/png');
for(const dir of [root+'/images/vfx/assets','D:/MyGame/effects-materials']){const dest=path.join(dir,id);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,buf);}
const ip=root+'/vfx/asset-index.json',index=JSON.parse(fs.readFileSync(ip));
const entry={assetId:id,package:'codex-authored',relativePath:id,format:'png',fileSize:buf.length,contentHash:'sha256:'+crypto.createHash('sha256').update(buf).digest('hex'),facts:{dimensions:{width:2560,height:2048},hasAlpha:true}};
const at=index.assets.findIndex(a=>a.assetId===id);if(at<0)index.assets.push(entry);else index.assets[at]=entry;index.assetCount=index.assets.length;fs.writeFileSync(ip,JSON.stringify(index,null,2)+'\n');
const kit=require('../preset-kit.cjs');
const baked={...source,layers:source.layers.filter(l=>!l.water).concat([{id:'baked-fire-column',type:'sprite',assetId:id,zIndex:1,scale:{x:.5,y:.5},anchor:{x:.5,y:.9296875},alpha:1,blendMode:'normal',duration:5,sheet:{columns:10,rows:8,count:80,mode:'fps',fps:16,loop:true}}]),duration:5};
const fps=20*source.layers.find(l=>l.water).water.speed;
baked.duration=80/fps;
baked.layers.forEach(l=>{
 l.duration=baked.duration;
 if(l.sheet)l.sheet.fps=fps;
 else if(l.tint)l.tint='#'+l.tint.slice(1).match(/../g).map(v=>Math.min(255,Math.round(parseInt(v,16)*1.3)).toString(16).padStart(2,'0')).join('');
});
kit.write(baked);kit.write({...baked,id:'fire-tornado-inferno'});
console.log('Baked 80 frames, '+buf.length+' bytes');
