'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const {createRequire}=require('module');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
function simulation(){
 const file=path.join(__dirname,'skill2-waterball-frostnova-legendary.test.cjs'),src=fs.readFileSync(file,'utf8');
 const h={require:createRequire(file),__dirname,console};vm.createContext(h);
 vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',h);return h;
}
function setup(gid,stage,ult){
 const h=simulation(),c=h.c,p=h.playerEnt();p.pos={x:0,y:0};p.mp=10000;c.FIELD.player=p;
 for(const other of ['icearrow','waterball','frostnova']){
  h.maxLevels(c,other);h.setUlt(c,other,c.SKILLS2[other].ult[0].id,1);
 }
 h.setLevels(c,gid,Array.from({length:7},(_,i)=>i<stage?(ult?10:1):0));
 if(ult)h.setUlt(c,gid,ult,1);else delete c.G.player.skills2.ult[gid];
 h.equip(c,gid);c.chance=()=>false;c.Math.random=()=>.999;
 const es=[h.enemy(1e9,50,0,'A'),h.enemy(1e9,80,0,'B'),h.enemy(1e9,-50,0,'C')];
 const hits=h.stubHits(c),specs=h.stubVfx(c),emit=c.sgEmitVfx;
 c.sgEmitVfx=function(gid,...args){const start=specs.length;emit(gid,...args);specs.slice(start).forEach(s=>s.testGid=gid);};
 return {h,c,p,es,hits,specs};
}
function roles(s){return Object.keys(s.vfx||{}).sort();}
for(const gid of ['icearrow','waterball','frostnova']){
 const ids={icearrow:['absoluteZeroBurst','infiniteIceRift','tearsOfIce'],waterball:['waterPrisonFall','ragingTide','abyssBurial'],frostnova:['infiniteNova','crystalResonance','iceKingDomain']}[gid];
 for(const [stage,ult] of [...Array.from({length:7},(_,i)=>[i+1,null]),...ids.map(id=>[7,id])]){
  test('WATER-ICE-AUDIT: '+gid+'/'+(ult||stage)+' keeps its own body and additional roles',()=>{
   const {h,c,p,es,hits,specs}=setup(gid,stage,ult);
   assert.ok(c.castSkill2(p,es,gid,'mv-float'));h.advance(c,p,es,1.6);
   assert.ok(hits.length,'actual damage');assert.ok(specs.length,'actual events');
   assert.ok(specs.every(s=>s.testGid===gid),'other learned trees cannot dispatch from this cast');
   if(gid==='icearrow'){
    assert.ok(specs.some(s=>/^ice-arrow/.test(s.variant)));
    for(const s of specs.filter(s=>/^ice-arrow/.test(s.variant))){
     assert.equal(s.vfx.projectile,'proj-icearrow-frost');assert.ok(!s.vfx.attack&&!s.vfx.ground&&!s.vfx.field);
    }
    assert.ok(!specs.some(s=>s.variant==='blizzard'||s.variant==='water-tornado'));
    if(ult==='tearsOfIce'){
     const rain=specs.filter(s=>s.variant==='ice-rain');assert.ok(rain.length);
     rain.forEach(s=>{assert.deepEqual(roles(s),['projectile']);assert.equal(s.vfx.projectile,'proj-icearrow-frost');assert.equal(s.travelMs[0],350);assert.equal(s.hit,false);});
    }
   }else if(gid==='waterball'){
    const launches=specs.filter(s=>s.variant==='waterball'),impacts=specs.filter(s=>s.variant==='water-impact');
    assert.ok(launches.length&&impacts.length);
    launches.forEach(s=>{assert.deepEqual(roles(s),['projectile']);assert.equal(s.vfx.projectile,'proj-waterball-flow');assert.equal(s.hit,false);});
    impacts.forEach(s=>{assert.deepEqual(roles(s),['hit']);assert.equal(s.vfx.hit,'hit-waterball-splash');});
    const bursts=specs.filter(s=>s.variant==='water-burst');assert.equal(bursts.length>0,stage>=4);
    bursts.forEach(s=>assert.deepEqual({...s.vfx},{attack:'burst-frost-nova'}));
    for(const s of specs.filter(s=>s.variant==='water-tornado')){
     assert.deepEqual({...s.vfx},s.vfxUlt==='ragingTide'?{ground:'ground-tornado-water'}:{field:'field-water-tornado'});
    }
    assert.ok(!specs.some(s=>s.variant==='blizzard'||/^ice-arrow/.test(s.variant)));
   }else{
    const novas=specs.filter(s=>s.variant==='frost-nova');assert.ok(novas.length);
    novas.forEach(s=>{assert.ok(s.vfx.attack);assert.ok(!s.vfx.projectile&&!s.vfx.ground&&!s.vfx.field);});
    const snow=specs.filter(s=>s.variant==='blizzard');assert.equal(snow.length>0,stage===7);
    snow.forEach(s=>assert.deepEqual({...s.vfx},{ground:'ground-blizzard'}));
    assert.ok(!specs.some(s=>/^ice-arrow/.test(s.variant)||s.variant==='waterball'));
   }
  });
 }
}

