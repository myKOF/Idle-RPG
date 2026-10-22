'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../js/vfx-core.js'), Runtime = require('../js/vfx-runtime.js');
const preset = require('../vfx/presets/en-poison-cross.json');
const author = require('../tools/vfx/authoring/author/poison-trail.cjs');
const { loadEliteEnv, makeElite, stepElite } = require('./helpers/elite-env.cjs');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function field(d) {
  const c = loadEliteEnv(); c.FIELD.player.hp = c.FIELD.player.maxHp = 1e12;
  const m = makeElite(c, ['e_poisoncross'], {x:200,y:200,hp:1e9});
  Object.keys(m._el.cd).forEach(k => m._el.cd[k] = 1e9); m._el.repoAt = Infinity;
  const def = Object.assign({}, c.ELITE_AFFIXES.e_poisoncross, d);
  c.eliteCastCross(m, def); stepElite(c, def.warn + .1);
  return {c, def, cross:c.ELITE_RT.crosses[0]};
}
function adapter() {
  const nodes = []; let alive = 0;
  const backend = {createNode(s) {const n = {s}; nodes.push(n); alive++; return n;},
    updateNode(n,t) {n.t = {...t};}, destroyNode() {alive--;}};
  const rt = Runtime.create({core:Core,resolver:{has:()=>true,resolve:x=>x},zoneBackend:backend,fxBackend:backend,
    groundScale:.5,profile:{areaScale:7},ctx:{posOf:()=>null,playerPos:()=>({x:0,y:0})}});
  rt.registerPresets([preset]);
  return {rt,nodes,alive:()=>alive};
}
test('POISON-TRAIL 四條原創流動圖層，移除圓球堆疊，作者與出貨一致', () => {
  assert.deepEqual(preset, author.make()); assert.equal(Core.validatePreset(preset).ok, true);
  assert.equal(preset.layers.length, 4);
  assert.ok(preset.layers.every(l => l.assetId === author.assetId && l.sheet.count === 64 && l.sheet.fps === 8 && l.blendMode === 'normal'));
  const svg = author.liquidSVG(); assert.equal((svg.match(/<clipPath id="c\d+"/g)||[]).length,64);
  assert.ok(svg.includes('#253c08') && svg.includes('#c1eb49'));
});
test('POISON-FLAT-FLOW 完整循環中心與寬度固定，邊緣整輪擾動不到半個材質像素', () => {
  for (let x=7;x<=505;x+=3) {
    const initial=author.surfaceAt(x,0), top=[],bottom=[];
    for(let frame=0;frame<=64;frame++) {
      const s=author.surfaceAt(x,frame);
      near(s.center,initial.center);near(s.radius,initial.radius);top.push(s.upper);bottom.push(s.lower);
    }
    assert.ok(Math.max(...top)-Math.min(...top)<=.440001);
    assert.ok(Math.max(...bottom)-Math.min(...bottom)<=.440001);
    near(top[0],top[64]);near(bottom[0],bottom[64]);
  }
});
test('POISON-FLAT-FLOW 內流單向緩移，8秒循環，四臂不再各自快速扭動', () => {
  near(author.FRAMES/author.FPS,8);
  for(let frame=1;frame<64;frame++)near(author.flowOffset(frame)-author.flowOffset(frame-1),1);
  near(author.flowOffset(64),0);near(author.FLOW_TILE*author.FPS/author.FRAMES,8);
  assert.ok(preset.layers.every(l=>l.sheet.fps===8));
});
test('POISON-STRAIGHT 水道主軸接近直線，側岸只有局部細碎起伏，不再大幅收腰', () => {
  const centers=[],radii=[];
  for(let x=55;x<=457;x++) {
    const s=author.surfaceAt(x);
    centers.push(s.center);radii.push(s.radius);
    assert.ok(Math.abs(s.center-64)<2,'中心線偏移限制在小幅局部起伏');
    assert.ok(s.radius>40 && s.radius<46,'保持水帶，不能縮成蛇形細腰');
    assert.ok(Math.abs(s.upper-21)<6 && Math.abs(s.lower-107)<6,'兩岸沿直線方向延伸');
  }
  assert.ok(Math.max(...centers)-Math.min(...centers)<4);
  assert.ok(Math.max(...radii)-Math.min(...radii)<5.1);
});
test('POISON-TRAIL 實際命中沿連續水帶伸展，前緣之外及兩臂間安全，角度／寬度取表定值', () => {
  const {c,def,cross:x} = field({len:240,speed:80,ballR:24,dur:7,balls:1});
  const pp = c.bfPlayerPos(), angle = x.a;
  function hurt(along, across, age) {
    c.GT = x.t0 + age; x.nextTick = 0;
    pp.x = x.x + Math.cos(angle)*along - Math.sin(angle)*across;
    pp.y = x.y + Math.sin(angle)*along + Math.cos(angle)*across;
    const hp = c.FIELD.player.hp; c.eliteCrossesTick(.3); return hp > c.FIELD.player.hp;
  }
  assert.equal(hurt(72,0,1),true,'舊單球尚未出生的位置已連續流到');
  assert.equal(hurt(180,0,1),false,'未流到的遠處安全');
  assert.equal(hurt(120,120,3),false,'兩臂之間安全');
  assert.equal(hurt(240,0,3),true,'最遠前緣可命中');
  assert.equal(hurt(160,24+c.ELITE_PLAYER_BODY_R+.1,3),false,'半寬之外安全');
  assert.equal(hurt(160,24+c.ELITE_PLAYER_BODY_R-.1,3),true,'水帶內側命中');
  const e = c.vfx.find(e=>e.variant==='elite-poison-trail');
  assert.ok(e); assert.deepEqual([e.area.w,e.area.h,e.area.r,e.travelMs[0]],[240,48,240,3000]);
  near(e.area.a,angle); near(e.area.growAge,0); near(e.area.lifeSec,def.dur);
  c.GT=x.until; c.eliteCrossesTick(.1); assert.equal(c.ELITE_RT.crosses.length,0);
});
test('POISON-TRAIL 正式事件逐幀投影、續送不重生，表定不同幾何及四個方向皆一致', () => {
  for (const geometry of [{len:360,speed:120,ballR:40,dur:16},{len:240,speed:80,ballR:24,dur:7}]) {
    const {c,cross} = field(geometry), e = c.vfx.find(e=>e.variant==='elite-poison-trail');
    const {rt,nodes,alive} = adapter(); assert.equal(rt.tryPlay(Runtime.screenSpaceSpec(e,.5)),true);
    for (let frame=1; frame<=180; frame++) {
      rt.update(1/60); const age=frame/60, reach=Math.min(geometry.len,geometry.speed*age);
      assert.equal(nodes.length,4);
      nodes.forEach((n,arm)=>{
        const t=n.t,a=cross.a+arm*Math.PI/2;
        near(t.x,e.area.x+Math.cos(a)*reach/2); near(t.y,e.area.y*.5+Math.sin(a)*reach/4);
        near(Math.cos(t.rotation)*t.scaleX*512,Math.cos(a)*(reach+2*geometry.ballR));
        near(Math.sin(t.rotation)*t.scaleX*512,Math.sin(a)*(reach+2*geometry.ballR)*.5);
        near(-Math.sin(t.rotation-t.skewX)*t.scaleY*128,-Math.sin(a)*2*geometry.ballR);
        near(Math.cos(t.rotation-t.skewX)*t.scaleY*128,Math.cos(a)*geometry.ballR);
      });
      if(frame===60) {
        c.GT=cross.t0+age; c.eliteVisEmit(cross.vis);
        rt.tryPlay(Runtime.screenSpaceSpec(c.vfx[c.vfx.length-1],.5));
      }
    }
    assert.equal(rt.stats().grounds,4); assert.equal(rt.stats().zone.activeParticles,0);
    for(let i=0;i<geometry.dur*60;i++)rt.update(1/60);
    assert.equal(rt.stats().grounds,0); assert.equal(rt.stats().zone.activeEffects,0);
    rt.destroy(); assert.equal(alive(),0);
  }
});
test('POISON-TRAIL 晚加入以growAge重建前緣，零剩餘壽命立即回收；舊事件可播放', () => {
  const {c} = field(), original=c.vfx.find(e=>e.variant==='elite-poison-trail');
  const {rt,nodes,alive}=adapter();
  const late=JSON.parse(JSON.stringify(original));late.area.growAge=1.5;late.area.lifeSec=2;
  rt.tryPlay(Runtime.screenSpaceSpec(late,.5));rt.update(.01);
  near(Math.hypot(nodes[0].t.x-original.area.x,(nodes[0].t.y-original.area.y*.5)*2),90.6);
  late.area.lifeSec=0;rt.tryPlay(Runtime.screenSpaceSpec(late,.5));rt.update(.01);
  assert.equal(rt.stats().grounds,0);rt.destroy();assert.equal(alive(),0);
  const legacy=adapter(); assert.equal(legacy.rt.tryPlay({fxKind:'aura',variant:'elite-ground',dur:.2,
    area:{id:'legacy',x:0,y:0,r:360},vfx:{ground:preset.id}}),true);legacy.rt.destroy();
});
