'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/battle-scene.cjs');
const root=path.resolve(__dirname,'..'),cfg=require('../tools/config_tables.cjs');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'images/sprites/npc/npc.json')));
const renderer=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8');
function data(){const c={console};vm.createContext(c);for(const f of ['util','strings_data','strings','data'])vm.runInContext(fs.readFileSync(path.join(root,'js',f+'.js'),'utf8'),c);return c;}
test('新版正式NPC四種動作皆有獨立有效圖像，四階級配置與正式資料一致',()=>{
 const c=data(),rows=cfg.csvParse(fs.readFileSync(path.join(root,'config/CSV/NPC.csv'),'utf8')),h=rows[0],column=s=>h.indexOf(s);let n=0;
 for(const row of rows.slice(1)){
  if(!(row[column('圖像備註')]||'').startsWith('新版正式圖像'))continue;
  n++;const stems=[];
  for(const [action,col] of [['idle','站立圖像'],['walk','移動圖像'],['attack','攻擊圖像'],['die','死亡圖像']]){
   const stem=row[column(col)],meta=manifest.stems[stem];assert.ok(meta,row[0]+' '+action+' '+stem);
   assert.equal(c.NPC_CONFIG_TABLE[row[0]].sprite[action],stem);
   if(action!=='idle')assert.ok(meta.frames>=2,stem+' requires animation');
   assert.equal(meta.loop,action==='idle'||action==='walk');assert.equal(meta.hold,action==='die');
   stems.push(stem);
  }
  assert.equal(new Set(stems).size,4,row[0]+' may not alias another action');
  assert.ok(!row[column('圖像備註')].includes('｜待補'),row[0]+' stale note');
 }
 assert.ok(n>=100,'must check every rank, not only the normal row');
});

function attackDispatch(presetHandled=true){
 const c={console,performance,setTimeout,clearTimeout,navigator:{userAgent:'node'}};vm.createContext(c);
 vm.runInContext(fs.readFileSync(path.join(root,'js/vendor/pixi.min.js'),'utf8'),c);
 const P=c.PIXI,key='desert_goblin',name='npc:'+key,defs={},anims={},speeds={},calls={preset:0,slash:0,projectile:0,impact:0,reaction:0};
 for(const [stem,meta]of Object.entries(manifest.stems)){if(meta.char!==key)continue;const a=stem.slice(key.length+1);defs[a]=meta;anims[a]=Array.from({length:meta.frames},()=>P.Texture.EMPTY);speeds[a]=meta.fps/60;}
 c.S={ready:true,sheets:{[name]:{anims,speeds,manifest:{...manifest.chars[key],anims:defs}}},entities:{},player:null,
  layers:{world:new P.Container()},later:{q:[]},fx:[],floats:[],shake:0,paused:false,W:800,H:500,
  vfxrt:{update(){},tryPlay(){calls.preset++;return presetHandled;}}};
 c.moveStep=0;c.callbacks=[];c.deferred=[];c.endedWaterTornadoes={};c.clock=100;
 Object.assign(c,{nowMs:()=>c.clock,renderClock:()=>c.clock,playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0}),
  normalizeTowerVfxIds(){},documentHidden:()=>false,fxGate:()=>false,
  deferVfxUntilReady:spec=>{c.deferred.push(spec);return true;},laterFrame:fn=>c.callbacks.push(fn),
  spawnProjectile(){calls.projectile++;},spawnSlash(){calls.slash++;},spawnImpact(){calls.impact++;},hitReact(){calls.reaction++;},
  tickScene(){},syncGroundScroll(){},syncOutline(){},applyEntityBillboard(){},syncNpcRankGlow(){},
  groundToScreenY:y=>y,posSolve:e=>({x:e.wx+c.moveStep,y:e.wy})});
 vm.runInContext(renderer.match(/var ENEMY_FADE_IN_SEC = [^;]+;/)[0],c);
 vm.runInContext(['ENEMY_CONTACT_GAP','ENEMY_MAX_CHARGE'].map(n=>renderer.match(new RegExp('var '+n+' = [^;]+;'))[0]).join('\n'),c);
 vm.runInContext(['makeAnimSprite','animFrames','playAnim','animateEnemyAttack','renderEnemyAttackVfx','onVfx','tickEntityAnimation','tickWorld','updateFlashJolt']
  .map(n=>extractFunction(renderer,n)).join('\n'),c);
 const body=c.makeAnimSprite(name,'idle'),e={sheetName:name,body,root:new P.Container(),bodyWrap:new P.Container(),
  curAnim:'idle',baseAnim:'idle',state:'idle',npcSprite:true,npcFacing:1,wx:100,wy:0};
 c.S.entities.enemy=e;
 const event=(extra={})=>({cat:'enemy',fxKind:'enemy-attack',sourceId:'enemy',targets:['pv-float'],variant:'enemy-melee',...extra});
 const tick=()=>{c.clock+=16.7;c.tickWorld({deltaMS:16.7,deltaTime:1});};
 return {c,e,body,calls,event,tick};
}

