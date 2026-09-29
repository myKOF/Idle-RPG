const crypto=require('node:crypto');
const Core=require('../../js/vfx-core.js'),Layout=require('../../tools/vfx/editor/layout-schema.js');
const hash=t=>crypto.createHash('sha256').update(t).digest('hex');
module.exports=async function(port,id,kind='preset',target){
 const base='http://127.0.0.1:'+port;
 async function revision(id,kind){const r=await fetch(base+'/vfx/'+(kind==='layout'?'layouts':'presets')+'/'+id+'.json');if(!r.ok)return hash('');const raw=await r.text();try{return hash((kind==='layout'?Layout.serialiseLayout:Core.serialisePreset)(JSON.parse(raw.replace(/^\uFEFF/,''))));}catch(e){return hash(raw);}}
 const v=await(await fetch(base+'/__vfx_version')).json();
 const h={'X-VFX-Version':v.version,'X-VFX-Base':await revision(id,kind),'X-VFX-Peer-Base':await revision(id,kind==='layout'?'preset':'layout')};
 if(target){h['X-VFX-Target-Base']=await revision(target,'preset');h['X-VFX-Target-Layout']=await revision(target,'layout');}return h;
};
