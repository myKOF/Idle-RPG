'use strict';
const fs=require('fs'),path=require('path'),k=require('../preset-kit.cjs');
const colors={'#469fff':'#a467ff','#effaff':'#faf2ff','#9baaff':'#c092ff','#388fff':'#9650ff','#effbff':'#fcf5ff','#83d9ff':'#d2a3ff','#a088ff':'#b381ff','#92d4ff':'#d0a6ff'};
function make(kind){
 const p=JSON.parse(fs.readFileSync(path.join(k.REPO,'vfx/presets',kind+'-thunderstrike-bluewhite.json'),'utf8'));
 p.id=kind+'-thunderstrike-purplewhite';
 for(const l of p.layers)if(l.tint&&colors[l.tint.toLowerCase()])l.tint=colors[l.tint.toLowerCase()];
 return p;
}
if(require.main===module)for(const kind of ['bolt','hit'])k.write(make(kind));
module.exports={make};
