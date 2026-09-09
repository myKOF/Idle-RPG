'use strict';
// 依技能表 J34/K34：白熱尖端、長光尾與交錯包覆能量；保留技能的黃白／黃紅配色。
const kit = require('../preset-kit.cjs');
const { A, sprite, particle } = kit;
function make(id, red, scatter) {
  const edge = red ? '#ff5935' : '#ffd05c';
  const flash = [[0, 0], [0.04, 1], [0.72, 0.95], [0.92, 0.55], [1, 0]];
  const base = { blend: 'add', duration: 0.48, alphaOverLife: flash };
  const layers = [
    sprite({ ...base, id:'aura', asset:A.trace06H, x:58, sizeX:125, sizeY:68, tint:edge, alpha:0.3 }),
    sprite({ ...base, id:'shaft', asset:A.trace02H, x:56, sizeX:126, sizeY:38, tint:edge, alpha:1 }),
    sprite({ ...base, id:'core', asset:A.trace02H, x:60, sizeX:117, sizeY:14, tint:'#fff8dc', alpha:1 }),
    sprite({ ...base, id:'spearhead', asset:A.coneC, x:85, sizeX:23, sizeY:69, rotDeg:-90, tint:edge, alpha:0.95, delay:0.015 }),
    sprite({ ...base, id:'white-tip', asset:A.coneC, x:94, sizeX:10, sizeY:51, rotDeg:-90, tint:'#ffffff', alpha:1, delay:0.025 }),
    sprite({ ...base, id:'needle', asset:A.trace02H, x:62, sizeX:119, sizeY:5, tint:'#ffffff', alpha:1 })
  ];
  // 兩條折返的包覆光帶，沿槍身依序點亮，避免實心幾何槍頭。
  const points = [[18,0],[42,-10],[63,9],[84,-7],[106,0]];
  for(let side of [-1,1]) for(let i=0;i<points.length-1;i++){
    const a=points[i], b=points[i+1], dx=b[0]-a[0], dy=(b[1]-a[1])*side;
    layers.push(sprite({...base,id:'ribbon-'+side+'-'+i,asset:A.trace02H,
      x:(a[0]+b[0])/2,y:(a[1]+b[1])*side/2,sizeX:Math.hypot(dx,dy)*1.3,sizeY:8,
      rotation:Math.atan2(dy,dx),tint:edge,alpha:0.8,delay:0.012*i}));
  }
  for(let i=0;i<4;i++)layers.push(sprite({...base,id:'wake-'+i,asset:A.trace02H,
    x:35+i*7,y:(i%2?1:-1)*(5+i*2),sizeX:65+i*5,sizeY:3,
    rotDeg:(i%2?1:-1)*-5,tint:edge,alpha:0.65,delay:0.018,duration:0.26}));
  if (scatter) layers.push(particle({ id:'splinters',asset:A.trace02H,z:20,
    x:75,tint:'#ffc666',blend:'add',alpha:0.8,burst:7,
    delay:0.07,duration:0.23,lifetime:[0.12,0.22],spawnBox:[70,14],
    speed:[35,85],direction:0,spread:130,drag:3,startPx:[2,5],
    alignToVelocity:true,alphaOverLife:[[0,1],[0.35,0.8],[1,0]],
    scaleOverLife:[[0,1],[1,0.2]] }));
  if (scatter) {
    // 圓環法線沿 +X：槍身穿過環心，側視以直立窄橢圓呈現。
    [[38,27],[66,34],[94,25]].forEach(([x,size],i)=>{
      layers.push(sprite({id:'diffusion-ring-'+i,asset:A.ringThin,
        x,y:0,sizeX:size*0.28,sizeY:size,blend:'add',tint:'#ffb45c',alpha:0.72,
        delay:0.025+i*0.025,duration:0.4,
        alphaOverLife:[[0,0],[0.12,1],[0.35,0.65],[0.7,0.22],[1,0]],
        scaleOverLife:[[0,0.55],[0.35,1],[1,1.45]]}));
    });
  }
  layers.forEach((l,i)=>l.zIndex=i);
  return { id, duration:0.48, layers };
}
function write(){return [kit.write(make('slash-thrust-lance',false,false)),kit.write(make('slash-thrust-empowered',true,false)),kit.write(make('slash-thrust-scatter',true,true))];}
if(require.main===module)console.log(write().join('\n'));
module.exports={make,write};
