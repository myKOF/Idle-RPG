'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../js/vfx-core.js');
const Adapter = require('../js/vfx-runtime.js');
const root = path.resolve(__dirname, '..');
const read = id => JSON.parse(fs.readFileSync(path.join(root, 'vfx/presets', id + '.json')));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
function recorder() {
  const nodes=[];
  return {nodes, backend:{createNode(spec){const n={spec};nodes.push(n);return n;},
    updateNode(n,t){n.t={...t};},destroyNode(){}}};
}
const resolver={resolve:id=>id,has:()=>true};
function matrix(t) {return [Math.cos(t.rotation)*t.scaleX,Math.sin(t.rotation)*t.scaleX,
  -Math.sin(t.rotation-(t.skewX||0))*t.scaleY,Math.cos(t.rotation-(t.skewX||0))*t.scaleY];}
function fixture() {return {schemaVersion:1,id:'plane-test',duration:10,loop:true,layers:[
  {id:'floor',type:'sprite',assetId:'ring.png',rotationSpeed:2,projection:{x:1,y:.5}},
  {id:'upright',type:'sprite',assetId:'column.png',position:{x:0,y:-30},scale:{x:1,y:2}}
]};}

test('PLANE-1 旋轉先於投影，圓環全程維持水平橢圓，直立圖層逐幀不變',()=>{
  const p=fixture(), flat=recorder(), original=recorder();
  const a=Core.createRuntime({backend:flat.backend,resolver}),b=Core.createRuntime({backend:original.backend,resolver});
  a.registerPreset(p);const q=structuredClone(p);delete q.layers[0].projection;b.registerPreset(q);
  a.play(p.id,{position:{x:10,y:80},rotation:.4});b.play(p.id,{position:{x:10,y:80},rotation:.4});
  for(let i=0;i<20;i++){
    a.update(.1);b.update(.1);
    const m=matrix(flat.nodes[0].t);
    near(Math.hypot(m[0],m[2]),1);near(Math.hypot(m[1],m[3]),.5);
    near(m[0]*m[1]+m[2]*m[3],0);
    assert.deepEqual(flat.nodes[1].t,original.nodes[1].t);
  }
});

test('PLANE-2 粒子從菱形平面發射，上升速度、本體比例與世界座標拖尾不變',()=>{
  const p={schemaVersion:1,id:'embers',duration:3,loop:false,layers:[{id:'flame',type:'particle',
    assetId:'flame.png',emission:{mode:'burst',count:1},position:{x:40,y:20},speed:[10,10],
    direction:-90,spread:0,lifetime:[3,3],startScale:[1,1],worldSpace:true,
    projection:{x:1,y:.5,rotation:Math.PI/4,upright:true}}]};
  const r=recorder(),a=Core.createRuntime({backend:r.backend,resolver});a.registerPreset(p);
  const h=a.play(p.id,{position:{x:100,y:50}});a.update(.1);const first={...r.nodes[0].t};
  near(first.x,100+20/Math.sqrt(2));near(first.y,50+30/Math.sqrt(2)-1);
  near(first.scaleX,1);near(first.scaleY,1);
  a.setTransform(h,{position:{x:500,y:700},projectionRotation:0});a.update(.1);
  near(r.nodes[0].t.x,first.x);near(r.nodes[0].t.y,first.y-1);
});

test('PLANE-3 真正 Runtime 使用原世界邊長／方向，play、續命與成長都只投影一次',()=>{
  const p=read('ground-mire-magma'),before=JSON.stringify(p);
  for(const k of [.4,.5,.7,1]){
    const r=recorder(),a=Adapter.create({core:Core,resolver,fxBackend:r.backend,zoneBackend:r.backend,groundScale:k,
      ctx:{posOf:()=>({x:0,y:0}),playerPos:()=>({x:0,y:0})}});
    a.registerPresets([p]);
    const event=size=>({fxKind:'aura',dur:4,vfx:{ground:p.id},area:{id:'mud',x:80,y:100,w:size,h:size,r:size/2,a:Math.PI/4}});
    assert.equal(a.tryPlay(event(120)),true);a.update(.4);
    const n=r.nodes.find(n=>n.spec.assetUrl.includes('mud-flow'));
    const check=()=>{const t=n.t,m=matrix(t);near(t.x,80);near(t.y,100*k);
      near(m[1]/m[0],k);near(m[3]/m[2],-k);return Math.hypot(m[0],m[1]/k);};
    const start=check();a.tryPlay(event(240));for(let i=0;i<30;i++)a.update(.1);
    assert.ok(check()>start*1.9,'成長保留且沒有第二次投影');
    assert.equal(r.nodes.filter(n=>n.spec.assetUrl.includes('mud-flow')).length,1,'續命不重播');
  }
  assert.equal(JSON.stringify(p),before,'註冊不得污染編輯器 Preset');
});

test('PLANE-4 泥沼／暴風雪判定與顯示共用菱形四邊，牆型判定不變',()=>{
  const c={console,window:null,document:{addEventListener(){},getElementById(){return null;},querySelectorAll(){return[];}},UI:{dirty:{}}};
  c.window=c;vm.createContext(c);
  for(const file of ['util','data','status','formula','battlefield','combat','skills','skills2','legendary'])
    vm.runInContext(fs.readFileSync(path.join(root,'js',file+'.js'),'utf8'),c);
  c.bfEntityRadius=()=>0;
  const enemy=(id,x,y)=>({id,hp:100,pos:{x,y}});
  const pool=[enemy('top',0,80),enemy('right',80,0),enemy('old-corner',55,55),enemy('beyond-tip',90,0),enemy('center',0,0)];
  for(const kind of ['mire','blizzard']){
    const f={kind,pos:{x:0,y:0},length:120,width:120,angle:0,vfxId:kind};
    near(c.sgGroundArea(f).a,Math.PI/4);
    assert.deepEqual(Array.from(c.sgGroundVictims(f,pool),e=>e.id),['top','right','center']);
    c.bfEntityRadius=()=>5;
    assert.equal(c.sgGroundVictims(f,[enemy('body-touch',88,0)]).length,1,'保留體型邊緣接觸');
    c.bfEntityRadius=()=>0;
    near(c.sgGroundArea({...f,length:240,width:240}).w,240);
  }
  near(c.sgGroundRectAxis({kind:'wall',angle:.2}),.2+Math.PI/2);
});

test('PLANE-5 正式素材投影可序列化，圖集補償／直立本體與 schema 驗證保留',()=>{
  let count=0;
  for(const file of fs.readdirSync(path.join(root,'vfx/presets'))){
    const p=read(file.replace(/\.json$/,''));assert.equal(Core.validatePreset(p).ok,true,p.id);
    assert.deepEqual(JSON.parse(Core.serialisePreset(p)),p,p.id);
    if(p.layers.some(l=>l.projection))count++;
  }
  assert.ok(count>=80);
  const hex=read('aura-earthguard-hexagram').layers[0];near(hex.scale.y*.65*hex.projection.y/hex.scale.x,.5);
  for(const id of ['field-fire-tornado','field-water-tornado']){
    const body=read(id).layers.find(l=>/baked-.*-column/.test(l.id));assert.equal(body.projection,undefined);
  }
  const bad=fixture();bad.layers[0].projection.rotaiton=1;assert.equal(Core.validatePreset(bad).ok,false);
  delete bad.layers[0].projection.rotaiton;bad.layers[0].projection.y=NaN;assert.equal(Core.validatePreset(bad).ok,false);
});
