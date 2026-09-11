'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../../..');
const asset='codex-authored/icearrow/icicle.png';
// Single forward-facing faceted icicle. Motion and fog are runtime transforms/particles.
function bake(){
 const {createCanvas}=require(process.env.VFX_CANVAS_MODULE||'@napi-rs/canvas');
 const canvas=createCanvas(512,512),c=canvas.getContext('2d');
 function facet(points,color){c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();}
 const tip=[491,256],top=[143,209],bottom=[139,305],back=[49,267],ridge=[180,249];
 c.shadowColor='#58cfff';c.shadowBlur=10;
 facet([tip,top,[83,231],back,bottom],'#57a6d4');c.shadowBlur=0;
 facet([tip,top,ridge],'#e4fbff');
 facet([tip,ridge,bottom],'#68b8e4');
 facet([top,[83,231],ridge],'#b6edff');
 facet([[83,231],back,ridge],'#5187b6');
 facet([back,bottom,ridge],'#89d3f3');
 facet([tip,[202,262],ridge],'#f6ffff');
 facet([bottom,[238,279],ridge],'#aedff5');
 c.lineWidth=2;c.strokeStyle='rgba(242,255,255,.85)';c.beginPath();c.moveTo(...back);c.lineTo(...ridge);c.lineTo(...tip);c.stroke();
 c.lineWidth=1;c.strokeStyle='rgba(221,251,255,.65)';c.beginPath();c.moveTo(118,224);c.lineTo(185,249);c.lineTo(151,287);c.moveTo(202,239);c.lineTo(243,255);c.lineTo(216,282);c.stroke();
 const buf=canvas.toBuffer('image/png'),library=require('../../vfx-library-root.cjs').resolveLibraryRoot({}).root;
 for(const base of [root+'/images/vfx/assets',library]){const dest=path.join(base,asset);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,buf);}
 const file=root+'/vfx/asset-index.json',index=JSON.parse(fs.readFileSync(file));
 const entry={assetId:asset,package:'codex-authored',relativePath:asset,format:'png',fileSize:buf.length,contentHash:'sha256:'+crypto.createHash('sha256').update(buf).digest('hex'),facts:{dimensions:{width:512,height:512},hasAlpha:true}};
 const at=index.assets.findIndex(a=>a.assetId===asset);if(at<0)index.assets.push(entry);else index.assets[at]=entry;
 index.assetCount=index.assets.length;fs.writeFileSync(file,JSON.stringify(index,null,2)+'\n');
 console.log('icicle.png: '+buf.length+' bytes, single frame');
}
function projectile(){
 const k=require('../preset-kit.cjs');
 const mist=k.particle({id:'world-ice-mist',asset:k.A.smokeT,x:-28,z:-2,rate:172,maxParticles:96,lifetime:[.2,.42],spawnRadius:4,speed:[10,28],direction:180,spread:35,startPx:[14,24],alpha:.3,tint:'#92d8ff',blend:'add',scaleOverLife:[[0,.4],[.5,1],[1,1.4]],alphaOverLife:[[0,0],[.15,.6],[.5,.35],[1,0]],rotationStart:[0,6.28],rotationSpeed:[-.6,.6]});
 mist.worldSpace=true;
 const grains=k.particle({id:'ice-grains',asset:k.A.star04,x:-20,z:-1,rate:72,maxParticles:40,lifetime:[.15,.32],spawnRadius:5,speed:[8,30],direction:180,spread:55,startPx:[2,5],alpha:.7,tint:'#c8f4ff',blend:'add',alphaOverLife:k.C.fadeOut,scaleOverLife:[[0,1],[1,.15]]});grains.worldSpace=true;
 return {id:'proj-icearrow-frost',duration:1.2,loop:true,sizing:{shape:'custom',widthM:6,heightM:2,authored:{width:68,height:16}},layers:[
 mist,grains,
 k.sprite({id:'cold-halo',asset:k.A.glowSoft,sizeX:82,sizeY:30,tint:'#369ddd',alpha:.24,blend:'add',duration:1.2}),
 k.sprite({id:'faceted-icicle',asset,size:78,alpha:1,blend:'normal',z:2,duration:1.2})
 ]};
}
function hit(){
 const k=require('../preset-kit.cjs');
 return {id:'hit-icearrow-shatter',duration:.48,loop:false,layers:[
 k.sprite({id:'cold-flash',asset:k.A.glowSoft,size:72,alpha:.65,tint:'#65caff',blend:'add',duration:.25,alphaOverLife:k.C.pop,scaleOverLife:[[0,.3],[1,1.1]]}),
 k.particle({id:'ice-fragments',asset,burst:9,lifetime:[.18,.4],spawnRadius:2,speed:[65,145],direction:0,spread:360,startPx:[12,25],alpha:1,blend:'normal',rotationStart:[0,6.28],rotationSpeed:[-5,5],alphaOverLife:[[0,1],[.6,1],[1,0]],scaleOverLife:[[0,1],[1,.45]]}),
 k.particle({id:'impact-frost',asset:k.A.smokeT,burst:6,lifetime:[.18,.42],spawnRadius:4,speed:[22,55],direction:0,spread:360,startPx:[19,32],tint:'#a4dfff',alpha:.3,blend:'add',scaleOverLife:[[0,.4],[1,1.5]],alphaOverLife:k.C.fadeOut})
 ]};
}
if(require.main===module){bake();const k=require('../preset-kit.cjs');k.write(projectile());k.write(hit());}
module.exports={bake,projectile,hit};
