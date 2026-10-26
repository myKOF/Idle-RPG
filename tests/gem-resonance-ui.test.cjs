'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ui(gems={diamond:{3:8,4:2,7:1},ruby:{10:3}}){
 const c=vm.createContext({console,Math,Date,JSON,Number,Map,Set});c.window=c;
 c.UI={gemBrowse:{tool:'resonance',filter:'atk',ownedOnly:true,resHole:[1,1],sel:'diamond',fuseLv:4},dirty:{}};
 for(const p of ['js/util.js', 'js/strings_data.js', 'js/strings.js','js/data.js','js/status.js','js/gem_resonance_data.js','js/formula.js','js/item.js','js/gem_resonance.js'])vm.runInContext(read(p),c,{filename:p});
 c.G={player:{gold:1e12,level:1,reincarnations:4,gems,resonance:{holes:{}}}};c.markStatsDirty=()=>{};
 c.esc=String;c.fmt=String;c.fmtFull=String;c.pctStr=String;
 const source=read('js/ui.js');
 vm.runInContext(source.match(/var GEM_TIER_COLORS = \{[\s\S]*?\n\};/)[0],c);
 for(const name of ['gemsViewCount','gemsViewFused','gemAbilityText']){
  const fn=source.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));assert.ok(fn,name);vm.runInContext(fn[0],c);
 }
 // 使用正式 renderGems／類型列／十階列，只有無關的工坊面板採空實作。
 vm.runInContext(source.slice(source.indexOf('var GEM_LIB_FILTERS ='),source.indexOf('function gemAbilityText(')),c);
 for(const name of ['fillGemTypeSelect','renderFuseInfo','renderGemConvert','renderGemDismantle','renderGemFusion','renderGemShop'])c[name]=()=>{};
 const nodes={};function element(attrs={}){return {attrs,innerHTML:'',handlers:{},addEventListener(k,f){this.handlers[k]=f;},getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;},closest(k){const key=k.slice(1,-1);return this.attrs[key]!==undefined?this:null;},classList:{add(){},remove(){}},querySelector(){return null;},querySelectorAll(){return [];},contains(){return true;}};}
 const documentEvents={};c.document={addEventListener(k,f){documentEvents[k]=f;}};
 for(const id of ['gres-board','gres-detail','gres-total','gres-help','gem-table','gres-library-note','gem-focus','gem-filter','gem-owned-only','tab-gems','gem-total','gem-kinds'])nodes[id]=element();
 c.$id=id=>nodes[id]||null;c.uiGemsPanelSnapshot=()=>({gems:c.G.player.gems,resonance:c.G.player.resonance});
 c.resolveGemsPanelSnapshot=s=>s||c.uiGemsPanelSnapshot();c.uiHeaderPanelSnapshot=()=>({player:c.G.player});
 c.setTextIfChanged=(n,t)=>{if(n)n.textContent=t;};
 const render=c.renderGems;c.renders=0;c.renderGems=()=>{c.renders++;render();};
 c.calls=[];c.sendGemUiCommand=(name,args)=>{c.calls.push({name,args});let error;if(name==='gem.resonanceSocket')error=c.socketResonanceGem(args.region,args.hole,args.type,args.level);if(name==='gem.resonanceUnsocket')error=c.unsocketResonanceGem(args.region,args.hole,args.index);if(name==='gem.resonanceUpgrade')error=c.upgradeResonanceHole(args.region,args.hole);assert.equal(error,null);c.renderGems();};
 vm.runInContext(read('js/ui-gem-resonance.js'),c);c.initGemResonanceUi();c.renderGems();return {c,nodes,element,documentEvents};
}
function tier(nodes,level){const tag=nodes['gem-focus'].innerHTML.match(new RegExp('<button[^>]*data-gem-lv="'+level+'"[^>]*>'));assert.ok(tag,'tier '+level);return tag[0];}
function drag(f,type='diamond',level=4){const transfer={setData(){},dropEffect:''};let prevented=false;f.nodes['gem-focus'].handlers.dragstart({target:f.element({'data-gres-gem':type+':'+level}),dataTransfer:transfer,preventDefault(){prevented=true;}});return {transfer,prevented};}
function drop(f,hole){f.nodes['gres-board'].handlers.drop({target:f.element({'data-gres-hole':hole}),preventDefault(){}});}
function maxOuter(c){for(let r=0;r<6;r++)for(let h=0;h<7;h++){const key=r+':'+h;c.G.player.resonance.holes[key]={...c.G.player.resonance.holes[key],lv:10,gems:c.G.player.resonance.holes[key]?.gems||[]};}}

