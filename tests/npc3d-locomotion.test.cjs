'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const ctrl={clips:['Walk','Attack1','Attack2','Attack3','Die'],locomotionMetersPerSecond:2,pxPerMeter:100,duration:()=>3};
 const body={scale:{x:.5},hero3dPlay:()=>{body.animationSpeed=.5;}};
 const c={Hero3D:{create:async()=>ctrl,makeBody:()=>body}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/npc3d.js'),'utf8'),c);
 return {api:c.Npc3D,body,def:{file:'boss.glb',clips:{idle:'Walk',walk:'Walk',attack1:'Attack1',attack2:'Attack2',attack3:'Attack3',die:'Die'}}};
}
test('walk time follows actual world speed and visual size; stopping and pause do not advance feet',async()=>{
 const {api,body,def}=setup();await api.create(def);
 api.move(body,10,.1);api.play(body,'walk');assert.equal(body.animationSpeed,.5);
 api.move(body,5,.1);assert.equal(body.animationSpeed,.25);
 api.move(body,20,.1);assert.equal(body.animationSpeed,1);
 body.scale.x=1;api.move(body,20,.1);assert.equal(body.animationSpeed,.5);
 api.move(body,0,.1);assert.equal(body.animationSpeed,0);
 api.move(body,100,0);assert.equal(body.animationSpeed,0);
});
test('movement rate never changes attack or death timing; returning to walk uses latest displacement',async()=>{
 const {api,body,def}=setup();await api.create(def);
 api.play(body,'attack',2);const attack=body.animationSpeed;
 api.move(body,40,.1);assert.equal(body.animationSpeed,attack);
 api.play(body,'walk');assert.equal(body.animationSpeed,2);
 api.play(body,'die');api.move(body,40,.1);assert.equal(body.animationSpeed,.5);
});
test('NPC animation advances with the same delta as displacement, including slow frames and pause',()=>{
 const source=fs.readFileSync(require.resolve('../js/battle-renderer.js'),'utf8'),c={};
 vm.runInNewContext(source.slice(source.indexOf('  function tickEntityAnimation('),source.indexOf('  function animFrames(')),c);
 const calls=[],ticker={deltaMS:120},entity={npc3d:true,body:{playing:true,update:(...args)=>calls.push(args)}};
 c.tickEntityAnimation(entity,ticker,.12);assert.equal(calls[0][1],.12);
 c.tickEntityAnimation(entity,ticker,0);assert.equal(calls.length,1);
 entity.npc3d=false;c.tickEntityAnimation(entity,ticker,.12);assert.equal(calls[1].length,1);
});
