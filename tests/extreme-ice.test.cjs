'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
function setup(lv = 1) {
  const file = path.join(__dirname, 'skill2-waterball-frostnova-legendary.test.cjs');
  const src = fs.readFileSync(file, 'utf8');
  const h = { require: createRequire(file), __dirname, console };
  vm.createContext(h);
  vm.runInContext(src.slice(0, src.indexOf('test(')) + '\nthis.c=loadContext();', h);
  const c = h.c, p = h.playerEnt();
  h.maxLevels(c, 'frostnova'); h.equip(c, 'frostnova'); h.setUlt(c, 'frostnova', 'crystalResonance', lv);
  const realHit=c.resolveHit;
  const hits = h.stubHits(c), specs = h.stubVfx(c);
  c.chance = () => false;
  return { h, c, p, hits, specs, realHit };
}
test('極致之冰：各來源凍結延長與遞減後標記、暈眩時間一致', () => {
  for (const [lv, sec] of [[1,4.65],[5,5.25],[10,6]]) {
    for (const [gid,tier] of [['icearrow','2'],['waterball','3'],['frostnova','1']]) {
      const {h,c} = setup(lv), e = h.enemy(1e9,0,0,'source');
      assert.ok(Math.abs(c.sgFreezeTarget(e,{gid,tier})-sec)<1e-9);
      assert.ok(Math.abs(e.buffs.sgFrozen.until-sec)<1e-9);
      assert.equal(e.buffs.sgFrozen.until, e.effects.stun);
      e._spawnAt=-50;
      const again = c.sgFreezeTarget(e,{gid,tier});
      assert.ok(again < sec); assert.equal(e.buffs.sgFrozen.until,e.effects.stun);
    }
  }
});
test('極致之冰：單一凍結源每半秒炸所有範圍內敵人，事件與半徑一致', () => {
  const {h,c,p,hits,specs}=setup();
  const es=[h.enemy(1e9,100,0,'source'),h.enemy(1e9,179,0,'near'),h.enemy(1e9,250,0,'far')];
  c.applyStatus(es[0],'sgFrozen',{val:0,dur:5});
  c.sgTickCrystalResonance(h.tickCtx(c,p,es),0);
  c.GT=.499;c.sgTickCrystalResonance(h.tickCtx(c,p,es),.499);assert.equal(hits.length,0);
  c.GT=.5;c.sgTickCrystalResonance(h.tickCtx(c,p,es),.001);
  assert.deepEqual(Array.from(hits,x=>x.ent.name),['source','near']);
  hits.forEach(x=>{assert.equal(x.atk,1100);assert.equal(x.elem,'ice');});
  assert.equal(specs.length,1);assert.equal(specs[0].variant,'frozen-ice-blast');
  assert.equal(specs[0].fxKind,'burst');assert.equal(specs[0].area.r,80);
  assert.equal(specs[0].area.x,100);assert.equal(specs[0].area.y,0);
  c.GT=1;c.sgTickCrystalResonance(h.tickCtx(c,p,es),.5);assert.equal(hits.length,4);
  c.G.player.loadout=[];c.GT=1.5;c.sgTickCrystalResonance(h.tickCtx(c,p,es),.5);assert.equal(hits.length,4);
});
test('極致之冰：每級傷害、到期及倒地不爆、不追補', () => {
  for(const [lv,atk] of [[1,1100],[5,1500],[10,2000]]) {
    const {h,c,p,hits}=setup(lv),es=[h.enemy(1e9,0,0,'source')];
    c.applyStatus(es[0],'sgFrozen',{val:0,dur:5});
    c.sgTickCrystalResonance(h.tickCtx(c,p,es),0);
    c.GT=.5;c.sgTickCrystalResonance(h.tickCtx(c,p,es),.5);assert.equal(hits[0].atk,atk);
    p.hp=0;c.GT=2.5;c.sgTickCrystalResonance(h.tickCtx(c,p,es),2);assert.equal(hits.length,1);
    p.hp=1000;c.GT=2.999;c.sgTickCrystalResonance(h.tickCtx(c,p,es),.499);assert.equal(hits.length,1);
    c.GT=3;c.sgTickCrystalResonance(h.tickCtx(c,p,es),.001);assert.equal(hits.length,2);
    c.GT=5;c.sgTickCrystalResonance(h.tickCtx(c,p,es),2);assert.equal(hits.length,2);
  }
});
test('極致之冰：未裝配或未選超神不延長凍結，死亡不做冰爆來源',()=>{
  for(const disable of [c=>c.G.player.loadout=[],c=>delete c.G.player.skills2.ult.frostnova]){
    const {h,c}=setup();disable(c);assert.equal(c.sgFreezeTarget(h.enemy(1e9,0,0,'e'),{gid:'frostnova',tier:'1'}),3);
  }
  const {h,c,p,hits}=setup(),es=[h.enemy(0,0,0,'dead'),h.enemy(1e9,10,0,'live')];
  c.applyStatus(es[0],'sgFrozen',{val:0,dur:5});c.sgTickCrystalResonance(h.tickCtx(c,p,es),0);
  c.GT=.5;c.sgTickCrystalResonance(h.tickCtx(c,p,es),.5);assert.equal(hits.length,0);
});
test('極致之冰：正式Runtime冰爆只播放配置特效、依實際半徑縮放並回收',()=>{
  const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
  const {h,c,p,specs}=setup(),es=[h.enemy(1e9,100,30,'source')];
  c.applyStatus(es[0],'sgFrozen',{val:0,dur:5});c.sgTickCrystalResonance(h.tickCtx(c,p,es),0);
  c.GT=.5;c.sgTickCrystalResonance(h.tickCtx(c,p,es),.5);
  const shim={};shim.self=shim;vm.createContext(shim);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/worker/shim.js'),'utf8'),shim);
  shim.playCombatVfx(specs[0]);const event=JSON.parse(JSON.stringify(shim.shimDrainUrgentVisualEvents()[0]));
  assert.deepEqual(event.vfx,{attack:'burst-icearrow-crystal'});
  assert.deepEqual(event.area,{x:100,y:30,r:80});assert.equal(event.variant,'frozen-ice-blast');
  function render(r){
    const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
    const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:999,y:999})}});
    rt.registerPresets([require('../vfx/presets/burst-icearrow-crystal.json')]);
    assert.equal(rt.tryPlay({...event,area:{...event.area,r}}),true);rt.update(.14);
    const n=nodes.find(n=>n.spec.assetUrl==='codex-authored/icearrow/icicle.png'&&n.t?.visible);assert.ok(n);
    const transform={...n.t};rt.update(2);assert.ok(!nodes.some(n=>n.t?.visible));rt.destroy();return transform;
  }
  const a=render(80),b=render(40);assert.ok(Math.abs(a.scaleX/b.scaleX-2)<1e-9);
  assert.ok(Math.abs(a.scaleY/b.scaleY-2)<1e-9);
});
test('極致之冰：真實傷害結算與死亡回報一次，已死凍結源不再爆',()=>{
  const {h,c,p,specs,realHit}=setup(),es=[h.enemy(5000,0,0,'source'),h.enemy(100,10,0,'victim')];
  c.resolveHit=realHit;c.chance=pct=>pct>=100;c.Math.random=()=>.5;
  es.forEach(e=>c.applyStatus(e,'sgFrozen',{val:0,dur:5}));
  let damage=0,deaths=0;const ctx={...h.tickCtx(c,p,es),onDamage:d=>damage+=d,onDeaths:()=>deaths++};
  c.sgTickCrystalResonance(ctx,0);c.GT=.5;c.sgTickCrystalResonance(ctx,.5);
  assert.equal(es[0].hp,3900);assert.equal(es[1].hp,0);assert.equal(damage,2200);assert.equal(deaths,1);
  assert.equal(specs.length,1,'第一個冰爆殺死第二來源，第二來源不得死後冰爆');
});
test('極致之冰：高塔無座標退化與BOSS免控維持原規則',()=>{
  const {h,c,p,hits}=setup(),e=h.enemy(1e9,undefined,undefined,'tower');
  c.applyStatus(e,'sgFrozen',{val:0,dur:5});c.sgTickCrystalResonance(h.tickCtx(c,p,[e]),0);
  c.GT=.5;c.sgTickCrystalResonance(h.tickCtx(c,p,[e]),.5);assert.equal(hits.length,1);
  assert.equal(c.sgFreezeTarget({...h.enemy(1e9,0,0,'boss'),isBoss:true},{gid:'frostnova',tier:'1'}),0);
});
test('極致之冰：跟隨凍結來源當下位置，使用含敵人體型的原生範圍邊界',()=>{
  const {h,c,p,hits,specs}=setup(),body=c.bfBodyRadius();
  const es=[h.enemy(1e9,0,0,'source'),h.enemy(1e9,100+80+body-.001,20,'touch'),h.enemy(1e9,100+80+body+.001,20,'outside')];
  c.applyStatus(es[0],'sgFrozen',{val:0,dur:5});c.sgTickCrystalResonance(h.tickCtx(c,p,es),0);
  es[0].pos={x:100,y:20};c.GT=.5;c.sgTickCrystalResonance(h.tickCtx(c,p,es),.5);
  assert.deepEqual(Array.from(hits,x=>x.ent.name),['source','touch']);
  assert.deepEqual({...specs[0].area},{x:100,y:20,r:80});
});
test('極致之冰：Excel／CSV／JS同步，半徑由傷害欄而非搜敵欄接線',()=>{
  const tables=require('../tools/config_tables.cjs'),geo=require('../tools/skills2-geometry.cjs');
  const root=path.join(__dirname,'..'),rows=tables.readXlsxRows(path.join(root,'config/Excel/Skills2.xlsx'));
  const csv=tables.csvParse(fs.readFileSync(path.join(root,'config/CSV/Skills2.csv'),'utf8'));
  assert.deepEqual(csv,rows);
  const row=rows.find(r=>r[8]==='crystalResonance'),header=rows[0];
  assert.equal(row[header.indexOf(geo.labels.damage)],'8');assert.equal(row[header.indexOf(geo.labels.search)],'');
  assert.equal(row[header.indexOf(geo.labels.gap)],'0.5');
  const {c}=setup();assert.deepEqual({...c.SKILLS2.frostnova.ult[1].fx},{pct:200,pctPer:20,durPct:50,durPctPer:5,gap:.5,m:8});
  assert.deepEqual(geo.apply('frostnova','crystalResonance',{},col=>col===geo.labels.damage?'8':'').fx,{m:8});
  assert.throws(()=>geo.apply('frostnova','crystalResonance',{},col=>col===geo.labels.search?'8':''));
  const data=tables.evalLiteral(tables.extractLiteral(fs.readFileSync(path.join(root,'js/skills2.js'),'utf8'),'SKILLS2').literal);
  const compiled=tables.evalLiteral(tables.extractLiteral(tables.SCHEMAS.Skills2.rebuild(rows.slice(1),header).SKILLS2,'SKILLS2').literal);
  assert.deepEqual(compiled,data);
});
