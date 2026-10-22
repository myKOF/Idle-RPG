'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');
const { loadEliteEnv, makeElite, stepElite } = require('./helpers/elite-env.cjs');

function setup(k, context, params) {
  const nodes = [];
  const backend = tag => ({
    createNode(spec) { const n = { spec, tag }; nodes.push(n); return n; },
    updateNode(n, t) { n.t = { ...t }; },
    destroyNode(n) { n.dead = true; }
  });
  const core = !params ? Core : { ...Core, createRuntime(options) {
    const rt = Core.createRuntime(options), play = rt.play, set = rt.setTransform;
    rt.play = function(id,p) { params.push(structuredClone(p)); return play(id,p); };
    rt.setTransform = function(id,p) { params.push(structuredClone(p)); return set(id,p); };
    return rt;
  }};
  const adapter = Runtime.create({ core, groundScale: k,
    resolver: { has: () => true, resolve: id => id },
    fxBackend: backend('fx'), zoneBackend: backend('ground'), billboardBackend: backend('raised'),
    ctx: Object.assign({ posOf: () => ({x:0,y:0}), playerPos: () => ({x:0,y:0}) }, context)
  });
  return { adapter, nodes };
}
function preset(id) { return JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../vfx/presets', id + '.json'), 'utf8')); }
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-7, `${a} != ${b}`);

test('火鏈所有鏈環版本：各方向／投影固定抬高2米，使用空中層且依原腳點排序', () => {
  const c = loadEliteEnv();
  for (const {id} of c.eliteChainVariants(c.ELITE_AFFIXES.e_firechain)) {
    for (const k of [1, 0.5, 0.3]) for (const angle of [0, Math.PI/3, Math.PI/2]) {
      const raised = setup(k), floor = setup(k);
      raised.adapter.registerPresets([preset(id)]); floor.adapter.registerPresets([preset(id)]);
      const ev = { fxKind:'aura', variant:'elite-ground', dur:0.2,
        area:{id:'elite-chain-1',x:80,y:120,w:200,h:15,a:angle,speed:20,moveA:angle},vfx:{ground:id} };
      assert.equal(raised.adapter.tryPlay(ev), true);
      assert.equal(floor.adapter.tryPlay({...ev,area:{...ev.area,id:'elite-warn-1'}}), true);
      for (let frame=0; frame<20; frame++) {
        if (frame===10) {
          raised.adapter.tryPlay(ev);
          floor.adapter.tryPlay({...ev,area:{...ev.area,id:'elite-warn-1'}});
        }
        raised.adapter.update(0.016); floor.adapter.update(0.016);
        assert.equal(raised.nodes.length, floor.nodes.length);
        raised.nodes.forEach((n,i) => {
          if (!n.t || n.dead) return;
          const t = floor.nodes[i].t;
          assert.equal(n.tag,'raised'); assert.equal(floor.nodes[i].tag,'ground');
          near(n.t.x,t.x); near(n.t.y,t.y-20); near(n.t.sortY,t.sortY);
          for (const f of ['scaleX','scaleY','rotation']) near(n.t[f],t[f]);
        });
      }
      for (let frame=0; frame<180; frame++) raised.adapter.update(1/60);
      assert.equal(raised.adapter.stats().grounds, 0, '停止續命後移除場域');
      assert.ok(raised.nodes.every(n=>n.dead || n.t.visible===false), '節點銷毀或隱藏回池');
    }
  }
});

test('正式火鏈事件抬高但保留地面連線與傷害判定，移離後停止受傷', () => {
  const c = loadEliteEnv(); c.FIELD.player.hp = c.FIELD.player.maxHp = 1e12;
  const a = makeElite(c,['e_firechain'],{x:-120,y:0,hp:1e9});
  const b = makeElite(c,['e_vitality'],{x:120,y:0,hp:1e9});
  for (const m of [a,b]) { m._enterCd=0; m._el.repoAt=Infinity; for (const id in m._el.cd) m._el.cd[id]=1e9; }
  stepElite(c,1);
  const ev = c.vfx.find(v=>v.area && /^elite-chain-/.test(v.area.id));
  assert.ok(ev); assert.equal(ev.area.y,0); assert.equal(ev.area.w,240);
  assert.deepEqual(Array.from(ev.targets),[a.floatSel,b.floatSel].sort());
  const vm=require('node:vm'),path=require('node:path'),wire={};wire.self=wire;vm.createContext(wire);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/worker/shim.js'),'utf8'),wire);
  wire.playCombatVfx(ev);
  const sent=wire.shimDrainUrgentVisualEvents().find(v=>v.area && v.area.id===ev.area.id);
  assert.deepEqual(Array.from(sent.targets),Array.from(ev.targets),'Worker通道保留同一對端點');
  assert.ok(c.FIELD.player.hp < 1e12);
  const {adapter,nodes}=setup(0.5); adapter.registerPresets([preset(ev.vfx.ground)]);
  assert.equal(adapter.tryPlay(ev),true); adapter.update(0.01);
  assert.ok(nodes.length>0); nodes.forEach(n=>{ if(n.t) { near(n.t.sortY,0); assert.equal(n.tag,'raised'); } });
  c.bfPlayerPos().y=200; const hp=c.FIELD.player.hp; stepElite(c,1);
  assert.equal(c.FIELD.player.hp,hp);
  b.hp=0; stepElite(c,0.5); assert.equal(c.ELITE_RT.chains.length,0);
});

