'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),Core=require('../js/vfx-core'),Runtime=require('../js/vfx-runtime');
function setup(lv=1){
 const c={console,Math:Object.create(Math),setTimeout(){},clearTimeout(){},document:{addEventListener(){},getElementById(){return null},querySelectorAll(){return[]}},UI:{dirty:{}},blog(){},floatText(){},trackDps(){},recordRunDamage(){}};c.window=c;vm.createContext(c);
 for(const f of ['util','data','status','formula','battlefield','combat','skills','skills2','legendary'])vm.runInContext(fs.readFileSync(path.join(root,'js',f+'.js'),'utf8'),c,{filename:f});
 c.G={player:{gold:0,skills2:{levels:{rockarmor:[10,10,10,10,10,10,10]},ult:{rockarmor:{pick:c.sgUltIndexOfId('rockarmor','superRockArt'),lv}}},loadout:[c.SG_PREFIX+'rockarmor']},stage:{current:1}};
 const st={atk:1000,matk:500,hp:1000,mp:500,level:10,aspd:2,cdr:0,critRate:0,critDmg:150,hit:100,tenacity:0,shieldEff:0,passives:{},elemAtk:null,elemDmgPct:0,elemDmgUp:{},totalDmgPct:0,legendaryEffects:{},legendaryEffectMults:{}};c.getStats=()=>st;c.GT=0;
 const p={hp:1000,mp:1e9,shield:0,shieldMax:0,skillCds:{},buffs:{},dots:[],effects:{}};
 const events=[],hits=[],damage=[];let deaths=0;
 c.playCombatVfx=s=>events.push({...s,at:c.GT});c.enemyEventFloatTarget=e=>e.name;c.playerEventFloatTarget=s=>s;
 const resolveHit=c.resolveHit;
 c.resolveHit=(a,e,cfg,def)=>{hits.push({at:c.GT,e,cfg,def});return {dmg:100,miss:false,crit:false,killed:false}};
 c.applySkillFinalDamageMultiplier=()=>{};
 const ctx={pEnt:p,getEnemies:()=>enemies,floatSel:'mv-float',onDamage:d=>damage.push(d),onDeaths:()=>deaths++};let enemies=[];
 return {c,p,st,events,hits,damage,ctx,resolveHit,setEnemies:e=>enemies=e,cast(e){enemies=e;c.castSkill2(p,e,'rockarmor','mv-float')},tick(at){const dt=at-c.GT;c.GT=at;c.tickSkill2(dt,ctx)},deaths:()=>deaths};
}
function enemy(id,x=40,y=0){return {name:'e'+id,hp:1e9,maxHp:1e9,atk:10,matk:10,def:0,mdef:0,level:1,attr:'wind',resist:{},ctrlRes:0,effects:{},buffs:{},dots:[],pos:{x,y}}}
const pillars=h=>h.events.filter(s=>s.variant==='rock-pillar');
test('岩柱：寬高增加30%，升起後不再停留，0.5秒內消失',()=>{
 const preset=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets/pillar-rock-spike.json')));
 const nodes=[],rt=Core.createRuntime({resolver:{resolve:id=>id},backend:{createNode(s){const n={s};nodes.push(n);return n},updateNode(n,t){n.t={...t}},destroyNode(n){n.dead=true}}});
 rt.registerPreset(preset);const ref=rt.play(preset.id);
 rt.update(.15);const stone=nodes.find(n=>n.s.layerId==='stone')||nodes[1],grown={...stone.t};
 assert.ok(grown.alpha>.99);assert.ok(grown.scaleY>0);
 assert.equal(grown.scaleX*128,26);assert.equal(grown.scaleY*384,78);
 rt.update(.175);assert.ok(stone.t.alpha<grown.alpha);assert.ok(stone.t.scaleY<grown.scaleY);
 rt.update(.176);assert.equal(rt.timeOf(ref),null);rt.destroy();
 const h=setup();h.cast([enemy(1)]);for(let i=1;i<=8;i++)h.tick(i*.5);assert.equal(pillars(h).length,32);assert.equal(h.hits.length,8);
});
test('岩柱：正式area事件走billboard，各方位／FOV不改柱身大小或垂直角度',()=>{
 const preset=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets/pillar-rock-spike.json'))),nodes=[];
 const backend=kind=>({createNode:s=>({s,kind}),updateNode(n,t){nodes.push({kind,t:{...t}})},destroyNode(){},destroy(){}});
 const a=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},fxBackend:backend('scene'),billboardBackend:backend('billboard'),ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});
 a.registerPresets([preset]);a.tryPlay({fxKind:'burst',variant:'rock-pillar',area:{x:200,y:100},sizeMult:0,targets:[],vfx:{attack:preset.id}});a.update(.15);
 assert.ok(nodes.length>0);assert.ok(nodes.every(n=>n.kind==='billboard'));
 const {extractFunction}=require('./helpers/battle-scene.cjs'),source=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8');
 const c={Math,Object,isFinite,S:{layers:{world:{x:-20,y:40}}}};vm.createContext(c);
 for(const name of ['perspectiveLayout','airScreenPose','projectedWarp','depthScaleOf','projectBillboardTransform'])vm.runInContext(extractFunction(source,name),c);
 const stone=nodes.find(n=>n.t.tint===0xffffff).t;assert.equal(stone.perspective,false);assert.equal(stone.cameraDepth,false);
 for(const top of [.6,.82,1])for(const [x,y] of [[100,100],[700,100],[100,700],[700,700],[400,400]]){
  c.S.persp={layout:c.perspectiveLayout(800,800,top)};
  const out=c.projectBillboardTransform({...stone,x,y,sortY:y}),foot=c.airScreenPose(x,y);
  assert.equal(out.x,foot.x);assert.equal(out.y,foot.y);assert.equal(out.rotation,0);assert.equal(out.skewX,0);
  assert.equal(out.scaleX*128,26);assert.equal(out.scaleY*384,78);
 }
 a.destroy();
});
test('超重岩：24米邊界、每級石化時間與轉地到期還原，取消舊易傷',()=>{
 for(const lv of [1,5,10]){
  const h=setup(lv),{c}=h,r=c.bfMeterPx(24)+c.bfEntityRadius(null),near=enemy(1,r),far=enemy(2,r+.01);
  h.cast([near,far]);assert.equal(c.monsterDefCfg(near).attr,'earth');assert.equal(c.monsterAtkCfg(near,1).attr,'earth');assert.equal(c.monsterDefCfg(far).attr,'wind');
  assert.equal(near.buffs.sgPetrify.until,2+.2*lv);assert.equal(near.effects.stun,near.buffs.sgPetrify.until);
  assert.equal(c.skill2VulnACfg({totalDmgPct:0},near).skillElemAmp,undefined);
  c.GT=2+.2*lv;assert.equal(c.skill2ForcedAttr(near),'');assert.equal(c.monsterDefCfg(near).attr,'wind');assert.equal(near.attr,'wind');
 }
});
test('超重岩：BOSS免控不轉地，控場遞減同步縮短石化與轉地',()=>{
 const h=setup(),{c}=h,boss=enemy(1);boss.isBoss=true;h.cast([boss]);assert.equal(c.skill2ForcedAttr(boss),'');assert.equal(c.effectActive(boss,'stun'),false);
 const m=enemy(2);m._spawnAt=0;c.sgTryStun(m,2.2,{gid:'rockarmor',tier:'superRockArt',idx:0});c.GT=3;c.sgRockPetrifyApply([m],c.sgUlt('rockarmor','superRockArt'),'mv-float');
 assert.ok(m.buffs.sgPetrify.until-c.GT<2.2);assert.equal(m.buffs.sgPetrify.until,m.ccLock.act);
});
test('超重岩：八波32柱，逐波四名不同目標與完整地傷／升級倍率',()=>{
 for(const lv of [1,10]){
  const h=setup(lv);h.c.Math.random=()=>.25;const enemies=Array.from({length:6},(_,i)=>enemy(i,40+i*20));h.cast(enemies);
  assert.equal(pillars(h).length,0);h.tick(.499);assert.equal(h.hits.length,0);
  for(let n=1;n<=8;n++){h.tick(n*.5);const hits=h.hits.filter(v=>v.at===n*.5);assert.equal(hits.length,4);assert.equal(new Set(hits.map(v=>v.e)).size,4);hits.forEach(v=>{assert.equal(v.cfg.atk,500*(200+20*lv)/100);assert.equal(v.cfg.skillElem,'earth')})}
  assert.equal(pillars(h).length,32);assert.equal(h.damage.reduce((a,b)=>a+b,0),3200);assert.equal(h.c.SKILL2_RT.rockPillars,null);assert.equal(h.c.sgRoleBuffActive(h.p,'petrifyDomain'),false);
  h.tick(5);assert.equal(h.hits.length,32);
 }
});
test('超重岩：不足敵人仍每波四柱，空地位置在24米內且不造成額外傷害',()=>{
 for(const count of [0,1,3]){
  const h=setup();h.c.Math.random=()=>.25;const enemies=Array.from({length:count},(_,i)=>enemy(i,30+i*30));h.cast(enemies.length?enemies:[enemy('outside',299)]);h.setEnemies(enemies);h.tick(.5);
  assert.equal(pillars(h).length,4);assert.equal(h.hits.length,count);
  for(const evt of pillars(h)){assert.equal(evt.area.r,undefined);assert.ok(Math.hypot(evt.area.x,evt.area.y)<=240);assert.equal(evt.vfx.attack,'pillar-rock-spike');assert.equal(evt.targets.length,0)}
  assert.equal(h.events.filter(v=>v.variant==='rock-pillar-hit').length,count);
 }
});
test('超重岩：每波使用最新玩家位置及存活敵群，新進範圍者不重複石化',()=>{
 const h=setup(),old=enemy(1),fresh=enemy(2,1000);h.cast([old,fresh]);h.tick(.5);old.hp=0;h.c.BF_PLAYER.x=1000;h.setEnemies([fresh]);h.tick(1);
 assert.equal(h.hits.at(-1).e,fresh);assert.equal(h.c.skill2ForcedAttr(fresh),'');assert.equal(pillars(h).find(v=>v.at===1).area.x,1000);
});
test('超重岩：岩甲先到期仍完成4秒岩柱，死亡／卸裝／換場取消排程',()=>{
 const h=setup();h.cast([enemy(1)]);h.c.SKILL2_RT.rock.until=.1;h.tick(.5);assert.equal(h.c.SKILL2_RT.rock,null);h.tick(4);assert.equal(pillars(h).length,32);
 for(const cancel of [h=>h.p.hp=0,h=>h.c.G.player.loadout=[],h=>h.c.resetSkill2RT()]){
  const h=setup();h.cast([enemy(1)]);h.tick(.5);const before=h.hits.length;cancel(h);h.tick(2);assert.equal(h.hits.length,before);assert.equal(h.c.SKILL2_RT.rockPillars,null)
 }
});
test('超重岩：成功傷害回報死亡，MISS只播放柱體、不播放命中',()=>{
 for(const miss of [true,false]){const h=setup();h.cast([enemy(1)]);h.c.resolveHit=()=>({dmg:miss?0:100,miss,killed:!miss});h.tick(.5);assert.equal(h.events.filter(v=>v.variant==='rock-pillar-hit').length,miss?0:1);assert.equal(h.damage.length,miss?0:1);assert.equal(h.deaths(),miss?0:1)}
});
test('超重岩：真實resolveHit扣血、地抗性生效，每波僅選四名且隨機重選',()=>{
 const results=[];
 for(const earth of [0,50]){
  const h=setup(),e=enemy(1);e.resist.earth=earth;h.cast([e]);h.c.resolveHit=h.resolveHit;h.c.chance=pct=>pct>=100;h.c.Math.random=()=>.5;const hp=e.hp;h.tick(.5);
  assert.ok(e.hp<hp);assert.equal(h.damage[0],hp-e.hp);results.push(hp-e.hp);
 }
 assert.ok(results[1]<results[0],'實際地抗性減少地傷');
 const h=setup(),enemies=Array.from({length:8},(_,i)=>enemy(i,30+i*10));h.cast(enemies);h.c.Math.random=()=>0;h.tick(.5);const first=h.hits.map(v=>v.e.name);
 h.c.Math.random=()=>.999;h.tick(1);assert.notDeepEqual(h.hits.slice(4).map(v=>v.e.name),first);
});
test('超重岩：石化優先轉地，到期恢復既有火獄覆寫，控場歸零不再掛石化',()=>{
 const h=setup(),e=enemy(1);h.c.applyStatus(e,'sgInferno',{val:1,dur:10});h.cast([e]);assert.equal(h.c.skill2ForcedAttr(e),'earth');h.c.GT=2.2;assert.equal(h.c.skill2ForcedAttr(e),'fire');
 const immune=enemy(2);immune._spawnAt=0;immune.ccDr={act:{n:100,last:-100,f:0}};immune.ccLock={act:0};h.c.sgRockPetrifyApply([immune],h.c.sgUlt('rockarmor','superRockArt'),'mv-float');assert.equal(h.c.skill2ForcedAttr(immune),'');assert.equal(h.c.sgRoleBuffActive(immune,'petrify'),false);
});
test('超重岩：正式岩柱在八方精確座標保留直立方向與原尺寸，空角色不補圖',()=>{
 const preset=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets/pillar-rock-spike.json')));assert.equal(Core.validatePreset(preset).ok,true);
 for(let i=0;i<8;i++){
  const calls=[],core={...Core,createRuntime(opts){const rt=Core.createRuntime(opts),play=rt.play;return {...rt,play(id,params){calls.push({id,params});return play(id,params)}}}};
  const a=Runtime.create({core,resolver:{has:()=>true,resolve:id=>id},fxBackend:{createNode:s=>({s}),updateNode(){},destroyNode(){},destroy(){}},ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0}),footOf:()=>({x:0,y:0})}});a.registerPresets([preset]);
  const area={x:100*Math.cos(i*Math.PI/4),y:100*Math.sin(i*Math.PI/4)};a.tryPlay({fxKind:'burst',variant:'rock-pillar',area,targets:[],vfx:{attack:preset.id}});
  assert.equal(calls.length,1);assert.equal(calls[0].params.rotation,0);assert.deepEqual(calls[0].params.position,area);assert.equal(calls[0].params.radius,undefined);
  const original=calls[0].params;assert.equal(original.scaleX,1);assert.equal(original.scaleY,1);
  for(const sizeMult of [0,null,1.5]){
   a.tryPlay({fxKind:'burst',variant:'rock-pillar',area,targets:[],sizeMult,vfx:{attack:preset.id}});
   const params=calls.at(-1).params;assert.equal(params.scaleX,sizeMult>0?sizeMult:1);assert.equal(params.scaleY,sizeMult>0?sizeMult:1);
  }
  a.tryPlay({fxKind:'burst',variant:'rock-pillar',area,vfx:{}});assert.equal(calls.length,4);a.destroy();
 }
});
test('超重岩：Excel／CSV／JS接線一致，幾何欄與觸發角色完整且Worker快取同步',()=>{
 const table=require('../tools/config_tables.cjs'),geom=require('../tools/skills2-geometry.cjs'),vfx=require('../tools/skills2-vfx.cjs');const h=setup(),u=h.c.sgUlt('rockarmor','superRockArt');
 assert.deepEqual(JSON.parse(JSON.stringify(u.def.fx)),{sec:2,secPer:.2,dur:4,count:4,pct:200,pctPer:20,gap:.5,m:24});
 assert.ok(geom.bindings('rockarmor','superRockArt').some(([kind])=>kind==='gap'));assert.deepEqual(vfx.event('rockarmor','superRockArt').roles,['attack','hit']);
 for(const n of ['Skills2','Status'])assert.deepEqual(table.readXlsxRows(path.join(root,'config/Excel',n+'.xlsx'),n),table.csvParse(fs.readFileSync(path.join(root,'config/CSV',n+'.csv'),'utf8')));
 for(const f of ['js/bridge.js','js/worker/sim.worker.js'])assert.match(fs.readFileSync(path.join(root,f),'utf8'),/20261012-super-rock-art/);
});
