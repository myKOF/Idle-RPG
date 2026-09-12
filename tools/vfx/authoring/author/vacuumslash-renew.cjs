'use strict';
const k=require('../preset-kit.cjs');
function make(){
const p={schemaVersion:1,id:'slash-wind-crescent',duration:.42,loop:false,layers:[],sizing:{shape:'custom',widthM:6,heightM:6,authored:{width:110,height:110}}};
// Blades share the trailing tip; their leading tips fan out during the reverse sweep.
for(let i=0;i<3;i++){
 const size=122-i*15;
 p.layers.push(k.sprite({id:'crescent-blade-'+i,asset:k.A.slash03,
  x:0,y:43,anchor:{x:.47,y:.93},sizeX:size,sizeY:size*.94,rotDeg:(i-1)*12,
  alpha:i===0?.85:.7,tint:['#258fff','#25d5e8','#52f7a8'][i],blend:'add',z:i,
  duration:.36,scaleOverLife:[[0,.6],[.2,1],[1,1.12]],
  rotationOverLife:[[0,-.2],[.75,0],[1,.3]],alphaOverLife:[[0,0],[.12,1],[.55,.85],[1,0]]}));
}
p.layers.push(k.sprite({id:'fine-inner-edge',asset:k.A.slash03,x:0,y:43,anchor:{x:.47,y:.93},sizeX:77,sizeY:87,rotDeg:10,tint:'#b8ffe0',alpha:.3,blend:'add',z:3,duration:.32,rotationOverLife:[[0,-.2],[.75,0],[1,.3]],alphaOverLife:[[0,0],[.16,1],[1,0]],scaleOverLife:[[0,.6],[.2,1],[1,1.12]]}));
p.layers.push(k.particle({id:'wind-fragments',asset:'particle-pack/png-transparent/spark_01.png',x:18,burst:16,lifetime:[.16,.32],spawnBox:[12,60],speed:[25,60],direction:175,spread:35,startPx:[2,4],tint:'#62edca',alpha:.5,blend:'add',alphaOverLife:k.C.fadeOut}));
// Move each sprite pivot to the same actor centre without moving its rest geometry.
for(const l of p.layers.filter(l=>l.type==='sprite')) {
 const a=l.rotation||0,dx=-29,dy=-43;
 l.anchor.x+=(Math.cos(a)*dx+Math.sin(a)*dy)/(l.scale.x*512);
 l.anchor.y+=(-Math.sin(a)*dx+Math.cos(a)*dy)/(l.scale.y*512);
 l.position={x:0,y:0};
 l.duration=.36;
 l.scaleOverLife=[[0,1],[1,1]];
 l.rotationOverLife=[[0,-.65],[1,.65]];
}
p.layers.find(l=>l.id==='wind-fragments').zIndex=4;
return p;
}
module.exports={make};
if(require.main===module)k.write(make());
