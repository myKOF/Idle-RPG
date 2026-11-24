const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {createEngine} = require('../scripts/sim/engine.js');
const {readXlsxRows,csvParse,csvStringify} = require('../tools/config_tables.cjs');
const root = path.resolve(__dirname,'..');
const plain = v => JSON.parse(JSON.stringify(v));
function game(seed=17) { return createEngine({seed}).boot(); }
function success(e,name,args) {
  const r=e.cmd(name,args);
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(r.result,null,JSON.stringify(r));
}

test('GM invite 累加邀請券並刷新商人投影，無效數量與外部環境不發放', () => {
  const e = game(), c = e.ctx, p = e.state().player;
  for (const count of [100, 25]) {
    const result = e.cmd('gm.exec', { line: 'invite ' + count }).result;
    assert.equal(result.ok, true);
    assert.match(result.message, /神祕邀請券/);
  }
  assert.equal(p.consumables.mystery_invitation, 125);
  assert.equal(e.panel('tower').merchant.tickets, 125);
  assert.equal(c.MYSTERY_MERCHANT_OPEN, false, '發券不召喚商人');
  for (const line of ['invite', 'invite 0', 'invite -1', 'invite 1.5', 'invite NaN', 'invite Infinity', 'invite 9007199254740992', 'invite 1 extra']) {
    assert.equal(c.executeGMCommand(line).ok, false, line);
    assert.equal(p.consumables.mystery_invitation, 125);
  }
  c.location.hostname = 'game.example.com';
  assert.equal(c.executeGMCommand('invite 1').ok, false);
  assert.equal(p.consumables.mystery_invitation, 125);
});

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

test('遺物正權重參與商品保底與補位，零權重關閉；全類別關閉不扣邀請券',()=>{
  const e=game(),c=e.ctx,p=e.state().player;
  c.MERCHANT_CATEGORY_TABLE[0]=[['gem',40],['equipment',30],['rune',10],['relic',20]];
  c.addMerchantInvitations(2);success(e,'merchant.open');
  assert.ok(c.gemShop().items.some(it=>it.kind==='relic'));
  assert.deepEqual(Array.from(c.gemShop().items.slice(0,4),it=>it.kind),['gem','equipment','rune','relic']);
  success(e,'merchant.close');
  c.MERCHANT_CATEGORY_TABLE[0]=[['gem',40],['equipment',30],['rune',10],['relic',0]];
  assert.equal(c.rollGemShop(),true);
  assert.ok(c.gemShop().items.every(it=>it.kind!=='relic'));
  c.MERCHANT_CATEGORY_TABLE[0]=[['gem',0],['equipment',0],['rune',0],['relic',0]];
  assert.match(e.cmd('merchant.open').result,/沒有可販售/);
  assert.equal(p.consumables.mystery_invitation,1);
});

test('遺物依逐級編號權重抽取，零權重不選中、留白讀通用範圍、無候選不耗券',()=>{
  const e=game(),c=e.ctx;
  c.MERCHANT_CATEGORY_TABLE[0]=[['relic',10]];
  c.GEM_SHOP_COUNT_TABLE[0]=[[5,1]];
  c.MERCHANT_RELIC_TIER_TABLE[0]=[[1,0],[32,250]];
  c.Math.random=()=>0;
  c.addMerchantInvitations(2);success(e,'merchant.open');
  assert.equal(c.gemShop().items.length,5);
  assert.ok(c.gemShop().items.every(it=>it.kind==='relic'&&it.relicId===32));
  c.MERCHANT_RELIC_TIER_TABLE[0]=null;
  c.MYSTERY_MERCHANT_SETTINGS.relicMinTier=3;c.MYSTERY_MERCHANT_SETTINGS.relicMaxTier=4;
  assert.deepEqual(Array.from(c.merchantRelicPairs(1),pair=>pair[0].id),[3,4]);
  c.MERCHANT_RELIC_TIER_TABLE[1]=[[7,1]];
  assert.deepEqual(Array.from(c.merchantRelicPairs(2),pair=>pair[0].id),[7]);
  c.MERCHANT_CATEGORY_TABLE[0]=null;
  Object.assign(c.MYSTERY_MERCHANT_SETTINGS,{gemWeight:0,equipmentWeight:0,runeWeight:0,relicWeight:1});
  assert.deepEqual(Array.from(c.merchantCategoryPairs(1),pair=>pair[0]),['relic']);
  c.MYSTERY_MERCHANT_SETTINGS.relicWeight=0;
  assert.equal(c.merchantCategoryPairs(1).length,0);
  c.MYSTERY_MERCHANT_SETTINGS.relicWeight=1;
  c.MERCHANT_RELIC_TIER_TABLE[0]=[[999,1]];
  const stock=plain(c.gemShop().items);success(e,'merchant.close');
  assert.match(e.cmd('merchant.open').result,/沒有可販售/);
  assert.equal(c.merchantInvitationCount(e.state().player),1);
  assert.deepEqual(plain(c.gemShop().items),stock);
});

