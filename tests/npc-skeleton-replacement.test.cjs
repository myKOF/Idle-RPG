'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),cfg=require('../tools/config_tables.cjs');
const expected={swamp_8:['skeleton_mage_book','骷髏咒書師'],swamp_10:['skeleton_warrior_sword','骷髏劍盾兵'],swamp_12:['skeleton_warrior_axe','骷髏斧衛'],undead_12:['skeleton_mage_staff','骷髏杖法師']};
function context(){const c={console,Math:Object.create(Math),window:null,document:{addEventListener(){},getElementById(){return null}},UI:{dirty:{}},G:{tower:{active:false}},blog(){},floatText(){},floatEnemyEvent(){},floatPlayerEvent(){},playCombatVfx(){},trackDps(){},recordRunDamage(){},recordLootBattle(){},recordLootKill(){},recordLootDeath(){},Date};c.window=c;c.Math.random=()=>.5;vm.createContext(c);for(const f of ['util','strings_data','strings','data','status','formula','battlefield','combat'])vm.runInContext(fs.readFileSync(path.join(root,'js',f+'.js'),'utf8'),c);return c;}
test('框選四款被完整全身骷髏取代，四階級來源／名稱／四動作一致且舊圖退役保留',()=>{
 const c=context(),m=JSON.parse(fs.readFileSync(path.join(root,'images/sprites/npc/npc.json'))),rows=cfg.csvParse(fs.readFileSync(path.join(root,'config/CSV/NPC.csv'),'utf8')),h=rows[0];
 for(const [id,[key,name]]of Object.entries(expected)){
  const d=c.NPC_CONFIG_TABLE[id],matching=rows.slice(1).filter(r=>r[0]===id);assert.equal(matching.length,4);assert.equal(d.name,name);
  for(const [a,col]of [['idle','站立圖像'],['walk','移動圖像'],['attack','攻擊圖像'],['die','死亡圖像']]){
   const stem=key+'_'+a;assert.equal(d.sprite[a],stem);assert.equal(m.stems[stem].frames,a==='walk'?8:6);assert.equal(m.chars[key].cellH,128);assert.equal(m.chars[key].facing,-1);
   for(const row of matching){assert.equal(row[h.indexOf(col)],stem);assert.equal(row[1],name);}
  }
 }
 for(const old of ['memento_skeleton','cheeky_devil','hell_giant','the_devil']){
  assert.ok(m.retiredChars.includes(old));assert.ok(m.chars[old]);assert.ok(fs.existsSync(path.join(root,'images/sprites/npc',old+'_idle.png')));
  assert.ok(Object.values(c.NPC_CONFIG_TABLE).every(d=>!d.sprite||!Object.values(d.sprite).some(stem=>m.stems[stem]?.char===old)));
 }
});
test('兩隻法師四階級均為魔法遠程、24米射程及6米移速，生成及實際追擊沿用同一設定',()=>{
 const c=context(),rows=cfg.csvParse(fs.readFileSync(path.join(root,'config/CSV/NPC.csv'),'utf8')),h=rows[0];
 for(const id of ['swamp_8','undead_12']){
  const d=c.NPC_CONFIG_TABLE[id];assert.equal(d.magic,true);assert.equal(d.runSpeed,6);assert.equal(d.atkRange,24);
  for(const row of rows.slice(1).filter(r=>r[0]===id)){assert.equal(row[h.indexOf('魔法型（1是／0否）')],'1');assert.equal(row[h.indexOf('移動速度(米/秒)')],'6');assert.equal(row[h.indexOf('攻擊距離(米)')],'24');}
  for(const options of [{},{elite:true},{boss:true}]){
   const m=c.makeFieldEnemy(d,{level:10,hp:1000,atk:120,def:0,mdef:0,aspd:1,dodge:0,hit:100,gold:1,xp:1},{hpMult:1,atkMult:1,defMult:1,rewardMult:1},1,{...options,enterCd:0});
   assert.equal(m.magic,true);assert.equal(m.runSpeed,c.bfMeterPx(6));assert.equal(m.atkRange,c.bfMeterPx(24));assert.equal(c.bfEnemyIsRanged(m),true);assert.equal(c.monsterAtkCfg(m).dmgType,'magic');
   m.pos={x:1000,y:0};m._alerted=true;c.bfResetPlayer();c.bfTickApproach([m],.5);assert.equal(m.pos.x,1000-c.bfMeterPx(6)*.5);assert.equal(m.pos.y,0);
  }
 }
});
test('法師真實普攻對魔防結算且送出遠程投射物、命中時序與傷害類型一致',()=>{
 const c=context();const st={level:10,def:0,mdef:0,evasion:0,blockRate:0,blockDmgRed:0,pRes:0,mRes:0,resist:{ctrl:0},tenacity:0,ccRed:0,globalDmgRed:0,normalDmgRed:0,eliteDmgRed:0,bossDmgRed:0,resVsElem:{},elemDmgPct:{},elemDmgUp:{},dmgVsElem:{},passives:{}};c.getStats=()=>st;c.GT=0;
 for(const id of ['swamp_8','undead_12']){
  const def=c.NPC_CONFIG_TABLE[id],events=[];c.playCombatVfx=s=>events.push(s);
  const make=()=>Object.assign(c.makeFieldEnemy(def,{level:10,hp:1000,atk:120,def:0,mdef:0,aspd:1,dodge:0,hit:100,gold:1,xp:1},{hpMult:1,atkMult:1,defMult:1,rewardMult:1},1,{enterCd:0}),{floatSel:id,pos:{x:200,y:0}});
  const player=()=>({hp:10000,mp:100,shield:0,buffs:{},effects:{},dots:[]});
  st.def=100000;st.mdef=0;const a=c.doMonsterAttack(make(),player(),'pv-float');st.def=0;st.mdef=100000;const b=c.doMonsterAttack(make(),player(),'pv-float');
  assert.ok(a.dmg>b.dmg&&a.dmg>0,id+' should use mdef');assert.equal(events.length,2);
  for(const e of events){assert.equal(e.variant,'enemy-projectile');assert.equal(e.sourceId,id);assert.equal(e.elem,def.attr);assert.equal(e.travelMs[0],260);assert.equal(e.dur,.26);}
 }
});
