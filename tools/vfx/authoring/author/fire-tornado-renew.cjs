'use strict';
const kit = require('../preset-kit.cjs');
const p = JSON.parse(JSON.stringify(require('../../../../vfx/presets/field-water-tornado.json')));
p.id = 'field-fire-tornado';
for (const l of p.layers) {
  if (l.water) { l.water.palette = 'fire'; l.water.speed = 1.04; }
  if (l.id === 'body') l.alpha = 1;
  if (l.id === 'bloom') l.alpha = .45;
  if (l.id === 'halo') { l.tint = '#ff6515'; l.alpha = .32; }
  if (l.id === 'dust') { l.tint = '#716055'; l.alpha = .38; l.emission.rate = 20; l.spawn.width = 66; l.startScale = [.035,.07]; }
  if (l.id === 'spray') { l.tint = '#ffbb42'; l.emission.rate = 28; l.direction = -90; l.spread = 55; l.speed = [22, 42]; }
}
p.layers.push(kit.particle({id:'ground-flames',asset:kit.A.flame04,rate:22,lifetime:[.45,.85],
  spawnBox:[62,5],speed:[16,34],direction:-90,spread:40,startPx:[18,32],
  tint:'#ff831e',blend:'add',alpha:.65,duration:4,
  alphaOverLife:[[0,0],[.2,.8],[.55,.55],[1,0]],scaleOverLife:[[0,.5],[.4,1],[1,.25]]}));
p.layers[p.layers.length-1].zIndex=8;
p.layers.push(kit.particle({id:'crown-flame-jets',asset:kit.A.flame04,x:0,y:-99,
  rate:42,lifetime:[.4,.85],spawnBox:[42,9],speed:[22,48],direction:-90,spread:55,
  startPx:[15,28],rotationStart:[-.35,.35],rotationSpeed:[-.3,.3],
  tint:'#ff881f',blend:'add',alpha:.65,duration:4,
  alphaOverLife:[[0,0],[.2,.8],[.5,.6],[1,0]],scaleOverLife:[[0,.6],[.35,1],[1,.15]]}));
p.layers[p.layers.length-1].zIndex=7;
kit.write(p);
// Keep existing spreadsheet references valid while replacing the retired visual.
kit.write({...p, id:'fire-tornado-inferno'});
