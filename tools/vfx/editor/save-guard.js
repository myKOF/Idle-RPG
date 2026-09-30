/* Old pages must never adopt a newer version token while keeping old code. */
(function(root){
 'use strict';
 var loadedVersion=root.VFX_EDITOR_VERSION,backup=null,openDocuments=null,banner=null;
 async function digest(text){var bytes=new TextEncoder().encode(text==null?'':text);var sum=await root.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(sum)).map(function(x){return x.toString(16).padStart(2,'0');}).join('');}
 function notice(message){
  if(!root.document)return;
  if(!banner){banner=root.document.createElement('div');banner.setAttribute('role','alert');banner.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:100000;background:#482d12;color:#fff;padding:12px;border-top:2px solid #ffc45c';root.document.body.appendChild(banner);}
  banner.textContent=message+' 未存檔內容仍保留，請先下載備份；不要直接重新整理。';
  var button=root.document.createElement('button');button.textContent='下載全部編輯備份';button.onclick=function(){if(backup)backup();};banner.appendChild(button);
 }
 async function headers(base,peer){
  if(!loadedVersion){notice('編輯器／伺服器需要重新啟動。');throw new Error('缺少編輯器版本，請先下載備份，再重新啟動伺服器與編輯器。');}
  var values=await Promise.all([digest(base),digest(peer)]);
  return {'Content-Type':'application/json','X-VFX-Version':loadedVersion,'X-VFX-Base':values[0],'X-VFX-Peer-Base':values[1]};
 }
 async function check(){
  try{
   var docs=openDocuments?openDocuments().filter(function(d){return d.id&&d.preset!=null;}):[];
   var ids=Array.from(new Set(docs.map(function(d){return d.id;}))).slice(0,4);
   var query=ids.map(function(id){return 'id='+encodeURIComponent(id);}).join('&');
   var r=await root.fetch('/__vfx_version'+(query?'?'+query:''),{cache:'no-store'});
   if(!r.ok)throw new Error();
   var body=await r.json();
   if(body.stale){notice('VFX編輯器伺服器程式已更新，需要重啟編輯器。');return;}
   if(body.version!==loadedVersion){notice('VFX編輯器共用程式已更新，需要重新載入編輯器。');return;}
   for(var i=0;i<docs.length;i++){
    var current=body.documents&&body.documents[docs[i].id];
    if(!current)continue;
    // 輪詢期間剛好切換或存檔的文件應以新基準為準，下次再檢查。
    var latest=openDocuments?openDocuments().filter(function(d){return d.id===docs[i].id&&d.preset===docs[i].preset&&d.layout===docs[i].layout;}):[];
    if(!latest.length)continue;
    var base=await Promise.all([digest(docs[i].preset),digest(docs[i].layout)]);
    if(current.preset!==base[0]||current.layout!==base[1]){
     notice('目前開啟的特效「'+docs[i].id+'」已由外部更新，請備份後重新載入並比對修改。');
     return;
    }
   }
  }catch(e){notice('無法確認伺服器版本，請先備份，待連線恢復後再存檔。');}
 }
 function start(onBackup,getOpenDocuments){backup=onBackup;openDocuments=getOpenDocuments;check();root.setInterval(check,15000);root.addEventListener('focus',check);}
 root.VFXSaveGuard={headers:headers,digest:digest,notice:notice,start:start};
})(typeof window==='undefined'?globalThis:window);
