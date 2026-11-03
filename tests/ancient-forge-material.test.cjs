'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine}=require('../scripts/sim/engine.js');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const tables=require('../tools/config_tables.cjs');
function setup(second=false,rarity=6){
  const e=createEngine({seed:1104}).boot(null),c=e.ctx;c.setCombatPaused(true);
  Object.assign(c.G.player,{reincarnations:5,gold:1e12,dust:0,ancientEssence:10000});
  assert.equal(c.runCommand('forge.setOperation',{mode:'ancient'}).result,null);
  const it=c.makeEquipment(100,{rarity,ancientCount:0});
  if(second){it.ancientForgeCount=1;it.affixes[0].ancient=true;it.affixes[0].ancientForgeOrder=1;}
  c.G.inventory.push(it);assert.equal(c.runCommand('forge.placeItem',{itemId:it.id}).result,null);
  return {e,c,it};
}
function select(c,count){assert.equal(c.runCommand('forge.setStones',{count}).result,null);return c.forgeRateInfo();}
for(const [rarity,base] of [[6,40],[7,30],[10,20]])for(const second of [false,true]){
  test(`品質${rarity}第${second?2:1}條：49/50/74/75/100%按整筆級距及次數倍率扣太古精華`,()=>{
    for(const [target,mult] of [[49,1],[50,2],[74,2],[75,4],[100,4]]){
      const {e,c,it}=setup(second,rarity),units=target-base,cost=units*mult*(second?3:1);
      const info=select(c,units);assert.equal(info.total,target);assert.equal(info.materialCost,cost);
      assert.equal(e.panel('forge').rate.materialCost,cost);
      const own=c.G.player.ancientEssence,gold=c.G.player.gold;c.chance=()=>true;
      assert.equal(c.runCommand('forge.start').result,null);e.stepSeconds(2.9);
      assert.equal(c.G.player.ancientEssence,own);e.stepSeconds(.1);
      assert.equal(c.G.player.ancientEssence,own-cost);assert.equal(c.G.player.dust,0);
      assert.equal(c.G.player.gold,gold-info.cost);assert.equal(it.ancientForgeCount,second?2:1);
    }
  });
}
test('自然太古及刻印附帶太古不算第2條精鑄；成功一次後才套3倍',()=>{
  const {c,it}=setup();it.affixes[0].ancient=true;it.imprint={kind:'extraAncient',affix:{key:'hpFlat',roll:100,ancient:true}};
  assert.equal(select(c,10).materialCost,20);
  c.chance=()=>true;assert.equal(c.doForge(),null);assert.equal(it.ancientForgeCount,1);
  assert.equal(c.forgePlaceItem(it.id),null);assert.equal(select(c,10).materialCost,60);
});
test('不足以跨越50或75%完整費用時，選取上限停在前一級距，不能用神性之石補足',()=>{
  for(const second of [false,true])for(const [owned,target,units] of [[19,49,9],[139,74,34]]){
    const {c}=setup(second),m=second?3:1;c.G.player.ancientEssence=owned*m;c.G.player.dust=1e9;
    const info=select(c,999);assert.equal(info.total,target);assert.equal(info.stones,units);
    assert.ok(info.materialCost<=owned*m);assert.equal(info.affordableStones,units);
  }
});
test('三秒結算前精華被花掉，拒絕原子扣款並保留裝備／金幣／神性之石',()=>{
  const {e,c,it}=setup(true);select(c,35);assert.equal(c.runCommand('forge.start').result,null);
  c.G.player.ancientEssence=419;c.G.player.dust=99999;const gold=c.G.player.gold;
  e.stepSeconds(3);assert.equal(c.forgeItemCount(),1);assert.equal(c.G.forge.slots[0].id,it.id);
  assert.equal(c.G.player.gold,gold);assert.equal(c.G.player.ancientEssence,419);assert.equal(c.G.player.dust,99999);
  assert.match(c.G.forge.log[0].msg,/太古精華/);
});
test('精鑄失敗亦依第2條及75%級距扣款，神性之石保持；存讀不改費用',()=>{
  const {e,c,it}=setup(true);select(c,35);
  const loaded=createEngine({seed:1104}).boot(JSON.parse(e.saveJson())),d=loaded.ctx;d.setCombatPaused(true);
  assert.equal(d.forgeRateInfo().materialCost,420);d.chance=()=>false;
  const own=d.G.player.ancientEssence;assert.equal(d.doForge(),null);
  assert.equal(d.G.player.ancientEssence,own-420);assert.equal(d.G.player.dust,0);
  assert.ok(!d.G.inventory.some(x=>x.id===it.id));
});
test('低庫存可選零投入，普通太古詞條不因材料替換改動，其他功能使用神性之石',()=>{
  const {c,it}=setup();c.G.player.ancientEssence=0;c.G.player.dust=1000;
  const info=select(c,60);assert.equal(info.stones,0);assert.equal(info.materialCost,0);assert.equal(info.total,40);
  c.forgeUnloadAll();assert.equal(c.forgeSetOperation('imprint'),null);assert.equal(c.forgePlaceItem(it.id),null);
  assert.equal(select(c,35).materialCost,35);assert.equal(c.divineForgeMaterialKey('imprint'),'dust');
});
test('新增倍率錨點可調且拒絕非遞增門檻或遞減倍率，試跑不寫遊戲',()=>{
  const root=path.resolve(__dirname,'..'),rows=tables.csvParse(fs.readFileSync(path.join(root,'config/CSV/game_parameters.csv'),'utf8'));
  const file=path.join(os.tmpdir(),'ancient-material-'+process.pid+'.csv');
  function run(name,value){const copy=rows.map(r=>r.slice()),row=copy.find(r=>r[2]==='6-新版神鑄'&&r[3]===name);assert.ok(row);row[6]=String(value);fs.writeFileSync(file,tables.csvStringify(copy));return cp.spawnSync(process.execPath,['tools/apply_params.cjs'],{cwd:root,encoding:'utf8',env:{...process.env,PARAMS_CSV:file}});}
  try{
    const r=run('太古精鑄第二條精華消耗倍率',5);assert.equal(r.status,0);assert.match(r.stdout,/3 → 5/);
    for(const [name,value] of [['太古精鑄第二條精華消耗倍率',0],['太古精鑄精華加倍成功率門檻',80],['太古精鑄精華四倍成功率門檻',101],['太古精鑄第二門檻精華消耗倍率',1]])assert.notEqual(run(name,value).status,0,name);
    const {c}=setup(true);c.DIVINE_FORGE.ancientSecondEssenceMult=5;c.DIVINE_FORGE.ancientEssenceMult2=6;
    assert.equal(select(c,35).materialCost,35*5*6);
  }finally{if(fs.existsSync(file))fs.unlinkSync(file);}
});