test('商品刷出數量決定整批總數，包含各類保底且受40件上限限制',()=>{
  const e=game(),c=e.ctx;
  c.MERCHANT_CATEGORY_TABLE[0]=[['gem',5],['equipment',3],['rune',2],['relic',1]];
  for(const [size,want] of [[10,10],[99,40],[2,2]]) {
    c.GEM_SHOP_COUNT_TABLE[0]=[[size,1]];
    assert.equal(c.rollGemShop(),true);assert.equal(c.gemShop().items.length,want);
    assert.deepEqual(Array.from(c.gemShop().items.slice(0,Math.min(size,4)),it=>it.kind),['gem','equipment','rune','relic'].slice(0,size));
  }
  c.GEM_SHOP_COUNT_TABLE[0]=[[5,1],[9,3]];
  for(const [random,want] of [[0.1,5],[0.5,9]]) {
    c.Math.random=()=>random;
    assert.equal(c.rollGemShop(),true);assert.equal(c.gemShop().items.length,want);
  }
});

test('遺物按Store基數標價、購買套折扣；首件解鎖、重複累積，缺金與重購不扣款',()=>{
  const e=game(),c=e.ctx,g=e.state();
  c.MERCHANT_CATEGORY_TABLE[0]=[['relic',1]];c.MERCHANT_RELIC_TIER_TABLE[0]=[[1,1]];
  c.MYSTERY_MERCHANT_SETTINGS.relicPriceBase=123.6;
  c.addMerchantInvitations(1);success(e,'merchant.open');
  const stock=c.gemShop().items;
  assert.ok(stock.every(it=>it.price===124));
  g.player.gold=123;assert.match(e.cmd('gem.shopBuy',{index:0}).result,/金幣不足/);
  assert.equal(c.relicLevel(1),0);assert.equal(g.player.gold,123);assert.equal(stock[0].sold,false);
  g.player.gold=124;success(e,'gem.shopBuy',{index:0});
  assert.deepEqual(plain(c.relicEntry(1)),{lv:1,n:0});assert.equal(g.player.gold,0);
  g.player.gold=1000;
  assert.match(e.cmd('gem.shopBuy',{index:0}).result,/售|購買/);assert.equal(g.player.gold,1000);
  const discount=c.RELIC_BY_EFFECT.merchantDiscount;
  c.relicGrant(discount.id,1);
  const price=Math.round(124*(1-c.relicPct('merchantDiscount')));
  assert.equal(c.merchantItemPrice(stock[1]),price);
  const inventory=g.inventory;g.inventory=Array(c.inventoryCapacityWithTalents()).fill({locked:true});
  success(e,'gem.shopBuy',{index:1});
  assert.equal(g.player.gold,1000-price);assert.deepEqual(plain(c.relicEntry(1)),{lv:1,n:1});
  g.inventory=inventory;
  const result=e.cmd('gem.shopBuyAll').result;
  assert.equal(result.bought,stock.length-2);assert.equal(result.spent,price*(stock.length-2));
  assert.equal(c.relicEntry(1).n,stock.length-1);
  const snapshot=plain(g.player.relics), gold=g.player.gold;
  assert.equal(e.cmd('gem.shopBuyAll').result.bought,0);assert.deepEqual(plain(g.player.relics),snapshot);assert.equal(g.player.gold,gold);
  const loaded=createEngine({seed:19}).boot(JSON.parse(e.saveJson()));
  assert.deepEqual(plain(loaded.state().player.relics),snapshot);
  assert.deepEqual(plain(loaded.ctx.gemShop().items),plain(stock));
  assert.equal(loaded.panel('tower').merchant.active,false);
});

