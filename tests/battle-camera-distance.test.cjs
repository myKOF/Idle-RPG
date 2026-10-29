'use strict';
const test = require('node:test');
const { readExpanded } = require('./helpers/str-expand.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {extractFunction, buildSceneTree, fakePixi} = require('./helpers/battle-scene.cjs');
const root = path.resolve(__dirname, '..');
const source = readExpanded(path.join(root, 'js/battle-renderer.js'));
const DEFAULT = Number(/var BATTLE_CAMERA_DISTANCE_PERCENT = ([\d.]+);/.exec(source)[1]);
function load() {
  const S = buildSceneTree(source);
  const c = {S, Math, Number, isFinite, PIXI: fakePixi, BATTLE_CAMERA_DISTANCE_PERCENT: DEFAULT, perfMode: false,
    playerPos: () => ({x: 30, y: 80}), currentResolution: () => 2, layoutScene() {},
    perspectiveTopScale: () => .82, PERSPECTIVE_MESH_VERTS: 8};
  c.fullscreen = false;
  c.document = {getElementById: id => id === 'ui-shell' ? {classList:{contains: name => name === 'battle-fullscreen' && c.fullscreen}} : null};
  vm.createContext(c);
  for (const name of ['internalCameraDistancePercent', 'cameraFullscreenMultiplier', 'cameraZoom', 'updateCameraDistanceLabel', 'initCameraWheel', 'setCameraViewport', 'boardMetrics', 'resize', 'perspectiveLayout',
    'perspScreenPoint', 'worldToScreenPoint', 'airScreenPose', 'syncPerspective'])
    vm.runInContext(extractFunction(source, name), c);
  return c;
}
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);

function wheelSetup(internal = true) {
  const c = load(), listeners = [];
  const label = {hidden: true, textContent: ''};
  const getElement = c.document.getElementById;
  c.document.getElementById = id => id === 'battle-camera-distance' ? label : getElement(id);
  c.isInternalVersion = () => internal;
  Object.assign(c.S, {ready: true, failed: false, cameraDistancePercent: 100, cameraWheelBound: false});
  c.S.host = {clientWidth: 800, clientHeight: 600,
    addEventListener: (name, handler, options) => listeners.push({name, handler, options})};
  c.S.app.renderer = {resize() {}};
  c.resize();
  c.initCameraWheel();
  function wheel(deltaY, extra = {}) {
    const event = {deltaY, target: {closest: () => null}, prevented: 0, stopped: 0,
      preventDefault() {this.prevented++;}, stopPropagation() {this.stopped++;}, ...extra};
    if (listeners[0]) listeners[0].handler(event);
    return event;
  }
  return {c, label, listeners, wheel};
}

test('CAMERA 內測滾輪100→80%，場景確實拉近且HUD不縮放，反向可還原', () => {
  const {c, label, listeners, wheel} = wheelSetup();
  assert.equal(label.hidden, false); assert.equal(label.textContent, '100%');
  assert.equal(listeners[0].name, 'wheel'); assert.equal(listeners[0].options.passive, false);
  c.initCameraWheel(); assert.equal(listeners.length, 1, '不得重複註冊');
  const baseline = c.S.cameraScale;
  for (let i = 0; i < 4; i++) {
    const e = wheel(-100); assert.equal(e.prevented, 1); assert.equal(e.stopped, 1);
  }
  assert.equal(label.textContent, '80%'); near(c.S.cameraScale, baseline / .8);
  assert.equal(c.S.W, 800); near(c.S.app.stage.scale.x, 1);
  for (let i = 0; i < 4; i++) wheel(100);
  assert.equal(label.textContent, '100%'); near(c.S.cameraScale, baseline);
});

