'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const Core=require('../js/vfx-core.js'), Runtime=require('../js/vfx-runtime.js');
test('CLEAVE 三色系使用核准的硬邊氣旋素材，保留原本旋轉構圖',()=>{
 const ids=['slash-cleave-ring-warm','slash-cleave-ring-blue','proj-cleave-ring-tricolor'];
 const asset='codex-authored/cleave/sharp-cyclone.png';
 for(const id of ids){
  const preset=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets',id+'.json'),'utf8'));
  assert.equal(preset.layers.length,12);
  assert(preset.layers.filter(l=>!l.id.startsWith('blade-glow-')).every(l=>l.assetId===asset));
  assert(preset.layers.every(l=>l.rotationOverLife[1][1]===Math.PI*2));
 }
 const shipped=JSON.parse(fs.readFileSync(path.join(root,'vfx/shipped-assets.json'),'utf8'));
 assert(shipped.assets.some(a=>a.assetId===asset),'核准素材必須匯出供正式遊戲使用');
});
function setup(levels=[1,0,0,0,0,0,0],legend={}) {
 const c={console,Math:Object.create(Math),setTimeout(){},clearTimeout(){},document:{addEventListener(){},getElementById(){return null;},querySelectorAll(){return[];}},UI:{dirty:{}},floatText(){},blog(){}};
 c.window=c;vm.createContext(c);
 for(const file of ['util','data','status','formula','battlefield','combat','skills','skills2'])vm.runInContext(fs.readFileSync(path.join(root,'js',file+'.js'),'utf8'),c);
 c.G={player:{skills2:{levels:{cleave:levels}},loadout:[]},stage:{current:1}};
 c.GT=0;c.resetSkill2RT();c.sgLegend=()=>legend;c.sgUlt=()=>null;c.chance=()=>false;
 const hits=[],events=[];c.playCombatVfx=e=>events.push(JSON.parse(JSON.stringify(e)));
 c.sgHitOne=(p,st,e,dmg,gid,sel,out,delay,bonus)=>{hits.push({e,at:c.GT,dmg,bonus});out.dmg+=dmg;return{dmg,miss:false};};
 const enemies=[{name:'front',hp:1e9,pos:{x:70,y:0}},{name:'back',hp:1e9,pos:{x:-70,y:0}},{name:'side',hp:1e9,pos:{x:0,y:70}},{name:'out',hp:1e9,pos:{x:500,y:0}}];
 const p={hp:1000,mp:1000,buffs:{},effects:{},skillCds:{}};
 return {c,hits,events,enemies,cast(){c.sgCastCleave(p,{atk:1000},c.SKILLS2.cleave,levels,enemies,enemies[0],'pv-float',{dmg:0});},tick(t){c.GT=t;c.sgTickFlyingProjectiles(.01,{getEnemies:()=>enemies});}};
}
test('CLEAVE 逐風者地板只在命中位置播放，起手與追加刀波不帶超神場域',()=>{
 for(const levels of [[1,0,0,1,0,0,0],[1,1,1,1,1,1,1]]) {
  const h=setup(levels),c=h.c;
  const ult={def:c.SKILLS2.cleave.ult.find(u=>u.id==='windChaser'),lv:1};
  ult.def.vfx={ground:'slash-cleave-ring-warm-09-hit'};
  c.skills2Ult=()=>ult;c.sgUlt=(gid,id)=>id==='windChaser'?ult:null;
  c.bfPlayerPos=()=>({x:0,y:0});
  h.cast();
  assert.equal(h.events.length,1);
  assert.equal(h.events[0].vfx.ground,undefined,'尚未命中時不可在玩家中心播放超神地板');
  for(let i=0;i<=200;i++) {
   h.tick(i/100);
   c.sgTickGrounds(.01,{getEnemies:()=>h.enemies});
  }
  const waves=h.events.filter(e=>e.variant==='cleave-ring');
  const fields=h.events.filter(e=>e.variant==='wind-tornado');
  assert(waves.length>1,'涵蓋追加刀波');assert(fields.length>0,'命中仍生成逐風者');
  assert(waves.every(e=>!e.vfx.ground&&!e.vfx.field));
  assert(waves.every(e=>levels[5]>0?e.vfx.projectile==='proj-cleave-ring-tricolor':e.vfx.attack==='slash-cleave-ring-warm'));
  for(const e of fields) {
   assert.deepEqual(e.vfx,{ground:'slash-cleave-ring-warm-09-hit'});
   assert.equal(e.area.r,40);
   assert(h.enemies.some(enemy=>enemy.pos.x===e.area.x&&enemy.pos.y===e.area.y),'場域位於命中敵人處');
  }
 }
});
test('CLEAVE 配置名稱、冷卻、強化及固定追加次數',()=>{
 const {c}=setup();const g=c.SKILLS2.cleave;
 assert.equal(g.cd,20);assert.equal(g.tiers[1].name,'擴增');assert.equal(g.tiers[2].name,'強化');
 assert.equal(c.sgVal(g.tiers[2].fx,'pct',1),28);assert.equal(c.sgVal(g.tiers[2].fx,'pct',10),100);
 assert.equal(c.sgVal(g.tiers[3].fx,'times',1),1.1);assert.equal(c.sgVal(g.tiers[3].fx,'times',6),1.6);
 assert.equal(c.skills2CastRangePx('cleave',[1,0,0,0,0,0,0]),80);
 assert.equal(c.skills2CastRangePx('cleave',[1,1,0,0,0,0,0]),93.2);
});
test('CLEAVE 第六階實際引用的藍色刀光已套用尺寸修正',()=>{
 const h=setup([1,1,1,1,1,1,0]);h.cast();
 const id=h.events[0].vfx.projectile;
 const preset=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets',id+'.json'),'utf8'));
 assert.equal(preset.layers.length,12);
 assert(preset.layers.every(l=>l.rotationOverLife[1][1]===Math.PI*2));
 assert(preset.sizing.authored.radius>140,'使用放大造型的尺寸基準，避免再被距離倍率放大');
 assert(preset.layers.filter(l=>l.id.startsWith('blade-glow-')).every(l=>l.alpha<=.08));
});
test('CLEAVE 圓形刀波向四周擴張、到達才命中且每道只打一次',()=>{
 const h=setup();h.cast();assert.equal(h.hits.length,0);h.tick(.1);assert.equal(h.hits.length,0);
 for(let i=11;i<=80;i++)h.tick(i/100);
 assert.deepEqual(h.hits.map(x=>x.e.name).sort(),['back','front','side']);
 assert(h.hits.every(x=>x.dmg===2200));assert.equal(h.c.SKILL2_RT.projectiles.length,0);
 assert.equal(h.events[0].vfx.attack,'slash-cleave-ring-warm');assert.equal(h.events[0].area.r,80);
});
test('CLEAVE 連斬與七階相加、每波延遲及範圍一致，無四方重複',()=>{
 const h=setup([1,1,1,1,1,1,1]);h.cast();
 assert.equal(h.c.SKILL2_RT.projectiles.length,5);
 assert.deepEqual(Array.from(h.c.SKILL2_RT.projectiles,p=>Math.round(p.beginAt*1000)),[0,300,600,900,1200]);
 assert.equal(h.events.length,1,'後續刀波要到起飛時才送出事件');
 h.tick(.19);assert.equal(h.hits.length,3);
 for(let i=20;i<=200;i++)h.tick(i/100);
 assert.equal(h.events.length,5);
 assert(h.events.every(e=>!e.delayMs&&e.vfx.projectile==='proj-cleave-ring-tricolor'&&!e.vfx.attack&&Math.abs(e.area.r-145.625)<1e-6));
 assert.equal(h.hits.length,15);assert(h.hits.every(x=>Math.abs(x.dmg-3844)<1e-6));
 assert.equal(h.c.SKILL2_RT.projectiles.length,0);
});
test('CLEAVE 小數次數只決定額外一刀，不再有前置觸發機率',()=>{
 for(const [trigger,count] of [[false,2],[true,3]]) {
  const h=setup([1,0,0,6,0,0,0]);h.c.chance=()=>trigger;h.cast();assert.equal(h.c.SKILL2_RT.projectiles.length,count);
 }
});

