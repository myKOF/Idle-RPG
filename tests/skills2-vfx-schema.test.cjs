'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const table=require('../tools/config_tables.cjs'),vfx=require('../tools/skills2-vfx.cjs');
const {migrate}=require('../tools/migrate-skills2-vfx.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
function context(){const c=vm.createContext({console,Math});vm.runInContext(fs.readFileSync('js/skills2.js','utf8'),c);c.skills2Levels=()=>[1,1,1,1,1,1,1];c.skills2Ult=()=>null;return c;}
test('舊用途遷移保留非特效欄位，並將感染角色移入同列觸發欄',()=>{
 const old=[['群組ID','階數','超神ID','特殊效果','攻擊特效','飛行子彈','受擊特效','效果參數(JSON)','我方狀態'],
 ['bloodblade','5','','','','proj-poison-drop','hit-poison','{"chance":30}',''],
 ['gale','1','','','hit-gale-burst','','','{"pct":250}','']];
 const migrated=migrate(old),get=(i,k)=>migrated[i][migrated[0].indexOf(k)];
 assert.ok(!migrated[0].includes('特殊效果'));
 assert.equal(get(1,'飛行子彈'),'');assert.equal(get(1,'觸發子彈'),'proj-poison-drop');
 assert.equal(get(1,'觸發命中特效'),'hit-poison');assert.equal(get(1,'效果參數(JSON)'),'{"chance":30}');
 assert.equal(get(2,'攻擊特效'),'hit-gale-burst');assert.match(get(1,'特效作用說明'),/抵達後感染/);
 assert.throws(()=>migrate(migrated),/重複遷移/);
});
test('未接線事件及角色拒絕填寫，不把標籤當作特效',()=>{
 assert.throws(()=>vfx.validate('gale','1',{projectile:'p'}),/未接線/);
 assert.throws(()=>vfx.validate('bloodblade','6',{projectile:'p'}),/未接線/);
 assert.doesNotThrow(()=>vfx.validate('bloodblade','5',{projectile:'p',hit:'h'}));
 assert.throws(()=>vfx.validate('bloodblade','5',{projectile:'附加效果'}),/Preset 名稱/);
});
test('觸發角色全部預載並可在編輯器查到用途',()=>{
 const c=context(),runtime=require('../js/vfx-runtime.js'),usage=require('../tools/vfx/preset-usage.cjs');
 const old=global.SKILLS2;global.SKILLS2=c.SKILLS2;
 try{
  const ids=new Set(runtime.collectPresetIds()),found=usage.scanTables(require('path').resolve(__dirname,'..'));
  for(const key of Object.keys(vfx.events)){
   const [gid,stage]=key.split('.');
   for(const id of Object.values(c.sgStatusRow(gid,stage).triggerVfx)){
    assert.ok(ids.has(id),'未預載 '+id);assert.ok(found[id],'未列用途 '+id);
   }
  }
 }finally{if(old===undefined)delete global.SKILLS2;else global.SKILLS2=old;}
});
test('正式 Excel 與 CSV 逐格一致，缺失新版欄位不可清空觸發設定',()=>{
 const rows=table.csvParse(fs.readFileSync('config/CSV/Skills2.csv','utf8'));
 assert.deepEqual(table.readXlsxRows('config/Excel/Skills2.xlsx'),rows);
 const header=rows[0].filter(x=>x!=='觸發特效');
 assert.throws(()=>table.SCHEMAS.Skills2.rebuild([],header),/缺少新版觸發欄/);
});
test('同列本體與觸發獨立；觸發不吃本體、其他階或已選超神的特效',()=>{
 const c=context();
 c.SKILLS2.probe={tiers:[{vfx:{attack:'base',hit:'base-hit'}},{vfx:{attack:'main-upgrade'},triggerVfx:{projectile:'infection'}}],ult:[{id:'u',vfx:{attack:'ult'}}]};
 c.skills2Ult=()=>({def:c.SKILLS2.probe.ult[0]});
 assert.deepEqual(plain(c.sgVfxRoles('probe',{vfxTier:2})),{projectile:'infection'});
 assert.deepEqual(plain(c.sgVfxRoles('probe',{})),{attack:'ult',hit:'base-hit'});
 c.SKILLS2.probe.tiers[1].triggerVfx={};
 assert.deepEqual(plain(c.sgVfxRoles('probe',{vfxTier:2})),{});
 assert.deepEqual(plain(c.sgVfxRoles('other',{vfxGid:'probe',vfxTier:2})),{});
 assert.equal(c.sgVfxRoles('probe',{vfxTier:2,vfxBase:true}).attack,'main-upgrade');
});
test('全部已登記事件即使留白仍獨立，編譯回寫不改數值與狀態',()=>{
 const c=context();
 const src=fs.readFileSync('js/skills2.js','utf8'),schema=table.SCHEMAS.Skills2;
 const rebuilt=schema.rebuild(schema.extract(src),schema.header).SKILLS2;
 const rebuiltObj=typeof rebuilt==='string'?table.evalLiteral(table.extractLiteral(rebuilt,"SKILLS2").literal):rebuilt;
 for(const key of Object.keys(vfx.events)){
  const [gid,stage]=key.split('.'),row=c.sgStatusRow(gid,stage);
  assert.ok(row.triggerVfx,key);
  const extra=/^\d+$/.test(stage)?{vfxTier:Number(stage)}:{vfxUlt:stage};
  assert.deepEqual(plain(c.sgVfxRoles(gid,extra)),plain(row.triggerVfx),key);
  const next=/^\d+$/.test(stage)?rebuiltObj[gid].tiers[Number(stage)-1]:rebuiltObj[gid].ult.find(x=>x.id===stage);
  assert.deepEqual(plain(next.fx),plain(row.fx));assert.deepEqual(plain(next.status||{}),plain(row.status||{}));
 }
});