test('遺物非法編號與過期會話拒絕交易；不扣款、不發放、不標售出',()=>{
  const e=game(),c=e.ctx,g=e.state();
  c.MERCHANT_CATEGORY_TABLE[0]=[['relic',1]];c.MERCHANT_RELIC_TIER_TABLE[0]=[[1,1]];
  c.addMerchantInvitations(1);success(e,'merchant.open');g.player.gold=1e9;
  const item=c.gemShop().items[0],gold=g.player.gold;
  item.relicId=999;assert.ok(e.cmd('gem.shopBuy',{index:0}).result);
  assert.equal(g.player.gold,gold);assert.equal(item.sold,false);assert.equal(c.relicLevel(1),0);
  item.relicId=1;c.Date.now=()=>c.MYSTERY_MERCHANT_EXPIRES_AT+1;
  assert.ok(e.cmd('gem.shopBuy',{index:0}).result);
  assert.equal(g.player.gold,gold);assert.equal(item.sold,false);assert.equal(c.relicLevel(1),0);
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
  assert.equal(e2.panel('tower').merchant.expiresAt,0);
  assert.match(e2.cmd('gem.shopBuy',{index:1}).result,/召喚/);
  delete saved.player.consumables;
  const legacy=createEngine({seed:19}).boot(saved);
  assert.equal(legacy.ctx.merchantInvitationCount(legacy.state().player),0);
});

test('商人預設存在600秒，重複open保留商品與期限；只有成功耗券會重置',()=>{
  const e=game(),c=e.ctx,p=e.state().player;
  let now=c.Date.now();c.Date.now=()=>now;
  c.addMerchantInvitations(3);success(e,'merchant.open');
  const original=plain(c.gemShop().items),first=e.panel('tower').merchant.expiresAt;
  assert.equal(first,now+600000);
  now+=60000;success(e,'merchant.open');
  assert.equal(e.panel('tower').merchant.expiresAt,first);
  assert.deepEqual(plain(c.gemShop().items),original);
  assert.equal(c.merchantInvitationCount(p),2);
  p.gold=1e15;success(e,'gem.shopBuy',{index:0});
  success(e,'gem.shopUpgrade');
  assert.equal(e.panel('tower').merchant.expiresAt,first,'購買及金幣升級不重置');
  success(e,'gem.shopRefresh');
  const refreshed=e.panel('tower').merchant.expiresAt;
  assert.equal(refreshed,now+600000);
  assert.equal(c.merchantInvitationCount(p),1);
  p.consumables.mystery_invitation=0;now+=1000;
  assert.match(e.cmd('gem.shopRefresh').result,/邀請券/);
  assert.equal(e.panel('tower').merchant.expiresAt,refreshed,'失敗不延長');
});

