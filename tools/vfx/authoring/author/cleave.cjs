'use strict';
const kit = require('../preset-kit.cjs');
const {A,sprite,deg} = kit;
// 原點為揮刀中心；貼圖月牙朝下，旋轉 -90 度後朝向 +X。
function make(id,red) {
  const flash=[[0,0],[0.12,1],[0.58,1],[1,0]];
  const sweep=[[0,deg(-38)],[0.4,deg(-5)],[0.72,deg(14)],[1,deg(28)]];
  const common={blend:'add',rotDeg:-90,duration:0.42,alphaOverLife:flash,rotationOverLife:sweep};
  const edge=red?'#ff4825':'#ff962d';
  return {id,duration:0.46,
    sizing:{shape:'custom',widthM:6,heightM:12,authored:{width:60,height:120,radius:60}},
    layers:[
      sprite({...common,id:'outer-glow',asset:A.slash02,size:190,tint:edge,alpha:0.28}),
      sprite({...common,id:'crescent-body',asset:A.slash02,size:174,tint:edge,alpha:1}),
      sprite({...common,id:'gold-edge',asset:A.slash01,size:167,tint:red?'#ffb638':'#ffe06a',alpha:1,x:3}),
      sprite({...common,id:'white-edge',asset:A.slash01,size:158,tint:'#fff8dd',alpha:0.95,x:6}),
      sprite({...common,id:'inner-trail',asset:A.slash02,size:143,tint:edge,alpha:0.5,x:-4,delay:0.025,
        rotationOverLife:[[0,deg(-52)],[0.55,deg(-10)],[1,deg(8)]]}),
      sprite({...common,id:'afterimage',asset:A.slash01,size:180,tint:edge,alpha:0.24,delay:0.035,
        rotationOverLife:[[0,deg(-65)],[0.5,deg(-26)],[1,deg(4)]]})
    ]};
}
function write(){return [kit.write(make('slash-cleave-arc',false)),kit.write(make('slash-cleave-stun',true))];}
if(require.main===module)console.log(write().join('\n'));
module.exports={make,write};