test('左側每種寶石只列一列且只切類型；上方保留十階與各階庫存',()=>{
 const {c,nodes}=ui();const html=nodes['gem-table'].innerHTML;
 assert.equal((html.match(/data-gem-pick="diamond"/g)||[]).length,1);
 assert.doesNotMatch(html,/data-gem-pick="ruby"|data-gres-gem|draggable="true"/);
 assert.equal(nodes['gem-table'].handlers.click,undefined);assert.equal(nodes['gem-table'].handlers.dragstart,undefined);
 c.selectGemType('diamond');assert.equal(c.calls.length,0);assert.equal(c.G.player.gems.diamond[4],2);
 assert.equal((nodes['gem-focus'].innerHTML.match(/data-gem-lv=/g)||[]).length,10);
 assert.match(tier(nodes,4),/data-gres-gem="diamond:4" draggable="true"/);
 const detail=c.gresDetailHTML(c.uiGemsPanelSnapshot(),c.uiHeaderPanelSnapshot(),c.G.player.resonance,[1,1]);
 assert.doesNotMatch(detail,/gres-pool|data-gres-put|gres-library-hint/);assert.match(detail,/防禦型4級以上寶石/);
});

test('不符最低階／缺庫存／滿孔在十階列禁用，類型列不因階級拆列或滿孔消失',()=>{
 const {c,nodes}=ui();assert.match(tier(nodes,3),/is-unavailable/);assert.match(tier(nodes,3),/ disabled/);assert.match(tier(nodes,3),/draggable="false"/);
 assert.match(tier(nodes,5),/ disabled/);assert.doesNotMatch(tier(nodes,4),/ disabled/);assert.doesNotMatch(tier(nodes,7),/ disabled/);
 c.G.player.resonance.holes['1:1']={gems:[{type:'diamond',level:4}],lv:0};c.renderGems();
 assert.equal((nodes['gem-focus'].innerHTML.match(/ disabled/g)||[]).length,10);assert.match(nodes['gem-table'].innerHTML,/data-gem-pick="diamond"/);
 c.G.player.resonance.holes={};c.G.player.gems.diamond={3:8};c.renderGems();
 assert.match(nodes['gem-table'].innerHTML,/data-gem-pick="diamond"/);assert.equal((nodes['gem-focus'].innerHTML.match(/ disabled/g)||[]).length,10);
});

test('選孔切換可鑲類型並重設共鳴分類；一般分類偏好獨立保留',()=>{
 const {c,nodes}=ui();c.UI.gemBrowse.resFilter='atk';c.gresSelectHole(1,1);
 assert.equal(c.UI.gemBrowse.resFilter,'all');assert.equal(c.UI.gemBrowse.filter,'atk');assert.match(nodes['gem-table'].innerHTML,/data-gem-pick="diamond"/);
 c.gresSelectHole(5,1);assert.equal(c.UI.gemBrowse.sel,'ruby');assert.match(nodes['gem-table'].innerHTML,/data-gem-pick="ruby"/);assert.doesNotMatch(nodes['gem-table'].innerHTML,/data-gem-pick="diamond"/);
 c.GEM_TYPES.ruby.enabled=false;c.renderGems();assert.doesNotMatch(nodes['gem-table'].innerHTML,/data-gem-pick=/);
 assert.equal((nodes['gem-focus'].innerHTML.match(/data-gem-lv=/g)||[]).length,10);assert.equal((nodes['gem-focus'].innerHTML.match(/ disabled/g)||[]).length,10);
});

test('只看持有可切換，空分類仍保留十階佔位，不會暴露不符孔位的類型',()=>{
 const {c,nodes}=ui({});assert.doesNotMatch(nodes['gem-table'].innerHTML,/data-gem-pick=/);assert.match(nodes['gem-focus'].innerHTML,/沒有符合的寶石/);
 c.UI.gemBrowse.ownedOnly=false;c.renderGems();assert.match(nodes['gem-table'].innerHTML,/data-gem-pick="diamond"/);assert.doesNotMatch(nodes['gem-table'].innerHTML,/data-gem-pick="ruby"/);
 c.UI.gemBrowse.resFilter='atk';c.renderGems();assert.doesNotMatch(nodes['gem-table'].innerHTML,/data-gem-pick=/);assert.equal((nodes['gem-focus'].innerHTML.match(/data-gem-lv=/g)||[]).length,10);
});

