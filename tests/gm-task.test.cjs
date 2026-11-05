'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine');
const plain = value => JSON.parse(JSON.stringify(value));
function setup(hostname = 'localhost') {
  const e = createEngine({seed:41}).boot(null), c = e.ctx;
  c.location.hostname = hostname;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/ai-key-setting.js'),'utf8'), c);
  return {e,c};
}
test('任務白話：重置／完成／跳至第N項／查詢及複合句，對應明確指令', () => {
  const {c} = setup(), ai=c.AiKeySetting;
  for(const s of ['重置所有任務','請幫我重置所有任務','把主線任務全部重置','重置任務進度','將全部的任務歸零'])
    assert.deepEqual(Array.from(ai.parseFastPath(s)),['task reset'],s);
  for(const s of ['完成所有任務','全部任務設為已完成','把所有主線任務標記為完成','任務全部完成'])
    assert.deepEqual(Array.from(ai.parseFastPath(s)),['task complete'],s);
  for(const s of ['跳到第13個任務','把任務設為第13項','將任務進度調整到第13個任務','任務跳至13'])
    assert.deepEqual(Array.from(ai.parseFastPath(s)),['task goto 13'],s);
  for(const s of ['查詢目前任務進度','查看任務狀態','當前任務進度'])
    assert.deepEqual(Array.from(ai.parseFastPath(s)),['task status'],s);
  assert.deepEqual(Array.from(ai.parseFastPath('重置所有任務，然後加金幣10')),['task reset','gold 10']);
  for(const s of ['不要重置所有任務','重置所有任務嗎？','完成所有任務但不要改進度','重置所有任務，然後做未知事情','跳到第1.5個任務'])
    assert.equal(ai.parseFastPath(s),null,s);
  assert.ok(Array.from(ai.getNaturalPresets()).some(x=>x.prompt==='重置所有任務'));
});
test('白話實際透過gm.exec重置任務，僅改索引、保留養成統計與資源', () => {
  const {e,c}=setup();
  c.G.taskState.idx=12;
  c.G.factory.stats.upgraded=40;
  c.G.player.skills2.upgradeCount=8;
  const before=plain(c.G);
  const cmd=c.AiKeySetting.parseFastPath('重置所有任務')[0];
  assert.equal(e.cmd('gm.exec',{line:cmd}).result.ok,true);
  assert.equal(c.G.taskState.idx,0);
  before.taskState.idx=0;
  assert.deepEqual(plain(c.G),before);
  assert.equal(c.UI.dirty.task,true);
  const reloaded=createEngine({seed:41}).boot(JSON.parse(e.saveJson()));
  assert.equal(reloaded.ctx.G.taskState.idx,0);
  assert.equal(reloaded.ctx.G.player.skills2.upgradeCount,8);
});
test('goto採1起序號、含最後一項；全部完成不發獎勵；舊數字行為相容', () => {
  const {e,c}=setup(), max=c.TASKS.length;
  const resources=plain(c.G.player),inv=plain(c.G.inventory);
  for(const n of [1,5,13,max]){
    const res=e.cmd('gm.exec',{line:'task goto '+n}).result;
    assert.equal(res.ok,true); assert.equal(c.G.taskState.idx,n-1);
    if(n>1) assert.match(res.message,new RegExp('第 '+n+' 個'));
  }
  assert.equal(e.cmd('gm.exec',{line:'task complete'}).result.ok,true);
  assert.equal(c.G.taskState.idx,max);
  assert.match(c.executeGMCommand('task status').message,/所有任務已完成/);
  c.executeGMCommand('task reset');assert.equal(c.G.taskState.idx,0);
  c.executeGMCommand('task 5');assert.equal(c.G.taskState.idx,5);
  assert.match(c.executeGMCommand('task 5').message,/第 6 個/);
  c.executeGMCommand('task 99');assert.equal(c.G.taskState.idx,max);
  assert.deepEqual(plain(c.G.player),resources);
  assert.deepEqual(plain(c.G.inventory),inv);
});
test('查詢純讀且顯示實際技能升級進度；非法參數與外部host不改狀態', () => {
  const {c}=setup(); c.G.taskState.idx=13;c.G.player.skills2.upgradeCount=3;
  const before=plain(c.G);
  assert.match(c.executeGMCommand('task status').message,/第 14 個.*3\/5/);
  assert.deepEqual(plain(c.G),before);
  for(const line of ['task','task 1.5','task -1','task NaN','task 100001','task goto','task goto 0','task goto 39','task goto 1.5','task goto 1 extra','task reset extra','task complete extra','task status extra','task 0 extra']){
    assert.equal(c.executeGMCommand(line).ok,false,line);
    assert.deepEqual(plain(c.G),before,line);
  }
  c.location.hostname='example.com';
  for(const line of ['task reset','task complete','task goto 1'])assert.equal(c.executeGMCommand(line).ok,false);
  assert.deepEqual(plain(c.G),before);
});
