'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const cfg=require('../tools/config_tables.cjs');
const {loadEliteEnv}=require('./helpers/elite-env.cjs');
function env(){const c=loadEliteEnv({stage:1});c.FIELD_ENCOUNTER.minGroups=4;c.FIELD_ENCOUNTER.maxGroups=4;return c;}
function groups(list){return [...new Set(list.map(m=>m._encounterKey).filter(Boolean))];}
function plain(c,x=1000){const m={hp:100,pos:{x,y:0},runSpeed:120,sightRange:500,_alerted:false,atkRange:60};c.bfInitRoam(m);return m;}
test('遠方預置菁英群在70～160米內，全部共用FIELD且固定於世界座標',()=>{
 const c=env(),made=c.tickFieldEncounters();
 assert.equal(groups(made).length,4);assert.ok(made.every(m=>c.FIELD.monsters.includes(m)));
 for(const key of groups(made)){
  const members=made.filter(m=>m._encounterKey===key),anchor=members[0].pos;
  assert.ok(Math.hypot(anchor.x,anchor.y)>=700&&Math.hypot(anchor.x,anchor.y)<=1600);assert.ok(members.some(m=>m.elite));
  assert.ok(members.length<=4);
  for(const m of members){assert.ok(Math.hypot(m.pos.x-anchor.x,m.pos.y-anchor.y)<80);assert.equal(m._alerted,false);assert.equal(m._roam.x,m.pos.x);}
 }
});
test('活群不持續增生；整群死亡後在遠方補回，部分死亡不補單隻',()=>{
 const c=env();c.tickFieldEncounters();const n=c.FIELD.monsters.length;
 for(let i=0;i<100;i++){c.GT++;assert.equal(c.tickFieldEncounters().length,0);}
 assert.equal(c.FIELD.monsters.length,n);
 const key=c.FIELD.monsters[0]._encounterKey,group=c.FIELD.monsters.filter(m=>m._encounterKey===key);
 group[0].hp=0;
 if(group.length>1)assert.equal(c.tickFieldEncounters().length,0);
 group.forEach(m=>m.hp=0);const added=c.tickFieldEncounters();assert.ok(added.length);
 assert.equal(groups(c.liveFieldEnemies()).length,4);
 assert.ok(added.every(m=>Math.hypot(m.pos.x,m.pos.y)>=620));
 const survivor=c.liveFieldEnemies().find(m=>!added.includes(m));
 c.G.stage.current=2;assert.equal(c.tickFieldEncounters().length,0);
 assert.ok(c.FIELD.monsters.includes(survivor));
 c.BF_PLAYER.x=40;assert.equal(c.tickFieldEncounters().length,0);
});
test('移動後死亡補群選玩家遠方空位，往返不重置現有怪群',()=>{
 const c=env();c.tickFieldEncounters();
 c.FIELD.monsters=[];c.FIELD.monster=null;c.BF_PLAYER.x=1000;
 const next=c.tickFieldEncounters();assert.ok(next.length);
 for(const m of next){assert.ok(Math.hypot(m.pos.x-1000,m.pos.y)>=620);}
 c.BF_PLAYER.x=0;
 assert.equal(c.tickFieldEncounters().length,0);
});
test('地圖地點獨立、群上限共用；載入新遊戲重置',()=>{
 const c=env();c.tickFieldEncounters();c.FIELD.monsters=[];c.FIELD.monster=null;
 c.G.stage.zone='Icefield';const ice=c.tickFieldEncounters();assert.ok(ice.length);assert.ok(ice.every(m=>m._encounterKey.startsWith('Icefield:')));
 c.G.stage.zone='desert';assert.equal(c.tickFieldEncounters().length,0);
 c.G=Object.assign({},c.G);c.FIELD.monsters=[];c.FIELD.monster=null;assert.ok(c.tickFieldEncounters().length);
});
test('遠方群共享總容量、遵守群上限；不占原有波次的數量名額',()=>{
 const c=env();c.FIELD_ENCOUNTER.maxGroups=1;c.tickFieldEncounters();assert.equal(groups(c.FIELD.monsters).length,1);
 assert.equal(c.fieldWavePopulation(c.FIELD.monsters),0);
 c.fieldMaxLiveEnemiesFor=()=>1;c.rollFieldEnemyCount=()=>1;c.isEliteStage=()=>false;c.isFieldBossStage=()=>false;c.chance=()=>false;
 const normal=c.spawnFieldMonster(true);assert.equal(normal.length,1);assert.equal(c.fieldWavePopulation(c.FIELD.monsters),1);
 const d=env();d.BF_COLS=1;d.BF_ROWS=1;
 d.FIELD.monsters=[{hp:100,pos:{x:0,y:0}}];d.syncFieldPrimary();
 assert.equal(d.tickFieldEncounters().length,0);assert.equal(d.FIELD.monsters.length,1);
});
test('演武場、塔戰、地圖完成或場上BOSS期間不預置遠方怪群',()=>{
 for(const mode of ['arena','tower','complete','boss']){
  const c=env();
  if(mode==='arena')c.FIELD._gmArena=true;
  if(mode==='tower')c.G.tower.active=true;
  if(mode==='complete')c.FIELD.mapComplete=true;
  if(mode==='boss'){c.FIELD.monsters=[{hp:100,isBoss:true}];c.syncFieldPrimary();}
  assert.equal(c.tickFieldEncounters().length,0,mode);
 }
});
test('未警戒遊走固定在出生點8米範圍，會改變方向並走走停停',()=>{
 const c=env(),m=plain(c),positions=new Set();let stopped=0,moved=0;
 for(let i=0;i<1200;i++){
  const x=m.pos.x,y=m.pos.y;c.GT+=.1;c.bfTickApproach([m],.1);
  assert.ok(Math.hypot(m.pos.x-1000,m.pos.y)<=80.00001);
  if(Math.hypot(m.pos.x-x,m.pos.y-y)<1e-8)stopped++;else moved++;
  positions.add(Math.round(m.pos.x)+','+Math.round(m.pos.y));
 }
 assert.ok(moved>100);assert.ok(stopped>10);assert.ok(positions.size>100);assert.equal(m._alerted,false);
 c.BF_PLAYER.x=-5000;c.bfTickApproach([m],1);assert.equal(m._roam.x,1000);
});
test('遊走步速按NPC跑速與緩速倍率；進場、暈眩和施法鎖定不移動',()=>{
 const c=env(),m=plain(c);m._roam.tx=1080;m._roam.ty=0;
 c.bfTickApproach([m],1);assert.equal(m.pos.x,1030);
 c.bfEnemySpeedFactor=()=>.5;c.bfTickApproach([m],1);assert.equal(m.pos.x,1045);
 for(const state of ['entry','stun','cast']){
  const d=env(),n=plain(d);n._roam.tx=1080;
  if(state==='entry')n._enterCd=1;
  if(state==='stun')d.ccActionLocked=()=>true;
  if(state==='cast')n._elLockUntil=d.GT+10;
  d.bfTickApproach([n],1);assert.equal(n.pos.x,1000,state);
 }
});
test('進入視野切換追擊並清除遊走目標；離開視野不回出生點',()=>{
 const c=env(),m=plain(c);m._encounterKey='test:1';c.BF_PLAYER.x=510;
 c.bfTickApproach([m],1);assert.equal(m._alerted,true);assert.equal(m._roam,null);assert.equal(m.pos.x,880);
 assert.equal(m._frenzyStartAt,c.GT);
 c.BF_PLAYER.x=-2000;c.bfTickApproach([m],1);assert.equal(m.pos.x,760);
});
test('預置群長時間遊走仍保持小範圍、未接戰，不會整群朝玩家漂移',()=>{
 const c=env(),list=c.tickFieldEncounters(),anchors=list.map(m=>({x:m._roam.x,y:m._roam.y}));
 for(let i=0;i<1800;i++){
  c.GT+=.1;c.bfTickApproach(list,.1);
  for(let j=0;j<list.length;j++){
   assert.equal(list[j]._alerted,false);
   assert.ok(Math.hypot(list[j].pos.x-anchors[j].x,list[j].pos.y-anchors[j].y)<=80.0001,'群組推擠後也應保持8米遊走範圍');
  }
 }
});
test('遠方未接戰不增加狂暴計數與平均，發現玩家後才開始累計',()=>{
 const c=env(),far=plain(c),near={hp:100,_spawnAt:100};far._encounterKey='test';far._spawnAt=100;
 c.GT=160;c.tickEnemyFrenzy([near,far],160);
 assert.equal(c.enemyFrenzyPct(far),0);assert.equal(c.enemyFrenzyPct(near),50);
 assert.equal(c.enemyFrenzyAverage([near,far]),50);
 c.BF_PLAYER.x=900;c.bfEnemyAlerted(far);c.tickEnemyFrenzy([near,far],160);assert.equal(c.enemyFrenzyPct(far),0);
 c.tickEnemyFrenzy([near,far],171);assert.equal(c.enemyFrenzyPct(far),1);
});
test('參數表生成與遊走十個值同步至具名設定',()=>{
 const c=loadEliteEnv({stage:1}),rows=cfg.csvParse(fs.readFileSync('config/CSV/game_parameters.csv','utf8'));
 for(const [name,fields] of [['預先生成',['cellM','preloadM','minDistanceM','maxGroups','maxGroupSize','minGroups']],['未警戒遊走',['roamRadiusM','roamSpeedRatio','roamWaitMin','roamWaitMax']]]){
  const r=rows.find(r=>r[2]==='4-遠方怪群'&&r[3]===name);assert.ok(r,name);
  fields.forEach((f,i)=>assert.equal(c.FIELD_ENCOUNTER[f],Number(r[6+i])));
 }
});
test('群數隨機可取4與8的端點，死亡補群不超出抽定目標',()=>{
 const vm=require('node:vm');
 for(const [roll,expected] of [[0,4],[.999,8]]){
  const c=loadEliteEnv({stage:1});
  vm.runInContext('Math.random=function(){return '+roll+';}',c);
  const first=c.tickFieldEncounters();assert.equal(groups(first).length,expected);
  const target=c.FIELD_ENCOUNTER_RT.targetGroups;
  for(let round=0;round<10;round++){
   const before=c.liveFieldEnemies(),key=before[0]._encounterKey;
   before.filter(m=>m._encounterKey===key).forEach(m=>m.hp=0);
   const replacements=c.tickFieldEncounters();assert.ok(replacements.length);
   assert.equal(groups(c.liveFieldEnemies()).length,expected);
   assert.equal(c.FIELD_ENCOUNTER_RT.targetGroups,target);
   assert.equal(c.tickFieldEncounters().length,0);
  }
 }
});
test('戰場容量釋出才補遠方群，沒有死亡時不重置存活群',()=>{
 const c=env();c.BF_COLS=1;c.BF_ROWS=1;
 c.FIELD.monsters=[{hp:100,pos:{x:0,y:0}}];c.syncFieldPrimary();
 assert.equal(c.tickFieldEncounters().length,0);
 c.FIELD.monsters[0].hp=0;
 const made=c.tickFieldEncounters();assert.equal(made.length,1);
 assert.equal(c.tickFieldEncounters().length,0);
 assert.equal(c.liveFieldEnemies()[0],made[0]);
});
test('正式Worker未警戒時遊走、活群存在時不額外補群，面板傳送同一權威位置',()=>{
 const engine=require('../scripts/sim/engine').createEngine({seed:1610100}).boot(null),c=engine.ctx;
 c.bfTickPlayer=()=>false;c.FIELD.spawnCd=1e6;c.fieldTick(.1);
 const keys=groups(c.FIELD.monsters);assert.ok(keys.length>=4&&keys.length<=8);
 const count=c.FIELD.monsters.length;
 for(let i=0;i<200;i++){c.GT+=.1;c.fieldTick(.1);}
 assert.equal(c.FIELD.monsters.length,count);assert.deepEqual(groups(c.FIELD.monsters),keys);
 assert.ok(c.FIELD.monsters.every(m=>!m._alerted));
 const p=c.buildPanel('battle');assert.equal(p.field.monsters[0].pos.x,c.FIELD.monsters[0].pos.x);
 assert.equal(engine.outbox().filter(m=>m.type===c.MSG_OUT.ERROR).length,0);
});
