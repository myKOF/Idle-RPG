'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine');
const plain = value => JSON.parse(JSON.stringify(value));
function setup(order) {
  const e = createEngine({seed: 113}).boot(null), c = e.ctx, p = c.G.player;
  p.gold = 1e12;
  const def = c.TASKS.find(t => t.order === order);
  if (def) c.G.taskState.idx = c.TASKS.indexOf(def);
  return {e,c,p,def};
}
function fill(c, upgrade = 10) {
  const eq = c.activeEquipment();
  for (const slot of c.SLOT_LIST) {
    eq[slot] = c.makeEquipment(1,{slot:slot.replace(/2$/,''),rarity:0,level:1});
    eq[slot].upgrade = upgrade;
  }
  return eq;
}

test('Task新增三筆的類型、門檻與獎勵精確符合來源及使用者裁決', () => {
  const {c} = setup();
  assert.equal(c.TASKS.length,48);
  assert.deepEqual(plain(c.TASKS.filter(t=>[11,12,14].includes(t.order)).map(t=>
    [t.order,t.type,t.param||'',t.count,t.rewardType,t.rewardQty,t.rewardLabel])),[
    [11,'chestLevel','1',20,'scrap',1500,'裝備碎片+1500'],
    [12,'chestOpenCount','',1,'scrap',2000,'裝備碎片+2000'],
    [14,'equipSlots','0|0|10',13,'gold',500000,'金幣+500000']
  ]);
});

test('指定青銅寶箱19級不達成，實際升到20級可領1500碎片；其他寶箱不算', () => {
  const {e,c,p,def} = setup(11);
  assert.equal(c.taskProgressFor(def),1);
  const other = c.chestState(2); other.on=true; other.lv=30;
  const bronze = c.chestState(1); bronze.lv=19;
  assert.equal(c.taskProgressFor(def),19);
  assert.ok(e.cmd('task.claim').result.err);
  const before = p.scrap;
  assert.equal(e.cmd('chest.upgrade',{chestId:1}).result,null);
  assert.equal(c.taskProgressFor(def),20);
  assert.equal(e.panel('task').tasks[10].ready,true);
  assert.equal(e.cmd('task.claim').result.claimed,11);
  assert.equal(p.scrap,before+1500);
  assert.ok(e.cmd('task.claim').result.err,'下一個開箱任務未完成，不能重領');
  assert.equal(p.scrap,before+1500);
  assert.equal(c.taskProgressFor({type:'chestLevel',param:'missing'}),0);
  other.on=false;
  assert.equal(c.taskProgressFor({type:'chestLevel',param:'2'}),0,'未解鎖寶箱不計');
});

test('任意寶箱一次開多個照累計，失敗不計；可領2000碎片並保存', () => {
  const {e,c,p,def} = setup(12);
  assert.equal(c.taskProgressFor(def),0);
  assert.equal(typeof e.cmd('chest.open',{chestId:2,count:1}).result,'string');
  assert.equal(c.taskProgressFor(def),0);
  const chest=c.chestState(2);chest.on=true;chest.n=3;
  assert.equal(e.cmd('chest.open',{chestId:2,count:2}).result.opened,2);
  assert.equal(c.taskProgressFor(def),2);
  const before=p.scrap;
  assert.equal(e.cmd('task.claim').result.claimed,12);
  assert.equal(p.scrap,before+2000);
  assert.ok(e.cmd('task.claim').result.err,'後續飛刀進階尚未達成');
  const loaded=createEngine({seed:113}).boot(JSON.parse(e.saveJson())).ctx;
  assert.equal(loaded.G.taskState.idx,12);
  assert.equal(loaded.G.factory.stats.chestOpened,2);
});

test('全身強化依13部位的實際裝備判斷，空格／+9不算，累計強化次數不能代替', () => {
  const {e,c,p,def}=setup(14);
  c.G.factory.stats.upgraded=10000;
  assert.equal(c.taskProgressFor(def),0);
  const eq=fill(c);
  eq.helmet.upgrade=9;
  assert.equal(c.taskProgressFor(def),12);
  assert.ok(e.cmd('task.claim').result.err);
  eq.helmet.upgrade=10;
  assert.equal(c.taskProgressFor(def),13);
  const it=eq.helmet;eq.helmet=null;
  assert.equal(c.taskProgressFor(def),12);eq.helmet=it;
  const gold=p.gold;
  assert.equal(e.cmd('task.claim').result.claimed,14);
  assert.equal(p.gold,gold+500000);
  assert.ok(e.cmd('task.claim').result.err);
  assert.equal(p.gold,gold+500000);
});

