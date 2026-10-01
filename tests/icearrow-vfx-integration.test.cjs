'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
const presets=['proj-icearrow-frost','hit-icearrow-shatter','ground-icearrow-frost'].map(id=>require('../vfx/presets/'+id+'.json'));

function simulation() {
 const path=require('path'),{createRequire}=require('module');
 const file=path.join(__dirname,'skill2-ice.test.cjs'),src=fs.readFileSync(file,'utf8');
 const ctx={require:createRequire(file),__dirname,console};vm.createContext(ctx);
 vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',ctx);
 return ctx;
}

test('ICEARROW-DEATH-NOVA: absolute zero kills cannot cast learned but unequipped death nova',()=>{
 const h=simulation(),c=h.c;
 h.setLevels(c,'icearrow',[10,10,10,10,10,10,10]);
 h.setLevels(c,'frostnova',[10,10,10,10,10,10,10]);
 c.G.player.skills2.ult={icearrow:{pick:0,lv:1},frostnova:{pick:0,lv:1}};
 h.equip(c,'icearrow');h.forceRolls(c,0);
 const p=h.playerEnt();p.pos={x:0,y:0};p.mp=1000;c.FIELD.player=p;
 const doomed=h.enemy(50,50,0,'doomed'),survivor=h.enemy(1e9,80,0,'survivor'),es=[doomed,survivor];
 c.applyStatus(doomed,'sgFrost',{val:20,dur:5});
 const hits=h.stubHits(c),specs=h.stubVfx(c),deaths=new Set();
 let deathHookCalls=0;
 const onDeaths=()=>{for(const e of es)if(e.hp<=0&&!deaths.has(e)){
  deaths.add(e);deathHookCalls++;c.skills2OnEnemyDeath(e,es.filter(x=>x.hp>0));
 }};
 assert.ok(c.castSkill2(p,es,'icearrow','mv-float'));
 assert.ok(!specs.some(s=>s.variant==='frost-nova'),'發射起手本身不施放冰霜新星');onDeaths();
 for(let i=0;i<40;i++){c.GT+=.05;c.tickSkill2(.05,{...h.tickCtx(c,p,es),onDeaths});}
 assert.equal(deathHookCalls,1,'正式飛行擊殺已經進入敵人死亡掛勾');
 assert.equal(doomed.hp,0);assert.ok(hits.length>0);
 assert.ok(specs.some(s=>s.variant==='ice-arrow-pierce'));
 assert.ok(!specs.some(s=>s.variant==='frost-nova'||Object.values(s.vfx||{}).some(id=>/^burst-frost-/.test(id))),
  '只裝寒冰箭時，擊殺不能額外施放已學習的冰霜新星');
 assert.equal(new Set(c.SKILL2_RT.grounds.filter(f=>f.kind==='icearrow').map(f=>f.wave)).size,10);
 const novaIds=['burst-frost-nova','burst-frost-freeze'],nodes=[];
 const backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,
  ctx:{playerPos:()=>({x:0,y:0}),posOf:key=>key==='doomed'?{x:50,y:0}:{x:80,y:0}}});
 rt.registerPresets([...presets,...novaIds.map(id=>require('../vfx/presets/'+id+'.json'))]);
 for(const s of specs)rt.tryPlay(s);rt.update(.1);
 assert.ok(nodes.length>0,'冰箭本體仍進入正式 Runtime');
 const novaOnlyAsset='new_materials/impact-ring/impact_14.png';
 assert.ok(!nodes.some(n=>n.spec.assetUrl===novaOnlyAsset),'Runtime 不應建立新星衝擊波圖層');rt.destroy();
});

