'use strict';
const k=require('../preset-kit.cjs');
function make(){
 const p={schemaVersion:1,id:'orb-void-disc',duration:1,loop:true,sizing:{shape:'projectile-circle',radiusM:3,authored:{radius:240}},layers:[]};
 const add=(id,asset,scale,tint,alpha,rotation,turn)=>p.layers.push({id,type:'sprite',assetId:asset,zIndex:p.layers.length,position:{x:0,y:0},anchor:{x:.5,y:.5},scale:{x:scale,y:scale},tint,alpha,rotation,blendMode:'add',duration:1,rotationOverLife:[[0,0],[1,-turn*Math.PI*2]]});
 add('outer-green-flow',k.A.twirl03,.96,'#30e982',.7,0,2);
 add('blue-edge-current',k.A.twirl03,1.02,'#559fff',.28,1.7,2);
 add('return-green-flow',k.A.twirl03,.85,'#65ffc0',.6,Math.PI,2);
 add('white-cutting-current',k.A.twirl02,.76,'#eaffee',.88,.8,2);
 add('inner-green-vortex',k.A.twirl03,.55,'#5bff91',.8,2.3,3);
 add('inner-white-current',k.A.twirl02,.44,'#f1fff4',.8,4.5,3);
 // Uneven flow widths and offset pivots give the rotating silhouette a loose cyclone outline.
 const shapes=[ [1.04,.97,.5,.5], [1.03,.98,.5,.5], [.97,1.02,.5,.5], [1.02,.98,.5,.5], [1.03,.98,.5,.5], [1,.99,.5,.5] ];
 p.layers.forEach((l,i)=>{const a=shapes[i];l.scale.x*=a[0];l.scale.y*=a[1];l.anchor={x:a[2],y:a[3]};});
 return p;
}
if(require.main===module)k.write(make());module.exports={make};
