'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {extractFunction}=require('./helpers/battle-scene.cjs');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
const helperFile=path.join(__dirname,'skill2-stormbarrier-legendary.test.cjs');
const helperSource=fs.readFileSync(helperFile,'utf8').split("test('")[0];
const h={require:createRequire(helperFile),__dirname,console};vm.createContext(h);vm.runInContext(helperSource,h);
const gids=['windblade','vacuumslash','stormbarrier'];
const preset=id=>JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets',id+'.json'),'utf8'));
function setup(gid,tier=7,ult){
 const c=h.loadContext(),p=h.playerEnt();p.pos={x:0,y:0};c.FIELD.player=p;
 c.bfPlayerPos=()=>p.pos;h.setLevels(c,gid,Array.from({length:7},(_,i)=>i<tier?1:0));h.equip(c,gid);
 if(ult){h.maxLevels(c,gid);h.setUlt(c,gid,ult,1);}c.Math.random=()=>.999;
 const events=h.stubVfx(c),hits=h.stubHits(c),enemies=[h.enemy(1e9,30,0,'a'),h.enemy(1e9,50,0,'b'),h.enemy(1e9,0,-30,'up')];
 c.FIELD.enemies=enemies;
 const emit=c.sgEmitVfx;c.sgEmitVfx=(id,es,sel,opts)=>{const n=events.length;emit(id,es,sel,opts);events.slice(n).forEach(e=>e._testGid=id);};
 return {c,p,events,hits,enemies,ctx:h.tickCtx(c,p,enemies)};
}
function backend(){return {nodes:[],createNode(spec){const n={spec};this.nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};}
function adapter(presets,k=.5,extra={}){
 const b=backend();const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},fxBackend:b,airBackend:b,zoneBackend:b,
  groundScale:k,ctx:{playerPos:()=>({x:100,y:60}),posOf:id=>id==='a'?{x:140,y:50}:{x:160,y:40}},...extra});rt.registerPresets(presets);return {b,rt};
}
function marker(id,extra={}){return {schemaVersion:1,id,duration:3,loop:true,layers:[{id:'marker',type:'sprite',assetId:'marker',...extra}]};}
function near(a,b,msg,tol=1e-7){assert.ok(Math.abs(a-b)<tol,(msg||'')+` actual=${a}, expected=${b}`);}
function angleNear(a,b,msg){near(Math.atan2(Math.sin(a-b),Math.cos(a-b)),0,msg);}

// 三棵共30列，交叉學滿其他技能與超神：追加事件須使用自己登記的角色，不得把追加效果當成本體。
for(const gid of gids){
 const defs=h.loadContext().SKILLS2[gid];
 for(const key of [...Array.from({length:7},(_,i)=>i+1),...defs.ult.map(u=>u.id)])test(`WIND-MATRIX ${gid}.${key}：本體、觸發及跨樹隔離`,()=>{
  const ult=typeof key==='string'?key:null,tier=ult?7:key,{c,p,events,enemies}=setup(gid,tier,ult);
  for(const other of ['windblade','vacuumslash','stormbarrier','icearrow','waterball','frostnova'].filter(x=>x!==gid)){
   h.maxLevels(c,other);h.setUlt(c,other,c.SKILLS2[other].ult[0].id,10);
  }
  c.castSkill2(p,enemies,gid,'mv-float');
  c.Math.random=()=>0;c.skills2OnPlayerDamaged(enemies[0],p,10,false,{dmg:10},'mv-float');
  h.advance(c,p,enemies,2.8);
  assert.ok(events.length>0||gid==='stormbarrier');
  for(const e of events){
   if(e._testGid)assert.equal(e._testGid,gid,'未裝配的其他技能不得主動派送');
   for(const id of Object.values(e.vfx||{}).flat())if(id){assert.ok(fs.existsSync(path.join(__dirname,'../vfx/presets',id+'.json')),id);}
   if(e.variant==='wind-blade'||e.variant==='wind-blade-small'){
    if(e.fxKind==='projectile')assert.deepEqual(Object.keys(e.vfx||{}).filter(k=>e.vfx[k]).sort(),['projectile']);
    if(e.fxKind==='impact')assert.deepEqual(Object.keys(e.vfx||{}).filter(k=>e.vfx[k]).sort(),['hit']);
   }
   if(e.variant==='wind-slash')assert.equal(e.vfx.attack,'slash-wind-crescent');
   if(e.variant==='wind-spin')assert.equal(e.vfx.attack,'slash-wind-spin');
   if(e.variant==='vacuum-shock')assert.equal(e.vfx.attack,'burst-vacuum-shockwave');
   if(e.variant==='wind-blade-homing')assert.equal(e.vfx.ground,e.area?.staticVacuum?'orb-void-disc':'ground-homing-wind-crescent');
   if(e.variant==='wind-burst'&&e.fxKind==='burst')assert.equal(e.vfx.attack,'burst-wind');
   if(e.variant==='void-disc'&&e.fxKind!=='aura'){
    assert.equal(e.vfx.hit,'hit-wind');assert.ok(!e.vfx.projectile&&!e.vfx.ground,'接觸命中不得再次生成軌道本體');
   }
   assert.ok(!Object.values(e.vfx||{}).some(id=>/blizzard|icearrow|frostnova|water-tornado|fire-tornado/.test(id)),'不得混入冰水或火龍捲');
  }
  if(gid==='vacuumslash'){
   assert.ok(events.some(e=>e.variant===(tier>=4?'wind-spin':'wind-slash')));
   if(tier>=7)assert.ok(events.some(e=>e.variant==='void-disc'&&e.fxKind==='aura'));
  }
  if(gid==='windblade'&&ult==='stormMyriad')assert.equal(c.SKILL2_RT.projectiles.length,0,'萬刃全部改為追擊場域');
  if(gid==='stormbarrier'&&ult!=='myriadPhenomena')assert.ok(!events.some(e=>e.variant==='void-disc'),'只森羅萬象可借用虛空斬');
  if(gid==='stormbarrier'&&ult!=='skyfallStars')assert.ok(!events.some(e=>e.fxKind==='rain'),'只有天穹崩裂降下星體');
 });
}