test('ICEARROW-DEATH-NOVA: co-equipped nova follows actual absolute zero kills and stops immediately when removed',()=>{
 const h=simulation(),c=h.c;
 h.setLevels(c,'frostnova',[1,1,1,1,1,1,1]);h.setLevels(c,'icearrow',[10,10,10,10,10,10,10]);
 h.equip(c,'frostnova');c.G.player.loadout.push(c.SG_PREFIX+'icearrow');c.G.player.skills2.ult={icearrow:{pick:0,lv:1}};h.forceRolls(c,0);
 const p=h.playerEnt();p.pos={x:0,y:0};p.mp=1000;c.FIELD.player=p;
 const dead=h.enemy(50,50,0,'dead'),near=h.enemy(1e9,80,0,'near'),far=h.enemy(1e9,1000,0,'far'),es=[dead,near,far];
 c.applyStatus(dead,'sgFrost',{val:20,dur:5});
 const hits=h.stubHits(c),specs=h.stubVfx(c);
 let dispatched=false,novaHits=[];
 const onDeaths=()=>{if(dead.hp<=0&&!dispatched){dispatched=true;const n=hits.length;
  c.skills2OnEnemyDeath(dead,[near,far]);novaHits=hits.slice(n);
 }};
 assert.ok(c.castSkill2(p,es,'icearrow','mv-float'));
 assert.ok(!specs.some(s=>s.variant==='frost-nova'),'同時裝配時也不能在發射起手就施放新星');
 for(let i=0;i<10;i++){c.GT+=.05;c.tickSkill2(.05,{...h.tickCtx(c,p,es),onDeaths});}
 assert.ok(dispatched,'帶寒霜的怪被極寒冰爆擊殺才進入新星掛勾');
 const nova=specs.find(s=>s.variant==='frost-nova');assert.ok(nova,'裝配冰霜新星時合法追加保留');
 assert.equal(nova.area.x,0);assert.equal(nova.area.y,0);
 assert.ok(novaHits.some(hit=>hit.ent===near));assert.ok(!novaHits.some(hit=>hit.ent===far));
 const hitCount=hits.length,eventCount=specs.length;c.G.player.loadout=[];
 c.skills2OnEnemyDeath(dead,[near,far]);assert.equal(hits.length,hitCount);assert.equal(specs.length,eventCount);
});

test('ICEARROW-T7-VFX: icearrow freeze cannot dispatch the learned frostnova evolution or its blizzard',()=>{
 const h=simulation(),c=h.c;h.setLevels(c,'icearrow',[10,10,10,10,10,10,10]);h.setLevels(c,'frostnova',[10,10,10,10,10,10,10]);h.equip(c,'icearrow');
 c.G.player.skills2.ult={icearrow:{pick:0,lv:1},frostnova:{pick:0,lv:1}};
 const specs=h.stubVfx(c),target=h.enemy(1e9,50,0,'frozen');
 assert.ok(c.sgFreezeTarget(target,{gid:'icearrow',tier:'2'})>0);
 assert.ok(c.sgFrozenOn(target));assert.ok(c.sgIsStunned(target),'實際控場仍在');
 assert.ok(!specs.some(s=>s.variant==='frost-freeze'||Object.values(s.vfx||{}).includes('ground-blizzard')),'凍結不能播放另一棵技能的暴風雪');
 // 真正施放冰霜新星時仍應產生暴風雪，不把合法效果一起移除。
 h.equip(c,'frostnova');const p=h.playerEnt();p.mp=1000;c.FIELD.player=p;h.stubHits(c);
 c.castSkill2(p,[target],'frostnova','mv-float');h.run(c,p,[target],.5);
 assert.ok(c.SKILL2_RT.grounds.some(f=>f.kind==='blizzard'));
 assert.ok(specs.some(s=>s.variant==='blizzard'&&s.vfx.ground==='ground-blizzard'));
});

