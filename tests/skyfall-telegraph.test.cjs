'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const vm=require('node:vm'),{extractFunction}=require('./helpers/battle-scene.cjs');
const {createEngine}=require('../scripts/sim/engine');
const Core=require('../js/vfx-core'),Runtime=require('../js/vfx-runtime');
const preset=id=>JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets',id+'.json'),'utf8'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function launch(kind){
 const c=createEngine({seed:42}).boot(null).ctx;c.G.player.level=2000;c.G.player.loadout=['sg:stormbarrier'];
 c.G.player.skills2.levels.stormbarrier=Array(7).fill(10);c.G.player.skills2.ult={stormbarrier:{pick:c.sgUltIndexOfId('stormbarrier','skyfallStars'),lv:1}};
 c.initFieldPlayer();c.gmArenaSpawn(1,'elite',1e9);const p=c.FIELD.player,m=c.FIELD.monsters[0];p.mp=1e9;m.pos={x:100,y:0};m._enterCd=0;
 const events=[];c.playCombatVfx=e=>events.push(JSON.parse(JSON.stringify(e)));
 const values=[.999,0,0,['blade','thunder','fire'].indexOf(kind)/3+.01];c.Math.random=()=>values.shift()??0;
 const ctx={pEnt:p,getEnemies:()=>[m],floatSel:'mv-float'};c.GT=1;c.sgTickSkyfallStars(ctx,.05);c.GT=c.SKILL2_RT.skyfallAt;c.sgTickSkyfallStars(ctx,.05);
 return {c,p,m,ctx,events,rain:events.find(e=>e.fxKind==='rain')};
}
function visual(events,skyScale=1){
 const nodes=[],backend={createNode(spec){const n={spec};nodes.push(n);return n;},updateNode(n,t){n.pose={...t};},destroyNode(n){n.dead=true;}};
 const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},fxBackend:backend,zoneBackend:backend,airBackend:backend,
  groundScale:.65,profile:{scale:.4,skyScale,areaScale:.2},ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:100,y:0})}});
 rt.registerPresets([...new Set(events.flatMap(e=>Object.values(e.vfx)))].map(preset));return {rt,nodes};
}
for(const kind of ['fire','thunder','blade'])test(`天穹三色 ${kind}：落點圈與物件本體同尺寸，落地回收，傷害範圍保留`,()=>{
 const {c,m,ctx,rain}=launch(kind);assert.ok(rain);assert.equal(rain.area.skyfallMark,true);
 assert.equal(rain.vfx.ground,{fire:'mark-red',thunder:'mark-blue',blade:'mark-green'}[kind]);near(rain.area.r,80);
 const at=c.SKILL2_RT.meteors[0].at,hp=m.hp;c.GT=at-.001;c.sgTickMeteors(ctx);assert.equal(m.hp,hp);
 for(const skyScale of [.4,1,1.3]){
  const original=JSON.stringify(rain),{rt,nodes}=visual([rain],skyScale);assert.equal(rt.tryPlay(rain),true);rt.update(0);
  const tint=parseInt({fire:'ff5900',thunder:'60a5fa',blade:'4ade80'}[kind],16);
  const ring=nodes.find(n=>n.spec.assetUrl.includes('circle_02')&&n.pose.tint===tint),body=nodes.find(n=>!n.spec.assetUrl.includes('circle_02')&&!n.spec.assetUrl.includes('circle_b.png'));
  assert.ok(ring&&body);const diameter={fire:140,thunder:120,blade:160}[kind]*skyScale;
  near(ring.pose.scaleX/.3906/.975*200,diameter);near(ring.pose.x,rain.area.x);near(ring.pose.y,rain.area.y);
  assert.equal(ring.pose.tint,tint);
  assert.equal(JSON.stringify(rain),original);rt.update(rain.travelMs[0]/1000-.001);assert.ok(rt.stats().grounds===1);rt.update(.002);assert.equal(rt.stats().grounds,0);rt.destroy();
 }
 c.GT=at;c.sgTickMeteors(ctx);assert.ok(m.hp<hp);
});
test('天穹落點圈：同落點多顆各自存活，延遲出生及回收獨立，不合併續命',()=>{
 const {rain}=launch('blade');const second={...rain,delayMs:100,travelMs:[rain.travelMs[0]+200]};const {rt}=visual([rain,second]);
 rt.tryPlay(rain);rt.tryPlay(second);rt.update(.001);assert.equal(rt.stats().grounds,1);rt.update(.1);assert.equal(rt.stats().grounds,2);
 rt.update(rain.travelMs[0]/1000-.1);assert.equal(rt.stats().grounds,1);rt.update(.31);assert.equal(rt.stats().grounds,0);rt.destroy();
});
test('天穹綠圈：正式Preset與單根群組layout合法，素材已在正式匯出',()=>{
 const p=preset('mark-green');assert.equal(Core.validatePreset(p).ok,true);const ids=new Set(require('../vfx/shipped-assets.json').assets.map(a=>a.assetId));
 p.layers.forEach(l=>assert.ok(ids.has(l.assetId)));const LS=require('../tools/vfx/editor/layout-schema');
 const layout=require('../vfx/layouts/mark-green.json');assert.equal(LS.validateLayout(layout).ok,true);assert.equal(LS.reconcile(p.layers,layout).rows.length,1);
});
test('天穹落點圈：正式預載包含程式選用的綠圈與藍圈',()=>{
 const {c}=launch('fire');const source=fs.readFileSync(path.join(__dirname,'../js/vfx-runtime.js'),'utf8');
 const ids=vm.runInContext(extractFunction(source,'collectPresetIds')+';collectPresetIds()',c);
 assert.ok(ids.includes('mark-green'));assert.ok(ids.includes('mark-blue'));
});
