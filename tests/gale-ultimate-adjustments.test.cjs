'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const table = require('./helpers/skill-table.cjs');
const Core = require('../js/vfx-core');
const Runtime = require('../js/vfx-runtime');
const tables = require('../tools/config_tables.cjs');
const helperFile = path.join(__dirname, 'skill2-knife-range.test.cjs');
const helper = fs.readFileSync(helperFile, 'utf8');
const scope = {require:createRequire(helperFile), __dirname, console};
vm.createContext(scope);
vm.runInContext(helper.slice(0, helper.indexOf('test(')) + '\nthis.h={loadContext,enemy,playerEnt};', scope);

function scene(id, moon = false) {
  const c = scope.h.loadContext(), p = scope.h.playerEnt(), hits = [], events = [];
  c.GT = 0; c.resetSkill2RT();
  let position = {x:0,y:0}, pool = [];
  const levels = [1,0,0,0,0,0,moon?1:0];
  c.G.player.skills2.levels.gale = levels;
  const ult = {def:c.SKILLS2.gale.ult.find(u=>u.id===id), lv:1};
  c.sgUlt = (gid,key)=>gid==='gale' && key===id ? ult : null;
  c.skills2Ult = ()=>ult;
  c.bfPlayerPos = ()=>position;
  c.bfEntityRadius = ()=>0; // 精確測試30米邊界，隔離一般敵人體型的邊緣判定。
  c.sgLegend = ()=>({});
  c.enemyEventFloatTarget = e=>e.name;
  c.playCombatVfx = e=>events.push(e);
  c.sgHitOne = (actor,stats,e,damage,gid,float,out,a,b,elem)=>{
    hits.push({target:e,damage,elem,at:c.GT});
    return {miss:!!c.testMiss};
  };
  const enemy = (x,name)=>scope.h.enemy(1e9,x,0,name);
  const primary = enemy(100,'primary'); pool = [primary];
  return {c,p,ult,hits,events,primary,enemy,levels,
    setPool(value){pool=value;}, move(x){position={x,y:0};},
    cast(){c.sgCastGale(p,{atk:1000},c.SKILLS2.gale,levels,pool,primary,'mv-float',{dmg:0});},
    tick(time){c.GT=time;c.sgTickGaleStrikes({getEnemies:()=>pool});}};
}

test('GALE-ULT Excel／CSV／JS一致，35%／70%及千鳥30米5目標皆由表讀取',()=>{
  const rows = tables.readXlsxRows(path.join(__dirname,'../config/Excel/Skills2.xlsx'));
  assert.deepEqual(tables.csvParse(fs.readFileSync(path.join(__dirname,'../config/CSV/Skills2.csv'),'utf8')),rows);
  assert.equal(table.fx('gale','thunderGodSlash','chance'),35);
  assert.equal(table.fx('gale','thunderGodSlash','sizeMult'),.7);
  assert.equal(table.fx('gale','chidori','count'),5);
  assert.equal(table.number('gale','chidori','搜敵範圍（米）'),30);
  const h=scene('chidori');
  assert.equal(h.ult.def.fx.count,5);assert.equal(h.ult.def.fx.m,30);
});

test('GALE-ULT 雷神之怒35%邊界，每次成功命中獨立擲骰，落雷不遞迴',()=>{
  for(const [roll,expected] of [[0,1],[.349999,1],[.35,0],[.999,0]]) {
    const h=scene('thunderGodSlash');h.c.Math.random=()=>roll;h.cast();
    const bolts=h.events.filter(e=>e.variant==='thunder-strike');
    assert.equal(bolts.length,expected);
    assert.equal(h.hits.filter(e=>e.elem==='lightning').length,expected);
    if(expected) {
      assert.equal(bolts[0].sizeMult,.7);
      assert.equal(bolts[0].area.r,h.c.bfMeterPx(table.number('gale','thunderGodSlash','傷害範圍（米）')));
      assert.equal(h.hits.find(e=>e.elem==='lightning').damage,
        1000*table.fx('gale',1,'pct',1)/100*table.fx('gale','thunderGodSlash','pct',1)/100);
    }
  }
  const h=scene('thunderGodSlash');h.c.testMiss=true;h.c.Math.random=()=>0;h.cast();
  assert.equal(h.events.filter(e=>e.variant==='thunder-strike').length,0);
});

test('GALE-ULT 雷神之怒機率與尺寸修改表值後跟隨，不寫死35或0.7',()=>{
  const h=scene('thunderGodSlash');h.ult.def.fx.chance=60;h.ult.def.fx.sizeMult=.4;
  h.c.Math.random=()=>.5;h.cast();
  assert.equal(h.events.find(e=>e.variant==='thunder-strike').sizeMult,.4);
  h.c.Math.random=()=>.8;h.tick(.35);
  assert.equal(h.events.filter(e=>e.variant==='thunder-strike').length,1);
});

test('GALE-ULT 多目標每次命中各擲骰，縮小的落雷仍傷害原8米邊緣敵人',()=>{
  const h=scene('thunderGodSlash',true),rolls=[.1,.8,.2];
  h.setPool([h.primary,h.enemy(170,'near'),h.enemy(180,'edge')]);
  h.c.Math.random=()=>{assert.ok(rolls.length);return rolls.shift();};h.cast();
  assert.equal(rolls.length,0);assert.equal(h.events.filter(e=>e.variant==='thunder-strike').length,2);
  assert.equal(h.hits.filter(e=>e.elem==='lightning').length,6,'兩道落雷各命中三敵，不遞迴判定');
  assert.ok(h.hits.some(e=>e.elem==='lightning'&&e.target.name==='edge'));
});