test('CLEAVE 超神七連斬各取斬出當下位置，已發射刀波不追隨玩家',()=>{
 const h=setup([1,1,1,1,1,1,1]);let player={x:0,y:0};h.c.bfPlayerPos=()=>player;
 h.c.sgUlt=(gid,id)=>id==='voidShatter'?{def:h.c.SKILLS2.cleave.ult[0],lv:5}:null;
 h.cast();const waves=Array.from(h.c.SKILL2_RT.projectiles);assert.equal(waves.length,7);
 for(let wave=0;wave<7;wave++){
  player={x:wave*300,y:wave*20};h.tick(wave*.3+1e-8);
  assert.equal(h.events.length,wave+1);
  assert.equal(h.events[wave].area.x,player.x);assert.equal(h.events[wave].area.y,player.y);
  assert.equal(waves[wave].origin.x,player.x);assert.equal(waves[wave].origin.y,player.y);
  assert.equal(waves[0].origin.x,0,'第一刀仍從原位擴散');
 }
 const event=h.events[6],frames=[];
 const backend={createNode:()=>({}),updateNode:(node,t)=>frames.push({...t}),destroyNode(){}};
 const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:x=>x},fxBackend:backend,zoneBackend:backend,
  ctx:{playerPos:()=>player,posOf:()=>player}});
 rt.registerPresets([JSON.parse(fs.readFileSync(path.join(root,'vfx/presets/proj-cleave-ring-tricolor.json'),'utf8'))]);
 rt.tryPlay(event);player={x:9999,y:9999};rt.update(.1);
 assert(frames.length>0);assert(frames.every(p=>p.x===1800&&p.y===120),'發射後的畫面不跟隨玩家');
 h.tick(4);assert.equal(h.c.SKILL2_RT.projectiles.length,0);
});

