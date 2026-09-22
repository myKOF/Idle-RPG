'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {createEngine}=require('../scripts/sim/engine');
function setup(lv=1){
  const c=createEngine({seed:42}).boot(null).ctx;
  c.G.player.level=1000;c.G.player.loadout=['sg:firepillar'];
  c.G.player.skills2.levels.firepillar=Array(7).fill(10);
  c.G.player.skills2.ult={firepillar:{pick:c.sgUltIndexOfId('firepillar','dragonDevour'),lv}};
  c.initFieldPlayer();c.gmArenaSpawn(3,'elite',1000000);
  const p=c.FIELD.player;p.pos={x:0,y:0};p.mp=1e9;
  c.FIELD.monsters.forEach((m,i)=>{m.pos={x:100+i*100,y:0};m._enterCd=0;});
  const events=[];c.playCombatVfx=s=>events.push({at:c.GT,...s});
  c.sgCastFirepillar(p,c.getStats(),c.SKILLS2.firepillar,Array(7).fill(10),c.FIELD.monsters,c.FIELD.monsters[0],'mv-float',{});
  return {c,p,events,ctx:{pEnt:p,getEnemies:()=>c.FIELD.monsters}};
}
test('吞噬：單一15米場域，8秒、0.35秒節拍，升級只增漩渦傷害',()=>{
  for(const lv of [1,10]){
    const {c,events}=setup(lv),f=c.SKILL2_RT.grounds[0];
    assert.equal(c.SKILL2_RT.grounds.length,1);assert.equal(f.kind,'devour');
    assert.equal(f.radius,150);assert.equal(f.gap,.35);assert.equal(f.expiresAt-c.GT,8);assert.equal(f.hits,22);
    const base=c.sgGroupBaseStat(c.SKILLS2.firepillar,c.getStats());
    assert.equal(f.dmgVal,base*(200+20*lv)/100);assert.equal(f.devour.ballDmg,base*4);
    assert.deepEqual(Object.keys(events[0].vfx),['field']);assert.equal(events[0].area.r,150);assert.equal(events[0].dur,8);
  }
});
test('吞噬：每拍立即聚攏35米內敵人，外圍不動；漩渦22拍後仍存在到8秒',()=>{
  const {c,ctx}=setup(),f=c.SKILL2_RT.grounds[0],start=c.GT;
  c.FIELD.monsters[2].pos.x=351;
  const damage=[];c.sgHitOne=(p,s,m,d)=>{damage.push({t:c.GT,m,d});return {miss:false};};
  c.GT=start+.1;c.sgTickGrounds(.1,ctx);
  assert.equal(c.FIELD.monsters[1].pos.x,200);assert.equal(c.FIELD.monsters[2].pos.x,351);
  assert.equal(damage.length,0);
  // 隔離噴射傷害以精確驗證本體節拍。
  f.devour.nextShotAt=Infinity;c.SKILL2_RT.grounds.splice(1);
  c.FIELD.monsters.splice(1);c.FIELD.monsters[0].pos.x=50;
  for(let i=2;i<=79;i++){c.GT=start+i/10;c.sgTickGrounds(.1,ctx);}
  assert.equal(damage.length,22);assert.ok(c.SKILL2_RT.grounds.includes(f));
  c.GT=start+8;c.sgTickGrounds(.1,ctx);assert.ok(!c.SKILL2_RT.grounds.includes(f));
});
test('吞噬：每秒2～4顆、隨機地面落點、不帶敵人目標；落地才查詢6米傷害',()=>{
  const {c,ctx,events}=setup(),start=c.GT;
  c.FIELD.monsters=[];
  for(let i=0;i<160;i++){c.GT=start+i*.05;c.sgTickGrounds(.05,ctx);}
  const shots=events.filter(e=>e.variant==='dragon-devour-ball');
  for(let s=0;s<8;s++)assert.ok(shots.filter(e=>Math.floor(e.at-start+1e-6)===s).length>=2&&shots.filter(e=>Math.floor(e.at-start+1e-6)===s).length<=4);
  for(const e of shots){assert.equal(e.targets.length,0);assert.ok(Math.hypot(e.area.x,e.area.y)<=200);assert.equal(e.arcM,12);assert.equal(e.travelMs[0],900);assert.equal(e.area.fixedLanding,true);}
  const b=setup(),f=b.c.SKILL2_RT.grounds[0];b.c.sgTickGrounds(0,b.ctx);
  const ball=b.c.SKILL2_RT.grounds.find(x=>x.kind==='devourblast');f.devour.nextShotAt=Infinity;f.nextAt=Infinity;
  b.c.FIELD.monsters[0].pos={...ball.pos};b.c.FIELD.monsters[1].pos={x:ball.pos.x+100,y:ball.pos.y};b.c.FIELD.monsters.splice(2);
  const hits=[];b.c.sgHitOne=(p,s,m,d)=>{hits.push(m);return {miss:false};};
  b.c.GT=ball.nextAt-.001;b.c.sgTickGrounds(.1,b.ctx);assert.equal(hits.length,0);
  b.c.GT=ball.nextAt;b.c.sgTickGrounds(.001,b.ctx);assert.deepEqual(hits,[b.c.FIELD.monsters[0]]);
  assert.equal(b.events.find(e=>e.variant==='dragon-devour-impact').area.r,60);
});
test('吞噬：玩家死亡後不再噴射、傷害，戰鬥重置清空場域',()=>{
 const {c,p,ctx,events}=setup();c.sgTickGrounds(0,ctx);p.hp=0;
 const count=events.length;c.GT+=1;c.sgTickGrounds(1,ctx);assert.equal(events.length,count);
 assert.equal(c.SKILL2_RT.grounds.length,0);c.resetSkill2RT();assert.equal(c.SKILL2_RT.grounds.length,0);
});
test('吞噬：正式施放扣魔、實際傷害與無座標高塔相容',()=>{
 const {c,p,ctx}=setup();c.resetSkill2RT();
 const mp=p.mp;c.castSkill2(p,c.FIELD.monsters,'firepillar','mv-float');
 assert.equal(mp-p.mp,300);assert.equal(c.SKILL2_RT.grounds.filter(f=>f.kind==='devour').length,1);
 const f=c.SKILL2_RT.grounds[0],m=c.FIELD.monsters[0];m.dodge=0;
 f.devour.nextShotAt=Infinity;const hp=m.hp;c.GT=f.nextAt;c.sgTickGrounds(.35,ctx);assert.ok(m.hp<hp);
 delete m.pos;const towerHp=m.hp;c.sgDevourDamage(f,[m],ctx);assert.ok(m.hp<towerHp);
});
test('吞噬：重新施放立即取消舊漩渦；火球20米圓內也能落在漩渦內',()=>{
 const {c,p,ctx,events}=setup();const old=c.SKILL2_RT.grounds[0];c.sgTickGrounds(0,ctx);
 p.pos={x:70,y:30};c.GT+=.4;
 c.sgCastFirepillar(p,c.getStats(),c.SKILLS2.firepillar,Array(7).fill(10),c.FIELD.monsters,c.FIELD.monsters[0],'mv-float',{});
 const fields=c.SKILL2_RT.grounds.filter(f=>f.kind==='devour');assert.equal(fields.length,1);assert.notEqual(fields[0],old);
 assert.equal(fields[0].pos.x,70);assert.equal(fields[0].expiresAt,c.GT+8);
 const start=c.GT;for(let i=0;i<160;i++){c.GT=start+i*.05;c.sgTickGrounds(.05,ctx);}
 const radii=events.filter(e=>e.variant==='dragon-devour-ball').map(e=>Math.hypot(e.area.x-e.area.sourceX,e.area.y-e.area.sourceY));
 assert.ok(radii.every(r=>r<=200));assert.ok(radii.some(r=>r<150));assert.ok(radii.some(r=>r>150));
});