test('WATER-ICE-AUDIT: all three freeze sources use Status without spawning a nova or blizzard',()=>{
 const {c,es,specs}=setup('frostnova',7,'iceKingDomain');
 for(const gid of ['icearrow','waterball','frostnova']){
  const e={...es[0],buffs:{},effects:{},dots:[]};
  assert.ok(c.sgFreezeTarget(e,{gid,tier:gid==='icearrow'?'2':gid==='waterball'?'3':'1'})>0);
  assert.ok(c.sgFrozenOn(e));assert.ok(c.sgIsStunned(e));
 }
 assert.equal(specs.length,0);
});

test('WATER-ICE-AUDIT: landing uses the live enemy list, fixed point and independently configured T4 radius',()=>{
 const {c,p,es,hits,specs}=setup('waterball',4);
 c.SKILLS2.waterball.tiers[3].fx.m=9;c.SKILLS2.waterball.tiers[3].fx.bounce=0;c.SKILLS2.waterball.tiers[3].fx.bouncePer=0;
 c.castSkill2(p,[es[0]],'waterball','mv-float');assert.equal(hits.length,0);
 const originalX=es[0].pos.x;es[0].pos.x=300;
 const fresh={...es[1],pos:{x:originalX+85,y:0}},outside={...es[2],pos:{x:originalX+150,y:0}};
 c.GT=.2;c.tickSkill2(.2,{pEnt:p,getEnemies:()=>[fresh,outside],enemies:es,floatSel:'mv-float'});
 assert.equal(hits.length,1);assert.equal(hits[0].ent,fresh);
 const burst=specs.find(s=>s.variant==='water-burst');assert.equal(burst.area.x,originalX);assert.equal(burst.area.r,90);
 assert.equal(specs.find(s=>s.variant==='water-impact').area.x,originalX);
});

test('WATER-ICE-AUDIT: water frost spread emits one source-to-victim event per actual infection',()=>{
 const {c,es,specs}=setup('waterball',5);const source=es[0];
 const spec=c.sgFrostSpec(c.SKILLS2.waterball,c.skills2Levels('waterball'),2,1000);c.sgApplyFrost(source,spec);
 c.sgSpreadFrost(source,es,{count:2,m:10},c.sgFindDot(source,'sgFrostBite'));
 const events=specs.filter(s=>s.variant==='frost-spread');assert.equal(events.length,2);
 events.forEach(s=>{assert.equal(s.targets[0],'A');assert.equal(s.targets.length,2);assert.deepEqual({...s.vfx},{projectile:'proj-ice-shard',hit:'hit-ice'});assert.equal(s.area,null);});
 assert.equal(new Set(events.map(s=>s.targets[1])).size,2);
});

test('WATER-ICE-AUDIT: homing T6 consumes remaining frost damage and reports it only once',()=>{
 const {c,p,es,hits}=setup('icearrow',7);const target=es[0];
 c.sgApplyFrost(target,{dps:40,dur:5,interval:.5,stacksRaw:1,slot:{gid:'icearrow',tier:'2'}});
 const reports=[];c.sgGroundTick({pEnt:p,st:c.getStats(),gid:'icearrow',kind:'icearrow',pos:{x:50,y:0},radius:15,dmgVal:100,frostSpec:null,floatSel:'mv-float'},[target],{onDamage:n=>reports.push(n)});
 assert.equal(hits.length,1);assert.equal(reports.length,1);assert.equal(reports[0],300,'100 body plus 200 remaining frost');
 assert.equal(target.hp,1e9-200);assert.ok(c.sgFrostStacks(target)>1);
});