test('雙手武器強化門檻同時計主副手，品質與等級條件仍可並用，進度讀取不改裝備', () => {
  const {c,def}=setup(14),eq=fill(c);
  eq.weapon=c.makeEquipment(1,{slot:'weapon',weaponType:'greatsword2h',rarity:0,level:1});
  eq.weapon.upgrade=10;eq.weapon2=null;
  assert.equal(c.isTwoHandItem(eq.weapon),true);
  const before=plain(eq);
  assert.equal(c.taskProgressFor(def),13);
  assert.deepEqual(plain(eq),before);
  eq.weapon.upgrade=9;
  assert.equal(c.taskProgressFor(def),11);
  assert.equal(c.taskProgressFor({type:'equipSlots',param:'0|0'}),13,'原兩段格式不要求強化');
  assert.equal(c.taskProgressFor({type:'equipSlots',param:'1|0|10'}),0);
  assert.equal(c.taskProgressFor({type:'equipSlots',param:'0|2|10'}),0);
  c.G.equipActive=1;
  assert.equal(c.taskProgressFor(def),0,'未啟用方案的全身裝備不能代替目前方案');
  c.G.equipActive=0;
  assert.equal(c.taskProgressFor(def),11);
});

test('歷史格式3寶箱任務遷移的44個舊索引依任務身份保持正確，已領項目不重領', () => {
  const {c}=setup();
  const previous=Array.from(c.TASKS).filter(t=>t.type!=='towerFloor');
  const old=previous.filter(t=>![11,12,14].includes(t.order));
  old.splice(13,0,old.splice(5,1)[0]);
  const options={version:3,migrations:c.SAVE_SCHEMA_MIGRATIONS.filter(m=>m.to<=3)};
  for(let idx=0;idx<=43;idx++){
    const data=c.newGameState();data.saveSchema=2;data.taskState.idx=idx;
    const gold=data.player.gold,scrap=data.player.scrap;
    c.applySaveSchemaMigrations(data,2,options);
    const out=data;
    let want;
    if(idx===43)want=46;
    else if(idx===5)want=5; // 尚未到達前移任務的新位置
    else if(idx===9)want=10; // 恰在兩個寶箱插入點
    else if(idx===10)want=13; // 恰在全身強化插入點
    else if(idx===13)want=previous.findIndex(t=>t.name===old[14].name); // 舊下一個為已前移的任務
    else want=previous.findIndex(t=>t.name===old[idx].name);
    assert.equal(out.taskState.idx,want,'舊索引'+idx);
    assert.equal(out.saveSchema,3);
    for(const claimed of old.slice(0,idx))assert.ok(previous.findIndex(t=>t.name===claimed.name)<want,'不可重領：'+claimed.name);
    assert.equal(out.player.gold,gold);assert.equal(out.player.scrap,scrap);
    c.applySaveSchemaMigrations(out,3,options);assert.equal(out.taskState.idx,want);
  }
  for(const idx of [0,5,10,11,13,14,46]){
    const fresh=c.newGameState();fresh.taskState.idx=idx;
    assert.equal(c.migrateSave(fresh).taskState.idx,idx);
  }
});

test('格式0／1的全部41個索引依序串接格式2、3與4，最舊38項已完成者成為48', () => {
  const {c}=setup();
  for(const schema of [0,1])for(let idx=0;idx<=40;idx++){
    const data=c.newGameState();data.saveSchema=schema;data.taskState.idx=idx;
    const sequential=plain(data);
    c.applySaveSchemaMigrations(sequential,schema,{version:2,migrations:c.SAVE_SCHEMA_MIGRATIONS.slice(0,1)});
    c.applySaveSchemaMigrations(sequential,2);
    const out=c.migrateSave(data);
    assert.equal(out.taskState.idx,sequential.taskState.idx);assert.equal(out.saveSchema,4);
  }
  const legacy=c.newGameState();delete legacy.saveSchema;delete legacy.taskInsertChestRelicV1;legacy.taskState.idx=38;
  assert.equal(c.migrateSave(legacy).taskState.idx,48);
});

test('三個新增任務的導引分別前往熔爐寶箱與裝備頁', () => {
  const {c}=setup();let tab;
  const node={getClientRects:()=>[{}],matches:()=>false,closest:()=>null,focus(){}};
  const ctx={UI:{},$id:id=>id==='ui-shell'?{classList:{contains:()=>false}}:{hidden:false,querySelectorAll:()=>[]},
    document:{querySelector:()=>node},getComputedStyle:()=>({visibility:'visible'}),closeQuestModal(){},
    switchTab:value=>{tab=value},window:{addEventListener(){},removeEventListener(){}},MutationObserver:class{observe(){}disconnect(){}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/quest-guide.js'),'utf8'),ctx);
  for(const [order,target]of [[11,'newforge'],[12,'newforge'],[14,'equip']]){
    ctx.QuestGuide.follow(c.TASKS.find(t=>t.order===order));assert.equal(tab,target);
  }
});
