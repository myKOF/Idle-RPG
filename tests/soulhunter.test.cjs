const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const helperFile=path.join(__dirname,'skill2-knife-range.test.cjs');
const helper=fs.readFileSync(helperFile,'utf8');
const scope={require:createRequire(helperFile),__dirname,console};vm.createContext(scope);
vm.runInContext(helper.slice(0,helper.indexOf("test("))+'\nthis.h={loadContext,enemy,playerEnt};',scope);
function setup(){
 const c=scope.h.loadContext(),p=scope.h.playerEnt(),events=[],hits=[];
 c.GT=0;c.resetSkill2RT();c.bfPlayerPos=()=>({x:0,y:0});
 c.G.player.skills2.levels.knife=[1,0,1,0,0,0,0];
 c.SKILLS2.knife.tiers[0].fx.speed=10;c.enemyEventFloatTarget=e=>e.name;
 c.playCombatVfx=e=>events.push(e);c.applySkillFinalDamageMultiplier=()=>{};c.chance=()=>false;
 c.resolveHit=(a,e)=>{e.hp=Math.max(0,e.hp-100);hits.push({target:e,time:c.GT});return {dmg:100,crit:false,miss:false,killed:e.hp===0};};
 const cfg={pEnt:p,st:c.getStats(),pool:[],floatSel:'mv-float',out:{dmg:0},dmgVal:100,onCrit(){},pathPct:0,execPct:0,bounceRangePx:200};
 function tick(t){c.GT=t;c.sgTickFlyingProjectiles(.01,{getEnemies:()=>cfg.pool});}
 return {c,p,cfg,events,hits,tick,enemy:(x,hp=1000,name='E')=>scope.h.enemy(hp,x,0,name)};
}
function soul(h,lv=1){const def=h.c.SKILLS2.knife.ult.find(u=>u.id==='soulhunterBlade');h.c.sgKnifeSoulhunter(h.cfg,{def,lv});return h.c.SKILL2_RT.projectiles.findLast(p=>p.soulController);}
function advance(h,to){while(h.c.GT<to)h.tick(Math.min(to,h.c.GT+.025));}
test('單次施放一支金刀、普通刀維持原色，初次命中不加傷',()=>{
 const h=setup(),a=h.enemy(100,1e9,'A');h.cfg.pool=[a];const s=soul(h);
 const damage=[];h.c.sgKnifeHit=(cfg,e,d)=>{damage.push(d);return null;};
 advance(h,2);assert.ok(damage.length>=3);assert.equal(damage[0],100);
 assert.ok(Math.abs(damage[1]-104.4)<1e-8);assert.ok(Math.abs(damage[2]-108.8)<1e-8);
 assert.equal(h.c.SKILL2_RT.projectiles.filter(p=>p.soulController).length,1);
 assert.equal(s.until,10);assert.equal(s.range,h.c.bfMeterPx(40));
 assert.ok(h.events.filter(e=>e.area?.soulId).every(e=>e.vfx.projectile==='proj-knife-gold'));
 h.c.sgQueueKnifeFlight(h.cfg,null,a,100,0,false,'knife');assert.equal(h.events.at(-1).vfx.projectile,'proj-knife');
});
test('單敵反覆飛離折返，到期途中不再造成傷害',()=>{
 const h=setup(),a=h.enemy(100,1e9);h.cfg.pool=[a];soul(h);advance(h,9.99);
 assert.ok(h.hits.length>3);assert.ok(h.events.some(e=>e.loopReturn&&e.travelMs[0]>0));
 const hits=h.hits.length;h.tick(10);h.tick(11);assert.equal(h.hits.length,hits);assert.equal(h.c.SKILL2_RT.projectiles.length,0);
 assert.equal(h.events.at(-1).area.soulMode,'stop');assert.equal(h.cfg.out._pendingProjectiles,0);
});
test('殺敵後返回並環繞，新敵進入 40 米才重新追擊，期限不重置',()=>{
 const h=setup(),a=h.enemy(50,100),far=h.enemy(1000,1000,'far');h.cfg.pool=[a,far];const s=soul(h);
 advance(h,2);assert.equal(a.hp,0);assert.equal(s.mode,'orbit');assert.equal(far.hp,1000);
 const b=h.enemy(100,1000,'new');h.cfg.pool=[b,far];h.tick(3);assert.equal(s.mode,'flight');assert.equal(s.until,10);
 advance(h,4.5);assert.ok(b.hp<1000);assert.equal(far.hp,1000);
});
test('沒有範圍內敵人立即待機，隨玩家位置發出；各次施放獨立到期',()=>{
 const h=setup();const a=soul(h);assert.equal(a.mode,'orbit');h.tick(2);const b=soul(h);assert.notEqual(a.id,b.id);assert.equal(b.until,12);
 h.c.bfPlayerPos=()=>({x:500,y:100});h.cfg.pool=[h.enemy(550,1000,'new')];h.tick(3);
 const event=h.events.findLast(e=>e.area?.soulMode==='flight');assert.ok(event.area.sourceX>=470);assert.ok(event.area.sourceY>=70);
 h.tick(10);assert.ok(!h.c.SKILL2_RT.projectiles.includes(a));assert.ok(h.c.SKILL2_RT.projectiles.includes(b));
 h.p.hp=0;h.tick(10.1);assert.equal(h.c.SKILL2_RT.projectiles.length,0);
});
test('Runtime 同身份僅保留一支，環繞隨玩家移動，到期及死亡清除',()=>{
 const h=setup();soul(h);const event=h.events[0];
 const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');const frames=[];let centre={x:0,y:0};
 const backend={createNode:()=>({}),updateNode:(n,t)=>frames.push({...t}),destroyNode(){}};
 const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:x=>x},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>centre,posOf:()=>centre,footOf:()=>centre}});
 rt.registerPresets([JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/proj-knife-gold.json')))]);
 assert.equal(rt.tryPlay(event),true);assert.equal(rt.stats().soulOrbits,1);rt.tryPlay(event);assert.equal(rt.stats().soulOrbits,1);
 centre={x:500,y:100};rt.update(.1);assert.ok(frames.some(f=>Math.abs(f.x-500)<=30&&Math.abs(f.y-100)<=30));
 rt.update(10);assert.equal(rt.stats().soulOrbits,0);rt.tryPlay(event);rt.clearFields();assert.equal(rt.stats().soulOrbits,0);
});
test('完整施放多把普通刀時只有一支金刀，普通彈射與受擊不繼承金色',()=>{
 const h=setup();h.c.FIELD.player=h.p;h.c.G.player.skills2.levels.knife=[10,10,10,10,10,10,10];
 h.c.G.player.skills2.ult={knife:{pick:h.c.sgUltIndexOfId('knife','soulhunterBlade'),lv:10}};
 h.cfg.pool=Array.from({length:7},(_,i)=>h.enemy(50+i*10,1e9,'E'+i));
 h.c.castSkill2(h.p,h.cfg.pool,'knife','mv-float');
 assert.equal(h.events.filter(e=>e.vfx.projectile==='proj-knife-gold').length,1);
 assert.ok(h.events.filter(e=>e.vfx.projectile==='proj-knife').length>=6);
 advance(h,2);
 assert.ok(h.events.some(e=>e.variant==='knife-bounce'&&e.vfx.projectile==='proj-knife'));
 assert.ok(h.events.some(e=>e.fxKind==='impact'&&e.vfx.hit==='hit-phys'));
 assert.equal(h.c.SKILL2_RT.projectiles.filter(p=>p.soulController).length,1);
});
test('Runtime 返回空目標環繞、再出發都替換同一金刀，死亡清除飛行中金刀',()=>{
 const h=setup(),a=h.enemy(50,100);h.cfg.pool=[a];soul(h);advance(h,2);
 const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
 const backend={createNode:()=>({}),updateNode(){},destroyNode(){}};
 const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:x=>x},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0}),chainPoint:()=>null}});
 rt.registerPresets([JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/proj-knife-gold.json')))]);
 const returning=h.events.find(e=>e.area?.soulReturn);assert.ok(returning);assert.equal(returning.targets.length,0);
 rt.tryPlay(returning);assert.equal(rt.stats().projectiles,1);rt.update(.05);
 rt.tryPlay(h.events.find(e=>e.area?.soulMode==='orbit'));assert.equal(rt.stats().projectiles,0);assert.equal(rt.stats().soulOrbits,1);
 rt.tryPlay(h.events[0]);assert.equal(rt.stats().projectiles,1);assert.equal(rt.stats().soulOrbits,0);
 rt.clearFields();assert.equal(rt.stats().projectiles,0);
});