test('onVfx：Preset接手近戰／遠程、命中／MISS都播哥布林攻擊，不重畫舊特效',()=>{
 for(const variant of ['enemy-melee','enemy-projectile'])for(const hit of [true,false]){
  const {c,e,calls,event,body}=attackDispatch();c.playAnim(e,'walk');c.onVfx(event({variant,hit}));
  assert.equal(e.curAnim,'attack');assert.equal(body.loop,false);assert.equal(calls.preset,1);
  assert.equal(calls.slash+calls.projectile+calls.impact+calls.reaction,0,'Preset已畫效果，不能重畫舊特效');
  if(variant==='enemy-melee')assert.ok(e.lunge>0);else assert.equal(e.lunge,undefined);
  body.destroy();
 }
});

test('onVfx：退路每則事件只播一次動作與特效；死亡NPC不重播攻擊',()=>{
 for(const variant of ['enemy-melee','enemy-projectile']){
  const {c,e,body,calls,event}=attackDispatch(false);let starts=0;
  const play=c.playAnim;c.playAnim=(...args)=>{if(args[1]==='attack')starts++;return play(...args);};
  c.onVfx(event({variant}));assert.equal(starts,1);assert.equal(e.curAnim,'attack');
  assert.equal(calls.slash,variant==='enemy-melee'?1:0);assert.equal(calls.projectile,variant==='enemy-projectile'?1:0);
  c.playAnim(e,'die');e.state='dying';c.onVfx(event({variant}));assert.equal(starts,1);assert.equal(e.curAnim,'die');
  body.destroy();
 }
});

test('onVfx：延遲依原時序、Preset載入重試不重設已播放的攻擊幀',()=>{
 const {c,e,body,calls,event}=attackDispatch();const spec=event({delayMs:100});
 c.onVfx(spec);assert.equal(e.curAnim,'idle');assert.equal(c.callbacks.length,1);
 c.S.vfxLoading=true;c.callbacks.shift()();assert.equal(e.curAnim,'attack');assert.equal(calls.preset,0);
 c.tickEntityAnimation(e,{deltaMS:180,deltaTime:10.8},.18);const frame=body.currentFrame;assert.ok(frame>0);
 c.S.vfxLoading=false;c.onVfx(c.deferred.shift());assert.equal(body.currentFrame,frame);assert.equal(calls.preset,1);
 body.destroy();
});

test('onVfx到逐幀tickWorld：攻擊完整前進，移動不能打斷，完成接回當下移動或站立',()=>{
 for(const moveStep of [0,2]){
  const {c,e,body,event,tick}=attackDispatch();c.moveStep=moveStep;c.onVfx(event());
  const frames=new Set();let ticks=0;
  while(e.curAnim==='attack'&&ticks++<120){frames.add(body.currentFrame);tick();}
  assert.ok(frames.size>=3,'攻擊動作實際播放多幀');assert.ok(ticks<120,'動作會結束');
  assert.equal(e.curAnim,moveStep?'walk':'idle');assert.equal(body.loop,true);body.destroy();
 }
});

