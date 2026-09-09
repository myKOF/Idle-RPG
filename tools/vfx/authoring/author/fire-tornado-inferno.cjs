'use strict';
// 64 looping frames: irregular elliptical streamlines form a hollow fire vortex.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const repo=path.resolve(__dirname,'../../../../');
const assetId='codex-authored/tornado/inferno-spiral.svg';
function atlas(){
 const n=v=>v.toFixed(2);
 let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="2048" viewBox="0 0 1536 2048"><defs><radialGradient id="aura"><stop stop-color="#ff9b16" stop-opacity=".23"/><stop offset=".55" stop-color="#df4a07" stop-opacity=".13"/><stop offset="1" stop-color="#7f1908" stop-opacity="0"/></radialGradient></defs>';
 for(let f=0;f<64;f++){
  const phase=f/64*Math.PI*2;
  svg+=`<g transform="translate(${f%8*192} ${Math.floor(f/8)*256})"><ellipse cx="96" cy="137" rx="63" ry="111" fill="url(#aura)"/>`;
  // Broad, oblique crown and ground vortex, built from stretched spiral filaments.
  for(const cap of [{y:32,tilt:-.19,base:24,range:57},{y:225,tilt:.04,base:23,range:54}]){
   for(let s=0;s<26;s++){
    const pts=[],radius=cap.base+s/25*cap.range;
    for(let j=0;j<=84;j++){
     const a=j/84*Math.PI*2+phase+s*.19;
     const r=radius+(j/84-.5)*6+1.3*Math.sin(a*5+s*.8-phase);
     pts.push([96+Math.cos(a)*r,cap.y+Math.sin(a)*r*.24+Math.cos(a)*r*cap.tilt]);
    }
    const d='M'+pts.map(p=>p.map(n).join(' ')).join('L');
    const fade=Math.pow(1-s/29,1.4)*.45;
    svg+=`<path d="${d}" fill="none" stroke="#f56e10" stroke-width="3" opacity="${n(fade*.075)}"/><path d="${d}" fill="none" stroke="${s<9?'#ffd251':'#eb741c'}" stroke-width="${n(.4+(1-s/26)*.65)}" opacity="${n(fade*.5)}"/>`;
   }
  }
  // Each ring is a moving streamline: a local bulge travels up independently of the tilt.
  for(let back=0;back<2;back++)for(let k=0;k<47;k++){
   const u=k/46,y=29+u*200;
   const neck=16+56*Math.pow(1-u,6)+32*Math.pow(u,10);
   const radius=Math.min(79,neck*(1+.19*Math.sin(y*.066+phase)+.12*Math.sin(y*.113-phase*2)));
   const cx=96+11*Math.sin(y*.022+phase)*(Math.sin(Math.PI*u))+5*Math.sin(Math.PI*u*2);
   const cy=y+3.5*Math.sin(k*.43+phase);
   const tilt=.07*Math.sin(k*.21-phase);
   for(let strand=0;strand<5;strand++){
    const points=[];
    for(let j=0;j<=28;j++){
     const a=(back?0:Math.PI)+j/28*Math.PI;
     const twist=a-phase*(1+strand%2)+k*.39+strand*2.1;
     const r=radius+(strand-2)*.9+3.1*Math.sin(twist*3)+1.1*Math.sin(twist*7+k*.4);
     points.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r*.3+Math.cos(a)*r*tilt+2.4*Math.sin(twist*2)]);
    }
    const d='M'+points.map(p=>p.map(n).join(' ')).join('L');
    const heat=.5+.5*Math.sin(k*.58+phase+strand);
    const focus=.28+.72*Math.pow(Math.sin(Math.PI*u),1.4);
    const color=back?(u>.23&&u<.85?(strand%2?'#ffec65':'#ffcb27'):(strand===1?'#dc8c23':'#b75312')):'#a64a0b';
    const opacity=(back?(.46+heat*.3):.25)*focus;
    const bandWeight=[1.15,.85,1,1.1,.9][k%5];
    svg+=`<path d="${d}" fill="none" stroke="#ee650a" stroke-width="${n(4+heat)}" opacity="${n((back?.1:.04)*focus)}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${n((.45+heat*.65)*bandWeight)}" opacity="${n(opacity)}" stroke-linecap="round"/>`;
   }
  }
  // One continuous golden helix; depth and taper vary gently along its length.
  const goldPoint=t=>{
   const y=62+t*145,u=(y-29)/200,a=t*Math.PI*9+phase;
   const r=(18+5*Math.sin(y*.066+phase)+3*Math.sin(y*.113-phase*2))*(1+.28*Math.cos(t*Math.PI*2));
   return {x:96+11*Math.sin(y*.022+phase)*Math.sin(Math.PI*u)+5*Math.sin(Math.PI*u*2)+Math.cos(a)*r,y:y+Math.sin(a)*r*.3,z:Math.sin(a)};
  };
  for(let j=0;j<220;j++){
   const t=j/220,p=goldPoint(t),q=goldPoint((j+1)/220);
   const taper=Math.pow(Math.sin(Math.PI*t),.55),front=(p.z+1)/2;
   const width=(1.1+2.1*front+.7*Math.sin(t*19+phase))*taper;
   const d=`M${n(p.x)} ${n(p.y)}L${n(q.x)} ${n(q.y)}`;
   svg+=`<path d="${d}" fill="none" stroke="#ffbd12" stroke-width="${n(width+5)}" opacity="${n(.17*taper)}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${front>.45?'#ffe84c':'#d99012'}" stroke-width="${n(width)}" opacity="${n((.35+.6*front)*taper)}" stroke-linecap="round"/>`;
  }
  // Sparse fine filaments curve with the vortex instead of becoming large flickering flames.
  for(let k=0;k<25;k++){
   const u=(k/25+f/64)%1,y=230-u*199,r=12+51*Math.pow(u,4)+27*Math.pow(1-u,9),a=phase+u*17+k*2.4;
   const x=96+Math.cos(a)*r,alpha=Math.sin(Math.PI*u)*.45;
   svg+=`<path d="M${n(x)} ${n(y)} q${n(Math.sin(a)*9)} -9 ${n(Math.sin(a+1)*7)} -20" fill="none" stroke="#ffb44b" stroke-width=".7" opacity="${n(alpha)}"/>`;
  }
  svg+='</g>';
 }
 return svg+'</svg>';
}