test('三或四隻NPC的正式火鏈事件完整閉合，所有鏈條同時懸空播放', () => {
  for (const count of [3,4]) {
  const c = loadEliteEnv(); c.FIELD.player.hp = c.FIELD.player.maxHp = 1e12;
  const points = [[-180,-80],[180,-80],[180,160],[-180,160]].slice(0,count);
  const monsters = points.map(([x,y],i) => makeElite(c,i===0?['e_firechain']:['e_vitality'],{x,y,hp:1e9}));
  for (const m of monsters) { m._enterCd=0; m._el.repoAt=Infinity; for (const id in m._el.cd) m._el.cd[id]=1e9; }
  stepElite(c,0.3);
  assert.equal(c.ELITE_RT.chains.length,count);
  const events = new Map(c.vfx.filter(v=>v.area && /^elite-chain-/.test(v.area.id)).map(v=>[v.area.id,v]));
  assert.equal(events.size,count,'末尾閉合邊也必須派送');
  const expectedPairs = points.map((_,i)=>[monsters[i].floatSel,monsters[(i+1)%count].floatSel].sort().join('|')).sort();
  assert.deepEqual(Array.from(c.ELITE_RT.chains,v=>v.key).sort(),expectedPairs);
  const {adapter,nodes}=setup(0.5,{targetAlive:id=>monsters.some(m=>m.floatSel===id&&m.hp>0),
    footOf:id=>{const m=monsters.find(m=>m.floatSel===id);return m?{x:m.pos.x,y:m.pos.y*.5}:null;}});
  adapter.registerPresets([...new Set([...events.values()].map(v=>v.vfx.ground))].map(preset));
  for (const chain of c.ELITE_RT.chains) {
    const ev = events.get(chain.vis.id), a=chain.a.pos, b=chain.b.pos;
    near(ev.area.x,(a.x+b.x)/2); near(ev.area.y,(a.y+b.y)/2);
    near(ev.area.w,Math.hypot(b.x-a.x,b.y-a.y));
    assert.equal(adapter.tryPlay(ev),true);
  }
  adapter.update(0.01);
  assert.equal(adapter.stats().grounds,count);
  assert.equal(adapter.stats().billboard.activeEffects,count);
  assert.equal(adapter.stats().zone.activeEffects,0);
  assert.equal(new Set(nodes.filter(n=>n.t && n.t.visible!==false).map(n=>n.t.sortGroup)).size,count);
  assert.ok(nodes.every(n=>n.tag==='raised'));
  }
});

