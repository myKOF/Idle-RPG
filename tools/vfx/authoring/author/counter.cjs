'use strict';
const kit=require('../preset-kit.cjs');
const {A,sprite,particle}=kit;
function make(){
 const layers=[
  sprite({id:'air-body',asset:A.glowSoft,x:12,sizeX:94,sizeY:46,tint:'#e3edff',alpha:.25,blend:'add'}),
  sprite({id:'pearl-core',asset:A.glowSoft,x:25,sizeX:42,sizeY:32,tint:'#ffffff',alpha:.62,blend:'add'}),
  sprite({id:'pressure-front',asset:A.ringSoft,x:30,sizeX:22,sizeY:54,tint:'#f5f8ff',alpha:.42,blend:'add'})
 ];
 for(let i=0;i<3;i++) layers.push(sprite({id:'ripple-'+i,asset:A.ringThin,x:8-i*23,sizeX:18+i*5,sizeY:62+i*18,tint:'#edf4ff',alpha:.36-i*.08,blend:'add',
  scaleOverLife:[[0,.85],[.5,1.1],[1,.85]],alphaOverLife:[[0,.65],[.35,1],[.7,.75],[1,.65]]}));
 layers.push(particle({id:'air-motes',asset:A.dot,rate:16,lifetime:[.18,.32],spawnBox:[50,34],x:-15,speed:[25,65],direction:180,spread:25,startPx:[1,2.2],tint:'#edf4ff',alpha:.35,blend:'add',alphaOverLife:[[0,0],[.2,.7],[1,0]]}));
 layers.forEach((l,i)=>l.zIndex=i);
 return {id:'proj-counter-ripple',duration:.6,loop:true,sizing:{shape:'circle',radiusM:6,authored:{radius:60}},layers};
}
if(require.main===module)console.log(kit.write(make()));
module.exports={make};
