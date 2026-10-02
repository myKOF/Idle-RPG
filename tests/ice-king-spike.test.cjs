'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const {createRequire}=require('module');
const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
const preset=require('../vfx/presets/ground-ice-spike.json');
function setup(){
 const file=path.join(__dirname,'skill2-waterball-frostnova-legendary.test.cjs'),src=fs.readFileSync(file,'utf8');
 const h={require:createRequire(file),__dirname,console};vm.createContext(h);
 vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',h);
 const c=h.c,p=h.playerEnt();p.mp=10000;p.pos={x:0,y:0};c.FIELD.player=p;
 h.maxLevels(c,'frostnova');h.setUlt(c,'frostnova','iceKingDomain',1);h.equip(c,'frostnova');
 c.chance=()=>false;c.Math.random=()=>.5;
 return {h,c,p,hits:h.stubHits(c),specs:h.stubVfx(c)};
}
test('冰皇冰錐：獨立配置與原8米／4段傷害，冰箭不換外觀',()=>{
 const {h,c,p,hits,specs}=setup(),body=c.bfBodyRadius();
 const es=[h.enemy(1e9,100,30,'source'),h.enemy(1e9,180+body-.001,30,'edge'),h.enemy(1e9,180+body+.001,30,'outside')];
 const st=c.getStats(),spec=c.sgIceSpikeSpec(c.SKILLS2.frostnova,st,{pct:220,hits:4,m:8});
 c.sgSpawnIceSpike(p,st,'frostnova',spec,'mv-float',es[0]);h.advance(c,p,es,1.5);
 assert.equal(hits.length,8);assert.equal(hits.filter(x=>x.ent===es[0]).length,4);assert.equal(hits.filter(x=>x.ent===es[1]).length,4);
 assert.ok(hits.every(x=>x.atk===c.sgGroupBaseStat(c.SKILLS2.frostnova,st)*2.2));
 const events=specs.filter(s=>s.vfx?.ground==='ground-ice-spike');assert.equal(events.length,4);
 events.forEach(s=>assert.deepEqual({x:s.area.x,y:s.area.y,r:s.area.r},{x:100,y:30,r:80}));
 assert.equal(c.SKILL2_RT.grounds.filter(f=>f.kind==='icespike').length,0);
 assert.equal(c.SKILLS2.icearrow.tiers[0].vfx.projectile,'proj-icearrow-frost');
});
test('冰皇冰錐：實際暴風雪每秒生成2至8根並派送新特效',()=>{
 const {h,c,p,specs}=setup(),es=[h.enemy(1e9,40,0,'target')];
 assert.ok(c.castSkill2(p,es,'frostnova','mv-float'));h.advance(c,p,es,1.1);
 const spikes=c.SKILL2_RT.grounds.filter(f=>f.kind==='icespike');assert.equal(spikes.length,5);
 assert.ok(spikes.every(f=>f.radius===80&&f.hits===4));
 assert.equal(specs.filter(s=>s.vfx?.ground===preset.id).length,5);
 assert.ok(specs.some(s=>s.variant==='blizzard'&&s.vfx.ground==='ground-blizzard'));
});
test('冰皇冰錐：Worker至正式Runtime保持向上、小尺寸、地面中心與回收',()=>{
 const {h,c,p,specs}=setup(),e=h.enemy(1e9,100,30,'source');
 c.sgSpawnIceSpike(p,c.getStats(),'frostnova',{dmgVal:100,hits:4,radius:80},'mv-float',e);h.advance(c,p,[e],.1);
 const spec=specs.find(s=>s.vfx?.ground==='ground-ice-spike');assert.ok(spec);
 const shim={};shim.self=shim;vm.createContext(shim);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/worker/shim.js'),'utf8'),shim);
 shim.playCombatVfx(spec);const event=JSON.parse(JSON.stringify(shim.shimDrainUrgentVisualEvents()[0]));
 function render(radius){
  const nodes=[];function backend(kind){return {createNode(spec){const n={kind,spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};}
  const rt=Runtime.create({core:Core,resolver:{resolve:id=>id},groundScale:.65,fxBackend:backend('fx'),zoneBackend:backend('ground'),billboardBackend:backend('billboard'),ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:999,y:999})}});
  rt.registerPresets([preset]);assert.equal(rt.tryPlay({...event,area:{...event.area,r:radius}}),true);rt.update(.25);
  const main=nodes.find(n=>n.spec.assetUrl.includes('icicle')&&Math.abs(n.t?.scaleX-.1755*radius/80)<.001);assert.ok(main);
  assert.equal(main.kind,'billboard');assert.ok(Math.abs(main.t.rotation+Math.PI/2)<1e-9);
  assert.ok(Math.abs(main.t.x-100)<1e-9);assert.ok(Math.abs(main.t.y-(30*.65-220*.1755*radius/80))<1e-9);
  const height=466*Math.abs(main.t.scaleX),width=130*Math.abs(main.t.scaleY);
  if(radius===80){assert.ok(height>80&&height<85);assert.ok(width<30);}
  rt.tryPlay({...event,area:{...event.area,r:radius}});assert.equal(rt.stats().grounds,1);
  rt.update(3);assert.equal(rt.stats().grounds,0);assert.ok(!nodes.some(n=>n.t?.visible));rt.destroy();return height;
 }
 assert.ok(Math.abs(render(80)/render(40)-2)<1e-9);
});
test('冰皇冰錐：Excel／CSV／JS只從本列選擇新Preset，layout包含全部圖層',()=>{
 const t=require('../tools/config_tables.cjs'),root=path.join(__dirname,'..');
 const rows=t.readXlsxRows(path.join(root,'config/Excel/Skills2.xlsx')),csv=t.csvParse(fs.readFileSync(path.join(root,'config/CSV/Skills2.csv'),'utf8'));
 assert.deepEqual(rows,csv);const row=rows.find(r=>r[8]==='iceKingDomain');assert.equal(row[42],preset.id);
 const source=fs.readFileSync(path.join(root,'js/skills2.js'),'utf8');
 assert.deepEqual(t.evalLiteral(t.extractLiteral(t.SCHEMAS.Skills2.rebuild(rows.slice(1),rows[0]).SKILLS2,'SKILLS2').literal),t.evalLiteral(t.extractLiteral(source,'SKILLS2').literal));
 const layout=require('../vfx/layouts/ground-ice-spike.json');assert.deepEqual(layout.groups[0].layerIds,preset.layers.map(l=>l.id));
 assert.ok(preset.layers.filter(l=>l.type!=='empty').every(l=>l.perspective===false));assert.equal(preset.layers.find(l=>l.type==='particle').maxParticles,8);
});
test('冰皇冰錐：根部留在地面，前0.15秒逐步向上刺出且不重播',()=>{
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){n.t=null;}};
 const rt=Core.createRuntime({backend,resolver:{resolve:id=>id}});rt.registerPreset(preset);rt.play(preset.id);
 const samples=[];for(const dt of [.02,.04,.06,.08]){rt.update(dt);const t=nodes.filter(n=>n.spec.assetUrl.includes('icicle')).map(n=>n.t).sort((a,b)=>b.scaleX-a.scaleX)[0];
  assert.ok(t);samples.push({height:466*t.scaleX,tip:t.y-246*t.scaleX,base:t.y+220*t.scaleX,width:130*t.scaleY});}
 assert.ok(samples[0].height<10);assert.ok(samples[1].height>samples[0].height&&samples[2].height>samples[1].height);
 assert.ok(samples[3].height>80);assert.ok(samples.every(s=>Math.abs(s.base)<1e-8));
 assert.ok(samples[3].tip<samples[2].tip&&samples[2].tip<samples[1].tip);assert.ok(samples.every(s=>Math.abs(s.width-samples[0].width)<1e-8));
 rt.update(1.5);assert.equal(rt.stats().activeEffects,0);rt.destroy();
});
