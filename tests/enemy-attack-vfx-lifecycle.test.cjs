'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),{createEngine}=require('../scripts/sim/engine');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
const root=path.resolve(__dirname,'..');
const beam=require('../vfx/presets/beam-light.json');
function recorder(){const nodes=[];return {nodes,backend:{createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(){},destroy(){}}};}
function visual(presets=[beam],dedicated=true){
  const fx=recorder(),air=recorder(),enemy=recorder();
  const points={'pv-float':{x:10,y:20},a:{x:100,y:20},b:{x:10,y:150}},dead=new Set();
  const rt=Runtime.create({core:Core,resolver:{resolve:id=>id,has:()=>true},fxBackend:fx.backend,
    airBackend:air.backend,enemyAirBackend:dedicated?enemy.backend:null,
    ctx:{playerPos:()=>points['pv-float'],posOf:id=>points[id],chainPoint:id=>points[id],targetAlive:id=>!!points[id]&&!dead.has(id)}});
  rt.registerPresets(presets);return {rt,fx,air,enemy,points,dead};
}
const reflection=(id=beam.id,targets=['a'])=>({fxKind:'chain',variant:'earth-reflect',cat:'magic',targets,dur:.5,vfx:{attack:id},hit:false});
const visible=r=>r.nodes.filter(n=>n.t&&n.t.visible);
test('同源同目標連續100次反射只保留一道，依作者時長回收且可再播放',()=>{
  const s=visual();for(let i=0;i<100;i++)assert.equal(s.rt.tryPlay(reflection()),true);
  assert.equal(s.rt.stats().fx.activeEffects,1);assert.equal(s.rt.stats().fx.activeEffects,1);
  s.rt.update(.24);assert.equal(s.rt.stats().fx.activeEffects,1);
  s.rt.update(.02);assert.equal(s.rt.stats().fx.activeEffects,0);assert.equal(visible(s.fx).length,0);
  s.rt.tryPlay(reflection());assert.equal(s.rt.stats().fx.activeEffects,1);s.rt.destroy();
});
test('舊25秒光暈與換名素材仍受同一路徑保護，不截短作者設定',()=>{
  const p=structuredClone(beam);p.id='reflection-custom';p.layers[0].duration=25;
  const s=visual([p]);for(let i=0;i<100;i++)s.rt.tryPlay(reflection(p.id));
  s.rt.update(1);assert.equal(s.rt.stats().fx.activeEffects,1);assert.equal(s.rt.stats().fx.activeEffects,1);
  s.dead.add('pv-float');s.rt.update(0);assert.equal(s.rt.stats().fx.activeEffects,0);assert.equal(visible(s.fx).length,0);
  assert.equal(s.rt.tryPlay(reflection(p.id)),true);assert.equal(s.rt.stats().fx.activeEffects,0);s.rt.destroy();
});
test('反射兩個目標均從玩家出發；移動、敵人死亡及離場正確回收',()=>{
  const s=visual();s.rt.tryPlay(reflection(beam.id,['a','b']));s.rt.update(.05);
  assert.equal(s.rt.stats().fx.activeEffects,2);assert.ok(visible(s.fx).every(n=>n.t.x<20&&n.t.y<30));
  const old=visible(s.fx).map(n=>({...n.t}));
  Object.values(s.points).forEach(p=>{p.x+=15;p.y+=15;});s.rt.update(.01);
  visible(s.fx).forEach((n,i)=>{assert.ok(Math.abs(n.t.x-old[i].x-15)<1e-8);assert.ok(Math.abs(n.t.y-old[i].y-15)<1e-8);});
  s.dead.add('a');s.rt.update(0);assert.equal(s.rt.stats().fx.activeEffects,1);
  delete s.points.b;s.rt.update(0);assert.equal(s.rt.stats().fx.activeEffects,0);s.rt.destroy();
});
test('死亡清場只回收反射，其他光束與敵方子彈仍播完；換場全部回收',()=>{
  const p={schemaVersion:1,id:'beam-other',duration:1,layers:[{id:'body',type:'sprite',assetId:'other',duration:1}]};
  const proj={schemaVersion:1,id:'proj-test',duration:.3,layers:[{id:'body',type:'sprite',assetId:'projectile',duration:.3}]};
  const s=visual([beam,p,proj]);s.rt.tryPlay(reflection());s.rt.tryPlay({...reflection(p.id),variant:'other'});
  s.rt.tryPlay({cat:'enemy',fxKind:'enemy-attack',variant:'enemy-projectile',sourceId:'a',targets:['pv-float'],travelMs:[260],vfx:{projectile:proj.id},hit:false});
  s.rt.update(.05);s.rt.clearFields();assert.equal(s.rt.stats().fx.activeEffects,1);assert.equal(s.rt.stats().enemyAir.activeEffects,1);
  s.rt.clear();assert.equal(s.rt.stats().fx.activeEffects,0);assert.equal(s.rt.stats().enemyAir.activeEffects,0);
  assert.equal(visible(s.fx).length+visible(s.enemy).length,0);s.rt.destroy();
});
test('敵方子彈走專用後端，玩家子彈仍走原層，飛行260ms與位置相同',()=>{
  const p={schemaVersion:1,id:'proj-test',duration:1,layers:[{id:'body',type:'sprite',assetId:'projectile',duration:1}]};
  const s=visual([p]);const spec={cat:'enemy',fxKind:'enemy-attack',variant:'enemy-projectile',sourceId:'a',targets:['pv-float'],travelMs:[260],vfx:{projectile:p.id},hit:false};
  s.rt.tryPlay(spec);s.rt.tryPlay({...spec,cat:'magic',fxKind:'projectile',variant:'other'});
  s.rt.update(.13);assert.equal(visible(s.enemy).length,1);assert.equal(visible(s.air).length,1);
  assert.equal(s.enemy.nodes[0].t.x,s.air.nodes[0].t.x);assert.equal(s.enemy.nodes[0].t.scaleX,s.air.nodes[0].t.scaleX);
  s.rt.update(.14);assert.equal(s.rt.stats().enemyAir.activeEffects,0);assert.equal(s.rt.stats().air.activeEffects,0);s.rt.destroy();
  const fallback=visual([p],false);fallback.rt.tryPlay(spec);fallback.rt.update(.1);assert.equal(visible(fallback.air).length,1);fallback.rt.destroy();
});
function extract(src,name){const start=src.indexOf('function '+name+'(');assert.ok(start>=0);let depth=0;for(let i=src.indexOf('{',start);i<src.length;i++){if(src[i]==='{')depth++;if(src[i]==='}'&&--depth===0)return src.slice(start,i+1);}throw Error(name);}
test('Canvas專用層在技能之上／浮字HUD之下；legacy子彈投影仍留在威脅層',()=>{
  const src=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8');
  const {buildSceneTree,drawOrder}=require('./helpers/battle-scene.cjs');
  const scene=buildSceneTree(src),nodes=drawOrder(scene.app.stage);
  assert.equal(scene.layers.enemyAir.parent,scene.cameraStage);
  assert.equal(scene.layers.float.parent,scene.app.stage);
  const order=['airFx','enemyAir','float','playerHud','overlay'].map(id=>nodes.indexOf(scene.layers[id]));
  assert.ok(order.every((v,i)=>v>=0&&(!i||v>order[i-1])));
  class Container{constructor(){this.children=[];this.scale={set(){}};this.position={set(){}};}addChild(n){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);this.children.push(n);n.parent=this;}}
  const layers={airFx:new Container(),enemyAir:new Container(),airBack:new Container()};
  const c={PIXI:{Container},S:{layers,player:{root:{y:500}}},legacyAirNodes:new Map(),airScreenPose:()=>({x:3,y:4,scale:.8}),groundToScreenY:y=>y};
  vm.createContext(c);vm.runInContext(extract(src,'attachAirFx')+';'+extract(src,'syncLegacyAir'),c);
  const n=new Container();n.__enemyProjectile=true;n.x=5;n.y=5;
  c.attachAirFx(n);c.syncLegacyAir();assert.equal(n.__airWrapper.parent,layers.enemyAir);
  n.y=900;c.syncLegacyAir();assert.equal(n.__airWrapper.parent,layers.enemyAir);
});
test('正式Worker一般與菁英八屬性出手皆為260ms子彈；反射與傷害時序未變',()=>{
  const helper=path.join(__dirname,'skill2-windblade-vacuum-legendary.test.cjs');
  const h={require:createRequire(helper),__dirname,console};vm.createContext(h);vm.runInContext(fs.readFileSync(helper,'utf8').split("test('")[0],h);
  const c=createEngine({seed:9}).boot(null).ctx;
  c.G.player.level=1000;c.G.player.skills2={levels:{earthguard:Array(7).fill(10)},ult:{}};c.G.player.loadout=['sg:earthguard'];
  const stats={...c.getStats(),...h.loadContext().BASE_STATS,def:0,mdef:0,evasion:0,blockRate:0};c.getStats=()=>stats;c.Math.random=()=>.5;c.chance=pct=>pct>=100;
  for(const elite of [false,true])for(const attr of [null,'fire','ice','lightning','poison','light','dark','earth','wind']){
    const p=h.playerEnt();p.pos={x:0,y:0};const m=h.enemy(1e8,50,0,'source');Object.assign(m,{atk:100,matk:100,magic:true,attr,elite});
    c.FIELD.player=p;c.FIELD.monsters=[m];c.DEFERRED_ENEMY_RETALIATIONS=[];c.shimDrainUrgentVisualEvents();
    const before=p.hp,res=c.doMonsterAttack(m,p,'pv-float');assert.ok(res.dmg>0);assert.ok(p.hp<before);
    const events=c.shimDrainUrgentVisualEvents(),e=events.find(e=>e.fxKind==='enemy-attack');
    assert.equal(e.cat,'enemy');assert.equal(e.variant,'enemy-projectile');assert.deepEqual(Array.from(e.travelMs),[260]);assert.equal(e.dur,.26);
    assert.notEqual(e.vfx.projectile,beam.id);assert.ok(!events.some(e=>e.variant==='earth-reflect'));
    const beforeEnemy=m.hp;c.GT+=.259;c.tickDeferredEnemyAttackRetaliations();assert.equal(m.hp,beforeEnemy);
    c.GT+=.002;c.tickDeferredEnemyAttackRetaliations();const reflected=c.shimDrainUrgentVisualEvents().filter(e=>e.variant==='earth-reflect');
    assert.equal(reflected.length,1);assert.equal(reflected[0].vfx.attack,beam.id);assert.ok(m.hp<beforeEnemy);
  }
});
