'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createEngine} = require('../scripts/sim/engine');

function setup() {
  const e = createEngine({seed: 31}).boot(null), c = e.ctx, p = c.G.player;
  p.level = 1000; p.reincarnations = 10; p.gold = 1e15;
  p.skillMastery = {level: 1000, xp: 0}; c.G.tower.highest = 150;
  return {e, c, p};
}
function select(c, order) {
  const idx = c.TASKS.findIndex(t => t.order === order);
  assert.ok(idx >= 0); c.G.taskState.idx = idx; return c.TASKS[idx];
}
function maxNormal(e, c) {
  for (let tier = 0; tier < c.SKILLS2.knife.tiers.length; tier++) {
    assert.equal(e.cmd('skill2.max', {group: 'knife', tier}).result, true);
  }
}

test('三個指定任務與獎勵參數符合使用者確認內容', () => {
  const {c} = setup();
  const data = [5,13,30].map(order => {
    const t = select(c, order);
    return [t.order,t.type,t.param,t.count,t.rewardType,t.rewardParam || '',t.rewardQty];
  });
  assert.deepEqual(data, [
    [5,'skillTier','knife',2,'scrap','',250],
    [13,'skillTier','knife',3,'gold','',250000],
    [30,'skillUlt','knife:petalStorm',1,'merchantInvitation','',5]
  ]);
  assert.equal(c.TASKS.length, 46);
});

test('普通進階必須實際學會指定階，無須裝配；實際發250碎片及250000金幣，領取不重複', () => {
  const {e,c,p} = setup();
  p.loadout = [];
  const first = select(c, 5), scrap = p.scrap;
  assert.equal(c.taskProgressFor(first), 1);
  assert.ok(e.cmd('task.claim').result.err);
  assert.equal(p.scrap, scrap);
  assert.equal(c.skills2Learn('thrust',0), null);
  assert.equal(c.taskProgressFor(first), 1, '其他技能不算飛刀進化');
  assert.equal(c.skills2Learn('knife',1), null);
  assert.equal(c.taskQuickView().ready, true);
  assert.equal(e.cmd('task.claim').result.claimed, 5);
  assert.equal(p.scrap, scrap + 250);
  assert.ok(e.cmd('task.claim').result.err, '下一項裝配任務尚未完成');
  assert.equal(p.scrap, scrap + 250);

  const second = select(c, 13);
  assert.equal(c.taskProgressFor(second), 2);
  assert.ok(e.cmd('task.claim').result.err);
  assert.equal(c.skills2Learn('knife',2), null);
  assert.equal(e.panel('task').tasks[12].ready, true);
  const gold = p.gold;
  assert.equal(e.cmd('task.claim').result.claimed, 13);
  assert.equal(p.gold, gold + 250000);
  assert.ok(e.cmd('task.claim').result.err);
  assert.equal(p.gold, gold + 250000);
});

test('更高普通階符合前階目標，未領前重置／降級重新計算；錯誤群組不達成', () => {
  const {c,p} = setup();
  const first = select(c, 5), second = c.TASKS.find(t => t.order === 13);
  for (let tier = 1; tier <= 3; tier++) assert.equal(c.skills2Learn('knife',tier), null);
  assert.equal(c.taskProgressFor(first), 4);
  assert.equal(c.taskProgressFor(second), 4);
  for (let tier = 3; tier >= 1; tier--) assert.equal(c.skills2Downgrade('knife',tier), null);
  assert.equal(c.taskQuickView().ready, false);
  assert.equal(c.taskProgressFor({type:'skillTier',param:'missing'}), 0);
  p.skills2.levels = {};
  assert.equal(c.taskProgressFor(first), 1, '重置後仍保留免費初始飛刀');
  assert.equal(c.taskQuickView().ready, false);
});

