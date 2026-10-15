'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine.js');
const tables = require('../tools/config_tables.cjs');
function engine() { const e=createEngine({seed:17}); e.boot(null); return e; }
function activate(c, count) {
  const nodes=c.talentList().filter(e=>!e.def.disabled);
  for(let i=0;i<count;i++) c.G.player.talents.levels[nodes[i].def.id]=1;
}
function ui(e) {
  const c=e.ctx, elements={};
  c.document={getElementById:id=>elements[id] || null};
  vm.runInContext(fs.readFileSync('js/ui.js','utf8'),c,{filename:'js/ui.js'});
  c.uiTowerPanelSnapshot=()=>e.panel('tower');
  return elements;
}
test('Talents Excel／CSV／生成資料一致，新欄位與停用列可往返',()=>{
  const rows=tables.readXlsxRows('config/Excel/Talents.xlsx');
  const csv=tables.csvParse(fs.readFileSync('config/CSV/Talents.csv','utf8').replace(/^\uFEFF/,''));
  assert.deepEqual(csv,rows);
  assert.ok(rows[0].includes('每級增加值')); assert.ok(rows[0].includes('威脅值'));
  for(const old of ['低階值','高階值','每級值','解鎖數']) assert.ok(!rows[0].includes(old));
  const c=engine().ctx;
  const rebuilt=tables.SCHEMAS.Talents.rebuild(rows.slice(1),rows[0]).TALENT_TREES;
  const sandbox={}; vm.runInNewContext(rebuilt,sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.TALENT_TREES)),JSON.parse(JSON.stringify(c.TALENT_TREES)));
  assert.equal(c.talentList().filter(x=>x.def.disabled).length,4);
});
test('首次點亮才增加威脅，升滿不重複增加，降到零與清除移除威脅',()=>{
  const e=engine(),c=e.ctx; c.G.player.reincarnations=10; c.G.player.reincarnationTalentPoints=200;
  assert.equal(c.talentThreatTotal(),0);
  assert.equal(e.cmd('talent.upgrade',{id:'t1_str'}).ok,true); assert.equal(c.talentThreatTotal(),2);
  assert.equal(e.cmd('talent.max',{id:'t1_str'}).ok,true); assert.equal(c.talentThreatTotal(),2);
  assert.equal(e.cmd('talent.downgrade',{id:'t1_str'}).ok,true); assert.equal(c.talentThreatTotal(),2);
  e.cmd('talent.delete',{id:'t1_str'}); assert.equal(c.talentThreatTotal(),0);
  e.cmd('talent.upgrade',{id:'t1_str'}); e.cmd('talent.downgrade',{id:'t1_str'});
  assert.equal(c.talentThreatTotal(),0);
});
test('威脅按表值加總且每滿十點加級，停用節點不計威脅',()=>{
  const c=engine().ctx; activate(c,4); assert.equal(c.talentThreatTotal(),8); assert.equal(c.monsterPowerLevelBonus(),0);
  activate(c,5); assert.equal(c.monsterPowerLevelBonus(),1);
  activate(c,10); assert.equal(c.talentThreatTotal(),20); assert.equal(c.monsterPowerLevelBonus(),2);
  c.G.player.talents.levels.t3_potential=10; assert.equal(c.talentThreatTotal(),20);
  const def=c.talentDef('t1_str'); def.threat=13;
  assert.equal(c.talentThreatTotal(),31); assert.equal(c.monsterPowerLevelBonus(),3);
});
test('百關普通／菁英／野外BOSS均為102級及102級戰鬥數值，獎勵仍按百關',()=>{
  const c=engine().ctx; activate(c,10);
  for(const [elite,boss] of [[false,false],[true,false],[false,true]]) {
    const actual=c.monsterStatsFor(100,elite,boss);
    const strength=c.monsterStatsFor(102,elite,boss,0), rewards=c.monsterStatsFor(100,elite,boss,0);
    assert.equal(actual.level,102);
    for(const key of ['hp','atk','def','mdef','hit','dodge']) assert.equal(actual[key],strength[key],key);
    assert.equal(actual.gold,rewards.gold); assert.equal(actual.xp,rewards.xp);
  }
});
test('三座封魔塔的BOSS實際等級／基準強度同步提高，樓層與獎勵不變',()=>{
  const c=engine().ctx;
  for(const floor of [1,51,101]) {
    const before=c.bossStatsFor(floor,0); activate(c,10);
    const after=c.bossStatsFor(floor); const boss=c.makeBoss(floor);
    assert.equal(after.level,before.level+2); assert.equal(boss.level,after.level);
    assert.ok(after.hp>before.hp); assert.ok(after.atk>before.atk); assert.ok(after.def>before.def);
    assert.equal(after.xp,before.xp); assert.equal(after.hell,before.hell); assert.equal(after.purgatory,before.purgatory);
  }
});
test('高級菁英沿同一強度基準，配點立即同步場上敵人並保留血量比例與狀態',()=>{
  const c=engine().ctx; c.G.player.reincarnations=10; c.G.player.reincarnationTalentPoints=100;
  c.G.stage.current=100; c.G.stage.zone='desert';
  c.spawnEliteWave(false,true);
  const enemies=c.fieldEnemyList(); assert.ok(enemies.length>0);
  const target=enemies[0], before={level:target.level,hp:target.maxHp,atk:target.atk,gold:target.gold,pos:target.pos};
  target.hp=target.maxHp/2; target.effects.test=99;
  activate(c,9); c.talentRefresh();
  const id=c.talentList().filter(x=>!x.def.disabled)[9].def.id;
  c.talentUpgrade(id);
  assert.equal(target.level,before.level+2); assert.ok(target.maxHp>before.hp); assert.ok(target.atk>before.atk);
  assert.equal(target.hp/target.maxHp,0.5); assert.equal(target.effects.test,99); assert.equal(target.pos,before.pos); assert.equal(target.gold,before.gold);
  for(const enemy of enemies) assert.equal(enemy._powerLevelBonus,2);
  c.G.player.talents.levels={}; c.talentRefresh(); assert.equal(target.level,before.level);
  assert.ok(Math.abs(target.maxHp-before.hp)<1e-6); assert.equal(target.hp/target.maxHp,0.5);
});
test('正在戰鬥的封魔塔BOSS即時加級且保留血量比例',()=>{
  const c=engine().ctx; c.TOWER.floor=101; c.TOWER.boss=c.makeBoss(101);
  const b=c.TOWER.boss, old=b.level, hp=b.maxHp, rawHp=c.bossStatsFor(101).hp; b.hp=b.maxHp*0.25;
  activate(c,10); c.talentRefresh();
  assert.equal(b.level,old+2); assert.equal(b.hp/b.maxHp,0.25);
  assert.ok(Math.abs(b.maxHp/(hp*c.bossStatsFor(101).hp/rawHp)-1)<1e-12);
});
test('潛力與威能共用55點預算，零轉／零金幣可升級並正常生效及退點',()=>{
  const e=engine(),c=e.ctx; c.G.player.reincarnations=0; c.G.player.gold=0; c.G.player.reincarnationTalentPoints=55;
  const id=c.POTENTIAL_TALENTS.find(x=>x.type==='passive').id;
  assert.equal(e.cmd('talent.potentialMax',{id}).ok,true); assert.equal(c.potentialLevel(id),10);
  assert.equal(c.potentialSkillActive(id),true); assert.equal(c.potentialSkillMaxLv(),10);
  assert.equal(c.G.player.gold,0); assert.equal(c.G.player.reincarnationTalentPoints,0); assert.equal(c.talentSpentPoints(),55);
  assert.equal(c.potentialSpentSkillPoints(),0); assert.equal(c.talentThreatTotal(),0);
  assert.equal(e.cmd('talent.potentialDelete',{id}).ok,true); assert.equal(c.G.player.reincarnationTalentPoints,55);
  assert.equal(c.potentialSkillActive(id),false);
});
test('舊檔在夾限前按舊制退點與潛力金幣，重新配置後持久化不重複退款',()=>{
  const e=engine(), c=e.ctx, raw=JSON.parse(e.saveJson()); delete raw.powerThreatV1;
  raw.player.reincarnations=10; raw.player.reincarnationTalentPoints=7; raw.player.gold=123;
  raw.player.talents.levels={t1_str:100,t2_crit:51,t10_str:1};
  const id=c.POTENTIAL_TALENTS[0].id; raw.player.talents.potentialLevels={[id]:3};
  raw.player.loadout=['potential:'+id];
  const gold=123+c.skillUpgradeCost(0)+c.skillUpgradeCost(1)+c.skillUpgradeCost(2);
  const migrated=c.migrateSave(raw);
  assert.equal(migrated.player.reincarnationTalentPoints,7+1500+572+19); assert.equal(migrated.player.gold,gold);
  assert.equal(migrated.player.talents.levels.t1_str,0); assert.equal(migrated.player.talents.potentialLevels[id],0);
  assert.equal(migrated.player.loadout.length,0); assert.equal(migrated.powerThreatV1,true); assert.ok(migrated._talentRespecConfirm);
  delete migrated._talentRespecConfirm; delete migrated._talentRespecNotice;
  const again=c.migrateSave(JSON.parse(JSON.stringify(migrated)));
  assert.equal(again.player.reincarnationTalentPoints,migrated.player.reincarnationTalentPoints);
  assert.equal(again.player.gold,gold); assert.equal(again._talentRespecNotice,undefined);
  again.player.talents.levels.t1_str=3; again.player.talents.potentialLevels[id]=4;
  const e2=createEngine({seed:18}); e2.boot(JSON.parse(JSON.stringify(again)));
  assert.equal(e2.ctx.talentLevel('t1_str'),3); assert.equal(e2.ctx.potentialLevel(id),4);
});
test('舊檔低等級也必須退點，新局預帶遷移旗標',()=>{
  const e=engine(),c=e.ctx; assert.equal(c.G.powerThreatV1,true);
  const data={player:{reincarnations:1,reincarnationTalentPoints:2,gold:0,talents:{levels:{t1_str:2},potentialLevels:{}}}};
  c.migratePowerSave(data); assert.equal(data.player.reincarnationTalentPoints,22);
  c.migratePowerSave(data); assert.equal(data.player.reincarnationTalentPoints,22);
});
test('UI由Worker快照顯示魔物威能百分比、精確tips、圖下威脅及潛力成本',()=>{
  const e=engine(),c=e.ctx, elements=ui(e); activate(c,10);
  const snapshot=JSON.parse(JSON.stringify(e.panel('talents')));
  elements['talent-root']={innerHTML:''}; c.uiTalentPanelSnapshot=()=>snapshot; c.uiHeaderPanelSnapshot=()=>e.panel('header');
  c.renderTalents(); const h=elements['talent-root'].innerHTML;
  assert.match(h,/魔物威能 <b>120%/); assert.match(h,/地獄大軍感受到你接收了天堂神力而倍感憤怒/);
  assert.match(h,/魔物威能每增加10%則敵人強度\+1級/); assert.match(h,/tlx-node-threat">威脅值 \+2/);
  assert.equal(c.talentViewPotentialUnlocked(snapshot,c.POTENTIAL_TALENTS[9].id),true);
  assert.equal(c.skillViewPotentialMaxLevel(0),10); assert.equal(c.skillViewPotentialMaxLevel(10),10);
  c.G.player.talents.levels={}; assert.equal(c.talentThreatTotal(c.talentViewLevels(snapshot)),20,'快照不讀主端G');
  const id=c.POTENTIAL_TALENTS[0].id; snapshot.talents.potentialLevels[id]=2; snapshot.talentPoints=2;
  c.UI.selSkill='potential:'+id; elements['skill-modal']={style:{display:'flex'}}; elements['skill-modal-body']={innerHTML:''};
  c.renderSkillModal(e.panel('skills'),snapshot,e.panel('header'));
  const modal=elements['skill-modal-body'].innerHTML;
  assert.match(modal,/轉生威能點：2/); assert.match(modal,/花費 3 點威能點/); assert.match(modal,/退回 2 點威能點/);
  assert.match(modal,/data-skill-learn="potential:[^"]+"[^>]* disabled/); assert.doesNotMatch(modal,/花費.*金幣/);
});

test('主端G為null或不存在時威脅／塔預覽均安全且使用傳入的Worker快照',()=>{
  const e=engine(),c=e.ctx; ui(e); activate(c,10);
  const snapshot=JSON.parse(JSON.stringify(e.panel('talents'))), expected=c.bossStatsFor(1).level;
  c.uiTalentPanelSnapshot=()=>snapshot;
  c.G=null;
  assert.equal(c.talentThreatTotal(),0); assert.equal(c.monsterPowerLevelBonus(),0);
  assert.equal(c.talentThreatTotal(c.talentViewLevels(snapshot)),20);
  assert.equal(c.bossStatsFor(1).level,expected-2);
  assert.match(c.towerDetailHTML(1,0),new RegExp('Lv\\.'+expected));
  const isolated=vm.createContext({console});
  for(const file of ['util','data','formula','talents']) vm.runInContext(fs.readFileSync('js/'+file+'.js','utf8'),isolated);
  assert.equal(isolated.talentThreatTotal(),0); assert.equal(isolated.bossStatsFor(1).level,expected-2);
});
