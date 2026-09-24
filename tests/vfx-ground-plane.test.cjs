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


test('CAM-1 followDirection: false：圖維持作者角度，位置照樣跟著發射方向走',()=>{
  /* 光束尾端的星芒（beam-light 的 sprite-4）要待在尾端，但不該跟著歪——2026-09-24 使用者回報。 */
  const p={schemaVersion:1,id:'cam-beam',duration:10,loop:true,layers:[
    {id:'beam',type:'sprite',assetId:'beam.png',position:{x:200,y:0}},
    {id:'star',type:'sprite',assetId:'star.png',position:{x:200,y:0},followDirection:false}
  ]};
  const r=recorder(),rt=Core.createRuntime({backend:r.backend,resolver});
  rt.registerPreset(p);
  rt.play(p.id,{position:{x:0,y:0},rotation:Math.PI/2});   // 技能朝下打
  rt.update(.1);
  const beam=r.nodes[0].t,star=r.nodes[1].t;
  near(beam.rotation,Math.PI/2);                            // 沒標的：整個轉過去
  near(star.rotation,0);                                    // 標了的：圖不轉
  near(star.x,beam.x);near(star.y,beam.y);                  // 位置一樣跟著轉到 (0,200)
  near(star.x,0);near(star.y,200);
});

test('CAM-2 貼地圖層：位置跟著方向轉，圖維持作者填的 projection.rotation',()=>{
  const p={schemaVersion:1,id:'cam-ground',duration:10,loop:true,layers:[
    {id:'turns',type:'sprite',assetId:'ring.png',position:{x:100,y:0},projection:{x:1,y:.5}},
    {id:'stays',type:'sprite',assetId:'ring.png',position:{x:100,y:0},projection:{x:1,y:.5},followDirection:false}
  ]};
  const r=recorder(),rt=Core.createRuntime({backend:r.backend,resolver});
  rt.registerPreset(p);
  rt.play(p.id,{position:{x:0,y:0},projectionRotation:Math.PI/2});
  rt.update(.1);
  const turns=r.nodes[0].t,stays=r.nodes[1].t;
  assert.ok(Math.abs(turns.rotation)>.5,'沒標的要跟著方向轉，實際 '+turns.rotation);
  near(stays.rotation,0);near(stays.scaleX,1);near(stays.scaleY,.5);   // 壓扁照舊，只是不轉
  near(stays.x,turns.x);near(stays.y,turns.y);                          // 位置一樣跟著轉
  near(stays.x,0);near(stays.y,50);                                     // 轉 90° 再壓 0.5
});

test('CAM-3 粒子：圖不跟著方向轉，發射面位置照樣跟著轉',()=>{
  const layer=extra=>Object.assign({id:'p',type:'particle',assetId:'f.png',
    emission:{mode:'burst',count:1},position:{x:40,y:0},speed:[0,0],direction:0,spread:0,
    lifetime:[3,3],startScale:[1,1],rotationStart:0,
    projection:{x:1,y:.5,rotation:0,upright:true}},extra);
  const run=extra=>{
    const p={schemaVersion:1,id:'cam-particle',duration:3,loop:false,layers:[layer(extra)]};
    const r=recorder(),rt=Core.createRuntime({backend:r.backend,resolver});
    rt.registerPreset(p);rt.play(p.id,{position:{x:0,y:0},rotation:Math.PI/2,projectionRotation:Math.PI/2});
    rt.update(.1);return r.nodes[0].t;
  };
  const turned=run({}),kept=run({followDirection:false});
  near(turned.rotation,Math.PI/2);near(kept.rotation,0,'粒子的圖不跟著轉');
  near(kept.x,turned.x);near(kept.y,turned.y);
});