test('上方點擊走正式鑲嵌／取下規則，失效階級與滿孔不重送',()=>{
 const {c,nodes,element}=ui();const click=level=>nodes['gem-focus'].handlers.click({target:element({'data-gres-gem':'diamond:'+level})});
 click(3);click(5);assert.equal(c.calls.length,0);
 click(4);assert.equal(c.calls.length,1);assert.equal(c.G.player.gems.diamond[4],1);assert.equal(c.G.player.resonance.holes['1:1'].gems[0].level,4);
 click(4);assert.equal(c.calls.length,1);assert.match(tier(nodes,4),/ disabled/);
 nodes['gres-detail'].handlers.click({target:element({'data-gres-take':'0'})});assert.equal(c.G.player.gems.diamond[4],2);assert.doesNotMatch(tier(nodes,4),/ disabled/);
});

test('上方原生拖曳保留來源DOM，驗證目標種類／最低階並拒絕外部拖曳',()=>{
 const f=ui({sapphire:{4:2},ruby:{4:2}}),{c,nodes}=f;c.gresSelectHole(0,1);
 const start=drag(f,'sapphire');assert.equal(start.prevented,false);const original=nodes['gem-focus'].innerHTML;
 c.G.player.gems.sapphire[4]=3;c.renderGems();assert.equal(nodes['gem-focus'].innerHTML,original);
 let accepted=false;nodes['gres-board'].handlers.dragover({target:f.element({'data-gres-hole':'5:1'}),dataTransfer:start.transfer,preventDefault(){accepted=true;}});assert.equal(accepted,false);
 drop(f,'5:1');assert.equal(c.calls.length,0);
 drag(f,'sapphire');drop(f,'0:2');assert.equal(c.calls.length,1);assert.equal(c.calls[0].args.hole,2);assert.equal(c.G.player.gems.sapphire[4],2);
 assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[0,2]);assert.equal(c.UI.gemBrowse.resDrag,null);
 drop(f,'0:1');assert.equal(c.calls.length,1);
 c.gresSelectHole(0,1);drag(f,'sapphire');drop(f,'0:0');assert.equal(c.calls.length,1);
});

test('拖曳後庫存失效或目標滿孔，放開重新驗證；BOSS鎖與無效來源不啟動拖曳',()=>{
 const f=ui(),{c}=f;assert.equal(drag(f,'diamond',3).prevented,true);assert.equal(c.UI.gemBrowse.resDrag,undefined);
 drag(f);c.G.player.gems.diamond[4]=0;drop(f,'1:2');assert.equal(c.calls.length,0);
 c.G.player.gems.diamond[4]=2;drag(f);c.G.player.resonance.holes['1:2']={lv:2,gems:[{type:'diamond',level:4}]};drop(f,'1:2');assert.equal(c.calls.length,0);assert.equal(c.G.player.resonance.holes['1:2'].lv,2);
 c.bossFightConfigLocked=()=>true;assert.equal(drag(f).prevented,true);assert.equal(c.UI.gemBrowse.resDrag,null);
});

test('切回合成只選階級、不鑲嵌，並取消殘留拖曳與共鳴置灰狀態',()=>{
 const f=ui(),{c,nodes,element}=f;drag(f);c.setGemTool('compose');assert.equal(c.UI.gemBrowse.resDrag,null);
 assert.doesNotMatch(nodes['gem-focus'].innerHTML,/data-gres-gem|is-unavailable| disabled/);
 assert.equal((nodes['gem-focus'].innerHTML.match(/data-gem-lv=/g)||[]).length,10);
 nodes['gem-focus'].handlers.click({target:element({'data-gres-gem':'diamond:4'})});assert.equal(c.calls.length,0);
 c.setGemFuseLevel(2);assert.equal(c.UI.gemBrowse.fuseLv,2);assert.equal(c.calls.length,0);assert.equal(c.UI.gemBrowse.filter,'atk');
 drop(f,'1:2');assert.equal(c.calls.length,0);
});

