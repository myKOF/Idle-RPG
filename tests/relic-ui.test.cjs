'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
function mount() {
  const handlers = {}, heard = [], played = [];
  const list = {addEventListener:(name,fn)=>{handlers[name]=fn;}};
  const player = {relics:{1:{lv:1,n:20}}};
  const c = {console,UI:{tab:'relics'},document:{hidden:false},$id:id=>id==='relic-list'?list:null,
    peekUiPanelData:()=>({player}),esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    UISound:{relicUpgraded:()=>heard.push('upgrade')}};
  vm.createContext(c);
  for (const f of ['strings_data','strings','relic_data','relic','ui-relic']) vm.runInContext(fs.readFileSync(path.join(root,'js',f+'.js'),'utf8'),c);
  c.renderRelics=()=>{};c.relicCelebrate=(r,before)=>played.push([r.id,before]);
  c.bindRelicUi();
  const btn={disabled:false,getAttribute:()=> '1'};
  const target={closest:selector=>selector==='[data-relic-up]'?btn:null};
  return {c,player,heard,played,handlers,click:()=>handlers.click({target})};
}
test('藏品只顯示圖標／名稱／等級，效果在tips，升級操作預設收起',()=>{
  const {c}=mount(), r=c.RELICS[0];
  let html=c.relicCardHTML(r,{});
  assert.match(html,/relic-01.webp/);assert.match(html,/長夜沙漏/);assert.match(html,/Lv.0\/20/);
  assert.match(html,/data-tt-title="長夜沙漏"/);assert.match(html,/data-tt-desc=/);
  assert.match(html,/id="rl-actions-1" hidden/);assert.ok(!html.includes(r.levels[0].desc));
  assert.match(c.relicTooltipHTML(r,{}),/離線收益時間上限 \+1 小時/);
  c._relicUiSelected=1;
  html=c.relicCardHTML(r,{1:{lv:1,n:0}});
  assert.match(html,/data-relic-up="1" disabled/);assert.match(html,/0\/1 需求/);
  html=c.relicCardHTML(r,{1:{lv:19,n:10}});
  assert.match(html,/10\/10 需求/);assert.doesNotMatch(html,/data-relic-up="1" disabled/);
  assert.match(c.relicTooltipHTML(r,{1:{lv:19,n:10}}),/下一級：離線收益時間上限 \+20 小時/);
  html=c.relicCardHTML(r,{1:{lv:20,n:7}});
  assert.match(html,/已滿級/);assert.match(html,/庫存 7 件/);assert.doesNotMatch(html,/data-relic-up/);
});
test('等待Worker成功前無演出／音效，重複點擊只送一次，成功才播一次',async()=>{
  const s=mount();let resolve,success,sent=0;
  s.c.sendGemUiCommand=(name,args,key,panels,cb)=>{assert.equal(name,'relic.upgrade');sent++;success=cb;return new Promise(r=>resolve=r);};
  s.click();s.click();assert.equal(sent,1);assert.deepEqual(s.heard,[]);assert.deepEqual(s.played,[]);
  success();resolve(null);await new Promise(setImmediate);
  assert.deepEqual(s.heard,['upgrade']);assert.deepEqual(s.played,[[1,1]]);assert.equal(s.c.relicUiPending(1),false);
});
test('Worker拒絕或傳輸失敗不觸發演出／音效並釋放本機等待狀態',async()=>{
  const s=mount();
  s.c.sendGemUiCommand=()=>Promise.resolve(null);s.click();await new Promise(setImmediate);
  assert.deepEqual(s.heard,[]);assert.deepEqual(s.played,[]);assert.equal(s.c.relicUiPending(1),false);
});
test('32件均有獨立圖標，主端與Worker配置快取一致',()=>{
  const {c}=mount();for(const r of c.RELICS) assert.ok(fs.statSync(path.join(root,c.relicIconPath(r.id).split('?')[0])).size>2000);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),worker=fs.readFileSync(path.join(root,'js/worker/sim.worker.js'),'utf8');
  for(const name of ['relic','relic_data']){
    const version=html.match(new RegExp('js/'+name+'\\.js\\?v=([^"\\s]+)'))[1];
    assert.ok(worker.includes('../'+name+'.js?v='+version));
  }
});
