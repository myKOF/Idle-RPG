'use strict';
const k=require('../preset-kit.cjs');
function projectile(){
 const drops=k.particle({id:'water-droplet-trail',asset:k.A.bubbleSoap,rate:160,maxParticles:120,lifetime:[.24,.55],spawnRadius:8,speed:[15,48],direction:180,spread:35,startPx:[7,16],alpha:.8,tint:'#38ffe0',blend:'normal',scaleOverLife:[[0,1],[1,.25]],alphaOverLife:k.C.fadeOut});drops.worldSpace=true;drops.position={x:-27,y:0};
 return {id:'proj-waterball-flow',duration:1.2,loop:true,sizing:{shape:'custom',widthM:5.6,heightM:3.6,authored:{width:90,height:58}},layers:[
 k.sprite({id:'soft-water-light',asset:k.A.glowSoft,size:85,alpha:.25,tint:'#00d9b5',blend:'add'}),drops,
 k.sprite({id:'tapered-water-tail',asset:k.A.bubble,sizeX:58,sizeY:37,x:-20,alpha:.72,tint:'#0ecbad',blend:'normal'}),
 k.sprite({id:'flowing-water-body',asset:k.A.bubble,sizeX:84,sizeY:54,x:8,alpha:.9,tint:'#0ecbad',blend:'normal',scaleXOverLife:[[0,1],[.25,1.07],[.5,.97],[.75,1.04],[1,1]],scaleYOverLife:[[0,1],[.25,.94],[.5,1.05],[.75,.97],[1,1]]}),
 k.sprite({id:'clear-water-surface',asset:k.A.bubbleSoap,sizeX:80,sizeY:50,x:10,alpha:.5,tint:'#bcfff0',blend:'add',rotation:0})]};
}
function hit(){return {id:'hit-waterball-splash',duration:.85,loop:false,sizing:{shape:'circle',radiusM:3,authored:{radius:100}},layers:[
 k.sprite({id:'water-impact-glow',asset:k.A.glowSoft,size:100,alpha:.45,tint:'#33ffdb',blend:'add',duration:.25,alphaOverLife:k.C.pop,scaleOverLife:[[0,.2],[1,1.3]]}),
 k.sprite({id:'spreading-water-ring',asset:k.A.ringThin,sizeX:510,sizeY:270,alpha:.7,tint:'#a4ffec',blend:'add',duration:.5,scaleOverLife:[[0,.08],[.5,.8],[1,1.1]],alphaOverLife:k.C.fadeOut}),
 k.particle({id:'splash-droplets',asset:k.A.bubbleSoap,burst:50,lifetime:[.25,.6],spawnRadius:3,speed:[100,200],direction:0,spread:360,gravity:{x:0,y:140},drag:1.3,startPx:[7,17],alpha:.85,tint:'#50efcb',blend:'normal',scaleOverLife:[[0,1],[1,.25]],alphaOverLife:[[0,1],[.65,.8],[1,0]]}),
 k.sprite({id:'outer-pressure-ring',asset:k.A.ringThin,sizeX:660,sizeY:390,alpha:.65,tint:'#22eec7',blend:'add',delay:.07,duration:.65,scaleOverLife:[[0,.1],[.6,.9],[1,1.15]],alphaOverLife:k.C.fadeOut}),
 k.particle({id:'foam-sparks',asset:k.A.sparkle4,burst:18,lifetime:[.2,.55],spawnRadius:5,speed:[100,215],direction:0,spread:360,startPx:[10,23],alpha:.75,tint:'#d4fff4',blend:'add',alphaOverLife:k.C.fadeOut}),
 k.particle({id:'water-spray',asset:k.A.smokeT,burst:16,lifetime:[.25,.55],spawnRadius:8,speed:[65,125],direction:0,spread:360,startPx:[24,42],alpha:.2,tint:'#60ddc3',blend:'normal',scaleOverLife:[[0,.3],[1,1.4]],alphaOverLife:k.C.fadeOut})]};}
if(require.main===module){k.write(projectile());k.write(hit());}
module.exports={projectile,hit};