test('左鍵按下即選孔，放開click不重選；右鍵／非主要指標不選孔，鍵盤與輔助click保留',()=>{
 const {c,nodes,element}=ui();const board=nodes['gres-board'];
 const target=element({'data-gres-hole':'0:2'});
 board.handlers.pointerdown({target,button:2,isPrimary:true});assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[1,1]);
 board.handlers.pointerdown({target,button:0,isPrimary:false});assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[1,1]);
 board.handlers.pointerdown({target,button:0,isPrimary:true});assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[0,2]);assert.equal(c.calls.length,0);
 const renders=c.renders;board.handlers.click({target,detail:1});assert.equal(c.renders,renders);
 let prevented=false;board.handlers.keydown({target:element({'data-gres-hole':'5:3'}),key:' ',preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[5,3]);
 board.handlers.keydown({target,key:'Enter',preventDefault(){}});assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[0,2]);
 board.handlers.click({target:element({'data-gres-hole':'6:0'}),detail:0});assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[6,0]);assert.equal(c.calls.length,0);
});

test('兩顆與六顆真實鑲入後每顆都顯示，取下後保留其餘寶石且不顯示數量',()=>{
 const {c,nodes,element}=ui({sapphire:{6:2},ruby:{10:6}});
 const put=key=>nodes['gem-focus'].handlers.click({target:element({'data-gres-gem':key})});
 const partCount=(r,h)=>{const html=c.gresHoleGemsHTML(c.gresHoleCenter(r,h),c.G.player.resonance.holes[r+':'+h].gems,r,h);return (html.match(/class="gres-gem-part"/g)||[]).length;};
 c.gresSelectHole(0,0);put('sapphire:6');assert.equal(partCount(0,0),0);
 put('sapphire:6');assert.equal(partCount(0,0),2);assert.equal(c.G.player.gems.sapphire[6],0);
 assert.doesNotMatch(nodes['gres-board'].innerHTML,/gres-cap/);
 maxOuter(c);c.gresSelectHole(6,0);
 for(let i=1;i<=6;i++){
  put('ruby:10');const state=c.G.player.resonance.holes['6:0'];assert.equal(state.gems.length,i);
  assert.equal(partCount(6,0),i===1?0:i);
  const art=c.gresHoleGemsHTML(c.gresHoleCenter(6,0),state.gems,6,0);assert.equal((art.match(/<image /g)||[]).length,i);
 }
 assert.equal(c.G.player.gems.ruby[10],0);assert.doesNotMatch(nodes['gres-board'].innerHTML,/gres-cap/);
 assert.equal((nodes['gres-board'].innerHTML.match(/data-gres-hole=/g)||[]).length,49);
 nodes['gres-detail'].handlers.click({target:element({'data-gres-take':'2'})});assert.equal(c.G.player.gems.ruby[10],1);assert.equal(partCount(6,0),5);
 c.gresSelectHole(0,0);nodes['gres-detail'].handlers.click({target:element({'data-gres-take':'0'})});assert.equal(c.G.player.gems.sapphire[6],1);assert.equal(partCount(0,0),0);
 const gems=[{type:'ruby',level:10},{type:'sapphire',level:9},{type:'diamond',level:8}];
 const art=c.gresHoleGemsHTML({x:0,y:0},gems,6,0);for(const gem of gems)assert.ok(art.includes(c.gemIconSrc(gem.type,gem.level)));
});

