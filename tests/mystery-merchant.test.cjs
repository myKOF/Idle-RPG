const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {createEngine} = require('../scripts/sim/engine.js');
const {readXlsxRows,csvParse} = require('../tools/config_tables.cjs');
const root = path.resolve(__dirname,'..');
const plain = v => JSON.parse(JSON.stringify(v));
function game(seed=17) { return createEngine({seed}).boot(); }
function success(e,name,args) {
  const r=e.cmd(name,args);
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(r.result,null,JSON.stringify(r));
}

test('無券與未召喚拒絕，末張券只扣一次；關閉後必須重新消耗',()=>{
  const e=game(), c=e.ctx, p=e.state().player;
  assert.match(e.cmd('merchant.open').result,/邀請券/);
  assert.equal(p.consumables.mystery_invitation,0);
  assert.match(e.cmd('gem.shopRefresh').result,/召喚/);
  assert.match(e.cmd('gem.shopUpgrade').result,/召喚/);
  assert.match(e.cmd('gem.shopBuy',{index:0}).result,/召喚/);
  c.addMerchantInvitations(1);
  success(e,'merchant.open');
  const items=plain(c.gemShop().items);
  assert.equal(p.consumables.mystery_invitation,0);
  success(e,'merchant.open');
  assert.deepEqual(plain(c.gemShop().items),items);
  success(e,'merchant.close');
  assert.match(e.cmd('merchant.open').result,/邀請券/);
  c.addMerchantInvitations(1);
  success(e,'merchant.open');
  assert.notDeepEqual(plain(c.gemShop().items),items);
  const panel=e.panel('tower');
  assert.equal(panel.merchant.active,true);
  assert.equal(panel.merchant.tickets,0);
});

test('各類商品實體、價格、金幣、滿包及重複購買由正式指令驗證',()=>{
  const e=game(),c=e.ctx,g=e.state();
  c.addMerchantInvitations(1);success(e,'merchant.open');
  const items=c.gemShop().items;
  assert.deepEqual(Array.from(items.slice(0,3),it=>it.kind),['gem','equipment','rune']);
  g.player.gold=1e20;
  const gemIndex=items.findIndex(it=>it.kind==='gem'), gem=items[gemIndex];
  const gemBefore=c.gemCount(gem.type,gem.lv);
  success(e,'gem.shopBuy',{index:gemIndex});
  assert.equal(c.gemCount(gem.type,gem.lv),gemBefore+1);
  const eqIndex=items.findIndex(it=>it.kind==='equipment'),eq=items[eqIndex];
  const cap=c.inventoryCapacityWithTalents();
  const original=g.inventory;
  g.inventory=Array(cap).fill({locked:true});
  const before=g.player.gold;
  assert.match(e.cmd('gem.shopBuy',{index:eqIndex}).result,/背包已滿/);
  assert.equal(eq.sold,false);assert.equal(g.player.gold,before);
  g.inventory=original;
  success(e,'gem.shopBuy',{index:eqIndex});
  assert.equal(g.inventory.at(-1).id,eq.equipment.id);
  const after=g.player.gold;
  assert.match(e.cmd('gem.shopBuy',{index:eqIndex}).result,/售|購買/);
  assert.equal(g.player.gold,after);
  const runeIndex=items.findIndex(it=>it.kind==='rune'), rune=items[runeIndex];
  const runeBefore=c.runeCount(rune.runeId);
  success(e,'gem.shopBuy',{index:runeIndex});
  assert.equal(c.runeCount(rune.runeId),runeBefore+1);
});

test('全買略過滿包裝備仍能購買寶石符文；不足金幣不扣款',()=>{
  const e=game(),c=e.ctx,g=e.state();
  c.addMerchantInvitations(1);success(e,'merchant.open');
  g.player.gold=0;
  const first=c.gemShop().items[0];
  assert.match(e.cmd('gem.shopBuy',{index:0}).result,/金幣不足/);
  assert.equal(first.sold,false);assert.equal(g.player.gold,0);
  g.player.gold=1e20;g.inventory=Array(c.inventoryCapacityWithTalents()).fill({locked:true});
  const r=e.cmd('gem.shopBuyAll');
  assert.equal(r.ok,true);assert.ok(r.result.bought>=2);
  assert.ok(c.gemShop().items.filter(it=>it.kind==='equipment').every(it=>!it.sold));
  assert.ok(c.gemShop().items.filter(it=>it.kind!=='equipment').every(it=>it.sold));
});

test('最高已通關層決定裝備品質上限，選取／當前層及高玩家等級不會越過',()=>{
  const e=game(),c=e.ctx,g=e.state();
  c.MERCHANT_CATEGORY_TABLE[0]=[['equipment',100]];
  c.MYSTERY_MERCHANT_SETTINGS.equipmentMaxRarity=11;
  g.player.level=1000;
  for(const [highest,cap] of [[0,5],[5,5],[6,6],[16,6],[21,7],[150,7]]) {
    g.tower.highest=highest;g.tower.floor=150;
    assert.equal(c.merchantEquipmentRarityRange().max,cap);
    for(let i=0;i<10;i++){
      c.rollGemShop();
      assert.ok(c.gemShop().items.every(it=>it.equipment.rarity<=cap));
    }
  }
  c.MYSTERY_MERCHANT_SETTINGS.equipmentMinRarity=11;g.tower.highest=1;
  assert.deepEqual(plain(c.merchantEquipmentRarityRange()),{min:5,max:5});
});

