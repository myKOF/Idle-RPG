'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');
const plain = x => JSON.parse(JSON.stringify(x));
const boot = state => createEngine({ seed: 1127 }).boot(state || null);

test('新局熟練2級共2點、只有飛刀火球各1級；兩者均可退0級並卸下，讀檔不復活', () => {
  const e=boot(), c=e.ctx, p=c.G.player;
  assert.deepEqual(plain(p.skillMastery), {level:2,xp:0});
  assert.deepEqual(plain(c.skills2PointView()), {total:2,spent:2,available:0});
  assert.equal(c.SKILL_MASTERY_MAX_LEVEL,480);
  assert.equal(c.skills2UpgradeCount(),0,'開局贈送不算執行升級');
  assert.equal(Object.keys(c.SKILLS2).length,23);
  const maxPerGroup=Object.values(c.SKILLS2).map(g=>(g.tiers.length+(g.ult.length?1:0))*c.SG_TIER_MAX_LV);
  assert.ok(maxPerGroup.every(n=>n===80));
  assert.equal(maxPerGroup.reduce((a,b)=>a+b,0),1840);
  assert.equal(maxPerGroup[0]*c.LOADOUT_SIZE.max,480);
  for(const gid of Object.keys(c.SKILLS2))assert.equal(c.skills2StoredLevels(gid)[0],['knife','fireball'].includes(gid)?1:0);
  const gold=p.gold;
  assert.equal(e.cmd('skill2.downgrade',{group:'knife',tier:0}).result,null);
  assert.equal(e.cmd('skill2.downgrade',{group:'fireball',tier:0}).result,null);
  assert.equal(c.skills2UpgradeCount(),0);
  assert.deepEqual(plain(c.skills2PointView()),{total:2,spent:0,available:2});
  assert.equal(p.gold,gold);
  assert.ok(!p.loadout.includes('sg:knife'));
  assert.ok(c.equipSkillToLoadout('sg:knife'));
  assert.equal(c.castSkill2({hp:100,mp:100},[], 'knife','float'),null);
  const saved=JSON.parse(e.saveJson());
  saved.player.loadout=['sg:knife',null,'sg:fireball'];
  const re=boot(saved), rc=re.ctx;
  assert.equal(rc.skills2StoredLevels('knife')[0],0);
  assert.equal(rc.skills2StoredLevels('fireball')[0],0);
  assert.deepEqual(plain(rc.G.player.loadout),[]);
  assert.deepEqual(plain(rc.skills2PointView()),{total:2,spent:0,available:2});
  delete saved.player.skills2.levels.knife;
  assert.equal(boot(saved).ctx.skills2StoredLevels('knife')[0],0,'缺項也不可補回初始投資');
});

test('門檻與GM解鎖不送級；0→1花點與金幣、才可裝載；升熟練精確增加1點', () => {
  const e=boot(),c=e.ctx,p=c.G.player;
  p.level=99;
  assert.equal(c.skills2Levels('firehunt')[0],0);
  p.level=100;
  assert.equal(c.skills2Levels('firehunt')[0],0);
  c.GM_TEST.skillUnlock=true;
  for(const gid of Object.keys(c.SKILLS2))if(!['knife','fireball'].includes(gid))assert.equal(c.skills2Levels(gid)[0],0);
  assert.ok(c.equipSkillToLoadout('sg:firehunt'));
  assert.equal(c.skills2Downgrade('fireball',0),null);
  p.gold=1e12;
  const gold=p.gold,cost=c.skills2UpgradeCost('firehunt',0,0);
  assert.equal(c.skills2Learn('firehunt',0),null);
  assert.equal(c.skills2Levels('firehunt')[0],1);
  assert.equal(p.gold,gold-cost);
  assert.equal(c.skills2PointView().available,0);
  assert.equal(c.equipSkillToLoadout('sg:firehunt'),null);
  c.gainSkillMasteryXp(c.skillMasteryXpForLevel(p.skillMastery.level));
  assert.deepEqual(plain(c.skills2PointView()),{total:3,spent:2,available:1});
  p.skillMastery={level:480,xp:0};
  assert.equal(c.skills2PointView().total,480);
});