test('風刃命中播點在實際抵達，而非完整飛行結束；MISS 不播放命中特效',()=>{
 const {c,p,events,enemies,ctx}=setup('windblade',1);enemies.splice(1);enemies[0].pos.x=250;c.castSkill2(p,enemies,'windblade','mv-float');
 assert.equal(events.filter(e=>e.fxKind==='impact').length,0);
 c.GT=.05;c.tickSkill2(.05,ctx);assert.equal(events.filter(e=>e.fxKind==='impact').length,0);
 c.GT=1.4;c.tickSkill2(1.35,ctx);assert.ok(events.some(e=>e.fxKind==='impact'&&e.targets.includes('a')));
 assert.ok(c.SKILL2_RT.projectiles.length>0,'本體尚未飛完');
 const miss=setup('windblade',1);miss.c.resolveHit=()=>({miss:true,dmg:0});miss.c.castSkill2(miss.p,miss.enemies,'windblade','mv-float');h.advance(miss.c,miss.p,miss.enemies,1);
 assert.equal(miss.events.filter(e=>e.fxKind==='impact').length,0);
});

test('延後真空波次重新讀當下玩家及敵人位置，倒地取消剩餘波次',()=>{
 const {c,p,events,hits,enemies,ctx}=setup('vacuumslash',5);c.castSkill2(p,enemies,'vacuumslash','mv-float');
 assert.equal(events.filter(e=>e.variant==='wind-spin').length,1);
 const fresh=h.enemy(1e9,1050,0,'fresh');p.pos.x=1000;ctx.getEnemies=()=>[fresh];
 c.GT=.499;c.sgTickVacuumWaves(ctx);assert.ok(!hits.some(x=>x.ent===fresh));
 c.GT=.500;c.sgTickVacuumWaves(ctx);assert.equal(hits.filter(x=>x.ent===fresh).length,2);near(events.findLast(e=>e.variant==='wind-spin').area.x,1000);
 p.hp=0;c.GT=1;c.sgTickVacuumWaves(ctx);assert.equal(c.SKILL2_RT.vacuumWaves.length,0);assert.equal(events.filter(e=>e.variant==='wind-spin').length,2);
});