test('CAMERA 全屏百分比統一以正常戰鬥為100%，同尺寸切換即更新且不累積', () => {
  const {c, label, wheel} = wheelSetup();
  const baseline = c.S.cameraScale;
  for (let i = 0; i < 3; i++) {
    c.fullscreen = true; c.resize();
    assert.equal(label.textContent, '77%'); near(c.S.cameraScale, baseline * 1.3);
    wheel(-100); assert.equal(label.textContent, '73%');
    near(c.S.cameraScale, baseline * 1.3 / .95);
    c.fullscreen = false; c.resize();
    assert.equal(label.textContent, '95%'); near(c.S.cameraScale, baseline / .95);
    wheel(100); assert.equal(label.textContent, '100%');
  }
  c.fullscreen = true; c.resize();
  for (let i = 0; i < 4; i++) wheel(-100);
  assert.equal(label.textContent, '62%'); near(c.S.cameraScale, baseline * 1.3 / .8);
});

test('CAMERA 內測距離限制50～200%，到界仍阻止外層捲動，正式版不顯示／不綁定／不套用', () => {
  const {c, label, wheel} = wheelSetup();
  for (let i = 0; i < 80; i++) wheel(-100);
  assert.equal(c.S.cameraDistancePercent, 50); assert.equal(label.textContent, '50%');
  assert.equal(wheel(-100).prevented, 1);
  for (let i = 0; i < 80; i++) wheel(100);
  assert.equal(c.S.cameraDistancePercent, 200); assert.equal(label.textContent, '200%');
  const publicVersion = wheelSetup(false);
  assert.equal(publicVersion.label.hidden, true); assert.equal(publicVersion.listeners.length, 0);
  assert.equal(publicVersion.wheel(-100).prevented, 0);
  publicVersion.c.S.cameraDistancePercent = 50;
  publicVersion.c.resize(); near(publicVersion.c.S.cameraScale, .8);
  publicVersion.c.fullscreen = true; publicVersion.c.resize(); near(publicVersion.c.S.cameraScale, 1.04);
});

test('CAMERA 不攔截HUD／控制元件、瀏覽器縮放／橫向捲動及無效事件；未就緒不縮放', () => {
  const {c, wheel} = wheelSetup();
  for (const extra of [{ctrlKey: true}, {metaKey: true}, {altKey: true}, {shiftKey: true},
    {defaultPrevented: true}, {deltaX: 200}, {target: {closest: () => ({})}}]) {
    const e = wheel(-100, extra); assert.equal(e.prevented, 0); assert.equal(e.stopped, 0);
  }
  for (const delta of [0, NaN, Infinity]) assert.equal(wheel(delta).prevented, 0);
  c.S.ready = false; assert.equal(wheel(-100).prevented, 0);
  c.S.ready = true; c.S.failed = true; assert.equal(wheel(-100).prevented, 0);
  assert.equal(c.S.cameraDistancePercent, 100);
});

test('CAMERA 距離125%擴大視野25%，角色中心不移動，浮字和空中特效使用同一落點', () => {
  const c=load(), S=c.S;
  assert.equal(DEFAULT,125);
  c.setCameraViewport(800,600);
  assert.equal(S.W,1000); assert.equal(S.H,750);
  assert.equal(S.cameraStage.scale.x,.8); assert.equal(S.cameraStage.scale.y,.8);
  S.layers.world.x=S.W/2-30; S.layers.world.y=S.H/2-80;
  for(const top of [1,.82]) {
    S.persp={layout:c.perspectiveLayout(S.W,S.H,top)};
    const centre=c.worldToScreenPoint(30,80);
    near(centre.x,400); near(centre.y,300);
    const point=c.worldToScreenPoint(130,180), air=c.airScreenPose(130,180);
    near(point.x,air.x*.8); near(point.y,air.y*.8);
  }
  for(const key of ['decorAmbient','arenaAmbient','airBack','airPlayer','airFx','enemyAir'])
    assert.equal(S.layers[key].parent,S.cameraStage,key);
  for(const key of ['float','playerHud','overlay']) assert.equal(S.layers[key].parent,S.app.stage,key);
  const before=c.boardMetrics();
  c.BATTLE_CAMERA_DISTANCE_PERCENT=100; c.setCameraViewport(800,600);
  assert.equal(S.W,800); assert.equal(S.cameraStage.scale.x,1);
  assert.equal(c.boardMetrics().rx,before.rx,'名目精靈大小不能因視野變大而抵銷縮放');
});

