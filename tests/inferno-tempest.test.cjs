'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine}=require('../scripts/sim/engine');
function setup(lv=1){
 const c=createEngine({seed:42}).boot(null).ctx;
 c.G.player.level=1000;c.G.player.loadout=['sg:firepillar'];
 c.G.player.skills2.levels.firepillar=Array(7).fill(10);
 c.G.player.skills2.ult={firepillar:{pick:c.sgUltIndexOfId('firepillar','infernoTempest'),lv}};
 c.initFieldPlayer();c.gmArenaSpawn(5,'elite',1000000);
 const p=c.FIELD.player;p.pos={x:0,y:0};p.mp=1e9;
 c.FIELD.monsters.forEach((m,i)=>{m.pos={x:100+i*40,y:0};m._enterCd=0;});
 const events=[],hits=[];c.playCombatVfx=s=>events.push(s);
 c.sgHitOne=(p,s,m,d,g,f,o,delay,bonus,elem)=>{hits.push({m,d,elem});return {miss:false};};
 c.sgCastFirepillar(p,c.getStats(),c.SKILLS2.firepillar,Array(7).fill(10),c.FIELD.monsters,c.FIELD.monsters[0],'mv-float',{});
 return {c,p,events,hits,f:c.SKILL2_RT.grounds[0],ctx:{getEnemies:()=>c.FIELD.monsters}};
}
test('烈焰暴風：不倍增龍捲，每道獨立每0.33秒隨機鎖定1名24米內敵人',()=>{
 const {c,f,events}=setup();assert.equal(c.SKILL2_RT.grounds.length,2);
 assert.notEqual(f.tempest,c.SKILL2_RT.grounds[1].tempest);
 assert.equal(f.tempest.gap,.33);assert.equal(f.tempest.count,1);
 f.pos={x:1000,y:100};
 const distances=[100,160,240,241,50];
 c.FIELD.monsters.forEach((m,i)=>m.pos={x:1000+distances[i],y:100});c.FIELD.monsters[4]._enterCd=1;
 c.GT=f.tempest.nextAt-.001;c.sgTickInfernoTempest(f,c.FIELD.monsters);assert.equal(c.SKILL2_RT.projectiles.length,0);
 c.GT+=.001;c.sgTickInfernoTempest(f,c.FIELD.monsters);
 assert.equal(c.SKILL2_RT.projectiles.length,1);
 const shots=events.filter(e=>e.variant==='inferno-tempest-ball');assert.equal(shots.length,1);
 assert.equal(new Set(c.SKILL2_RT.projectiles.map(p=>p.target)).size,1);
 shots.forEach(s=>{assert.equal(s.area.sourceX,1000);assert.equal(s.arcM||0,0);assert.equal(s.area.fixedLanding,true);assert.deepEqual(Object.keys(s.vfx),['projectile']);});
 c.sgTickInfernoTempest(f,c.FIELD.monsters);assert.equal(c.SKILL2_RT.projectiles.length,1);
 c.GT=f.tempest.nextAt;c.FIELD.monsters.splice(1);c.sgTickInfernoTempest(f,c.FIELD.monsters);assert.equal(c.SKILL2_RT.projectiles.length,2);
 c.GT=f.tempest.nextAt;c.sgTickInfernoTempest(f,c.FIELD.monsters);assert.equal(c.SKILL2_RT.projectiles.length,3);
 assert.ok(Math.abs(c.GT-.99)<1e-9,'前三顆分別在0.33、0.66、0.99秒發射');
});
test('烈焰暴風：抵達前無傷害，固定直線終點6米爆炸依當下敵人位置判定',()=>{
 const {c,f,events,hits,ctx}=setup();c.FIELD.monsters.splice(1);const target=c.FIELD.monsters[0];
 f.pos={x:0,y:0};target.pos={x:240,y:0};c.GT=f.tempest.nextAt;c.sgTickInfernoTempest(f,c.FIELD.monsters);
 const shot=c.SKILL2_RT.projectiles[0];assert.equal(shot.endAt-c.GT,1);assert.equal(events.at(-1).travelMs[0],1000);
 c.GT=shot.endAt-.001;c.sgTickFlyingProjectiles(.999,ctx);assert.equal(hits.length,0);assert.equal(events.filter(e=>e.variant==='inferno-tempest-impact').length,0);
 const edge={hp:100,pos:{x:240,y:60+c.bfBodyRadius()}},outside={hp:100,pos:{x:240,y:61+c.bfBodyRadius()}};
 target.pos.x=500;c.FIELD.monsters.push(edge,outside);
 c.GT=shot.endAt;c.sgTickFlyingProjectiles(.001,ctx);
 assert.deepEqual(hits.map(h=>h.m),[edge]);assert.equal(hits[0].elem,'fire');
 const impact=events.find(e=>e.variant==='inferno-tempest-impact');assert.equal(impact.area.x,240);assert.equal(impact.area.r,60);assert.deepEqual(Object.keys(impact.vfx),['attack']);
 assert.equal(c.SKILL2_RT.projectiles.length,0);
});
test('烈焰暴風：只升火球傷害，重生龍捲重新計時，死亡與重置停止傷害',()=>{
 const a=setup(1),b=setup(10);
 const base=a.c.sgGroupBaseStat(a.c.SKILLS2.firepillar,a.c.getStats());
 assert.equal(a.f.tempest.dmgVal,base*2.2);assert.equal(b.f.tempest.dmgVal,base*4);
 assert.equal(a.f.dmgVal,b.f.dmgVal);assert.equal(a.f.tempest.range,b.f.tempest.range);
 a.c.GT=3;a.c.sgGroundExpire(a.f,a.c.FIELD.monsters,a.ctx);
 const child=a.c.SKILL2_RT.grounds.at(-1);assert.notEqual(child,a.f);assert.equal(child.tempest.nextAt,3.33);assert.notEqual(child.tempest,a.f.tempest);
 a.c.GT=4;a.c.sgTickInfernoTempest(child,a.c.FIELD.monsters);assert.ok(a.c.SKILL2_RT.projectiles.length>0);
 a.hits.length=0;a.p.hp=0;a.c.GT=10;a.c.sgTickFlyingProjectiles(6,a.ctx);assert.equal(a.hits.length,0);
 a.c.resetSkill2RT();assert.equal(a.c.SKILL2_RT.projectiles.length,0);
});
test('烈焰暴風：無座標高塔單目標仍可飛行後命中，生命結束後不再發射',()=>{
 const {c,f,hits,ctx}=setup();c.FIELD.monsters.splice(1);delete c.FIELD.monsters[0].pos;f.pos=null;
 c.GT=f.tempest.nextAt;c.sgTickInfernoTempest(f,c.FIELD.monsters);assert.equal(c.SKILL2_RT.projectiles.length,1);
 c.GT+=.26;c.sgTickFlyingProjectiles(.26,ctx);assert.equal(hits.length,1);
 c.GT=100;c.sgTickInfernoTempest(f,c.FIELD.monsters);const count=c.SKILL2_RT.projectiles.length;
 c.GT++;c.sgTickInfernoTempest(f,c.FIELD.monsters);assert.equal(c.SKILL2_RT.projectiles.length,count);
});

