"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Core=require('../../js/vfx-core.js'),Layout=require('./editor/layout-schema.js');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function version(root){
 const files=['js/vfx-core.js','js/vfx-pixi-backend.js','js/vfx-runtime.js','tools/vfx/editor-server.cjs','tools/vfx/editor-guard.cjs'];
 function walk(dir){if(!fs.existsSync(path.join(root,dir)))return;for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const rel=dir+'/'+e.name;if(e.isDirectory())walk(rel);else if(/\.(js|css|html)$/.test(e.name))files.push(rel);}}
 walk('tools/vfx/editor');
 return hash(files.sort().map(f=>f+':'+(fs.existsSync(path.join(root,f))?hash(fs.readFileSync(path.join(root,f))):'missing')).join('\n'));
}
function revision(root,id,kind){
 try {const raw=fs.readFileSync(path.join(root,'vfx',kind==='layout'?'layouts':'presets',id+'.json'),'utf8');
  try{return hash((kind==='layout'?Layout.serialiseLayout:Core.serialisePreset)(JSON.parse(raw.replace(/^\uFEFF/,''))));}catch(e){return hash(raw);}
 }catch(e){if(e.code==='ENOENT')return hash('');throw e;}
}
function check(root,headers,id,kind){
 if(!headers['x-vfx-version']||headers['x-vfx-version']!==version(root))return '編輯器版本已過期，請先下載編輯備份，再重新啟動伺服器並重新載入編輯器。舊分頁禁止覆寫。';
 if(headers['x-vfx-base']!==revision(root,id,kind)||headers['x-vfx-peer-base']!==revision(root,id,kind==='layout'?'preset':'layout'))return '特效或分組檔已由外部更新，已阻止舊內容覆寫。請先下載編輯備份，再重新載入並比對修改。';
 return null;
}
module.exports={version,revision,hash,check};
