const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {readXlsxRows,csvParse,SCHEMAS,extractLiteral,evalLiteral}=require('../tools/config_tables.cjs');
const root=path.resolve(__dirname,'..');

test('native Excel multiline headers survive both readers and preserve ordinary affix slot restrictions',()=>{
 const book=path.join(root,'config/Excel/Equipment_Affix.xlsx');
 const rows=readXlsxRows(book),header=rows[0];
 assert.equal(header[9].split(/\r?\n/)[0],'出現部位');
 const src=fs.readFileSync(path.join(root,'js/data.js'),'utf8');
 const expected=evalLiteral(extractLiteral(src,'AFFIX_POOL').literal);
 const rebuilt=SCHEMAS.Equipment_Affix.rebuild(rows.slice(1),header);
 assert.deepEqual(evalLiteral(extractLiteral(rebuilt.AFFIX_POOL,'AFFIX_POOL').literal),expected);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xlsx-native-header-'));
 try {
  const out=path.join(dir,'export.csv');
  execFileSync(process.execPath,[path.join(root,'tools/xlsx_to_csv.cjs')],{cwd:root,env:{...process.env,PARAMS_XLSX:book,PARAMS_SHEET:'Equipment_Affix',PARAMS_CSV_OUT:out},stdio:'pipe'});
  const csv=csvParse(fs.readFileSync(out,'utf8'));
  assert.equal(csv[0][9].split(/\r?\n/)[0],'出現部位');
  const defs=SCHEMAS.Equipment_Affix.rebuild(csv.slice(1),csv[0]);
  assert.deepEqual(evalLiteral(extractLiteral(defs.AFFIX_POOL,'AFFIX_POOL').literal),expected);
  assert.deepEqual(evalLiteral(extractLiteral(defs.PASSIVE_POOL,'PASSIVE_POOL').literal),evalLiteral(extractLiteral(src,'PASSIVE_POOL').literal));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
