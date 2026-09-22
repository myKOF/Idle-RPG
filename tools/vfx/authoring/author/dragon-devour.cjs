'use strict';
const kit = require('../preset-kit.cjs');
const { A, sprite, particle, px } = kit;
const ring=sprite({id:'outer-fire-stream',asset:'codex-authored/dragon-devour/vortex.png',size:350,alpha:.95,blend:'add',duration:8});
ring.scale.x/=2;ring.scale.y/=2;ring.rotationSpeed=Math.PI/4;
kit.write({id:'field-dragon-devour',duration:8,loop:true,layers:[ring,
 particle({id:'rim-embers',asset:A.glowSoft,rate:28,maxParticles:45,lifetime:[.25,.65],spawn:{shape:'circle',radius:142},speed:[8,22],orbitalSpeed:2,startPx:[1,2.5],tint:'#ffb35a',alpha:.7,blend:'add',alphaOverLife:[[0,0],[.15,1],[1,0]],duration:8})],sizing:{shape:'circle',radiusM:15,authored:{radius:150}}});
const tail=particle({id:'curved-flame-trail',asset:A.flame04,x:-6,rate:90,maxParticles:80,lifetime:[.25,.55],spawnRadius:4,speed:[5,20],direction:180,spread:50,startPx:[25,42],rotationStart:[0,6.28],rotationSpeed:[-2,2],alpha:.9,tint:'#ff6419',blend:'screen',scaleOverLife:[[0,.65],[.2,1],[1,.15]],alphaOverLife:[[0,.9],[.4,.75],[1,0]],duration:1});tail.worldSpace=true;
const ember=particle({id:'curved-embers',asset:A.glowSoft,rate:24,maxParticles:30,lifetime:[.3,.6],spawnRadius:5,speed:[6,22],direction:180,spread:70,startPx:[1,3],tint:'#ffad35',alpha:.9,blend:'add',alphaOverLife:[[0,1],[1,0]],duration:1});ember.worldSpace=true;
kit.write({id:'proj-dragon-devour',duration:1,loop:true,layers:[tail,
 particle({id:'rolling-flames',asset:A.fire01,rate:55,maxParticles:22,lifetime:[.12,.25],spawnRadius:5,speed:[2,12],direction:180,spread:120,startPx:[25,39],rotationStart:[0,6.28],rotationSpeed:[-5,5],tint:'#ff8726',alpha:1,blend:'screen',alphaOverLife:[[0,.75],[.25,1],[1,0]],duration:1}),
 particle({id:'hot-flame-tips',asset:A.flame01,rate:36,maxParticles:15,lifetime:[.1,.2],spawnRadius:3,speed:[6,16],spread:180,startPx:[14,23],rotationStart:[0,6.28],tint:'#ffd36d',alpha:.9,blend:'screen',alphaOverLife:[[0,.9],[1,0]],duration:1}),ember],sizing:{shape:'custom',widthM:4.2,heightM:4.2,authored:{width:30,height:30}}});
kit.write({id:'burst-dragon-devour',duration:1,loop:false,layers:[
 particle({id:'blast-flame',asset:A.fire01,burst:24,lifetime:[.3,.65],spawnRadius:9,speed:[45,105],spread:360,startPx:[30,55],rotationStart:[0,6.28],rotationSpeed:[-3,3],tint:'#ff791c',alpha:.9,blend:'screen',scaleOverLife:[[0,.4],[.25,1],[1,.6]],alphaOverLife:[[0,.9],[.3,1],[1,0]],duration:.7}),
 particle({id:'hot-fragments',asset:A.flame04,burst:14,lifetime:[.2,.45],spawnRadius:6,speed:[60,130],spread:360,startPx:[15,30],rotationStart:[0,6.28],tint:'#ffc760',alpha:.95,blend:'screen',alphaOverLife:[[0,1],[1,0]],duration:.5}),
 particle({id:'blast-sparks',asset:A.glowSoft,burst:28,lifetime:[.3,.8],spawnRadius:5,speed:[65,150],spread:360,startPx:[1,3],tint:'#ffba52',alpha:.9,blend:'add',drag:2,alphaOverLife:[[0,1],[1,0]],duration:.8})],sizing:{shape:'circle',radiusM:6,authored:{radius:60}}});



