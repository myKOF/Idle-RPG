'use strict';
const fs=require('fs'),path=require('path'),k=require('../preset-kit.cjs');
function make(){
const source=JSON.parse(fs.readFileSync(path.join(k.REPO,'vfx/presets/slash-wind-crescent.json'),'utf8'));
const p={schemaVersion:1,id:'slash-wind-spin',duration:.48,loop:false,sizing:{shape:'circle',radiusM:6,authored:{radius:272}},layers:[]};
for(let n=0;n<3;n++)for(const original of source.layers.filter(l=>l.type==='sprite')){
 const l=JSON.parse(JSON.stringify(original));l.id='orbit-'+n+'-'+l.id;
 l.position={x:0,y:0};l.rotation=(l.rotation||0)+[0,2.05,4.5][n];
 l.duration=.48;l.delay=0;l.alpha*=.7; l.scale.x*=[1,.82,1.12][n]; l.scale.y*=[1,.82,1.12][n]; l.scaleOverLife=[[0,.65],[.28,1],[1,1.16]];
 l.rotationOverLife=[[0,-.65],[1,Math.PI*2-.65]];
 l.alphaOverLife=[[0,0],[.12,1],[.65,.85],[1,0]];
 p.layers.push(l);
}
for(let n=0;n<2;n++) p.layers.unshift({id:'cyclone-flow-'+n,type:'sprite',assetId:k.A.twirl03,position:{x:0,y:0},anchor:{x:.5,y:.5},scale:{x:(n?.69:.9)*3,y:(n?.69:.9)*3},rotation:n*2.4,alpha:n?.48:.6,tint:n?'#51efd1':'#229ff5',blendMode:'add',duration:.48,rotationOverLife:[[0,0],[1,7.5]],scaleOverLife:[[0,.55],[.3,1],[1,1.18]],alphaOverLife:[[0,0],[.12,1],[.6,.8],[1,0]]});
p.layers.forEach((l,i)=>l.zIndex=i);
return p;
}
if(require.main===module)k.write(make());
module.exports={make};
