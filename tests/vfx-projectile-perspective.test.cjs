'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const {extractFunction,buildSceneTree,fakePixi}=require('./helpers/battle-scene.cjs');
const Core=require('../js/vfx-core.js'), Runtime=require('../js/vfx-runtime.js');
const Backend=require('../js/vfx-pixi-backend.js');
const source=fs.readFileSync(path.join(__dirname,'../js/battle-renderer.js'),'utf8');
function projection(){
  const c={Math,S:{layers:{world:{x:17,y:-29}},persp:null}};vm.createContext(c);
  for(const name of ['perspectiveLayout','airScreenPose','projectedWarp','projectAirTransform','projectBillboardTransform'])vm.runInContext(extractFunction(source,name),c);
  c.S.persp={layout:c.perspectiveLayout(700,680,.82)};return c;
}
test('空中投影在四角／遠近只改錨點與等比大小，保留素材旋轉和寬高比',()=>{
  const c=projection();
  const backend=Backend.createBackend({PIXI:fakePixi,container:new fakePixi.Container(),projectTransform:c.projectAirTransform});
  for(const x of [0,350,700])for(const y of [0,340,680]){
    const node=new fakePixi.Container();
    const t={x,y,scaleX:2,scaleY:3,rotation:.7,skewX:.1,alpha:.8,visible:true};
    const before=JSON.stringify(t);backend.updateNode(node,t);
    const p=c.S.persp.layout.project(x+17,y-29);
    assert.ok(Math.abs(node.x-p.x)<1e-9);assert.ok(Math.abs(node.y-p.y)<1e-9);
    assert.ok(Math.abs(node.scale.x/node.scale.y-2/3)<1e-9);
    assert.equal(node.rotation,.7);assert.equal(JSON.stringify(t),before);
  }
  assert.ok(c.airScreenPose(350,0).scale<c.airScreenPose(350,680).scale);
  c.S.persp=null;
  assert.equal(c.projectAirTransform({x:10,y:20,scaleX:2,scaleY:3}).scaleY,3);
});
/* 2026-09-24：變形圖層（沿路徑彎折的閃電）的節點位置與縮放是後端從變形矩陣蓋上去的，
   不是從 transform 來的。投影沒有一起套進那份矩陣，整道閃電就會畫在「沒有投影」的位置。 */