for(const lv of [1,10])test(`真空三重奏Lv.${lv}每0.5秒才同時施放與命中，首波立即觸發`,()=>{
 const {c,p,events,hits,enemies,ctx}=setup('vacuumslash',5);
 h.setLevels(c,'vacuumslash',[1,1,1,1,lv,0,0]);
 c.GT=7;c.castSkill2(p,enemies,'vacuumslash','mv-float');
 const waveCount=lv===1?3:5;
 const slashEvents=()=>events.filter(e=>e.variant==='wind-spin');
 const hitsPerWave=enemies.length*2;
 assert.equal(slashEvents().length,1);assert.equal(hits.length,hitsPerWave);
 for(let wave=1;wave<waveCount;wave++){
  c.GT=7+wave*.5-.001;c.sgTickVacuumWaves(ctx);
  assert.equal(slashEvents().length,wave,'波次到時前不播放');
  assert.equal(hits.length,wave*hitsPerWave,'波次到時前不造成傷害');
  c.GT=7+wave*.5;c.sgTickVacuumWaves(ctx);
  assert.equal(slashEvents().length,wave+1);
  assert.equal(hits.length,(wave+1)*hitsPerWave);
 }
 assert.equal(c.SKILL2_RT.vacuumWaves.length,0);
});

test('未學真空三重奏的迴旋斬仍只有立即施放的一波',()=>{
 const {c,p,events,enemies,ctx}=setup('vacuumslash',4);
 c.castSkill2(p,enemies,'vacuumslash','mv-float');
 c.GT=2;c.sgTickVacuumWaves(ctx);
 assert.equal(events.filter(e=>e.variant==='wind-spin').length,1);
 assert.equal(c.SKILL2_RT.vacuumWaves.length,0);
});

test('暴風萬刃的追擊大刃／小刃沿表定連射間隔出生，不提前移動或命中',()=>{
 const {c,p,enemies,events,ctx}=setup('windblade',7,'stormMyriad');c.castSkill2(p,enemies,'windblade','mv-float');
 const fs=c.SKILL2_RT.grounds.filter(f=>f.kind==='windblade'),delayed=fs.filter(f=>f.startAt>0);
 assert.ok(delayed.length>0);assert.ok(delayed.some(f=>Math.abs(f.startAt-.2)<1e-9));assert.ok(delayed.some(f=>Math.abs(f.startAt-.4)<1e-9));
 const f=delayed.find(f=>Math.abs(f.startAt-.4)<1e-9),start={...f.pos};
 c.GT=.1;c.tickSkill2(.1,ctx);near(f.pos.x,start.x);near(f.pos.y,start.y);
 assert.ok(f.vfxId);assert.ok(!events.some(e=>e.area?.id===f.vfxId));
 c.GT=.45;c.tickSkill2(.05,ctx);assert.ok(Math.hypot(f.pos.x-start.x,f.pos.y-start.y)>0);
});

test('風切擴散每一配對從原受害者發射，保留原DOT，不在來源誤播命中',()=>{
 const {c,p,enemies,events}=setup('stormbarrier',5);c.Math.random=()=>0;
 c.castSkill2(p,enemies,'stormbarrier','mv-float');const from=enemies.find(e=>e._sgWindRendSpec),spec=from?from._sgWindRendSpec:null;assert.ok(spec);
 enemies[1]=h.enemy(1e9,from.pos.x+10,from.pos.y,'spread-destination');
 enemies[1].buffs={};enemies[1].dots=[];delete enemies[1]._sgWindRendSpec;
 c.sgSpreadWindRend(from,[from,enemies[1]],c.skills2Levels('stormbarrier'));
 const e=events.findLast(e=>e.variant==='wind-rend-spread');assert.deepEqual(Array.from(e.targets),[from.name,'spread-destination']);assert.deepEqual(Array.from(e.travelMs),[0,80]);
 near(c.sgFindDot(enemies[1],'sgWindCut').dps,c.sgFindDot(from,'sgWindCut').dps);
 const {b,rt}=adapter([marker('proj-wind-crescent'),marker('hit-wind')],1,{ctx:{playerPos:()=>({x:0,y:0}),posOf:id=>id===from.name?{x:20,y:0}:{x:50,y:0}}});
 rt.tryPlay(e);rt.update(.001);assert.equal(b.nodes.filter(n=>n.spec.assetUrl==='marker'&&n.t?.visible).length,1,'此刻只有飛行本體');
 rt.update(.09);rt.update(.001);assert.ok(b.nodes.some(n=>n.t?.visible&&Math.abs(n.t.x-50)<1e-6),'只在目的地播命中');rt.destroy();
});

