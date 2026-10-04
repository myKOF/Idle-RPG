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
  Object.defineProperty(el,'innerHTML',{get:()=>html,set(value){html=value;el.holes=el.gems=null;
    const match=value.match(/<div class="equip-socket-page">([\s\S]*)<\/div><div class="equip-socket-gems">([\s\S]*)<\/div>$/);
    if(match){el.holes=section();el.holes.innerHTML=match[1];el.gems=section();el.gems.innerHTML=match[2];}
  }});
  el.querySelector=s=>s==='.equip-socket-page'?el.holes:s==='.equip-socket-gems'?el.gems:el.querySelectorAll(s)[0];
  el.querySelectorAll=s=>[...(el.holes?el.holes.querySelectorAll(s):[]),...(el.gems?el.gems.querySelectorAll(s):[])];
  return el;
}
function mount(){
  const elements=Object.fromEntries(['detail-pane','equip-action-bar','equip-material-panel'].map(id=>[id,{innerHTML:'',style:{},classList:{add(){},remove(){}}}]));
  elements['detail-pane']=pane();
  const c={console,document:{addEventListener(){},querySelectorAll(){return[];},getElementById(id){return elements[id]||null;}}};c.window=c;vm.createContext(c);
  for(const name of ['util','data','status','formula','item','ui'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),c);
  c.it={id:'gear',slot:'weapon',name:'劍',level:50,rarity:5,affixes:[{key:'str',roll:1}],sockets:[null,null,null,null],enchants:[{key:'fire',gemLv:1}],upgrade:0};
  c.findSelItem=()=>c.it;c.uiHeaderPanelSnapshot=()=>({player:{gold:1e12,scrap:1e12,essence:1e12}});c.uiInventoryPanelSnapshot=()=>null;
  c.uiGemsPanelSnapshot=()=>({gems:{ruby:{1:3,5:2},sapphire:{2:1}},fusedGems:[{id:'f',level:5,stats:[{type:'ruby',mult:1}],fusions:1}]});
  c.hideAffixPool=c.hideTooltip=c.updateSelectionUI=()=>{};c.UI.tab='equip';c.UI.sel={id:'gear',source:'equip'};c.pending=new Set();c.isUiCommandPending=k=>c.pending.has(k);
  c.commands=[];c.sendUiCommand=(name,args,opts)=>{c.commands.push({name,args:JSON.parse(JSON.stringify(args))});opts.keys.forEach(k=>c.pending.add(k));c.renderDetail();return new Promise(resolve=>c.finish=result=>{c.pending.clear();resolve(result);});};
  const start=ui.indexOf('    // 洗煉模式：點詞條'),end=ui.indexOf('    // 寶石融合 v2：',start);assert(start>=0&&end>start);
  vm.runInContext('function areaClick(e){'+ui.slice(start,end)+'}',c);
  c.click=attrs=>c.areaClick({target:{closest(selector){
    const match=selector.match(/\[data-([a-z-]+)(?:\]|=)/);
    if(match){const key=match[1];if(attrs[key]===undefined)return null;return {disabled:false,getAttribute:n=>attrs[n.replace('data-','')]};}
    if(selector.includes('.btn')&&attrs.act!==undefined)return {disabled:false,getAttribute:n=>n==='data-act'?attrs.act:null};
    return null;
  }}});c.elements=elements;c.renderDetail();return c;
}
test('鑲嵌頁僅孔及全部每階寶石，只有鑲嵌紅色且重按不退出',()=>{
  const c=mount();c.click({act:'toggle-socket'});
  const h=c.elements['detail-pane'].innerHTML,bar=c.elements['equip-action-bar'].innerHTML;
  assert.doesNotMatch(h,/it-title|it-affix|it-enchant/);assert.equal(c.elements['equip-material-panel'].innerHTML,'');
  assert.equal((h.match(/data-gem-level=/g)||[]).length,3);assert.match(h,/data-gem-socket-fused="f"/);
  assert.equal((bar.match(/btn-primary/g)||[]).length,1);assert.match(bar,/btn btn-primary" data-act="toggle-socket"/);
  const mode=c.UI.equipMatMode;c.click({act:'toggle-socket'});assert.equal(c.UI.equipMatMode,mode);assert.equal(c.commands.length,0);
});
test('選非第一孔及低階寶石，等待中鎖定；新快照才自動跳下一空孔',async()=>{
  const c=mount();c.click({act:'toggle-socket'});c.click({'socket-pick':'2'});assert.equal(c.commands.length,0);
  c.click({'gem-socket':'ruby','gem-level':'1'});assert.deepEqual(c.commands,[{name:'gem.socket',args:{itemId:'gear',type:'ruby',index:2,level:1}}]);
  c.click({'socket-pick':'0'});c.click({'gem-socket':'ruby','gem-level':'5'});assert.equal(c.UI.equipMatMode.selIdx,2);assert.equal(c.commands.length,1);
  c.finish(null);await Promise.resolve();assert.equal(c.UI.equipMatMode.selIdx,2);
  c.it.sockets[2]={type:'ruby',level:1};c.renderDetail();assert.equal(c.UI.equipMatMode.selIdx,3);
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
  assert.equal(c.elements['detail-pane'].querySelector('[data-gem-level="1"]').disabled,true);
  c.socketSelectedGem('ruby',1,null);assert.equal(c.commands.length,0);c.click({'socket-remove':'3'});
  assert.deepEqual(c.commands,[{name:'gem.unsocket',args:{itemId:'gear',index:3}}]);c.click({'socket-remove':'3'});assert.equal(c.commands.length,1);
});

test('選孔與相同快照重繪保留寶石節點、孔位節點及捲動',()=>{
  const c=mount();c.click({act:'toggle-socket'});const p=c.elements['detail-pane'];
  const gem=p.querySelector('[data-gem-level="1"]'),pick=p.holes.querySelector('[data-socket-pick="2"]');p.gems.scrollTop=90;
  c.click({'socket-pick':'2'});assert.equal(p.querySelector('[data-gem-level="1"]'),gem);assert.equal(p.holes.querySelector('[data-socket-pick="2"]'),pick);assert.equal(pick.getAttribute('aria-pressed'),'true');
  c.renderDetail();assert.equal(p.querySelector('[data-gem-level="1"]'),gem);assert.equal(p.holes.querySelector('[data-socket-pick="2"]'),pick);assert.equal(p.gems.scrollTop,90);
});

test('等待解除立即恢復孔位和寶石，已鑲孔仍禁止覆蓋',()=>{
  const c=mount();c.click({act:'toggle-socket'});const p=c.elements['detail-pane'],gem=p.querySelector('[data-gem-level="1"]');
  c.pending.add(c.itemPendingKey(c.it.id));c.syncEquipSocketPending();assert.equal(gem.disabled,true);assert.equal(p.holes.buttons[0].disabled,true);
  c.pending.clear();c.syncEquipSocketPending();assert.equal(gem.disabled,false);assert.equal(p.holes.buttons[0].disabled,false);
  c.it.sockets[0]={type:'ruby',level:1};c.syncEquipSocketPending();assert.equal(gem.disabled,true);
  c.it.sockets[0]=null;c.renderDetail();assert.equal(p.querySelector('[data-gem-level="1"]'),gem);assert.equal(gem.disabled,false);
});
