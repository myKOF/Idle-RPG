'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {extractFunction, buildSceneTree, fakePixi} = require('./helpers/battle-scene.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
const DEFAULT = Number(/var BATTLE_CAMERA_DISTANCE_PERCENT = ([\d.]+);/.exec(source)[1]);
function load() {
  const S = buildSceneTree(source);
  const c = {S, Math, Number, isFinite, PIXI: fakePixi, BATTLE_CAMERA_DISTANCE_PERCENT: DEFAULT,
    playerPos: () => ({x: 30, y: 80}), currentResolution: () => 2, layoutScene() {},
    perspectiveTopScale: () => .82, PERSPECTIVE_MESH_VERTS: 8};
  vm.createContext(c);
  for (const name of ['cameraZoom', 'setCameraViewport', 'boardMetrics', 'resize', 'perspectiveLayout',
    'perspScreenPoint', 'worldToScreenPoint', 'airScreenPose', 'syncPerspective'])
    vm.runInContext(extractFunction(source, name), c);
  return c;
}
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);

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
  c.perspectiveTopScale=()=>1; c.syncPerspective();
  assert.equal(S.sceneRoot.parent,S.cameraStage);
  assert.ok(P.rt.destroyed); assert.ok(P.mesh.destroyed);
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
