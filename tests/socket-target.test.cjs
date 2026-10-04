const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function mount() {
  const c = { console, UI: { dirty: {} }, G: { player: { gems: { ruby: { 1: 2, 5: 3 } }, fusedGems: [] } } };
  c.window = c; vm.createContext(c);
  for (const name of ['util','data','status','formula','item']) vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),c);
  c.G = { player: { gems: { ruby: { 1: 2, 5: 3 } }, fusedGems: [] } };
  c.markStatsDirty = () => {};
  c.it = { id:'gear', slot:'weapon', rarity:5, level:50, sockets:[null,null,null,null] };
  return c;
}
test('指定孔及階級只消耗選中寶石；舊呼叫仍第一空孔／最高階', () => {
  const c=mount();
  assert.equal(c.socketGem(c.it,'ruby',2,1),null);
  assert.equal(c.it.sockets[0],null);assert.equal(c.it.sockets[2].level,1);
  assert.equal(c.gemCount('ruby',1),1);assert.equal(c.gemCount('ruby',5),3);
  assert.equal(c.socketGem(c.it,'ruby'),null);
  assert.equal(c.it.sockets[0].level,5);assert.equal(c.gemCount('ruby',5),2);
});
test('非法孔／已鑲孔／缺庫存／非法階級不能覆蓋或扣庫存', () => {
  const c=mount();c.socketGem(c.it,'ruby',2,1);
  for(const [index,level] of [[2,1],[-1,1],[4,1],[1.5,1],[1,0],[1,99],[1,2]]) {
    const before=JSON.stringify({it:c.it,p:c.G.player});
    assert.equal(typeof c.socketGem(c.it,'ruby',index,level),'string');
    assert.equal(JSON.stringify({it:c.it,p:c.G.player}),before);
  }
});
test('融合宝石指定孔、拒絕覆蓋且卸下返還原實例', () => {
  const c=mount(), fg={id:'f',level:5,stats:[{type:'ruby',mult:1}],fusions:1};
  c.G.player.fusedGems=[fg];c.it.sockets[1]={type:'ruby',level:1};
  assert.equal(typeof c.socketFusedGem(c.it,'f',1),'string');assert.equal(c.G.player.fusedGems.length,1);
  assert.equal(c.socketFusedGem(c.it,'f',3),null);assert.equal(c.it.sockets[3].fused,fg);
  assert.equal(c.unsocketGem(c.it,3),true);assert.equal(c.it.sockets[3],null);assert.equal(c.G.player.fusedGems[0],fg);
});
