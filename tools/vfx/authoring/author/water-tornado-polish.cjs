'use strict';
module.exports = function polishWaterTornado(p) {
p.layers.forEach(l=>{l.alpha=+(Math.min(1,l.alpha===undefined?1:l.alpha)*.7).toFixed(4);});
for(const place of ['base','top']) for(const face of ['rear','front']) {
 p.layers.push({id:place+'-cyclone-'+face,type:'procedural',effect:'waterTornado',
  water:{part:'cyclone-'+face,speed:place==='top'?1:1,density:place==='top'?.55:1},
  position:{x:0,y:place==='top'?-115:0},scale:{x:place==='top'?.31:.46,y:place==='top'?.31:.46},
  anchor:{x:.5,y:.5},alpha:.85,tint:'#ffffff',blendMode:'normal',duration:4,zIndex:face==='front'?12:0});
}
return p;
};
