const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),ui=fs.readFileSync(path.join(root,'js/ui.js'),'utf8');
function classList() {
  const values=new Set();
  return {add(...names){names.forEach(n=>values.add(n));},remove(...names){names.forEach(n=>values.delete(n));},toggle(n,on){if(on)values.add(n);else values.delete(n);},contains:n=>values.has(n)};
}
// 鑲嵌元件使用的最小 DOM：innerHTML 更新會替換子按鈕，屬性更新保留其實例。
function section() {
  const el={scrollTop:0,buttons:[],getBoundingClientRect:()=>({top:0,bottom:200})};let html='';
  Object.defineProperty(el,'innerHTML',{get:()=>html,set(value){html=value;el.buttons=Array.from(value.matchAll(/<button\b([^>]*)>[\s\S]*?<\/button>/g),m=>{
    const attrs=Object.fromEntries(Array.from(m[1].matchAll(/([\w-]+)="([^"]*)"/g),a=>[a[1],a[2]]));
    const row={classList:classList(),getBoundingClientRect:()=>({top:10,bottom:40})};
    return {attrs,disabled:/\sdisabled\b/.test(m[1]),parentNode:row,getAttribute:n=>attrs[n]??null,setAttribute(n,v){attrs[n]=v;}};
  });}});
  el.querySelectorAll=selector=>el.buttons.filter(b=>Array.from(selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)).some(m=>b.attrs[m[1]]!==undefined&&(m[2]===undefined||b.attrs[m[1]]===m[2])));
  el.querySelector=selector=>selector==='.is-socket-selected'?el.buttons.find(b=>b.parentNode.classList.contains('is-socket-selected'))?.parentNode:el.querySelectorAll(selector)[0];
  return el;
}
function pane() {
  const el={style:{},classList:classList()};let html='';
  Object.defineProperty(el,'innerHTML',{get:()=>html,set(value){html=value;el.header=el.holes=el.gems=null;
    const match=value.match(/^<div class="equip-socket-header">([\s\S]*?)<\/div><div class="equip-socket-page">([\s\S]*)<\/div><div class="equip-socket-gems">([\s\S]*)<\/div>$/);
    if(match){el.header=section();el.header.innerHTML=match[1];el.holes=section();el.holes.innerHTML=match[2];el.gems=section();el.gems.innerHTML=match[3];}
  }});
  el.querySelector=s=>s==='.equip-socket-header'?el.header:s==='.equip-socket-page'?el.holes:s==='.equip-socket-gems'?el.gems:el.querySelectorAll(s)[0];
  el.querySelectorAll=s=>[...(el.holes?el.holes.querySelectorAll(s):[]),...(el.gems?el.gems.querySelectorAll(s):[])];
  return el;
}
function mount(){
  const elements=Object.fromEntries(['detail-pane','equip-action-bar','equip-material-panel'].map(id=>[id,{innerHTML:'',style:{},classList:{add(){},remove(){}}}]));
  elements['detail-pane']=pane();
  const c={console,document:{addEventListener(){},querySelectorAll(){return[];},getElementById(id){return elements[id]||null;}}};c.window=c;vm.createContext(c);
  for(const name of ['util','data','runeword_data','status','formula','item','runeword','ui','ui-runeword'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),c);
  c.it={id:'gear',slot:'weapon',name:'劍',level:50,rarity:5,affixes:[{key:'str',roll:1}],sockets:[null,null,null,null],enchants:[{key:'fire',gemLv:1}],runes:['r01',null,null,null],upgrade:0};
  c.findSelItem=()=>c.it;c.uiHeaderPanelSnapshot=()=>({player:{gold:1e12,scrap:1e12,essence:1e12}});c.uiInventoryPanelSnapshot=()=>null;
  c.uiGemsPanelSnapshot=()=>({gems:{ruby:{1:3,5:2},sapphire:{2:1}},fusedGems:[{id:'f',level:5,stats:[{type:'ruby',mult:1}],fusions:1}]});
  c.hideAffixPool=c.hideTooltip=c.updateSelectionUI=()=>{};c.UI.tab='equip';c.UI.sel={id:'gear',source:'equip'};c.pending=new Set();c.isUiCommandPending=k=>c.pending.has(k);
  c.commands=[];c.sendUiCommand=(name,args,opts)=>{c.commands.push({name,args:JSON.parse(JSON.stringify(args))});opts.keys.forEach(k=>c.pending.add(k));c.renderDetail();return new Promise(resolve=>c.finish=result=>{c.pending.clear();resolve(result);});};
  const start=ui.indexOf('    // 洗煉模式：點詞條'),end=ui.indexOf('    // 寶石融合 v2：',start);assert(start>=0&&end>start);
  vm.runInContext('function areaClick(e){'+ui.slice(start,end)+'}',c);
  const enchantStart=ui.indexOf("    var er = e.target.closest('[data-enchant-remove]');"),enchantEnd=ui.indexOf("    var tf = e.target.closest('[data-tower-floor]');",enchantStart);
  assert(enchantStart>=0&&enchantEnd>enchantStart);vm.runInContext('function enchantClick(e){'+ui.slice(enchantStart,enchantEnd)+'}',c);
  const runeStart=ui.indexOf('    // 符文鑲嵌（符文面板點符文圖示）'),runeEnd=ui.indexOf('    // 融合寶石鑲嵌',runeStart);
  assert(runeStart>=0&&runeEnd>runeStart);vm.runInContext('function runeClick(e){'+ui.slice(runeStart,runeEnd)+'}',c);
  c.click=attrs=>{const event={target:{closest(selector){
    const match=selector.match(/\[data-([a-z-]+)(?:\]|=)/);
    if(match){const key=match[1];if(attrs[key]===undefined)return null;return {disabled:false,getAttribute:n=>attrs[n.replace('data-','')]};}
    if(selector.includes('.btn')&&attrs.act!==undefined)return {disabled:false,getAttribute:n=>n==='data-act'?attrs.act:null};
    return null;
  }}};c.areaClick(event);c.runeClick(event);c.enchantClick(event);};c.elements=elements;c.renderDetail();return c;
}

