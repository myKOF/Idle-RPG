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
     rain.forEach(s=>{assert.deepEqual(roles(s),['hit','projectile']);assert.equal(s.vfx.projectile,'proj-icearrow-frost');assert.equal(s.travelMs[0],350);});
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

test('WATER-ICE-AUDIT: production rain falls above every target, remains authored size and gets reclaimed',()=>{
 const {h,c,p,es,specs}=setup('icearrow',7,'tearsOfIce');c.sgCastIceTears(p,c.getStats(),c.SKILLS2.icearrow,'mv-float',es[0]);h.advance(c,p,es,.05);
 const rain=specs.find(s=>s.variant==='ice-rain');assert.equal(rain.targets.length,3);
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:id=>es.find(e=>e.name===id)?.pos||{x:0,y:0}}});
 rt.registerPresets(['proj-icearrow-frost','hit-icearrow-shatter'].map(id=>require('../vfx/presets/'+id+'.json')));
 assert.equal(rt.tryPlay(rain),true);assert.equal(rt.stats().projectiles,3);rt.update(.1);
 const arrows=nodes.filter(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.equal(arrows.length,3);
 assert.ok(arrows.every(n=>n.t.y<0));assert.equal(new Set(arrows.map(n=>n.t.x.toFixed(2))).size,3,'每個敵人上方各有一支箭');
 rt.update(3);assert.equal(rt.stats().projectiles,0);rt.destroy();
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
