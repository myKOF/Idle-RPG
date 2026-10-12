'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {extractFunction}=require('./helpers/battle-scene.cjs');
const source=fs.readFileSync(path.join(__dirname,'../js/battle-renderer.js'),'utf8');
function setup(){
  const ground={width:256,height:256};
  const decor={ready:true,building:null,chunks:24,prebuilding:'desert#deep',band:0};
  const S={ready:true,failed:false,zoneKey:'desert',lastPanel:{stage:{zone:'desert',current:1}},scene:{key:'field',phase:''},decor:{stats:()=>decor},arena:null};
  const c={S,_groundTexCache:{ground_desert:ground},sceneKeyOf:p=>p.sceneKey||'field'};
  vm.createContext(c);vm.runInContext(extractFunction(source,'sceneAssetsReady'),c);
  return {S,decor,cache:c._groundTexCache,ready:()=>c.sceneAssetsReady()};
}
test('SCENE-READY 圖集與可見區塊都備妥才完成，另一階段背景預建不阻塞',()=>{
  const e=setup(); assert.equal(e.ready(),true);
  e.decor.ready=false;e.decor.building='worker';e.decor.chunks=0; assert.equal(e.ready(),false);
  e.decor.ready=true;e.decor.building=null;assert.equal(e.ready(),false,'Worker圖集回來仍須等可見區塊建立');
  e.decor.chunks=24;assert.equal(e.ready(),true);
});
test('SCENE-READY 專用底圖失敗須等通用底圖，兩者皆失敗採既有純底色',()=>{
  const e=setup();e.cache.ground_desert='loading';assert.equal(e.ready(),false);
  e.cache.ground_desert='failed';assert.equal(e.ready(),false);
  e.cache.ground_default='loading';assert.equal(e.ready(),false);
  e.cache.ground_default={width:256};assert.equal(e.ready(),true);
  e.cache.ground_default='failed';assert.equal(e.ready(),true);
});
test('SCENE-READY 沒有當前面板、地貌不同或轉場未完成不能誤認舊場景就緒',()=>{
  const e=setup(),panel=e.S.lastPanel;
  e.S.lastPanel=null;assert.equal(e.ready(),false);e.S.lastPanel=panel;
  e.S.zoneKey='swamp';assert.equal(e.ready(),false);e.S.zoneKey='desert';
  e.S.scene.phase='opening';assert.equal(e.ready(),false);e.S.scene.phase='';
  e.S.lastPanel.sceneKey='tower:2';assert.equal(e.ready(),false);
});
test('SCENE-READY 塔戰僅等待對應祭壇，無需等待隱藏的野外圖集與地板',()=>{
  const e=setup();e.S.lastPanel.sceneKey=e.S.scene.key='tower:2';e.decor.ready=false;e.cache.ground_desert='loading';
  let on=false;e.S.arena={active:()=>on};assert.equal(e.ready(),false);on=true;assert.equal(e.ready(),true);
});
test('SCENE-READY 關閉裝飾仍等底圖；Canvas失敗由主入口DOM備援處理',()=>{
  const e=setup();e.S.decor=null;assert.equal(e.ready(),true);
  e.cache.ground_desert='loading';assert.equal(e.ready(),false);
  e.S.ready=false;assert.equal(e.ready(),false);e.S.ready=true;e.S.failed=true;assert.equal(e.ready(),false);
});