test('一般詳情只展示寶石與符文孔（附魔已關閉不顯示），取下只能在對應功能頁且防止連送',()=>{
  const c=mount();c.it.sockets[0]={type:'ruby',level:5};c.renderDetail();
  const h=c.elements['detail-pane'].innerHTML;assert.match(h,/符文孔 1／4/);assert.match(h,/五級紅寶石/);assert.doesNotMatch(h,/it-enchant|data-socket-remove|data-enchant-remove|data-rune-remove|點擊取下/);
  c.click({'socket-remove':'0'});c.click({'rune-remove':'0'});assert.equal(c.commands.length,0);
  c.click({act:'toggle-socket'});c.click({'rune-remove':'0'});assert.equal(c.commands.length,0);
  c.click({'socket-remove':'0'});assert.equal(c.commands[0].name,'gem.unsocket');c.pending.clear();
  c.click({act:'toggle-rune'});assert.match(c.elements['detail-pane'].innerHTML,/data-rune-remove="0"/);assert.doesNotMatch(c.elements['detail-pane'].innerHTML,/data-socket-remove/);
  c.click({'socket-remove':'0'});assert.equal(c.commands.length,1);c.click({'rune-remove':'0'});assert.deepEqual(c.commands[1],{name:'rune.unsocket',args:{itemId:'gear',index:0}});
  c.click({'rune-remove':'0'});assert.equal(c.commands.length,2);c.pending.clear();
  c.UI.equipMatMode.itemId='other';c.click({'rune-remove':'0'});assert.equal(c.commands.length,2);
});
test('符文面板：取代附魔的位置，高階符文在前、點圖示鑲進第一個空孔、孔滿鎖定、沒有符文孔時說明原因',()=>{
  const c=mount(),stock={gems:{},fusedGems:[],runes:{r01:2,r10:3}};c.uiGemsPanelSnapshot=()=>stock;
  const bar=()=>c.elements['equip-action-bar'].innerHTML,panel=()=>c.elements['equip-material-panel'].innerHTML;
  assert.match(bar(),/data-act="toggle-rune"/);assert.doesNotMatch(bar(),/toggle-enchant|附魔/);assert.equal(panel(),'');
  c.click({act:'toggle-rune'});
  assert.match(bar(),/btn btn-primary" data-act="toggle-rune"/);
  assert.ok(panel().indexOf('data-rune-socket="r10"')>0&&panel().indexOf('data-rune-socket="r10"')<panel().indexOf('data-rune-socket="r01"'),'高階在前');
  assert.match(panel(),/符文孔 1／4/);assert.doesNotMatch(panel(),/data-book-enchant/);
  c.click({'rune-socket':'r10'});assert.deepEqual(c.commands[0],{name:'rune.socket',args:{itemId:'gear',runeId:'r10'}});c.pending.clear();
  c.it.runes=['r01','r02','r03','r04'];c.renderDetail();
  assert.match(panel(),/data-rune-socket="r10" disabled/);assert.match(panel(),/已滿/);
  c.it.rarity=0;c.it.runes=[];c.renderDetail();
  assert.match(panel(),/沒有符文孔/);assert.doesNotMatch(panel(),/data-rune-socket/);
  c.click({act:'toggle-rune'});assert.equal(panel(),'');
});
test('鑲嵌頁有標題、孔及每類最高級寶石與數量，只有鑲嵌紅色且重按不退出',()=>{
  const c=mount();c.click({act:'toggle-socket'});
  const h=c.elements['detail-pane'].innerHTML,bar=c.elements['equip-action-bar'].innerHTML;
  assert.match(h,/it-name/);assert.match(h,/it-sub/);assert.doesNotMatch(h,/it-affixes|it-enchant|data-rune-socket/);assert.equal(c.elements['equip-material-panel'].innerHTML,'');
  assert.equal((h.match(/data-gem-level=/g)||[]).length,2);assert.match(h,/data-gem-socket-fused="f"/);
  assert.doesNotMatch(h,/data-gem-level="1"/);assert.match(h,/socket-gem-count">×2/);assert.match(h,/socket-gem-count">×1/);
  assert.equal((bar.match(/btn-primary/g)||[]).length,1);assert.match(bar,/btn btn-primary" data-act="toggle-socket"/);
  const mode=c.UI.equipMatMode;c.click({act:'toggle-socket'});assert.equal(c.UI.equipMatMode,mode);assert.equal(c.commands.length,0);
});

test('標題即時更新強化、鎖定及評分，保留未變的孔與寶石節點',()=>{
  const c=mount();c.click({act:'toggle-socket'});const p=c.elements['detail-pane'];
  const header=p.header,holes=p.holes,gems=p.gems,gem=p.querySelector('[data-gem-level="5"]'),pick=p.holes.querySelector('[data-socket-pick="2"]');
  c.it.name='新裝備';c.it.upgrade=34;c.it.level=200;c.it.locked=true;c.renderDetail();
  assert.equal(p.header,header);assert.match(header.innerHTML,/新裝備/);assert.match(header.innerHTML,/it-up">\+34/);assert.match(header.innerHTML,/等級 200/);assert.match(header.innerHTML,/btn-it-lock locked/);
  assert.equal(p.holes,holes);assert.equal(p.gems,gems);assert.equal(p.querySelector('[data-gem-level="5"]'),gem);assert.equal(p.holes.querySelector('[data-socket-pick="2"]'),pick);
  const before=header.innerHTML;c.it.sockets[0]={type:'ruby',level:5};c.renderDetail();
  assert.notEqual(header.innerHTML,before);assert.match(header.innerHTML,new RegExp('評分 '+c.fmt(c.itemScore(c.it))));assert.equal(p.gems,gems);assert.equal(p.querySelector('[data-gem-level="5"]'),gem);
  c.it.sockets[0]=null;c.renderDetail();assert.equal(header.innerHTML,before);
});

test('跨面板先到的背包摘要等待完整詳情，不覆寫標題或孔位',()=>{
  const c=mount();c.click({act:'toggle-socket'});const p=c.elements['detail-pane'],header=p.header,holes=p.holes,html=header.innerHTML;
  const affixes=c.it.affixes,requests=[];c.requestPanelData=(...args)=>requests.push(JSON.parse(JSON.stringify(args)));
  delete c.it.affixes;c.renderDetail();assert.deepEqual(requests,[['inv',true,{detailIds:['gear']}]]);assert.equal(p.header,header);assert.equal(p.holes,holes);assert.equal(header.innerHTML,html);
  c.it.affixes=affixes;c.it.upgrade=5;c.renderDetail();assert.equal(p.header,header);assert.match(header.innerHTML,/it-up">\+5/);
});

test('最高級庫存耗盡後顯示下一持有級別與其數量；無庫存類型消失',async()=>{
  const c=mount(),stock={gems:{ruby:{1:9,5:1},sapphire:{2:7}},fusedGems:[]};c.uiGemsPanelSnapshot=()=>stock;c.click({act:'toggle-socket'});
  const p=c.elements['detail-pane'];assert.match(p.gems.innerHTML,/data-gem-socket="ruby" data-gem-level="5"/);assert.match(p.gems.innerHTML,/socket-gem-count">×7/);
  c.click({'gem-socket':'ruby','gem-level':'5'});assert.deepEqual(c.commands[0].args,{itemId:'gear',type:'ruby',index:0,level:5});
  stock.gems.ruby[5]=0;c.it.sockets[0]={type:'ruby',level:5};c.finish(null);await Promise.resolve();c.renderDetail();
  assert.match(p.gems.innerHTML,/data-gem-socket="ruby" data-gem-level="1"/);assert.match(p.gems.innerHTML,/socket-gem-count">×9/);assert.doesNotMatch(p.gems.innerHTML,/data-gem-level="5"/);assert.equal(c.UI.equipMatMode.selIdx,1);
  stock.gems.ruby[1]=0;c.renderDetail();assert.doesNotMatch(p.gems.innerHTML,/data-gem-socket="ruby"/);
  stock.gems.sapphire[2]=0;c.renderDetail();assert.match(p.gems.innerHTML,/尚無寶石庫存/);
});
test('選非第一孔及最高級寶石，等待中鎖定；新快照才自動跳下一空孔',async()=>{
  const c=mount();c.click({act:'toggle-socket'});c.click({'socket-pick':'2'});assert.equal(c.commands.length,0);
  c.click({'gem-socket':'ruby','gem-level':'5'});assert.deepEqual(c.commands,[{name:'gem.socket',args:{itemId:'gear',type:'ruby',index:2,level:5}}]);
  c.click({'socket-pick':'0'});c.click({'gem-socket':'ruby','gem-level':'5'});assert.equal(c.UI.equipMatMode.selIdx,2);assert.equal(c.commands.length,1);
  c.finish(null);await Promise.resolve();assert.equal(c.UI.equipMatMode.selIdx,2);
  c.it.sockets[2]={type:'ruby',level:5};c.renderDetail();assert.equal(c.UI.equipMatMode.selIdx,3);
  c.click({'socket-pick':'3'});c.socketSelectedGem(null,null,'f');assert.equal(c.commands[1].args.index,3);
  c.it.sockets[3]={fused:{id:'f',stats:[{type:'ruby',mult:1}]}};c.finish(null);await Promise.resolve();assert.equal(c.UI.equipMatMode.selIdx,0);
});
test('失敗不跳孔；晚到的成功回覆不影響新模式或新裝備',async()=>{
  const c=mount();c.click({act:'toggle-socket'});c.click({'socket-pick':'2'});c.socketSelectedGem('ruby',1,null);c.finish('沒有這種寶石');await Promise.resolve();assert.equal(c.UI.equipMatMode.selIdx,2);
  c.socketSelectedGem('ruby',1,null);c.click({act:'upgrade'});assert.equal(c.UI.equipMatMode,null);c.finish(null);await Promise.resolve();assert.equal(c.UI.equipMatMode,null);
  c.click({act:'toggle-socket'});c.socketSelectedGem('ruby',1,null);c.it.id='other';c.UI.sel.id='other';c.click({act:'toggle-socket'});const newMode=c.UI.equipMatMode;c.finish(null);await Promise.resolve();assert.equal(c.UI.equipMatMode,newMode);assert.equal(newMode.selIdx,0);
});
test('滿孔仍显示全部庫存及各孔卸下按钮，選已鑲孔不能鑲入',()=>{
  const c=mount();c.it.sockets=c.it.sockets.map(()=>({type:'ruby',level:1}));c.click({act:'toggle-socket'});
  assert.equal((c.elements['detail-pane'].innerHTML.match(/class="socket-remove"/g)||[]).length,4);
  assert.equal(c.elements['detail-pane'].querySelector('[data-gem-level="5"]').disabled,true);
  c.socketSelectedGem('ruby',1,null);assert.equal(c.commands.length,0);c.click({'socket-remove':'3'});
  assert.deepEqual(c.commands,[{name:'gem.unsocket',args:{itemId:'gear',index:3}}]);c.click({'socket-remove':'3'});assert.equal(c.commands.length,1);
});

test('選孔與相同快照重繪保留寶石節點、孔位節點及捲動',()=>{
  const c=mount();c.click({act:'toggle-socket'});const p=c.elements['detail-pane'];
  const gem=p.querySelector('[data-gem-level="5"]'),pick=p.holes.querySelector('[data-socket-pick="2"]');p.gems.scrollTop=90;
  c.click({'socket-pick':'2'});assert.equal(p.querySelector('[data-gem-level="5"]'),gem);assert.equal(p.holes.querySelector('[data-socket-pick="2"]'),pick);assert.equal(pick.getAttribute('aria-pressed'),'true');
  c.renderDetail();assert.equal(p.querySelector('[data-gem-level="5"]'),gem);assert.equal(p.holes.querySelector('[data-socket-pick="2"]'),pick);assert.equal(p.gems.scrollTop,90);
});

test('等待解除立即恢復孔位和寶石，已鑲孔仍禁止覆蓋',()=>{
  const c=mount();c.click({act:'toggle-socket'});const p=c.elements['detail-pane'],gem=p.querySelector('[data-gem-level="5"]');
  c.pending.add(c.itemPendingKey(c.it.id));c.syncEquipSocketPending();assert.equal(gem.disabled,true);assert.equal(p.holes.buttons[0].disabled,true);
  c.pending.clear();c.syncEquipSocketPending();assert.equal(gem.disabled,false);assert.equal(p.holes.buttons[0].disabled,false);
  c.it.sockets[0]={type:'ruby',level:1};c.syncEquipSocketPending();assert.equal(gem.disabled,true);
  c.it.sockets[0]=null;c.renderDetail();assert.equal(p.querySelector('[data-gem-level="5"]'),gem);assert.equal(gem.disabled,false);
});

test('相同可鑲狀態切孔不掃寶石或重寫未變aria，只更新新舊孔位',()=>{
  const c=mount();c.it.sockets[1]={type:'ruby',level:5};c.it.sockets[3]={type:'ruby',level:1};c.click({act:'toggle-socket'});
  const p=c.elements['detail-pane'],gems=p.gems,buttons=gems.buttons.slice();let queries=0,ariaWrites=0,renders=0;
  const query=gems.querySelectorAll;gems.querySelectorAll=s=>{queries++;return query(s);};
  p.holes.querySelectorAll('[data-socket-pick]').forEach(b=>{const set=b.setAttribute;b.setAttribute=(n,v)=>{if(n==='aria-pressed')ariaWrites++;set(n,v);};});
  const render=c.renderDetail;c.renderDetail=()=>{renders++;render();};
  c.click({'socket-pick':'2'});assert.equal(queries,0);assert.equal(ariaWrites,2);assert.equal(renders,0);assert.deepEqual(gems.buttons,buttons);
  c.click({'socket-pick':'2'});assert.equal(queries,0);assert.equal(ariaWrites,2);
  c.click({'socket-pick':'1'});assert.equal(queries,1);assert.ok(buttons.every(b=>b.disabled));
  c.click({'socket-pick':'3'});assert.equal(queries,1);assert.ok(buttons.every(b=>b.disabled));
  c.click({'socket-pick':'0'});assert.equal(queries,2);assert.ok(buttons.every(b=>!b.disabled));assert.equal(c.commands.length,0);
});

test('庫存清單替換後重新同步禁用，pending及換件仍正確',()=>{
  const c=mount(),stock={gems:{ruby:{5:2}},fusedGems:[]};c.uiGemsPanelSnapshot=()=>stock;c.it.sockets[0]={type:'ruby',level:5};c.click({act:'toggle-socket'});c.click({'socket-pick':'0'});
  const p=c.elements['detail-pane'],gems=p.gems,before=gems.buttons[0];assert.equal(before.disabled,true);
  stock.gems.ruby[5]=1;c.renderDetail();assert.equal(p.gems,gems);assert.notEqual(gems.buttons[0],before);assert.equal(gems.buttons[0].disabled,true);
  c.click({'socket-pick':'2'});assert.equal(gems.buttons[0].disabled,false);
  c.pending.add(c.itemPendingKey(c.it.id));c.syncEquipSocketPending();assert.equal(gems.buttons[0].disabled,true);
  stock.gems.sapphire={2:3};c.renderDetail();assert.ok(gems.buttons.every(b=>b.disabled));
  c.pending.clear();c.syncEquipSocketPending();assert.ok(gems.buttons.every(b=>!b.disabled));
  c.it.id='other';c.UI.sel.id='other';c.click({act:'toggle-socket'});assert.notEqual(p.gems,gems);assert.ok(p.gems.buttons.every(b=>!b.disabled));
  c.click({'socket-pick':'0'});assert.ok(p.gems.buttons.every(b=>b.disabled));
});
