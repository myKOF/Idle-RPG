'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Core=require('../js/vfx-core'),Runtime=require('../js/vfx-runtime');
const {createEngine}=require('../scripts/sim/engine');
const root=path.resolve(__dirname,'..');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function visual(presets,ctx={},scale=1){
  const nodes=[],backend={createNode(spec){const n={spec,poses:[]};nodes.push(n);return n;},
    updateNode(n,t){n.poses.push({...t});},destroyNode(){},destroy(){}};
  const rt=Runtime.create({core:Core,fxBackend:backend,airBackend:backend,billboardBackend:backend,
    groundScale:scale,resolver:{resolve:id=>id,has:()=>true},ctx:{posOf:()=>({x:350,y:400}),playerPos:()=>({x:0,y:0}),...ctx}});
  rt.registerPresets(presets);return {rt,nodes};
}
const marker=(id,duration=2)=>({schemaVersion:1,id,duration,loop:false,
  layers:[{id:'centre',type:'sprite',assetId:id,duration}]});
const launch=(variant,id,extra={})=>({fxKind:'rain',variant,targets:['target'],travelMs:[500],hit:false,vfx:{projectile:id},...extra});
test('上方紅框抽樣：左右邊界／高度及寬窄畫布一致，每次兩個獨立抽樣',()=>{
  for(const [w,h] of [[674,648],[1280,720],[390,760]]){
    let calls=0;const p=Runtime.sampleSkyEntry(w,h,()=>{calls++;return 0;});near(p.x,w*.12);near(p.y,0);assert.equal(calls,2);
    const q=Runtime.sampleSkyEntry(w,h,()=>1);near(q.x,w*.86);near(q.y,h*.12);
    let state=42;const rand=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/2**32);
    const pts=Array.from({length:1000},()=>Runtime.sampleSkyEntry(w,h,rand));
    assert.ok(pts.every(p=>p.x>=w*.12&&p.x<=w*.86&&p.y>=0&&p.y<=h*.12));
    assert.ok(Math.min(...pts.map(p=>p.x))<w*.14);assert.ok(Math.max(...pts.map(p=>p.x))>w*.84);
    assert.ok(new Set(pts.map(p=>p.x)).size>990);
  }
  assert.equal(Runtime.sampleSkyEntry(0,720),null);assert.equal(Runtime.sampleSkyEntry(Infinity,720),null);
});
test('殞石／雷殞依事件判定並每顆只抽一次，換名素材亦生效',()=>{
  for(const variant of ['meteor','thunder-fall']){
    let count=0;const s=visual([marker('custom-sky')],{skyEntryPoint:()=>({x:100+100*count++,y:30})});
    for(let i=0;i<3;i++)assert.equal(s.rt.tryPlay(launch(variant,'custom-sky')),true);
    s.rt.update(0);assert.equal(count,3);assert.deepEqual(s.nodes.map(n=>n.poses.at(-1).x),[100,200,300]);
    assert.ok(s.nodes.every(n=>n.poses.at(-1).y===30));
    for(let i=0;i<10;i++)s.rt.update(.02);assert.equal(count,3,'不能在飛行中重抽起點');
    s.rt.update(.3);assert.equal(s.rt.stats().projectiles,0);s.rt.destroy();
  }
});
test('固定落點與世界投影只換一次，平滑飛行且抵達時刻仍為travelMs',()=>{
  const s=visual([marker('test-sky'),marker('impact')],{skyEntryPoint:()=>({x:140,y:20})},.65);
  const e=launch('meteor','test-sky',{area:{fixedLanding:true,x:600,y:500,r:90},hit:true,vfx:{projectile:'test-sky',hit:'impact'}});
  const original=JSON.stringify(e);s.rt.tryPlay(e);s.rt.update(.25);
  const p=s.nodes.find(n=>n.spec.assetUrl==='test-sky').poses.at(-1);near(p.x,370);near(p.y,(20+325)/2);
  assert.ok(!s.nodes.some(n=>n.spec.assetUrl==='impact'),'抵達前不得播受擊');
  s.rt.update(.249);assert.equal(s.rt.stats().projectiles,1);s.rt.update(.001);
  assert.equal(s.rt.stats().projectiles,0);assert.ok(s.nodes.some(n=>n.spec.assetUrl==='impact'));
  assert.equal(JSON.stringify(e),original);s.rt.destroy();
});
test('未提供viewport／無效回呼維持作者角度；明確起點、分裂火球與垂直地爆不改',()=>{
  const p={...marker('proj-meteor-inferno'),playback:{fallHeight:200,fallAngle:90}};
  for(const ctx of [{},{skyEntryPoint:()=>null},{skyEntryPoint:()=>({x:NaN,y:0})}]){
    const s=visual([p],ctx);s.rt.tryPlay(launch('meteor',p.id));s.rt.update(0);near(s.nodes[0].poses.at(-1).x,350);near(s.nodes[0].poses.at(-1).y,200);s.rt.destroy();
  }
  let count=0;const s=visual([p,marker('proj-starfall')],{skyEntryPoint:()=>{count++;return {x:10,y:10};}});
  s.rt.tryPlay(launch('meteor',p.id,{area:{fixedLanding:true,sourceX:123,sourceY:234,x:600,y:500}}));
  s.rt.tryPlay(launch('fireball-small',p.id,{fxKind:'projectile',area:{fixedLanding:true,sourceX:120,sourceY:220,x:600,y:500}}));
  s.rt.tryPlay(launch('meteor-starfall','proj-starfall',{area:{x:600,y:500}}));
  s.rt.update(0);assert.equal(count,0);near(s.nodes[0].poses.at(-1).x,123);near(s.nodes[0].poses.at(-1).y,234);
  near(s.nodes[1].poses.at(-1).x,120);near(s.nodes[1].poses.at(-1).y,220);s.rt.destroy();
});
function extract(src,name){const start=src.indexOf('function '+name+'(');assert.ok(start>=0);let depth=0;for(let i=src.indexOf('{',start);i<src.length;i++){if(src[i]==='{')depth++;if(src[i]==='}'&&--depth===0)return src.slice(start,i+1);}throw Error(name);}
test('Canvas紅框反算鏡頭與FOV：所有視窗投影後仍落在相同螢幕橫帶',()=>{
  const src=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8');
  for(const [W,H] of [[674,648],[1280,720],[390,760]])for(const topScale of [1,.78,.9])for(const [x,y] of [[0,0],[130,-80],[-250,200]]){
    const S={W,H,layers:{world:{x,y}}},c={S,VFXRuntime:{sampleSkyEntry:(w,h)=>Runtime.sampleSkyEntry(w,h,()=>.5)}};
    vm.createContext(c);vm.runInContext(['perspectiveLayout','skyEntryPoint','airScreenPose'].map(n=>extract(src,n)).join('\n'),c);
    S.persp={layout:c.perspectiveLayout(W,H,topScale)};const p=c.skyEntryPoint(),screen=c.airScreenPose(p.x,p.y);
    near(screen.x,W*.49);near(screen.y,H*.06);
  }
});
test('Canvas legacy與DOM legacy也逐顆抽上方起點，落點／延遲保持原值',()=>{
  const renderer=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8'),vfx=fs.readFileSync(path.join(root,'js/vfx.js'),'utf8');
  let count=0;const flights=[];const c={S:{W:600,H:700},Math,skyEntryPoint:()=>({x:100+count++*40,y:30}),screenToGroundY:y=>y/.65,
    themeOf:()=>({}),rectRadius:()=>50,spawnTargetTelegraph(){},spawnMeteorProjectile(...args){flights.push(args);},VFX_METEOR_SPEED_MULTIPLIER:1};
  vm.createContext(c);vm.runInContext(extract(renderer,'spawnMeteor'),c);c.spawnMeteor({x:300,y:300,w:100,h:100},{travelMs:[800]});
  assert.equal(count,5);assert.deepEqual(flights.map(a=>a[2].x),[100,140,180,220,260]);
  flights.forEach(a=>{near(a[2].y,30/.65);near(a[3].x,350);near(a[3].y,350);});
  const d={VFXRuntime:Runtime},layer={clientWidth:600,clientHeight:700};vm.createContext(d);vm.runInContext(extract(vfx,'vfxMeteorSkyPoint'),d);
  const pt=d.vfxMeteorSkyPoint(layer,{x:-1,y:-1});assert.ok(pt.x>=72&&pt.x<=516&&pt.y>=0&&pt.y<=84);
  assert.equal(d.vfxMeteorSkyPoint({clientWidth:0,clientHeight:0},null),null);
});
test('正式Worker殞石／雷殞石→Runtime：多顆各別起點，落地才扣血且事件時序保持',()=>{
  for(const gid of ['fireball','thunderorb']){
    const c=createEngine({seed:42}).boot(null).ctx;c.G.player.level=1000;c.G.player.loadout=['sg:'+gid];c.G.player.skills2.levels[gid]=Array(7).fill(1);
    c.initFieldPlayer();c.gmArenaSpawn(1,'elite',1e9);const p=c.FIELD.player,m=c.FIELD.monsters[0];p.mp=1e9;m.pos={x:100,y:0};m._enterCd=0;
    const events=[];c.playCombatVfx=e=>events.push(JSON.parse(JSON.stringify(e)));const hp=m.hp;c.castSkill2(p,[m],gid,'mv-float');
    const variant=gid==='fireball'?'meteor':'thunder-fall',shots=events.filter(e=>e.variant===variant);assert.ok(shots.length>=2);assert.equal(m.hp,hp);
    let count=0;const ids=[...new Set(shots.flatMap(e=>Object.values(e.vfx)))];
    const s=visual(ids.map(id=>marker(id,10)),{skyEntryPoint:()=>({x:100+count++*10,y:25}),posOf:()=>({x:100,y:0})});
    s.rt.tryPlay({...shots[0],delayMs:0});s.rt.update(0);const projectile=s.nodes.find(n=>n.spec.assetUrl===shots[0].vfx.projectile);
    assert.ok(projectile);near(projectile.poses.at(-1).x,100);near(projectile.poses.at(-1).y,25);assert.equal(count,1);
    const at=c.SKILL2_RT.meteors[0].at,flight=shots[0].travelMs[0]/1000;
    near(at,((shots[0].delayMs||0)+shots[0].travelMs[0])/1000);
    c.GT=at-.001;c.sgTickMeteors({pEnt:p,getEnemies:()=>[m]});assert.equal(m.hp,hp);
    s.rt.update(flight-.001);assert.equal(s.rt.stats().projectiles,1);s.rt.update(.001);assert.equal(s.rt.stats().projectiles,0);
    c.GT=at;c.sgTickMeteors({pEnt:p,getEnemies:()=>[m]});assert.ok(m.hp<hp);assert.ok(events.some(e=>e.variant===variant+'-impact'));s.rt.destroy();
  }
});
