'use strict';
const kit = require('../preset-kit.cjs');
const { A, sprite, particle, px } = kit;
/* 漩渦本體（2026-09-22 Claude 依使用者的參考 GIF 重做）：兩張程序化貼圖，產生器與設計紀錄在素材庫
   claude-authored/dragon-devour/（generate-vortex.cjs、SOURCE.md）。全部是 sprite，沒有序列幀、沒有粒子：
   火環與煙渦各用兩份同圖錯速旋轉＋交叉淡化，讓紋理流動而不是整塊剛體旋轉；另兩份煙渦縮小＋加速旋轉做向內吸。
   貼圖的火臂是逆時針往內捲，所以轉速一律為負。轉速取 2π/8 的整數倍，8 秒剛好接回原樣。 */
const VR='claude-authored/dragon-devour/vortex-ring.png',VS='claude-authored/dragon-devour/vortex-smoke.png';
const VK=0.3863,TURN8=-0.7854,PROJ={x:1,y:0.5};         // 貼圖的火環在 u=0.632 → 顯示半徑 125（authored 150 的 0.83 倍）
const vl=(id,assetId,o)=>Object.assign({id,type:'sprite',assetId,scale:{x:VK,y:VK}},o,{projection:PROJ});
const pulse=(a,b)=>[[0,a],[.5,b],[1,a]];
const inflow=(id,rotation,delay)=>vl(id,VS,Object.assign({rotation,alpha:.16,blendMode:'add'},delay?{delay}:{},{duration:2,loop:true,rotationSpeed:3*TURN8,alphaOverLife:[[0,0],[.35,1],[1,0]],scaleOverLife:[[0,1.05],[1,.5]]}));
kit.write({id:'field-dragon-devour',duration:8,loop:true,layers:[
 /* 遊戲裡底下是地面，參考圖的漩渦中心是黑的 */
 {id:'dark-core',type:'sprite',assetId:'light-masks-1.0/transparent/shape_a.png',scale:{x:.62,y:.62},alpha:.85,tint:'#000000',blendMode:'normal',projection:PROJ},
 vl('smoke-swirl',VS,{alpha:1,blendMode:'add',duration:4,loop:true,rotationSpeed:TURN8,alphaOverLife:pulse(.8,.5)}),
 Object.assign(vl('smoke-churn',VS,{rotation:3.1416,alpha:1,blendMode:'add',duration:4,loop:true,rotationSpeed:2*TURN8,alphaOverLife:pulse(.15,.45)}),{scale:{x:.3979,y:.3979}}),
 inflow('inflow-a',1.1,0),inflow('inflow-b',4.2,1),
 vl('fire-ring',VR,{alpha:1,blendMode:'add',duration:2,loop:true,rotationSpeed:2*TURN8,alphaOverLife:pulse(.8,.5)}),
 vl('fire-ring-flicker',VR,{rotation:2.1,alpha:1,blendMode:'add',duration:2,loop:true,rotationSpeed:3*TURN8,alphaOverLife:pulse(.28,.58)}),
 {id:'core-ember',type:'sprite',assetId:'particle-pack/png-black-background/circle_05.png',scale:{x:.045,y:.045},alpha:.5,tint:'#ffb56b',blendMode:'add',duration:1,loop:true,alphaOverLife:pulse(.75,1),scaleOverLife:pulse(.9,1.1),projection:PROJ}
],sizing:{shape:'circle',radiusM:15,authored:{radius:150}}});
const tail=particle({id:'curved-flame-trail',asset:A.flame04,x:-6,rate:90,maxParticles:80,lifetime:[.25,.55],spawnRadius:4,speed:[5,20],direction:180,spread:50,startPx:[25,42],rotationStart:[0,6.28],rotationSpeed:[-2,2],alpha:.9,tint:'#ff6419',blend:'screen',scaleOverLife:[[0,.65],[.2,1],[1,.15]],alphaOverLife:[[0,.9],[.4,.75],[1,0]],duration:1});tail.worldSpace=true;
const ember=particle({id:'curved-embers',asset:A.glowSoft,rate:24,maxParticles:30,lifetime:[.3,.6],spawnRadius:5,speed:[6,22],direction:180,spread:70,startPx:[1,3],tint:'#ffad35',alpha:.9,blend:'add',alphaOverLife:[[0,1],[1,0]],duration:1});ember.worldSpace=true;
kit.write({id:'proj-dragon-devour',duration:1,loop:true,layers:[tail,
 particle({id:'rolling-flames',asset:A.fire01,rate:55,maxParticles:22,lifetime:[.12,.25],spawnRadius:5,speed:[2,12],direction:180,spread:120,startPx:[25,39],rotationStart:[0,6.28],rotationSpeed:[-5,5],tint:'#ff8726',alpha:1,blend:'screen',alphaOverLife:[[0,.75],[.25,1],[1,0]],duration:1}),
 particle({id:'hot-flame-tips',asset:A.flame01,rate:36,maxParticles:15,lifetime:[.1,.2],spawnRadius:3,speed:[6,16],spread:180,startPx:[14,23],rotationStart:[0,6.28],tint:'#ffd36d',alpha:.9,blend:'screen',alphaOverLife:[[0,.9],[1,0]],duration:1}),ember],sizing:{shape:'custom',widthM:4.2,heightM:4.2,authored:{width:30,height:30}}});
kit.write({id:'burst-dragon-devour',duration:1,loop:false,layers:[
 particle({id:'blast-flame',asset:A.fire01,burst:24,lifetime:[.3,.65],spawnRadius:9,speed:[45,105],spread:360,startPx:[30,55],rotationStart:[0,6.28],rotationSpeed:[-3,3],tint:'#ff791c',alpha:.9,blend:'screen',scaleOverLife:[[0,.4],[.25,1],[1,.6]],alphaOverLife:[[0,.9],[.3,1],[1,0]],duration:.7}),
 particle({id:'hot-fragments',asset:A.flame04,burst:14,lifetime:[.2,.45],spawnRadius:6,speed:[60,130],spread:360,startPx:[15,30],rotationStart:[0,6.28],tint:'#ffc760',alpha:.95,blend:'screen',alphaOverLife:[[0,1],[1,0]],duration:.5}),
 particle({id:'blast-sparks',asset:A.glowSoft,burst:28,lifetime:[.3,.8],spawnRadius:5,speed:[65,150],spread:360,startPx:[1,3],tint:'#ffba52',alpha:.9,blend:'add',drag:2,alphaOverLife:[[0,1],[1,0]],duration:.8})],sizing:{shape:'circle',radiusM:6,authored:{radius:60}}});