test('ICEARROW-T7-VFX: real T7 and all evolutions keep arrows and freeze events separate from nova and blizzard',()=>{
 for(const id of [null,'absoluteZeroBurst','infiniteIceRift','tearsOfIce']) {
  const h=simulation(),c=h.c;h.setLevels(c,'icearrow',id?[10,10,10,10,10,10,10]:[1,1,1,1,1,1,1]);h.equip(c,'icearrow');h.forceRolls(c,.999);
  // 冰霜新星超神已學但未裝配：舊凍結派送會借用它的整棵外觀，連暴風雪也繼承。
  h.setLevels(c,'frostnova',[10,10,10,10,10,10,10]);
  c.G.player.skills2.ult={frostnova:{pick:0,lv:1}};
  if(id)c.G.player.skills2.ult.icearrow={pick:c.sgUltIndexOfId('icearrow',id),lv:1};
  const p=h.playerEnt();p.mp=1000;c.FIELD.player=p;const es=[h.enemy(1e9,50,0,'A'),h.enemy(1e9,90,20,'B')];
  h.stubHits(c);const specs=h.stubVfx(c);
  c.castSkill2(p,es,'icearrow','mv-float');h.run(c,p,es,1.5);
  const homing=specs.filter(s=>s.variant==='ice-arrow-homing');assert.ok(homing.length,id);
  homing.forEach(s=>{assert.equal(s.vfx.projectile,presets[0].id);assert.ok(!s.vfx.attack);assert.ok(!s.vfx.ground);assert.ok(s.area.id);assert.equal(s.area.speed,585);});
  const fields=c.SKILL2_RT.grounds;assert.ok(fields.every(f=>f.kind!=='blizzard'));
  if(id==='absoluteZeroBurst')assert.equal(new Set(fields.filter(f=>f.kind==='icearrow').map(f=>f.wave)).size,10,'極寒冰爆連射十波，沒有暴風雪');
  es[0]=h.enemy(1e9,50,0,'fresh');c.sgFreezeTarget(es[0],{gid:'icearrow',tier:'2'});
  assert.ok(c.sgFrozenOn(es[0]),'控場仍實際生效');
  assert.ok(!specs.some(s=>s.gid==='frostnova'||s.variant==='frost-freeze'||Object.values(s.vfx||{}).includes('ground-blizzard')),id);
  const arrowEvents=specs.filter(s=>s.variant!=='ice-blast');assert.ok(arrowEvents.every(s=>!Object.values(s.vfx||{}).includes('burst-icearrow-crystal')),'普通發射、命中與追蹤不播冰爆');
  c.sgIceBlast(es[0],es,h.tickCtx(c,p,es));
  const burst=specs.at(-1);assert.equal(burst.variant,'ice-blast');assert.deepEqual({...burst.vfx},{attack:'burst-icearrow-crystal'});assert.equal(burst.area.r,60);assert.equal(burst.area.x,50);
  c.SKILLS2.icearrow.tiers[6].triggerVfx={};c.sgIceBlast(es[0],es,h.tickCtx(c,p,es));assert.deepEqual({...specs.at(-1).vfx},{},'空觸發不退回本體');
 }
});

