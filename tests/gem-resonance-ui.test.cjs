'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ui(gems={diamond:{3:8,4:2,7:1},ruby:{10:3}}){
 const c=vm.createContext({console,Math,Date,JSON,Number,Map,Set});c.window=c;c.UI={gemBrowse:{tool:'resonance',filter:'atk',resHole:[1,1]},dirty:{}};
 for(const p of ['js/util.js','js/data.js','js/status.js','js/gem_resonance_data.js','js/formula.js','js/item.js','js/gem_resonance.js'])vm.runInContext(read(p),c,{filename:p});
 c.G={player:{gold:1e12,gems,resonance:{holes:{}}}};c.markStatsDirty=()=>{};
 c.esc=String;c.fmt=String;c.fmtFull=String;c.pctStr=String;
 c.GEM_DEF_STATS={hpFlat:1,hpRegen:1,defFlat:1,mdefFlat:1,evasion:1,tenacity:1,blockRate:1,blockDmgRed:1,shieldEff:1,pRes:1,mRes:1};
 const source=read('js/ui.js');vm.runInContext(source.match(/var GEM_TIER_COLORS = \{[\s\S]*?\n\};/)[0],c);
 for(const name of ['gemsViewCount','gemCategoryOf','gemAbilityText']){
  const fn=source.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));assert.ok(fn,name);vm.runInContext(fn[0],c);
 }
 const nodes={};function element(attrs={}){return {attrs,innerHTML:'',handlers:{},classes:new Set(),addEventListener(k,f){this.handlers[k]=f;},getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;},closest(k){return k==='[data-gres-gem]'&&this.attrs['data-gres-gem']||k==='[data-gres-hole]'&&this.attrs['data-gres-hole']||k==='[data-gres-take]'&&this.attrs['data-gres-take']?this:null;},classList:{add(){},remove(){}},querySelectorAll(){return [];},contains(){return true;}};}
 for(const id of ['gres-board','gres-detail','gem-table','gres-library-note'])nodes[id]=element();
 c.$id=id=>nodes[id]||null;c.uiGemsPanelSnapshot=()=>({gems:c.G.player.gems,resonance:c.G.player.resonance});
 c.resolveGemsPanelSnapshot=s=>s||c.uiGemsPanelSnapshot();c.uiHeaderPanelSnapshot=()=>({player:c.G.player});c.syncItemGridCells=(box,keys,htmls)=>{box.innerHTML=htmls.join('');box.keys=keys;};
 c.renders=0;c.renderGems=()=>{c.renders++;c.gresRenderLibrary(c.uiGemsPanelSnapshot(),nodes['gem-table']);};
 c.calls=[];c.sendGemUiCommand=(name,args)=>{c.calls.push({name,args});let error;if(name==='gem.resonanceSocket')error=c.socketResonanceGem(args.region,args.hole,args.type,args.level);if(name==='gem.resonanceUnsocket')error=c.unsocketResonanceGem(args.region,args.hole,args.index);assert.equal(error,null);c.renderGems();};
 vm.runInContext(read('js/ui-gem-resonance.js'),c);c.initGemResonanceUi();return {c,nodes,element};
}
test('選孔只列左側符合種類／階級／庫存的確切寶石，右側不再建候選池',()=>{
 const {c,nodes}=ui();c.renderGems();const html=nodes['gem-table'].innerHTML;
 assert.match(html,/data-gres-gem="diamond:4"/);assert.match(html,/data-gres-gem="diamond:7"/);assert.doesNotMatch(html,/diamond:3|ruby:10/);
 assert.equal(c.gresCandidates(c.uiGemsPanelSnapshot(),1,1).length,2);
 const detail=c.gresDetailHTML(c.uiGemsPanelSnapshot(),c.uiHeaderPanelSnapshot(),c.G.player.resonance,[1,1]);
 assert.doesNotMatch(detail,/gres-pool|data-gres-put/);assert.match(detail,/左側已篩選/);
 c.GEM_TYPES.diamond.enabled=false;c.renderGems();assert.doesNotMatch(nodes['gem-table'].innerHTML,/data-gres-gem=/);
});
test('選孔重設共鳴分類並即時刷新；一般寶石工具的分類保持原值',()=>{
 const {c,nodes}=ui();c.UI.gemBrowse.resFilter='atk';c.gresSelectHole(1,1);
 assert.equal(c.UI.gemBrowse.resFilter,'all');assert.equal(c.UI.gemBrowse.filter,'atk');assert.match(nodes['gem-table'].innerHTML,/diamond:4/);
 c.gresSelectHole(5,1);assert.match(nodes['gem-table'].innerHTML,/ruby:10/);assert.doesNotMatch(nodes['gem-table'].innerHTML,/diamond:/);
});
test('左側點擊使用指定階級與正式鑲嵌／取下規則，滿孔不重送、取下回庫存',()=>{
 const {c,nodes,element}=ui();const source=element({'data-gres-gem':'diamond:4'});
 nodes['gem-table'].handlers.click({target:source});assert.equal(c.calls.length,1);assert.equal(c.G.player.gems.diamond[4],1);
 assert.equal(c.G.player.resonance.holes['1:1'].gems[0].level,4);assert.match(nodes['gem-table'].innerHTML,/此孔已滿/);
 nodes['gem-table'].handlers.click({target:source});assert.equal(c.calls.length,1);
 nodes['gres-detail'].handlers.click({target:element({'data-gres-take':'0'})});assert.equal(c.G.player.gems.diamond[4],2);assert.match(nodes['gem-table'].innerHTML,/diamond:4/);
});
test('拖曳支援不同有效孔位，拒絕不符種類／階級／外部拖曳並保留即時庫存來源',()=>{
 const {c,nodes,element}=ui({sapphire:{4:2},ruby:{4:2}});c.gresSelectHole(0,1);
 const transfer={setData(){},dropEffect:''},source=element({'data-gres-gem':'sapphire:4'});
 const start=()=>nodes['gem-table'].handlers.dragstart({target:source,dataTransfer:transfer,preventDefault(){throw Error('unexpected reject');}});
 start();const original=nodes['gem-table'].innerHTML;c.G.player.gems.sapphire[4]=3;c.renderGems();assert.equal(nodes['gem-table'].innerHTML,original);
 let accepted=false;nodes['gres-board'].handlers.dragover({target:element({'data-gres-hole':'5:1'}),dataTransfer:transfer,preventDefault(){accepted=true;}});assert.equal(accepted,false);
 nodes['gres-board'].handlers.drop({target:element({'data-gres-hole':'5:1'}),preventDefault(){}});assert.equal(c.calls.length,0);
 start();nodes['gres-board'].handlers.drop({target:element({'data-gres-hole':'0:2'}),preventDefault(){}});assert.equal(c.calls.length,1);assert.equal(c.calls[0].args.hole,2);assert.equal(c.G.player.gems.sapphire[4],2);
 assert.deepEqual(Array.from(c.UI.gemBrowse.resHole),[0,2]);assert.equal(c.UI.gemBrowse.resDrag,null);
 nodes['gres-board'].handlers.drop({target:element({'data-gres-hole':'0:1'}),preventDefault(){}});assert.equal(c.calls.length,1);
 c.gresSelectHole(0,1);start();nodes['gres-board'].handlers.drop({target:element({'data-gres-hole':'0:0'}),preventDefault(){}});assert.equal(c.calls.length,1);
});
test('拖曳開始後庫存失效或目標被填滿，放開時重新驗證且不送出命令',()=>{
 const {c,nodes,element}=ui();const transfer={setData(){}};
 const start=()=>nodes['gem-table'].handlers.dragstart({target:element({'data-gres-gem':'diamond:4'}),dataTransfer:transfer,preventDefault(){}});
 start();c.G.player.gems.diamond[4]=0;nodes['gres-board'].handlers.drop({target:element({'data-gres-hole':'1:2'}),preventDefault(){}});assert.equal(c.calls.length,0);
 c.G.player.gems.diamond[4]=2;start();c.G.player.resonance.holes['1:2']={lv:2,gems:[{type:'diamond',level:4}]};
 nodes['gres-board'].handlers.drop({target:element({'data-gres-hole':'1:2'}),preventDefault(){}});assert.equal(c.calls.length,0);assert.equal(c.G.player.resonance.holes['1:2'].lv,2);
});