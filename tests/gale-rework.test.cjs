const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const helperFile=path.join(__dirname,'skill2-knife-range.test.cjs');
const helper=fs.readFileSync(helperFile,'utf8');
const scope={require:createRequire(helperFile),__dirname,console};vm.createContext(scope);
vm.runInContext(helper.slice(0,helper.indexOf("test("))+'\nthis.h={loadContext,enemy,playerEnt};',scope);
function setup(lv=1,moon=false){
 const c=scope.h.loadContext(),p=scope.h.playerEnt(),hits=[],events=[];c.GT=0;c.resetSkill2RT();let centre={x:0,y:0};
 c.bfPlayerPos=()=>centre;c.chance=()=>false;c.Math.random=()=>.9;c.enemyEventFloatTarget=e=>e.name;c.playCombatVfx=e=>events.push(e);
 c.sgHitOne=(p,st,e,d)=>{if(e&&e.hp>0)hits.push({e,d});return null;};
 const primary=scope.h.enemy(1e9,100,0,'primary');let pool=[primary];
 const lvs=[1,0,0,lv,0,0,moon?1:0];c.G.player.skills2.levels.gale=lvs;
 return {c,p,hits,events,primary,setPool(a){pool=a;},move(x){centre={x,y:0};},enemy(x,name){return scope.h.enemy(1e9,x,0,name);},cast(){c.sgCastGale(p,{atk:1000},c.SKILLS2.gale,lvs,pool,primary,'mv-float',{dmg:0});},tick(t){c.GT=t;c.sgTickGaleStrikes({getEnemies:()=>pool});}};
}
test('爆散逐段重新隨機，範圍以玩家為中心；每次追加命中各播一次特效',()=>{
 const h=setup(),a=h.enemy(-80,'a'),b=h.enemy(60,'b'),outside=h.enemy(250,'outside');h.setPool([h.primary,a,b,outside]);
 h.c.Math.random=()=>.9;h.cast();h.c.Math.random=()=>.1;h.tick(.35);
 const extra=h.hits.filter(x=>x.d===1485);assert.deepEqual(extra.map(x=>x.e.name),['a','b']);
 assert.ok(!extra.some(x=>x.e===outside));const vfx=h.events.filter(e=>e.targets.length===1);assert.equal(vfx.length,2);assert.deepEqual(vfx.map(e=>e.targets[0]),['a','b']);
});
test('每級增加目標數與傷害，小數目標數以機率觸發且同段不重複',()=>{
 const h=setup(5),a=h.enemy(-80,'a'),b=h.enemy(60,'b');h.setPool([h.primary,a,b]);
 h.c.chance=()=>false;h.cast();assert.equal(h.hits.filter(x=>x.d===2025).length,1);
 h.c.chance=()=>true;h.tick(.35);const extra=h.hits.filter(x=>x.d===2025).slice(1);assert.equal(extra.length,2);assert.notEqual(extra[0].e,extra[1].e);
 const full=setup(10);full.setPool([full.primary,full.enemy(-80,'a'),full.enemy(60,'b')]);full.cast();assert.equal(full.events.filter(e=>e.targets.length===1).length,2);
});
test('無其他目標回打原目標，每下皆有特效；死亡原目標不補打',()=>{
 const h=setup(10);h.cast();assert.equal(h.hits.length,3);assert.equal(h.events.filter(e=>e.targets.length===1).length,2);
 h.primary.hp=0;h.tick(.35);assert.equal(h.hits.length,3);assert.equal(h.events.filter(e=>e.targets.length===1).length,2);
});
test('每段使用最新敵群及玩家位置，月牙模式主範圍清空仍可爆散',()=>{
 const h=setup(1,true);h.cast();h.primary.hp=0;const fresh=h.enemy(500,'fresh');h.move(500);h.setPool([fresh]);h.tick(.35);
 assert.ok(h.hits.some(x=>x.e===fresh&&x.d===1485));assert.equal(h.events.filter(e=>e.targets[0]==='fresh').length,1);
});
test('爆散特效逐欄讀第四階配置，不被本體、月牙或超神覆寫',()=>{
 for(const moon of [false,true])for(const ult of [false,true]){
  const h=setup(10,moon);h.c.SKILLS2.gale.tiers[3].vfx={attack:'scatter-configured',hit:'scatter-hit'};
  if(ult)h.c.G.player.skills2.ult={gale:{pick:h.c.sgUltIndexOfId('gale','thunderGodSlash'),lv:1}};
  h.cast();const extras=h.events.filter(e=>e.targets.length===1);assert.equal(extras.length,2);
  for(const e of extras){assert.equal(e.vfx.attack,'scatter-configured');assert.equal(e.vfx.hit,'scatter-hit');}
 }
});
