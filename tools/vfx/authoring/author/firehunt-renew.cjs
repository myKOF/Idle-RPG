'use strict';
const k=require('../preset-kit.cjs');
const p=require('./fireball-renew.cjs').make()[0];
p.id='orb-firehunt-solar';
p.sizing={shape:'custom',widthM:4,heightM:4,authored:{width:40,height:40,radius:20}};
for(const l of p.layers){
 if(l.scale){l.scale.x*=.7;l.scale.y*=.7;}
 if(l.startScale)l.startScale=l.startScale.map(v=>v*.65);
 if(l.position){l.position.x*=.65;l.position.y*=.65;}
 if(l.emission?.mode==='rate')l.emission.rate=Math.round(l.emission.rate*.6);
 if(l.id==='molten-heart'){l.alpha=1;l.tint='#fff18a';l.scale.x*=1.25;l.scale.y*=1.25;}
 if(l.id==='rolling-flame-tail'){l.speed=[35,65];l.lifetime=[.16,.3];l.alpha=.62;}
 if(l.id==='surface-flames'){l.emission.rate=12;l.tint='#ff9d22';}
 if(l.id==='trailing-embers'){l.speed=[40,80];l.lifetime=[.15,.3];l.emission.rate=8;}
}
p.layers=p.layers.filter(l=>l.id!=='rolling-flame-tail');
for(const [id,color,size,rate,life] of [['arc-crimson','#ff4208',54,65,.32],['arc-gold','#ffb323',35,55,.24]]) {
 const tail=k.particle({id,asset:k.A.fire01,rate,lifetime:[life,life],spawnBox:[2,3],speed:[0,0],direction:180,spread:0,startPx:[size,size],tint:color,alpha:.75,blend:'add',duration:1,alphaOverLife:[[0,.9],[.35,.85],[1,0]],scaleOverLife:[[0,1],[.45,.75],[1,.08]]});
 tail.worldSpace=true;p.layers.unshift(tail);
}p.layers.forEach((l,i)=>l.zIndex=i);
k.write(p);
k.write({...p,id:'orb-firehunt'});
