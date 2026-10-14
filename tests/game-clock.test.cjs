'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
function clock() {
  let time=1000, seq=0; const native=new Map();
  const ctx={Date:{now:()=>time}, performance:{now:()=>time},
    setTimeout(fn,ms){native.set(++seq,{fn,at:time+ms});return seq},clearTimeout(id){native.delete(id)}};
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/game-clock.js'),'utf8'),ctx);
  return {ctx, c:ctx.GameClock, advance(ms){const end=time+ms; let guard=0;
    while(++guard<10000){const next=[...native.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next||next[1].at>end)break;time=next[1].at;native.delete(next[0]);next[1].fn()}
    assert.ok(guard<10000,'不得形成無限排程');time=end;},native};
}
test('暫停時兩個遊戲時鐘停止，恢復後不補時間，真實牆鐘仍可讀',()=>{
  const s=clock();s.advance(100);s.c.setPaused(true);const before=s.c.now();s.advance(120000);
  assert.equal(s.c.now(),before);assert.equal(s.c.wallNow(),1100);s.c.setPaused(false);
  assert.equal(s.c.now(),before);assert.equal(s.c.wallNow(),121100);s.advance(25);assert.equal(s.c.now(),before+25);
});
test('一次工作與循環工作保留剩餘時間，暫停期間新增與取消皆正確',()=>{
  const s=clock(),events=[];s.c.setTimeout(()=>events.push('timeout'),100);const interval=s.c.setInterval(()=>events.push('interval'),200);
  s.advance(50);s.c.setPaused(true);s.c.setTimeout(()=>events.push('new'),75);
  const cancelled=s.c.setTimeout(()=>events.push('bad'),1);s.c.clearTimeout(cancelled);s.advance(60000);assert.deepEqual(events,[]);
  s.c.setPaused(false);s.advance(49);assert.deepEqual(events,[]);s.advance(1);assert.deepEqual(events,['timeout']);
  s.advance(25);assert.deepEqual(events,['timeout','new']);s.advance(75);assert.deepEqual(events,['timeout','new','interval']);
  s.c.clearInterval(interval);s.advance(1000);assert.equal(events.length,3);
});
test('動畫幀也暫停且回呼收到的是遊戲時間',()=>{
  const s=clock();let value;s.c.requestAnimationFrame(t=>{value=t});s.c.setPaused(true);s.advance(5000);
  assert.equal(value,undefined);s.c.setPaused(false);s.advance(16);assert.equal(value,1016);
});
test('Pixi ticker暫停時不能被play重新啟動，原本停止的ticker不自動恢復',()=>{
  const s=clock();const make=started=>({started,start(){this.started=true},stop(){this.started=false}});
  const a=make(true),b=make(false);s.c.trackTicker(a);s.c.trackTicker(b);s.c.setPaused(true);
  assert.equal(a.started,false);a.start();assert.equal(a.started,false);s.c.setPaused(false);
  assert.equal(a.started,true);assert.equal(b.started,false);s.c.setPaused(true);a.stop();s.c.setPaused(false);assert.equal(a.started,false);
});
test('只暫停遊戲畫面的既有Web動畫，不暫停菜單互動',()=>{
  const s=clock();const make=world=>({playState:'running',effect:{target:{closest:()=>world}},pause(){this.playState='paused'},play(){this.playState='running'}});
  const game=make(true),menu=make(false);s.ctx.document={getAnimations:()=>[game,menu]};s.c.setPaused(true);
  assert.equal(game.playState,'paused');assert.equal(menu.playState,'running');s.c.setPaused(false);assert.equal(game.playState,'running');
});

test('暫停只複製最後一幀，恢復移除快照；畫布故障不得阻止暫停',()=>{
  const s=clock();let renders=0,draws=0;const frames=[];
  const parent={insertBefore(frame){frames.push(frame)}};
  const canvas={width:640,height:480,className:'battle-canvas',style:{cssText:'width:640px',visibility:''},parentNode:parent};
  s.ctx.document={createElement(){return {style:{},setAttribute(){},getContext(){return {drawImage(source){assert.equal(source,canvas);draws++}}},remove(){frames.splice(frames.indexOf(this),1)}}}};
  s.c.trackCanvas(canvas,()=>renders++);s.c.setPaused(true);s.advance(120000);s.c.setPaused(true);
  assert.equal(renders,1);assert.equal(draws,1);assert.equal(frames.length,1);assert.equal(canvas.style.visibility,'hidden');
  s.c.setPaused(false);assert.equal(frames.length,0);assert.equal(canvas.style.visibility,'');
  s.c.trackCanvas({...canvas},()=>{throw Error('context lost')});assert.doesNotThrow(()=>s.c.setPaused(true));assert.equal(s.c.isPaused(),true);
});
