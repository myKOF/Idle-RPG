'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{createEngine}=require('../scripts/sim/engine');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
const projectile=require('../vfx/presets/proj-wind-crescent-09.json');
const ground=require('../vfx/presets/ground-homing-wind-crescent-09.json');
const impact=require('../vfx/presets/hit-wind.json');
const helperFile=path.join(__dirname,'skill2-windblade-vacuum-legendary.test.cjs');
const h={require:createRequire(helperFile),__dirname,console};vm.createContext(h);
vm.runInContext(fs.readFileSync(helperFile,'utf8').split("test('")[0],h);
function setup(lv=1) {
  const c=h.loadContext(),p=h.playerEnt();p.hp=1000;p.mp=10000;p.pos={x:0,y:0};
  h.maxLevels(c,'windblade');h.equip(c,'windblade');h.setUlt(c,'windblade','stormMountain',lv);
  c.BASE_STATS.elemDmgUp={wind:800,earth:500};c.rnd=()=>1;c.chance=pct=>pct>=100;
  const m=h.enemy(1e9,20,0,'target');c.FIELD={player:p,enemies:[m],dpsWindow:[]};
  const events=h.stubVfx(c),floats=[];c.floatPlayerEvent=(...args)=>floats.push(args);
  return {c,p,m,events,floats};
}
function hit(s,gid='windblade',damage=100) {
  return s.c.sgHitOne(s.p,s.c.BASE_STATS,s.m,damage,gid,'mv-float',{dmg:0,killed:false,crit:false},0);
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≠ ${b}`);

function visualSetup(roles) {
  const c=createEngine({seed:9}).boot(null).ctx;
  c.G.player.level=1000;c.G.player.skills2={levels:{windblade:Array(7).fill(10)},ult:{windblade:{pick:1,lv:1}}};
  const stats=h.loadContext().BASE_STATS;
  c.G.player.loadout=['sg:windblade'];c.getStats=()=>stats;
  const p=h.playerEnt(),m=h.enemy(1e15,0,200,'target');p.mp=10000;p.pos={x:0,y:0};p._lockTarget=m;
  c.FIELD.player=p;c.FIELD.enemies=[m];c.Math.random=()=>.5;c.rnd=()=>1;c.chance=pct=>pct>=100;
  if(roles)c.SKILLS2.windblade.ult[1].triggerVfx=roles;
  c.shimDrainUrgentVisualEvents();assert.ok(c.castSkill2(p,[m],'windblade','mv-float'));
  return {c,p,m,initial:c.shimDrainUrgentVisualEvents()};
}

test('嵐之山觸發欄：直射小刃讀子彈與命中、沿途風爆讀超神觸發、本體保持原欄',()=>{
  const s=visualSetup();
  assert.equal(s.initial.filter(e=>e.variant==='wind-blade'&&e.fxKind==='projectile').length,8);
  for(const e of s.initial.filter(e=>e.variant==='wind-blade'&&e.fxKind==='projectile'))
    assert.equal(e.vfx.projectile,s.c.sgVfxRoles('windblade').projectile);
  h.advance(s.c,s.p,[s.m],.6);
  const pulses=s.c.shimDrainUrgentVisualEvents().filter(e=>e.variant==='wind-burst');
  assert.ok(pulses.length>0,'沿途雙圓環仍由第六階脈衝機制產生');
  for(const e of pulses)assert.equal(e.vfx.attack,'burst-wind-09','嵐之山觸發特效覆寫風爆外觀');
  // 直接驗證直射小刃的共用發射入口，隔離其他刃與沿途脈衝。
  s.c.SKILL2_RT.projectiles=[];s.c.SKILL2_RT.grounds=[];
  const geom=s.c.sgWindbladeGeom(s.c.SKILLS2.windblade,s.c.skills2Levels('windblade'),{});
  s.c.sgLaunchWindBlade(s.p,s.c.getStats(),'windblade',{
    geom,angle:Math.PI/2,dmgVal:100,pool:[s.m],geomOk:true,fallback:[s.m],small:true,vfxUlt:'stormMountain'
  },'mv-float',{dmg:0,killed:false,crit:false});
  const launch=s.c.shimDrainUrgentVisualEvents().filter(e=>e.variant==='wind-blade-small'&&e.fxKind==='projectile');
  assert.equal(launch.length,1);
  for(const e of launch){assert.equal(e.vfx.projectile,projectile.id);assert.equal(e.hit,false);}
  h.advance(s.c,s.p,[s.m],2);
  const hits=s.c.shimDrainUrgentVisualEvents().filter(e=>e.vfx&&e.vfx.hit===impact.id&&e.hit!==false);
  assert.ok(hits.length>0,'直射小刃實際接觸才播放觸發命中特效');
  assert.ok(s.m.hp<1e15);
});

test('嵐之山正式Worker→Runtime：兩組件共用位置／航向／尺寸、續播不重建、命中才播及七秒到期回收',()=>{
  const s=visualSetup(),fields=s.c.SKILL2_RT.grounds,ids=new Set(fields.map(f=>f.vfxId));
  assert.equal(fields.length,8);assert.equal(s.c.SKILL2_RT.projectiles.length,8);
  assert.equal(s.initial.filter(e=>e.hit!==false&&e.vfx&&e.vfx.hit===impact.id).length,0);
  const nodes=[],backend={createNode(spec){const n={asset:spec.assetUrl,alive:true};nodes.push(n);return n;},
    updateNode(n,t){n.t={...t};},destroyNode(n){n.alive=false;}};
  const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},groundScale:.65,profile:{scale:.8,areaScale:.4},
    fxBackend:backend,airBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>s.p.pos,posOf:()=>s.m.pos}});
  // 保留正式素材的尺寸、時長與loop設定，中心標記排除圖層自身旋轉／粒子。
  rt.registerPresets([projectile,ground,impact].map(p=>({...p,layers:[{id:'body',type:'sprite',assetId:p.id}]})));
  const seen=new Set(),hits=[];
  function advance(sec){for(let t=0;t<sec-1e-9;t+=.05){
    h.advance(s.c,s.p,[s.m],.05);
    for(const e of s.c.shimDrainUrgentVisualEvents()){
      if(e.variant==='wind-blade-homing'){
        assert.ok(ids.has(e.area.id));const known=seen.has(e.area.id),played=rt.stats().played;seen.add(e.area.id);
        assert.equal(e.vfx.projectile,projectile.id);assert.equal(e.vfx.ground,ground.id);assert.equal(e.hit,false);
        assert.equal(rt.tryPlay(e),true);
        assert.equal(rt.stats().played-played,known?0:2,'重送位置只更新現有Core特效，不透過節點池重播本體');
      }else if(e.hit!==false&&e.vfx&&e.vfx.hit===impact.id){hits.push(e);rt.tryPlay(e);}
    }rt.update(.05);
  }}
  advance(.6);assert.equal(seen.size,8);assert.equal(rt.stats().grounds,16);
  const bodyNodes=()=>nodes.filter(n=>n.asset===projectile.id||n.asset===ground.id);
  assert.equal(bodyNodes().length,16);
  const groups=bodyNodes();
  for(let i=0;i<groups.length;i+=2){const a=groups[i],b=groups[i+1];
    assert.notEqual(a.asset,b.asset);near(a.t.x,b.t.x);near(a.t.y,b.t.y);near(a.t.rotation,b.t.rotation);
    near(a.t.scaleX,b.t.scaleX);near(a.t.scaleY,b.t.scaleY);
    near(a.t.scaleX,.96);near(a.t.scaleY,.96);
  }
  for(let frame=0;frame<3;frame++){
    const old=groups.map(n=>({...n.t}));rt.update(1/60);
    groups.forEach((n,i)=>near(n.t.rotation,Math.atan2(n.t.y-old[i].y,n.t.x-old[i].x)));
  }
  advance(6.3);assert.equal(bodyNodes().length,16,'短於追擊壽命的非loop子彈也不得重建本體');
  assert.ok(hits.length>0);assert.ok(s.m.hp<1e15,'真實追蹤命中造成傷害');
  assert.equal(s.c.SKILL2_RT.grounds.length,8);
  advance(.5);assert.equal(s.c.SKILL2_RT.grounds.length,0);rt.update(1);
  assert.equal(rt.stats().grounds,0);assert.ok(bodyNodes().every(n=>n.t.visible===false),'到期節點已隱藏回收進池');
  rt.destroy();assert.ok(bodyNodes().every(n=>!n.alive));
});

test('嵐之山風爆：觸發留白只停外觀、不停傷害；未選嵐之山與跨技能借用保持第六階',()=>{
  const s=visualSetup({});h.advance(s.c,s.p,[s.m],1);
  const events=s.c.shimDrainUrgentVisualEvents(),pulses=events.filter(e=>e.variant==='wind-burst');
  assert.ok(pulses.length>0);for(const e of pulses)assert.equal(e.vfx.attack,undefined);
  assert.ok(s.m.hp<1e15);assert.equal(s.c.sgWindbladePulseAttack('vacuumslash'),'burst-wind');
  s.c.G.player.skills2.ult.windblade=null;
  assert.equal(s.c.sgWindbladePulseAttack('windblade'),'burst-wind');
});

for(const role of ['projectile','ground','hit','none'])test(`嵐之山三欄獨立：只填${role}，其餘留白不繼承`,()=>{
  const roles=role==='none'?{}:{[role]:{projectile:projectile.id,ground:ground.id,hit:impact.id}[role]},s=visualSetup(roles);
  s.c.SKILL2_RT.projectiles=[];
  h.advance(s.c,s.p,[s.m],2);
  const events=s.c.shimDrainUrgentVisualEvents(),moving=events.filter(e=>e.variant==='wind-blade-homing');
  assert.ok(moving.length>0);
  for(const e of moving){
    assert.equal(e.vfx.projectile,roles.projectile);assert.equal(e.vfx.ground,roles.ground);assert.equal(e.hit,false);
  }
  const hits=events.filter(e=>e.variant==='wind-blade-contact'&&e.hit!==false);
  assert.ok(hits.length>0);
  for(const e of hits)assert.equal(e.vfx.hit,roles.hit);
  assert.ok(s.m.hp<1e15,'所有空欄仍保留技能實際命中');
});

test('嵐之山：800%×75%＋500%×50%=850%，不歸一增傷係數、不重複基礎傷害',()=>{
  const s=setup(),fx=s.c.SKILLS2.windblade.ult[1].fx;
  fx.windPctPer=0;fx.earthPctPer=0;
  const cfg=s.c.sgAtkCfg(s.p,s.c.BASE_STATS,100,s.m,0,'windblade');
  near(cfg.skillElemDmgUpPct,850);assert.equal(cfg.skillElem,undefined);
  const mix=s.c.skillElemMixOf(cfg);near(mix.wind,.6);near(mix.earth,.4);
  assert.equal(hit(s).dmg,950);
  s.c.BASE_STATS.elemDmgUp={wind:0,earth:0};assert.equal(hit(s).dmg,100);
  assert.deepEqual(s.c.BASE_STATS.elemDmgUp,{wind:0,earth:0},'不污染角色的原始屬性表');
});

for(const lv of [1,10]) test(`嵐之山 Lv.${lv}：風地係數升級、擊殺回復最大生命比例護盾且只一次`,()=>{
  const s=setup(lv),expected=lv===1?935:1700;
  const cfg=s.c.sgAtkCfg(s.p,s.c.BASE_STATS,100,s.m,0,'windblade');near(cfg.skillElemDmgUpPct,expected);
  assert.equal(hit(s).dmg,100*(1+expected/100));assert.equal(s.p.shield,0,'未擊殺不回復擊殺護盾');
  s.m.hp=1;assert.equal(hit(s).killed,true);near(s.p.shield,lv===1?22:40);
  assert.equal(s.p.shieldMax,s.p.shield);assert.equal(s.floats.length,1);assert.equal(s.floats[0][0],'mv-float');
  assert.equal(hit(s),null);near(s.p.shield,lv===1?22:40);assert.equal(s.floats.length,1);
});

test('嵐之山：風地抗性與風系外部乘區分別套用，無額外屬性傷害段',()=>{
  const s=setup();s.m.resist={wind:600,earth:250};
  const cfg=s.c.sgAtkCfg(s.p,s.c.BASE_STATS,100,s.m,0,'windblade');
  cfg.skillElemAmp={wind:2};
  const wind=s.c.elementalResistanceMultiplier(s.m.resist,'wind',s.c.BASE_STATS.level);
  const earth=s.c.elementalResistanceMultiplier(s.m.resist,'earth',s.c.BASE_STATS.level);
  const r=s.c.resolveHit(s.p,s.m,cfg,s.c.monsterDefCfg(s.m));
  assert.equal(r.dmg,Math.round(100*10.35*(.6*wind*2+.4*earth)));
  s.c.chance=pct=>pct>0;
  const procs=s.c.resolveHit(s.p,s.m,cfg,s.c.monsterDefCfg(s.m));
  assert.ok(procs.procs.includes('岩甲'),'地系分量參與既有屬性效果判定');
});

test('嵐之山擊殺盾：護盾效率、上限、禁盾、未擊殺／其他技能／卸下保護及高塔定址',()=>{
  for(const mode of ['efficiency','cap','blocked','otherSkill','inactive','tower']) {
    const s=setup();s.m.hp=1;
    if(mode==='efficiency')s.c.BASE_STATS.shieldEff=100;
    if(mode==='cap'){s.p.shield=9995;s.p.shieldMax=9995;}
    if(mode==='blocked')s.c.skills2ShieldBlocked=()=>true;
    if(mode==='inactive')s.c.G.player.skills2.ult.windblade=null;
    if(mode==='tower')s.c.playerEventFloatTarget=()=> 'tp-float';
    assert.equal(hit(s,mode==='otherSkill'?'vacuumslash':'windblade').killed,true);
    const expected={efficiency:44,cap:10000,blocked:0,otherSkill:0,inactive:0,tower:22}[mode];
    near(s.p.shield,expected);
    if(mode==='tower')assert.equal(s.floats[0][0],'tp-float');
  }
});

test('雙屬性歸屬相容：非法／未知權重退回單屬性，缺省保留既有傷害與不修改輸入',()=>{
  const {c}=setup();
  for(const skillElemMix of [{wind:0,earth:-1},{wind:NaN,earth:Infinity},{wind:'1'},{unknown:1}]) {
    assert.equal(c.skillElemMixOf({skillElem:'wind',skillElemMix}).wind,1);
  }
  const cfg={skillElemMix:{wind:3,earth:2}};
  near(c.skillElemMixOf(cfg).wind,.6);near(cfg.skillElemMix.wind,3);
  assert.equal(c.skillElemMixOf({}),null);
  const s=setup();s.c.G.player.skills2.ult.windblade=null;
  assert.equal(hit(s).dmg,900,'沒有嵐之山時仍只吃完整風系提升');
});

test('正式Worker：大小刃／沿途脈衝皆使用加權雙屬性；事件尺寸數量正常且實際擊殺盾回復',()=>{
  const c=createEngine({seed:9}).boot(null).ctx;
  c.G.player.level=1000;c.G.player.skills2={levels:{windblade:Array(7).fill(10)},ult:{windblade:{pick:1,lv:1}}};c.G.player.loadout=['sg:windblade'];
  const stats={...h.loadContext().BASE_STATS,elemDmgUp:{wind:800,earth:500}};
  c.getStats=()=>stats;
  const p=h.playerEnt();p.hp=1000;p.mp=10000;p.pos={x:0,y:0};
  const m=h.enemy(1e15,100,0,'target');p._lockTarget=m;c.FIELD.player=p;c.FIELD.enemies=[m];c.Math.random=()=>.5;c.rnd=()=>1;c.chance=pct=>pct>=100;
  c.shimDrainUrgentVisualEvents();assert.ok(c.castSkill2(p,[m],'windblade','mv-float'));
  assert.equal(c.SKILL2_RT.projectiles.length,8);assert.equal(c.SKILL2_RT.grounds.length,8);
  const bodies=c.shimDrainUrgentVisualEvents().filter(e=>e.variant==='wind-blade'&&e.fxKind==='projectile');
  assert.equal(bodies.length,8);for(const e of bodies){near(e.bodyLength,64);near(e.lineWidth,128);}
  const calls=[],resolve=c.resolveHit;
  c.resolveHit=(a,b,cfg,def)=>{calls.push(cfg);return resolve(a,b,cfg,def);};
  h.advance(c,p,[m],1.5);
  for(const damage of [5850,3510,2925])assert.ok(calls.some(a=>Math.abs(a.atk-damage)<1e-8),`本體／小刃／脈衝${damage}須實際命中`);
  for(const cfg of calls){near(cfg.skillElemDmgUpPct,935);near(c.skillElemMixOf(cfg).earth,.4);}
  m.hp=1;const before=p.shield;
  h.advance(c,p,[m],2);
  assert.equal(m.hp,0);near(p.shield-before,22);
  const shield=c.shimDrainEvents().find(e=>e.kind==='float'&&e.cls.includes('shield'));
  assert.ok(shield,'正式Worker須產生護盾回復飄字');assert.equal(shield.elId,'pv-float');
});