test('WATER-ICE-AUDIT: crystal resonance emits each real directed pair and stops when unequipped',()=>{
 const {h,c,p,es,hits,specs}=setup('frostnova',7,'crystalResonance');
 es[2].pos={x:60,y:-25}; // 三者彼此都在表定八米範圍內
 es.forEach(e=>c.applyStatus(e,'sgFrozen',{val:0,dur:5}));
 h.advance(c,p,es,.5);assert.equal(hits.length,6);
 const links=specs.filter(s=>s.variant==='frost-spread');assert.equal(links.length,6);
 links.forEach(s=>{assert.equal(s.targets.length,2);assert.notEqual(s.targets[0],s.targets[1]);assert.deepEqual({...s.vfx},{projectile:'proj-ice-shard',hit:'hit-ice'});});
 c.G.player.loadout=[];h.advance(c,p,es,1);assert.equal(hits.length,6);
});

test('WATER-ICE-AUDIT: death nova does not spawn snow or inherit the selected ice spikes',()=>{
 const {c,p,es,specs}=setup('frostnova',7,'iceKingDomain');
 c.chance=()=>true;c.sgApplyFrost(es[0],{dps:0,dur:5,interval:.5,stacksRaw:1});es[0].hp=0;
 c.sgDeathNova(es[0],es);assert.ok(specs.some(s=>s.variant==='frost-nova'));
 assert.ok(!specs.some(s=>s.vfx.ground||s.vfx.projectile));assert.equal(c.SKILL2_RT.grounds.length,0);
});

test('WATER-ICE-AUDIT: resonance honors every in-range frozen source beyond four links',()=>{
 const {h,c,p,hits,specs}=setup('frostnova',7,'crystalResonance');
 const es=Array.from({length:6},(_,i)=>h.enemy(1e9,50+i*5,0,'frozen-'+i));es.forEach(e=>c.applyStatus(e,'sgFrozen',{val:0,dur:5}));
 h.advance(c,p,es,.5);assert.equal(hits.length,30,'六個敵人各被另外五個來源共鳴');
 es.forEach(e=>assert.equal(hits.filter(x=>x.ent===e).length,5));
 assert.equal(specs.filter(s=>s.variant==='frost-spread').length,30);
});

test('WATER-ICE-AUDIT: ice king retains scaled snow, dispatches the chosen crystal and expires',()=>{
 const {h,c,p,es,specs}=setup('frostnova',7,'iceKingDomain');
 c.castSkill2(p,es,'frostnova','mv-float');h.advance(c,p,es,1.3);
 const snow=specs.filter(s=>s.variant==='blizzard');assert.ok(snow.length);
 snow.forEach(s=>{assert.deepEqual({...s.vfx},{ground:'ground-blizzard'});assert.equal(s.area.w,360);assert.equal(s.area.h,360);assert.equal(s.area.follow,true);});
 const spikes=c.SKILL2_RT.grounds.filter(f=>f.kind==='icespike');assert.ok(spikes.length>=2&&spikes.length<=8);
 assert.ok(specs.some(s=>s.vfx.ground==='ground-icearrow-frost'));assert.ok(!specs.some(s=>Object.values(s.vfx).includes('ground-tornado-water')));
 spikes.forEach(f=>{assert.equal(f.hits,4);assert.equal(f.radius,80);assert.ok(!f.follow);});
 h.advance(c,p,es,9);assert.equal(c.SKILL2_RT.grounds.length,0,'暴風雪與最後一批冰錐自然回收，不留下永久地板');
});

test('WATER-ICE-AUDIT: empty trigger cells do not fall back to ordinary body or another evolution',()=>{
 for(const [gid,stage]of [['waterball','4'],['waterball','5'],['waterball','7'],['waterball','ragingTide'],['waterball','abyssBurial'],['icearrow','tearsOfIce'],['frostnova','7'],['frostnova','crystalResonance'],['frostnova','iceKingDomain']]){
  const {c}=setup(gid,7);const row=c.sgStatusRow(gid,stage);row.triggerVfx={};
  assert.equal(Object.keys(c.sgVfxRoles(gid,/^\d+$/.test(stage)?{vfxTier:+stage}:{vfxUlt:stage})).length,0);
 }
});

