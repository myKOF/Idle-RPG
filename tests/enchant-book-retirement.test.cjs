'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine}=require('../scripts/sim/engine.js');
function env(){
  const e=createEngine({seed:1104}).boot(null),c=e.ctx;c.setCombatPaused(true);
  c.ENCHANT_ENABLED=true;Object.assign(c.G.player,{gold:1e12,reincarnations:5});
  c.G.player.books.fire=10000;c.G.player.books.legacyUnknown=77;
  c.G.player.shownRes['r-books']=true;
  c.G.stage.zone='desert';c.G.stage.best=c.G.stage.current=100;
  c.ZONE_STAGE_DROP_TABLE.desert=[{min:1,max:1000,equipmentRates:[],materials:{gemRates:[],bookRate:10000,ancientEssenceRate:0,dustRate:0}}];
  return {e,c,books:JSON.stringify(c.G.player.books)};
}
test('普通／菁英／BOSS即使附魔開關開啟且舊掉率極高仍不掉書、不記錄書戰利品',()=>{
  const {c,books}=env(),events=[];c.recordLootMat=(...args)=>events.push(args);
  for(const enemy of [{level:100},{level:100,elite:true},{level:100,isBoss:true}])c.rollFieldDrops(enemy);
  assert.equal(JSON.stringify(c.G.player.books),books);assert.ok(!events.some(x=>x[0]==='book'));
});
test('離線收益忽略舊bookRate，保留現有庫存，摘要books為0',()=>{
  const {c,books}=env();c.G.savedAt=c.Date.now()-3600000;
  const summary=c.applyOfflineProgress();assert.ok(summary.kills>0);assert.equal(summary.books,0);
  assert.equal(JSON.stringify(c.G.player.books),books);
});
test('封魔塔三塔首通及重複通關不再發附魔書，其他獎勵維持',()=>{
  for(const floor of [1,51,101]){
    const {c,books}=env();c.G.tower.highest=floor-1;c.setTowerAutoAdvance(false);c.showTowerResultModal=()=>{};
    for(const first of [true,false]){
      const essence=c.G.player.essence,reward=c.towerRewardFor(floor,first);
      c.startTowerFight(floor);assert.equal(c.G.tower.active,true);
      c.TOWER.boss={hp:0,maxHp:100,xp:10};c.endTowerFight(true);
      assert.equal(JSON.stringify(c.G.player.books),books);
      assert.equal(c.G.player.essence,essence+reward.essence);
      assert.doesNotMatch(c.TOWER.result.rewards.join('、'),/附魔書/);
      c.confirmTowerResult();
    }
  }
});
test('舊book任務獎勵不發書，其他任務獎勵及舊存檔書本欄保持',()=>{
  const {c,books}=env();c.taskGrantReward({rewardType:'book',rewardParam:'fire',rewardQty:1000});
  assert.equal(JSON.stringify(c.G.player.books),books);
  const gold=c.G.player.gold;c.taskGrantReward({rewardType:'gold',rewardQty:123});assert.equal(c.G.player.gold,gold+123);
  const saved=JSON.parse(JSON.stringify(c.G)),migrated=c.migrateSave(saved);
  assert.equal(JSON.stringify(migrated.player.books),books);assert.equal(migrated.player.shownRes['r-books'],true);
});
