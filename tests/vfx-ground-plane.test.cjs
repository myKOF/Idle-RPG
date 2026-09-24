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

/* ============================================================
   CAM — 鏡頭造成的兩種變形，各自一個開關（2026-09-24 使用者要求）

     perspective      畫面透視（遠近）：整個戰鬥畫面的輕微透視網格。false 由顯示層抵銷，
                      整份都標的話 Runtime 改走 billboard 層（見 vfx-projectile-perspective）。
     followDirection  發射方向：貼地圖層在地面平面上跟著技能方向轉。false 維持作者角度。
   兩個都是「沒填＝受影響」，既有 preset 的行為一個位元都不能變。
   ============================================================ */

test('CAM-1 followDirection: false 維持作者角度，沒標的照舊跟著發射方向轉',()=>{
  const p={schemaVersion:1,id:'cam-dir',duration:10,loop:true,layers:[
    {id:'turns',type:'sprite',assetId:'ring.png',projection:{x:1,y:.5}},
    {id:'stays',type:'sprite',assetId:'ring.png',projection:{x:1,y:.5},followDirection:false}
  ]};
  const r=recorder(),rt=Core.createRuntime({backend:r.backend,resolver});
  rt.registerPreset(p);
  rt.play(p.id,{position:{x:0,y:0},projectionRotation:Math.PI/3});
  rt.update(.1);
  const turns=r.nodes[0].t,stays=r.nodes[1].t;
  /* 跟著轉的：橢圓長軸被轉離水平（矩陣第一行的角度不為 0） */
  assert.ok(Math.abs(turns.rotation)>.5,'沒標的要跟著方向轉，實際 '+turns.rotation);
  /* 不跟著轉的：仍是作者畫的水平橢圓，壓扁照舊（projection 是作者資料，不受這個開關影響） */
  near(stays.rotation,0);near(stays.scaleX,1);near(stays.scaleY,.5);
});

test('CAM-2 粒子（含 upright 發射面）一樣吃 followDirection',()=>{
  const layer=extra=>Object.assign({id:'p',type:'particle',assetId:'f.png',
    emission:{mode:'burst',count:1},position:{x:40,y:0},speed:[0,0],direction:0,spread:0,
    lifetime:[3,3],startScale:[1,1],projection:{x:1,y:.5,rotation:0,upright:true}},extra);
  const run=extra=>{
    const p={schemaVersion:1,id:'cam-particle',duration:3,loop:false,layers:[layer(extra)]};
    const r=recorder(),rt=Core.createRuntime({backend:r.backend,resolver});
    rt.registerPreset(p);rt.play(p.id,{position:{x:0,y:0},projectionRotation:Math.PI/2});rt.update(.1);
    return r.nodes[0].t;
  };
  const turned=run({}),kept=run({followDirection:false});
  /* 發射面轉 90°：出生點從 +x 轉到 +y（再壓扁 0.5） */
  near(turned.x,0);near(turned.y,20);
  near(kept.x,40);near(kept.y,0);
});

test('CAM-3 旗標逐層傳給顯示層，共用的 transform 不把上一層的值留給下一層',()=>{
  const p={schemaVersion:1,id:'cam-flags',duration:10,loop:true,layers:[
    {id:'locked',type:'sprite',assetId:'a.png',perspective:false},
    {id:'normal',type:'sprite',assetId:'b.png'},
    {id:'dust',type:'particle',assetId:'c.png',emission:{mode:'burst',count:1},
      lifetime:[3,3],speed:[0,0],startScale:[1,1],perspective:false}
  ]};
  const r=recorder(),rt=Core.createRuntime({backend:r.backend,resolver});
  rt.registerPreset(p);rt.play(p.id,{position:{x:0,y:0}});rt.update(.1);
  assert.equal(r.nodes[0].t.perspective,false);
  assert.equal(r.nodes[1].t.perspective,true,'上一層的 false 不能留給下一層');
  assert.equal(r.nodes[2].t.perspective,false,'粒子也要帶旗標');
  assert.equal(r.nodes[1].t.followDirection,true);
});

test('CAM-4 schema：只收布林、followDirection 要有 projection、empty 不支援、序列化保留',()=>{
  const one=extra=>({schemaVersion:1,id:'cam-schema',duration:1,layers:[
    Object.assign({id:'a',type:'sprite',assetId:'x.png'},extra)]});
  assert.equal(Core.validatePreset(one({perspective:false})).ok,true);
  assert.equal(Core.validatePreset(one({projection:{x:1,y:.5},followDirection:false})).ok,true);
  assert.match(Core.validatePreset(one({perspective:'no'})).errors.join(),/perspective 必須是布林值/);
  assert.match(Core.validatePreset(one({followDirection:false})).errors.join(),
    /followDirection 只能用在有 projection/);
  assert.match(Core.validatePreset({schemaVersion:1,id:'cam-empty',duration:1,layers:[
    {id:'e',type:'empty',perspective:false},{id:'a',type:'sprite',assetId:'x.png',parent:'e'}]})
    .errors.join(),/不支援的欄位：perspective/);
  /* 沒填的 preset 一個位元都不能變（既有 229 份都是這種） */
  const plain=one({});assert.equal(JSON.parse(Core.serialisePreset(plain)).layers[0].perspective,undefined);
  const marked=one({perspective:false,projection:{x:1,y:.5},followDirection:false});
  const back=JSON.parse(Core.serialisePreset(marked)).layers[0];
  assert.equal(back.perspective,false);assert.equal(back.followDirection,false);
});

test('CAM-5 編輯器：兩個勾選預設都勾著，「跟著發射方向轉」只出現在有地面投影的圖層',()=>{
  const src=fs.readFileSync(path.join(root,'tools/vfx/editor/editor.js'),'utf8');
  const fields=src.slice(src.indexOf('var COMMON_FIELDS'),src.indexOf('var VEC_DEFAULTS'));
  assert.match(fields,/key: 'perspective', label: '受畫面透視影響', kind: 'bool', default: true/);
  assert.match(fields,/key: 'followDirection', label: '跟著發射方向轉', kind: 'bool', default: true/);
  assert.match(fields,/when: function \(l\) \{ return !!l\.projection; \}/);
  /* fieldsOf 真的照 when 過濾，而且空物件仍以 Core 的清單為準（那兩個欄位 Core 不收） */
  const at=src.indexOf('function fieldsOf(');
  const body=src.slice(at,src.indexOf('\n  }',at)+4);
  const fieldsOf=new Function('VFXCore','WATER_TORNADO_HIDDEN_FIELDS',body+'\nreturn fieldsOf;')(Core,[]);
  const list=[{key:'perspective'},{key:'followDirection',when:l=>!!l.projection},{key:'alpha'}];
  const keys=layer=>fieldsOf(layer,list).map(f=>f.key);
  assert.deepEqual(keys({type:'sprite'}),['perspective','alpha']);
  assert.deepEqual(keys({type:'sprite',projection:{x:1,y:.5}}),['perspective','followDirection','alpha']);
  assert.deepEqual(keys({type:'empty'}),['alpha'],'空物件只留 Core 收的欄位');
  /* 勾選寫入走既有的 bool 分支（寫 true／false 到每一個選取的圖層） */
  assert.match(src,/control\.onchange = function \(\) \{ MX\.writeAll\(targets, f\.key, control\.checked\);/);
});
