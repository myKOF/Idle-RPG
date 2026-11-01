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
test('正式敵方出手事件播放攻擊，完成後接回當下移動／站立；死亡留在最後一幀',()=>{
 const c={console,performance,setTimeout,clearTimeout,navigator:{userAgent:'node'}};vm.createContext(c);
 vm.runInContext(fs.readFileSync(path.join(root,'js/vendor/pixi.min.js'),'utf8'),c);
 const P=c.PIXI;
 c.S={sheets:{},entities:{}};Object.assign(c,{playerPos:()=>({x:0,y:0}),posOf:()=>({x:0,y:0}),spawnProjectile(){},spawnSlash(){},spawnImpact(){},hitReact(){}});
 vm.runInContext(['makeAnimSprite','animFrames','playAnim','renderEnemyAttackVfx'].map(n=>extractFunction(renderer,n)).join('\n'),c);
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
