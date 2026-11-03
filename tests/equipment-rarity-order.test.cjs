'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRuneEnv } = require('./helpers/runeword-env.cjs');
const { createEngine } = require('../scripts/sim/engine.js');
const tables = require('../tools/config_tables.cjs');
const plain = v => JSON.parse(JSON.stringify(v));
const root = path.resolve(__dirname, '..');
const keys = ['common','uncommon','rare','unique','epic','legendary','mythic','genesis','mythicGodforged','godforged','chaos','chaosGodforged'];
const multipliers = [1,1.35,1.75,2.3,3,4,5.2,7,8,11,15.3,23];
const oldToNew = [0,1,2,3,4,5,6,7,9,10,11,8];

test('最新12品質順序、倍率、名稱與Excel／CSV一致；全部品質可生成', () => {
  const c = loadRuneEnv();
  assert.deepEqual(plain(c.RARITIES.map(r => r.key)), keys);
  assert.deepEqual(plain(c.RARITIES.map(r => r.mult)), multipliers);
  for (const name of ['game_parameters','Zone_Stage_Drops','Achievement','String']) {
    const csv = tables.csvParse(fs.readFileSync(path.join(root,'config/CSV',name+'.csv'),'utf8')).filter(r=>r.length>1);
    // Excel的數字XML可能寫出完整浮點尾數；CSV匯出器會使用相同數值的最短字串。
    const normalized = rows => rows.map(r=>r.map(v=>{
      const text=String(v);
      return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : text;
    }));
    assert.deepEqual(normalized(csv), normalized(tables.readXlsxRows(path.join(root,'config/Excel',name+'.xlsx'))), name);
  }
  keys.forEach((key, r) => {
    const it = c.makeEquipment(300,{rarity:r,slot:'chest',ancientCount:0});
    assert.equal(it.rarity,r);
    assert.equal(it.affixes.length,c.RARITIES[r].affix[0]);
    assert.equal(it.sockets.length,c.RARITIES[r].sockets);
    assert.equal(c.rarityRank(r),r);
    assert.ok(it.name.startsWith(c.RARITY_PREFIX[r]), key);
    assert.ok(Number.isFinite(c.itemScore(it)));
  });
});

test('掉落與拆解表完整涵蓋12品質，R8預設不自然掉落且混沌使用R10', () => {
  const c=loadRuneEnv();
  Object.values(c.ZONE_STAGE_DROP_TABLE).flat().forEach(row=>{
    assert.equal(row.equipmentRates.length,12);
    assert.equal(row.equipmentRates[8],0);
  });
  assert.equal(c.fieldDropRatesFor(412,1,'god_battlefield')[10],0);
  assert.equal(c.fieldDropRatesFor(413,1,'god_battlefield')[10],1);
  assert.deepEqual(plain(c.ESSENCE_SALVAGE_CHANCE_BY_RARITY),[5,7.5,10,15,20,25,30,100,100,100,100,100]);
  assert.deepEqual(keys.map((_,r)=>c.ancientEssenceSalvageChanceForRarity(r)),[0,0,0,0,0.5,1,10,100,10,100,0,0]);
  c.BOSS_DROP_TABLE.forEach(row=>assert.equal(row.rates.length,12));
});

test('舊檔每個裝備容器與品質設定一次性轉換；相同引用不重複轉換', () => {
  const c=loadRuneEnv(),d=c.newGameState();
  delete d.equipmentRarityVersion;
  const expected=new Map();
  function gear(old){
    const it=c.makeEquipment(300,{rarity:oldToNew[old],slot:'chest',ancientCount:1});
    it.rarity=old; it.locked=true;
    expected.set(it.id,{rarity:oldToNew[old],affixes:plain(it.affixes)});
    return it;
  }
  d.inventory=oldToNew.map((_,r)=>gear(r));
  d.equipmentSets[0].chest=gear(11);d.equipment=d.equipmentSets[0];
  d.equipmentSets[1].chest=gear(8);d.equipmentSets[2].chest=gear(9);
  d.factory.conveyor=[gear(10)];d.factory.synthBuffer=[gear(11)];
  d.newForge.queue=[gear(9)];
  d.newForge.furnaces[0].queue=[gear(7)];d.newForge.furnaces[0].belt=[gear(8)];
  d.newForge.furnaces[0].qualities=oldToNew.map((_,r)=>r===7||r===9);
  d.forge.slots=[gear(6),null,null,null,null,null];d.forge.quality=9;
  d.forge.result={name:d.inventory[11].name,rarity:11,slot:'chest',level:300};
  d.forge.seenRarity=9;
  d.factory.filter.actions=oldToNew.map((_,r)=>r===9?'salvage':'keep');
  d.player.salvageSettings={maxRarity:9,maxLevel:350,maxAncient:2};
  // 較早的熔爐V1/V2同樣以品質索引儲存 actions。
  d.newForge.furnaces[0].salvage={actions:['keep','keep','keep','keep','keep','keep','keep','keep','keep','salvage']};
  c.migrateEquipmentRarityOrder(d);
  assert.equal(d.equipmentSets[0].chest.rarity,8);
  assert.equal(d.forge.result.rarity,8);
  assert.equal(d.forge.quality,10);assert.equal(d.forge.seenRarity,10);
  assert.equal(d.player.salvageSettings.maxRarity,10);
  assert.equal(d.factory.filter.actions[10],'salvage');
  assert.equal(d.newForge.furnaces[0].qualities[10],true);
  assert.equal(d.newForge.furnaces[0].qualities[8],false);
  assert.equal(d.newForge.furnaces[0].salvage.actions[10],'salvage');
  const once=JSON.stringify(d);c.migrateEquipmentRarityOrder(d);assert.equal(JSON.stringify(d),once);
  const loaded=c.migrateSave(d),found=new Map();
  function collect(v){if(!v||typeof v!=='object')return;if(v.id&&v.kind==='equip')found.set(v.id,v);Object.values(v).forEach(collect);}
  collect(loaded);
  expected.forEach((exp,id)=>{
    assert.ok(found.has(id),id);
    assert.equal(found.get(id).rarity,exp.rarity,id);
    assert.equal(found.get(id).locked,true,id);
    assert.deepEqual(plain(found.get(id).affixes),exp.affixes,id);
  });
  assert.equal(found.size,expected.size);
  const before=JSON.stringify(loaded);c.migrateSave(loaded);assert.equal(JSON.stringify(loaded),before);
});

