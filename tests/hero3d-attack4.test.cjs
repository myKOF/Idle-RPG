'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const renderer=fs.readFileSync(root+'/js/battle-renderer.js','utf8');
function harness(){
 const start=renderer.indexOf('  function playerAttackAnim('),end=renderer.indexOf('\n  function ',start+10);
 assert.ok(start>=0&&end>start);
 const names=[],player={body:{hero3d:true,naturalMs:2366,hitMs:1070,animationSpeed:.25},sheetName:'player',curAnim:'idle',lastAttack:'',walking:false};
 let sample=123456789;
 const c=vm.createContext({Math:Object.assign(Object.create(Math),{random:()=>{sample=(Math.imul(sample,1664525)+1013904223)>>>0;return sample/4294967296;}}),S:{player,sheets:{player:{manifest:{anims:{}}}}},nowMs:()=>0,
  playAnim:(p,name,base)=>{names.push(name);p.curAnim=name;p.body.animationSpeed=.25;},playerAttackAnimNames:()=>['attack1','attack2']});
 for(const name of ['HERO3D_ATTACKS','HERO3D_CASTS','HERO3D_ACTIONS','HERO3D_CAST_MAX_MS','HERO3D_CAST_SPEED_MAX']){
  const line=renderer.match(new RegExp('  var '+name+' = [^;]+;'));
  assert.ok(line,name);vm.runInContext(line[0],c);
 }
 vm.runInContext(renderer.slice(start,end),c);
 return{c,player,names};
}
test('真實普攻選招邏輯可抽到四招，且從不連抽同招',()=>{
 const h=harness();for(let i=0;i<300;i++){h.player.curAnim='idle';h.c.playerAttackAnim('melee',null,.5,0);}
 assert.deepEqual([...new Set(h.names)].sort(),['attack1','attack2','attack3','attack4']);
 for(let i=1;i<h.names.length;i++)assert.notEqual(h.names[i],h.names[i-1]);
 for(const n of ['attack1','attack2','attack3','attack4'])assert.ok(h.names.filter(x=>x===n).length>30);
});
test('第四招播放中不被技能插隊，技能仍只使用原三招',()=>{
 const h=harness();h.player.curAnim='attack4';h.c.playerAttackAnim('cast',null,0,200);assert.equal(h.names.length,0);
 for(let i=0;i<60;i++){h.player.curAnim='idle';h.c.playerAttackAnim('cast',null,0,200);}
 assert.deepEqual([...new Set(h.names)].sort(),['attack1','attack2','attack3']);
});
test('attack4有獨立GLB動畫與完整起手收招，沿用既有普攻速度調整',()=>{
 const c=vm.createContext({});vm.runInContext(fs.readFileSync(root+'/js/hero3d.js','utf8'),c);
 const cfg=c.Hero3D.CLIP_FOR.attack4;assert.equal(cfg.clip,'Attack4');assert.equal(cfg.start,0);assert.equal(cfg.loop,false);
 assert.ok(cfg.hit>0&&cfg.hit<cfg.end);assert.ok(Math.abs(cfg.end-2.366667)<.001);
 const b=fs.readFileSync(root+'/images/models/hero3d/role.glb'),j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
 assert.equal(j.animations.filter(x=>x.name==='Attack4').length,1);
 const h=harness();h.player.lastAttack='attack3';for(let i=0;i<15&&!h.names.includes('attack4');i++){h.player.curAnim='idle';h.c.playerAttackAnim('melee',null,.5,0);}
 assert.ok(h.names.includes('attack4'));assert.ok(h.player.body.animationSpeed>.25);
});
