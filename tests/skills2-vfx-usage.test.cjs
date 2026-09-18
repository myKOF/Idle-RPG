'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
function api(){
 const file=path.join(root,'tools/config_tables.cjs');
 const c=vm.createContext({require:createRequire(file),__dirname:path.dirname(file),process,console});
 vm.runInContext(fs.readFileSync(file,'utf8').split('/* ---- 進入點 ---- */')[0]+'\nthis.api={sc:SCHEMAS.Skills2,parse:csvParse,readXlsxRows,extractLiteral,evalLiteral};',c);
 return c.api;
}
test('觸發欄：中文欄位往返、逐風者設定及舊表拒絕，錯字拒絕',()=>{
 const a=api(),rows=a.parse(fs.readFileSync(root+'/config/CSV/Skills2.csv','utf8'));
 const header=rows[0],index=header.indexOf('觸發地板特效');assert(index>=0);
 const row=rows.slice(1).find(r=>r[header.indexOf('超神ID')]==='windChaser');
 const parse=(data=rows.slice(1),h=header)=>a.evalLiteral(a.extractLiteral(a.sc.rebuild(data,h).SKILLS2,'SKILLS2').literal);
 const original=row[index];assert.ok(original);
 assert.equal(parse().cleave.ult[1].triggerVfx.ground,original);
 for(const label of ['特殊效果','特效用途特效','特殊用途特效']) {
  const renamed=header.map((h,i)=>i===index?label:h);
  assert.throws(()=>parse(rows.slice(1),renamed),/缺少新版觸發欄/);
 }
 const generated=a.sc.extract(a.sc.rebuild(rows.slice(1),header).SKILLS2);
 const out=generated.find(r=>r[a.sc.header.indexOf('超神ID')]==='windChaser');
 assert.equal(out[a.sc.header.indexOf('觸發地板特效')],original);
 row[index]='custom-ground';assert.equal(parse().cleave.ult[1].triggerVfx.ground,'custom-ground');
 row[index]='';assert.equal(Object.keys(parse().cleave.ult[1].triggerVfx).length,0);
 row[index]='附加效菓';assert.throws(()=>parse(),/Preset 名稱/);
 const oldHeader=header.filter((_,i)=>i!==index),oldData=rows.slice(1).map(r=>r.filter((_,i)=>i!==index));
 assert.throws(()=>parse(oldData,oldHeader),/缺少新版觸發欄/);
});
test('Excel、CSV 與 JS 的技能資料一致，說明置頂且明列用途／空欄／觸發限制',()=>{
 const a=api(),csv=a.parse(fs.readFileSync(root+'/config/CSV/Skills2.csv','utf8'));
 const xlsx=a.readXlsxRows(root+'/config/Excel/Skills2.xlsx');
 const normalize=rows=>JSON.parse(JSON.stringify(a.evalLiteral(a.extractLiteral(a.sc.rebuild(rows.slice(1),rows[0]).SKILLS2,'SKILLS2').literal)));
 assert.deepEqual(normalize(xlsx),normalize(csv));
 const source=a.evalLiteral(a.extractLiteral(fs.readFileSync(root+'/js/skills2.js','utf8'),'SKILLS2').literal);
 assert.deepEqual(normalize(csv),JSON.parse(JSON.stringify(source)));
 const notes=a.sc.extraSheets[0].rows.slice(0,8).flat().join('\n');
 assert.match(notes,/^本體特效與觸發特效/);assert.match(notes,/Preset 名稱/);assert.match(notes,/留白不播放、不繼承/);assert.match(notes,/未支援的觸發角色填值會拒絕匯入/);
});
