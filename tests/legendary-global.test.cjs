const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function load() {
  const c = { console, Math: Object.create(Math), UI: { dirty: {} }, setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  c.window = c; vm.createContext(c);
  for (const f of ['util','strings_data','strings','data','status','formula','battlefield','item','player','combat','skills','skills2','legendary','save'])
    vm.runInContext(fs.readFileSync(path.join(root,'js',f+'.js'),'utf8'),c,{filename:f+'.js'});
  c.G=c.newGameState(); c.GT=0; c.blog=()=>{}; c.floatText=()=>{};
  return c;
}
function item(id,key,slot='ring') { return {id,name:id,kind:'equip',slot,rarity:5,level:100,upgrade:0,affixes:[],sockets:[],enchants:[],passive:{key}}; }
function player() { return {hp:1000,mp:0,shield:0,effects:{},buffs:{},dots:[],skillCds:{}}; }
function stats(keys) { return {hp:1000,mp:1000,legendaryEffects:Object.fromEntries(keys.map(k=>[k,true])),passives:{},elemDmgUp:{}}; }

test('all 144 passives roll on every slot and use fixed base across all qualities and weapon types',()=>{
 const c=load();
 assert.equal(Object.keys(c.PASSIVE_POOL).length,144);
 for(const slot of c.SLOT_LIST) for(const key in c.PASSIVE_POOL) {
  assert.ok(c.passiveKeysForItem({slot}).includes(key),slot+':'+key);
  for(const rarity of [0,5,10]) assert.equal(c.passiveValue({rarity,level:2000,upgrade:40,weaponType:'axe2h'},{key,val:99999}),c.PASSIVE_POOL[key].base);
 }
 c.PASSIVE_POOL.sunder.perR=999; assert.equal(c.passiveValueFor('sunder',10),10);
 c.PASSIVE_POOL.sunder.base=17; assert.equal(c.passiveValueFor('sunder',5),17);
});
test('first equipped wins across slot moves, removal/re-equip, JSON reload and separate sets',()=>{
 const c=load(),a=item('first','sunder'),b=item('second','sunder');
 c.equipItem(a,'ring2'); c.equipItem(b,'ring');
 assert.equal(c.equippedPassiveOwners(c.G.equipment).sunder,'ring2');
 assert.equal(c.computeStats().passives.sunder,10);
 assert.equal(c.equippedPassiveRepeated(b,c.G.equipment),true);
 const order=a.legendaryEquipOrder;
 c.G.equipment.ring=null; c.equipItem(a,'ring'); assert.equal(a.legendaryEquipOrder,order);
 c.equipItem(b,'ring2'); assert.equal(c.equippedPassiveOwners(c.G.equipment).sunder,'ring');
 c.G.equipment.ring=null; assert.equal(c.equippedPassiveOwners(c.G.equipment).sunder,'ring2');
 c.equipItem(a,'ring'); assert.equal(c.equippedPassiveOwners(c.G.equipment).sunder,'ring2');
 const eq=JSON.parse(JSON.stringify(c.G.equipment)); assert.equal(c.equippedPassiveOwners(eq).sunder,'ring2');
 const saved=c.migrateSave(JSON.parse(JSON.stringify(c.G)));assert.equal(c.equippedPassiveOwners(saved.equipment).sunder,'ring2');
 assert.equal(c.computeStats(eq).passives.sunder,10);
 const other={ring:item('third','sunder')}; c.equipItem(item('fourth','sunder'),'ring2',other);
 assert.equal(c.equippedPassiveOwners(other).sunder,'ring');
 assert.equal(c.equippedPassiveOwners(c.G.equipment).sunder,'ring2');
 c.G.equipmentSets[1]=other;c.equipmentSetUnlocked=()=>true;c.switchToEquipSet(1);
 assert.equal(c.equippedPassiveOwners(c.G.equipment).sunder,'ring');assert.equal(c.getStats().passives.sunder,10);
});
test('inactive off-hand two-handed equipment cannot suppress an active legendary effect',()=>{
 const c=load(),a=item('main','mountainSunderer','weapon'),b=item('off','mountainSunderer','weapon');
 a.weaponType=b.weaponType='axe2h';a.legendaryEquipOrder=2;b.legendaryEquipOrder=1;const eq={weapon:a,weapon2:b};
 assert.equal(c.equippedPassiveOwners(eq,false).mountainSunderer,'weapon');
 assert.equal(c.equippedPassiveOwners(eq,true).mountainSunderer,'weapon2');
 assert.equal(c.equippedPassiveRepeated(a,eq,false),false);assert.equal(c.equippedPassiveRepeated(a,eq,true),true);
});
test('legacy items win before new items; stats and tooltip never mutate equipment',()=>{
 const c=load(),eq=c.G.equipment,a=item('old','sunder'),b=item('new','sunder');eq.ring2=a;
 const before=JSON.stringify(eq); c.computeStats(); c.equippedPassiveOwners(eq); assert.equal(JSON.stringify(eq),before);
 c.equipItem(b,'ring'); assert.equal(c.equippedPassiveOwners(eq).sunder,'ring2');
 const html=c.itemDetailHTML(b,null,{equipment:eq}); assert.match(html,/it-passive-repeated/); assert.match(html,/#9ca3af/);assert.match(html,/\(重覆\)/);
 assert.doesNotMatch(c.itemDetailHTML(a,null,{equipment:eq}),/it-passive-repeated/);
});
test('experience and gold passives add once through the stats aggregate',()=>{
 const c=load(),before=c.computeStats();
 c.equipItem(item('xp1','experienceTome'),'ring');c.equipItem(item('xp2','experienceTome'),'ring2');
 c.equipItem(item('gold','goldenTouch','amulet'),'amulet');
 const st=c.computeStats();assert.equal(st.xpBonus-before.xpBonus,20);assert.equal(st.goldBonus-before.goldBonus,30);
});
test('bleeding and distinct abnormal states multiply direct and periodic damage with a five-state cap',()=>{
 const c=load(),p=player(),e={hp:10000,maxHp:10000,effects:{},buffs:{},dots:[]};c.getStats=()=>stats(['bloodthirst','chainReaction']);
 c.applyStatus(e,'bleed',{dps:10}); assert.equal(c.legendaryOutgoingDamageMultiplier(p,e,{isPlayer:true}),1.32);
 c.applyStatus(e,'burn',{dps:10}); c.applyStatus(e,'poison',{dps:10});c.applyStatus(e,'corrode',{dps:10});c.applyStatus(e,'plague',{dps:10});c.applyEffect(e,'stun',5);
 assert.ok(Math.abs(c.legendaryOutgoingDamageMultiplier(p,e,{isPlayer:true})-1.8)<1e-9);
 c.FIELD.player=p;assert.ok(Math.abs(c.legendaryDotDamageMultiplier(e)-1.8)<1e-9);
 assert.equal(c.legendaryOutgoingDamageMultiplier(p,e,{isPlayer:false}),1);
 c.GT=20;assert.equal(c.legendaryOutgoingDamageMultiplier(p,e,{isPlayer:true}),1);
});
test('elation raises only enemy stackable debuffs, including direct DOT calls, by one',()=>{
 const c=load();c.getStats=()=>stats(['elation']);
 c.STATUS.testStack={name:'test',kind:'debuff',effect:'dot',dmg:1,dur:10,interval:1,stack:'stack',maxStacks:2};
 const e={hp:10000,maxHp:10000,effects:{},buffs:{},dots:[]};
 for(let i=0;i<5;i++) c.applyStatus(e,'testStack',{dps:10}); assert.equal(e.dots[0].stacks,3);
 const p=player();for(let i=0;i<5;i++) c.applyStatus(p,'testStack',{dps:10});assert.equal(p.dots[0].stacks,2);
 assert.equal(c.STATUS.testStack.maxStacks,2);
 c.STATUS.testStack.effect='stat';c.STATUS.testStack.key='test';
 for(let i=0;i<5;i++)c.applyStatus(e,'testStack',{val:1}); assert.equal(e.buffs.test.stacks,3);
});
test('fortify is an extra no-shield reduction and shield wall raises only the cap',()=>{
 const c=load(),p=player();c.getStats=()=>stats(['fortify']);
 assert.equal(c.legendaryIncomingDamageMultiplier(p),0.85);p.shield=1;assert.equal(c.legendaryIncomingDamageMultiplier(p),1);
 c.STAT_CAPS.blockDmgRed=20;c.G.equipment.ring=item('wall','shieldWall');
 const st=c.computeStats();assert.equal(st.blockDmgRedCap,80);assert.equal(c.blockDmgReduction(90,st.blockDmgRedCap),80);
 assert.equal(c.blockDmgReduction(0,st.blockDmgRedCap),30);
});
test('soften blow uses strict threshold, stacks each hit, loses six percent per second, and can kill',()=>{
 const c=load(),p=player();c.getStats=()=>stats(['softenBlow']);
 assert.equal(c.legendaryDeferHit(p,300,1000),300);assert.equal(c.legendaryDeferHit(p,301,1000),0);assert.equal(c.legendaryDeferHit(p,9999,1000),0);
 c.GT=.99;c.legendaryTickDeferred(p,c.getStats(),.99,'pv-float');assert.equal(p.hp,1000);
 c.GT=1;c.legendaryTickDeferred(p,c.getStats(),.01,'pv-float');assert.equal(p.hp,880);
 c.GT=5;c.legendaryTickDeferred(p,c.getStats(),4,'pv-float');assert.equal(p.hp,400);assert.equal(p._legendaryStaggers.length,0);
 c.GT=6;p.hp=20;c.legendaryDeferHit(p,999,1000);c.GT=7;c.legendaryTickDeferred(p,c.getStats(),1,'pv-float');assert.equal(p.hp,0);
 c.FIELD.player=p;c.resetLegendaryRT();assert.equal(p._legendaryStaggers,undefined);assert.equal(p._legendaryRefunds,undefined);
 assert.match(c.passiveLine(item('s','softenBlow'),{key:'softenBlow'}),/每秒-6%/);
});
test('mana refund uses actual paid cost, independent casts, five-second recovery, chance and maximum MP',()=>{
 const c=load(),p=player();c.getStats=()=>stats(['manaReflux']); c.chance=()=>true;
 c.legendaryOnManaSpent(p,100);assert.equal(p.mp,0);
 c.GT=1;c.legendaryTickDeferred(p,c.getStats(),1,'pv-float');assert.equal(p.mp,16);
 c.legendaryOnManaSpent(p,50);c.GT=5;c.legendaryTickDeferred(p,c.getStats(),4,'pv-float');assert.equal(p.mp,112);
 c.GT=6;c.legendaryTickDeferred(p,c.getStats(),1,'pv-float');assert.equal(p.mp,120);
 c.chance=()=>false;c.legendaryOnManaSpent(p,100);assert.equal(p._legendaryRefunds.length,0);
 c.chance=()=>true;c.legendaryOnManaSpent(p,100000);c.GT=11;c.legendaryTickDeferred(p,c.getStats(),5,'pv-float');assert.equal(p.mp,1000);
});
test('resolveHit routes no-shield reduction and stagger after defenses; misses never schedule loss',()=>{
 const c=load(),p=player(),enemy={hp:99999,effects:{},buffs:{},dots:[]};
 const st=stats(['fortify','softenBlow']);c.getStats=()=>st;c.rnd=()=>1;c.chance=pct=>pct>0;
 const attack={atk:400,hit:100,level:1,critRate:0}; const defense={isPlayer:true,maxHp:1000,def:0,resist:{}};
 const r=c.resolveHit(enemy,p,attack,defense);assert.equal(r.hpDamage,0);assert.equal(p.hp,1000);assert.equal(p._legendaryStaggers.length,1);
 c.GT=1;c.legendaryTickDeferred(p,st,1,'pv-float');assert.equal(p.hp,940);
 p.shield=100;const shielded=c.resolveHit(enemy,p,attack,defense);assert.equal(shielded.absorbed,100);assert.equal(shielded.hpDamage,300);
 assert.equal(p._legendaryStaggers.length,1);
 c.chance=()=>false;const miss=c.resolveHit(enemy,p,attack,defense);assert.equal(miss.miss,true);assert.equal(p._legendaryStaggers.length,1);
});
test('paid casts, triggered counter and paid auto casts each refund once; free or failed casts do not',()=>{
 const c=load(),p=player();p.mp=500;c.getStats=()=>stats(['manaReflux']);c.chance=()=>true;
 c.skills2Castable=()=>true;c.skills2Levels=()=>[1,0,0,0,0,0,0];c.skills2CanReach=()=>true;c.skills2ManaCost=()=>100;
 c.sgCastThrust=()=>{};c.skills2Cooldown=()=>1;c.sgArmUltRepeat=()=>{};
 const enemy={hp:10000,maxHp:10000,x:10,y:0,effects:{},buffs:{},dots:[]};
 assert.ok(c.castSkill2(p,enemy,'thrust','mv-float'));assert.equal(p.mp,400);assert.equal(p._legendaryRefunds.length,1);
 assert.ok(c.castSkill2(p,enemy,'thrust','mv-float',{repeat:true}));assert.equal(p.mp,400);assert.equal(p._legendaryRefunds.length,1);
 assert.equal(c.castSkill2(p,[],'thrust','mv-float'),null);assert.equal(p._legendaryRefunds.length,1);
 c.skills2PassiveMinMp=()=>50;assert.equal(c.sgCounterPayMp(p),true);assert.equal(p.mp,350);assert.equal(p._legendaryRefunds.length,2);
 c.sgAutoCastPay(p,'thrust');assert.equal(p.mp,250);assert.equal(p._legendaryRefunds.length,3);
});