test('WATER-ICE-AUDIT: permanent resonance pauses while down and resumes without a catch-up burst',()=>{
 const {h,c,p,es,hits}=setup('frostnova',7,'crystalResonance');es[2].pos={x:60,y:-25};
 es.forEach(e=>c.applyStatus(e,'sgFrozen',{val:0,dur:20}));h.advance(c,p,es,.2);p.hp=0;h.advance(c,p,es,2);
 assert.equal(hits.length,0);p.hp=1000;h.advance(c,p,es,.15);assert.equal(hits.length,0);h.advance(c,p,es,.1);assert.equal(hits.length,6);
});

test('WATER-ICE-AUDIT: production rain staggers ten arrows, remains authored size and gets reclaimed',()=>{
 const {h,c,p,es,specs}=setup('icearrow',7,'tearsOfIce');c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);h.advance(c,p,es,.05);
 const rain=specs.filter(s=>s.variant==='ice-rain');assert.equal(rain.length,10);
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:id=>es.find(e=>e.name===id)?.pos||{x:0,y:0}}});
 rt.registerPresets(['proj-icearrow-frost','hit-icearrow-shatter'].map(id=>require('../vfx/presets/'+id+'.json')));
 rain.forEach(s=>assert.equal(rt.tryPlay(s),true));assert.equal(rt.stats().projectiles,1);assert.equal(rt.stats().pending,9);rt.update(.3);
 assert.equal(rt.stats().projectiles,8);rt.update(.049);assert.equal(rt.stats().projectiles,10);
 const arrows=nodes.filter(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.equal(arrows.length,10);
 assert.equal(new Set(arrows.map(n=>n.t.x.toFixed(2)+','+n.t.y.toFixed(2))).size,10,'出生時間和落點均錯落');
 rt.update(3);assert.equal(rt.stats().projectiles,0);rt.destroy();
});

test('ICE-TEARS-RAIN: zero, one and many enemies all get ten arrows in every wave',()=>{
 for(const n of [0,1,23]){
  const {h,c,p,specs,hits}=setup('icearrow',7,'tearsOfIce');
  const es=Array.from({length:n},(_,i)=>h.enemy(1e9,20+i*3,0,'rain-'+i));
  c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);
  h.advance(c,p,es,.05);const first=specs.filter(s=>s.variant==='ice-rain');
  assert.equal(first.length,10);assert.equal(new Set(first.map(s=>s.delayMs||0)).size,10);
  assert.ok(first.every(s=>(s.delayMs||0)<350&&s.hit===false));assert.equal(hits.length,0,'起飛不扣血');
  h.advance(c,p,es,4);
  assert.equal(specs.filter(s=>s.variant==='ice-rain').length,100,'10波各10支，不依敵人數變動');
  assert.equal(hits.length,n?100:0,'10波各10支，每支只命中自己的目標一次');
  const damage=c.sgGroupBaseStat(c.SKILLS2.icearrow,c.getStats())*c.sgUltVal(c.sgUlt('icearrow','tearsOfIce'),'pct')/100;
  assert.ok(hits.every(hit=>Math.abs(hit.atk-damage)<1e-9),'每次沿用配置的全額傷害');
  const impacts=specs.filter(s=>s.variant==='ice-rain-hit');
  assert.equal(impacts.length,n?100:0);assert.ok(impacts.every(s=>s.targets.length===1));
  if(n===1)assert.equal(hits.filter(hit=>hit.ent===es[0]).length,100,'單敵仍接受全部100支全額箭雨');
  assert.equal(c.SKILL2_RT.grounds.filter(f=>f.kind==='icerain').length,0,'最後一箭落地後回收');
 }
});