test('暴雨梨花需學會指定終極，其他選項不算；券累加、面板更新、防重複與存讀', () => {
  const {e,c,p} = setup();
  const goal = select(c, 30);
  c.addMerchantInvitations(7);
  maxNormal(e,c);
  p.loadout = [];
  assert.equal(c.taskProgressFor(goal), 0, '只有解鎖尚未學會不算');
  assert.ok(e.cmd('task.claim').result.err);
  assert.equal(c.skills2UltPick('knife',1), null);
  assert.equal(c.taskProgressFor(goal), 0, '死亡收割者不算暴雨梨花');
  const current = c.skills2Ult('knife');
  const cost = c.skills2UltCost('knife',0,0);
  assert.equal(c.skills2UltSwitch('knife',0,current.idx,current.lv,cost), null);
  assert.equal(c.taskProgressFor(goal), 1);
  c.UI.dirty.tower = false;
  assert.equal(e.cmd('task.claim').result.claimed, 30);
  assert.equal(c.merchantInvitationCount(p), 12);
  assert.equal(c.UI.dirty.tower, true);
  assert.ok(e.cmd('task.claim').result.err);
  assert.equal(c.merchantInvitationCount(p), 12);
  const loaded = createEngine({seed:31}).boot(JSON.parse(e.saveJson())).ctx;
  assert.equal(loaded.G.taskState.idx, 30);
  assert.equal(loaded.merchantInvitationCount(loaded.G.player), 12);
});

test('歷史格式2飛刀遷移的全部合法舊索引保持正確；新局及完整遷移鏈不變', () => {
  const {c} = setup();
  const previous = Array.from(c.TASKS).filter(t => ![11,12,14].includes(t.order));
  previous.splice(13,0,previous.splice(5,1)[0]);
  const oldTasks = previous.filter(t => t.type !== 'skillTier' && t.type !== 'skillUlt');
  const historical = {version:2,migrations:c.SAVE_SCHEMA_MIGRATIONS.filter(m=>m.to<=2)};
  for (const version of [0,1]) for (let idx = 0; idx <= 40; idx++) {
    const old = c.newGameState(); old.saveSchema = version; old.taskState.idx = idx;
    const want = idx + (idx > 4 ? 1 : 0) + (idx > 8 ? 1 : 0) + (idx > 24 ? 1 : 0);
    c.applySaveSchemaMigrations(old,version,historical);
    const out = old;
    assert.equal(out.taskState.idx, want, `格式${version}，舊索引${idx}`);
    if (idx < 40 && ![4,8,24].includes(idx)) assert.equal(previous[want].name, oldTasks[idx].name);
    assert.equal(out.saveSchema, 2);
    c.applySaveSchemaMigrations(out,2,historical);
    assert.equal(out.taskState.idx, want, '重複讀檔不再平移');
  }
  for (const idx of [0,4,9,26,46]) {
    const fresh = c.newGameState(); fresh.taskState.idx = idx;
    assert.equal(c.migrateSave(fresh).taskState.idx, idx);
  }
  const legacy = c.newGameState(); delete legacy.saveSchema; delete legacy.taskInsertChestRelicV1;
  legacy.taskState.idx = 38;
  assert.equal(c.migrateSave(legacy).taskState.idx, 46, '先處理舊38→40項，再轉43及46項');
});

test('新任務導航會進技能頁並展開指定飛刀階級／終極選項', () => {
  const {c} = setup();
  let tab;
  const node = {getClientRects:()=>[{}],matches:()=>false,closest:()=>null,focus(){}};
  const context = {
    UI:{sgBrowse:{filter:'fire',gid:'fireball'}}, SKILLS2:c.SKILLS2, sgUltIndexOfId:c.sgUltIndexOfId,
    $id:id=>id==='ui-shell'?{classList:{contains:()=>false}}:{hidden:false,querySelectorAll:()=>[]},
    document:{querySelector:()=>node},getComputedStyle:()=>({visibility:'visible'}),
    closeQuestModal(){},switchTab:value=>{tab=value;},
    window:{addEventListener(){},removeEventListener(){}}, MutationObserver:class {observe(){} disconnect(){}}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/quest-guide.js'),'utf8'), context);
  for (const [order,focus,index] of [[5,'tier',1],[13,'tier',2],[30,'ult',0]]) {
    context.QuestGuide.follow(c.TASKS.find(t=>t.order===order));
    assert.equal(tab,'skills');
    assert.equal(context.UI.sgBrowse.gid,'knife');
    assert.equal(context.UI.sgBrowse.filter,'all');
    assert.equal(context.UI.sgBrowse.focus,focus);
    assert.equal(context.UI.sgBrowse[focus==='tier'?'tier':'ultFocus'],index);
  }
});
