'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const project=path.resolve(__dirname,'..'),windows=process.platform==='win32';
const names=['art/original.png','art/empty.png','art/中文 空白.webp'];
function git(root,...a){return execFileSync('git',['-C',root,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function write(root,name,bytes){const dest=path.join(root,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();}
let seed;
after(()=>{if(seed){assert.ok(path.basename(seed.root).startsWith('sync asset recovery seed '));fs.rmSync(seed.root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync asset recovery '));
 const remote=path.join(root,'asset.git'),publisher=path.join(root,'publisher'),asset=path.join(root,'asset');
 const original=[Buffer.from([0,1,255,4]),Buffer.alloc(0),Buffer.from('本機不同版本')];
 let before,target;
 if(seed){
  fs.cpSync(seed.root,root,{recursive:true});git(publisher,'remote','set-url','origin',remote);git(asset,'remote','set-url','origin',remote);before=seed.before;target=seed.target;
 }else{
 fs.mkdirSync(publisher);git(publisher,'init','-b','trunk');git(publisher,'config','user.name','Recovery Test');git(publisher,'config','user.email','test@example.invalid');git(publisher,'config','core.autocrlf','false');
 write(publisher,'tracked.txt','base\n');write(publisher,'.gitignore','ignored/\n');git(publisher,'add','.');git(publisher,'commit','-m','asset base');
 git(publisher,'init','--bare',remote);git(publisher,'remote','add','origin',remote);git(publisher,'push','-u','origin','trunk');git(root,'clone','--branch','trunk',remote,asset);
 before=git(asset,'rev-parse','HEAD');
 for(const [i,name] of names.entries()){write(publisher,name,Buffer.from('complete remote '+i));write(asset,name,original[i]);}
 git(publisher,'add','.');git(publisher,'commit','-m','complete assets');git(publisher,'push');git(asset,'fetch','origin');
 target=git(asset,'rev-parse','origin/trunk');
 seed={root:fs.mkdtempSync(path.join(os.tmpdir(),'sync asset recovery seed ')),before,target};fs.cpSync(root,seed.root,{recursive:true});
 }
 const metadata=path.join(asset,'.git'),directory=path.join(metadata,'sync-asset-recovery'),pending=path.join(directory,'pending.json');
 const runner=path.join(root,'run.ps1');
 write(root,'run.ps1',`param([string]$Asset,[string]$Target,[string]$Mode='none',[switch]$Disabled)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
. '${path.join(project,'tools/sync-asset-recovery.ps1').replace(/'/g,"''")}'
$held=$null
try {
 if($Mode -eq 'locked'){$held=[IO.File]::Open((Join-Path $Asset 'art/empty.png'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
 if($Mode -eq 'interrupt'){
  $script:moveCount=0
  function Move-Item {
   [CmdletBinding()]param([string]$LiteralPath,[string]$Destination)
   $script:moveCount++
   if($script:moveCount -eq 2){throw 'injected interruption'}
   Microsoft.PowerShell.Management\\Move-Item @PSBoundParameters
  }
 }
 $result=Invoke-SyncAssetResidualRecovery -Worktree $Asset -Target $Target -Disabled:$Disabled
 Write-Output "RESULT=$result"
}catch{Write-Output $_.Exception.Message;exit 1}finally{if($held){$held.Dispose()}}
`);
 const f={root,remote,publisher,asset,before,target,original,directory,pending,
  run(mode='none',args=[]){return spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',runner,'-Asset',asset,'-Target',f.target,'-Mode',mode,...args],{encoding:'utf8',timeout:90000});},
  records(){return fs.existsSync(directory)?fs.readdirSync(directory,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>path.join(directory,x.name,'record.json')):[];},
  clean(){assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(root).startsWith('sync asset recovery '));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
 };
 return f;
}
const output=r=>(r.stdout||'')+'\n'+(r.stderr||'');
function originals(f){names.forEach((n,i)=>assert.deepEqual(fs.readFileSync(path.join(f.asset,n)),f.original[i]));}
function backups(f){const records=f.records();assert.equal(records.length,1);const record=JSON.parse(fs.readFileSync(records[0],'utf8').replace(/^\uFEFF/,''));assert.equal(record.State,'backed-up');for(const file of record.Files){const backup=path.join(path.dirname(records[0]),'files',file.Path);assert.equal(hash(backup),file.Hash);assert.deepEqual(fs.readFileSync(backup),f.original[names.indexOf(file.Path)]);}return record;}

test('moves differing, zero-byte and Unicode leftovers into verified backups, then permits fast-forward and rerun',{skip:!windows},()=>{
 const f=fixture();try{
  const r=f.run();assert.equal(r.status,0,output(r));assert.match(output(r),/RESULT=recovered/);backups(f);assert.equal(fs.existsSync(f.pending),false);
  git(f.asset,'merge','--ff-only',f.target);assert.equal(git(f.asset,'status','--porcelain'),'');for(const n of names)assert.deepEqual(fs.readFileSync(path.join(f.asset,n)),fs.readFileSync(path.join(f.publisher,n)));
  const again=f.run();assert.equal(again.status,0,output(again));assert.match(output(again),/RESULT=none/);assert.equal(f.records().length,1);
 }finally{f.clean();}
});

for(const mode of ['unrelated','tracked','staged','diverged','disabled'])test('preserves '+mode+' work without sweeping or backing up files',{skip:!windows},()=>{
 const f=fixture();try{
  if(mode==='unrelated')write(f.asset,'new-user-art.png','in progress');
  if(['tracked','staged','diverged'].includes(mode))write(f.asset,'tracked.txt','user edit\n');
  if(['staged','diverged'].includes(mode))git(f.asset,'add','tracked.txt');
  if(mode==='diverged'){git(f.asset,'config','user.name','Test');git(f.asset,'config','user.email','test@example.invalid');git(f.asset,'commit','-m','independent work');}
  const before=git(f.asset,'rev-parse','HEAD');const r=f.run('none',mode==='disabled'?['-Disabled']:[]);
  assert.equal(r.status,0,output(r));assert.match(output(r),/RESULT=none/);originals(f);assert.equal(git(f.asset,'rev-parse','HEAD'),before);assert.equal(fs.existsSync(f.pending),false);assert.equal(f.records().length,0);
 }finally{f.clean();}
});

test('locked asset fails before any file moves',{skip:!windows},()=>{
 const f=fixture();try{const r=f.run('locked');assert.equal(r.status,1,output(r));originals(f);assert.equal(fs.existsSync(f.pending),false);assert.equal(f.records().length,0);}finally{f.clean();}
});

test('resumes interrupted file moves using the original receipt and original hashes',{skip:!windows},()=>{
 const f=fixture();try{const first=f.run('interrupt');assert.equal(first.status,1,output(first));assert.match(output(first),/injected interruption/);assert.ok(fs.existsSync(f.pending));const pending=fs.readFileSync(f.pending);const disabled=f.run('none',['-Disabled']);assert.equal(disabled.status,1);assert.deepEqual(fs.readFileSync(f.pending),pending);
  const resumed=f.run();assert.equal(resumed.status,0,output(resumed));backups(f);git(f.asset,'merge','--ff-only',f.target);assert.equal(git(f.asset,'status','--porcelain'),'');
 }finally{f.clean();}
});

for(const mode of ['backup-corrupted','target-moved','new-local-file'])test('stops a pending backup when '+mode,{skip:!windows},()=>{
 const f=fixture();try{
  assert.equal(f.run('interrupt').status,1);const record=JSON.parse(fs.readFileSync(f.pending,'utf8'));const moved=record.Files.find(x=>!fs.existsSync(path.join(f.asset,x.Path)));const saved=path.join(f.directory,record.Id,'files',moved.Path);
  if(mode==='backup-corrupted')fs.appendFileSync(saved,'changed');
  if(mode==='new-local-file')write(f.asset,moved.Path,'new user content');
  if(mode==='target-moved'){write(f.publisher,'later.txt','later');git(f.publisher,'add','.');git(f.publisher,'commit','-m','advance upstream');git(f.publisher,'push');git(f.asset,'fetch');f.target=git(f.asset,'rev-parse','origin/trunk');}
  const r=f.run();assert.equal(r.status,1,output(r));assert.equal(git(f.asset,'rev-parse','HEAD'),f.before);assert.ok(fs.existsSync(f.pending));assert.equal(f.records().length,1);
 }finally{f.clean();}
});

test('refuses a linked backup directory without writing outside Git metadata',{skip:!windows},()=>{
 const f=fixture();try{const external=path.join(f.root,'external');fs.mkdirSync(external);fs.symlinkSync(external,f.directory,'junction');const r=f.run();assert.equal(r.status,1,output(r));assert.match(output(r),/Linked asset path/);originals(f);assert.deepEqual(fs.readdirSync(external),[]);}finally{f.clean();}
});

test('rejects a tampered pending receipt attempting to move a tracked asset',{skip:!windows},()=>{
 const f=fixture();try{const trackedBefore=fs.readFileSync(path.join(f.asset,'tracked.txt'));assert.equal(f.run('interrupt').status,1);const record=JSON.parse(fs.readFileSync(f.pending,'utf8'));record.Files.push({Path:'tracked.txt',Hash:hash(path.join(f.asset,'tracked.txt')),IncomingBlob:git(f.asset,'rev-parse',f.target+':tracked.txt')});fs.writeFileSync(f.pending,JSON.stringify(record));const r=f.run();assert.equal(r.status,1,output(r));assert.match(output(r),/Invalid asset backup receipt/);assert.deepEqual(fs.readFileSync(path.join(f.asset,'tracked.txt')),trackedBefore);}finally{f.clean();}
});

test('leaves a linked source directory and its external files unchanged',{skip:!windows},()=>{
 const f=fixture();try{const external=path.join(f.root,'external');fs.renameSync(path.join(f.asset,'art'),external);fs.symlinkSync(external,path.join(f.asset,'art'),'junction');const r=f.run();assert.ok(r.status===0||r.status===1,output(r));originals(f);assert.equal(f.records().length,0);assert.equal(git(f.asset,'rev-parse','HEAD'),f.before);}finally{f.clean();}
});

test('preserves ignored local files colliding with incoming tracked assets',{skip:!windows},()=>{
 const f=fixture();try{write(f.publisher,'ignored/new.png','upstream');git(f.publisher,'add','-f','ignored/new.png');git(f.publisher,'commit','-m','new ignored-path asset');git(f.publisher,'push');git(f.asset,'fetch');f.target=git(f.asset,'rev-parse','origin/trunk');write(f.asset,'ignored/new.png','local ignored artwork');const r=f.run();assert.equal(r.status,1,output(r));assert.match(output(r),/Ignored file overlaps/);originals(f);assert.equal(fs.readFileSync(path.join(f.asset,'ignored/new.png'),'utf8'),'local ignored artwork');assert.equal(f.records().length,0);}finally{f.clean();}
});

function codeFixture(f){
 const repo=path.join(f.root,'develop'),remote=path.join(f.root,'code.git');fs.mkdirSync(repo);git(repo,'init','-b','develop');git(repo,'config','user.name','Code Test');git(repo,'config','user.email','test@example.invalid');git(repo,'config','core.autocrlf','false');
 for(const name of ['sync_ai_worktrees.ps1','sync-index-recovery.ps1','sync-asset-recovery.ps1','invoke-sync-with-report.ps1']){const dest=path.join(repo,'tools',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(project,'tools',name),dest);}
 fs.copyFileSync(path.join(project,'sync_ai_worktrees.bat'),path.join(repo,'sync_ai_worktrees.bat'));write(repo,'tools/vfx/vfx-library-root.cjs',"console.log(process.env.SYNC_TEST_ASSET_ROOT);\n");write(repo,'.gitignore','logs/\n');git(repo,'add','.');git(repo,'commit','-m','[Codex] test: initial sync fixture');
 for(const name of ['antigravity','claude','codex'])git(repo,'worktree','add','-b','ai/'+name,path.join(f.root,name));git(repo,'init','--bare',remote);git(repo,'remote','add','origin',remote);git(repo,'push','origin','--all');
 return {repo,run(args=[]){return spawnSync('cmd.exe',['/d','/c','sync_ai_worktrees.bat',...args],{cwd:repo,encoding:'utf8',timeout:120000,env:{...process.env,SYNC_AI_NO_PAUSE:'1',SYNC_TEST_ASSET_ROOT:f.asset}});}};
}

test('actual BAT continues asset and AI sync and includes retained backup paths in Markdown',{skip:!windows},()=>{
 const f=fixture();try{const c=codeFixture(f);const r=c.run(['-NoAutoResolve']);assert.equal(r.status,0,output(r));assert.equal(git(f.asset,'rev-parse','HEAD'),f.target);assert.equal(git(f.remote,'rev-parse','trunk'),f.target);backups(f);
  const report=fs.readFileSync(path.join(c.repo,'logs/sync-ai-worktrees/latest.md'),'utf8');assert.match(report,/結果：成功/);assert.match(report,/sync-asset-recovery/);const head=git(c.repo,'rev-parse','HEAD');for(const name of ['antigravity','claude','codex'])assert.equal(git(path.join(f.root,name),'rev-parse','HEAD'),head);
  const again=c.run(['-NoAutoResolve']);assert.equal(again.status,0,output(again));assert.equal(f.records().length,1);
 }finally{f.clean();}
});

for(const option of ['-ValidateOnly','-NoAssetRecovery','-SkipAssetLibrary'])test('actual BAT '+option+' does not move asset leftovers',{skip:!windows},()=>{
 const f=fixture();try{const c=codeFixture(f);const r=c.run(['-NoAutoResolve',option]);assert.equal(r.status,0,output(r));originals(f);assert.equal(git(f.asset,'rev-parse','HEAD'),f.before);assert.equal(f.records().length,0);}finally{f.clean();}
});