test('期限前有效，到期由Worker自動結束；到期後不能購買或刷新扣款',()=>{
  const e=game(),c=e.ctx,p=e.state().player;
  let now=c.Date.now();c.Date.now=()=>now;
  c.MYSTERY_MERCHANT_SETTINGS.durationSeconds=2;
  c.addMerchantInvitations(3);p.gold=1e15;success(e,'merchant.open');
  const deadline=e.panel('tower').merchant.expiresAt;
  now=deadline-1;assert.equal(e.panel('tower').merchant.active,true);
  const gold=p.gold,tickets=c.merchantInvitationCount(p);
  now=deadline;
  // loop must expire even while the menu has paused simulation and no panel is requested.
  c._menuPaused=true;c.loop();
  assert.equal(c.MYSTERY_MERCHANT_OPEN,false);
  assert.equal(c.MYSTERY_MERCHANT_EXPIRES_AT,0);
  c._menuPaused=false;
  for(const [name,args] of [['gem.shopBuy',{index:0}],['gem.shopBuyAll',{}],['gem.shopUpgrade',{}],['gem.shopRefresh',{}]])
    assert.match(e.cmd(name,args).result,/召喚/);
  assert.equal(p.gold,gold);assert.equal(c.merchantInvitationCount(p),tickets);
  success(e,'merchant.open');
  assert.equal(e.panel('tower').merchant.expiresAt,now+2000);
  assert.equal(c.merchantInvitationCount(p),tickets-1);
  success(e,'merchant.close');
  assert.equal(e.panel('tower').merchant.expiresAt,0);
});

test('刷新無可售商品時保留邀請券與期限；過期面板自行清理會話',()=>{
  const e=game(),c=e.ctx,p=e.state().player;
  let now=c.Date.now();c.Date.now=()=>now;
  c.addMerchantInvitations(2);success(e,'merchant.open');
  const deadline=e.panel('tower').merchant.expiresAt;
  c.MYSTERY_MERCHANT_SETTINGS.gemWeight=0;c.MYSTERY_MERCHANT_SETTINGS.equipmentWeight=0;
  c.MYSTERY_MERCHANT_SETTINGS.runeWeight=0;c.MYSTERY_MERCHANT_SETTINGS.relicWeight=0;
  c.MERCHANT_CATEGORY_TABLE=[];
  now+=1000;assert.match(e.cmd('gem.shopRefresh').result,/沒有可販售/);
  assert.equal(c.merchantInvitationCount(p),1);
  assert.equal(e.panel('tower').merchant.expiresAt,deadline);
  now=deadline;assert.equal(e.panel('tower').merchant.active,false);
});

test('執行中讀取其他存檔會清除舊商人與期限',()=>{
  const e=game(),c=e.ctx;
  c.addMerchantInvitations(2);success(e,'merchant.open');
  c.loadIntoRunningSim({save:JSON.parse(e.saveJson())});
  assert.equal(e.panel('tower').merchant.active,false);
  assert.equal(e.panel('tower').merchant.expiresAt,0);
});

test('塔BOSS勝利按表掉券，敗北／撤退及重複結算不產生券',()=>{
  for(const [win,rate,want,reason] of [[true,100,1,null],[true,0,0,null],[false,100,0,'timeout'],[false,100,0,'flee']]) {
    const e=game(),c=e.ctx;
    c.MERCHANT_INVITATION_DROP_RANGES=[[1,150,rate]];
    c.startTowerFight(1);c.endTowerFight(win,reason);
    assert.equal(c.merchantInvitationCount(e.state().player),want);
    if(win&&want)assert.ok(c.TOWER.result.rewards.some(s=>s.includes('神祕邀請券')));
    c.endTowerFight(win,reason);
    assert.equal(c.merchantInvitationCount(e.state().player),want);
  }
});

test('邀請券由最高通關層的區間機率往下遞減，首次挑戰讀取該層區間',()=>{
  const c=game().ctx;
  c.MERCHANT_INVITATION_DROP_RANGES=[[1,50,20],[51,100,40]];
  assert.deepEqual([40,39,38,37,36,35,1].map(floor=>c.towerInvitationDropChance(floor,40)),[20,16,12,8,4,0,0]);
  assert.equal(c.towerInvitationDropChance(50,51),32);
  assert.equal(c.towerInvitationDropChance(51,50),40);
  assert.equal(c.towerInvitationDropChance(1,0),20);
  assert.equal(c.towerInvitationDropChance(101,100),0);
  assert.equal(c.towerInvitationDropChance(39,40,0.5),24);
  assert.equal(c.towerInvitationDropChance(51,51,2),100);
  assert.equal(c.towerInvitationDropChance(35,40,2),0);
  c.G.tower.highest=40;
  c.chance=rate=>rate>15;
  c.grantTowerBossRewards(38,false,0,[]);
  assert.equal(c.merchantInvitationCount(c.G.player),0);
  c.grantTowerBossRewards(39,false,0,[]);
  assert.equal(c.merchantInvitationCount(c.G.player),1);
});

