'use strict';
const fs=require('fs'),path=require('path'),k=require('../preset-kit.cjs'),core=require('../../../../js/vfx-core.js');
const outline='M92 31 L151 24 L184 67 L172 153 L145 220 L101 231 L71 187 L66 102 Z';
const rune='M110 84 L143 73 L151 107 L121 122 L113 158 L139 174 M121 122 L153 137 M113 158 L97 143';
function assets(out){fs.mkdirSync(out,{recursive:true});const wrap=s=>'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'+s+'</svg>';
fs.writeFileSync(path.join(out,'plate.svg'),wrap('<path d="'+outline+'" fill="#555a59" stroke="#252d30" stroke-width="5" stroke-linejoin="round"/><path d="M92 31 L151 24 L136 49 L100 59 L81 110 L66 102 Z" fill="#bbc0b4"/><path d="M151 24 L184 67 L163 83 L136 49 Z" fill="#90998e"/><path d="M100 59 L136 49 L163 83 L153 145 L130 197 L101 208 L83 171 L81 110 Z" fill="#7e877e"/><path d="M184 67 L172 153 L145 220 L130 197 L153 145 L163 83 Z" fill="#3b4646"/><path d="M71 187 L101 231 L145 220 L130 197 L101 208 L83 171 Z" fill="#626e66"/><path d="M85 96 L105 111 L99 132 M147 52 L140 67 M155 171 L142 183" fill="none" stroke="#49554f" stroke-width="4"/>'));
fs.writeFileSync(path.join(out,'rune.svg'),wrap('<path d="'+rune+'" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'));
fs.writeFileSync(path.join(out,'glow.svg'),wrap('<defs><filter id="g" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7"/></filter></defs><path d="'+rune+'" fill="none" stroke="white" stroke-width="13" filter="url(#g)"/>'));
}
function make(blue=false){const p={schemaVersion:1,id:blue?'aura-earth-reversal':'aura-rockarmor-stone',duration:4,loop:true,sizing:{shape:'circle',radiusM:5,authored:{radius:105}},layers:[]};
for(let i=0;i<6;i++){const phase=i*Math.PI/3,curve=fn=>Array.from({length:16},(_,j)=>[j/15,fn(j/15*Math.PI*2+phase)]);
for(const part of ['plate','glow','rune']){p.layers.push({id:'stone-'+i+'-'+part,type:'sprite',assetId:'codex-authored/rockarmor-objects/'+part+'.png',position:{x:0,y:-30},anchor:{x:.5,y:.5},scale:{x:.25,y:.25},duration:4,zIndex:i*3+['plate','glow','rune'].indexOf(part),blendMode:part==='plate'?'normal':'add',tint:part==='plate'?'#ffffff':part==='rune'?(blue?'#a2ddff':'#ffe4a0'):(blue?'#3c9cff':'#e9ac44'),alpha:part==='glow'?.5:1,offsetXOverLife:curve(a=>Math.cos(a)*80),offsetYOverLife:curve(a=>Math.sin(a)*27),rotationOverLife:curve(a=>Math.cos(a)*.12),scaleXOverLife:curve(a=>.8+.2*Math.abs(Math.cos(a))),scaleYOverLife:curve(a=>.94+.06*Math.sin(a))});}}
return p;}
if(require.main===module){const out=process.argv[2];if(out)assets(out);const p=make();fs.writeFileSync(k.REPO+'/vfx/presets/'+p.id+'.json',core.serialisePreset(p));k.writeRootGroupLayout(p);}module.exports={make,assets};