test('烈焰暴風：實際 Runtime 依事件從龍捲平射，半程位置沒有拋物線高度',()=>{
 const {c,f,events}=setup();c.FIELD.monsters.splice(1);f.pos={x:100,y:100};c.FIELD.monsters[0].pos={x:340,y:100};
 c.GT=f.tempest.nextAt;c.sgTickInfernoTempest(f,c.FIELD.monsters);
 const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js'),log=[];
 const backend={createNode(){const n={};log.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(){}};
 const adapter=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},fxBackend:backend,zoneBackend:backend,groundScale:.5,
 ctx:{posOf:()=>({x:999,y:999}),playerPos:()=>({x:0,y:0})}});
 adapter.registerPresets([{schemaVersion:1,id:'proj-dragon-devour',duration:1.5,loop:false,layers:[{id:'body',type:'sprite',assetId:'ball',scale:{x:1,y:1}}]}]);
 assert.equal(adapter.tryPlay(events.find(e=>e.variant==='inferno-tempest-ball')),true);
 adapter.update(.5);
 assert.ok(log.some(n=>n.t&&Math.abs(n.t.x-220)<.001&&Math.abs(n.t.y-50)<.001),'半程在投影後直線中點');
});

test('烈焰暴風：每顆重新隨機抽樣，遠敵可入選且同輪不重複',()=>{
 const {c,f}=setup();f.pos={x:0,y:0};
 c.FIELD.monsters.forEach((m,i)=>m.pos={x:40+i*40,y:0});
 c.Math.random=()=>0;c.GT=f.tempest.nextAt;c.sgTickInfernoTempest(f,c.FIELD.monsters);
 const first=c.SKILL2_RT.projectiles.map(p=>p.target);
 assert.equal(new Set(first).size,1);
 let draws=0;c.Math.random=()=>draws++===0?0:.999;c.GT=f.tempest.nextAt;c.sgTickInfernoTempest(f,c.FIELD.monsters);
 const second=c.SKILL2_RT.projectiles.slice(1).map(p=>p.target);
 assert.equal(new Set(second).size,1);assert.notDeepEqual(first,second);
 assert.ok([...first,...second].includes(c.FIELD.monsters[4]),'遠敵也能被抽中');
});