test('掉落統計將邀請券顯示為道具名稱與數量',()=>{
  const c=game().ctx;
  c.currentLootStats().mats.mystery_invitation=2;
  assert.match(c.statsLootHtml(),/神祕邀請券/);
  assert.ok(c.LOOT_MAT_DEFS.some(d=>d.key==='mystery_invitation'&&d.name===c.STR(2436)));
});

test('Store由原生Excel匯出，商店參數完整搬移且拒絕無效權重',()=>{
  const excel=readXlsxRows(path.join(root,'config/Excel/Store.xlsx'),'Store');
  const csv=csvParse(fs.readFileSync(path.join(root,'config/CSV/Store.csv'),'utf8'));
  assert.deepEqual(excel.map(r=>r.map(String)),csv);
  assert.equal(csv.filter(r=>/^8-(?:寶(?:石商店|店刷出)|商品刷出數量)/.test(r[2])).length,42);
  assert.equal(csv.filter(r=>r[2]==='8-商品刷出數量').length,20);
  assert.ok(!csv.some(r=>r[2]==='8-寶店刷出數量'));
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
      [source.replace(/(神祕商人,存在時間\(秒\),[^\r\n]*?,)600,/, (_match, prefix) => prefix+'0,'),/存在時間/],
      [source.replace('3=20','3=-1'),/太古詞條機率/],
      [source.replace(/\{51,100,[\d.]+\}/,'{50,100,10}'),/邀請券掉落率樓層區間不得重疊/],
      [source.replace(/\{1,50,[\d.]+\}/,'{1,50,101}'),/邀請券掉落率樓層或百分比超出範圍/],
      [source.replace(/(8-商人刷出類別,商店 Lv\.1,[^\r\n]*?)裝備=30/, '$1裝備=-1'),/刷出類別.*有效項目/],
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

test('Store全部分布接受非100總和、小數與超過100的權重，保留原權重套用',()=>{
  const source=csvParse(fs.readFileSync(path.join(root,'config/CSV/Store.csv'),'utf8'));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'merchant-weights-'));
  const file=path.join(temp,'Store.csv');
  const groups=new Set();
  for (const row of source.slice(1)) {
    if (!/^8-(?:寶店刷出|商品刷出|商人)/.test(row[2]) && row[3]!=='裝備太古詞條機率') continue;
    groups.add(row[2]+' / '+(row[2]==='神祕商人'?row[3]:''));
    const entries=row.slice(6).filter(cell=>cell.includes('='));
    if (!entries.length) entries.push('武器=1','戒指=1');
    row.splice(6, row.length-6, ...entries.map((cell,i)=>cell.split('=')[0]+'='+([0.5,250,0][i%3])));
  }
  assert.equal(groups.size,9);
  try {
    fs.writeFileSync(file,csvStringify(source));
    const output=execFileSync(process.execPath,['tools/apply_params.cjs'],{cwd:root,env:{...process.env,STORE_CSV:file},encoding:'utf8'});
    assert.match(output,/錨點問題 0/);
    for (const variable of ['GEM_SHOP_COUNT_TABLE','GEM_SHOP_TIER_TABLE','商人裝備太古詞條機率',
      'MERCHANT_CATEGORY_TABLE','MERCHANT_EQUIPMENT_RARITY_TABLE','MERCHANT_EQUIPMENT_SLOT_TABLE',
      'MERCHANT_EQUIPMENT_ANCIENT_LEVEL_TABLE','MERCHANT_RUNE_TIER_TABLE','MERCHANT_RELIC_TIER_TABLE']) {
      assert.match(output,new RegExp(variable));
    }
    assert.match(output,/\[1, 0\.5\], \[2, 250\]/);
    assert.match(output,/\["gem", 0\.5\], \["equipment", 250\]/);
  } finally { fs.rmSync(temp,{recursive:true}); }
});

