'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');
const { loadEliteEnv, makeElite, stepElite } = require('./helpers/elite-env.cjs');

function setup(k) {
  const nodes = [];
  const backend = tag => ({
    createNode(spec) { const n = { spec, tag }; nodes.push(n); return n; },
    updateNode(n, t) { n.t = { ...t }; },
    destroyNode(n) { n.dead = true; }
  });
  const adapter = Runtime.create({ core: Core, groundScale: k,
    resolver: { has: () => true, resolve: id => id },
    fxBackend: backend('fx'), zoneBackend: backend('ground'), billboardBackend: backend('raised'),
    ctx: { posOf: () => ({x:0,y:0}), playerPos: () => ({x:0,y:0}) }
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
  assert.ok(c.FIELD.player.hp < 1e12);
  const {adapter,nodes}=setup(0.5); adapter.registerPresets([preset(ev.vfx.ground)]);
  assert.equal(adapter.tryPlay(ev),true); adapter.update(0.01);
  assert.ok(nodes.length>0); nodes.forEach(n=>{ if(n.t) { near(n.t.sortY,0); assert.equal(n.tag,'raised'); } });
  c.bfPlayerPos().y=200; const hp=c.FIELD.player.hp; stepElite(c,1);
  assert.equal(c.FIELD.player.hp,hp);
  b.hp=0; stepElite(c,0.5); assert.equal(c.ELITE_RT.chains.length,0);
});
