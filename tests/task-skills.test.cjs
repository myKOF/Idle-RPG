'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../scripts/sim/engine');
const { readXlsxRows, csvParse, SCHEMAS } = require('../tools/config_tables.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
function setup(points = 100) {
  const e = createEngine({ seed: 29 }).boot(null), c = e.ctx, p = c.G.player;
  p.level = 1000; p.reincarnations = 10; c.G.tower.highest = 150;
  p.skillMastery = { level: points, xp: 0 }; p.gold = 1e20;
  return {e,c,p};
}
function select(c, type) {
  const idx = c.TASKS.findIndex(t => t.type === type);
  assert.ok(idx >= 0);
  c.G.taskState.idx = idx;
  return c.TASKS[idx];
}
test('Task.xlsx、CSV與遊戲38筆定義逐欄一致，任務順序連續且型別均已接線', () => {
  const root=path.resolve(__dirname,'..');
  const excel=readXlsxRows(path.join(root,'config/Excel/Task.xlsx'))
    .filter(row=>row.some(value=>String(value).trim()!==''));
  const csv=csvParse(fs.readFileSync(path.join(root,'config/CSV/Task.csv'),'utf8'))
    .filter(row=>row.some(value=>String(value).trim()!==''));
  const normalize=rows=>rows.map(row=>Array.from({length:11},(_,i)=>String(row[i]??'')));
  assert.deepEqual(normalize(csv),normalize(excel));
  assert.equal(csv.length,39);
  const {c}=setup();
  const data=SCHEMAS.Task.extract(fs.readFileSync(path.join(root,'js/data.js'),'utf8'));
  assert.deepEqual(data,csv.slice(1).map(row=>row.slice(0,9)));
  assert.deepEqual(Array.from(c.TASKS,t=>t.order),Array.from({length:38},(_,i)=>i+1));
  const source=fs.readFileSync(path.join(root,'js/tasks.js'),'utf8');
  for(const t of c.TASKS) assert.ok(source.includes("case '"+t.type+"'"),t.type);
});
test('裝配任務：預設已裝飛刀不算完成，需再自行裝配 1 個，達成只領一次100000金幣', () => {
  const {e,c,p} = setup();
  p.gold = 1000;
  const goal = select(c, 'skillEquipCount');
  assert.equal(goal.order, 5); assert.equal(goal.count, 2); assert.equal(goal.rewardQty, 200000);
  assert.deepEqual(Array.from(p.loadout), ['sg:knife'], '新角色預設裝上飛刀');
  assert.equal(c.taskProgressFor(goal), 1);
  assert.equal(c.taskQuickView().ready, false);
  assert.ok(c.taskClaim().err);
  p.loadout.push('sg:missing', null, 'old-skill');
  assert.equal(c.taskProgressFor(goal), 1, '無效及舊技能不計');
  p.loadout = ['sg:knife'];
  assert.ok(c.equipSkillToLoadout('sg:knife'), '重複裝配被拒');
  assert.equal(c.taskProgressFor(goal), 1);
  c.unequipSkillFromLoadout('sg:knife');
  assert.equal(c.taskProgressFor(goal), 0);
  assert.equal(c.equipSkillToLoadout('sg:knife'), null);
  assert.equal(c.taskProgressFor(goal), 1);
  assert.equal(c.equipSkillToLoadout('sg:counter'), null);
  assert.equal(c.taskProgressFor(goal), 2);
  assert.equal(e.panel('task').tasks[4].ready, true);
  assert.equal(e.cmd('task.claim').result.claimed, 5);
  assert.equal(p.gold, 201000);
  assert.ok(c.taskClaim().err);
  assert.equal(p.gold, 201000);
});
test('升級任務由單次及一鍵滿級累計，失敗不計，5次領400000金幣', () => {
  const {e,c,p} = setup(5);
  const goal = select(c, 'skillUpgradeCount');
  assert.equal(goal.order, 14); assert.equal(goal.count, 5); assert.equal(goal.rewardQty, 400000);
  assert.equal(c.taskProgressFor(goal), 0, '免費初始技能不計');
  const before = plain(p.skills2);
  p.gold = 0;
  assert.ok(c.skills2Learn('knife', 0));
  assert.deepEqual(plain(p.skills2), before);
  assert.equal(c.taskProgressFor(goal), 0);
  p.gold = 1e15;
  assert.equal(c.skills2Learn('knife', 0), null);
  assert.equal(c.skills2Learn('knife', 1), null);
  assert.equal(e.cmd('skill2.max', {group:'thrust',tier:0}).result, true);
  assert.equal(c.taskProgressFor(goal), 5);
  assert.equal(c.skills2PointView().spent, 5);
  assert.ok(c.skills2Learn('thrust', 0), '點數不足拒絕');
  assert.equal(c.taskProgressFor(goal), 5);
  assert.equal(e.panel('task').tasks[13].ready, true);
  const gold = p.gold;
  assert.equal(e.cmd('task.claim').result.claimed, 14);
  assert.equal(p.gold, gold + 400000);
});
test('降級、重置及存讀不扣累計；重升成功增加一次，任務索引保持', () => {
  const {e,c,p} = setup();
  select(c, 'skillUpgradeCount');
  for(let i=0;i<5;i++) assert.equal(c.skills2Learn('knife',0),null);
  assert.equal(c.skills2Downgrade('knife',0),null);
  assert.equal(c.skills2UpgradeCount(),5);
  assert.equal(c.skills2Learn('knife',0),null);
  assert.equal(c.skills2UpgradeCount(),6);
  assert.equal(e.cmd('skill2.delete',{group:'knife',tier:0}).result,true);
  assert.equal(c.skills2UpgradeCount(),6);
  const reloaded=createEngine({seed:29}).boot(JSON.parse(e.saveJson()));
  assert.equal(reloaded.ctx.skills2UpgradeCount(),6);
  assert.equal(reloaded.ctx.G.taskState.idx,13);
  assert.equal(reloaded.ctx.taskQuickView().ready,true);
});
test('舊存檔以實際儲存投資回推，包含暫鎖階與終極，純讀不寫入', () => {
  const {c,p} = setup();
  p.skills2={levels:{knife:[2,1,3,0,0,0,0]},ult:{knife:{pick:0,lv:2}}};
  p.level=1; p.reincarnations=0;
  const before=plain(p.skills2);
  assert.equal(c.skills2UpgradeCount(),7);
  assert.equal(c.taskProgressFor({type:'skillUpgradeCount'}),7);
  c.taskPanelData();
  assert.deepEqual(plain(p.skills2),before);
  assert.equal(c.skills2Downgrade('knife',0),null);
  assert.equal(c.skills2UpgradeCount(),7);
});
test('終極首選及升級各計一次；切換與降級不計，失敗不計', () => {
  const {c,p} = setup();
  p.skills2={levels:{thrust:Array(7).fill(10)},ult:{}};
  assert.equal(c.skills2UpgradeCount(),69);
  assert.equal(c.skills2UltPick('thrust',0),null);
  assert.equal(c.skills2UpgradeCount(),70);
  assert.equal(c.skills2UltLearn('thrust'),null);
  assert.equal(c.skills2UpgradeCount(),71);
  const cost=c.skills2UltCost('thrust',1,0);
  assert.equal(c.skills2UltSwitch('thrust',1,0,2,cost),null);
  assert.equal(c.skills2UpgradeCount(),71);
  assert.equal(c.skills2UltDowngrade('thrust'),null);
  assert.equal(c.skills2UpgradeCount(),71);
  assert.ok(c.skills2UltLearn('thrust'));
  assert.equal(c.skills2UpgradeCount(),71);
});
test('熔爐任務：只要點過精良標籤（勾選或取消皆算）即達成，點其他品質不算', () => {
  const {e,c} = setup();
  const goal = select(c, 'forgeFineAuto');
  assert.equal(goal.order, 12); assert.equal(goal.count, 1);
  assert.equal(c.taskProgressFor(goal), 0);
  const fid = c.G.newForge.furnaces[0].id;
  assert.equal(e.cmd('newforge.setQuality', {furnaceId:fid, rarity:2, on:true}).result, true);
  assert.equal(c.taskProgressFor(goal), 0, '非精良不算');
  assert.equal(e.cmd('newforge.setQuality', {furnaceId:fid, rarity:1, on:false}).result, true);
  assert.equal(c.taskProgressFor(goal), 1);
});
