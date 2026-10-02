'use strict';
// 可重製的透明向量冰漩渦，保存至已配置素材庫，再經 Scanner／Export 匯出。
const fs=require('fs'),path=require('path');
const root=require('../../vfx-library-root.cjs').resolveLibraryRoot().root;
const parts=[];
for(let arm=0;arm<3;arm++){
  const points=[];
  for(let i=0;i<=100;i++){
    const t=i/100,r=14+92*t,a=arm*Math.PI*2/3+t*Math.PI*2.2;
    points.push((128+Math.cos(a)*r).toFixed(2)+','+(128+Math.sin(a)*r).toFixed(2));
  }
  parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="#a7edff" stroke-width="4" stroke-linecap="round" opacity=".85"/>`);
}
for(let i=0;i<8;i++){
 const a=i*Math.PI/4,r=105,x=128+Math.cos(a)*r,y=128+Math.sin(a)*r;
 parts.push(`<path d="M ${x.toFixed(2)} ${(y-7).toFixed(2)} l 4 7 -4 7 -4 -7 Z" fill="#d8f8ff" opacity=".65"/>`);
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><radialGradient id="mist"><stop stop-color="#c8f5ff" stop-opacity=".04"/><stop offset=".65" stop-color="#5abbf2" stop-opacity=".12"/><stop offset="1" stop-color="#77d8ff" stop-opacity="0"/></radialGradient></defs><circle cx="128" cy="128" r="120" fill="url(#mist)"/>${parts.join('')}</svg>\n`;
const target=path.join(root,'codex-authored/water-tide/ice-merge-vortex.svg');
fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,svg);
console.log('Saved codex-authored/water-tide/ice-merge-vortex.svg to configured library.');