test('拖曳方框只有來源寶石圖、維持方形及中心熱點，成功／拒絕／取消均清理',()=>{
 const f=ui(),{c,nodes,element}=f,attached=[];let hidden=0;c.hideTooltip=()=>hidden++;
 c.document={createElement(tag){return {tagName:tag.toUpperCase(),style:{},children:[],setAttribute(){},appendChild(n){this.children.push(n);},remove(){this.removed=true;}};},body:{appendChild(n){attached.push(n);}}};
 const image={tagName:'IMG',src:c.gemIconSrc('diamond',4),style:{}};
 const icon={getBoundingClientRect(){return {left:23,top:61,width:32,height:28};},cloneNode(deep){assert.equal(deep,false);return {...image,style:{}};}};
 function start(level=4){
  const source=element({'data-gres-gem':'diamond:'+level});source.querySelector=s=>{assert.equal(s,'img.gem-ico');return icon;};
  const transfer={setData(k,v){this.payload=JSON.parse(v);},setDragImage(node,x,y){this.image=node;this.hotspot=[x,y];}};
  nodes['gem-focus'].handlers.dragstart({target:source,dataTransfer:transfer,preventDefault(){transfer.prevented=true;}});return transfer;
 }
 const first=start();assert.deepEqual(first.payload,{type:'diamond',level:4});assert.deepEqual(first.hotspot,[16,16]);
 assert.equal(first.image.children.length,1);assert.equal(first.image.children[0].tagName,'IMG');assert.equal(first.image.children[0].src,image.src);
 assert.match(first.image.style.cssText,/width:32px;height:32px/);assert.equal(first.image.className,'gres-drag-icon');assert.ok(first.image.style.cssText.includes('--c:'+c.GEM_TIER_COLORS[4]));assert.equal(hidden,1);
 const second=start();assert.equal(first.image.removed,true);assert.equal(second.image.removed,undefined);
 drop(f,'1:2');assert.equal(second.image.removed,true);assert.equal(c.calls.length,1);assert.equal(c.G.player.resonance.holes['1:2'].gems[0].type,'diamond');
 c.gresSelectHole(1,1);
 const invalidTarget=start();drop(f,'5:1');assert.equal(invalidTarget.image.removed,true);assert.equal(c.calls.length,1);
 const cancelled=start();nodes['gem-focus'].handlers.dragend();assert.equal(cancelled.image.removed,true);
 const created=attached.length;const invalidSource=start(3);assert.equal(invalidSource.prevented,true);assert.equal(attached.length,created);
 c.bossFightConfigLocked=()=>true;assert.equal(start().prevented,true);assert.equal(attached.length,created);assert.ok(attached.every(n=>n.removed));
});

