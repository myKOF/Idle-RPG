'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createEngine } = require('../scripts/sim/engine.js');
const root = path.resolve(__dirname, '..');

function renderer() {
  const engine = createEngine({ seed: 17 }).boot();
  const ctx = engine.ctx;
  const nodes = {};
  for (const id of ['gem-shop-grid', 'gem-shop-level', 'shop-upgrade', 'shop-buy-all', 'shop-refresh']) {
    nodes[id] = { innerHTML: '', textContent: '', attrs: {},
      setAttribute(key, value) { this.attrs[key] = String(value); },
      removeAttribute(key) { delete this.attrs[key]; },
      toggleAttribute(key, flag) { if (flag) this.attrs[key] = ''; else delete this.attrs[key]; }
    };
  }
  const grid=nodes['gem-shop-grid'];grid.children=[];
  function card(html) {
    const node={html},tag=/<button\b([^>]*)>/.exec(html);
    if(tag){
      const key=/data-ui-pending-key="([^"]+)"/.exec(tag[1]),index=/data-shop-buy="([^"]+)"/.exec(tag[1]);
      const attrs={'data-ui-pending-key':key&&key[1],'data-shop-buy':index&&index[1]};
      node.button={disabled:/\bdisabled\b/.test(tag[1]),
        getAttribute:name=>attrs[name],hasAttribute:name=>name in attrs,
        toggleAttribute:(name,flag)=>{if(flag)attrs[name]='';else delete attrs[name];}};
    }
    Object.defineProperty(node,'outerHTML',{get:()=>node.html,set:next=>{grid.children[grid.children.indexOf(node)]=card(next);}});
    return node;
  }
  Object.defineProperty(grid,'innerHTML',{get:()=>grid.children.map(n=>n.outerHTML).join(''),
    set:html=>{grid.children=html.split(/(?=<div class="shop-card)/).filter(Boolean).map(card);}});
  grid.querySelectorAll=()=>grid.children.flatMap(n=>n.button?[n.button]:[]);
  Object.assign(ctx, {
    $id: id => nodes[id], nodePendingKey: id => 'node:'+id, isUiCommandPending:()=>false,
    pendingUiButtonAttributes: () => '', syncUiPendingControls: () => {},
    setAttrIfChanged: (node, key, value) => node.setAttribute(key, value)
  });
  const source = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  vm.runInContext(fs.readFileSync(path.join(root, 'js/ui-relic.js'), 'utf8'),ctx);
  vm.runInContext(source.slice(source.indexOf('function itemRarityEffectClass('),source.indexOf('function itemDetailClass(')),ctx);
  vm.runInContext(source.slice(source.indexOf('var GEM_TIER_COLORS ='), source.indexOf('/* ============ 迷你監控視窗')), ctx);
  return { engine, ctx, nodes, render: (items, gold = 1e12, tickets = 1, level = 1) =>
    ctx.renderGemShop({ shop: { items, level }, tickets }, { gold }) };
}

test('商品依遺物、裝備、符文、寶石穩定排列，購買索引、tips及停用狀態對應原庫存', () => {
  const {ctx,nodes,render}=renderer(),equipment=ctx.makeEquipment(1,{rarity:4});
  const items=[
    {kind:'gem',type:'garnet',lv:1,price:10,sold:false},
    {kind:'rune',runeId:'r01',price:20,sold:false},
    {kind:'equipment',equipment,price:30,sold:false},
    {kind:'relic',relicId:1,price:40,sold:false},
    {kind:'gem',type:'garnet',lv:2,price:50,sold:false},
    {kind:'relic',relicId:2,price:60,sold:false},
    {kind:'equipment',equipment:{...equipment,id:equipment.id+'-second'},price:70,sold:false},
    {type:'garnet',lv:1,price:80,sold:false}
  ];
  const original=JSON.stringify(items),order=[3,5,2,6,1,0,4,7];
  render(items,45);
  const cards=nodes['gem-shop-grid'].children.slice(0,items.length);
  assert.deepEqual(cards.map(n=>Number(n.button.getAttribute('data-shop-buy'))),order);
  assert.equal(JSON.stringify(items),original,'顯示排序不可修改正式庫存');
  assert.ok(cards[2].html.includes('data-merchant-equipment="2"'));
  assert.ok(cards[3].html.includes('data-merchant-equipment="6"'));
  for(let i=0;i<order.length;i++) {
    assert.equal(cards[i].button.disabled,items[order[i]].price>45);
    assert.equal(cards[i].button.getAttribute('data-ui-pending-key'),'node:gem-shop-buy:'+order[i]);
  }
  ctx.isUiCommandPending=key=>key==='node:gem-shop-buy:1';render(items);
  const pendingCards=nodes['gem-shop-grid'].children.slice(0,items.length);
  assert.deepEqual(pendingCards.map(n=>n.button.disabled),[false,false,false,false,true,false,false,false]);
  items[3].sold=true;render(items);
  assert.ok(nodes['gem-shop-grid'].children[0].html.includes(ctx.RELIC_BY_ID[1].name));
  assert.match(nodes['gem-shop-grid'].children[0].html,/shop-sold/);
  assert.equal(nodes['gem-shop-grid'].children[0].button,undefined);
  assert.deepEqual(nodes['gem-shop-grid'].children.slice(1,items.length).map(n=>Number(n.button.getAttribute('data-shop-buy'))),order.slice(1));
});

test('點擊排序後首張遺物卡購買原庫存遺物，沒有誤買原本第一格寶石', async () => {
  const {engine,ctx,nodes,render}=renderer(),source=fs.readFileSync(path.join(root,'js/ui.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('function uiCommandResultError('),source.indexOf('function requestUiPanels('))+
    source.slice(source.indexOf('function sendGemUiCommand('),source.indexOf('function runTalentUiAction(')),ctx);
  vm.runInContext('function clickMerchant(e) { '+source.slice(source.indexOf('// 寶石商店：單顆購買'),source.indexOf('// 符文鑲嵌（符文鑲嵌頁'))+' }',ctx);
  ctx.MERCHANT_CATEGORY_TABLE[0]=[['gem',5],['equipment',3],['rune',2],['relic',1]];
  ctx.MERCHANT_RELIC_TIER_TABLE[0]=[[1,1]];
  ctx.addMerchantInvitations(1);assert.equal(engine.cmd('merchant.open').result,null);
  const items=ctx.gemShop().items,g=engine.state();g.player.gold=1e12;
  assert.equal(items[0].kind,'gem');
  const index=items.findIndex(it=>it.kind==='relic');assert.ok(index>0);
  render(items,g.player.gold);
  const first=nodes['gem-shop-grid'].children[0].button;
  assert.equal(Number(first.getAttribute('data-shop-buy')),index);
  ctx.reportUiCommandFailure=(_title,error)=>assert.fail(String(error));
  ctx.sendUiCommand=(name,args,options)=>{
    assert.equal(args.index,index);
    assert.equal(JSON.stringify(options.keys),JSON.stringify(['node:gem-shop','node:gem-shop-buy:'+index]));
    return Promise.resolve(engine.cmd(name,args).result);
  };
  const gold=g.player.gold,price=ctx.merchantItemPrice(items[index]);
  ctx.clickMerchant({target:{closest:()=>first}});await new Promise(setImmediate);
  assert.equal(items[index].sold,true);assert.equal(items[0].sold,false);
  assert.equal(g.player.gold,gold-price);assert.equal(ctx.relicLevel(1),1);
});

test('商人卡使用實際寶石品質與符文階級，移除屬性數值並保留價格與三列占位', () => {
  const { ctx, nodes, render } = renderer();
  render([{kind:'gem', type:'garnet', lv:2, price:123, sold:false}, {kind:'rune', runeId:'r33', price:456, sold:false}]);
  const html = nodes['gem-shop-grid'].innerHTML;
  assert.match(html, new RegExp(ctx.STR(1563, 2)));
  assert.match(html, new RegExp(ctx.STR(1563, 33)));
  assert.match(html, /data-shop-buy="0"/);
  assert.match(html, /merchant-gold-icon/);
  assert.doesNotMatch(html, /undefined|NaN| \+/);
  assert.equal((html.match(/class="shop-card/g) || []).length, 12);
  assert.ok(!('data-scrollable-stock' in nodes['gem-shop-grid'].attrs));
});

test('商人遺物卡顯示正式名稱圖示、數量、效果提示與折扣價，售出不可再買', () => {
  const {ctx,nodes,render}=renderer(), relic=ctx.RELIC_BY_ID[1];
  const item={kind:'relic',relicId:1,price:1000000,sold:false};
  render([item]);
  const html=nodes['gem-shop-grid'].innerHTML;
  assert.ok(html.includes(relic.name));
  assert.ok(html.includes(ctx.relicIconPath(1)));
  assert.match(html,/merchant-relic-icon/);
  assert.match(html,/×1/);
  assert.ok(html.includes(ctx.relicDescAt(relic,1)));
  assert.match(html,/data-tt-title=/);
  assert.equal(nodes['gem-shop-grid'].children[0].button.disabled,false);
  render([item],0);
  assert.equal(nodes['gem-shop-grid'].children[0].button.disabled,true);
  ctx.relicDiscount=(_key,price)=>price*0.5;
  render([item],500000);
  assert.ok(nodes['gem-shop-grid'].innerHTML.includes(ctx.merchantGoldPriceHTML(500000)));
  assert.equal(nodes['gem-shop-grid'].children[0].button.disabled,false);
  item.sold=true;render([item]);
  assert.match(nodes['gem-shop-grid'].children[0].html,/shop-sold/);
  assert.equal(nodes['gem-shop-grid'].children[0].button,undefined);
  render([{kind:'relic',relicId:999,price:1,sold:false}]);
  assert.doesNotMatch(nodes['gem-shop-grid'].innerHTML,/data-shop-buy|undefined|NaN/);
});

test('商品十二件內隱藏捲軸，超過十二件才顯示並只補齊最後一列', () => {
  const { nodes, render }=renderer();
  const items=Array.from({length:13},()=>({kind:'rune',runeId:'r01',price:100,sold:false}));
  render(items.slice(0,12));assert.ok(!('data-scrollable-stock' in nodes['gem-shop-grid'].attrs));
  assert.equal((nodes['gem-shop-grid'].innerHTML.match(/class="shop-card/g)||[]).length,12);
  render(items);assert.ok('data-scrollable-stock' in nodes['gem-shop-grid'].attrs);
  assert.equal((nodes['gem-shop-grid'].innerHTML.match(/class="shop-card/g)||[]).length,16);
  render(items.slice(0,6));assert.ok(!('data-scrollable-stock' in nodes['gem-shop-grid'].attrs));
});

test('刷新提示將剩餘邀請券放在黃色第二行，餘量隨投影更新並保留零張', () => {
  const { ctx,nodes,render }=renderer();
  for(const tickets of [999,998,0]){
    render([],1e12,tickets);
    assert.equal(nodes['shop-refresh'].attrs['data-tt-desc'],ctx.STR(2446)+'<br><span class="merchant-ticket-remaining">神祕邀請券剩餘：'+tickets+'</span>');
  }
  assert.ok('data-merchant-unavailable' in nodes['shop-refresh'].attrs);
});

test('商人入口提示底部顯示黃色目前邀請券數量，零張／耗券及停用時持續更新', () => {
  const {ctx}=renderer(), source=fs.readFileSync(path.join(root,'js/ui.js'),'utf8');
  const attrs={'data-tt-title':ctx.STR(2435)};
  const anchor={setAttribute:(key,value)=>{attrs[key]=String(value);},getAttribute:key=>attrs[key]||null,closest:()=>null};
  const button={parentNode:anchor,classList:{toggle(){}},setAttribute(){}};
  const tip={style:{display:'block'},innerHTML:''},alert={hidden:true};
  let active=false;
  Object.assign(ctx,{$id:id=>({'mystery-merchant-open':button,'tower-merchant-alert':alert,'sk-tooltip':tip})[id],
    UI:{tooltipAnchor:anchor},viewState:()=>({towerActive:active}),
    document:{documentElement:{contains:()=>true}},setHtmlIfChanged:(node,html)=>{node.innerHTML=html;}});
  const body=name=>{const start=source.indexOf('function '+name+'(');return source.slice(start,source.indexOf('\n}',start)+2);};
  vm.runInContext(['updateMerchantEntry','statTooltipHTML','getAnchorRemainText','refreshOpenStatTooltip','refreshOpenResourceTooltip'].map(body).join('\n'),ctx);
  for(const [tickets,towerActive]of [[12345,false],[12344,false],[0,false],[5,true]]){
    active=towerActive;
    ctx.updateMerchantEntry({consumables:{mystery_invitation:tickets}});
    const desc=ctx.STR(tickets>0?2439:2437)+'<br><span class="merchant-ticket-remaining">當前擁有邀請券數量：'+tickets+'</span>';
    assert.equal(attrs['data-tt-desc'],desc);
    assert.ok(tip.innerHTML.includes(desc),'已開啟tips不必重新懸停即可更新');
    assert.equal(button.disabled,tickets<1||towerActive);
    assert.equal(alert.hidden,tickets<1);
  }
  ctx.updateMerchantEntry({});ctx.refreshOpenResourceTooltip();
  assert.ok(tip.innerHTML.includes('當前擁有邀請券數量：0'));
  const css=fs.readFileSync(path.join(root,'css/style.css'),'utf8');
  assert.match(css,/\.merchant-ticket-remaining\s*\{\s*color:\s*#ffd700;/);
});

test('等待購買回覆不重建商品卡且只停用該商品；售出只替換變動卡片', () => {
  const {ctx,nodes,render}=renderer(),items=[
    {kind:'rune',runeId:'r01',price:100,sold:false},{kind:'rune',runeId:'r02',price:200,sold:false}];
  render(items);const grid=nodes['gem-shop-grid'],before=grid.children.slice();
  ctx.isUiCommandPending=key=>key==='node:gem-shop'||key==='node:gem-shop-buy:0';
  render(items);
  assert.equal(grid.children[0].button.disabled,true);assert.equal(grid.children[1].button.disabled,false);
  assert.equal(grid.children[1].button.getAttribute('data-ui-pending-key'),'node:gem-shop-buy:1');
  grid.children.forEach((node,i)=>assert.equal(node,before[i]));
  ctx.isUiCommandPending=()=>false;render(items);
  grid.children.forEach((node,i)=>assert.equal(node,before[i]));assert.equal(grid.children[0].button.disabled,false);
  items[0].sold=true;render(items);
  assert.notEqual(grid.children[0],before[0]);
  grid.children.slice(1).forEach((node,i)=>assert.equal(node,before[i+1]));
  const sold=grid.children.slice();render(items,0);
  assert.equal(grid.children[1].button.disabled,true);grid.children.forEach((node,i)=>assert.equal(node,sold[i]));
  render(items);assert.equal(grid.children[1].button.disabled,false);grid.children.forEach((node,i)=>assert.equal(node,sold[i]));
});

test('刷新得到同名同價但不同實體的裝備時，更新對應卡片以避免沿用舊tips', () => {
  const {ctx,nodes,render}=renderer(),equipment=ctx.makeEquipment(1,{rarity:4});
  const items=[{kind:'equipment',equipment,price:100,sold:false},{kind:'rune',runeId:'r01',price:100,sold:false}];
  render(items);const before=nodes['gem-shop-grid'].children.slice();
  items[0].equipment={...equipment,id:equipment.id+'-restocked'};render(items);
  assert.notEqual(nodes['gem-shop-grid'].children[0],before[0]);
  assert.equal(nodes['gem-shop-grid'].children[1],before[1]);
});

test('一鍵購買僅顯示文字，tips總額隨售出變動並保留缺金與無券狀態', () => {
  const { ctx, nodes, render } = renderer();
  const items = [{kind:'rune', runeId:'r01', price:123, sold:false}, {kind:'rune', runeId:'r02', price:456, sold:false}];
  render(items);
  assert.equal(nodes['shop-buy-all'].textContent, ctx.STR(1514));
  assert.match(nodes['shop-buy-all'].attrs['data-tt-desc'], /<img src="images\/icon_gold.png"/);
  assert.match(nodes['shop-buy-all'].attrs['data-tt-desc'], />579<\/span>/);
  assert.doesNotMatch(nodes['shop-buy-all'].attrs['data-tt-desc'], /消耗|金幣/);
  items[0].sold = true;
  render(items, 0, 0, ctx.GEM_SHOP_MAX_LEVEL);
  assert.match(nodes['shop-buy-all'].attrs['data-tt-desc'], />456<\/span>/);
  for (const id of ['shop-buy-all', 'shop-refresh', 'shop-upgrade']) assert.ok('data-merchant-unavailable' in nodes[id].attrs);
  assert.match(nodes['gem-shop-grid'].innerHTML, /sold/);
  assert.ok(nodes['gem-shop-grid'].children.filter(n=>n.button).every(n=>n.button.disabled&&n.button.hasAttribute('data-merchant-unavailable')));
  assert.match(nodes['gem-shop-level'].innerHTML, /<br>/);
  items[1].sold = true;
  render(items);
  assert.match(nodes['shop-buy-all'].attrs['data-tt-desc'], />0<\/span>/);
});

test('饋贈以指定說明及金幣完整數字提示，等級變動更新費用，滿級清除費用', () => {
  const { ctx, nodes, render } = renderer();
  render([]);
  const button = nodes['shop-upgrade'];
  assert.equal(button.textContent, '饋贈');
  assert.equal(button.attrs['data-tt-title'], '饋贈');
  assert.equal(button.attrs['data-tt-desc'], ctx.STR(2573, ctx.merchantGoldPriceHTML(5000000, true)));
  assert.match(button.attrs['data-tt-desc'], /^贈與<img .*博取商人的好感，由此提升商店等級$/);
  assert.match(button.attrs['data-tt-desc'], /<img src="images\/icon_gold.png"/);
  assert.match(button.attrs['data-tt-desc'], />5,000,000<\/span>/);
  assert.match(button.attrs['data-tt-desc'], /<\/span><br>博取商人的好感/);
  render([], 1e12, 1, 2);
  assert.ok(button.attrs['data-tt-desc'].includes('>'+ctx.fmtFull(ctx.gemShopUpgradeCost(2))+'</span>'));
  render([], 1e12, 1, ctx.GEM_SHOP_MAX_LEVEL);
  assert.equal(button.textContent, ctx.STR(2504));
  assert.equal(button.attrs['data-tt-desc'], ctx.STR(2504));
  assert.doesNotMatch(button.attrs['data-tt-desc'], /<img/);
  assert.ok('data-merchant-unavailable' in button.attrs);
});

test('商人倒計時以投影截止時間顯示，包含整分鐘與到期邊界', () => {
  const { ctx } = renderer();
  const node = { textContent:'' };
  ctx.$id=id=>id==='merchant-countdown'?node:null;
  let now=ctx.Date.now();ctx.Date.now=()=>now;
  const source=fs.readFileSync(path.join(root,'js/ui.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('function renderMerchantCountdown('),source.indexOf('function renderTower()')),ctx);
  const merchant={active:true,expiresAt:now+600000};
  ctx.renderMerchantCountdown(merchant);assert.equal(node.textContent,ctx.STR(2571,'10:00'));
  now+=1000;ctx.renderMerchantCountdown(merchant);assert.equal(node.textContent,ctx.STR(2571,'09:59'));
  merchant.expiresAt=now+1;ctx.renderMerchantCountdown(merchant);assert.equal(node.textContent,ctx.STR(2571,'00:01'));
  now+=2;ctx.renderMerchantCountdown(merchant);assert.equal(node.textContent,ctx.STR(2571,'00:00'));
});

test('點擊商品收到正式滿包拒絕時在原按鈕上浮提示，不扣款；空出位置可正常購買', async () => {
  const { engine, ctx } = renderer();
  const source=fs.readFileSync(path.join(root,'js/ui.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('function uiCommandResultError('),source.indexOf('function requestUiPanels('))+
    source.slice(source.indexOf('function sendGemUiCommand('),source.indexOf('function runTalentUiAction(')),ctx);
  vm.runInContext('function clickMerchant(e) { '+source.slice(source.indexOf('// 寶石商店：單顆購買'),source.indexOf('// 符文鑲嵌（符文鑲嵌頁'))+' }',ctx);
  ctx.addMerchantInvitations(1);engine.cmd('merchant.open');
  const items=ctx.gemShop().items,index=items.findIndex(it=>it.kind==='equipment');assert.ok(index>=0);
  const g=engine.state(),cap=ctx.inventoryCapacityWithTalents();g.player.gold=1e12;g.inventory=Array(cap).fill({locked:true});
  const button={isConnected:true,getClientRects:()=>[{}],getAttribute:()=>String(index)};
  const floats=[],failures=[];let hidden=0;
  ctx.hideTooltip=()=>hidden++;ctx.showFloatingText=(target,text,color)=>floats.push({target,text,color});
  ctx.reportUiCommandFailure=(_title,error)=>failures.push(error);
  ctx.sendUiCommand=(name,args,options)=>{
    assert.equal(JSON.stringify(options.keys),JSON.stringify(['node:gem-shop','node:gem-shop-buy:'+index]));
    return Promise.resolve(engine.cmd(name,args).result);
  };
  const click=async()=>{ctx.clickMerchant({target:{closest:()=>button}});await new Promise(setImmediate);};
  const gold=g.player.gold;await click();
  assert.equal(failures[0],ctx.STR(2442));assert.equal(floats.length,1);assert.equal(floats[0].target,button);
  assert.equal(floats[0].text,'背包已滿');assert.equal(hidden,1);assert.equal(g.player.gold,gold);assert.equal(items[index].sold,false);
  ctx.isUiCommandPending=key=>key==='node:gem-shop';await click();
  assert.equal(failures.length,1);assert.equal(floats.length,1);
  ctx.isUiCommandPending=()=>false;
  g.inventory.pop();await click();
  assert.equal(floats.length,1);assert.equal(items[index].sold,true);assert.equal(g.inventory.length,cap);
  assert.equal(g.player.gold,gold-ctx.merchantItemPrice(items[index]));
  items[index].sold=false;g.inventory=[];g.player.gold=0;await click();
  assert.equal(floats.length,1);assert.equal(failures.length,2);assert.notEqual(failures[1],ctx.STR(2442));
});

test('滿包回覆晚到且按鈕已隱藏或移除時不在其他頁浮字，連線錯誤仍正常回報', async () => {
  const { ctx }=renderer(),source=fs.readFileSync(path.join(root,'js/ui.js'),'utf8');
  const floats=[],failures=[];ctx.hideTooltip=()=>{};ctx.showFloatingText=()=>floats.push(true);
  ctx.showMerchantPurchaseError({isConnected:false,getClientRects:()=>[{}]},ctx.STR(2442));
  ctx.showMerchantPurchaseError({isConnected:true,getClientRects:()=>[]},ctx.STR(2442));
  vm.runInContext(source.slice(source.indexOf('function uiCommandResultError('),source.indexOf('function requestUiPanels('))+
    source.slice(source.indexOf('function sendGemUiCommand('),source.indexOf('function runTalentUiAction(')),ctx);
  ctx.sendUiCommand=()=>Promise.reject(new Error('connection lost'));
  ctx.reportUiCommandFailure=(_title,error)=>failures.push(error);
  await ctx.sendGemUiCommand('gem.shopBuy',{index:0},'gem-shop',[],null,error=>ctx.showMerchantPurchaseError({isConnected:true,getClientRects:()=>[{}]},error));
  assert.equal(floats.length,0);assert.equal(failures.length,1);assert.equal(failures[0].message,'connection lost');
});