test('移動中的兩端每幀跟NPC腳點；角度／長度不落後，大小與舊快照不干擾', () => {
  for (const k of [0.3,0.5,1]) {
    let a={x:-130,y:-70*k}, b={x:180,y:170*k}, alive=true;
    const params=[];
    const {adapter,nodes}=setup(k,{footOf:id=>id==='a'?a:b,targetAlive:()=>alive,
      posOf:()=>({x:99999,y:-99999})},params);
    const p=preset('en-fire-chain-23'); adapter.registerPresets([p]);
    const ev={fxKind:'aura',variant:'elite-ground',dur:10,targets:['a','b'],
      area:{id:'elite-chain-moving',x:999,y:999,w:20,h:15,a:0},vfx:{ground:p.id}};
    adapter.tryPlay(ev);
    for(let frame=0;frame<20;frame++) {
      a={x:-250+frame*19,y:(frame%2?220:-140)*k};
      b={x:180-frame*7,y:(frame*17-180)*k};
      if(frame===10)adapter.tryPlay(ev); // 過時的補送不能把鏈條拖回舊位置。
      adapter.update(1/60);
      const t=params.at(-1), dx=b.x-a.x, dy=(b.y-a.y)/k;
      near(t.position.x,(a.x+b.x)/2);near(t.position.y,(a.y+b.y)/2-20);
      near(t.depthY,(a.y+b.y)/2);near(t.elevation,20);
      near(t.projectionRotation,Math.atan2(dy,dx));
      near(t.scaleX,Math.hypot(dx,dy)/p.sizing.authored.width);
      near(t.scaleY,15/p.sizing.authored.height);
      assert.equal(adapter.stats().grounds,1);
      assert.ok(nodes.some(n=>n.t && n.t.elevation===20),'Core傳給Renderer的高度不遺失');
    }
    alive=false;adapter.update(1/60);
    assert.equal(adapter.stats().grounds,0,'NPC死亡立即移除，不保留舊端點');
    assert.ok(nodes.every(n=>n.dead || n.t.visible===false));
  }
});

test('失去NPC腳點時不回退到玩家，未帶端點的歷史事件仍可播放', () => {
  const {adapter}=setup(0.5,{footOf:()=>null,targetAlive:()=>true});
  const p=preset('en-fire-chain-10');adapter.registerPresets([p]);
  const ev={fxKind:'aura',variant:'elite-ground',dur:1,targets:['missing-a','missing-b'],
    area:{id:'elite-chain-missing',x:30,y:40,w:100,h:15},vfx:{ground:p.id}};
  assert.equal(adapter.tryPlay(ev),true);assert.equal(adapter.stats().grounds,0);
  delete ev.targets;
  assert.equal(adapter.tryPlay(ev),true);adapter.update(.01);assert.equal(adapter.stats().grounds,1);
});

test('懸空鏈環依自己的地面錨點做FOV換算，遠近角落無中點透視偏移', () => {
  const vm=require('node:vm'),path=require('node:path');
  const {extractFunction}=require('./helpers/battle-scene.cjs');
  const src=fs.readFileSync(path.join(__dirname,'../js/battle-renderer.js'),'utf8');
  const c={Math,S:{layers:{world:{x:17,y:-29}},persp:null}};vm.createContext(c);
  for(const name of ['perspectiveLayout','airScreenPose','projectedWarp','depthScaleOf','projectBillboardTransform'])vm.runInContext(extractFunction(src,name),c);
  c.S.persp={layout:c.perspectiveLayout(700,680,.82)};
  for(const x of [0,350,700])for(const floorY of [0,340,680]) {
    const t={x,y:floorY-20,sortY:340,elevation:20,scaleX:2,scaleY:3,rotation:.7};
    const before=JSON.stringify(t),out=c.projectBillboardTransform(t),ground=c.airScreenPose(x,floorY);
    near(out.x,ground.x);near(out.y,ground.y-20*ground.scale);
    near(out.scaleX,2*ground.scale);near(out.scaleY,3*ground.scale);
    assert.equal(JSON.stringify(t),before);
    const upright=c.projectBillboardTransform({...t,elevation:undefined});
    const anchor=c.airScreenPose(x,340);
    near(upright.y,anchor.y+(t.y-340)*anchor.scale);
  }
});

test('Core懸空高度涵蓋sprite與particle，重用transform不污染一般特效', () => {
  const nodes=[];
  const rt=Core.createRuntime({backend:{createNode(){const n={};nodes.push(n);return n;},
    updateNode(n,t){n.t={...t};},destroyNode(){}},resolver:{has:()=>true,resolve:id=>id}});
  const p=preset('en-fire-chain-10');rt.registerPreset(p);
  const raised=rt.play(p.id,{elevation:20}),normal=rt.play(p.id,{});
  rt.update(.1);
  assert.ok(nodes.some(n=>n.t.sortGroup===raised));
  assert.ok(nodes.some(n=>n.t.sortGroup===normal));
  for(const n of nodes)if(n.t.visible!==false)assert.equal(n.t.elevation,n.t.sortGroup===raised?20:undefined);
  rt.setTransform(raised,{elevation:0});rt.update(.1);
  assert.ok(nodes.every(n=>n.t.visible===false || n.t.elevation===undefined));
  assert.throws(()=>rt.setTransform(normal,{elevation:NaN}),/elevation/);
  rt.destroy();
});
