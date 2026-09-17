const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const helperFile=path.join(__dirname,'skill2-knife-range.test.cjs');
const helper=fs.readFileSync(helperFile,'utf8');
const scope={require:createRequire(helperFile),__dirname,console};vm.createContext(scope);
vm.runInContext(helper.slice(0,helper.indexOf("test("))+'\nthis.h={loadContext,enemy,playerEnt};',scope);
function setup(lv=1,moon=false){
 const c=scope.h.loadContext(),p=scope.h.playerEnt(),hits=[],events=[];c.GT=0;c.resetSkill2RT();let centre={x:0,y:0};
 // 固定測試數值，避免使用者正在調整的配置改變案例的追加次數。
 c.SKILLS2.gale.tiers[3].fx.count=1;c.SKILLS2.gale.tiers[3].fx.countPer=.1;
 c.bfPlayerPos=()=>centre;c.chance=()=>false;c.Math.random=()=>.9;c.enemyEventFloatTarget=e=>e.name;c.playCombatVfx=e=>events.push(e);
 c.sgHitOne=(p,st,e,d)=>{if(e&&e.hp>0)hits.push({e,d,at:c.GT});return null;};
 const primary=scope.h.enemy(1e9,100,0,'primary');let pool=[primary];
 const lvs=[1,0,0,lv,0,0,moon?1:0];c.G.player.skills2.levels.gale=lvs;
 return {c,p,hits,events,primary,setPool(a){pool=a;},move(x){centre={x,y:0};},enemy(x,name){return scope.h.enemy(1e9,x,0,name);},cast(){c.sgCastGale(p,{atk:1000},c.SKILLS2.gale,lvs,pool,primary,'mv-float',{dmg:0});},tick(t){c.GT=t;c.sgTickGaleStrikes({getEnemies:()=>pool});}};
}

test('主打擊依當前階逐欄繼承，爆散主目標與追加目標使用同一攻擊特效',()=>{
 for(const lv of [0,1])for(const blank of [false,true]){
  const h=setup(lv),tiers=h.c.SKILLS2.gale.tiers;
  h.c.skills2Levels=()=>[1,1,1,lv,0,0,0];
  tiers[0].vfx={attack:'base-configured',hit:'base-hit'};
  tiers[3].vfx={attack:blank?'':'scatter-configured'};
  h.cast();h.tick(.35);h.tick(.7);
  const expected=lv&&!blank?'scatter-configured':'base-configured';
  assert.equal(h.events.length,lv?6:3);
  for(const e of h.events){assert.equal(e.vfx.attack,expected);assert.equal(e.vfx.hit,'base-hit');}
 }
});

