/* Old pages must never adopt a newer version token while keeping old code. */
(function(root){
 'use strict';
 var loadedVersion=root.VFX_EDITOR_VERSION,backup=null,banner=null;
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
 async function check(){try{var r=await root.fetch('/__vfx_version',{cache:'no-store'});if(!r.ok)throw new Error();var body=await r.json();if(body.stale||body.version!==loadedVersion)notice('VFX程式已更新，需要重新啟動伺服器並重新載入編輯器。');}catch(e){notice('無法確認伺服器版本，請先備份，待連線恢復後再存檔。');}}
 function start(onBackup){backup=onBackup;check();root.setInterval(check,15000);root.addEventListener('focus',check);}
 root.VFXSaveGuard={headers:headers,digest:digest,notice:notice,start:start};
})(typeof window==='undefined'?globalThis:window);
