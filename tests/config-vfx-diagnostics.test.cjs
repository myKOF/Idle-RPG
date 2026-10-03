'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const table=require('../tools/config_tables.cjs');
const root=path.resolve(__dirname,'..');
function rows(){return table.csvParse(fs.readFileSync(path.join(root,'config/CSV/Skills2.csv'),'utf8'));}
function change(data,gid,stage,label,value){
  const header=data[0],row=data.find(r=>r[header.indexOf('群組ID')]===gid&&
    (r[header.indexOf('超神ID')]||r[header.indexOf('階數')])===stage);
  assert.ok(row);row[header.indexOf(label)]=value;return data.indexOf(row)+1;
}
const inspect=data=>table.validateVfxTable('Skills2',data.slice(1),data[0]);

test('誤填觸發欄一次列出兩個問題：技能、Excel格位、值、未接線原因與修正方式',()=>{
  const data=rows();
  change(data,'windblade','stormMountain','觸發命中特效','hit-wind-09');
  change(data,'windblade','stormMountain','觸發地板特效','ground-homing-wind-crescent-09');
  const issues=inspect(data);assert.equal(issues.length,2);
  assert.match(issues[0],/Skills2.xlsx 第210列「嵐之山」/);
  assert.match(issues[0],/AP210「觸發命中特效」＝「hit-wind-09」/);
  assert.match(issues[1],/AQ210「觸發地板特效」/);
  assert.match(issues[0],/未接線.*沒有獨立觸發事件/);
  assert.match(issues[0],/可用觸發欄：無/);assert.match(issues[0],/清除此格/);
  assert.match(issues[0],/飛行子彈.*受擊特效/);assert.match(issues[0],/改 Preset 名稱不會新增事件/);
});

test('名稱拼錯提供實際檔案與相近名稱，保留空白列及含換行表頭的格位',()=>{
  const data=rows();data.splice(1,0,Array(data[0].length).fill(''));
  const row=change(data,'windblade','1','飛行子彈','proj-wind-crescen');
  data[0][data[0].indexOf('飛行子彈')]+='\n本體外觀';
  const issues=inspect(data);assert.equal(issues.length,1);
  assert.ok(issues[0].includes(`AJ${row}「飛行子彈」`));
  assert.match(issues[0],/找不到 vfx\/presets\/proj-wind-crescen.json/);
  assert.match(issues[0],/相近可用名稱：.*proj-wind-crescent/);
  assert.match(issues[0],/若是誤改，恢復原名稱/);
});

test('合法更名與改回、空白及.json尾碼相容，不把名稱尾碼當作事件接線',()=>{
  const data=rows();assert.deepEqual(inspect(data),[]);
  for(const value of ['proj-wind-crescent-09',' proj-wind-crescent-09.json ','proj-wind-crescent']){
    change(data,'windblade','1','飛行子彈',value);assert.deepEqual(inspect(data),[]);
    const rebuilt=table.SCHEMAS.Skills2.rebuild(data.slice(1),data[0]);
    const obj=table.evalLiteral(table.extractLiteral(rebuilt.SKILLS2,'SKILLS2').literal);
    assert.equal(obj.windblade.tiers[0].vfx.projectile,value.trim().replace(/\.json$/i,''));
  }
  change(data,'windblade','skyCollapse','觸發子彈','proj-wind-crescent');
  const issues=inspect(data);assert.equal(issues.length,1);
  assert.match(issues[0],/可用觸發欄：「觸發命中特效」、「觸發地板特效」/);
});

test('中文用途標籤、路徑及大小寫錯誤有明確診斷；狀態表也檢查Preset名稱',()=>{
  for(const value of ['附加效果','../proj-wind-crescent','Proj-Wind-Crescent']){
    const data=rows();change(data,'windblade','1','飛行子彈',value);
    const issues=inspect(data);assert.equal(issues.length,1);assert.match(issues[0],/修正：/);
    assert.match(issues[0],value==='Proj-Wind-Crescent'?/檔名大小寫也須一致/:/不是有效的 Preset 檔名/);
  }
  const header=['狀態ID','狀態名稱','施加特效'],data=[['probe','測試狀態','hit-wind-typo']];
  const issues=table.validateVfxTable('Status',data,header);
  assert.equal(issues.length,1);assert.match(issues[0],/Status.xlsx 第2列「測試狀態」/);
  assert.match(issues[0],/C2「施加特效」/);assert.match(issues[0],/找不到/);
});

