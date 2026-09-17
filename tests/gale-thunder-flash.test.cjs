const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const file=path.join(__dirname,'skill2-knife-range.test.cjs'),src=fs.readFileSync(file,'utf8');
const scope={require:createRequire(file),__dirname,console};vm.createContext(scope);
vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.h={loadContext,enemy,playerEnt};',scope);
function setup(lv=1,comboHits=0){
 const c=scope.h.loadContext(),p=scope.h.playerEnt(),hits=[],events=[];let home={x:0,y:0},pool=[];
 c.GT=0;c.resetSkill2RT();c.bfPlayerPos=()=>home;c.bfEntityRadius=()=>0;c.chance=()=>false;c.Math.random=()=>.99;
 const ult={def:c.SKILLS2.gale.ult.find(u=>u.id==='thunderFlash'),lv};
 c.sgUlt=(gid,id)=>id==='thunderFlash'?ult:null;c.skills2Ult=()=>ult;c.skills2Levels=()=>[1,0,0,0,0,0,0];
 c.sgGaleOnHit=()=>{};c.enemyEventFloatTarget=e=>e.name;c.playCombatVfx=e=>events.push({at:c.GT,...e});
 c.sgHitOne=(p,st,e,d,g,sel,out,delay,bonus,elem)=>{hits.push({e,d,elem,at:c.GT});out.dmg+=d;return {dmg:d,killed:false};};
 const ctx={getEnemies:()=>pool,onDamage(){},onDeaths(){}};
 return {c,p,ult,hits,events,enemy:(x,y,name)=>scope.h.enemy(1e9,x,y,name),setPool(v){pool=v;},move(x,y){home={x,y};},
 cast(primary,levels=[1,0,0,0,0,0,0]){c.sgCastGale(p,{atk:1000,comboHits},c.SKILLS2.gale,levels,pool,primary,'mv-float',{dmg:0});},
 tick(t){c.GT=t;c.sgTickGaleStrikes(ctx);c.sgTickFlyingProjectiles(.01,ctx);},
 beams(){return events.filter(e=>e.variant==='gale-thunder-flash');},bolts(){return hits.filter(e=>e.elem==='lightning');}};
}
test('霹靂一閃最後一擊起發射 1+3 道，主打擊不繼承附加光束',()=>{
 const h=setup(1,3),e=h.enemy(100,0,'target');h.setPool([e]);h.cast(e);
 assert.equal(h.beams().length,0);h.tick(.69);assert.equal(h.beams().length,0);
 for(const t of [.7,.78,.9,.98,1.1,1.18,1.3,1.38,1.5])h.tick(t);
 assert.deepEqual(h.beams().map(e=>e.at),[.7,.9,1.1,1.3]);
 assert.equal(h.bolts().length,4);assert.ok(h.bolts().every(e=>e.d===2200));
 assert.ok(h.events.filter(e=>e.variant!=='gale-thunder-flash').every(e=>e.vfx.attack!=='beam-gale-thunder-flash'));
 assert.equal(h.c.SKILL2_RT.projectiles.length,0);
});
test('30×10 米矩形從玩家後方6米伸展，命中所有範圍內敵人且不提早、不重複',()=>{
 const h=setup(),target=h.enemy(100,0,'target'),edge=h.enemy(230,49,'edge'),behind=h.enemy(-59,0,'behind');
 const outside=[h.enemy(241,0,'too-far'),h.enemy(100,51,'too-wide'),h.enemy(-61,0,'too-back')];
 h.setPool([target,edge,behind,...outside]);h.cast(target);h.tick(.7);
 const e=h.beams()[0];assert.deepEqual(JSON.parse(JSON.stringify(e.area)),{x:-60,y:0,w:300,h:100,a:0});
 assert.equal(e.travelMs[0],80);assert.equal(e.vfx.attack,'beam-gale-thunder-flash');
 h.tick(.72);assert.deepEqual(h.bolts().map(k=>k.e.name),['behind']);
 h.tick(.75);assert.deepEqual(h.bolts().map(k=>k.e.name),['behind','target']);
 h.tick(.78);h.tick(.85);assert.deepEqual(h.bolts().map(k=>k.e.name),['behind','target','edge']);
});
test('逐道使用最新玩家位置並重新隨機選敵，20米無敵人即永久終止剩餘序列',()=>{
 const h=setup(2,3),a=h.enemy(100,0,'a'),b=h.enemy(0,150,'b');h.setPool([a,b]);h.cast(a);h.tick(.7);h.tick(.78);
 h.move(300,300);const fresh=h.enemy(300,450,'fresh');h.setPool([fresh]);h.tick(.9);
 const beam=h.beams()[1];assert.ok(Math.abs(beam.area.a-Math.PI/2)<1e-9);assert.equal(beam.area.x,300);assert.equal(beam.area.y,240);
 h.tick(.98);assert.equal(h.bolts().at(-1).d,2400);
 h.setPool([h.enemy(501,300,'outside')]);h.tick(1.1);h.setPool([fresh]);h.tick(1.3);
 assert.equal(h.beams().length,2);
});
test('同一候選仍可在後續雷電再次隨機選中，换場清空所有排程',()=>{
 const h=setup(1,3),a=h.enemy(100,0,'a');h.setPool([a]);h.cast(a);h.tick(.7);h.tick(.78);h.tick(.9);h.tick(.98);
 assert.equal(h.bolts().length,2);h.c.resetSkill2RT();h.tick(2);assert.equal(h.beams().length,2);
});

test('角色0連擊只發射1道，疾風破自身追加打擊不增加雷電數量',()=>{
 for(const tier2 of [0,5]){
  const h=setup(),e=h.enemy(100,0,'target');h.setPool([e]);h.cast(e,[1,tier2,0,0,0,0,0]);
  for(let i=0;i<=500;i++)h.tick(i/100);
  assert.equal(h.beams().length,1);assert.equal(h.bolts().length,1);
 }
});
test('角色連擊包含期間加成，小數沿用追加次數機率',()=>{
 const h=setup(1,0.5),e=h.enemy(100,0,'target');
 h.c.skill2ComboBonus=()=>1;h.c.skill2FrenzyComboBonus=()=>1;
 h.c.chance=p=>p>25;h.setPool([e]);h.cast(e);
 for(let i=0;i<=200;i++)h.tick(i/100);
 assert.equal(h.beams().length,4);
});
