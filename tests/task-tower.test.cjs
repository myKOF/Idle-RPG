'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createEngine} = require('../scripts/sim/engine');
const plain = value => JSON.parse(JSON.stringify(value));
function setup(order = 20) {
  const e = createEngine({seed: 151}).boot(null), c = e.ctx, p = c.G.player;
  p.level = 1000; p.gold = 1e12;
  const def = c.TASKS.find(t => t.order === order);
  c.G.taskState.idx = c.TASKS.indexOf(def);
  return {e,c,p,def};
}

test('新增兩個封魔塔任務的參數與獎勵符合Task來源，原荒漠獎勵調整保持', () => {
  const {c} = setup();
  assert.equal(c.TASKS.length,48);
  assert.deepEqual(plain(c.TASKS.filter(t=>t.type==='towerFloor').map(t=>
    [t.order,t.param||'',t.count,t.rewardType,t.rewardParam,t.rewardQty])),[
    [20,'',1,'equip','4|1|1',1],
    [35,'',20,'equip','5|150|2',1]
  ]);
  const desert=c.TASKS.find(t=>t.order===21);
  assert.equal(desert.rewardParam,'4|50|2');assert.equal(desert.rewardQty,2);
});

test('進入挑戰、逃跑、戰敗及逾時均不會完成BOSS通關任務', () => {
  for(const reason of ['flee','death','timeout']){
    const {e,c,def}=setup();
    assert.equal(c.taskProgressFor(def),0);
    c.startTowerFight(1);
    assert.equal(c.G.tower.active,true);
    assert.equal(c.taskProgressFor(def),0);
    if(reason==='death')c.TOWER.player.hp=0;
    c.endTowerFight(false,reason);
    assert.equal(c.G.tower.highest,0,reason);
    assert.equal(c.taskQuickView().ready,false);
    assert.ok(e.cmd('task.claim').result.err);
  }
});

test('實際勝利結算才更新通關進度，首層任務發1太古史詩1級裝備且不能重領', () => {
  const {e,c,def}=setup();
  c.startTowerFight(1);c.TOWER.boss.hp=0;c.endTowerFight(true);
  assert.equal(c.G.tower.highest,1);assert.equal(c.taskProgressFor(def),1);
  assert.equal(e.panel('task').tasks[19].ready,true);
  const n=c.G.inventory.length;
  assert.equal(e.cmd('task.claim').result.claimed,20);
  const rewards=c.G.inventory.slice(n);
  assert.equal(rewards.length,1);
  assert.equal(rewards[0].rarity,4);assert.equal(rewards[0].level,1);assert.equal(c.getItemAncientCount(rewards[0]),1);
  assert.ok(e.cmd('task.claim').result.err);
  assert.equal(c.G.inventory.length,n+1);
  const loaded=createEngine({seed:151}).boot(JSON.parse(e.saveJson())).ctx;
  assert.equal(loaded.G.taskState.idx,20);assert.equal(loaded.G.tower.highest,1);
});

test('二十層門檻前不達成，通關後發2太古傳奇150級裝備，更高通關亦符合', () => {
  const {e,c,def}=setup(35);
  c.G.tower.highest=19;
  assert.equal(c.taskProgressFor(def),19);assert.ok(e.cmd('task.claim').result.err);
  c.startTowerFight(20);c.TOWER.boss.hp=0;c.endTowerFight(true);
  assert.equal(c.taskProgressFor(def),20);assert.equal(c.taskQuickView().ready,true);
  const n=c.G.inventory.length;
  assert.equal(e.cmd('task.claim').result.claimed,35);
  const rewards=c.G.inventory.slice(n);
  assert.equal(rewards.length,1);
  assert.equal(rewards[0].rarity,5);assert.equal(rewards[0].level,150);assert.equal(c.getItemAncientCount(rewards[0]),2);
  assert.ok(e.cmd('task.claim').result.err);
  assert.equal(c.G.inventory.length,n+1);
  c.G.tower.highest=21;
  assert.equal(c.taskProgressFor(def),21);
});

test('格式3全部47個合法索引保留既有任務身份與已領狀態，插入邊界接新任務且冪等', () => {
  const {c}=setup();
  const previous=Array.from(c.TASKS).filter(t=>t.type!=='towerFloor');
  for(let idx=0;idx<=46;idx++){
    const data=c.newGameState();data.saveSchema=3;data.taskState.idx=idx;
    const gold=data.player.gold,scrap=data.player.scrap,highest=data.tower.highest;
    const out=c.migrateSave(data);
    const want=idx===46?48:idx===19?19:idx===33?34:c.TASKS.findIndex(t=>t.name===previous[idx].name);
    assert.equal(out.taskState.idx,want,'舊索引'+idx);
    for(const claimed of previous.slice(0,idx))assert.ok(c.TASKS.findIndex(t=>t.name===claimed.name)<want,'不能重領'+claimed.name);
    assert.equal(out.player.gold,gold);assert.equal(out.player.scrap,scrap);assert.equal(out.tower.highest,highest);
    assert.equal(out.saveSchema,4);assert.equal(c.migrateSave(out).taskState.idx,want);
  }
  for(const idx of [0,19,20,33,34,35,48]){
    const data=c.newGameState();data.taskState.idx=idx;
    assert.equal(c.migrateSave(data).taskState.idx,idx);
  }
});

test('格式2全部舊索引先轉3再轉4，與完整讀檔一致，最舊已完成進度轉48', () => {
  const {c}=setup();
  for(let idx=0;idx<=43;idx++){
    const data=c.newGameState();data.saveSchema=2;data.taskState.idx=idx;
    const expected=plain(data);
    c.applySaveSchemaMigrations(expected,2,{version:3,migrations:c.SAVE_SCHEMA_MIGRATIONS.slice(0,2)});
    c.applySaveSchemaMigrations(expected,3);
    const out=c.migrateSave(data);
    assert.equal(out.taskState.idx,expected.taskState.idx);assert.equal(out.saveSchema,4);
  }
  const legacy=c.newGameState();delete legacy.saveSchema;delete legacy.taskInsertChestRelicV1;legacy.taskState.idx=38;
  assert.equal(c.migrateSave(legacy).taskState.idx,48);
});

test('任務導引選擇正確樓層並保留鎖定入口限制', () => {
  const {c}=setup();let tab,selected,locked=false,blocked=0;
  const node={getClientRects:()=>[{}],matches:()=>locked,closest:()=>null,focus(){}};
  const ctx={UI:{},STR:()=>'',showFloatingText:()=>{blocked++},$id:id=>id==='ui-shell'?{classList:{contains:()=>false}}:{hidden:false,querySelectorAll:()=>[]},
    document:{querySelector:()=>node},getComputedStyle:()=>({visibility:'visible'}),closeQuestModal(){},
    switchTab:value=>{tab=value},towerSelectFloor:value=>{selected=value},window:{addEventListener(){},removeEventListener(){}},
    MutationObserver:class{observe(){}disconnect(){}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/quest-guide.js'),'utf8'),ctx);
  for(const [order,floor]of [[20,1],[35,20]]){
    ctx.QuestGuide.follow(c.TASKS.find(t=>t.order===order));assert.equal(tab,'tower');assert.equal(selected,floor);
  }
  tab=null;selected=null;locked=true;
  ctx.QuestGuide.follow(c.TASKS.find(t=>t.order===20),null,{detail:0});assert.equal(tab,null);assert.equal(selected,null);assert.equal(blocked,1);
});
