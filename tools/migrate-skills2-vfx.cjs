'use strict';
const fs=require('fs'),path=require('path');
const table=require('./config_tables.cjs'),vfx=require('./skills2-vfx.cjs');
const primary=[['施放特效','cast'],['攻擊特效','attack'],['飛行子彈','projectile'],['受擊特效','hit'],['地板特效','ground'],['持續場域特效','field']];
function migrate(rows){
 const header=rows[0],oldLabel=['特殊效果','特殊用途特效','特效用途特效'].find(c=>header.includes(c));
 if(!oldLabel||header.includes(vfx.columns[0][0]))throw Error('不是待遷移的舊版用途欄，拒絕重複遷移');
 const newHeader=header.flatMap(c=>c===oldLabel?[...vfx.columns.map(c=>c[0]),vfx.noteColumn]:[c]);
 return [newHeader,...rows.slice(1).map(row=>{
  const data=Object.fromEntries(header.map((c,i)=>[c,String(row[i]??'')]));
  const gid=data['群組ID'],stage=data['超神ID']||data['階數'],e=vfx.event(gid,stage);
  if(data[oldLabel]==='附加效果'&&!e)throw Error('尚未盤點的附加事件：'+gid+'/'+stage);
  if(data[oldLabel]&&!['附加效果','技能本體'].includes(data[oldLabel]))throw Error('未知舊用途：'+data[oldLabel]);
  if(e){
   const migrated={};
   for(const [label,key] of primary){
    if(!data[label])continue;
    const target=vfx.columns.find(c=>c[1]===key);
    if(!target)throw Error('事件無對應角色：'+gid+'/'+stage+'/'+label);
    migrated[key]=data[label];data[target[0]]=data[label];data[label]='';
   }
   vfx.validate(gid,stage,migrated);
  }
  data[vfx.noteColumn]=vfx.note(gid,stage);
  return newHeader.map(c=>data[c]||'');
 })];
}
if(require.main===module){
 const out=process.argv[2];if(!out)throw Error('指定輸出 JSON 路徑；本工具不直接寫 Excel');
 const original=table.readXlsxRows(path.resolve(__dirname,'../config/Excel/Skills2.xlsx'));
 const rows=migrate(original);
 // 使用正式編譯器確認狀態、數值與新增欄位均合法。
 table.SCHEMAS.Skills2.rebuild(rows.slice(1),rows[0]);
 const before=['特殊效果','特殊用途特效','特效用途特效'].find(c=>original[0].includes(c));
 fs.writeFileSync(out,JSON.stringify({sheets:[{name:'Skills2',rows,
   insertColumns:[{before,headers:vfx.columns.map(c=>c[0]),width:28}],clearValidationColumns:[vfx.noteColumn]},
  {name:'欄位定義',replace:true,rows:table.SCHEMAS.Skills2.extraSheets[0].rows}]}));
 console.log('已驗證 '+(rows.length-1)+' 列；未修改正式 Excel／CSV');
}
module.exports={migrate};