test('商人太古數依獨立機率表；零／三／四及超額截斷，不影響野外設定',()=>{
  const e=game(),c=e.ctx,g=e.state();
  const fieldWeights=JSON.stringify(c.ANCIENT_COUNT_WEIGHTS);
  assert.deepEqual(plain(c.MERCHANT_EQUIPMENT_ANCIENT_COUNT_TABLE),[[0,75],[3,20],[4,5]]);
  c.MERCHANT_CATEGORY_TABLE[0]=[['equipment',100]];
  c.MYSTERY_MERCHANT_SETTINGS.equipmentMinRarity=5;c.MYSTERY_MERCHANT_SETTINGS.equipmentMaxRarity=5;
  g.player.level=100;
  for(const wanted of [0,3,4,99]) {
    c.MERCHANT_EQUIPMENT_ANCIENT_LEVEL_TABLE[0]=[[wanted,100]];
    c.rollGemShop();
    for(const it of c.gemShop().items) assert.equal(c.getItemAncientCount(it.equipment),Math.min(wanted,it.equipment.affixes.length));
  }
  c.MERCHANT_EQUIPMENT_ANCIENT_LEVEL_TABLE[0]=[[0,0],[3,100]];
  c.Math.random=()=>0;
  c.rollGemShop();
  assert.ok(c.gemShop().items.every(it=>c.getItemAncientCount(it.equipment)===Math.min(3,it.equipment.affixes.length)&&it.equipment.affixes.length>0),'零權重即使亂數為0也不能中選');
  assert.equal(JSON.stringify(c.ANCIENT_COUNT_WEIGHTS),fieldWeights);
});

test('遺物未註冊不會產生假商品；全類別關閉不扣邀請券',()=>{
  const e=game(),c=e.ctx,p=e.state().player;
  c.MERCHANT_CATEGORY_TABLE[0]=[['gem',40],['equipment',30],['rune',10],['relic',20]];
  c.addMerchantInvitations(2);success(e,'merchant.open');
  assert.ok(c.gemShop().items.every(it=>it.kind!=='relic'));
  success(e,'merchant.close');
  c.MERCHANT_CATEGORY_TABLE[0]=[['gem',0],['equipment',0],['rune',0],['relic',0]];
  assert.match(e.cmd('merchant.open').result,/沒有可販售/);
  assert.equal(p.consumables.mystery_invitation,1);
});

test('召喚與升級各讀該商店等級的類別、裝備品質與部位、太古條數及符文',()=>{
  const e=game(), c=e.ctx, g=e.state();
  g.player.level=100;
  g.player.gold=1e15;
  g.tower.highest=1;
  c.MERCHANT_CATEGORY_TABLE[0]=[['gem',0],['equipment',50],['rune',50]];
  c.MERCHANT_CATEGORY_TABLE[1]=[['gem',20],['equipment',40],['rune',40]];
  c.MERCHANT_EQUIPMENT_RARITY_TABLE[0]=[[2,100]];
  c.MERCHANT_EQUIPMENT_RARITY_TABLE[1]=[[7,100]];
  c.MERCHANT_EQUIPMENT_SLOT_TABLE[0]=[['ring',100]];
  c.MERCHANT_EQUIPMENT_SLOT_TABLE[1]=[['chest',100]];
  c.MERCHANT_EQUIPMENT_ANCIENT_LEVEL_TABLE[0]=[[0,100]];
  c.MERCHANT_EQUIPMENT_ANCIENT_LEVEL_TABLE[1]=[[4,100]];
  c.MERCHANT_RUNE_TIER_TABLE[0]=[[1,100]];
  c.MERCHANT_RUNE_TIER_TABLE[1]=[[33,100]];
  c.addMerchantInvitations(1);
  success(e,'merchant.open');
  let stock=c.gemShop().items;
  assert.deepEqual(Array.from(new Set(stock.map(it=>it.kind))),['equipment','rune']);
  assert.ok(stock.filter(it=>it.kind==='equipment').every(it=>it.equipment.rarity===2 && it.equipment.slot==='ring' && c.getItemAncientCount(it.equipment)===0));
  assert.ok(stock.filter(it=>it.kind==='rune').every(it=>it.runeId==='r01'));
  success(e,'gem.shopUpgrade');
  assert.equal(c.gemShop().level,2);
  stock=c.gemShop().items;
  assert.deepEqual(Array.from(new Set(stock.map(it=>it.kind))),['gem','equipment','rune']);
  assert.ok(stock.filter(it=>it.kind==='equipment').every(it=>it.equipment.rarity===5 && it.equipment.slot==='chest' && c.getItemAncientCount(it.equipment)===Math.min(4,it.equipment.affixes.length)));
  assert.ok(stock.filter(it=>it.kind==='rune').every(it=>it.runeId==='r33'));
});

