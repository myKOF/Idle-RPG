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
test('特效用途特效：中文欄位往返、逐風者設定及舊表相容，錯字拒絕',()=>{
 const a=api(),rows=a.parse(fs.readFileSync(root+'/config/CSV/Skills2.csv','utf8'));
 const header=rows[0],index=header.indexOf('特效用途特效');assert(index>=0);
 const row=rows.slice(1).find(r=>r[header.indexOf('超神ID')]==='windChaser');
 const parse=(data=rows.slice(1),h=header)=>a.evalLiteral(a.extractLiteral(a.sc.rebuild(data,h).SKILLS2,'SKILLS2').literal);
 assert.equal(row[index],'附加效果');
 assert.equal(parse().cleave.ult[1].vfxUsage,'effect');
 const generated=a.sc.extract(a.sc.rebuild(rows.slice(1),header).SKILLS2);
 const out=generated.find(r=>r[a.sc.header.indexOf('超神ID')]==='windChaser');
 assert.equal(out[a.sc.header.indexOf('特效用途特效')],'附加效果');
 row[index]='技能本體';assert.equal(parse().cleave.ult[1].vfxUsage,'base');
 row[index]='';assert.equal(parse().cleave.ult[1].vfxUsage,undefined);
 row[index]='附加效菓';assert.throws(()=>parse(),/特效用途特效/);
 const oldHeader=header.filter((_,i)=>i!==index),oldData=rows.slice(1).map(r=>r.filter((_,i)=>i!==index));
 assert.equal(parse(oldData,oldHeader).cleave.ult[1].vfxUsage,undefined);
});
test('Excel、CSV 與 JS 的技能資料一致，說明置頂且明列用途／空欄／觸發限制',()=>{
 const a=api(),csv=a.parse(fs.readFileSync(root+'/config/CSV/Skills2.csv','utf8'));
 const xlsx=a.readXlsxRows(root+'/config/Excel/Skills2.xlsx');
 const normalize=rows=>JSON.parse(JSON.stringify(a.evalLiteral(a.extractLiteral(a.sc.rebuild(rows.slice(1),rows[0]).SKILLS2,'SKILLS2').literal)));
 assert.deepEqual(normalize(xlsx),normalize(csv));
 const source=a.evalLiteral(a.extractLiteral(fs.readFileSync(root+'/js/skills2.js','utf8'),'SKILLS2').literal);
 assert.deepEqual(normalize(csv),JSON.parse(JSON.stringify(source)));
 const notes=a.sc.extraSheets[0].rows.slice(0,8).flat().join('\n');
 assert.match(notes,/^特效用途特效/);assert.match(notes,/附加效果/);assert.match(notes,/空欄不繼承/);assert.match(notes,/不會新增觸發能力/);
});
