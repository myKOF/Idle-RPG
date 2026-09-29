'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const Server=require('../tools/vfx/editor-server.cjs'),Guard=require('../tools/vfx/editor-guard.cjs'),Core=require('../js/vfx-core.js'),Layout=require('../tools/vfx/editor/layout-schema.js');
async function sandbox(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vfx-stale-'));
 for(const d of ['vfx/presets','vfx/layouts','tools/vfx/editor','js'])fs.mkdirSync(path.join(root,d),{recursive:true});
 const p={schemaVersion:1,id:'test-bolt',duration:1,layers:[{id:'sprite',type:'sprite',assetId:'test.png'}]};
 const file=path.join(root,'vfx/presets/test-bolt.json');fs.writeFileSync(file,Core.serialisePreset(p));
 const server=Server.__testOnly.createServer({repoRoot:root,assetRoots:{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 const headers=(id='test-bolt',kind='preset')=>({'Content-Type':'application/json','X-VFX-Version':Guard.version(root),'X-VFX-Base':Guard.revision(root,id,kind),'X-VFX-Peer-Base':Guard.revision(root,id,kind==='preset'?'layout':'preset')});
 const put=(h,body=p,id='test-bolt',kind='presets')=>fetch(url+'/vfx/'+kind+'/'+id+'.json',{method:'PUT',headers:h,body:JSON.stringify(body)});
 try{await fn({root,file,p,url,headers,put});}finally{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
}
test('舊分頁無版本／過期版本被拒，新版可存；重送舊基準不能覆蓋',()=>sandbox(async s=>{
 const before=fs.readFileSync(s.file,'utf8');assert.equal((await s.put({'Content-Type':'application/json'})).status,409);assert.equal(fs.readFileSync(s.file,'utf8'),before);
 const h=s.headers();assert.equal((await s.put({...h,'X-VFX-Version':'old'})).status,409);
 s.p.duration=2;assert.equal((await s.put(h)).status,200);s.p.duration=3;
 assert.equal((await s.put(h)).status,409);assert.equal(JSON.parse(fs.readFileSync(s.file)).duration,2);
}));
test('外部Preset或layout更新都先拒絕Preset寫入，原檔保留',()=>sandbox(async s=>{
 let h=s.headers();s.p.duration=4;fs.writeFileSync(s.file,Core.serialisePreset(s.p));let before=fs.readFileSync(s.file,'utf8');s.p.duration=5;
 assert.equal((await s.put(h)).status,409);assert.equal(fs.readFileSync(s.file,'utf8'),before);
 h=s.headers();fs.writeFileSync(path.join(s.root,'vfx/layouts/test-bolt.json'),Layout.serialiseLayout(Layout.emptyLayout('test-bolt')));
 assert.equal((await s.put(h)).status,409);assert.equal(fs.readFileSync(s.file,'utf8'),before);
}));
test('兩個分頁同基準競爭只有一個成功；新檔在確認後出現不覆蓋',()=>sandbox(async s=>{
 const h=s.headers(),results=await Promise.all([s.put(h,{...s.p,duration:2}),s.put(h,{...s.p,duration:3})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const fresh=s.headers('new-bolt');const p={...s.p,id:'new-bolt'};assert.equal((await s.put(fresh,p,'new-bolt')).status,200);assert.equal((await s.put(fresh,{...p,duration:8},'new-bolt')).status,409);
}));
test('程式在開啟後更新會拒絕存檔，版本端點反映更新',()=>sandbox(async s=>{
 const h=s.headers(),before=fs.readFileSync(s.file,'utf8');fs.writeFileSync(path.join(s.root,'js/vfx-core.js'),'new version');
 assert.equal((await s.put(h)).status,409);assert.equal(fs.readFileSync(s.file,'utf8'),before);
 const info=await(await fetch(s.url+'/__vfx_version')).json();assert.notEqual(info.version,h['X-VFX-Version']);
 const js=await(await fetch(s.url+'/__vfx_version.js')).text();assert.ok(js.includes(info.version));
}));
test('分組存檔同樣需要舊版基準；改名不能繞過過期保護',()=>sandbox(async s=>{
 const layout=Layout.emptyLayout('test-bolt');const h=s.headers('test-bolt','layout');assert.equal((await s.put(h,layout,'test-bolt','layouts')).status,200);
 assert.equal((await s.put(h,layout,'test-bolt','layouts')).status,409);
 const rename=await fetch(s.url+'/__rename-preset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:'test-bolt',to:'new-bolt'})});assert.equal(rename.status,409);assert.ok(fs.existsSync(s.file));
}));
test('瀏覽器固定載入版本，不採用新版本；提示與備份不更動文件或重新整理',async()=>{
 const elements=[],listeners={},document={body:{appendChild:n=>elements.push(n)},createElement:()=>({style:{},setAttribute(){},appendChild(n){this.child=n;}})};
 let version='loaded',backup=0;
 const context={TextEncoder,Uint8Array,crypto:require('node:crypto').webcrypto,document,VFX_EDITOR_VERSION:'loaded',fetch:async()=>({ok:true,json:async()=>({version,stale:false})}),setInterval:fn=>{listeners.poll=fn;},addEventListener:(k,fn)=>listeners[k]=fn};context.window=context;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../tools/vfx/editor/save-guard.js'),'utf8'),context);
 context.VFXSaveGuard.start(()=>backup++);await listeners.poll();assert.equal(elements.length,0);
 version='updated';await listeners.poll();assert.equal(elements.length,1);assert.match(elements[0].textContent,/重新啟動/);elements[0].child.onclick();assert.equal(backup,1);
 const headers=await context.VFXSaveGuard.headers('old text',null);assert.equal(headers['X-VFX-Version'],'loaded');assert.equal(headers['X-VFX-Base'],Guard.hash('old text'));
});


test('備份含每個分頁目前未存的Preset與layout，不呼叫存檔API',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../tools/vfx/editor/editor.js'),'utf8');
 const start=source.indexOf('VFXSaveGuard.start(function(){');const end=source.indexOf('\n    });',start)+7;
 let captured,callback,clicked=false;
 const panes=[{doc:{preset:{id:'a',duration:13},layout:{presetId:'a',groups:[]}}},{doc:{preset:{id:'b',duration:7},layout:null}}];
 vm.runInNewContext(source.slice(start,end),{panes,VFXSaveGuard:{start:fn=>callback=fn},Blob,URL:{createObjectURL:blob=>{captured=blob;return 'blob:backup';},revokeObjectURL(){}},document:{createElement:()=>({click(){clicked=true;}})},setTimeout(){}});
 callback();assert.ok(clicked);const data=JSON.parse(await captured.text());assert.equal(data.documents.length,2);assert.equal(data.documents[0].preset.duration,13);assert.equal(data.documents[1].preset.duration,7);assert.equal(data.documents[0].layout.presetId,'a');
});