test('CAM-4 旗標逐層傳給顯示層，共用的 transform 不把上一層的值留給下一層',()=>{
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

test('CAM-5 schema：只收布林、empty 與變形圖層不支援、序列化保留、沒填的一個位元都不變',()=>{
  const one=extra=>({schemaVersion:1,id:'cam-schema',duration:1,layers:[
    Object.assign({id:'a',type:'sprite',assetId:'x.png'},extra)]});
  assert.equal(Core.validatePreset(one({perspective:false})).ok,true);
  assert.equal(Core.validatePreset(one({followDirection:false})).ok,true,'不必有地面投影也能用');
  assert.match(Core.validatePreset(one({perspective:'no'})).errors.join(),/perspective 必須是布林值/);
  assert.match(Core.validatePreset(one({followDirection:1})).errors.join(),/followDirection 必須是布林值/);
  assert.match(Core.validatePreset({schemaVersion:1,id:'cam-empty',duration:1,layers:[
    {id:'e',type:'empty',perspective:false},{id:'a',type:'sprite',assetId:'x.png',parent:'e'}]})
    .errors.join(),/不支援的欄位：perspective/);
  /* 變形圖層的形狀由變形矩陣決定，開關對它沒有作用——收下來靜靜忽略就是 silent fallback */
  const bolt={schemaVersion:1,id:'cam-bolt',duration:1,
    deformation:{axis:'x',start:0,end:100,amplitude:5,widthJitter:.05,mirror:false,layers:['a']},
    layers:[{id:'a',type:'sprite',assetId:'x.png',followDirection:false}]};
  assert.match(Core.validatePreset(bolt).errors.join(),/deformation 圖層不支援/);
  const plain=one({});assert.equal(JSON.parse(Core.serialisePreset(plain)).layers[0].perspective,undefined);
  const marked=one({perspective:false,followDirection:false});
  const back=JSON.parse(Core.serialisePreset(marked)).layers[0];
  assert.equal(back.perspective,false);assert.equal(back.followDirection,false);
});

test('CAM-6 編輯器：兩個勾選預設都勾著，變形圖層留在原位但不能點',()=>{
  const src=fs.readFileSync(path.join(root,'tools/vfx/editor/editor.js'),'utf8');
  const fields=src.slice(src.indexOf('var COMMON_FIELDS'),src.indexOf('var VEC_DEFAULTS'));
  assert.match(fields,/key: 'perspective', label: '受畫面透視影響', kind: 'bool', default: true/);
  assert.match(fields,/key: 'followDirection', label: '跟著發射方向轉', kind: 'bool', default: true/);
  assert.match(fields,/key: 'followStretch', label: '跟著特效拉長', kind: 'bool', default: true/);
  /* 畫面透視對變形圖層開放（整份一起關＝走不變形的畫法，那是閃電唯一能走的路），
     方向與拉長對它們沒有作用，所以停用並說明 */
  const persp=fields.slice(fields.indexOf("key: 'perspective'"),fields.indexOf("key: 'followDirection'"));
  assert.ok(persp.indexOf('enabledWhen')<0,'畫面透視不該對變形圖層停用');
  assert.equal((fields.match(/enabledWhen: cameraFlagAllowed, disabledHint: DEFORMED_LAYER_HINT/g)||[]).length,1,
    '方向那一格對變形圖層停用並說明原因');
  /* 拉長那一個另外排除粒子：粒子的圖本來就只吃等比縮放，Core 也不收 */
  assert.match(fields,/return cameraFlagAllowed\(l\) && l\.type !== 'particle';/);
  /* 欄位不因為「對這一層沒意義」而消失：使用者在看不到某一格時只能猜是不是壞了 */
  const at=src.indexOf('function fieldsOf(');
  const body=src.slice(at,src.indexOf('\n  }',at)+4);
  const fieldsOf=new Function('VFXCore','WATER_TORNADO_HIDDEN_FIELDS',body+'\nreturn fieldsOf;')(Core,[]);
  const list=[{key:'perspective'},{key:'followDirection'},{key:'alpha'}];
  assert.deepEqual(fieldsOf({type:'sprite'},list).map(f=>f.key),['perspective','followDirection','alpha']);
  assert.deepEqual(fieldsOf({type:'empty'},list).map(f=>f.key),['alpha'],'空物件只留 Core 收的欄位');
  /* 變形圖層的判斷看的是 preset.deformation.layers（與 Core 同一份資料） */
  const at2=src.indexOf('function cameraFlagAllowed(');
  const allowedBody=src.slice(at2,src.indexOf('\n  }',at2)+4);
  assert.match(allowedBody,/state\.preset && state\.preset\.deformation/);
  assert.match(src,/if \(f\.enabledWhen && !targets\.every\(f\.enabledWhen\)\) \{\s*control\.disabled = true;/);
});

test('CAM-7 掛在父物件底下的子圖層一樣：圖不轉、位置跟著轉',()=>{
  /* 子物件走的是矩陣分解那條路（updateChildSpriteLayer），與根圖層不是同一段程式 */
  const p={schemaVersion:1,id:'cam-child',duration:10,loop:true,layers:[
    {id:'root',type:'empty',position:{x:0,y:0}},
    {id:'kid',type:'sprite',assetId:'a.png',parent:'root',position:{x:100,y:0}},
    {id:'kid2',type:'sprite',assetId:'b.png',parent:'root',position:{x:100,y:0},followDirection:false}
  ]};
  const r=recorder(),rt=Core.createRuntime({backend:r.backend,resolver});
  rt.registerPreset(p);
  rt.play(p.id,{position:{x:0,y:0},rotation:Math.PI/2});
  rt.update(.1);
  const kid=r.nodes[0].t,kid2=r.nodes[1].t;
  near(kid.rotation,Math.PI/2);
  near(kid2.rotation,0);
  near(kid2.x,kid.x);near(kid2.y,kid.y);near(kid2.x,0);near(kid2.y,100);
});

test('CAM-8 followStretch: false：圖不被拉長，位置照樣跟著拉到尾端',()=>{
  /* 光束（fxKind: chain／beam）會被 Runtime 拉長到敵人身上：scaleX = 距離／標準長度、scaleY = 1。
     2026-09-24 使用者把前兩個開關都取消後，beam-light 尾端的星芒仍被壓扁，來源就是這個。 */
  const p={schemaVersion:1,id:'cam-stretch',duration:10,loop:true,
    sizing:{shape:'custom',widthM:20,heightM:3,authored:{width:200,height:30}},
    layers:[
      {id:'beam',type:'sprite',assetId:'beam.png',position:{x:100,y:0}},
      {id:'star',type:'sprite',assetId:'star.png',position:{x:200,y:0},followStretch:false}
    ]};
  const run=(sx,sy)=>{
    const r=recorder(),rt=Core.createRuntime({backend:r.backend,resolver});
    rt.registerPreset(p);rt.play(p.id,{position:{x:0,y:0},scaleX:sx,scaleY:sy});rt.update(.1);
    return {beam:r.nodes[0].t,star:r.nodes[1].t};
  };
  const wide=run(3,1);
  near(wide.beam.scaleX,3);near(wide.beam.scaleY,1);      // 沒標的：跟著拉長
  near(wide.star.scaleX,1);near(wide.star.scaleY,1);      // 標了的：維持原本長寬比
  near(wide.star.x,600);near(wide.star.y,0);              // 位置照樣跟著拉到尾端
  near(wide.beam.x,300);
  /* 縱向被撐開（場域那種）也要顧到，不能只處理橫軸 */
  const tall=run(1,3);
  near(tall.beam.scaleX,1);near(tall.beam.scaleY,3);
  near(tall.star.scaleX,1);near(tall.star.scaleY,1);
  near(tall.star.x,200);
});

test('CAM-10 子圖層一樣不被拉長，位置照樣跟著拉',()=>{
  /* 子物件走的是矩陣分解那條路，與根圖層不是同一段程式 */
  const p={schemaVersion:1,id:'cam-stretch-child',duration:10,loop:true,
    sizing:{shape:'custom',widthM:20,heightM:3,authored:{width:200,height:30}},
    layers:[
      {id:'root',type:'empty',position:{x:0,y:0}},
      {id:'kid',type:'sprite',assetId:'a.png',parent:'root',position:{x:200,y:0}},
      {id:'kid2',type:'sprite',assetId:'b.png',parent:'root',position:{x:200,y:0},followStretch:false}
    ]};
  const r=recorder(),rt=Core.createRuntime({backend:r.backend,resolver});
  rt.registerPreset(p);
  rt.play(p.id,{position:{x:0,y:0},scaleX:3,scaleY:1});
  rt.update(.1);
  const kid=r.nodes[0].t,kid2=r.nodes[1].t;
  near(kid.scaleX,3);near(kid.scaleY,1);
  near(kid2.scaleX,1);near(kid2.scaleY,1);
  near(kid2.x,kid.x);near(kid2.x,600);
});

test('CAM-9 followStretch 的 schema：粒子與變形圖層不收，序列化保留',()=>{
  const one=extra=>({schemaVersion:1,id:'cam-stretch-schema',duration:1,layers:[
    Object.assign({id:'a',type:'sprite',assetId:'x.png'},extra)]});
  assert.equal(Core.validatePreset(one({followStretch:false})).ok,true);
  assert.match(Core.validatePreset(one({followStretch:0})).errors.join(),/followStretch 必須是布林值/);
  assert.match(Core.validatePreset({schemaVersion:1,id:'cam-stretch-p',duration:1,layers:[
    {id:'p',type:'particle',assetId:'x.png',emission:{mode:'burst',count:1},lifetime:[1,1],
      speed:[0,0],startScale:[1,1],followStretch:false}]}).errors.join(),
    /followStretch 不支援 particle/);
  const back=JSON.parse(Core.serialisePreset(one({followStretch:false}))).layers[0];
  assert.equal(back.followStretch,false);
  assert.equal(JSON.parse(Core.serialisePreset(one({}))).layers[0].followStretch,undefined);
});

test('CAM-11 變形圖層（閃電）要關畫面透視必須整份一起關，且會走 billboard 層',()=>{
  /* 2026-09-24 使用者：落雷希望永遠筆直。又高又細的東西沒辦法就地補償（同一條垂直線在不同
     高度被推往不同橫向位置），只有整份走 billboard 層才是直的——Adapter 的條件正是每一層都標。 */
  const bolt=(marks)=>({schemaVersion:1,id:'cam-bolt',duration:1,
    deformation:{axis:'y',start:0,end:100,amplitude:5,widthJitter:.05,mirror:false,layers:['seg']},
    layers:[{id:'seg',type:'sprite',assetId:'a.png'},{id:'flash',type:'sprite',assetId:'b.png'}]
      .map((l,i)=>marks[i]?Object.assign({},l,{perspective:false}):l)});
  assert.match(Core.validatePreset(bolt([true,false])).errors.join(),/必須整份 preset 的每一層都關/);
  assert.equal(Core.validatePreset(bolt([true,true])).ok,true,'整份都關才收');
  assert.equal(Core.validatePreset(bolt([false,false])).ok,true,'都不關當然可以');
  /* 正式的落雷 preset 已經整份標記，才會走 billboard 層 */
  const sky=read('bolt-sky-lightning');
  assert.equal(Core.validatePreset(sky).ok,true);
  assert.ok(sky.layers.every(l=>l.type==='empty'||l.perspective===false),
    'bolt-sky-lightning 要整份標記，否則落雷會掉回場景層而傾斜');
});