test('重新讀檔保留券、商店等級、已買商品庫存，但不恢復會話',()=>{
  const e=game(),c=e.ctx,g=e.state();
  c.addMerchantInvitations(3);success(e,'merchant.open');
  g.player.gold=1e15;success(e,'gem.shopBuy',{index:0});
  c.gemShop().level=4;
  const saved=JSON.parse(e.saveJson());
  const e2=createEngine({seed:19}).boot(saved);
  assert.equal(e2.ctx.merchantInvitationCount(e2.state().player),2);
  assert.equal(e2.ctx.gemShop().level,4);
  assert.deepEqual(plain(e2.state().player.gems),plain(g.player.gems));
  assert.equal(e2.panel('tower').merchant.active,false);
  assert.match(e2.cmd('gem.shopBuy',{index:1}).result,/召喚/);
  delete saved.player.consumables;
  const legacy=createEngine({seed:19}).boot(saved);
  assert.equal(legacy.ctx.merchantInvitationCount(legacy.state().player),0);
});

test('塔BOSS勝利按表掉券，敗北／撤退及重複結算不產生券',()=>{
  for(const [win,rate,want,reason] of [[true,100,1,null],[true,0,0,null],[false,100,0,'timeout'],[false,100,0,'flee']]) {
    const e=game(),c=e.ctx;
    c.MYSTERY_MERCHANT_SETTINGS.ticketDropRate=rate;
    c.startTowerFight(1);c.endTowerFight(win,reason);
    assert.equal(c.merchantInvitationCount(e.state().player),want);
    if(win&&want)assert.ok(c.TOWER.result.rewards.some(s=>s.includes('神祕邀請券')));
    c.endTowerFight(win,reason);
    assert.equal(c.merchantInvitationCount(e.state().player),want);
  }
});

test('掉落統計將邀請券顯示為道具名稱與數量',()=>{
  const c=game().ctx;
  c.currentLootStats().mats.mystery_invitation=2;
  assert.match(c.statsLootHtml(),/神祕邀請券/);
  assert.ok(c.LOOT_MAT_DEFS.some(d=>d.key==='mystery_invitation'&&d.name===c.STR(2436)));
});

test('Store由原生Excel匯出，商店參數從主表完整搬移且古詞條機率總和驗證',()=>{
  const excel=readXlsxRows(path.join(root,'config/Excel/Store.xlsx'),'Store');
  const csv=csvParse(fs.readFileSync(path.join(root,'config/CSV/Store.csv'),'utf8'));
  assert.deepEqual(excel.map(r=>r.map(String)),csv);
  assert.equal(csv.filter(r=>/^8-寶(?:石商店|店刷出)/.test(r[2])).length,42);
  assert.equal(csv.filter(r=>/^8-商人/.test(r[2])).length,120);
  assert.equal(csv[0].at(-1),'參數ag');
  assert.ok(!csv.some(r=>r[2]==='8-寶石商店' && ['手動刷新費用','刷新週期'].includes(r[3])));
  const params=csvParse(fs.readFileSync(path.join(root,'config/CSV/game_parameters.csv'),'utf8'));
  assert.equal(params.filter(r=>/^8-寶(?:石商店|店刷出)/.test(r[2])).length,0);
  for(const sheet of ['game_parameters','計算表']) {
    const rows=readXlsxRows(path.join(root,'config/Excel/game_parameters.xlsx'),sheet);
    assert.equal(rows.filter(r=>/^8-寶(?:石商店|店刷出)/.test(r[2])).length,0);
  }
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'merchant-invalid-'));
  const source=fs.readFileSync(path.join(root,'config/CSV/Store.csv'),'utf8');
  const file=path.join(temp,'Store.csv');
  try {
    const invalid = [
      [source.replace('3=20','3=19'),/太古詞條機率/],
      [source.replace(/(8-商人刷出類別,商店 Lv\.1,[^\r\n]*?)裝備=30/, '$1裝備=29'),/刷出類別.*總和須為100%/],
      [source.replace(/(8-商人符文階級,商店 Lv\.1,[^\r\n]*?),20=5/, '$1,34=5'),/符文階級.*有效項目/],
      [source.replace(/(8-商人符文階級,商店 Lv\.1,[^\r\n]*?),20=5/, '$1,19=5'),/符文階級.*不得重複/]
    ];
    for (const [csvText, expected] of invalid) {
      assert.notEqual(csvText,source);
      fs.writeFileSync(file,csvText);
      assert.throws(()=>execFileSync(process.execPath,['tools/apply_params.cjs'],{cwd:root,env:{...process.env,STORE_CSV:file},stdio:'pipe'}),
        error=>expected.test(String(error.stderr)));
    }
  } finally {
    fs.rmSync(temp,{recursive:true});
  }
});
