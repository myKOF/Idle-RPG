"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Core=require('../../js/vfx-core.js'),Layout=require('./editor/layout-schema.js');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function version(root){
 // Runtime 包含大量遊戲事件接線；只有編輯器的「遊戲播放測試」共用它。
 // 該測試的通用行為改變時，必須同步提高這個相容版號；遊戲專用分支不應要求編輯器重啟。
 const runtimePreviewRevision='1';
 const files=['js/vendor/pixi.min.js','js/vfx-core.js','js/vfx-pixi-backend.js',
  'js/vfx-water-tornado.js','js/util.js','tools/vfx/vfx-semantic-vocab.cjs',
  'tools/vfx/editor-server.cjs','tools/vfx/editor-guard.cjs'];
 function walk(dir){if(!fs.existsSync(path.join(root,dir)))return;for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const rel=dir+'/'+e.name;if(e.isDirectory())walk(rel);else if(/\.(js|css)$/.test(e.name)||rel==='tools/vfx/editor/index.html')files.push(rel);}}
 walk('tools/vfx/editor');
 return hash(runtimePreviewRevision+'\n'+files.sort().map(f=>{
  if(!fs.existsSync(path.join(root,f)))return f+':missing';
  let source=fs.readFileSync(path.join(root,f),'utf8');
  // script 的快取參數不改變載入後的編輯器行為。
  if(f==='tools/vfx/editor/index.html')source=source.replace(/(<script\s+src="[^"]+)\?v=[^"]+("[^>]*>)/g,'$1$2');
  return f+':'+hash(source);
 }).join('\n'));
}
function revision(root,id,kind){
 try {const raw=fs.readFileSync(path.join(root,'vfx',kind==='layout'?'layouts':'presets',id+'.json'),'utf8');
  try{return hash((kind==='layout'?Layout.serialiseLayout:Core.serialisePreset)(JSON.parse(raw.replace(/^\uFEFF/,''))));}catch(e){return hash(raw);}
 }catch(e){if(e.code==='ENOENT')return hash('');throw e;}
}
function check(root,headers,id,kind){
 if(!headers['x-vfx-version']||headers['x-vfx-version']!==version(root))return '編輯器共用程式已更新，請先下載編輯備份，再重新載入編輯器。舊分頁禁止覆寫。';
 if(headers['x-vfx-base']!==revision(root,id,kind)||headers['x-vfx-peer-base']!==revision(root,id,kind==='layout'?'preset':'layout'))return '特效或分組檔已由外部更新，已阻止舊內容覆寫。請先下載編輯備份，再重新載入並比對修改。';
 return null;
}
module.exports={version,revision,hash,check};
