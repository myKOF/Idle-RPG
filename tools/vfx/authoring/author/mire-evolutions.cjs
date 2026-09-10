'use strict';
const mire=require('./mire-renew.cjs');
function make(variant){
 const p=mire.make();p.id='ground-mire-'+variant;
 p.layers[0].assetId='codex-authored/mire/mud-flow-'+variant+'.png';
 if(variant==='magma'){
  const k=require('../preset-kit.cjs');
  p.layers.push(k.particle({id:'magma-flames',asset:k.A.flame04,rate:9,maxParticles:14,lifetime:[.45,.9],spawnBox:[100,100],speed:[10,22],direction:-90,spread:8,startPx:[19,30],tint:'#ffb23c',alpha:.72,blend:'add',duration:4,z:1,alphaOverLife:k.C.fadeInOut,scaleOverLife:[[0,.4],[.3,1],[1,.2]]}));
  p.layers.push(k.particle({id:'magma-sparks',asset:k.A.star04,rate:5,maxParticles:8,lifetime:[.5,1],spawnBox:[100,90],speed:[18,32],direction:-90,spread:15,startPx:[3,5],tint:'#ffe39b',alpha:.8,blend:'add',duration:4,z:2,alphaOverLife:k.C.fadeInOut}));
 }
 p.layers.forEach(l=>{l.alpha=(l.alpha===undefined?1:l.alpha)*.3;});
 return p;
}
if(require.main===module){
 for(const v of ['venom','magma'])mire.bake(v);
 const k=require('../preset-kit.cjs');for(const v of ['venom','magma'])k.write(make(v));
}
module.exports={make};