test('ICEARROW-T7-VFX: authoritative targetless snapshots update one arrow instead of launching per tick',()=>{
 const h=simulation(),c=h.c;h.setLevels(c,'icearrow',[1,1,1,1,1,1,1]);h.equip(c,'icearrow');
 const p=h.playerEnt();c.FIELD.player=p;const specs=h.stubVfx(c);h.stubHits(c);
 c.sgSpawnIcearrowHoming(p,c.getStats(),c.SKILLS2.icearrow.tiers[6].fx,null,100,null,'mv-float',{from:{x:30,y:50},moveAngle:Math.PI/2});
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});rt.registerPresets([...presets,require('../vfx/presets/hit-ice.json')]);
 for(let i=0;i<12;i++){
  specs.length=0;h.run(c,p,[],.15);
  const event=specs.find(s=>s.variant==='ice-arrow-homing');assert.ok(event);assert.equal(event.targets.length,0);
  assert.equal(rt.tryPlay(event),true);rt.update(.05);assert.equal(rt.stats().grounds,1,'同id追蹤場域只更新一次');
 }
 assert.equal(nodes.filter(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png').length,1,'無敵人仍有一支連續飛行的箭');
 rt.update(1);assert.equal(rt.stats().grounds,0);rt.destroy();
});
test('icearrow ordinary, piercing, homing and rain mappings ship all approved assets',()=>{
 const src=fs.readFileSync(require.resolve('../js/skills2.js'),'utf8'),start=src.indexOf('var SKILLS2 ='),c={};vm.createContext(c);vm.runInContext(src.slice(start,start+src.slice(start).indexOf('\n};')+3),c);
 const g=c.SKILLS2.icearrow;
 for(const row of [g.tiers[0],g.tiers[3]]){assert.equal(row.vfx.projectile,presets[0].id);assert.equal(row.vfx.hit,presets[1].id);}
 assert.equal(g.ult[2].triggerVfx.projectile,presets[0].id);assert.equal(g.ult[2].triggerVfx.hit,presets[1].id);assert.ok(!g.ult[2].vfx);
 assert.ok(!g.tiers[4].vfx?.ground);assert.ok(!g.tiers[6].vfx.ground);assert.ok(!g.tiers[6].vfx.attack);assert.equal(g.tiers[6].triggerVfx.attack,'burst-icearrow-crystal');
 const context={Math,bfMeterPx:n=>n*10};vm.createContext(context);vm.runInContext(src,context);
 context.skills2Levels=()=>[1,1,1,1,1,1,1];context.sgIcearrowSpeed=()=>585;context.sgSpawnGround=(_p,_st,_gid,spec)=>{context.spawned=spec;};context.sgSpawnIcearrowHoming({}, {}, g.tiers[6].fx, {}, 1, null, 'pv-float', {});assert.equal(context.spawned.vfxTier,7);assert.equal(context.sgVfxRoles('icearrow',{vfxTier:7,vfxBase:true}).projectile,presets[0].id);assert.equal(g.tiers[0].fx.speed,58.5);
 const shipped=require('../vfx/shipped-assets.json').assets;
 for(const p of presets)for(const l of p.layers){const a=shipped.find(a=>a.assetId===l.assetId);assert.ok(a,l.assetId);assert.ok(fs.existsSync(require('path').join(__dirname,'../images/vfx/assets',a.relativePath)));}
});
test('production adapter preserves user-edited appearance and size across launch and homing',()=>{
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({profile:{scale:0.8,areaScale:0.4},core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:240,y:0})}});rt.registerPresets(presets);
 assert.equal(rt.tryPlay({fxKind:'projectile',variant:'ice-arrow-pierce',targets:[],angle:0,lineLength:240,travelMs:[410],vfx:{projectile:presets[0].id,hit:presets[1].id}}),true);rt.update(.1);
 const arrow=nodes.find(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.ok(arrow);assert.ok(arrow.t.x>0&&arrow.t.x<240);
 assert.equal(rt.tryPlay({fxKind:'aura',variant:'ice-arrow-homing',dur:.1,area:{id:'homing',x:100,y:80,r:15,a:0,speed:585,moveA:.7},vfx:{projectile:presets[0].id}}),true);rt.update(.05);
 const flying=nodes.filter(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.ok(flying.length>=2);
 const homing=flying.at(-1);assert.equal(homing.t.scaleX,arrow.t.scaleX,'homing preserves launch width'); assert.equal(homing.t.scaleY,arrow.t.scaleY,'homing preserves launch height');
 assert.ok(Math.abs(homing.t.rotation-.7)<1e-6,'arrow uses movement heading, not circular area angle');
 assert.equal(homing.spec.assetUrl,arrow.spec.assetUrl,'both phases use the edited launch asset');
 for(const angle of [Math.PI/2,Math.PI,-Math.PI/2]){
  rt.tryPlay({fxKind:'aura',variant:'ice-arrow-homing',dur:2,area:{id:'homing',x:100,y:80,r:15,a:0,speed:585,moveA:angle},vfx:{projectile:presets[0].id}});
  for(let j=0;j<30;j++)rt.update(1/60);
  const delta=Math.atan2(Math.sin(homing.t.rotation-angle),Math.cos(homing.t.rotation-angle));assert.ok(Math.abs(delta)<.05,'turns to each new flight direction');
 }
 rt.update(5);assert.equal(rt.stats().grounds,0);rt.destroy();
});
test('homing arrow points along every rendered displacement during snapshot correction',()=>{
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});// 運動驗證使用中心標記，排除使用者美術圖層偏移；外觀一致性由上方實際 preset 測試驗證。
 rt.registerPresets(presets.map(p=>({...p,layers:p.layers.map(l=>l.id==='faceted-icicle'?{...l,position:{x:0,y:0}}:l)})));
 const send=(x,y,angle,speed=585)=>rt.tryPlay({fxKind:'aura',variant:'ice-arrow-homing',dur:3,area:{id:'turning',x,y,r:15,a:0,speed,moveA:angle},vfx:{projectile:presets[0].id}});
 send(0,0,0);rt.update(1/60);
 const arrow=nodes.find(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.ok(arrow);
 for(const [x,y,a] of [[0,18,Math.PI/2],[-15,0,Math.PI],[20,-25,-Math.PI/2],[0,0,Math.PI-.01],[0,0,-Math.PI+.01]]){
  send(x,y,a);
  for(const dt of [1/120,1/60,1/30,.1]){
   const prev={...arrow.t};rt.update(dt);const next=arrow.t,dx=next.x-prev.x,dy=next.y-prev.y;
   assert.ok(Math.hypot(dx,dy)>0);
   const error=Math.atan2(Math.sin(next.rotation-Math.atan2(dy,dx)),Math.cos(next.rotation-Math.atan2(dy,dx)));
   assert.ok(Math.abs(error)<1e-8,'arrow must face frame displacement immediately, including correction');
  }
 }
 const angle=arrow.t.rotation;rt.update(0);assert.equal(arrow.t.rotation,angle,'zero-time update preserves direction');rt.destroy();
});
test('simulation and renderer integrate the same continuous turning arc',()=>{
 const path=require('path'),{createRequire}=require('module');
 const file=path.join(__dirname,'skill2-ice.test.cjs'),src=fs.readFileSync(file,'utf8');
 const ctx={require:createRequire(file),__dirname,console};vm.createContext(ctx);
 vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',ctx);const c=ctx.c;
 const f={kind:'icearrow',pos:{x:0,y:0},speed:100,radius:15,chaseM:30,moveAngle:0,dest:{x:0,y:1000},turnSide:1};
 const r=c.sgGroundTurnRadiusPx(f),step=10;c.sgGroundChaseStep(f,step,[]);
 assert.ok(Math.abs(f.pos.x-r*Math.sin(step/r))<1e-8);assert.ok(Math.abs(f.pos.y-r*(1-Math.cos(step/r)))<1e-8);
 const motion=c.sgGroundMotionFields(f,{});assert.ok(Math.abs(motion.turnRate-100/r)<1e-8);
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});// 運動驗證使用中心標記，排除使用者美術圖層偏移；外觀一致性由上方實際 preset 測試驗證。
 rt.registerPresets(presets.map(p=>({...p,layers:p.layers.map(l=>l.id==='faceted-icicle'?{...l,position:{x:0,y:0}}:l)})));
 rt.tryPlay({fxKind:'aura',variant:'ice-arrow-homing',dur:3,area:{id:'arc',x:0,y:0,r:15,a:0,speed:100,moveA:0,turnRate:motion.turnRate},vfx:{projectile:presets[0].id}});
 for(let i=0;i<6;i++)rt.update(1/60);
 const arrow=nodes.find(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);
 assert.ok(Math.abs(arrow.t.x-f.pos.x)<1e-7);assert.ok(Math.abs(arrow.t.y-f.pos.y)<1e-7,'six rendered frames match one simulation arc');
 const prev={...arrow.t};rt.update(1/60);assert.ok(arrow.t.rotation>prev.rotation,'turn continues between snapshots');rt.destroy();
});

test('T7 ice burst uses approved crystal effect and holds its expanded shape for half a second',()=>{
 const burst=require('../vfx/presets/burst-icearrow-crystal.json');
 assert.match(fs.readFileSync(require.resolve('../js/skills2.js'),'utf8'),/attack: 'burst-icearrow-crystal'/);
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:90,y:70})}});rt.registerPresets([burst]);
 assert.equal(rt.tryPlay({fxKind:'burst',variant:'ice-blast',area:{x:90,y:70,r:60},vfx:{attack:burst.id}}),true);
 rt.update(.14);const n=nodes.find(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.ok(n);const initial={...n.t};
 rt.update(.48);assert.equal(n.t.scaleX,initial.scaleX);assert.equal(n.t.scaleY,initial.scaleY);assert.equal(n.t.alpha,initial.alpha);
 rt.update(.2);assert.ok(n.t.alpha<initial.alpha,'only fades after hold');rt.update(1);assert.ok(!nodes.some(n=>n.t?.visible),'all burst nodes are reclaimed');rt.destroy();
});