test('新版存檔重開不改品質，Worker排序與每個批次拆解門檻遵守新順序及鎖定保護', () => {
  const e=createEngine({seed:12}).boot(),c=e.ctx;
  c.G.inventory=keys.map((_,rarity)=>c.makeEquipment(300,{rarity,slot:'chest',ancientCount:0}));
  assert.equal(e.cmd('player.setInvSort',{index:2}).ok,true);
  assert.deepEqual(plain(c.G.inventory.map(it=>it.rarity)),[11,10,9,8,7,6,5,4,3,2,1,0]);
  const saved=JSON.parse(e.saveJson());
  const reopened=createEngine({seed:13}).boot(saved);
  assert.deepEqual(plain(reopened.ctx.G.inventory.map(it=>it.rarity)),[11,10,9,8,7,6,5,4,3,2,1,0]);
  for(let threshold=0;threshold<12;threshold++){
    c.G.inventory=keys.map((_,rarity)=>c.makeEquipment(300,{rarity,slot:'chest',ancientCount:0}));
    const lock=c.makeEquipment(300,{rarity:threshold,slot:'chest'});lock.locked=true;c.G.inventory.push(lock);
    assert.equal(e.cmd('item.salvageBulk',{maxRarity:threshold}).ok,true);
    assert.equal(c.G.inventory.length,12-threshold);
    assert.ok(c.G.inventory.every(it=>it.locked||it.rarity>threshold));
    assert.ok(c.G.inventory.some(it=>it.id===lock.id));
  }
});

for(let r=0;r<12;r++)test('R'+r+'：穿脫／鎖定／強化／洗煉／鑲孔與單件拆解',()=>{
  const e=createEngine({seed:50+r}).boot(),c=e.ctx;
  c.G.player.gold=1e12;c.G.player.scrap=1e9;c.G.player.essence=1e9;
  const it=c.makeEquipment(300,{rarity:r,slot:'chest',ancientCount:0});c.G.inventory.push(it);
  const run=(name,args)=>assert.equal(e.cmd(name,{itemId:it.id,...args}).ok,true,name);
  run('item.equip',{slotKey:'chest'});assert.equal(c.G.equipment.chest.id,it.id);
  run('item.unequip',{slotKey:'chest'});assert.ok(c.G.inventory.some(x=>x.id===it.id));
  run('item.setLock',{locked:true});assert.equal(it.locked,true);
  assert.equal(e.cmd('item.salvage',{itemId:it.id}).ok,false);
  run('item.setLock',{locked:false});
  run('item.upgrade');assert.equal(it.upgrade,1);
  const n=it.affixes.length;run('item.rerollAffix',{affixKey:it.affixes[0].key});assert.equal(it.affixes.length,n);
  if(it.sockets.length){const type=Object.keys(c.GEM_TYPES)[0];c.G.player.gems[type]={1:2};run('gem.socket',{type,index:0,level:1});assert.ok(it.sockets[0]);run('gem.unsocket',{index:0});assert.equal(it.sockets[0],null);}
  if(c.rwSlotCountAt(r,false)){c.G.player.runes.r01=2;run('rune.socket',{runeId:'r01',index:0});assert.equal(it.runes[0],'r01');}
  run('item.salvage');assert.ok(!c.G.inventory.some(x=>x.id===it.id));
});

test('新神鑄配方、成本與自動拆解保護使用正確品質；神鑄神話不誤開創世品質頁',()=>{
  const c=loadRuneEnv();
  assert.deepEqual([6,7,10].map(r=>c.divineForgeOutputRarity(r)),[8,9,11]);
  assert.deepEqual([8,9,11].map(r=>c.divineForgeBaseRarity(r)),[6,7,10]);
  assert.deepEqual(keys.map((_,r)=>c.isGodforgedRarity(r)),keys.map((_,r)=>[8,9,11].includes(r)));
  assert.deepEqual([6,7,8,9,10,11].map(r=>c.rerollCost({rarity:r,level:50}).essence),[9,14,9,20,27,36]);
  c.G.forge.seenRarity=6;
  c.forgeNoteRarity(c.makeEquipment(300,{rarity:8,slot:'chest'}));
  assert.equal(c.G.forge.seenRarity,6);
});
