'use strict';
// Bloodblade specification: a red point impact with outward splashes, not a crescent.
const kit = require('../preset-kit.cjs');
const { A, AT, sprite, particle } = kit;
function make() {
  const fade = [[0,0],[0.04,1],[0.55,0.9],[0.8,0.55],[1,0]];
  const layers = [
    sprite({id:'crimson-halo',asset:A.glowSoft,size:100,tint:'#d10a28',alpha:0.28,blend:'add',duration:0.42,alphaOverLife:fade,scaleOverLife:[[0,0.3],[0.25,1],[1,1.1]]}),
    sprite({id:'blood-burst',asset:A.star08,size:125,tint:'#f52232',alpha:1,blend:'add',rotDeg:22,duration:0.52,alphaOverLife:fade,scaleOverLife:[[0,0.15],[0.2,1],[1,1.08]]}),
    sprite({id:'rose-fracture',asset:A.star04,size:82,tint:'#ff4b52',alpha:0.95,blend:'add',rotDeg:-24,duration:0.4,alphaOverLife:fade}),
    sprite({id:'impact-heart',asset:A.glowSoft,size:29,tint:'#ffe0d7',alpha:1,blend:'add',duration:0.05,alphaOverLife:[[0,0],[0.18,1],[1,0]]}),
    particle({id:'blood-droplets',asset:AT.dot,blend:'normal',tint:'#d51c32',burst:19,duration:0.6,lifetime:[0.35,0.6],spawnRadius:7,speed:[300,540],direction:0,spread:360,drag:4,gravity:{x:0,y:140},startPx:[8,16],alphaOverLife:[[0,1],[0.6,0.9],[1,0]],scaleOverLife:[[0,0.6],[0.15,1],[1,0.3]]}),
    particle({id:'hot-splinters',asset:A.trace02H,blend:'add',tint:'#ff4c58',burst:12,duration:0.36,lifetime:[0.18,0.36],spawnRadius:4,speed:[200,340],direction:0,spread:360,drag:5,startPx:[10,22],alignToVelocity:true,alphaOverLife:[[0,1],[0.3,0.8],[1,0]],scaleOverLife:[[0,0.8],[0.2,1],[1,0.15]]})
  ];
  layers.forEach((l,i)=>l.zIndex=i);
  return {id:'hit-bloodblade-burst',duration:0.6,sizing:{shape:'circle',radiusM:6,authored:{radius:60}},layers};
}
if(require.main===module) console.log(kit.write(make()));
module.exports={make};
