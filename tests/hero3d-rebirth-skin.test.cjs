'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(root+'/js/battle-renderer.js','utf8');
function setup(count=0,enabled=true){
 const pending=[],warnings=[];
 const ctrl=index=>({skinIndex:index,disposed:false,state:{cfg:{clip:'Attack4'},time:1.13,speed:2,yaw:.4,yawTarget:.8},captureState(){return this.state;},restoreState(state){this.state=state;},dispose(){this.disposed=true;}});
 const body=controller=>({hero3d:controller,position:{copyFrom(){}},texture:{destroy(){this.destroyed=true;}},hero3dOutlineTex:{destroy(){this.destroyed=true;}},animationSpeed:1.2,destroy(){this.destroyed=true;this.texture=null;}});
 const initial=ctrl(count),oldBody=body(initial),children=[oldBody];
 const S={hero3d:initial,failed:false,player:{body:oldBody,curAnim:'attack4',baseAnim:'walk',bodyWrap:{getChildIndex:x=>children.indexOf(x),addChildAt(x,i){children.splice(i,0,x);}},outline:{destroy(){this.destroyed=true;}}}};
 const Hero3D={enabled:()=>enabled,instance:initial,create(opts){return new Promise((resolve,reject)=>pending.push({opts,resolve,reject}));},setEnabled(){throw Error('Skin failure must retain enabled appearance');}};
 const c=vm.createContext({S,Hero3D,console:{warn:(...a)=>warnings.push(a)},peekUiPanelData:()=>({player:{reincarnations:count}}),makeHero3dBody:()=>body(S.hero3d),makeOutlineSprite:()=>({}),playHero3dAnim:(p,n)=>{p.curAnim=n;}});
 const start=source.indexOf('  var hero3dWantedSkin ='),end=source.indexOf('  function makeHero3dBody()',start);
 assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),c);
 return{c,S,initial,oldBody,pending,warnings,ctrl,Hero3D};
}
test('0轉Role，1轉以上Role1；無效數值保持基礎外觀',()=>{
 const c=vm.createContext({});vm.runInContext(fs.readFileSync(root+'/js/hero3d.js','utf8'),c);
 for(const n of [0,-1,undefined,NaN])assert.match(c.Hero3D.modelForReincarnations(n),/\/role\.glb\?/);
 for(const n of [1,2,30,'1'])assert.match(c.Hero3D.modelForReincarnations(n),/\/role1\.glb\?/);
});
test('當場1轉交換身體及輪廓，保留實際動作秒數、速度與朝向並釋放舊資源',async()=>{
 const h=setup(),texture=h.oldBody.texture,outline=h.oldBody.hero3dOutlineTex;
 const p=h.c.syncHero3dAppearance(1);assert.equal(h.pending.length,1);assert.equal(h.S.hero3d,h.initial);
 assert.equal(h.c.syncHero3dAppearance(1),null);const next=h.ctrl(1);h.pending[0].resolve(next);await p;
 assert.equal(h.S.hero3d,next);assert.equal(h.S.player.body.hero3d,next);assert.equal(h.S.player.curAnim,'attack4');
 assert.equal(next.state,h.initial.state);assert.equal(h.S.player.body.animationSpeed,1.2);
 assert.equal(h.initial.disposed,true);assert.equal(h.oldBody.destroyed,true);assert.equal(texture.destroyed,true);assert.equal(outline.destroyed,true);assert.equal(h.warnings.length,0);
});
test('轉生數快速變動時過期載入會釋放，回到同一目標仍可重新載入',async()=>{
 const h=setup(),a=h.c.syncHero3dAppearance(1);h.c.syncHero3dAppearance(0);const b=h.c.syncHero3dAppearance(1);
 assert.equal(h.pending.length,2);const stale=h.ctrl(1);h.pending[0].resolve(stale);await a;assert.equal(stale.disposed,true);assert.equal(h.S.hero3d,h.initial);
 const latest=h.ctrl(1);h.pending[1].resolve(latest);await b;assert.equal(h.S.hero3d,latest);
});
test('新皮膚失敗保留原模型，不因每次header快照重複下載；正式服不建立載入',async()=>{
 const h=setup(),p=h.c.syncHero3dAppearance(1);h.pending[0].reject(Error('404'));await p;
 assert.equal(h.S.hero3d,h.initial);assert.equal(h.initial.disposed,false);assert.equal(h.warnings.length,1);
 assert.equal(h.c.syncHero3dAppearance(1),null);assert.equal(h.pending.length,1);
 const off=setup(0,false);assert.equal(off.c.syncHero3dAppearance(1),null);assert.equal(off.pending.length,0);
});
test('讀入已1轉存檔時第一次載入就選新皮膚',async()=>{
 const h=setup(1),p=h.c.loadHero3d();assert.equal(h.pending[0].opts.reincarnations,1);const next=h.ctrl(1);h.pending[0].resolve(next);await p;assert.equal(h.S.hero3d,next);
 assert.match(source,/msg\.name === 'header'.*syncHero3dAppearance\(msg\.data\.player\.reincarnations\)/);
});
function glb(name){
 const bytes=fs.readFileSync(root+'/images/models/hero3d/'+name),n=bytes.readUInt32LE(12);
 const j=JSON.parse(bytes.subarray(20,20+n)),bin=bytes.subarray(28+n);
 const array=index=>{const a=j.accessors[index],v=j.bufferViews[a.bufferView],k={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],size={5121:1,5123:2,5125:4,5126:4}[a.componentType],out=[];for(let i=0;i<a.count;i++)for(let c=0;c<k;c++){const at=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*k)+c*size;out.push(a.componentType===5126?bin.readFloatLE(at):a.componentType===5125?bin.readUInt32LE(at):a.componentType===5123?bin.readUInt16LE(at):bin[at]);}return out;};
 return{j,array,bytes};
}
test('Role1六段動畫每個取樣及骨架與0轉完全相同，手與劍幾何沿用修正結果',()=>{
 const a=glb('role.glb'),b=glb('role1.glb');assert.ok(b.bytes.length<5_000_000);
 assert.deepEqual(b.j.nodes,a.j.nodes);assert.equal(b.j.animations.length,6);
 for(let i=0;i<6;i++){
  const x=a.j.animations[i],y=b.j.animations[i];assert.equal(y.name,x.name);assert.deepEqual(y.channels,x.channels);
  for(let n=0;n<x.samplers.length;n++){assert.equal(y.samplers[n].interpolation,x.samplers[n].interpolation);for(const k of ['input','output'])assert.deepEqual(b.array(y.samplers[n][k]),a.array(x.samplers[n][k]));}
 }
 assert.deepEqual(b.array(b.j.skins[0].inverseBindMatrices),a.array(a.j.skins[0].inverseBindMatrices));
 for(let i=2;i<6;i++)for(const attr of ['POSITION','NORMAL','JOINTS_0','WEIGHTS_0'])assert.deepEqual(b.array(b.j.meshes[0].primitives[i].attributes[attr]),a.array(a.j.meshes[0].primitives[i].attributes[attr]));
 assert.equal(b.j.asset.extras.appearance,'role1');assert.deepEqual(b.j.asset.extras.gripFrame,a.j.asset.extras.gripFrame);
 for(const p of b.j.meshes[0].primitives){
  const count=b.j.accessors[p.attributes.POSITION].count,indices=b.array(p.indices),joints=b.array(p.attributes.JOINTS_0),weights=b.array(p.attributes.WEIGHTS_0);
  assert.ok(indices.every(i=>i>=0&&i<count));assert.ok(joints.every(i=>i<b.j.skins[0].joints.length));assert.ok(b.array(p.attributes.POSITION).every(Number.isFinite));
  for(let i=0;i<weights.length;i+=4)assert.ok(Math.abs(weights[i]+weights[i+1]+weights[i+2]+weights[i+3]-1)<1e-5);
 }
});
