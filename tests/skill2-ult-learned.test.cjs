'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createEngine}=require('../scripts/sim/engine');
const plain=x=>JSON.parse(JSON.stringify(x));
function setup(){
  const e=createEngine({seed:1127}).boot(null),c=e.ctx,p=c.G.player;
  p.level=1000;p.reincarnations=10;p.gold=1e15;p.skillMastery={level:480,xp:0};
  p.skills2={levels:{},ult:{},upgradeCount:0};c.G.tower.highest=150;
  return {e,c,p};
}
test('23組終極：普通七階各1級可選、升級、重選且生效，點數仍逐級消耗',()=>{
  const {e,c,p}=setup();
  for(const group of Object.keys(c.SKILLS2)){
    p.skills2.levels[group]=Array(7).fill(1);
    assert.equal(c.sgUltUnlockedBy(group,c.skills2Levels(group)),true,group);
    const cost=c.skills2UltCost(group,0,0),gold=p.gold,points=c.skills2PointView().available;
    assert.equal(e.cmd('skill2.ultPick',{group,opt:0}).result,null,group);
    assert.equal(p.gold,gold-cost);
    assert.equal(c.skills2PointView().available,points-1);
    assert.equal(c.skills2Ult(group).lv,1);
    assert.equal(e.cmd('skill2.learn',{group,tier:7}).result,null);
    assert.equal(c.skills2Ult(group).lv,2);
    assert.equal(e.cmd('skill2.ultSwitch',{group,opt:1,fromOpt:0,fromLv:2,cost:c.skills2UltCost(group,1,0)}).result,null);
    assert.equal(c.skills2Ult(group).idx,1);
    assert.equal(c.skills2Ult(group).lv,1);
    assert.deepEqual(plain(p.skills2.levels[group]),Array(7).fill(1));
  }
  assert.deepEqual(plain(c.skills2PointView()),{total:480,spent:184,available:296});
});
test('任一普通階未學拒絕首選／升級／重選，不扣金幣、點數或覆寫原投資',()=>{
  const {e,c,p}=setup();
  for(let tier=0;tier<7;tier++){
    p.skills2={levels:{thrust:Array(7).fill(1)},ult:{}};
    p.skills2.levels.thrust[tier]=0;
    const before=plain(p.skills2),gold=p.gold;
    assert.equal(c.sgUltUnlockedBy('thrust',c.skills2Levels('thrust')),false);
    assert.match(e.cmd('skill2.ultPick',{group:'thrust',opt:0}).result,/各學習至少 1 級/);
    assert.deepEqual(plain(p.skills2),{...before,ult:{} });
    p.skills2.ult.thrust={pick:0,lv:2};
    const stored=plain(p.skills2),points=plain(c.skills2PointView());
    assert.match(e.cmd('skill2.learn',{group:'thrust',tier:7}).result,/各學習至少 1 級/);
    assert.match(e.cmd('skill2.ultSwitch',{group:'thrust',opt:1,fromOpt:0,fromLv:2,cost:c.skills2UltCost('thrust',1,0)}).result,/各學習至少 1 級/);
    assert.equal(c.skills2Ult('thrust'),null);
    assert.deepEqual(plain(p.skills2),stored);
    assert.deepEqual(plain(c.skills2PointView()),points);
    assert.equal(p.gold,gold);
  }
});
test('普通10→9仍生效、1→0失效且保留終極；存讀不清投資，重新學習即恢復',()=>{
  const {e,c,p}=setup();
  p.skills2={levels:{thrust:Array(7).fill(10)},ult:{thrust:{pick:0,lv:3}}};
  assert.equal(c.skills2Downgrade('thrust',6),null);
  assert.equal(c.skills2Ult('thrust').lv,3);
  for(let i=0;i<9;i++)assert.equal(c.skills2Downgrade('thrust',6),null);
  assert.equal(c.skills2Ult('thrust'),null);
  assert.deepEqual(plain(p.skills2.ult.thrust),{pick:0,lv:3});
  assert.equal(c.skills2PointView().spent,63);
  const re=createEngine({seed:1127}).boot(JSON.parse(e.saveJson())),rc=re.ctx;
  assert.equal(rc.skills2Ult('thrust'),null);
  assert.equal(re.cmd('skill2.learn',{group:'thrust',tier:6}).result,null);
  assert.equal(rc.skills2Ult('thrust').lv,3);
  assert.equal(rc.skills2StoredLevels('thrust')[6],1);
});
test('終極選項自己的等級／轉生／塔門檻照常擋，達標後才允許學習與生效',()=>{
  const {e,c,p}=setup();
  p.skills2.levels.thrust=Array(7).fill(1);
  // 固定門檻以獨立驗證比較語意，不依賴日後配置數值。
  c.SKILLS2.thrust.ult[0].unlock={reinc:1,lv:250,tower:20};
  for(const [level,reinc,tower] of [[1000,0,150],[249,1,150],[250,1,19]]){
    p.level=level;p.reincarnations=reinc;c.G.tower.highest=tower;
    assert.ok(e.cmd('skill2.ultPick',{group:'thrust',opt:0}).result);
    assert.equal(p.skills2.ult.thrust,undefined);
  }
  p.level=250;p.reincarnations=1;c.G.tower.highest=20;
  assert.equal(e.cmd('skill2.ultPick',{group:'thrust',opt:0}).result,null);
  assert.equal(c.skills2Ult('thrust').lv,1);
  c.G.tower.highest=19;
  assert.equal(c.skills2Ult('thrust'),null);
  assert.ok(e.cmd('skill2.learn',{group:'thrust',tier:7}).result);
  c.G.tower.highest=20;
  assert.equal(c.skills2Ult('thrust').lv,1);
});
test('無G的UI以相同快照呈現已學6/7與7/7、選項門檻及生效狀態',()=>{
  const {e,c,p}=setup();p.skills2.levels.thrust=Array(7).fill(1);
  const ctx={console,setTimeout(){},clearTimeout(){},document:{addEventListener(){},getElementById(){return null},querySelectorAll(){return []}}};ctx.window=ctx;vm.createContext(ctx);
  for(const file of ['util','strings_data','strings','data','status','formula','battlefield','combat','skills','skills2','ui'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),ctx,{filename:file+'.js'});
  ctx.pendingUiButtonAttributes=()=>'';ctx.nodePendingKey=()=>'';
  function html(){const view=plain(e.panel('skills'));ctx.sgbSelectGroup('thrust',view);ctx.UI.sgBrowse.focus='ult';ctx.UI.sgBrowse.ultFocus=0;return ctx.sgbDetailHTML('thrust',view,{player:{gold:1e30}});}
  assert.ok(!ctx.G,'UI沒有權威遊戲狀態，僅讀面板快照');
  assert.match(html(),/data-skill2-ultpick="thrust:0"/);
  p.skills2.levels.thrust[6]=0;
  assert.match(html(),/目前 6／7 階已學習/);
  assert.doesNotMatch(html(),/data-skill2-ultpick/);
  p.skills2.levels.thrust[6]=1;
  c.SKILLS2.thrust.ult[0].unlock={reinc:0,lv:1,tower:151};
  ctx.SKILLS2.thrust.ult[0].unlock={reinc:0,lv:1,tower:151};
  assert.doesNotMatch(html(),/data-skill2-ultpick="thrust:0"/);
  c.G.tower.highest=151;
  assert.match(html(),/data-skill2-ultpick="thrust:0"/);
  assert.equal(c.skills2UltPick('thrust',0),null);
  assert.match(html(),/sgb-ult-card is-chosen/);
  assert.match(html(),/data-skill2-learn="thrust:7"/);
});
