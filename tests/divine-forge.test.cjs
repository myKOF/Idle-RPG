'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuneEnv } = require('./helpers/runeword-env.cjs');
const { createEngine } = require('../scripts/sim/engine.js');
const plain = v => JSON.parse(JSON.stringify(v));
test('game_parameters可調費用並拒絕超出七格介面與結算規則的配方，試跑不寫遊戲',()=>{
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
  const cfg=require('../tools/config_tables.cjs'),root=path.resolve(__dirname,'..');
  const rows=cfg.csvParse(fs.readFileSync(path.join(root,'config/CSV/game_parameters.csv'),'utf8'));
  const file=path.join(os.tmpdir(),'divine-forge-params-'+process.pid+'-'+Date.now()+'.csv');
  const source=fs.readFileSync(path.join(root,'js/data.js'),'utf8');
  function run(name,value){
    const copy=rows.map(r=>r.slice());
    const row=copy.find(r=>r[2]==='6-新版神鑄'&&r[3]===name);assert.ok(row);row[6]=String(value);
    fs.writeFileSync(file,cfg.csvStringify(copy));
    return cp.spawnSync(process.execPath,['tools/apply_params.cjs'],{cwd:root,encoding:'utf8',env:{...process.env,PARAMS_CSV:file}});
  }
  try{
    const valid=run('裝備神鑄神話金幣',123);assert.equal(valid.status,0);assert.match(valid.stdout,/20000000 → 123/);
    for(const [name,value] of [['裝備神鑄素材件數',7],['神級寶石每類顆數',4],['精鑄刻印素材件數',2],['裝備神鑄失敗最多損失',7],['無效果神性之石返還率',2]])assert.notEqual(run(name,value).status,0,name);
    assert.equal(fs.readFileSync(path.join(root,'js/data.js'),'utf8'),source);
  }finally{if(fs.existsSync(file))fs.unlinkSync(file);}
});
function env(reinc=5) {
  const c=loadRuneEnv(); c.G.player.reincarnations=reinc;
  c.G.player.gold=1e12; c.G.player.dust=1000;
  return c;
}
function gear(c,r=6,ancient=0) {
  const it=c.makeEquipment(100,{rarity:r,slot:'helmet',level:100,ancientCount:ancient});
  c.G.inventory.push(it); return it;
}
function fill(c,r=6) {
  const items=Array.from({length:6},()=>gear(c,r));
  items.forEach(it=>assert.equal(c.forgePlaceItem(it.id),null)); return items;
}
test('四種功能轉數與未解鎖指令不可繞過；切換完整退料',()=>{
  const c=env(1),it=gear(c);
  assert.ok(c.forgePlaceItem(it.id)); assert.ok(c.doForge());
  c.G.player.reincarnations=2;
  assert.equal(c.forgePlaceItem(it.id),null); assert.ok(c.forgeSetOperation('ancient'));
  c.G.player.reincarnations=3;
  assert.equal(c.forgeSetOperation('ancient'),null);
  assert.equal(c.G.inventory[0].id,it.id); assert.equal(c.forgeItemCount(),0);
  assert.ok(c.forgeSetOperation('gem')); c.G.player.reincarnations=4;
  assert.equal(c.forgeSetOperation('gem'),null); assert.ok(c.forgeSetOperation('imprint'));
  c.G.player.reincarnations=5; assert.equal(c.forgeSetOperation('imprint'),null);
});
for(const [rarity,output,base,stones,cost] of [[6,11,35,13,2e7],[7,8,25,15,1e8],[9,10,15,17,5e8]]) {
  test('裝備神鑄品質 '+rarity+'：上限100%、對應產物、金幣與石頭精確扣款',()=>{
    const c=env(); const items=fill(c,rarity); items[0].level=300;
    c.forgeSetStones(999); const info=c.forgeRateInfo();
    assert.deepEqual([info.base,info.total,info.stones,info.cost],[base,100,stones,cost]);
    const gold=c.G.player.gold,dust=c.G.player.dust;
    assert.equal(c.doForge(),null); assert.equal(c.G.inventory.length,1);
    const made=c.G.inventory[0]; assert.equal(made.rarity,output); assert.equal(made.level,300);
    assert.equal(made.godPassives,undefined); assert.equal(c.G.player.gold,gold-cost);
    assert.equal(c.G.player.dust,dust-stones); assert.equal(c.forgeItemCount(),0);
    if(rarity===6) assert.match(made.name,/神鑄神話/);
  });
}
test('不接受傳奇、已神鑄、混品質與上鎖；缺料／缺錢不消耗',()=>{
  const c=env(); for(const r of [5,8,10,11]) assert.ok(c.forgePlaceItem(gear(c,r).id));
  const lock=gear(c);lock.locked=true;assert.ok(c.forgePlaceItem(lock.id));
  assert.equal(c.forgePlaceItem(gear(c).id),null);assert.ok(c.forgePlaceItem(gear(c,7).id));
  const before=JSON.stringify(c.G);assert.ok(c.doForge());assert.equal(JSON.stringify(c.G),before);
  c.forgeUnloadAll();fill(c);c.G.player.gold=0;
  const noGold=JSON.stringify(c.G);assert.ok(c.doForge());assert.equal(JSON.stringify(c.G),noGold);
});
test('裝備失敗隨機損失3或4件，其餘滿背包仍完整退還；不獎勵石頭',()=>{
  for(const max of [false,true]) {
    const c=env(),items=fill(c);c.chance=()=>false;
    c.ri=(a,b)=>max?b:a;const gold=c.G.player.gold,dust=c.G.player.dust;
    assert.equal(c.doForge(),null);
    assert.equal(c.G.inventory.length,max?2:3);
    assert.ok(c.G.inventory.every(it=>items.includes(it)));
    assert.equal(c.G.player.dust,dust);assert.equal(c.G.player.gold,gold-2e7);
  }
});
test('太古精鑄只改一個非太古位置，滿太古拒絕；神鑄品質同基礎成功率',()=>{
  for(const rarity of [6,11,7,8,9,10]) {
    const c=env();c.forgeSetOperation('ancient');const it=gear(c,rarity,1);
    const keys=it.affixes.map(a=>a.key);c.forgePlaceItem(it.id);
    assert.equal(c.forgeRateInfo().base,rarity===6||rarity===11?40:rarity===7||rarity===8?30:20);
    c.forgeSetStones(999);assert.equal(c.doForge(),null);
    assert.equal(it.affixes.filter(a=>a.ancient).length,2);
    assert.deepEqual(it.affixes.map(a=>a.key),keys);
    it.affixes.forEach(a=>a.ancient=true);assert.ok(c.forgePlaceItem(it.id));
  }
});
test('神級寶石需要兩種10級各3顆；75%雙屬性隨配置回算、鑲拆不變',()=>{
  const c=env();c.forgeSetOperation('gem');
  const types=Object.keys(c.GEM_TYPES).filter(c.isGemEnabled).slice(0,2);
  for(const type of types)c.addGem(type,10,4);
  assert.ok(c.forgePlaceGem(types[0],9));
  for(const type of types)for(let i=0;i<3;i++)assert.equal(c.forgePlaceGem(type,10),null);
  assert.ok(c.forgePlaceGem(types[0],10));
  c.forgeSetStones(999);assert.equal(c.forgeRateInfo().stones,85);
  assert.equal(c.doForge(),null);const fg=c.G.player.fusedGems[0];
  assert.equal(fg.divine,true);assert.equal(fg.stats.length,2);
  for(const s of fg.stats)assert.equal(c.fusedStatValue(s),c.gemStatValue(s.type,10)*.75);
  const it=gear(c);assert.equal(c.socketFusedGem(it,fg.id,0),null);
  c.unsocketGem(it,0);assert.equal(c.G.player.fusedGems[0].id,fg.id);
  assert.ok(c.dismantleFusedGem(fg.id).err);
  const saved=JSON.stringify(c.G);c.G=c.migrateSave(JSON.parse(saved));
  assert.equal(c.G.player.fusedGems[0].stats[0].divine,true);
});
test('神級寶石失敗六顆皆消失；精鑄與刻印失敗裝備消失，不退金幣／石頭',()=>{
  const c=env();c.chance=()=>false;
  for(const mode of ['ancient','imprint']){
    c.forgeSetOperation(mode);const it=gear(c);c.forgePlaceItem(it.id);c.forgeSetStones(1);
    const g=c.G.player.gold,d=c.G.player.dust,cost=c.forgeRateInfo().cost;
    assert.equal(c.doForge(),null);assert.ok(!c.G.inventory.includes(it));
    assert.equal(c.G.player.gold,g-cost);assert.equal(c.G.player.dust,d-1);
  }
  c.forgeSetOperation('gem');
  const types=Object.keys(c.GEM_TYPES).filter(c.isGemEnabled).slice(0,2);
  types.forEach(t=>{c.addGem(t,10,3);for(let i=0;i<3;i++)c.forgePlaceGem(t,10);});
  assert.equal(c.doForge(),null);types.forEach(t=>assert.equal(c.gemCount(t,10),0));
  assert.equal(c.G.player.fusedGems.length,0);
});
test('七種刻印、無目標改無效果返還、重刻撤回舊效果',()=>{
  const c=env(),it=gear(c,6,1),a=it.affixes[0];
  const ancient=it.affixes.findIndex(a=>a.ancient),normal=it.affixes.findIndex(a=>!a.ancient);
  const kinds=['sacredAffix','ancientAffix','sacredSocket','extraAffix','extraAncient','legendary','refund'];
  for(const kind of kinds){
    c.wpick=()=>kind;const dust=c.G.player.dust;c.forgeApplyImprint(it,5);
    assert.equal(it.imprint.kind,kind);
    if(kind==='refund')assert.equal(c.G.player.dust,dust+2);
  }
  c.wpick=()=> 'sacredAffix';c.forgeApplyImprint(it,10);
  assert.equal(it.imprint.index,ancient);
  it.affixes[ancient].key='atkFlat';
  const value=c.affixValue(it,it.affixes[ancient]);delete it.imprint;
  assert.equal(value,2353);
  assert.equal(c.affixValue(it,it.affixes[ancient]),1868);
  c.wpick=()=> 'ancientAffix';c.forgeApplyImprint(it,10);
  assert.ok(!it.affixes[it.imprint.index].ancient);
  const original=plain(it.affixes);c.wpick=()=> 'extraAncient';c.forgeApplyImprint(it,10);
  assert.equal(it.imprint.affix.ancient,true);assert.deepEqual(plain(it.affixes),original);
  c.wpick=()=> 'refund';c.forgeApplyImprint(it,10);assert.equal(it.imprint.affix,undefined);
  const empty=gear(c,6,0),dust=c.G.player.dust;
  c.wpick=()=> 'sacredAffix';c.forgeApplyImprint(empty,5);
  assert.equal(empty.imprint.kind,'refund');assert.equal(c.G.player.dust,dust+2);
});
test('刻印的詞條、神聖孔與傳奇特效實際參與computeStats，重複傳奇不疊加',()=>{
  const c=env(),it=gear(c);c.G.equipment.helmet=it;
  it.affixes=[];it.sockets=[{type:'ruby',level:10}];
  const base=c.computeStats();
  it.imprint={kind:'sacredSocket',index:0};const socket=c.computeStats();
  assert.ok(socket.atk>base.atk);
  it.imprint={kind:'extraAffix',affix:{key:'hpFlat',roll:10000,ancient:false}};
  assert.ok(c.computeStats().hp>base.hp);
  it.imprint={kind:'legendary',passive:{key:'manaReflux'}};
  assert.equal(c.computeStats().legendaryEffects.manaReflux,true);
  const other=gear(c);other.passive={key:'manaReflux'};c.G.equipment.chest=other;
  assert.equal(c.computeStats().passives.manaReflux,c.PASSIVE_POOL.manaReflux.base);
  assert.match(c.itemDetailHTML(it),/60a5fa/);
});
test('舊待製作法陣完整退還且遷移冪等，舊專屬特效不再生效',()=>{
  const c=env(),it=gear(c);c.G.inventory=[];
  c.G.forge={slots:[it,{kind:'gem',type:'ruby',level:9},null,null,null,null],crafting:{startedAt:1,durationMs:1},autoForge:true,unlockNotified:true};
  const gold=c.G.player.gold,dust=c.G.player.dust;
  c.forgeState();c.forgeState();assert.equal(c.G.inventory.length,1);
  assert.equal(c.gemCount('ruby',9),1);assert.equal(c.G.player.gold,gold);assert.equal(c.G.player.dust,dust);
  assert.equal(c.G.forge.autoForge,undefined);assert.equal(c.G.forge.crafting,undefined);
  it.godPassives=[{key:'dragonBlood',roll:10000}];c.normalizeItemValueSources(it);
  assert.equal(it.godPassives,undefined);
});
test('刻印額外詞條與普通詞條使用同一評分乘區，品質排序按階序而非追加ID',()=>{
  const c=env(),it=gear(c),a={key:'atkFlat',roll:500,ancient:false};
  it.affixes=[];it.imprint={kind:'extraAffix',affix:a};const imprinted=c.itemScore(it);
  delete it.imprint;it.affixes=[a];assert.equal(c.itemScore(it),imprinted);
  assert.ok(c.rarityRank(11)>c.rarityRank(6));assert.ok(c.rarityRank(11)<c.rarityRank(7));
});
test('實際migrateSave在補預設值後仍辨識舊神鑄，完整退還一次',()=>{
  const c=env(),it=gear(c);const old=plain(c.G);old.inventory=[];
  old.forge={slots:[plain(it),{kind:'gem',type:'ruby',level:9},null,null,null,null],crafting:{startedAt:1,durationMs:1},unlockNotified:true};
  const migrated=c.migrateSave(old);
  assert.equal(migrated.forge.version,2);assert.equal(migrated.forge.slots.filter(Boolean).length,0);
  assert.equal(migrated.inventory.filter(x=>x.id===it.id).length,1);
  assert.equal(migrated.player.gems.ruby[9],1);
  const again=c.migrateSave(plain(migrated));
  assert.equal(again.inventory.filter(x=>x.id===it.id).length,1);assert.equal(again.player.gems.ruby[9],1);
});
test('正式Worker指令與面板：三秒結算與持久化',()=>{
  const e=createEngine({seed:8}).boot(null),c=e.ctx;
  c.G.player.reincarnations=5;c.G.player.gold=1e12;c.G.player.dust=100;
  for(let i=0;i<6;i++){const it=c.makeEquipment(100,{rarity:6});c.G.inventory.push(it);assert.equal(c.runCommand('forge.placeItem',{itemId:it.id}).result,null);}
  c.runCommand('forge.setStones',{count:13});
  const before=e.saveJson();e.panel('forge');assert.equal(e.saveJson(),before);
  assert.equal(e.panel('forge').rate.total,100);
  assert.ok(!c.runCommand('forge.start',{}).err);assert.equal(c.G.inventory.length,0);
  e.stepSeconds(2.9);assert.equal(c.G.inventory.length,0);
  e.stepSeconds(.1);assert.equal(c.G.inventory[0].rarity,11);
  assert.equal(c.runCommand('forge.setAutoFill',{on:true}).ok,false);
  const loaded=createEngine({seed:8}).boot(JSON.parse(e.saveJson()));
  assert.equal(loaded.ctx.G.inventory[0].rarity,11);
});