test('變形矩陣一起投影：飛行物各自取遠近，billboard 整張同一個倍率，且不就地改 Core 的矩陣',()=>{
  const c=projection();
  const variation={config:{axis:'y',start:0,end:100,amplitude:5},phase:.4,mirror:1,width:1};
  const warp=(x,y)=>({a:1,b:0,c:0,d:1,x:0,y:0,originX:x,originY:y,rotation:.3,scaleX:2,scaleY:2,variation});
  const w1=warp(100,200);
  /* 節點自己的 x／y 刻意跟矩陣原點不同：矩陣要用它自己的原點取遠近，不是節點的 */
  const air=c.projectAirTransform({x:400,y:640,scaleX:1,scaleY:1,deformation:w1});
  const pose=c.airScreenPose(100,200);
  assert.ok(Math.abs(air.deformation.originX-pose.x)<1e-9,'變形圖層要畫在投影後的位置');
  assert.ok(Math.abs(air.deformation.originY-pose.y)<1e-9);
  assert.ok(Math.abs(air.deformation.scaleX-2*pose.scale)<1e-9,'遠近倍率要乘進矩陣的縮放');
  assert.ok(Math.abs(air.deformation.scaleY-2*pose.scale)<1e-9);
  assert.equal(air.deformation.rotation,.3,'角度在矩陣裡，投影不動它');
  assert.notEqual(air.deformation,w1);
  assert.equal(w1.originX,100);assert.equal(w1.scaleX,2);  // Core 每幀重用同一個矩陣物件
  /* billboard：柱頂與柱底只取一次遠近倍率，同一條垂直線不能被推成斜的 */
  const pose2=c.airScreenPose(150,90);
  const top=c.projectBillboardTransform({x:150,y:-310,sortY:90,scaleX:1,scaleY:1,deformation:warp(150,-310)});
  const foot=c.projectBillboardTransform({x:150,y:90,sortY:90,scaleX:1,scaleY:1,deformation:warp(150,90)});
  assert.ok(Math.abs(top.deformation.originX-foot.deformation.originX)<1e-9,'落雷要筆直落下');
  assert.equal(top.deformation.scaleX,foot.deformation.scaleX);
  assert.ok(Math.abs(foot.deformation.scaleX-2*pose2.scale)<1e-9,'整張以錨點的遠近倍率縮放');
  assert.ok(Math.abs((foot.deformation.originY-top.deformation.originY)-400*pose2.scale)<1e-9,
    '雷柱維持原本的直線高度');
  /* 後端真的照投影後的矩陣擺節點（以前掛勾算完就被 updateWarp 蓋掉） */
  const node=Object.assign(new fakePixi.Container(),
    {skew:{set(){}},texture:{orig:{width:64,height:64}}});
  node.__warp={uvs:[0,0,1,0,0,1,1,1],positions:new Float32Array(8),cache:{},point:{},
    geometry:{getBuffer:()=>({update(){}})}};
  const backend=Backend.createBackend({PIXI:fakePixi,Core,container:new fakePixi.Container(),
    projectTransform:c.projectAirTransform});
  backend.updateNode(node,{x:100,y:200,scaleX:1,scaleY:1,anchorX:.5,anchorY:.5,visible:true,
    deformation:warp(100,200)});
  assert.ok(Math.abs(node.x-pose.x)<1e-9,'節點位置來自投影後的矩陣');
  assert.ok(Math.abs(node.y-pose.y)<1e-9);
  assert.ok(Math.abs(node.scale.x-2*pose.scale)<1e-9);
});
test('天地再造紫光柱沿空中保形路徑播放，尺寸為玩家復活白光的一半',()=>{
  const read=id=>JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets',id+'.json'),'utf8'));
  const white=read('pillar-light'),purple=read('pillar-earth');
  assert.deepEqual(purple.layers.map(l=>l.id),white.layers.map(l=>l.id),
    '紫光柱須包含玩家光柱的完整法陣與光暈圖層');
  const layout=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/layouts/pillar-earth.json'),'utf8'));
  assert.deepEqual(layout.groups[0].layerIds,purple.layers.map(l=>l.id));
  const source=new Map(white.layers.map(l=>[l.id,l]));
  for(const layer of purple.layers){
    const base=source.get(layer.id);assert.ok(base,layer.id);
    if(base.position){assert.equal(layer.position.x,base.position.x*.5);assert.equal(layer.position.y,base.position.y*.5);}
    if(base.scale){assert.equal(layer.scale.x,base.scale.x*.5);assert.equal(layer.scale.y,base.scale.y*.5);}
  }
  assert.equal(purple.sizing.authored.height,white.sizing.authored.height*.5);
  const fx=backend(),air=backend(),billboard=backend();
  const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},fxBackend:fx,airBackend:air,billboardBackend:billboard,
    ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:150,y:80}),footOf:()=>({x:150,y:90})}});
  rt.registerPresets([purple]);
  assert.equal(rt.tryPlay({fxKind:'rain',variant:'pillar',targets:['enemy'],hit:false,vfx:{attack:purple.id}}),true);
  rt.update(.2);
  assert.equal(fx.nodes.size,0,'光柱不進入受 FOV 網格拉伸的場景層');
  assert.equal(air.nodes.size,0,'光柱不走逐圖層投影的飛行物路徑');
  assert.ok(billboard.nodes.size>0,'光柱進入共用腳點倍率的 billboard 層');
  const c=projection();
  const bottom=c.projectBillboardTransform({x:150,y:90,sortY:90,scaleX:1,scaleY:1});
  const top=c.projectBillboardTransform({x:150,y:-310,sortY:90,scaleX:1,scaleY:1});
  assert.equal(top.scaleX,bottom.scaleX,'柱頂與柱底只取一次遠近倍率');
  assert.ok(Math.abs((bottom.y-top.y)-400*bottom.scaleX)<1e-9,'柱身保持原本的直線高度');
  rt.destroy();
});
test('空中層位於場景網格外、HUD 之下，Preset 與 legacy 使用独立子容器',()=>{
  const s=buildSceneTree(source),layers=s.layers,stage=s.app.stage;
  assert.equal(layers.airFx.parent,stage);assert.equal(layers.presetAir.parent,layers.airFx);
  assert.equal(layers.airBack.parent,stage);
  assert.ok(stage.children.indexOf(layers.airBack)<stage.children.indexOf(layers.airPlayer));
  assert.ok(stage.children.indexOf(layers.airPlayer)<stage.children.indexOf(layers.airFx));
  assert.ok(stage.children.indexOf(layers.airFx)>stage.children.indexOf(s.sceneRoot));
  assert.ok(stage.children.indexOf(layers.airFx)<stage.children.indexOf(layers.playerHud));
  assert.notEqual(layers.presetAir,layers.airFx);
});
test('空中效果跨過玩家腳點會切換前後；地面受擊效果與角色共用深度排序',()=>{
  const back=new fakePixi.Container(), front=new fakePixi.Container(), entity=new fakePixi.Container();
  let playerY=100;
  const air=Backend.createBackend({PIXI:fakePixi,container:front,depthSort:true,
    depthBackContainer:back,depthSplitY:()=>playerY});
  const node=new fakePixi.Container();
  const pose=y=>({x:20,y,scaleX:1,scaleY:1,sortGroup:7,sortY:y,visible:true});
  air.updateNode(node,pose(90));assert.equal(node.parent.parent,back);
  air.updateNode(node,pose(110));assert.equal(node.parent.parent,front);
  playerY=120;air.updateNode(node,pose(110));assert.equal(node.parent.parent,back);
  air.updateNode(node,{visible:false});assert.equal(back.children.length,0);
  const fx=new fakePixi.Container();
  const hit=Backend.createBackend({PIXI:fakePixi,container:fx,depthSort:true,depthParent:entity});
  const impact=new fakePixi.Container();hit.updateNode(impact,pose(85));
  assert.equal(impact.parent.parent,entity);
  assert.equal(impact.parent.zIndex,85);
});
test('場域特效依畫面水平 Y 與角色交錯，包含狀態與地板後端',()=>{
  assert.match(fs.readFileSync(path.join(__dirname,'../js/vfx-runtime.js'),'utf8'),
    /zoneBackend:\s*VFXPixiBackend\.createBackend\(\{[^}]*depthParent:\s*opts\.fxDepthContainer/);
  const zone=new fakePixi.Container(), entity=new fakePixi.Container();
  entity.sortableChildren=true;
  const player=new fakePixi.Container();player.zIndex=100;entity.addChild(player);
  const backend=Backend.createBackend({PIXI:fakePixi,container:zone,depthSort:true,depthParent:entity});
  const rear=new fakePixi.Container(),front=new fakePixi.Container();
  backend.updateNode(rear,{x:180,y:80,sortGroup:1,sortY:80,visible:true});
  backend.updateNode(front,{x:20,y:120,sortGroup:2,sortY:120,visible:true});
  assert.equal(rear.parent.parent,entity);
  assert.equal(front.parent.parent,entity);
  assert.ok(rear.parent.zIndex<player.zIndex);
  assert.ok(front.parent.zIndex>player.zIndex);
  assert.equal(zone.children.length,0);
});
function backend(){const nodes=new Set();return {nodes,createNode(s){const n={s};nodes.add(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(n){nodes.delete(n);}};}
test('盤點所有 proj 素材：彈體與粒子全部進空中後端，clear 完整回收',()=>{
  const dir=path.join(__dirname,'../vfx/presets');
  const files=fs.readdirSync(dir).filter(f=>/^proj-.*\.json$/.test(f));
  assert.ok(files.length>20);
  for(const file of files){
    const preset=JSON.parse(fs.readFileSync(path.join(dir,file)));const fx=backend(),air=backend(),zone=backend();
    const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},fxBackend:fx,airBackend:air,zoneBackend:zone,
      ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:150,y:80})}});
    rt.registerPresets([preset]);
    assert.ok(rt.tryPlay({fxKind:'projectile',targets:['e'],hit:false,vfx:{projectile:preset.id},travelMs:[2000]}),file);
    rt.update(.1);assert.equal(fx.nodes.size,0,file);assert.ok(air.nodes.size>0,file);
    rt.clear();assert.ok([...air.nodes].every(n=>n.t.visible===false),file);rt.destroy();assert.equal(air.nodes.size,0,file);
  }
});
test('legacy 飛行物與尾粒子使用保形掛載；地面爆炸不移出地面層',()=>{
  for(const name of ['spawnProjectile','spawnBarrageMissile','spawnTrailDot','spawnWindBlade','spawnThunderFall','spawnRain','spawnMeteorProjectile','spawnStarfallMeteor','spawnThrustLine']){
    const body=extractFunction(source,name);assert.match(body,/attachAirFx\(/,name);assert.doesNotMatch(body,/S\.layers\.fx\.addChild\(/,name);
  }
  assert.doesNotMatch(extractFunction(source,'spawnImpact'),/attachAirFx/);
});

test('持續場域維護的飛行雷球／追蹤冰箭／追跡風刃也走空中層，地板維持原層',()=>{
  for(const variant of ['thunder-orb','ice-arrow-homing','wind-blade-homing','blizzard']){
    const fx=backend(),air=backend(),zone=backend();
    const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},fxBackend:fx,airBackend:air,zoneBackend:zone,
      ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:10,y:20})}});
    const p={schemaVersion:1,id:'fixture',duration:1,loop:true,layers:[{id:'body',type:'sprite',assetId:'test',duration:1}]};
    rt.registerPresets([p]);rt.tryPlay({fxKind:'aura',variant,area:{id:variant,x:10,y:20,r:40},dur:.5,vfx:{field:'fixture'},hit:false});rt.update(.1);
    assert.ok((variant==='blizzard'?fx:air).nodes.size>0,variant);
    assert.equal((variant==='blizzard'?air:fx).nodes.size,0,variant);rt.destroy();
  }
});
test('legacy 包裝只做等比縮放，死亡完整釋放包裝與登記',()=>{
  const c=projection();c.PIXI=fakePixi;c.legacyAirNodes=new Map();c.groundToScreenY=y=>y*.62;c.S.layers.airFx=new fakePixi.Container();
  for(const name of ['attachAirFx','syncLegacyAir','killFx'])vm.runInContext(extractFunction(source,name),c);
  const node=new fakePixi.Container();node.x=250;node.y=400;node.scale.set(2,3);c.attachAirFx(node);c.syncLegacyAir();
  const wrapper=node.__airWrapper,p=c.airScreenPose(250,248);
  assert.equal(wrapper.scale.x,wrapper.scale.y);
  assert.ok(Math.abs(wrapper.x+node.x*wrapper.scale.x-p.x)<1e-9);
  assert.equal(node.scale.x,2);assert.equal(node.scale.y,3);
  c.killFx({node});assert.equal(c.legacyAirNodes.size,0);assert.equal(c.S.layers.airFx.children.length,0);
});

