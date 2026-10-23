'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const tables=require('../tools/config_tables.cjs');
const ids=['desert','Icefield','mist_forest','lava_mountain','swamp','thunder_peak','undead_mountains','god_battlefield','god_chaos','god_sanctuary'];
const attrs=[['fire','ice'],['ice','lightning'],['earth','wind'],['earth','fire'],['ice','poison'],['lightning','wind'],['dark','poison'],['fire','light'],['ice','light','poison'],['dark','light','lightning']];
function load(extra=[]){const c={console,Math:Object.create(Math),window:{},document:{getElementById(){return null;}},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},UI:{dirty:{}},blog(){},location:{}};c.window=c;vm.createContext(c);for(const f of ['util','data','status','formula','battlefield','item','skills','talents','player','save',...extra])vm.runInContext(fs.readFileSync(path.join(root,'js',f+'.js'),'utf8'),c,{filename:f});return c;}
const json=x=>JSON.parse(JSON.stringify(x));
test('BIOMES-CONTRACT 十圖屬性／順序／上限及120隻NPC都來自正式資料',()=>{
 const c=load();assert.deepEqual(json(c.ZONE_LIST),ids);assert.deepEqual(json(ids.map(z=>c.ZONES[z].maxStage)),[100,150,200,250,300,350,400,450,500,600]);
 assert.equal(c.ZONES.swamp.name,'月影沼澤');assert.equal(Object.keys(c.NPC_CONFIG_TABLE).length,120);
 ids.forEach((z,i)=>{assert.deepEqual([...new Set(c.ZONES[z].pool.map(n=>n.attr))].sort(),attrs[i]);assert.equal(c.ZONES[z].pool.length,12);if(i){assert.equal(c.ZONES[z].reqZone,ids[i-1]);assert.equal(c.ZONES[z].reqStage,c.ZONES[ids[i-1]].maxStage);}for(const npc of c.ZONES[z].pool)assert.equal(c.NPC_CONFIG_TABLE[npc.id].attr,npc.attr);});
});
test('BIOMES-SPAWN 三張新地圖的普通怪與BOSS使用自己NPC及元素',()=>{
 const c=load(['combat']);c.Math.random=()=>0;
 for(const z of ['mist_forest','lava_mountain','thunder_peak'])for(const stage of [1,50]){
  c.G=c.newGameState();c.G.stage={zone:z,current:stage,best:stage,kills:0,autoAdvance:false};c.G.tower={active:false};c.FIELD.monsters=[];c.FIELD.player={_lockTarget:null};c.spawnFieldMonster();
  const m=c.FIELD.monsters[0];assert.ok(m.npcId.startsWith(z+'_'),z);assert.equal(m.attr,c.NPC_CONFIG_TABLE[m.npcId].attr);assert.equal(m.isBoss,stage===50);assert.ok(m.hp>0);
 }
});
test('BIOMES-SAVE 舊後圖進度補通新增前圖、先保留超上限通關且重讀冪等',()=>{
 const c=load(),old=c.newGameState();delete old.fieldBiomesV2;for(const z of ['mist_forest','lava_mountain','thunder_peak'])delete old.zoneProgress[z];
 old.stage={zone:'undead_mountains',current:490,best:500,kills:0,autoAdvance:true};old.zoneProgress.undead_mountains={current:450,best:480};old.zoneProgress.desert={current:180,best:200};
 old.taskState={idx:35};const s=c.migrateSave(old);assert.equal(s.stage.zone,'undead_mountains');assert.equal(s.stage.best,400);assert.equal(s.zoneProgress.undead_mountains.cleared,400);assert.equal(s.zoneProgress.desert.cleared,100);assert.equal(s.taskState.idx,35);
 for(const z of ['mist_forest','lava_mountain','thunder_peak'])assert.equal(s.zoneProgress[z].cleared,c.ZONES[z].maxStage);
 const again=c.migrateSave(json(s));assert.deepEqual(json(again.zoneProgress),json(s.zoneProgress));
 const fresh=c.migrateSave(c.newGameState());for(const z of ids)assert.equal(fresh.zoneProgress[z].cleared,0,'新檔不贈送關卡');
 const noZone=c.newGameState();delete noZone.stage.zone;noZone.stage.best=180;noZone.stage.current=150;delete noZone.fieldBiomesV2;
 assert.equal(c.migrateSave(noZone).zoneProgress.desert.cleared,100,'無地圖欄位的最早期存檔也保留已通關上限');
});
test('BIOMES-ROUTE 新檔每圖末關留在原圖，主動前進並保留神界11轉門檻',()=>{
 const c=load(['combat']);c.G=c.newGameState();
 c.FIELD.player=null;
 for(let i=0;i<ids.length-1;i++){
  const z=ids[i],next=ids[i+1],cap=c.ZONES[z].maxStage;
  c.G.stage={zone:z,current:cap,best:cap,kills:0,autoAdvance:true};
  c.G.zoneProgress[z]={current:cap,best:cap,cleared:cap-1};
  assert.equal(c.isZoneUnlocked(next),false,'前圖末關未通關不得進入');
  c.FIELD._waveClearPending=true;c.completeFieldWave({hp:100});
  assert.equal(c.G.stage.zone,z,'自動推關不得跨場景');
  assert.equal(c.G.zoneProgress[z].cleared,cap);
  if(i>=6){c.G.player.reincarnations=0;assert.equal(c.isZoneUnlocked(next),false);c.switchZone(next);assert.equal(c.G.stage.zone,z);c.G.player.reincarnations=11;}
  assert.equal(c.isZoneUnlocked(next),true);c.switchZone(next);assert.equal(c.G.stage.zone,next);assert.equal(c.G.stage.current,1);
 }
});
test('BIOMES-CONFIG 六份Excel／CSV逐格一致、任務可達、掉落及波次覆蓋全部關卡',()=>{
 const c=load();for(const n of ['Zones','NPC','Task','Zone_Stage_Drops','Zone_Stage_Waves','Runes']){const x=tables.readXlsxRows(path.join(root,'config/Excel',n+'.xlsx')),csv=tables.csvParse(fs.readFileSync(path.join(root,'config/CSV',n+'.csv'),'utf8')).filter(r=>r.length>1);assert.deepEqual(csv,x.map(r=>r.map(String)),n);}
 for(const t of c.TASKS)if(t.type==='stageClear')assert.ok(t.count<=c.ZONES[t.param].maxStage,t.name);
 for(const z of ids)for(let s=1;s<=c.ZONES[z].maxStage;s++){const d=c.zoneStageDropConfigFor(z,s);assert.ok(s>=d.min&&s<=d.max,z+' '+s);assert.ok(c.ZONE_STAGE_WAVE_PROFILES[z].some(r=>s>=r[0]&&s<=r[1]));}
 const npc=tables.csvParse(fs.readFileSync(path.join(root,'config/CSV/NPC.csv'),'utf8')).slice(1).filter(r=>r.length>1);for(const z of ids)assert.equal(npc.filter(r=>r[2]===z).length,48);
});
test('BIOMES-ROUNDTRIP 地圖再匯入可變更名稱上限與解鎖，拒絕前置環路或越界',()=>{
 const rows=tables.csvParse(fs.readFileSync(path.join(root,'config/CSV/Zones.csv'),'utf8')).filter(r=>r.length>1),header=rows.shift(),schema=tables.SCHEMAS.Zones,src=fs.readFileSync(path.join(root,'js/data.js'),'utf8');
 const input=json(rows);input[2][2]='測試森林';input[2][4]='210';input[3][6]='210';const rebuilt=schema.rebuild(input,header,src),c=load();for(const [name,block] of Object.entries(rebuilt))vm.runInContext(block,c);assert.equal(c.ZONES.mist_forest.name,'測試森林');assert.equal(c.ZONES.mist_forest.maxStage,210);assert.equal(c.ZONES.lava_mountain.reqStage,210);assert.equal(c.ZONES.mist_forest.pool,c.MIST_FOREST_POOL);
 input[3][6]='211';assert.throws(()=>schema.rebuild(input,header,src),/超過上限/);input[3][6]='210';input[2][5]='lava_mountain';assert.throws(()=>schema.rebuild(input,header,src),/前置必須/);
});
test('BIOMES-GROUND 新地面可重製、真週期雜訊接縫連續、三張圖各自用自己的貼圖快取',()=>{
 const c=vm.createContext({console,Math});c.document={createElement(){const canvas={};canvas.getContext=()=>({createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(im){canvas.pixels=im.data;}});return canvas;}};
 vm.runInContext(fs.readFileSync(path.join(root,'js/battle-decor.js'),'utf8'),c);const digests=[];
 for(const z of ['mist_forest','lava_mountain','thunder_peak']){const a=c.BattleDecor.buildGround(z),b=c.BattleDecor.buildGround(z);assert.deepEqual(Buffer.from(a.pixels),Buffer.from(b.pixels));let edge=0;for(let y=0;y<256;y++){edge+=Math.abs(a.pixels[y*256*4]-a.pixels[(y*256+255)*4]);for(let x=0;x<256;x++)assert.equal(a.pixels[(y*256+x)*4+3],255);}assert.ok(edge/256<3,'平鋪接縫不能產生硬框');digests.push(require('crypto').createHash('sha256').update(a.pixels).digest('hex'));}assert.equal(new Set(digests).size,3);assert.equal(c.BattleDecor.buildGround('desert'),null);
 const src=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8'),calls=[],applied=[],scope=vm.createContext({S:{zoneKey:'mist_forest'},_groundTexCache:{},GROUND_ASSET_VERSION:'test',BattleDecor:{buildGround:z=>({zone:z})},PIXI:{CanvasSource:class{constructor(o){this.o=o;}},Texture:class{constructor(o){this.o=o;}},Assets:{load(){calls.push('load');}}},applyGroundTexture:tex=>applied.push(tex)});
 vm.runInContext(src.slice(src.indexOf('  function loadGroundTexture('),src.indexOf('  function applyGroundTexture(')),scope);scope.loadGroundTexture('mist_forest');scope.loadGroundTexture('mist_forest');assert.equal(calls.length,0);assert.equal(applied[0],applied[1]);assert.equal(applied[0].o.source.o.resource.zone,'mist_forest');
});
