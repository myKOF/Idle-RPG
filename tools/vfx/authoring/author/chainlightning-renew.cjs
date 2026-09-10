'use strict';
const k=require('../preset-kit.cjs');
function make(){
 const main='particle-pack/png-black-background/rotated/spark_05_rotated.png';
 const filament=k.A.bolt06H,anchor={x:0,y:.5};
 const pulse=[[0,0],[.04,1],[.22,.7],[.34,1],[.55,.55],[1,0]];
 return {id:'bolt-chain-bluewhite',duration:.28,loop:false,sizing:{shape:'custom',widthM:20,heightM:4,authored:{width:200,height:40}},layers:[
  k.sprite({id:'blue-corona',asset:main,sizeX:200,sizeY:110,anchor,tint:'#268dff',alpha:.8,blend:'add',duration:.28,alphaOverLife:pulse,z:0}),
  k.sprite({id:'white-hot-zigzag',asset:main,sizeX:200,sizeY:90,anchor,tint:'#eaf8ff',alpha:1,blend:'add',duration:.28,alphaOverLife:pulse,z:1}),
  k.sprite({id:'blue-flicker-filaments',asset:filament,sizeX:200,sizeY:48,anchor,tint:'#74caff',alpha:.5,blend:'add',duration:.24,delay:.025,alphaOverLife:[[0,0],[.08,1],[.25,.1],[.42,.85],[1,0]],z:2})
 ]};
}
if(require.main===module)k.write(make());
module.exports={make};