test('吞噬：正式移動與技能排程並行，進入傷害圈後不再強拉至圓心',()=>{
 const {c,p,ctx}=setup();c.FIELD.monsters.splice(1);const m=c.FIELD.monsters[0];m.pos={x:300,y:0};c.sgHitOne=()=>({miss:false});
 const start=c.GT;let insideTicks=0;
 for(let i=1;i<=180;i++){
   c.GT=start+i/60;c.bfTickApproach([m],1/60);
   const before={...m.pos},inArea=c.bfEntityInArea(m,{x:0,y:0,r:150});
   c.tickSkillSchedulers(1/60,ctx);
   if(inArea){assert.deepEqual(m.pos,before,'正常移動後已在圈內，技能排程不再搬動');insideTicks++;}
 }
 assert.ok(c.bfEntityInArea(m,{...c.SKILL2_RT.grounds[0].pos,r:150}));
 assert.ok(insideTicks>0);
});

test('吞噬：首拍將35米內敵人直接拉入傷害圈，玩家反向移動也無法抵消',()=>{
 const {c,p,ctx}=setup();const f=c.SKILL2_RT.grounds[0],m=c.FIELD.monsters[0];
 m.pos={x:350,y:0};c.FIELD.monsters[1].pos.x=351;c.FIELD.monsters[2]._enterCd=1;
 const hits=[];c.sgHitOne=(p,s,m)=>{hits.push(m);return {miss:false};};
 c.GT=f.nextAt;c.sgTickGrounds(.35,ctx);
 assert.equal(m.pos.x,c.bfEntityRadius(m));assert.ok(hits.includes(m));assert.equal(c.FIELD.monsters[1].pos.x,351);assert.equal(c.FIELD.monsters[2].pos.x,300);
 c.bfPlayerPos().x=300;p.pos.x=300;m.pos.x=f.radius+c.bfEntityRadius(m)+1;
 c.bfTickApproach([m],.35);assert.ok(m.pos.x>150);
 c.GT=f.nextAt;c.sgTickGrounds(.35,ctx);assert.equal(m.pos.x,c.bfEntityRadius(m));assert.equal(f.pos.x,0);
});