for(const oldLevel of [0,100,478,479,480])test(`格式4熟練${oldLevel}重置全退原投資，保留初始技能並且只執行一次`,()=>{
  const state=plain(boot().ctx.G);
  state.saveSchema=4;
  const p=state.player;
  p.skillMastery={level:oldLevel,xp:123};
  p.skills2={levels:{thrust:Array(7).fill(10)},ult:{thrust:{pick:0,lv:10}},upgradeCount:85};
  p.loadout=['sg:thrust',null,'sg:knife','sg:fireball'];
  const gold=p.gold;
  const e=boot(state),c=e.ctx,np=c.G.player;
  // 舊制80級扣除免費第一級，原投入79點；GM超額投資亦完整返還。
  const earned=Math.max(oldLevel,79);
  assert.equal(c.G.saveSchema,5);
  assert.deepEqual(plain(np.skillMastery),{level:Math.max(2,oldLevel),xp:123});
  assert.deepEqual(plain(c.skills2PointView()),{total:earned,spent:2,available:earned-2});
  assert.deepEqual(Object.keys(np.skills2.levels).sort(),['fireball','knife']);
  assert.equal(np.skills2.ult,undefined);
  assert.equal(c.skills2UpgradeCount(),85);
  assert.equal(np.gold,gold);
  assert.deepEqual(plain(np.loadout),[null,null,'sg:knife','sg:fireball']);
  assert.equal(c.skills2Downgrade('knife',0),null);
  const saved=JSON.parse(e.saveJson()), again=boot(saved);
  assert.deepEqual(plain(again.ctx.G.player.skills2),plain(np.skills2));
  assert.deepEqual(plain(again.ctx.skills2PointView()),plain(c.skills2PointView()));
});

test('舊免費23級不轉成點數，保留GM額度與舊任務計數',()=>{
  const state=plain(boot().ctx.G),defs=boot().ctx.SKILLS2;
  state.saveSchema=4;
  state.player.skillMastery={level:100,xp:0};
  state.player.skills2={levels:Object.fromEntries(Object.keys(defs).map(g=>[g,[1,0,0,0,0,0,0]])),legacyPointCredit:17};
  const e=boot(state),c=e.ctx;
  assert.deepEqual(plain(c.skills2PointView()),{total:117,spent:2,available:115});
  assert.equal(c.skills2UpgradeCount(),0);
  assert.equal(c.G.player.skills2.legacyPointCredit,17);
});

test('六組技能確實可用480點全部升滿；全退後不多發點，所有23組解鎖亦不增發',()=>{
  const e=boot(),c=e.ctx,p=c.G.player;
  p.level=1000;p.reincarnations=10;c.G.tower.highest=150;
  p.skillMastery={level:480,xp:0};p.gold=1e30;
  const groups=['knife','fireball','thrust','cleave','gale','bloodblade'];
  for(const group of groups){
    for(let tier=0;tier<7;tier++)assert.equal(e.cmd('skill2.max',{group,tier}).result,true);
    assert.equal(e.cmd('skill2.ultPick',{group,opt:0}).result,null);
    assert.equal(e.cmd('skill2.max',{group,tier:7}).result,true);
    assert.equal(c.sgTotalLevel(group),80);
  }
  assert.deepEqual(plain(c.skills2PointView()),{total:480,spent:480,available:0});
  assert.equal(p.skills2.legacyPointCredit,undefined);
  for(const group of groups)assert.equal(e.cmd('skill2.delete',{group,tier:0}).result,true);
  assert.deepEqual(plain(c.skills2PointView()),{total:480,spent:0,available:480});
  for(const group of Object.keys(c.SKILLS2))assert.equal(e.cmd('skill2.delete',{group,tier:0}).result,true);
  assert.deepEqual(plain(c.skills2PointView()),{total:480,spent:0,available:480});
  assert.equal(p.skills2.legacyPointCredit,undefined);
});

test('退回零級沿用卸下清理實際增益與場域，不影響其他技能',()=>{
  const e=boot(),c=e.ctx,p=c.G.player;
  p.skills2.levels.bloodrage=[1,0,0,0,0,0,0];
  p.loadout=['sg:bloodrage','sg:knife'];
  const ent={hp:100,buffs:{},effects:{},dots:[]};
  c.sgCurrentPlayerEnt=()=>ent;
  c.GT=10;
  c.applyStatus(ent,'sgBloodrage',{val:40,dur:8});
  c.SKILL2_RT.rage={until:18,pEnt:ent,killCombo:0};
  assert.equal(c.statusActive(ent,'sgBloodrage'),true);
  assert.equal(e.cmd('skill2.downgrade',{group:'bloodrage',tier:0}).result,null);
  assert.equal(c.statusActive(ent,'sgBloodrage'),false);
  assert.equal(c.SKILL2_RT.rage,null);
  assert.deepEqual(plain(p.loadout),[null,'sg:knife']);
});

test('無熟練欄位的古老存檔只補初始兩點，歷史預算仍依原基數遷移',()=>{
  for(const budget of [undefined,103]){
    const state=plain(boot().ctx.G);
    state.saveSchema=4;
    delete state.player.skillMastery;
    state.player.skills2={levels:{}};
    if(budget!==undefined)state.player.skillPointBudget=budget;
    const e=boot(state),c=e.ctx,total=budget===undefined?2:100;
    assert.equal(c.G.player.skillMastery.level,total);
    assert.deepEqual(plain(c.skills2PointView()),{total,spent:2,available:total-2});
    assert.equal(c.G.player.skillPointBudget,undefined);
  }
});