for(const kind of ['blade','thunder','fire'])test(`天穹崩裂 ${kind}：固定落點、延後AOE、正確元素及表內借用`,()=>{
 const {c,p,events,enemies,ctx}=setup('stormbarrier',7,'skyfallStars');
 const captured=[];c.resolveHit=(a,d,cfg)=>{captured.push({target:d,elem:cfg.skillElem});return {dmg:100,miss:false};};
 const values=[.999,0,0,['blade','thunder','fire'].indexOf(kind)/3+.01];c.Math.random=()=>values.shift()??.999;
 c.GT=1;c.sgTickSkyfallStars(ctx,.05);c.GT=3;c.sgTickSkyfallStars(ctx,.05);
 const rain=events.find(e=>e.fxKind==='rain');assert.ok(rain);assert.equal(rain.elem,{blade:'wind',thunder:'lightning',fire:'fire'}[kind]);
 assert.equal(rain.area.fixedLanding,true);assert.equal(captured.length,0);
 const meteor=c.SKILL2_RT.meteors[0];assert.ok(meteor.fixedPos);assert.ok(!events.some(e=>e.fxKind==='projectile'));
 enemies[0].pos.x=1000;const arrival=h.enemy(1e9,40,0,'arrival');ctx.getEnemies=()=>[enemies[0],arrival];
 c.GT=meteor.at-.001;c.sgTickMeteors(ctx);assert.equal(captured.length,0);
 c.GT=meteor.at+.001;c.sgTickMeteors(ctx);assert.ok(captured.some(x=>x.target===arrival));assert.ok(!captured.some(x=>x.target===enemies[0]));
 assert.ok(captured.every(x=>x.elem===rain.elem));
 const roles=c.sgSkyfallVfxRoles(kind);if(kind==='blade')assert.equal(roles.projectile,'proj-wind-crescent');if(kind==='fire')assert.equal(roles.projectile,'proj-meteor');
 assert.ok(events.some(e=>e.variant==='skyfall-impact'&&e.vfx.attack===roles.attack));
});

test('天降風刃的畫面固定落點，目標移動不改落點，不回退水平發射',()=>{
 let target={x:160,y:40};const {b,rt}=adapter([marker('proj-wind-crescent')],1,{ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>target}});
 rt.tryPlay({fxKind:'rain',variant:'wind-blade',elem:'wind',targets:['a'],hit:false,area:{x:160,y:40,fixedLanding:true},travelMs:[1000],vfx:{projectile:'proj-wind-crescent'}});
 rt.update(.01);const n=b.nodes.find(n=>n.t?.visible);assert.ok(n.t.y<40);near(n.t.x,160);
 target={x:1000,y:500};rt.update(.89);near(n.t.x,160);assert.ok(n.t.y<40&&n.t.y>-460);rt.destroy();
});

test('永久風系超神倒地保留剩餘節拍，卸下停止生成',()=>{
 for(const [gid,ult,key,fn] of [['stormbarrier','skyfallStars','skyfallAt','sgTickSkyfallStars'],['vacuumslash','voidAnnihilation','voidAnnihilateAt','sgTickVoidAnnihilation']]){
  const {c,p,ctx}=setup(gid,7,ult);c.GT=1;c[fn](ctx,.1);const due=c.SKILL2_RT[key];p.hp=0;c.GT=1.5;c.tickSkill2(.5,ctx);near(c.SKILL2_RT[key],due+.5);
  p.hp=100;h.equip(c,'windblade');c[fn](ctx,.1);assert.equal(c.SKILL2_RT[key],0);
 }
});

for(const k of [.35,.5,.82])test(`多目標穿透風刃：八方向玩家起點、連續直線及傾角 ${k}`,()=>{
 for(let i=0;i<8;i++){
  const a=i*Math.PI/4,{b,rt}=adapter([marker('proj-wind-crescent')],k);
  rt.tryPlay({fxKind:'projectile',variant:'wind-blade',angle:a,lineLength:800,targets:['a','b'],travelMs:[4000],hit:false,vfx:{projectile:'proj-wind-crescent'}});
  rt.update(.1);const n=b.nodes.find(n=>n.t?.visible);assert.ok(n);near(n.t.x,100+Math.cos(a)*20);near(n.t.y,60+Math.sin(a)*20*k);angleNear(n.t.rotation,Math.atan2(Math.sin(a)*k,Math.cos(a)));
  const prev={...n.t};rt.update(.1);angleNear(n.t.rotation,Math.atan2(n.t.y-prev.y,n.t.x-prev.x));assert.equal(n.t.motionAngle,n.t.rotation);rt.destroy();
 }
});