test('CAMERA 重繪維持實際畫布尺寸，不逐幀重建；改距離會重建，無效距離安全回退', () => {
  const c=load(), calls=[];
  c.S.host={clientWidth:800,clientHeight:600};
  c.S.app.renderer={resize:(w,h)=>calls.push([w,h])};
  c.resize(); c.resize();
  assert.deepEqual(calls,[[800,600]]);
  c.BATTLE_CAMERA_DISTANCE_PERCENT=150; c.resize();
  assert.equal(calls.length,2); near(c.S.cameraScale,2/3);
  for(const invalid of [0,-100,NaN,Infinity]) {
    c.BATTLE_CAMERA_DISTANCE_PERCENT=invalid; near(c.cameraZoom(),.8);
  }
});

test('CAMERA 全螢幕拉近30%，同尺寸切換亦刷新、退出還原且重入不累積', () => {
  const c=load(), S=c.S, calls=[];
  S.host={clientWidth:800,clientHeight:600};
  S.app.renderer={resize:(w,h)=>calls.push([w,h])};
  c.resize();const normal=S.cameraScale,normalWidth=S.W;
  for(let i=0;i<3;i++) {
    c.fullscreen=true;c.resize();
    near(S.cameraScale,normal*1.3);near(S.W,normalWidth/1.3);
    near(S.cameraStage.scale.x,1.04);near(S.cameraStage.scale.y,1.04);
    const count=calls.length;c.resize();assert.equal(calls.length,count,'相同倍率不得逐幀重建');
    c.fullscreen=false;c.resize();near(S.cameraScale,normal);near(S.W,normalWidth);
  }
  assert.equal(calls.length,7);
  c.BATTLE_CAMERA_DISTANCE_PERCENT=150;c.fullscreen=true;near(c.cameraZoom(),(100/150)*1.3);
  c.document.getElementById=()=>null;near(c.cameraZoom(),100/150);
});

test('CAMERA 全螢幕人物中心不移動，透視落點與空中層共用拉近倍率，HUD不縮放', () => {
  const c=load(), S=c.S;c.fullscreen=true;c.setCameraViewport(1920,1080);
  S.layers.world.x=S.W/2-30;S.layers.world.y=S.H/2-80;
  for(const top of [1,.82]) {
    S.persp={layout:c.perspectiveLayout(S.W,S.H,top)};
    const centre=c.worldToScreenPoint(30,80);near(centre.x,960);near(centre.y,540);
    const point=c.worldToScreenPoint(130,180),air=c.airScreenPose(130,180);
    near(point.x,air.x*S.cameraScale);near(point.y,air.y*S.cameraScale);
  }
  for(const key of ['decorAmbient','arenaAmbient','airBack','airPlayer','airFx','enemyAir'])assert.equal(S.layers[key].parent,S.cameraStage,key);
  for(const key of ['float','playerHud','overlay'])assert.equal(S.layers[key].parent,S.app.stage,key);
  near(S.app.stage.scale.x,1);near(S.app.stage.scale.y,1);
});

test('CAMERA BOSS祭壇名目尺寸不膨脹，登場標題仍在實際畫布中央', () => {
  const c=load(), S=c.S;
  c.setCameraViewport(800,600);
  let entered;
  S.arena={enter:o=>{entered=o;},floorTexture:()=>null};
  c.BossArena={tierOf:()=> 'trial',elementOf:()=> 'fire',paletteFor:()=>({name:'arena'})};
  c.screenToGroundY=y=>y/.5;
  c.sceneDrawRect=()=>({x:0,y:0,width:S.W,height:S.H});
  c.syncVignette=()=>{};
  c.syncPerspective=()=>{};
  vm.runInContext(extractFunction(source,'enterArena')+'\n'+extractFunction(source,'layoutScene'),c);
  c.enterArena({monsters:[{pos:{x:260,y:0},name:'BOSS'}],playerPos:{x:0,y:0}},{tower:{floor:1}});
  assert.equal(entered.W,800); assert.equal(entered.H,600);
  c.layoutScene();
  const title=S.layers.arenaTitle;
  near(title.x+S.W/2,400); near(title.y+S.H*.3,180);
});