test('正式CLI：錯誤整批拒絕且所有JS／CSV不變；修正、有效換名及改回皆可重新套用',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'idle-vfx-diagnostics-'));
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'idle-vfx-diagnostics-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const folder of ['tools','js','config/CSV','vfx/presets'])fs.mkdirSync(path.join(dir,folder),{recursive:true});
  for(const rel of ['tools/config_tables.cjs','tools/skills2-geometry.cjs','tools/skills2-vfx.cjs',
    'js/data.js','js/skills.js','js/skills2.js','js/status.js','config/CSV/Skills2.csv','config/CSV/Status.csv','config/CSV/Task.csv'])
    fs.copyFileSync(path.join(root,rel),path.join(dir,rel));
  for(const name of fs.readdirSync(path.join(root,'vfx/presets')).filter(n=>n.endsWith('.json')))
    fs.copyFileSync(path.join(root,'vfx/presets',name),path.join(dir,'vfx/presets',name));
  const csv=path.join(dir,'config/CSV/Skills2.csv'),data=rows(),js=['data','skills','skills2','status'];
  const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before=js.map(name=>hash(path.join(dir,'js',name+'.js')));
  change(data,'windblade','stormMountain','觸發命中特效','hit-wind');
  change(data,'windblade','stormMountain','觸發地板特效','ground-homing-wind-crescent-09');
  fs.writeFileSync(csv,table.csvStringify(data));const badCSV=hash(csv);
  const run=(...args)=>spawnSync(process.execPath,['tools/config_tables.cjs','--apply','--write',...args],{cwd:dir,encoding:'utf8'});
  const fail=run();assert.equal(fail.status,2,fail.stdout+fail.stderr);
  assert.match(fail.stderr,/2 個問題/);assert.match(fail.stderr,/AP210/);assert.match(fail.stderr,/AQ210/);
  assert.match(fail.stdout,/任何遊戲 JS 都未覆寫/);
  assert.deepEqual(js.map(name=>hash(path.join(dir,'js',name+'.js'))),before);assert.equal(hash(csv),badCSV);
  assert.equal(fs.existsSync(path.join(dir,'params_version.txt')),false);
  change(data,'windblade','stormMountain','觸發命中特效','');
  change(data,'windblade','stormMountain','觸發地板特效','');
  change(data,'windblade','1','飛行子彈','proj-wind-crescen');fs.writeFileSync(csv,table.csvStringify(data));
  const wrongNameCSV=hash(csv),missing=run();assert.equal(missing.status,2,missing.stdout+missing.stderr);
  assert.match(missing.stderr,/AJ202/);assert.match(missing.stderr,/相近可用名稱/);
  assert.deepEqual(js.map(name=>hash(path.join(dir,'js',name+'.js'))),before);assert.equal(hash(csv),wrongNameCSV);
  for(const preset of ['proj-wind-crescent-09','proj-wind-crescent']){
    change(data,'windblade','1','飛行子彈',preset);fs.writeFileSync(csv,table.csvStringify(data));
    const result=run('Skills2');assert.equal(result.status,0,result.stdout+result.stderr);
    const src=fs.readFileSync(path.join(dir,'js/skills2.js'),'utf8');
    assert.equal(table.evalLiteral(table.extractLiteral(src,'SKILLS2').literal).windblade.tiers[0].vfx.projectile,preset);
    assert.deepEqual(js.filter(n=>n!=='skills2').map(n=>hash(path.join(dir,'js',n+'.js'))),before.filter((_,i)=>js[i]!=='skills2'));
  }
});