test('吞噬：圈內、圓周與體型接觸邊界不移動仍受傷；圈外才聚攏',()=>{
 const {c,ctx,events}=setup(),f=c.SKILL2_RT.grounds[0];
 f.pos={x:70,y:30};f.devour.nextShotAt=Infinity;
 const make=(distance,boss=false)=>({hp:100,pos:{x:f.pos.x,y:f.pos.y+distance},isBoss:boss,_enterCd:0});
 const inside=[make(50),make(f.radius),make(f.radius+c.bfBodyRadius()),make(f.radius+c.bfBossRadius(),true)];
 const outside=make(f.radius+c.bfBodyRadius()+1),far=make(351),entering=make(250);entering._enterCd=1;
 const enemies=[...inside,outside,far,entering];c.FIELD.monsters=enemies;
 const before=inside.map(m=>({...m.pos})),hits=[];c.sgHitOne=(p,s,m)=>{hits.push(m);return {miss:false};};
 c.sgDevourDamage(f,enemies,ctx);
 inside.forEach((m,i)=>{assert.deepEqual(m.pos,before[i]);assert.ok(hits.includes(m));});
 assert.equal(outside.pos.y,f.pos.y+c.bfEntityRadius(outside));assert.ok(hits.includes(outside));
 assert.equal(far.pos.y,f.pos.y+351);assert.equal(entering.pos.y,f.pos.y+250);
 c.sgDevourDamage(f,enemies,ctx);inside.forEach((m,i)=>assert.deepEqual(m.pos,before[i]));
 assert.equal(events[0].area.r,f.radius,'停止聚攏門檻沿用對外顯示的傷害半徑');
});