test('共鳴拖過空白／拒絕孔仍顯示移動游標，僅有效孔位可鑲入；不攔截外部拖曳',()=>{
 const f=ui(),{c,nodes,element,documentEvents}=f;
 const outside=element();
 function over(target){let prevented=false;const transfer={dropEffect:'none'};const e={target,dataTransfer:transfer,preventDefault(){prevented=true;}};documentEvents.dragenter(e);nodes['gres-board'].handlers.dragover(e);documentEvents.dragover(e);return {prevented,effect:transfer.dropEffect};}
 assert.deepEqual(over(outside),{prevented:false,effect:'none'});
 drag(f);assert.deepEqual(over(outside),{prevented:true,effect:'move'});
 const wrongHole=element({'data-gres-hole':'5:1'});assert.deepEqual(over(wrongHole),{prevented:true,effect:'move'});
 drop(f,'5:1');assert.equal(c.calls.length,0);assert.equal(c.UI.gemBrowse.resDrag,null);
 drag(f);assert.deepEqual(over(element({'data-gres-hole':'1:2'})),{prevented:true,effect:'move'});
 drop(f,'1:2');assert.equal(c.calls.length,1);assert.equal(c.G.player.gems.diamond[4],1);
 let prevented=false;documentEvents.drop({target:outside,preventDefault(){prevented=true;}});assert.equal(prevented,false);
 c.gresSelectHole(1,1);drag(f);const before=c.G.player.gems.diamond[4];documentEvents.drop({target:outside,preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(c.UI.gemBrowse.resDrag,null);assert.equal(c.calls.length,1);assert.equal(c.G.player.gems.diamond[4],before);
 assert.deepEqual(over(outside),{prevented:false,effect:'none'});
});

test('選孔僅加亮所選區7孔，切區／同區換孔／鍵盤／拖曳皆跟隨同一選孔與篩選狀態',()=>{
 const {c,nodes,element}=ui({sapphire:{6:3},diamond:{6:3},ruby:{10:3}});
 maxOuter(c);c.renderGems();
 function check(region,hole){
  const tags=nodes['gres-board'].innerHTML.match(/<g class="gres-hole[^>]+>/g);assert.equal(tags.length,49);
  const active=tags.filter(t=>t.includes(' is-region-active'));assert.equal(active.length,7);
  for(let h=0;h<7;h++)assert.ok(active.some(t=>t.includes('data-gres-hole="'+region+':'+h+'"')));
  const selected=tags.filter(t=>t.includes(' is-sel'));assert.equal(selected.length,1);assert.ok(selected[0].includes('data-gres-hole="'+region+':'+hole+'"'));
 }
 for(let r=0;r<7;r++){
  nodes['gres-board'].handlers.pointerdown({target:element({'data-gres-hole':r+':1'}),button:0,isPrimary:true});check(r,1);
  c.gresSelectHole(r,0);check(r,0);
  for(const key of nodes['gem-table'].innerHTML.matchAll(/data-gem-pick="([^"]+)"/g))assert.equal(c.resonanceTypeAllowed(r,key[1]),true);
 }
 c.G.player.resonance.holes['0:0']={lv:1,gems:[{type:'sapphire',level:6},{type:'sapphire',level:6}]};
 c.gresSelectHole(0,0);check(0,0);assert.equal((nodes['gem-focus'].innerHTML.match(/ disabled/g)||[]).length,10);
 c.gresSelectHole(1,1);drag({c,nodes,element},'diamond',6);drop({c,nodes,element},'6:1');assert.equal(c.calls.length,0);check(1,1);
 nodes['gres-board'].handlers.keydown({target:element({'data-gres-hole':'0:2'}),key:'Enter',preventDefault(){}});check(0,2);
 drag({c,nodes,element},'sapphire',6);drop({c,nodes,element},'0:3');check(0,3);assert.equal(c.calls.length,1);
});

test('孔內只畫非零強化數字，最低階不再畫出；中央鎖定UI拒絕鑲入／拖放／升級，解鎖後恢復',()=>{
 const f=ui({ruby:{1:20,10:10},sapphire:{6:4}}),{c,nodes,element}=f;
 assert.doesNotMatch(nodes['gres-board'].innerHTML,/<text|gres-min|>Lv/);
 c.G.player.resonance.holes['0:2']={gems:[],lv:4};
 c.G.player.resonance.holes['0:0']={gems:[{type:'sapphire',level:6}],lv:2};c.renderGems();
 const numbers=[...nodes['gres-board'].innerHTML.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map(m=>m[1]);assert.deepEqual(numbers,['2','4']);
 c.gresSelectHole(6,0);
 assert.equal((nodes['gres-board'].innerHTML.match(/class="gres-hole[^\"]* is-locked/g)||[]).length,7);
 assert.equal((nodes['gem-focus'].innerHTML.match(/ disabled/g)||[]).length,10);
 assert.match(nodes['gres-detail'].innerHTML,/外圍六區.*全部鑲孔.*10/);assert.match(nodes['gres-detail'].innerHTML,/data-gres-upgrade="1" disabled/);
 nodes['gem-focus'].handlers.click({target:element({'data-gres-gem':'ruby:10'})});
 nodes['gres-detail'].handlers.click({target:element({'data-gres-upgrade':'1'})});assert.equal(c.calls.length,0);assert.equal(drag(f,'ruby',10).prevented,true);
 c.gresSelectHole(5,1);drag(f,'ruby',10);drop(f,'6:1');assert.equal(c.calls.length,0);assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[5,1]);
 maxOuter(c);c.G.player.resonance.holes['5:6'].lv=9;c.gresSelectHole(6,0);assert.match(nodes['gres-detail'].innerHTML,/data-gres-upgrade="1" disabled/);
 c.G.player.resonance.holes['5:6'].lv=10;c.renderGems();assert.doesNotMatch(nodes['gres-board'].innerHTML,/ is-locked/);
 assert.doesNotMatch(tier(nodes,10),/ disabled/);assert.doesNotMatch(nodes['gres-detail'].innerHTML,/data-gres-upgrade="1" disabled/);
 nodes['gem-focus'].handlers.click({target:element({'data-gres-gem':'ruby:10'})});assert.equal(c.calls.length,1);
 nodes['gres-detail'].handlers.click({target:element({'data-gres-upgrade':'1'})});assert.equal(c.calls.length,2);assert.equal(c.G.player.resonance.holes['6:0'].lv,1);
 assert.match(nodes['gres-board'].innerHTML,/<text[^>]*class="gres-lv"[^>]*>1<\/text>/);assert.doesNotMatch(nodes['gres-board'].innerHTML,/>Lv|gres-min/);
});

test('精簡資訊仍提供正確費用Tooltip、禁用／滿級／鎖定原因及逐顆取下，鍵盤可查看費用',()=>{
 const {c,nodes,element}=ui({diamond:{1:10,6:2}});c.gresSelectHole(1,0);
 const detail=()=>nodes['gres-detail'].innerHTML;
 assert.match(detail(),/防禦型6級以上寶石/);assert.match(detail(),/等級 Lv\.0/);assert.match(detail(),/獲得相鄰寶石能力\+0%/);
 assert.equal((detail().match(/>鑲孔<\/div>/g)||[]).length,2);
 assert.doesNotMatch(detail(),/gres-sub|gres-cost|gres-lvrow|gres-library-hint|gres-lock-note|外圈孔|容量|共鳴總加成/);
 assert.match(detail(),/data-tt-title="升級鑲孔"/);assert.match(detail(),/金幣：5000/);assert.match(detail(),/材料：一級鑽石 ×3/);
 assert.doesNotMatch(detail(),/data-gres-upgrade="1" disabled/);
 nodes['gem-focus'].handlers.click({target:element({'data-gres-gem':'diamond:6'})});
 assert.match(detail(),/aria-label="六級鑽石，點擊取下"/);
 assert.match(detail(),/<span class="gres-gem-name">六級鑽石<\/span>/);
 assert.ok(detail().includes('<span class="gres-gem-stat">'+c.gresStatText('diamond',c.gemStatValue('diamond',6))+'</span>'));
 nodes['gres-detail'].handlers.click({target:element({'data-gres-take':'0'})});assert.equal(c.G.player.gems.diamond[6],2);
 c.G.player.gold=0;c.renderGems();assert.match(detail(),/金幣：5000（持有 0）/);assert.match(detail(),/金幣或材料不足/);assert.match(detail(),/data-gres-upgrade="1" disabled/);
 let shown,hidden=0;c.showStatTooltip=(...args)=>shown=args;c.hideTooltip=()=>hidden++;
 const tip=element({'data-gres-upgrade-tip':'1','data-tt-title':'升級鑲孔','data-tt-desc':'金幣：5000'});
 nodes['gres-detail'].handlers.focusin({target:tip});assert.equal(shown[0],'升級鑲孔');assert.equal(shown[1],'金幣：5000');nodes['gres-detail'].handlers.focusout({target:tip});assert.equal(hidden,1);
 c.G.player.resonance.holes['1:0']={lv:10,gems:[]};c.renderGems();assert.match(detail(),/已達強化等級上限/);assert.match(detail(),/data-gres-upgrade="1" disabled/);
 c.gresSelectHole(6,0);assert.match(detail(),/外圍六區.*全部鑲孔.*10/);assert.match(detail(),/獲得相鄰寶石能力\+0%/);assert.match(detail(),/data-gres-upgrade="1" disabled/);
 assert.equal(nodes['gres-total'].innerHTML,'<div class="sec-sub">共鳴效果：</div><div class="gres-list"></div>');
});

test('右側共鳴效果只合計所選孔的額外相鄰能力；空孔／0級／取下無效果，插入與升級即刷新',()=>{
 const {c,nodes,element}=ui({diamond:{1:100,2:100,4:2,6:3},ruby:{4:1}});
 const holes=c.G.player.resonance.holes;
 holes['1:0']={lv:0,gems:[{type:'diamond',level:6},{type:'diamond',level:6}]};
 holes['1:2']={lv:0,gems:[{type:'diamond',level:4}]};
 holes['1:4']={lv:0,gems:[{type:'moonstone',level:5}]}; // 與孔1不相鄰
 holes['5:6']={lv:10,gems:[{type:'ruby',level:4}]}; // 其他區
 holes['1:1']={lv:1,gems:[]};c.gresSelectHole(1,1);
 const empty='<div class="sec-sub">共鳴效果：</div><div class="gres-list"></div>';
 assert.equal(nodes['gres-total'].innerHTML,empty);assert.match(nodes['gres-detail'].innerHTML,/能力\+0%/);
 const put=()=>nodes['gem-focus'].handlers.click({target:element({'data-gres-gem':'diamond:4'})});
 put();
 const check=rate=>{
  const match=nodes['gres-total'].innerHTML.match(/^<div class="sec-sub">共鳴效果：<\/div><div class="gres-list"><div>物理防禦 \+([\d.]+)<\/div><\/div>$/);
  assert.ok(match,nodes['gres-total'].innerHTML);
  assert.ok(Math.abs(Number(match[1])-(c.gemStatValue('diamond',6)*2+c.gemStatValue('diamond',4))*rate)<1e-8);
 };
 check(.03);assert.match(nodes['gres-detail'].innerHTML,/能力\+3%/);
 nodes['gres-detail'].handlers.click({target:element({'data-gres-upgrade':'1'})});
 check(.06);assert.match(nodes['gres-detail'].innerHTML,/能力\+6%/);
 c.gresSelectHole(1,0);assert.equal(nodes['gres-total'].innerHTML,empty); // 有自身寶石但0級
 c.gresSelectHole(5,6);assert.equal(nodes['gres-total'].innerHTML,empty); // 有等級、無鄰珠
 c.gresSelectHole(1,1);check(.06);
 nodes['gres-detail'].handlers.click({target:element({'data-gres-take':'0'})});
 assert.equal(nodes['gres-total'].innerHTML,empty);assert.match(nodes['gres-detail'].innerHTML,/能力\+0%/);
 assert.equal(holes['1:1'].lv,2);
});

test('說明精確三句；切入共鳴預設物傷左上孔、重入重設，頁內選孔與刷新保持原選擇',()=>{
 const {c,nodes}=ui();
 assert.equal(nodes['gres-help'].attrs['data-tt-desc'],'把寶石鑲入共鳴鑲孔中以獲取寶石能力。<br>升級鑲孔可獲得相鄰寶石效果的額外加成。<br>中央區將在周圍六大區鑲孔都升至10級時解鎖。');
 c.UI.gemBrowse.resHole=undefined;assert.deepEqual(Array.from(c.gresSelected()),[5,6]);
 c.setGemTool('compose');c.UI.gemBrowse.resHole=[1,2];c.UI.gemBrowse.resFilter='def';c.setGemTool('resonance');
 assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[5,6]);assert.equal(c.UI.gemBrowse.resFilter,'all');
 assert.match(nodes['gres-detail'].innerHTML,/物理傷害型4級以上寶石/);
 c.gresSelectHole(0,2);c.renderGems();c.setGemTool('resonance');assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[0,2]);
 c.setGemTool('compose');c.setGemTool('resonance');assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[5,6]);
 c.setGemTool('fusion');c.setGemTool('shop');assert.equal(c.UI.gemBrowse.tool,'resonance');
});

test('石榴石在物理區篩選可見並可鑲入，魔法區不顯示且拒絕拖放，取下退回',()=>{
 const f=ui({garnet:{4:2}}),{c,nodes,element}=f;
 c.gresSelectHole(0,1);assert.doesNotMatch(nodes['gem-table'].innerHTML,/data-gem-pick="garnet"/);
 c.gresSelectHole(5,6);assert.match(nodes['gem-table'].innerHTML,/data-gem-pick="garnet"/);
 assert.match(tier(nodes,4),/data-gres-gem="garnet:4" draggable="true"/);
 drag(f,'garnet',4);drop(f,'0:1');assert.equal(c.calls.length,0);assert.equal(c.gemCount('garnet',4),2);
 nodes['gem-focus'].handlers.click({target:element({'data-gres-gem':'garnet:4'})});assert.equal(c.calls.length,1);
 assert.equal(c.G.player.resonance.holes['5:6'].gems[0].type,'garnet');assert.match(nodes['gres-detail'].innerHTML,/四級石榴石/);
 assert.ok(nodes['gres-detail'].innerHTML.includes('<span class="gres-gem-stat">'+c.gresStatText('garnet',c.gemStatValue('garnet',4))+'</span>'));
 nodes['gres-detail'].handlers.click({target:element({'data-gres-take':'0'})});assert.equal(c.gemCount('garnet',4),2);
});

test('共鳴頁籤未達解鎖條件：無法切入，頁籤以 tips 顯示條件；解鎖後恢復並移除提示', () => {
  const f = ui();
  const tab = f.element({}); tab.className = 'gx-tab'; tab.removeAttribute = (k) => { delete tab.attrs[k]; };
  f.nodes['gem-tool-resonance'] = tab;
  f.c.setAttrIfChanged = (el, k, v) => { if (el) el.setAttribute(k, String(v)); };
  f.c.G.player.reincarnations = 3;
  f.c.UI.gemBrowse.tool = 'compose';
  f.c.setGemTool('resonance');
  assert.equal(f.c.UI.gemBrowse.tool, 'compose');
  f.c.renderGems();
  assert.match(tab.className, /is-locked/);
  assert.equal(tab.attrs['data-tt-title'], f.c.STR(2130));
  assert.match(tab.attrs['data-tt-desc'], /4 轉/);
  f.c.G.player.reincarnations = 4;
  f.c.renderGems();
  assert.doesNotMatch(tab.className, /is-locked/);
  assert.equal(tab.attrs['data-tt-desc'], undefined);
  f.c.setGemTool('resonance');
  assert.equal(f.c.UI.gemBrowse.tool, 'resonance');
});