test('主打擊保留後續進化與超神覆寫，空欄繼承爆散',()=>{
 for(const moon of [false,true])for(const ult of [false,true])for(const filled of [false,true]){
  const h=setup(1,moon),g=h.c.SKILLS2.gale;
  h.c.skills2Levels=()=>[1,1,1,1,1,1,moon?1:0];
  g.tiers[3].vfx={attack:'scatter-configured'};
  g.tiers[6].vfx={attack:filled?'moon-configured':''};
  if(ult){
   const idx=h.c.sgUltIndexOfId('gale','thunderGodSlash');
   g.ult[idx].vfx={attack:filled?'ult-configured':''};
   h.c.G.player.skills2.ult={gale:{pick:idx,lv:1}};
   h.c.skills2Ult=()=>({def:g.ult[idx],lv:1});
  }
  h.cast();
  assert.equal(h.events[0].vfx.attack,filled?(ult?'ult-configured':moon?'moon-configured':'scatter-configured'):'scatter-configured');
 }
});
test('爆散逐段重新隨機，範圍以玩家為中心；每次追加命中各播一次特效',()=>{
 const h=setup(),a=h.enemy(-80,'a'),b=h.enemy(60,'b'),outside=h.enemy(250,'outside');h.setPool([h.primary,a,b,outside]);
 h.c.Math.random=()=>.9;h.cast();h.c.Math.random=()=>.1;h.tick(.2);
 const extra=h.hits.filter(x=>x.d===1485);assert.deepEqual(extra.map(x=>x.e.name),['a','b']);
 assert.ok(!extra.some(x=>x.e===outside));const vfx=h.events.filter(e=>e.targets.length===1);assert.equal(vfx.length,2);assert.deepEqual(vfx.map(e=>e.targets[0]),['a','b']);
});
test('每級增加目標數與傷害，小數目標數以機率觸發且同段不重複',()=>{
 const h=setup(5),a=h.enemy(-80,'a'),b=h.enemy(60,'b');h.setPool([h.primary,a,b]);
 h.c.chance=()=>false;h.cast();assert.equal(h.hits.filter(x=>x.d===2025).length,1);
 h.tick(.2);h.tick(.4);assert.equal(h.hits.filter(x=>x.d===2025).length,3);
 const fractional=setup(5);fractional.setPool([fractional.primary,fractional.enemy(-80,'a'),fractional.enemy(60,'b')]);fractional.c.chance=()=>true;
 fractional.cast();fractional.tick(.2);const extra=fractional.hits.filter(x=>x.d===2025);assert.equal(extra.length,2);assert.notEqual(extra[0].e,extra[1].e);
 const full=setup(10);full.setPool([full.primary,full.enemy(-80,'a'),full.enemy(60,'b')]);full.cast();full.tick(.2);assert.equal(full.events.filter(e=>e.targets.length===1).length,2);
});
test('無其他目標回打原目標，每下皆有特效；死亡原目標不補打',()=>{
 const h=setup(10);h.cast();h.tick(.2);assert.equal(h.hits.length,3);assert.equal(h.events.filter(e=>e.targets.length===1).length,2);
 h.primary.hp=0;h.tick(.35);assert.equal(h.hits.length,3);assert.equal(h.events.filter(e=>e.targets.length===1).length,2);
});
test('每段使用最新敵群及玩家位置，月牙模式主範圍清空仍可爆散',()=>{
 const h=setup(1,true);h.cast();h.primary.hp=0;const fresh=h.enemy(500,'fresh');h.move(500);h.setPool([fresh]);h.tick(.35);
 assert.ok(h.hits.some(x=>x.e===fresh&&x.d===1485));assert.equal(h.events.filter(e=>e.targets[0]==='fresh').length,1);
});
test('追加攻擊與主打擊共用當前進化特效，後階空白才繼承爆散',()=>{
 for(const moon of [false,true])for(const ult of [false,true])for(const blank of [false,true]){
  const h=setup(10,moon);h.c.SKILLS2.gale.tiers[3].vfx={attack:'scatter-configured',hit:'scatter-hit'};
  h.c.skills2Levels=()=>[1,1,1,1,1,1,moon?1:0];
  h.c.SKILLS2.gale.tiers[6].vfx={attack:blank?'':'moon-configured'};
  if(ult)h.c.skills2Ult=()=>({def:{vfx:{attack:blank?'':'ult-configured'}},lv:1});
  h.cast();h.tick(.2);const extras=h.events.filter(e=>e.targets.length===1);assert.equal(extras.length,2);
  const expected=blank?'scatter-configured':ult?'ult-configured':moon?'moon-configured':'scatter-configured';
  for(const e of h.events){assert.equal(e.vfx.attack,expected);assert.equal(e.vfx.hit,'scatter-hit');}
 }
});

test('爆散逐下 0.2 秒同步選敵、傷害與特效，本體仍是 0.35 秒',()=>{
 const h=setup(5);h.c.chance=()=>true;const times=[];h.c.playCombatVfx=e=>{h.events.push(e);if(e.targets.length===1)times.push(h.c.GT);};
 h.cast();h.tick(.199);assert.equal(times.length,1);
 h.tick(.2);h.tick(.35);h.tick(.399);assert.equal(times.length,2);
 h.tick(.4);h.tick(.6);h.tick(.7);h.tick(.8);h.tick(1);
 assert.deepEqual(times,[0,.2,.4,.6,.8,1]);
 assert.deepEqual(h.hits.filter(x=>x.d===2700).map(x=>x.at),[0,.35,.7]);
 assert.deepEqual(h.hits.filter(x=>x.d===2025).map(x=>x.at),times);
 assert.equal(h.c.SKILL2_RT.galeStrikes.length,0);
});

test('爆散不預選延遲目標，等待中死亡／移動後從最新敵群重新選取',()=>{
 const h=setup(10),a=h.enemy(-80,'a'),b=h.enemy(60,'b');h.setPool([h.primary,a,b]);h.cast();
 assert.equal(h.events.filter(e=>e.targets.length===1).length,1);
 a.hp=0;b.hp=0;h.primary.hp=0;h.move(500);const fresh=h.enemy(500,'fresh');h.setPool([fresh]);
 h.tick(.199);assert.equal(h.events.filter(e=>e.targets[0]==='fresh').length,0);
 h.tick(.2);assert.equal(h.events.filter(e=>e.targets[0]==='fresh').length,1);
 assert.equal(h.hits.filter(x=>x.e===fresh).length,1);
});
