'use strict';
const fs=require('fs'),path=require('path');
const table=require('./config_tables.cjs'), geo=require('./skills2-geometry.cjs');
function migrate(rows){
 const header=rows[0];
 if(header.includes(geo.labels.damage))throw Error('已經是範圍v2，拒絕重複遷移');
 const removed=new Set(['range',...geo.legacy.map(c=>c[0])]);
 const kept=header.filter(c=>!removed.has(c)),insert=kept.indexOf('傷害類型');
 const newHeader=[...kept.slice(0,insert),...geo.columns,...kept.slice(insert)];
 return [newHeader,...rows.slice(1).map(row=>{
  const old=Object.fromEntries(header.map((c,i)=>[c,row[i]===undefined?'':String(row[i])])),fx=JSON.parse(old['效果參數(JSON)']||'{}');
  for(const [label,key]of geo.legacy){delete fx[key];if(old[label]!=='')fx[key]=Number(old[label]);}
  const gid=old['群組ID'],stage=old['超神ID']||old['階數'];
  const cells=geo.extract(gid,stage,fx,old.range);
  const data={...old,...cells,'效果參數(JSON)':JSON.stringify(geo.strip(fx))};
  // 每列回編譯一次，遷移當下就擋住未接線與不合法格式。
  geo.apply(gid,stage,fx,k=>data[k]);
  return newHeader.map(c=>data[c]||'');
 })];
}
if(require.main===module){
 const out=process.argv[2];if(!out)throw Error('指定輸出JSON路徑（不直接寫Excel）');
 const rows=migrate(table.readXlsxRows(path.resolve(__dirname,'../config/Excel/Skills2.xlsx')));
 fs.writeFileSync(out,JSON.stringify({sheets:[{name:'Skills2',rows},{name:'欄位定義',rows:table.SCHEMAS.Skills2.extraSheets[0].rows}]}));
 console.log('已準備 '+(rows.length-1)+' 列／'+rows[0].length+' 欄；未修改原Excel');
}
module.exports={migrate};