function author(){
 const svg=atlas(),library='D:/MyGame/effects-materials';
 const dest=path.join(library,assetId);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,svg);
 const shipped=path.join(repo,'images/vfx/assets',assetId);fs.mkdirSync(path.dirname(shipped),{recursive:true});fs.writeFileSync(shipped,svg);
 const indexPath=path.join(repo,'vfx/asset-index.json'),index=JSON.parse(fs.readFileSync(indexPath));
 const record={assetId,package:'codex-authored',relativePath:assetId,format:'svg',fileSize:Buffer.byteLength(svg),contentHash:'sha256:'+crypto.createHash('sha256').update(svg).digest('hex'),facts:{dimensions:{width:1536,height:2048},hasAlphaChannel:true},tags:['fire','tornado','sequence']};
 index.assets=index.assets.filter(a=>a.assetId!==assetId);index.assets.unshift(record);index.assetCount=index.assets.length;fs.writeFileSync(indexPath,JSON.stringify(index,null,2)+'\n');
 const kit=require('../preset-kit.cjs'),{A,sprite,particle}=kit;
 const layers=[
  particle({id:'ground-dust',asset:A.smokeT,blend:'normal',tint:'#756050',alpha:.2,y:1,rate:7,lifetime:[.8,1.3],spawnBox:[55,5],speed:[10,24],direction:-90,spread:155,drag:1.1,startPx:[20,33],alphaOverLife:[[0,0],[.25,.6],[.6,.4],[1,0]],scaleOverLife:[[0,.6],[1,1.5]]}),
  sprite({id:'ground-heat',asset:A.glowSoft,y:0,sizeX:135,sizeY:42,tint:'#c65010',alpha:.26,blend:'add'}),
  particle({id:'ground-fire-licks',asset:A.flame05,blend:'add',tint:'#ed731c',alpha:.28,y:0,rate:9,lifetime:[.45,.8],spawnBox:[76,5],speed:[12,25],direction:-90,spread:70,drag:1.4,startPx:[11,20],alphaOverLife:[[0,0],[.25,.65],[.7,.4],[1,0]],scaleOverLife:[[0,.5],[.4,1],[1,.2]]}),
  sprite({id:'spiral-column',asset:assetId,y:-112,scale:1,blend:'normal',sheet:{columns:8,rows:8,count:64,mode:'fps',fps:25.6,loop:true}}),
  particle({id:'ascending-flame',asset:A.flame05,blend:'add',tint:'#ff6913',alpha:.3,y:-7,rate:16,lifetime:[.7,1.1],spawnBox:[24,8],speed:[130,200],direction:-90,spread:22,drag:.4,startPx:[16,28],alphaOverLife:[[0,0],[.18,.7],[.65,.6],[1,0]],scaleOverLife:[[0,.65],[.5,1],[1,.15]]}),
  particle({id:'surface-flames',asset:A.flame04,blend:'add',tint:'#ff6512',alpha:.1,y:-125,rate:12,lifetime:[.6,1],spawnBox:[75,145],speed:[30,65],direction:-90,spread:45,startPx:[18,35],alphaOverLife:[[0,0],[.2,.7],[.5,.5],[1,0]],scaleOverLife:[[0,.3],[.4,1],[1,.1]]}),
  particle({id:'lifting-embers',asset:A.dot,blend:'add',tint:'#ffd17a',rate:14,lifetime:[.9,1.4],spawnBox:[74,12],speed:[110,190],direction:-90,spread:25,gravity:{x:12,y:-25},startPx:[1.5,3.2],alphaOverLife:[[0,0],[.1,1],[.8,.8],[1,0]],scaleOverLife:[[0,1],[1,.3]]})
 ];layers.forEach((l,i)=>l.zIndex=i);
 return kit.write({id:'fire-tornado-inferno',duration:2.5,loop:true,sizing:{shape:'custom',widthM:6,heightM:12,authored:{width:120,height:240,radius:60}},layers});
}
if(require.main===module)console.log(author());
module.exports={atlas,author};
