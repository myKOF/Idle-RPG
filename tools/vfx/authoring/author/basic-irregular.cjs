'use strict';
// Original asymmetric fragments, composed with particle randomness at playback.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'../../../..');
const shapes=[
 'M30 72 L5 26 L39 43 L47 6 L59 43 L100 15 L79 52 L120 63 L77 75 L93 110 L60 85 L39 122 L40 84 L10 99 Z',
 'M37 51 L19 8 L57 41 L88 4 L74 46 L123 29 L89 66 L115 102 L72 86 L62 124 L47 86 L7 110 L28 73 L3 57 Z'
];
const assetIds=shapes.map((d,i)=>'codex-authored/impact/crimson-fragment-'+i+'.svg');
function assets(){
 const indexPath=path.join(repo,'vfx/asset-index.json'),idx=JSON.parse(fs.readFileSync(indexPath));
 shapes.forEach((d,i)=>{
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="'+d+'" fill="#ff173c"/><path d="'+d+'" transform="translate(64 64) scale(.70) translate(-64 -64)" fill="#ffb4b2"/><path d="'+d+'" transform="translate(64 64) scale(.49) translate(-64 -64)" fill="#fff9ee"/></svg>';
  const dest=path.join('D:/MyGame/effects-materials',assetIds[i]);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,svg);
  const record={assetId:assetIds[i],package:'codex-authored',relativePath:assetIds[i],format:'svg',fileSize:Buffer.byteLength(svg),contentHash:'sha256:'+crypto.createHash('sha256').update(svg).digest('hex'),facts:{dimensions:{width:128,height:128},hasAlphaChannel:true},tags:['impact','red','fragment']};
  idx.assets=idx.assets.filter(a=>a.assetId!==record.assetId);idx.assets.push(record);
 });idx.assetCount=idx.assets.length;fs.writeFileSync(indexPath,JSON.stringify(idx,null,2)+'\n');
}
assets();
const kit=require('../preset-kit.cjs');
const {A,particle}=kit;
function make(){
 const fade=[[0,0],[.1,1],[.45,.8],[1,0]];
 const layers=[
  particle({id:'broken-gold-body',asset:assetIds[0],burst:2,duration:.25,lifetime:[.15,.23],spawnBox:[19,13],speed:[8,38],direction:0,spread:360,startScale:[.28,.52],rotationStart:[0,Math.PI*2],rotationSpeed:[-1.2,1.2],tint:'#ffffff',alpha:.95,blend:'normal',alphaOverLife:fade,scaleOverLife:[[0,.3],[.2,1],[1,1.12]]}),
  particle({id:'ivory-fractures',asset:assetIds[1],burst:1,duration:.25,lifetime:[.09,.17],spawnBox:[12,9],speed:[0,20],direction:0,spread:360,startScale:[.24,.42],rotationStart:[0,Math.PI*2],rotationSpeed:[-1,1],tint:'#ffffff',alpha:.95,blend:'normal',alphaOverLife:fade,scaleOverLife:[[0,.25],[.18,1],[1,.75]]}),
  particle({id:'long-gold-splinters',asset:A.trace02H,burst:5,duration:.25,lifetime:[.13,.25],spawnBox:[8,6],speed:[90,280],direction:0,spread:360,startPx:[18,43],alignToVelocity:true,tint:'#ff263d',alpha:.65,blend:'add',drag:5,alphaOverLife:fade,scaleOverLife:[[0,.5],[.2,1],[1,.2]]}),
  particle({id:'uneven-chips',asset:kit.alphaTwin(A.star04),burst:6,duration:.25,lifetime:[.12,.25],spawnBox:[9,6],speed:[60,230],direction:0,spread:360,startPx:[3,10],rotationStart:[0,Math.PI*2],rotationSpeed:[-6,6],gravity:{x:0,y:70},drag:4,tint:'#ff827b',alpha:.85,blend:'normal',alphaOverLife:[[0,1],[.5,.8],[1,0]],scaleOverLife:[[0,1],[1,.2]]})
 ];layers.forEach((l,i)=>l.zIndex=i);
 return {id:'hit-basic-irregular',duration:.25,sizing:{shape:'custom',widthM:6,heightM:6,authored:{width:60,height:60}},layers};
}
if(require.main===module)console.log(kit.write(make()));
module.exports={make};
