const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
function load(){
 const c=vm.createContext({Math,console});vm.runInContext(fs.readFileSync('js/skills2.js','utf8'),c);
 c.G={player:{skills2:{levels:{thrust:[10,0,0,0,0,0,0]},ult:{}}}};
 c.skills2Castable=()=>true;c.getStats=()=>({});c.skills2CanReach=()=>true;
 c.sgCastThrust=()=>{};c.skills2Cooldown=()=>15;c.sgArmUltRepeat=()=>{};
 return c;
}
test('七階逐階取表定值，超神生效／失效及 UI 快照一致',()=>{
 const c=load();
 for(let tier=1;tier<=7;tier++){
  const levels=Array.from({length:7},(_,i)=>i<tier?10:0);
  c.G.player.skills2.levels.thrust=levels;
  const expected=[25,40,60,80,100,140,240][tier-1];
  assert.equal(c.skills2ManaCost('thrust'),expected);
  assert.equal(c.skills2ManaCost('thrust',levels,{}),expected);
  assert.equal(c.skills2TierManaCost('thrust',tier-1),expected);
  const p={hp:100,mp:1000};c.castSkill2(p,[{hp:100}],'thrust','');assert.equal(1000-p.mp,expected);
 }
 c.G.player.skills2.ult.thrust={pick:0,lv:1};
 assert.equal(c.skills2ManaCost('thrust'),300);
 c.G.player.skills2.levels.thrust[0]=9;
 assert.equal(c.skills2ManaCost('thrust'),240);
 assert.equal(c.skills2ManaCost('thrust',[10,0,0,0,0,0,0],{}),25);
});
test('不足魔力不能起手或建立冷卻，免費追加與 GM 鎖魔不扣魔',()=>{
 const c=load();c.G.player.skills2.levels.thrust=Array(7).fill(10);
 const p={hp:100,mp:239};assert.equal(c.castSkill2(p,[{hp:100}],'thrust',''),null);
 assert.equal(p.mp,239);assert.equal(p.skillCds,undefined);
 for(const opts of [{repeat:true},{storm:true}]){
  const free={hp:100,mp:0};assert.ok(c.castSkill2(free,[{hp:100}],'thrust','',opts));assert.equal(free.mp,0);assert.equal(free.skillCds,undefined);
 }
 c.gmMpLockActive=()=>true;assert.ok(c.castSkill2(p,[{hp:100}],'thrust',''));assert.equal(p.mp,239);
});
test('所有主動群組以階級與超神列取值；被動維持獨立觸發費用',()=>{
 const c=load();
 for(const [gid,g]of Object.entries(c.SKILLS2)){
  if(c.skills2IsPassive(gid)){assert.equal(c.skills2ManaCost(gid,Array(7).fill(10),{}),0);continue;}
  for(let i=0;i<g.tiers.length;i++)assert.equal(c.skills2ManaCost(gid,Array.from({length:7},(_,j)=>j<=i?1:0),{}),g.tiers[i].cost||0);
  for(let i=0;i<g.ult.length;i++)assert.equal(c.skills2ManaCost(gid,Array(7).fill(10),{[gid]:{pick:i,lv:1}}),g.ult[i].cost||0);
 }
 assert.equal(c.skills2TierTriggerMp('counter',0),c.SKILLS2.counter.tiers[0].cost);
 c.SKILLS2.thrust.tiers[6].cost=0;assert.equal(c.skills2ManaCost('thrust',Array(7).fill(10),{}),0);
});
test('自動施放佇列以進化耗魔擋住吟唱，足額才送出施放工作',()=>{
 const c=load(),src=fs.readFileSync('js/skills.js','utf8');
 vm.runInContext(src.slice(src.indexOf('function pickAndCastSkill('),src.indexOf('function tickSkillCds(')),c);
 c.G.player.loadout=['sg:thrust'];c.G.player.skills2.levels.thrust=Array(7).fill(10);
 c.skillCastInProgress=()=>false;c.ensureSkillReadyOrder=()=>{};
 let jobs=0;c.beginSkillCast=()=>{jobs++;return {casting:true};};
 const p={hp:100,mp:239,_skillReadyQueue:['sg:thrust'],_skillReadyQueued:{'sg:thrust':true}};
 assert.equal(c.pickAndCastSkill(p,[{hp:100}],''),null);assert.equal(jobs,0);
 p.mp=240;assert.ok(c.pickAndCastSkill(p,[{hp:100}],''));assert.equal(jobs,1);
 c.G.player.skills2.ult.thrust={pick:0,lv:1};
 assert.equal(c.pickAndCastSkill(p,[{hp:100}],''),null);
 p.mp=300;assert.ok(c.pickAndCastSkill(p,[{hp:100}],''));assert.equal(jobs,2);
});