for(const k of [.35,.5,.82])test(`追跡風刃：世界圓弧積分後壓縮Y，傾角 ${k}`,()=>{
 const {b,rt}=adapter([marker('ground-homing-wind-crescent')],k);
 const speed=180,turnRate=2,r=speed/turnRate;
 rt.tryPlay({fxKind:'aura',variant:'wind-blade-homing',dur:3,area:{id:'arc',x:100,y:100,r:15,speed,moveA:0,turnRate},vfx:{ground:'ground-homing-wind-crescent'}});
 rt.update(0);const n=b.nodes.find(n=>n.t?.visible);assert.ok(n);for(let i=0;i<12;i++){
  const prev={...n.t};rt.update(1/60);const t=(i+1)/60;
  near(n.t.x,100+r*Math.sin(turnRate*t));near(n.t.y,(100+r*(1-Math.cos(turnRate*t)))*k);
  angleNear(n.t.rotation,Math.atan2(n.t.y-prev.y,n.t.x-prev.x));
 }rt.destroy();
});

test('FOV下風刃根航向跟隨投影路徑，保留全部美術圖層局部角度與相對位置',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../js/battle-renderer.js'),'utf8');
 const c={Math,S:{layers:{world:{x:17,y:-29}},persp:null}};vm.createContext(c);
 for(const name of ['perspectiveLayout','airScreenPose','projectedWarp','depthScaleOf','projectAirTransform'])vm.runInContext(extractFunction(src,name),c);
 for(const scale of [.65,.82,1])for(const x of [20,350,680])for(const y of [20,330,650])for(let i=0;i<8;i++){
  c.S.persp={layout:c.perspectiveLayout(700,680,scale)};const a=i*Math.PI/4;
  const p=c.airScreenPose(x,y),q=c.airScreenPose(x+Math.cos(a)*.0001,y+Math.sin(a)*.0001),expected=Math.atan2(q.y-p.y,q.x-p.x);
  for(const local of [0,-Math.PI/2,.7]){
   const t={x:x+5,y:y-7,rotation:a+local,scaleX:2,scaleY:3,motionX:x,motionY:y,motionAngle:a};const out=c.projectAirTransform(t);
   near(Math.atan2(Math.sin(out.rotation-local-expected),Math.cos(out.rotation-local-expected)),0,'投影切線方向',1e-6);near(out.scaleX/out.scaleY,2/3);
   near(Math.hypot(out.x-p.x,out.y-p.y),Math.hypot(5,7)*p.scale,'圖層相對位置整份保形');assert.equal(t.rotation,a+local);
  }
  const fixed={x:x+5,y:y-7,rotation:.7,scaleX:2,scaleY:3,motionX:x,motionY:y,motionAngle:a,followDirection:false,cameraDepth:false};
  const still=c.projectAirTransform(fixed);near(still.rotation,.7,'關閉followDirection保留作者方向');near(still.scaleX,2,'關閉cameraDepth保留原大小');near(Math.hypot(still.x-p.x,still.y-p.y),Math.hypot(5,7));
 }
 c.S.persp=null;const t={x:10,y:20,rotation:1,scaleX:2,scaleY:3,motionX:10,motionY:20,motionAngle:1};const out=c.projectAirTransform(t);near(out.x,27);near(out.y,-9);near(out.rotation,1);
});

test('Core只有明確motionFacing事件攜帶根航向，回收重用不污染一般特效',()=>{
 const {b,rt}=adapter([marker('proj-wind-crescent',{rotation:.7})],1);
 rt.tryPlay({fxKind:'projectile',variant:'wind-blade',angle:1,lineLength:800,travelMs:[200],hit:false,vfx:{projectile:'proj-wind-crescent'}});rt.update(.1);
 assert.ok(b.nodes.some(n=>n.t?.visible&&n.t.motionAngle!==undefined));rt.clear();
 rt.tryPlay({fxKind:'projectile',variant:'generic',angle:0,lineLength:800,travelMs:[200],hit:false,vfx:{projectile:'proj-wind-crescent'}});rt.update(.05);
 assert.ok(b.nodes.filter(n=>n.t?.visible).every(n=>n.t.motionAngle===undefined));rt.destroy();
});

