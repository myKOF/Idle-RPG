'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createEngine}=require('../scripts/sim/engine');
function setup(){const engine=createEngine({seed:1410}).boot(null),c=engine.ctx;let now=c.Date.now();
  c.Date.now=()=>now;c.performance.now=()=>now;
  const send=data=>c.self.onmessage({data});
  return {engine,c,send,advance:ms=>{now+=ms},pause:()=>send({type:c.MSG_IN.MENU_PAUSE,paused:true}),resume:()=>send({type:c.MSG_IN.MENU_PAUSE,paused:false})};}
test('正式Worker暫停時整個G、BOSS／工廠及GT/SIM_T均不推進，恢復不補120秒',()=>{
  const s=setup();s.c.G.player.gold=1e8;s.engine.cmd('tower.start',{floor:1});
  assert.equal(s.c.G.tower.active,true);assert.ok(s.c.TOWER.boss);s.c.TOWER.introCd=0;
  s.c._lastTickAt=s.c.Date.now();s.pause();const before=JSON.stringify(s.c.G),tower=JSON.stringify(s.c.TOWER),gt=s.c.GT,sim=s.c.SIM_T;
  s.advance(120000);for(let i=0;i<5;i++)s.c.loop();assert.equal(JSON.stringify(s.c.G),before);assert.equal(JSON.stringify(s.c.TOWER),tower);assert.equal(s.c.GT,gt);assert.equal(s.c.SIM_T,sim);
  s.resume();s.advance(100);s.c.loop();assert.ok(s.c.SIM_T-sim<=.11);assert.ok(s.c.GT-gt<=.11);
});
test('原本的戰鬥暫停設定不被Esc開關改寫，背景指令排隊到恢復才執行',()=>{
  const s=setup();s.c.setCombatPaused(true);s.pause();s.advance(10000);
  assert.equal(s.c.isCombatPaused(),true);s.send({type:s.c.MSG_IN.CMD,id:501,name:'combat.setPaused',args:{paused:false}});
  assert.equal(s.c.isCombatPaused(),true);assert.equal(s.c._menuDeferredCommands.length,1);s.resume();assert.equal(s.c.isCombatPaused(),false);
  assert.ok(s.engine.outbox().some(x=>x.type===s.c.MSG_OUT.ACK&&x.id===501&&x.ok));
  s.c.setCombatPaused(true);s.pause();s.resume();assert.equal(s.c.isCombatPaused(),true);
});
test('熔爐有待拆裝備時保留傳送帶與倒數，關閉菜單才繼續處理',()=>{
  const s=setup(),f=s.c.G.newForge.furnaces[0];
  f.belt.push(s.c.makeEquipment(1,{rarity:0}));f.timer=.5;
  s.c._lastTickAt=s.c.Date.now();s.pause();const before=JSON.stringify(s.c.G.newForge);
  s.advance(60000);s.c.loop();assert.equal(JSON.stringify(s.c.G.newForge),before);
  s.resume();s.advance(100);s.c.loop();assert.equal(f.belt.length,1);assert.ok(f.timer<.5&&f.timer>0);
});
test('神鑄原本還有4秒，長暫停與重複暫停不造成到期；存檔亦保留4秒',()=>{
  const s=setup();const start=s.c.Date.now();s.c.G.forge.crafting={startedAt:start,durationMs:5000};
  s.advance(1000);s.c._lastTickAt=s.c.Date.now();s.pause();s.advance(120000);s.pause();s.c.loop();
  assert.equal(s.c.G.forge.crafting.startedAt,start);
  s.send({type:s.c.MSG_IN.CMD,id:502,name:'save.auto',args:{}});
  const save=s.engine.outbox().filter(x=>x.type===s.c.MSG_OUT.PERSIST&&x.kind==='autoNow').at(-1);
  assert.ok(save);const data=JSON.parse(save.payload.json);assert.equal(data.forge.crafting.startedAt+5000-s.c.Date.now(),4000);
  s.resume();assert.equal(s.c.G.forge.crafting.startedAt,start+120000);s.advance(100);s.c.loop();assert.ok(s.c.G.forge.crafting);
});
test('暫停前的欠帳保留，但隱藏分頁期間的菜單時間不加入欠帳',()=>{
  const s=setup();s.c._catchupDebt=2;s.c._lastTickAt=s.c.Date.now();s.pause();
  s.advance(3600000);s.send({type:s.c.MSG_IN.VISIBILITY,hidden:true});s.c.loop();assert.equal(s.c._catchupDebt,2);
  s.resume();assert.equal(s.c._catchupDebt,2);s.c.loop();assert.ok(s.c._catchupDebt<.01);
});
test('暫停時仍能PING與索取面板；決定論模式亦不能推進',()=>{
  const s=setup();s.pause();s.c.DETERMINISTIC_STEPS=true;const before=s.c.SIM_T;s.advance(5000);s.c.loop();assert.equal(s.c.SIM_T,before);
  s.send({type:s.c.MSG_IN.PING,t:77});s.send({type:s.c.MSG_IN.PANEL,name:'equip'});
  assert.ok(s.engine.outbox().some(x=>x.type===s.c.MSG_OUT.PONG&&x.t===77));
  assert.ok(s.engine.outbox().some(x=>x.type===s.c.MSG_OUT.PANEL&&x.name==='equip'));
});
test('Worker分批timeout確實接GameClock，暫停期間不執行且恢復只執行一次',()=>{
  const fs=require('node:fs'),path=require('node:path');let now=1000,seq=0,chunks=0;const timers=new Map();
  const c={Date:{now:()=>now},performance:{now:()=>now},self:{postMessage(){}},
    setTimeout(fn,ms){timers.set(++seq,{fn,at:now+ms});return seq},clearTimeout(id){timers.delete(id)}};
  vm.createContext(c);c.importScripts=(...files)=>files.forEach(file=>{
    if (/^(protocol\.js|\.\.\/game-clock\.js)/.test(file))
      vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/worker',file.split('?')[0]),'utf8'),c);
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/worker/sim.worker.js'),'utf8'),c);
  c.G={};assert.equal(c.setTimeout,c.GameClock.setTimeout);
  const advance=ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn()}};
  c.setTimeout(()=>chunks++,100);advance(30);c.setMenuPaused(true);advance(120000);assert.equal(chunks,0);
  c.setMenuPaused(false);advance(69);assert.equal(chunks,0);advance(1);assert.equal(chunks,1);advance(1000);assert.equal(chunks,1);
});
test('Worker開機攜帶菜單暫停時，不會在首次loop偷跑',()=>{
  const s=setup();s.send({type:s.c.MSG_IN.BOOT,save:null,menuPaused:true});
  assert.equal(s.c._menuPaused,true);assert.equal(s.c.GameClock.isPaused(),true);
  const before=s.c.SIM_T;s.advance(10000);s.c.loop();assert.equal(s.c.SIM_T,before);
});