test('CAMERA 透視貼圖置於鏡頭內且像素密度不膨脹，平行投影可正確切回同一鏡頭', () => {
  const c=load(), S=c.S;
  S.app.renderer={resolution:2};
  c.setCameraViewport(800,600); c.syncPerspective();
  const P=S.persp;
  assert.equal(P.mesh.parent,S.cameraStage);
  assert.equal(S.sceneRoot.parent,null);
  near(P.rt.resolution,1.6);
  // 畫布角落反推必須落在離屏範圍內；鏡頭拉遠不能露白。
  const L=P.layout;
  for(const [xs,ys] of [[0,0],[800,0],[0,600],[800,600]]) {
    const tp=ys/S.cameraScale-L.cy, t=tp/(1+L.beta*tp), w=1-L.beta*t;
    const x=L.cx+(xs/S.cameraScale-L.cx)*w, y=L.cy+t;
    assert.ok(x>=L.x0 && x<=L.x0+L.width && y>=L.y0 && y<=L.y0+L.height);
  }
  assert.equal(P.rt.antialias,true);
  const normalTexture=P.rt, normalScale=S.cameraScale;
  c.perfMode=true; c.syncPerspective();
  assert.ok(normalTexture.destroyed,'切換效能模式必須回收舊貼圖');
  assert.equal(P.rt.antialias,false);
  near(S.cameraScale,normalScale);
  const perfTexture=P.rt;
  c.syncPerspective();
  assert.equal(P.rt,perfTexture,'模式與尺寸不變時不得重建貼圖');
  c.perfMode=false; c.syncPerspective();
  assert.ok(perfTexture.destroyed);
  assert.equal(P.rt.antialias,true,'關閉效能模式恢復抗鋸齒');
  near(P.rt.resolution,1.6);
  c.perspectiveTopScale=()=>1; c.syncPerspective();
  assert.equal(S.sceneRoot.parent,S.cameraStage);
  assert.ok(P.rt.destroyed); assert.ok(P.mesh.destroyed);
});

test('CAMERA 效能模式固定解析度，關閉後恢復一般畫質並保留明確指定倍率', () => {
  const c=load();
  c.devicePixelRatio=2;
  c.uiShellScale=()=>1.5;
  c.resolutionByQuery=()=>null;
  vm.runInContext(extractFunction(source,'currentResolution'),c);
  assert.equal(c.currentResolution(),2.5);
  c.perfMode=true;
  assert.equal(c.currentResolution(),1);
  c.perfMode=false;
  assert.equal(c.currentResolution(),2.5);
  c.perfMode=true; c.resolutionByQuery=()=>.5;
  assert.equal(c.currentResolution(),.5);
});

test('CAMERA 參數表鏡頭列與程式一致，調參只命中具名鏡頭錨點', () => {
  const csv=fs.readFileSync(path.join(root,'config/CSV/game_parameters.csv'),'utf8');
  const row=csv.split(/\r?\n/).find(r=>r.includes(',8-戰鬥畫面,戰鬥鏡頭距離,'));
  assert.ok(row); assert.equal(Number(row.split(',')[6]),DEFAULT);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'battle-camera-'));
  try {
    const file=path.join(temp,'params.csv');
    fs.writeFileSync(file,csv.replace(row,row.replace(',125,',',150,')));
    const r=spawnSync(process.execPath,[path.join(root,'tools/apply_params.cjs')],{
      env:{...process.env,PARAMS_CSV:file},encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    assert.match(r.stdout,/BATTLE_CAMERA_DISTANCE_PERCENT/);
    assert.match(r.stdout,/將變更 1、錨點問題 0/);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