test('未命中的真空斬及暴風撕裂只播攻擊本體，不播受害者命中特效',()=>{
 for(const gid of ['vacuumslash','stormbarrier']){
  const {c,p,events,enemies}=setup(gid,2);c.resolveHit=()=>({miss:true,dmg:0});c.castSkill2(p,enemies,gid,'mv-float');
  assert.ok(events.length);assert.ok(events.every(e=>!e.vfx?.hit));
 }
});

test('追擊風刃及沿途脈衝只在成功命中時播受害者特效，空場及MISS仍保留本體',()=>{
 const {c,p,events,enemies}=setup('windblade',7,'stormMyriad');c.resolveHit=()=>({miss:true,dmg:0});c.castSkill2(p,enemies,'windblade','mv-float');h.advance(c,p,enemies,1);
 assert.ok(events.some(e=>e.variant==='wind-blade-homing'&&e.vfx.ground));
 assert.ok(events.some(e=>e.variant==='wind-burst'&&e.vfx.attack));assert.ok(events.every(e=>!e.vfx?.hit));
 const direct=setup('windblade',6);direct.c.resolveHit=()=>({miss:true,dmg:0});direct.c.castSkill2(direct.p,direct.enemies,'windblade','mv-float');h.advance(direct.c,direct.p,direct.enemies,1);
 assert.ok(direct.events.some(e=>e.variant==='wind-burst'));assert.ok(direct.events.every(e=>!e.vfx?.hit));
});

test('真空斬與震波使用世界半徑／角度後單次投影，傾斜不可再次縮短斬擊',()=>{
 for(const id of ['slash-wind-crescent','slash-wind-spin','burst-vacuum-shockwave']){
  const p=preset(id);assert.ok(Core.validatePreset(p).ok);assert.ok(p.layers.filter(l=>l.enabled!==false).every(l=>l.projection?.y===.5));
 }
 for(const id of ['slash-wind-crescent','burst-vacuum-shockwave'])for(const k of [.35,.5,.82])for(const a of [0,Math.PI/4,Math.PI/2,Math.PI]){
  const p=preset(id),mark={...p,layers:[{id:'mark',type:'sprite',assetId:'marker',projection:{x:1,y:.5}}]},base=adapter([mark],1),tilt=adapter([mark],k);
  const spec={fxKind:'slash',variant:id==='slash-wind-crescent'?'wind-slash':'vacuum-shock',angle:a,lineLength:60,hit:false,vfx:{attack:id}};
  base.rt.tryPlay(spec);tilt.rt.tryPlay(spec);base.rt.update(.05);tilt.rt.update(.05);
  const b=base.b.nodes.find(n=>n.t?.visible),t=tilt.b.nodes.find(n=>n.t?.visible);assert.ok(b&&t);
  // 比較完整變換矩陣的兩軸，投影後scale／skew分解會隨角度改變。
  const mat=v=>[Math.cos(v.rotation)*v.scaleX,Math.sin(v.rotation)*v.scaleX,-Math.sin(v.rotation-(v.skewX||0))*v.scaleY,Math.cos(v.rotation-(v.skewX||0))*v.scaleY];
  const bm=mat(b.t),tm=mat(t.t);near(tm[0],bm[0]);near(tm[1],bm[1]*k);near(tm[2],bm[2]);near(tm[3],bm[3]*k);base.rt.destroy();tilt.rt.destroy();
 }
});

test('清空追加觸發欄位時不回退到別階或其他超神素材',()=>{
 const {c,p,enemies,events}=setup('vacuumslash',7,'vacuumOmen');
 c.SKILLS2.vacuumslash.tiers[6].triggerVfx={};c.SKILLS2.vacuumslash.ult[0].triggerVfx={};c.Math.random=()=>0;
 c.castSkill2(p,enemies,'vacuumslash','mv-float');h.advance(c,p,enemies,.2);
 for(const e of events.filter(e=>e.variant==='void-disc'||e.variant==='vacuum-static'))assert.ok(!Object.values(e.vfx||{}).some(Boolean));
 assert.ok(events.some(e=>e.variant==='wind-spin'&&e.vfx.attack==='slash-wind-spin'),'本體保留第四階');
});
