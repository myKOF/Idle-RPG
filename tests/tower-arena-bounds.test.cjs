'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function setup(){
 const c={console,Math,UI:{dirty:{}},blog(){},floatText(){},trackDps(){},recordRunDamage(){},setTimeout(){},clearTimeout(){},
  document:{addEventListener(){},getElementById(){return null;},querySelectorAll(){return[];}}};
 c.window=c;vm.createContext(c);
 for(const f of ['util','strings_data','strings','data','status','formula','battlefield','combat','skills','skills2','tower'])vm.runInContext(read('js/'+f+'.js'),c);
 const stats={hp:1e9,mp:0,atk:100,matk:0,aspd:2,level:1000,hpRegen:0,mpRegen:0,passives:{},skillTriggers:{},cdr:0,critRate:0,critDmg:150,hit:100,enrageThreshold:0};
 c.getStats=()=>stats;c.G={player:{gold:1e30,loadout:[],skills2:{levels:{}}},stage:{current:1,best:1,kills:0,zone:'desert'},tower:{active:false,highest:150}};
 c.FIELD={player:c.newPlayerEntity(stats),monsters:[],spawnCd:0,reviveCd:0,dpsWindow:[]};c.GT=0;
 c.pickAndCastSkill=()=>null;c.tickLegendaryEffects=()=>null;c.tickSkillSchedulers=()=>{};c.chance=()=>false;
 c.doPlayerAttack=()=>({dmg:0,killed:false});c.doMonsterAttack=()=>({dmg:0});
 const elite=read('js/elite.js');vm.runInContext(elite.slice(elite.indexOf('function eliteRepoPick('),elite.indexOf('function eliteRepoTick(')),c);
 c.elitePos=c.bfPlayerPos;
 c.eliteMonsterPos=c.bfPos;
 return c;
}
function inside(c){
 const a=c.TOWER.arena;
 for(const [p,r] of [[c.TOWER.playerPos,c.bfPlayerBodyRadius()],[c.TOWER.boss.pos,c.bfEntityRadius(c.TOWER.boss)]]){
  assert.ok(Math.abs(p.x-a.cx)<=a.halfWidth-r+1e-7,'x leaves arena');
  assert.ok(Math.abs(p.y-a.cy)<=a.halfHeight-r+1e-7,'y leaves arena');
 }
}
test('50 independent bosses and all three tower tiers keep pursuit and moving repo targets within one fixed arena',()=>{
 const c=setup();
 for(const floor of [...Array.from({length:50},(_,i)=>i+1),53,64,101,150]){
  c.startTowerFight(floor);const a=JSON.stringify(c.TOWER.arena),b=c.TOWER.boss;b._el={};b._bodyR=52+floor;
  for(let step=0;step<400;step++){
   c.GT+=.05;
   if(step%20===0)c.eliteRepoPick(b,step%40===0?'away':null,1800);
   c.bfTickPlayer([b],.05,b,c.TOWER.player);c.bfTickApproach([b],.05);inside(c);
   assert.equal(JSON.stringify(c.TOWER.arena),a,'center may not follow the chase');
  }
  c.finishTowerFight();assert.equal(c.TOWER.arena,null);
 }
});
test('projected repo endpoint completes at a corner rather than running forever into the boundary',()=>{
 const c=setup();c.startTowerFight(1);const a=c.TOWER.arena,b=c.TOWER.boss;
 c.TOWER.playerPos.x=a.cx+a.halfWidth-18;c.TOWER.playerPos.y=a.cy+a.halfHeight-18;
 b.pos.x=a.cx+a.halfWidth-c.bfEntityRadius(b);b.pos.y=a.cy+a.halfHeight-c.bfEntityRadius(b);
 b._rp={ang:Math.PI/4,dist:10000,t0:0};c.bfTickApproach([b],.1);
 assert.equal(b._rp,null);assert.equal(b._rpDone,true);inside(c);
});
test('knockback and any forced motion are constrained with body clearance, including early tick returns',()=>{
 const c=setup();c.startTowerFight(4);const b=c.TOWER.boss;
 b._bfKnockback={x:b.pos.x,y:b.pos.y,toX:1e6,toY:-1e6,startAt:0,endAt:1};c.GT=1;
 c.bfTickApproach([b],.1);inside(c);
 c.towerTickInsideArena=()=>{b.pos.x=-1e8;b.pos.y=1e8;c.TOWER.playerPos.x=1e8;return 'early';};
 assert.equal(c.towerTick(.1),'early');inside(c);
 c.G.tower.active=false;const p={x:1e9,y:-1e9};assert.equal(c.bfClampTowerPoint(p,100),false);assert.equal(p.x,1e9);
});
test('arena geometry uses double the reference view on every axis and late renderer entry uses the authoritative center',()=>{
 const c=setup();c.startTowerFight(1);const arena=c.TOWER.arena;
 assert.equal(arena.halfWidth*2,arena.viewWidth*2);
 assert.equal(arena.halfHeight*2*.5,arena.viewHeight*2);
 const source=read('js/battle-renderer.js'),begin=source.indexOf('  function enterArena('),end=source.indexOf('  function exitArena(',begin);
 let entry;const context={S:{arena:{enter:o=>{entry=o;},floorTexture:()=>null},W:320,H:480},BossArena:{tierOf:()=>'',elementOf:()=>'',paletteFor:()=>({name:''})},STR:()=>''};
 vm.runInNewContext(source.slice(begin,end),context);
 context.enterArena({playerPos:{x:100000,y:-10000},monsters:[{pos:{x:200000,y:0},name:'boss'}]},{tower:{floor:1,arena}});
 assert.equal(entry.cx,arena.cx);assert.equal(entry.cy,arena.cy);assert.equal(entry.arena,arena);
});