test('CLEAVE 移動後追加斬擊只命中新位置附近的敵人',()=>{
 const h=setup([1,0,0,1,0,0,0]);let player={x:0,y:0};h.c.bfPlayerPos=()=>player;
 h.cast();h.tick(.2);player={x:400,y:0};h.tick(.3);
 const newcomer={name:'new-centre',hp:1e9,pos:{x:470,y:0}};h.enemies.push(newcomer);
 for(let i=31;i<=80;i++)h.tick(i/100);
 assert.equal(h.hits.filter(hit=>hit.e.name==='front').length,1,'舊位置只被第一刀命中');
 assert.equal(h.hits.filter(hit=>hit.e===newcomer).length,1,'第二刀命中移動後新位置');
 assert.equal(h.events[1].area.x,400);
});
test('CLEAVE 刀波掃過後中央不保留傷害場域',()=>{
 const h=setup([1,0,0,0,0,1,0]);h.cast();h.tick(.25);
 const inside={name:'late-inside',hp:1e9,pos:{x:0,y:0}};
 const ahead={name:'ahead',hp:1e9,pos:{x:115,y:0}};
 h.enemies.push(inside,ahead);
 for(let i=26;i<=70;i++)h.tick(i/100);
 assert(!h.hits.some(x=>x.e===inside),'波後內圈沒有持續傷害');
 assert.equal(h.hits.filter(x=>x.e===ahead).length,1,'外側敵人被前緣掃過時命中一次');
});
test('CLEAVE 傳奇飛行距離／連斬／旋風／暈眩／命中掛鉤保留',()=>{
 const h=setup([1,0,0,0,1,0,0],{cleaveFlyM:60,cleaveSlashAdd:2,cleaveWhirl:{powerPct:100,m:8},cleaveStunnedDmgPct:50});
 const whirl=[],stun=[],hooks=[];h.c.sgCleaveWhirlwind=()=>whirl.push(h.c.GT);h.c.sgTryStun=e=>stun.push(e);
 h.c.sgCleaveOnHit=(cfg,e)=>hooks.push(e);h.c.sgIsStunned=()=>true;h.c.chance=()=>true;h.cast();
 assert.equal(h.events[0].area.r,600);assert.equal(h.events[0].travelMs[0],2500);
 assert.equal(h.events[0].vfx.projectile,'slash-cleave-ring-warm');assert.equal(h.events.length,1);
 for(let i=0;i<=320;i++)h.tick(i/100);
 assert.equal(h.events.length,3);
 assert.equal(whirl.length,3);assert.equal(h.hits.length,12);assert.equal(stun.length,12);assert.equal(hooks.length,12);assert(h.hits.every(x=>x.bonus===50));
});
test('CLEAVE 無座標高塔仍逐道結算且完成後回收',()=>{
 const h=setup([1,0,0,1,0,0,0]);h.enemies.forEach(e=>delete e.pos);h.cast();
 h.tick(0);assert.equal(h.hits.length,4);h.tick(.29);assert.equal(h.hits.length,4);h.tick(.3);assert.equal(h.hits.length,8);
 h.tick(1);assert.equal(h.c.SKILL2_RT.projectiles.length,0);
});
test('CLEAVE 正式 Preset 曲線同源，Runtime 採事件半徑、圓心、時長且平滑縮放',()=>{
 const h=setup();
 for(const id of ['slash-cleave-ring-warm','slash-cleave-ring-blue','proj-cleave-ring-blue','proj-cleave-ring-tricolor']) {
  const preset=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets',id+'.json'),'utf8'));
  assert.deepEqual(preset.layers[0].scaleOverLife,JSON.parse(JSON.stringify(h.c.SKILLS2.cleave.tiers[0].fx.radiusCurve)));
  let nodes=0;
  const frames=[];const backend={createNode:spec=>({spec,first:nodes++===0}),updateNode:(node,t)=>{if(node.first)frames.push({...t});},destroyNode(){}};
  const adapter=Runtime.create({core:Core,resolver:{has:()=>true,resolve:x=>x},fxBackend:backend,zoneBackend:backend,ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0})}});
  adapter.registerPresets([preset]);
  const role=id.startsWith('proj-')?'projectile':'attack';
  adapter.tryPlay({fxKind:role==='attack'?'slash':'projectile',variant:'cleave-ring',projectile:true,hit:false,area:{x:30,y:40,r:160},travelMs:[1000],vfx:{[role]:id}});
  for(let i=0;i<30;i++)adapter.update(1/60);
  assert(frames.length>0);const last=frames.at(-1);
  assert.equal(last.x,30);assert.equal(last.y,40);
  const size=160/preset.sizing.authored.radius;
  const expected=preset.layers[0].scale.x*size*h.c.sgCleaveRadiusAt(h.c.SKILLS2.cleave.tiers[0].fx.radiusCurve,.5);
  assert(Math.abs(last.scaleX-expected)<1e-5,[last.scaleX,expected]);
  if (role==='projectile') {
   assert.equal(preset.layers.length,12,'保留三組旋轉刀光，不得改成分段小刀弧');
   assert(preset.layers.every(l=>l.rotationOverLife[1][1]===Math.PI*2),'保留快速旋轉整圈');
   assert(preset.layers.every(l=>!l.offsetXOverLife&&!l.offsetYOverLife),'刀光保持原本旋轉構圖');
   const extent=Math.max(...preset.layers.map(l=>Math.max(l.scale.x,l.scale.y)))*512*.38;
   assert(Math.abs(extent*size-160)<1e-6,'修正實際作者尺寸，不能重複放大造型');
  }
  assert.equal(adapter.stats().projectiles,0);adapter.update(1);assert.equal(adapter.stats().fx.activeEffects,0);
 }
});
