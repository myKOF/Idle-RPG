'use strict';
// Bake the approved procedural construction once; gameplay keeps live particles.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {createCanvas}=require(process.env.VFX_CANVAS_MODULE || '@napi-rs/canvas');
const root=process.cwd();
const gen=require(root+'/js/vfx-water-tornado.js');
const source=JSON.parse(fs.readFileSync(root+'/tools/vfx/authoring/author/water-tornado-source.json'));
source.layers=source.layers.filter(l=>!l.id.includes('cyclone-'));
source.layers.forEach(l=>{if(l.id==='body')l.alpha=1;if(l.id==='bloom')l.alpha=.45;});
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
  fc.globalAlpha=l.alpha??1;fc.globalCompositeOperation=l.blendMode==='add'?'screen':'source-over';for(let y=0;y<320;y++){const q=Math.max(0,Math.min(1,y/160));const taper=.035+.965*Math.pow(q,.8);const w=320*taper;const sway=(1-q)*8*Math.sin(f/80*Math.PI*2+y/45);fc.drawImage(surface,0,y,320,1,(320-w)/2+sway,y,w,1);}
 }
 const bright=fc.getImageData(0,0,320,320);
 for(let i=0;i<bright.data.length;i+=4)for(let c=0;c<3;c++)bright.data[i+c]=Math.min(255,bright.data[i+c]*1.3);
 fc.putImageData(bright,0,0);
 ac.drawImage(frame,(f%10)*256,Math.floor(f/10)*256,256,256);
}

const out=path.join(root,'scratch/fire-taper-preview');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'fire-tip.png'),atlas.toBuffer('image/png'));
const p=JSON.parse(fs.readFileSync(root+'/vfx/presets/fire-tornado-inferno.json'));
const l=p.layers.find(l=>l.id==='baked-fire-column');l.assetId='preview-fire-tip';
const crown=p.layers.find(l=>l.id==='crown-flame-jets');
crown.position.y=-115;crown.spawn.width=5;crown.spawn.height=3;crown.spread=14;crown.emission.rate=24;
const index=JSON.parse(fs.readFileSync(root+'/vfx/asset-index.json'));const byId={};
for(const a of index.assets)byId[a.assetId]='images/vfx/assets/'+a.relativePath;
byId['preview-fire-tip']='scratch/fire-taper-preview/fire-tip.png';
const renderer=require(root+'/tools/vfx/preset-render.cjs'),raster=require(root+'/tools/vfx/vfx-raster.cjs');
const shots=renderer.renderPreset({preset:p,root,index:{byId},size:560,frames:1,bg:'battle',groundLike:true,seed:12345,scale:2.5});
fs.writeFileSync(path.join(out,'preview.png'),raster.encodePng(shots[0].rgba,560,560));
fs.writeFileSync(path.join(out,'candidate.json'),JSON.stringify(p,null,2));