test('ICE-TEARS-RAIN: Worker carries individual targets and frame rates preserve flight timing',()=>{
 const {h,c,p,es,specs}=setup('icearrow',7,'tearsOfIce');
 c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);h.advance(c,p,es,.05);
 const shim={};shim.self=shim;vm.createContext(shim);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/worker/shim.js'),'utf8'),shim);
 specs.filter(s=>s.variant==='ice-rain').forEach(s=>shim.playCombatVfx(s));
 const events=JSON.parse(JSON.stringify(shim.shimDrainUrgentVisualEvents()));assert.equal(events.length,10);
 assert.equal(new Set(events.map(s=>s.delayMs||0)).size,10);
 assert.ok(events.every(s=>s.targets.length===1&&!s.area.fixedLanding&&s.travelMs[0]===350&&s.hit===false));
 function sample(delay,steps){
  const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
  const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,groundScale:.42,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:999,y:999})}});
  rt.registerPresets([require('../vfx/presets/proj-icearrow-frost.json')]);
  rt.tryPlay({...events[0],area:{x:120,y:40,fixedLanding:true},delayMs:delay});steps.forEach(dt=>rt.update(dt));
  const t={...nodes.find(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible).t};
  assert.equal(rt.stats().projectiles,1);rt.update(1);assert.equal(rt.stats().projectiles,0);rt.destroy();return t;
 }
 const reference=sample(0,[.02]);
 for(const steps of [[.12],[.04,.04,.04],[.01,.01,.01,.01,.01,.01,.01,.01,.01,.01,.01,.01]]){
  const t=sample(100,steps);assert.ok(Math.abs(t.x-reference.x)<1e-7);assert.ok(Math.abs(t.y-reference.y)<1e-7);
  assert.ok(Math.abs(t.rotation-reference.rotation)<1e-7,'箭尖沿相同向下航向');
 }
});

test('ICE-TEARS-RAIN: misses keep falling arrows without success hit effects',()=>{
 const {h,c,p,es,specs}=setup('icearrow',7,'tearsOfIce');
 c.resolveHit=()=>({miss:true,dmg:0,crit:false,killed:false});
 c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);h.advance(c,p,es,4);
 assert.equal(specs.filter(s=>s.variant==='ice-rain').length,100);
 assert.equal(specs.filter(s=>s.variant==='ice-rain-hit').length,0);
 assert.equal(c.SKILL2_RT.grounds.filter(f=>f.kind==='icerain').length,0);
});

test('ICE-TEARS-RAIN: level ten rain deals 400% per arrow without increasing normal arrows',()=>{
 function cast(lv){
  const {h,c,p,es,hits}=setup('icearrow',7,lv?'tearsOfIce':null);h.maxLevels(c,'icearrow');
  if(lv)h.setUlt(c,'icearrow','tearsOfIce',lv);
  let inRain=false;const land=c.sgTickIceRainLandings,hit=c.resolveHit;
  c.sgTickIceRainLandings=function(...args){inRain=true;try{return land(...args);}finally{inRain=false;}};
  c.resolveHit=function(...args){const res=hit(...args);hits.at(-1).rain=inRain;return res;};
  const base=c.sgGroupBaseStat(c.SKILLS2.icearrow,c.getStats());
  assert.ok(c.castSkill2(p,es,'icearrow','mv-float'));h.advance(c,p,es,4);
  return {normal:Array.from(hits.filter(hit=>!hit.rain),hit=>hit.atk),rain:hits.filter(hit=>hit.rain),base};
 }
 const off=cast(0),one=cast(1),ten=cast(10);
 assert.ok(off.normal.length);assert.deepEqual(one.normal,off.normal);assert.deepEqual(ten.normal,off.normal);
 assert.equal(off.rain.length,0);assert.equal(ten.rain.length,100,'100支雨箭各命中自己的目標');
 assert.ok(one.rain.every(hit=>Math.abs(hit.atk/one.base-2.2)<1e-9));
 assert.ok(ten.rain.every(hit=>Math.abs(hit.atk/ten.base-4)<1e-9),'每支都是魔攻400%，沒有除以10或乘到普通箭');
});

test('ICE-TEARS-RAIN: staggered landings settle damage and hit effects together',()=>{
 const {h,c,p,hits,specs}=setup('icearrow',7,'tearsOfIce');
 const es=[h.enemy(1e9,20,0,'landing-0')];
 c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);
 const f=c.SKILL2_RT.grounds.find(f=>f.kind==='icerain');f.hits=f.hitsLeft=1;
 h.advance(c,p,es,.05);assert.equal(specs.filter(s=>s.variant==='ice-rain').length,10);
 h.advance(c,p,es,.3);assert.equal(hits.length,0);assert.ok(c.SKILL2_RT.grounds.includes(f),'發射完仍保留未落地箭');
 h.advance(c,p,es,.05);assert.equal(hits.length,1);assert.equal(specs.filter(s=>s.variant==='ice-rain-hit').length,1);
 h.advance(c,p,es,.35);assert.equal(hits.length,10);
 const impact=specs.filter(s=>s.variant==='ice-rain-hit');assert.equal(impact.length,10);
 for(let i=0;i<10;i++){assert.equal(impact[i].targets.length,1);assert.equal(impact[i].targets[0],'landing-0');assert.deepEqual(roles(impact[i]),['hit']);}
 assert.equal(c.SKILL2_RT.grounds.includes(f),false);
});