/* 2026-09-24：「走不走 billboard 層」以前寫死 pillar-earth，改成看圖層的 perspective 旗標
   （使用者要求的每層勾選）。寫死的話，下一份同樣需求的特效又要改一次程式。 */
test('整份標了 perspective: false 的 preset 走 billboard 層；只標幾層的留在場景層',()=>{
  const make=(id,marks)=>({schemaVersion:1,id,duration:1,layers:marks.map((m,i)=>
    Object.assign({id:'l'+i,type:'sprite',assetId:'a.png'},m?{perspective:false}:{}))});
  const play=(preset)=>{
    const fx=backend(),air=backend(),billboard=backend();
    const rt=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},
      fxBackend:fx,airBackend:air,billboardBackend:billboard,
      ctx:{playerPos:()=>({x:0,y:0}),posOf:()=>({x:150,y:80}),footOf:()=>({x:150,y:90})}});
    rt.registerPresets([preset]);
    assert.equal(rt.tryPlay({fxKind:'rain',variant:'pillar',targets:['enemy'],hit:false,
      vfx:{attack:preset.id}}),true,preset.id);
    rt.update(.2);
    const out={fx:fx.nodes.size,billboard:billboard.nodes.size};rt.destroy();return out;
  };
  assert.deepEqual(play(make('cam-all',[true,true])),{fx:0,billboard:2},'整份都標＝完全不變形的那條路');
  assert.deepEqual(play(make('cam-some',[true,false])),{fx:2,billboard:0},
    '只標幾層的留在場景層，由顯示層就地補償，前後遮擋才不會跳掉');
  assert.deepEqual(play(make('cam-none',[false,false])),{fx:2,billboard:0});
  /* 落雷走的是另一條派送（腳底錨定、跟著目標移動），2026-09-24 一併改成看旗標：
     又高又細的雷柱留在場景層，同一條垂直線在不同高度會被推往不同橫向位置而傾斜。 */
  assert.deepEqual(play(make('bolt-thunderstrike-bluewhite',[true,true])),{fx:0,billboard:2},
    '整份標記的落雷要走 billboard 層才會筆直落下');
  assert.deepEqual(play(make('bolt-thunderstrike-bluewhite',[true,false])),{fx:2,billboard:0},
    '沒整份標記就留在場景層，不能因為是落雷就特別待遇');
  for(const id of ['bolt-sky-lightning','bolt-sky-purple','bolt-thunderstrike-bluewhite']){
    const bolt=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets',id+'.json'),'utf8'));
    assert.ok(bolt.layers.every(l=>l.type==='empty'||l.perspective===false),
      id+' 每一層都要標，否則落雷會掉回場景層而傾斜');
  }
  /* 天地再造的紫光柱靠這份資料維持原本的行為（以前是寫死名字） */
  const pillar=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/pillar-earth.json'),'utf8'));
  assert.ok(pillar.layers.every(l=>l.perspective===false),'pillar-earth 每一層都要標，否則會掉回場景層');
  const runtime=fs.readFileSync(path.join(__dirname,'../js/vfx-runtime.js'),'utf8');
  assert.equal(/billboardPresets\[presetId\]/.test(runtime),true,'路由要看資料');
  assert.equal(/'pillar-earth' && spec\.variant/.test(runtime),false,'不得再用寫死的 preset 名字決定圖層');
});
