'use strict';
const fs=require('fs'),path=require('path'),k=require('../preset-kit.cjs');
// Read the user's current attack geometry, rather than reconstructing a different crescent.
const source=JSON.parse(fs.readFileSync(path.join(k.REPO,'vfx/presets/slash-wind-crescent.json'),'utf8'));
const p={schemaVersion:1,id:'burst-vacuum-shockwave',duration:.6,loop:false,sizing:JSON.parse(JSON.stringify(source.sizing)),layers:[]};
for(const original of source.layers.filter(l=>l.type==='sprite')){
 const l=JSON.parse(JSON.stringify(original));l.id='shock-'+l.id;
 // Each crescent is one travelling pressure front, not another stationary slash.
 l.type='particle';l.delay=0;l.duration=.55;l.emission={mode:'burst',count:1};l.maxParticles=1;
 l.lifetime=.55;l.spawn={shape:'box',width:0,height:0};l.speed=270;l.direction=0;l.spread=0;
 l.startScale=1;delete l.rotationOverLife;
 l.alpha=(l.alpha===undefined?1:l.alpha)*.55;
 l.scaleOverLife=[[0,1],[.5,1.12],[1,1.4]];
 l.alphaOverLife=[[0,0],[.07,1],[.5,.6],[1,0]];

 p.layers.push(l);
}
k.write(p);