test('ICE-TEARS-HIT: every arrow settles only its own target at its staggered arrival',()=>{
 const {h,c,p,hits,specs}=setup('icearrow',7,'tearsOfIce');
 const es=Array.from({length:23},(_,i)=>h.enemy(1e9,20+i*3,0,'target-'+i));
 c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);
 const f=c.SKILL2_RT.grounds.find(f=>f.kind==='icerain');f.hits=f.hitsLeft=1;
 h.advance(c,p,es,.05);const arrows=specs.filter(s=>s.variant==='ice-rain');
 assert.equal(new Set(arrows.map(s=>s.targets[0])).size,10,'有足夠敵人時同一波先分配不同目標');
 const hitTimes=[];const resolve=c.resolveHit;
 c.resolveHit=function(...args){hitTimes.push(c.GT);return resolve(...args);};
 h.advance(c,p,es,.7,.01);
 const impacts=specs.filter(s=>s.variant==='ice-rain-hit');assert.equal(hits.length,10);assert.equal(impacts.length,10);
 for(let i=0;i<10;i++){
  assert.equal(hits[i].ent.name,arrows[i].targets[0]);assert.equal(impacts[i].targets[0],arrows[i].targets[0]);
  const arrival=.05+((arrows[i].delayMs||0)+arrows[i].travelMs[0])/1000;
  assert.ok(hitTimes[i]+1e-9>=arrival&&hitTimes[i]-arrival<.010001,'扣血與受擊僅在自己的抵達時間發生');
 }
 assert.equal(new Set(hitTimes).size,10,'不以一支箭抵達批次攻擊所有敵人');
 assert.ok(hits.every(hit=>es.indexOf(hit.ent)<10),'其他13個未被選中的敵人不會憑空受擊');
});

test('ICE-TEARS-HIT: arrows follow their own moving target and never substitute a new enemy',()=>{
 const {h,c,p,hits,specs}=setup('icearrow',7,'tearsOfIce');const es=[h.enemy(1e9,20,0,'moving')];
 c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);
 const f=c.SKILL2_RT.grounds.find(f=>f.kind==='icerain');f.hits=f.hitsLeft=1;
 h.advance(c,p,es,.05);const arrow=specs.find(s=>s.variant==='ice-rain');
 assert.equal(arrow.targets[0],'moving');assert.ok(!arrow.area.fixedLanding);
 es[0].pos={x:90,y:30};h.advance(c,p,es,.35);assert.equal(hits.length,1);assert.equal(hits[0].ent,es[0]);
 const replacement=h.enemy(1e9,20,0,'replacement');es.splice(0,1,replacement);
 h.advance(c,p,es,.35);assert.equal(hits.length,1,'原目標離場後剩餘九支不轉打新敵人');
 assert.equal(specs.filter(s=>s.variant==='ice-rain-hit').length,1);
});

test('ICE-TEARS-HIT: production adapter follows the moving target and puts impact at the same endpoint',()=>{
 const {h,c,p,es,specs}=setup('icearrow',7,'tearsOfIce');
 c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);h.advance(c,p,es,.05);
 const arrow=specs.find(s=>s.variant==='ice-rain'),nodes=[];
 const backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,groundScale:.42,
  ctx:{playerPos:()=>({x:0,y:0}),posOf:id=>{const e=es.find(e=>e.name===id);return {x:e.pos.x,y:e.pos.y*.42};}}});
 // 運動檢查將箭身中心標記歸零，排除作者的9px局部偏移；正式外觀由 production rain 測試保留核對。
 rt.registerPresets(['proj-icearrow-frost','hit-icearrow-shatter'].map(id=>{
  const preset=require('../vfx/presets/'+id+'.json');
  return {...preset,layers:preset.layers.map(l=>l.id==='faceted-icicle'?{...l,position:{x:0,y:0}}:l)};
 }));
 rt.tryPlay(arrow);es[0].pos={x:120,y:40};rt.update(.349);
 const body=nodes.find(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);
 assert.ok(body);assert.ok(Math.abs(body.t.x-120)<1,'箭身追到自己的移動目標');
 assert.ok(Math.abs(body.t.y-40*.42)<2);
 h.advance(c,p,es,.35);const impact=specs.find(s=>s.variant==='ice-rain-hit');
 assert.equal(impact.targets[0],arrow.targets[0]);rt.update(.001);assert.equal(rt.stats().projectiles,0);
 const before=nodes.length;rt.tryPlay(impact);rt.update(.01);
 const flashAsset=require('../vfx/presets/hit-icearrow-shatter.json').layers.find(l=>l.id==='cold-flash').assetId;
 const visible=nodes.slice(before).filter(n=>n.spec.assetUrl===flashAsset&&n.t?.visible);assert.equal(visible.length,1);
 assert.ok(Math.abs(visible[0].t.x-120)<1e-7&&Math.abs(visible[0].t.y-40*.42)<1e-7,'受擊只在該箭抵達的目標上播放');rt.destroy();
});