test('GALE-ULT 千鳥每段隨機五名不同目標，命中名單與特效一致且不放大搜敵半徑',()=>{
  const h=scene('chidori',true), enemies=[h.primary,...Array.from({length:7},(_,i)=>h.enemy(180+i*10,'e'+i))];
  const edge=h.enemy(300,'edge'),outside=h.enemy(300.01,'outside'),dead=h.enemy(20,'dead');dead.hp=0;
  h.setPool([...enemies,edge,outside,dead]);h.c.Math.random=()=>.99;h.cast();
  const first=h.events[0];assert.equal(first.variant,'gale-chidori');
  assert.equal(first.targets.length,5);assert.equal(new Set(first.targets).size,5);assert.equal(first.area,null);
  assert.equal(first.vfx.attack,'hit-gale-burst-10-bird');
  assert.deepEqual(Array.from(first.targets),h.hits.map(e=>e.target.name));
  assert.ok(!first.targets.includes('outside')&&!first.targets.includes('dead'));
  const expected=1000*table.fx('gale',1,'pct',1)/100*(1+table.fx('gale',7,'pct',1)/100)*(1+table.fx('gale','chidori','pct',1)/100);
  assert.ok(h.hits.every(e=>Math.abs(e.damage-expected)<1e-8));
  h.c.Math.random=()=>0;h.tick(.35);
  const second=h.events[1];assert.equal(second.targets.length,5);assert.notDeepEqual(Array.from(second.targets),Array.from(first.targets));
  h.move(1000);const fresh=Array.from({length:6},(_,i)=>h.enemy(1000+i*10,'fresh'+i));h.setPool(fresh);h.tick(.7);
  assert.ok(h.events[2].targets.every(id=>id.startsWith('fresh')));
});

test('GALE-ULT 千鳥不足五名全選，零目標停播，原目標死亡不妨礙其他敵人',()=>{
  for(const n of [0,1,3,5]) {
    const h=scene('chidori',true);h.primary.hp=0;
    const enemies=Array.from({length:n},(_,i)=>h.enemy(300,'edge'+i));h.setPool(enemies);h.cast();
    assert.equal(h.hits.length,n);assert.equal(h.events.length,n?1:0);
  }
  const h=scene('chidori');h.ult.def.fx.count=2;h.ult.def.fx.m=4;
  h.setPool([h.enemy(30,'a'),h.enemy(40,'b'),h.enemy(40.01,'outside')]);h.cast();
  assert.deepEqual(h.hits.map(e=>e.target.name).sort(),['a','b']);
  h.setPool([]);h.tick(.35);assert.equal(h.events.length,1);
});

function render(spec,preset) {
  const calls=[];
  const core={...Core,createRuntime(options){const rt=Core.createRuntime(options);return {...rt,play(id,params){calls.push(params);return rt.play(id,params);}};}};
  const a=Runtime.create({core,resolver:{has:()=>true,resolve:id=>id},
    fxBackend:{createNode:()=>({}),updateNode(){},destroyNode(){},destroy(){}},
    ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:100,y:80}),footOf:()=>({x:100,y:80})}});
  a.registerPresets([preset]);a.tryPlay(spec);a.update(.25);a.destroy();return calls;
}
test('GALE-ULT 正式落雷範圍與單體立即／延遲播放只縮70%，不改方向與命中半徑',()=>{
  const preset=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/bolt-sky-purple.json'),'utf8'));
  const dim=(p,k)=>p[k]===undefined?(p.scale===undefined?1:p.scale):p[k];
  for(const area of [null,{x:100,y:80,r:80}])for(const delay of [0,200]) {
    const spec={fxKind:'rain',variant:'thunder-strike',area,targets:['primary'],travelMs:[delay],hit:false,vfx:{attack:preset.id}};
    const base=render(spec,preset)[0],small=render({...spec,sizeMult:.7},preset)[0];
    for(const key of ['scaleX','scaleY'])assert.ok(Math.abs(dim(small,key)/dim(base,key)-.7)<1e-8);
    assert.equal(small.rotation,0);assert.deepEqual(small.position,base.position);
    if(area)assert.equal(area.r,80);
  }
});

test('GALE-ULT Worker原有視覺協議保留落雷倍率與千鳥逐敵名單',()=>{
  const h=scene('thunderGodSlash');h.c.Math.random=()=>0;h.cast();
  const bolt=h.events.find(e=>e.variant==='thunder-strike');
  const worker={console,Date,performance:{now:()=>0}};worker.self=worker;vm.createContext(worker);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/worker/shim.js'),'utf8'),worker);
  worker.playCombatVfx(bolt);
  const sent=worker.shimDrainUrgentVisualEvents()[0];assert.equal(sent.sizeMult,.7);assert.equal(sent.area.r,bolt.area.r);
  const birds=scene('chidori',true);birds.cast();worker.playCombatVfx(birds.events[0]);
  const sentBird=worker.shimDrainUrgentVisualEvents()[0];
  assert.equal(sentBird.variant,'gale-chidori');assert.deepEqual(Array.from(sentBird.targets),Array.from(birds.events[0].targets));
});