test('既有NPC重排與新生共用表格倍率／密度尺寸，保留本體、攻擊幀、朝向與死亡進度',()=>{
 const {c}=attackDispatch(),P=c.PIXI;c.density=.5;c.cell={w:60,h:50};c.S.layers.entity=new P.Container();
 c.NPC_CONFIG_TABLE={desert_2:{id:'desert_goblin',scale:2}};
 Object.assign(c,{densityScale:()=>c.density,cellSize:()=>c.cell,npcSpriteDef:()=>c.NPC_CONFIG_TABLE.desert_2,
  enemyNameText:()=> 'NPC',posTrack(){},drawHpBar(){},requestNpcSheet(){},requestMobImage(){},
  spriteHitBox:body=>({height:64*body.scale.y,center:32*body.scale.y})});
 vm.runInContext(['makeNpcSpriteBody','enemyLayout','makeEnemy','syncEnemyLayout','adoptNpcSprite'].map(n=>extractFunction(renderer,n)).join('\n'),c);
 const data={npcId:'desert_2',floatSel:'first',hp:100,maxHp:100,pos:{x:0,y:0}},e=c.makeEnemy(data);
 assert.equal(e.visScale,1);assert.equal(e.nameText.style.fontSize,8);
 const body=e.body;c.playAnim(e,'attack');body.gotoAndStop(2);body.scale.x=-body.scale.x;e.state='dying';e.dieT=.2;e.bodyWrap.scale.y=.7;
 for(const [density,w,h]of [[1,100,80],[.5,60,50],[1,100,80]]){
  c.density=density;c.cell={w,h};c.syncEnemyLayout(e);const fresh=c.makeEnemy({...data,floatSel:'fresh'});
  assert.equal(e.visScale,2*density);assert.equal(e.visScale,fresh.visScale);
  assert.equal(Math.abs(e.body.scale.x),fresh.body.scale.x);assert.equal(e.body.scale.y,fresh.body.scale.y);
  assert.equal(e.hitHeight,fresh.hitHeight);assert.equal(e.hitCenter,fresh.hitCenter);
  assert.equal(e.barW,fresh.barW);assert.equal(e.nameText.style.fontSize,fresh.nameText.style.fontSize);
  assert.equal(e.statusText.style.fontSize,fresh.statusText.style.fontSize);
  assert.equal(e.body,body);assert.equal(body.currentFrame,2);assert.ok(body.scale.x<0);
  assert.equal(e.curAnim,'attack');assert.equal(e.state,'dying');assert.equal(e.dieT,.2);assert.equal(e.bodyWrap.scale.y,.7);
  fresh.root.destroy({children:true});
 }
 e.root.destroy({children:true});
 const sheet=c.S.sheets['npc:desert_goblin'];delete c.S.sheets['npc:desert_goblin'];
 c.makeMobBody=()=>new P.Sprite(P.Texture.EMPTY);c.density=.5;c.cell={w:60,h:50};
 const cold=c.makeEnemy(data);assert.equal(cold.npcSprite,false);
 c.density=1;c.cell={w:100,h:80};c.syncEnemyLayout(cold);
 c.S.sheets['npc:desert_goblin']=sheet;c.adoptNpcSprite(cold);
 assert.equal(cold.npcSprite,true);assert.equal(cold.visScale,2);
 assert.equal(cold.body.scale.y,sheet.manifest.scale*2,'晚載素材採用重排後的最新倍率');
 cold.root.destroy({children:true});
});
test('正式敵方出手事件播放攻擊，完成後接回當下移動／站立；死亡留在最後一幀',()=>{
 const c={console,performance,setTimeout,clearTimeout,navigator:{userAgent:'node'}};vm.createContext(c);
 vm.runInContext(fs.readFileSync(path.join(root,'js/vendor/pixi.min.js'),'utf8'),c);
 const P=c.PIXI;
 c.S={sheets:{},entities:{}};Object.assign(c,{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0}),spawnProjectile(){},spawnSlash(){},spawnImpact(){},hitReact(){}});
 vm.runInContext(['makeAnimSprite','animFrames','playAnim','animateEnemyAttack','renderEnemyAttackVfx'].map(n=>extractFunction(renderer,n)).join('\n'),c);
 for(const key of Object.keys(manifest.chars)){
  const defs=Object.fromEntries(Object.entries(manifest.stems).filter(([,m])=>m.char===key).map(([stem,m])=>[stem.slice(key.length+1),m]));
  if(!defs.walk||!defs.attack||!defs.die)continue;
  const name='npc:'+key,anims={},speeds={};for(const [action,m]of Object.entries(defs)){anims[action]=Array.from({length:m.frames},()=>P.Texture.EMPTY);speeds[action]=m.fps/60;}
  c.S.sheets[name]={anims,speeds,manifest:{...manifest.chars[key],anims:defs}};
  const body=c.makeAnimSprite(name,'idle'),e={sheetName:name,body,curAnim:'idle',baseAnim:'idle',state:'idle',npcSprite:true,wx:100,wy:0};c.S.entities.enemy=e;
  for(const variant of ['enemy-melee','enemy-projectile']){
   e.baseAnim='idle';c.renderEnemyAttackVfx({sourceId:'enemy',targets:['pv-float'],variant,hit:false});assert.equal(e.curAnim,'attack',key);
   assert.equal(body.loop,false);assert.equal(body.textures.length,defs.attack.frames);
   e.baseAnim='walk';body.onComplete();assert.equal(e.curAnim,'walk');assert.equal(body.loop,true);
  }
  c.playAnim(e,'die');assert.equal(body.loop,false);assert.equal(body.onComplete,null);assert.equal(e.curAnim,'die');body.destroy();
 }
});