test('Store分布仍拒絕全零、重複及非有限權重；類別全零可停用',()=>{
  const source=csvParse(fs.readFileSync(path.join(root,'config/CSV/Store.csv'),'utf8'));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'merchant-weight-invalid-'));
  const file=path.join(temp,'Store.csv');
  const variants=[
    ['8-寶店刷出階級',['1=0','2=0']],
    ['8-商品刷出數量',['5=1','5=2']],
    ['8-商品刷出數量',['5=-1']],
    ['神祕商人',['0=0','3=0']],
    ['神祕商人',['0=Infinity']],
    ['8-商人裝備品質',['2=0','3=0']],
    ['8-商人裝備部位',['武器=NaN']],
    ['8-商人符文階級',['1=Infinity']],
    ['8-商人遺物編號',['999=1']],
    ['8-商人遺物編號',['1='+('9'.repeat(309))]],
    ['8-商人遺物編號',['1='+('9'.repeat(308)),'2='+('9'.repeat(308))]]
  ];
  try {
    for (const [group,entries] of variants) {
      const rows=plain(source), row=rows.find(r=>r[2]===group && (group!=='神祕商人'||r[3]==='裝備太古詞條機率'));
      row.splice(6,row.length-6,...entries);
      fs.writeFileSync(file,csvStringify(rows));
      assert.throws(()=>execFileSync(process.execPath,['tools/apply_params.cjs'],{cwd:root,env:{...process.env,STORE_CSV:file},stdio:'pipe'}),
        error=>String(error.stderr).includes(group==='神祕商人'?'太古詞條機率':group),group+' '+entries);
    }
    const row=source.find(r=>r[2]==='8-商人刷出類別');
    row.splice(6,row.length-6,'寶石=0','裝備=0','符文=0','遺物=0');
    fs.writeFileSync(file,csvStringify(source));
    assert.doesNotThrow(()=>execFileSync(process.execPath,['tools/apply_params.cjs'],{cwd:root,env:{...process.env,STORE_CSV:file},stdio:'pipe'}));
  } finally { fs.rmSync(temp,{recursive:true}); }
});

test('商人商品依相對權重抽取，整列等比例縮放不改變相同亂數的商品結果',()=>{
  const tables=['GEM_SHOP_COUNT_TABLE','GEM_SHOP_TIER_TABLE','MERCHANT_CATEGORY_TABLE',
    'MERCHANT_EQUIPMENT_RARITY_TABLE','MERCHANT_EQUIPMENT_SLOT_TABLE',
    'MERCHANT_EQUIPMENT_ANCIENT_LEVEL_TABLE','MERCHANT_RUNE_TIER_TABLE'];
  const generate=scale=>{
    const e=game(91),c=e.ctx;
    c.Date.now=()=>1700000000000;
    for(const table of tables) {
      c[table]=c[table].map(row=>row && row.map(pair=>[pair[0],pair[1]*scale]));
    }
    const batches=[];
    for(let i=0;i<20;i++) { assert.equal(c.rollGemShop(),true);batches.push(plain(c.gemShop().items)); }
    return batches;
  };
  const baseline=generate(1);
  assert.deepEqual(generate(10),baseline);
  assert.deepEqual(generate(0.1),baseline);
  const c=game().ctx;
  for(const [random,want] of [[0.05,'a'],[0.2,'b'],[0.5,'c'],[0.99,'c']]) {
    c.Math.random=()=>random;
    assert.equal(c.wpick([['a',1],['b',2],['c',7]]),want);
    assert.equal(c.wpick([['a',100],['b',200],['c',700]]),want);
  }
});