test('ICE-TEARS-HIT: a killed target shows the first impact but consumes remaining arrows without more damage',()=>{
 const {h,c,p,specs}=setup('icearrow',7,'tearsOfIce');const es=[h.enemy(1,20,0,'lethal')];let hits=0;
 c.resolveHit=(_p,e)=>{hits++;e.hp=0;return {dmg:100,crit:false,miss:false,killed:true};};
 c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);
 const f=c.SKILL2_RT.grounds.find(f=>f.kind==='icerain');f.hits=f.hitsLeft=1;
 h.advance(c,p,es,.75);assert.equal(hits,1);assert.equal(specs.filter(s=>s.variant==='ice-rain-hit').length,1);
 assert.equal(c.SKILL2_RT.grounds.length,0);
});

test('ICE-TEARS-HIT: positionless compatibility cannot damage a removed original target',()=>{
 const {h,c,p,es,hits,specs}=setup('icearrow',7,'tearsOfIce');
 c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);
 const f=c.SKILL2_RT.grounds.find(f=>f.kind==='icerain');f.hits=f.hitsLeft=1;
 h.advance(c,p,es,.05);f.pos=null;f.follow=false;
 h.advance(c,p,[],.7);assert.equal(hits.length,0);assert.equal(specs.filter(s=>s.variant==='ice-rain-hit').length,0);
 assert.equal(c.SKILL2_RT.grounds.length,0);
});

test('ICE-TEARS-RAIN: invalid targets, downed caster and battle reset cancel pending damage',()=>{
 const {h,c,p,es,hits,specs}=setup('icearrow',7,'tearsOfIce');
 c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);h.advance(c,p,es,.05);
 es[0].hp=0;es[1].pos={x:1000,y:0};es.splice(2,1);h.advance(c,p,es,.7);assert.equal(hits.length,0);
 p.hp=0;h.advance(c,p,es,.1);assert.equal(c.SKILL2_RT.grounds.filter(f=>f.kind==='icerain').length,0);
 const count=specs.length;p.hp=1000;h.advance(c,p,es,3);assert.equal(specs.length,count,'復活不補放舊波次');
 es[0].hp=1e9;c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);h.advance(c,p,es,.05);
 c.resetSkill2RT();h.advance(c,p,es,1);assert.equal(hits.length,0);assert.equal(c.SKILL2_RT.grounds.length,0);
});

test('WATER-ICE-AUDIT: production frost spread hits only the destination after arrival',()=>{
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:id=>({x:id==='source'?50:150,y:0})}});
 rt.registerPresets(['proj-ice-shard','hit-ice'].map(id=>require('../vfx/presets/'+id+'.json')));
 rt.tryPlay({fxKind:'chain',variant:'frost-spread',targets:['source','target'],travelMs:[0,80],vfx:{projectile:'proj-ice-shard',hit:'hit-ice'}});
 assert.equal(rt.stats().pending,1);rt.update(.1);assert.equal(rt.stats().pending,0);
 const projectileAssets=require('../vfx/presets/proj-ice-shard.json').layers.map(l=>l.assetId);
 const hitAssets=require('../vfx/presets/hit-ice.json').layers.map(l=>l.assetId).filter(id=>!projectileAssets.includes(id));
 const hitNodes=nodes.filter(n=>hitAssets.includes(n.spec.assetUrl));
 const visible=hitNodes.filter(n=>n.t?.visible);assert.ok(visible.length);assert.ok(visible.every(n=>n.t.x>=100),'來源不能播放受擊');rt.destroy();
});
