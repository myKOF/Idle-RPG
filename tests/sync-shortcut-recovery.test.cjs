'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'..'),windows=process.platform==='win32';
const old='config/Excel/套用參數.bat.lnk',entry='config/Excel/套用參數.bat';
function git(root,...args){return execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();}
function fixture({replacement=true,unknown=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync shortcut recovery '));
 const repo=path.join(root,'develop'),remote=path.join(root,'remote.git');fs.mkdirSync(repo);
 git(repo,'init','-b','develop');git(repo,'config','user.name','Shortcut Recovery');git(repo,'config','user.email','shortcut@example.invalid');git(repo,'config','core.autocrlf','false');
 fs.mkdirSync(path.join(repo,'tools'));fs.mkdirSync(path.join(repo,'config/Excel'),{recursive:true});
 for(const name of ['sync_ai_worktrees.ps1','sync-index-recovery.ps1','invoke-sync-with-report.ps1'])fs.copyFileSync(path.join(source,'tools',name),path.join(repo,'tools',name));
 fs.copyFileSync(path.join(source,'sync_ai_worktrees.bat'),path.join(repo,'sync_ai_worktrees.bat'));
 fs.writeFileSync(path.join(repo,'.gitignore'),'logs/\n');fs.writeFileSync(path.join(repo,'套用參數.bat'),'@echo off\r\nexit /b 0\r\n');
 const retired=unknown?'config/Excel/other.lnk':old;
 fs.writeFileSync(path.join(repo,retired),Buffer.from([0,1,255,16,42]));fs.writeFileSync(path.join(repo,'untouched.txt'),'unchanged\n');
 git(repo,'add','.');git(repo,'commit','-m','before replacement');const before=git(repo,'rev-parse','HEAD');
 const agents=['antigravity','claude','codex'];
 for(const name of agents)git(repo,'worktree','add','-b','ai/'+name,path.join(root,name));
 git(repo,'init','--bare',remote);git(repo,'remote','add','origin',remote);git(repo,'push','origin','--all');
 fs.unlinkSync(path.join(repo,retired));fs.copyFileSync(path.join(source,entry),path.join(repo,entry));
 if(!replacement)fs.appendFileSync(path.join(repo,entry),'echo unexpected\r\n');
 fs.writeFileSync(path.join(repo,'new.txt'),'new content');git(repo,'add','--all');git(repo,'commit','-m','[Codex] fix: replace old launcher');const target=git(repo,'rev-parse','HEAD');
 git(repo,'push','origin','develop',...agents.map(n=>'HEAD:ai/'+n));
 const originals={};
 for(const name of agents){const worktree=path.join(root,name);originals[name]=Buffer.from('local '+name+'\0\xff','latin1');fs.writeFileSync(path.join(worktree,retired),originals[name]);git(worktree,'update-index','--skip-worktree','--',retired);if(name==='claude')git(worktree,'update-index','--assume-unchanged','--',retired);}
 const agent=path.join(root,'antigravity'),meta=git(agent,'rev-parse','--absolute-git-dir');
 const directory=path.join(meta,'sync-index-recovery'),pending=path.join(directory,'shortcut-pending.json');
 const bootstrap=path.join(root,'run.ps1');
 fs.writeFileSync(bootstrap,'\ufeff'+String.raw`
param([string]$Repository,[string]$Agent,[string]$Mode='none',[switch]$ReadOnly,[switch]$Disabled)
$ErrorActionPreference='Stop'
$global:realGit=(Get-Command git.exe).Source
function global:git {
 $a=@($args)
 if($a.Count -gt 3 -and $a[0] -eq '-C' -and $a[1].Replace('/','\') -eq $Agent.Replace('/','\')){
  if($Mode -eq 'interrupt' -and $a[2] -eq 'restore') {Write-Output 'injected preparation interruption';$global:LASTEXITCODE=1;return}
  if($Mode -eq 'flags-interrupt' -and -not $env:GIT_INDEX_FILE -and $a[2] -eq 'update-index' -and $a[3] -eq '--no-skip-worktree') {Write-Output 'injected flag interruption';$global:LASTEXITCODE=1;return}
  if($Mode -eq 'merge-fails' -and $a[2] -eq 'merge' -and $a[3] -eq '--ff-only') {Write-Output 'injected unrelated merge error';$global:LASTEXITCODE=1;return}
  if($Mode -eq 'index-fails' -and $a[2] -eq 'merge' -and $a[3] -eq '--ff-only') {
   $target=$a[4];$before=(& $global:realGit -C $Agent rev-parse HEAD).Trim()
   $previous=$env:GIT_INDEX_FILE
   $realIndex=(& $global:realGit -C $Agent rev-parse --path-format=absolute --git-path index).Trim()
   try {
    $env:GIT_INDEX_FILE=Join-Path ((& $global:realGit -C $Agent rev-parse --absolute-git-dir).Trim()) 'fault.index'
    Copy-Item -LiteralPath $realIndex -Destination $env:GIT_INDEX_FILE
    & $global:realGit -C $Agent update-index --refresh
    if($LASTEXITCODE -ne 0){throw 'Could not refresh simulated index'}
    & $global:realGit -C $Agent read-tree -m -u $before $target
    if($LASTEXITCODE -ne 0){throw 'Could not simulate index failure'}
   }finally{$env:GIT_INDEX_FILE=$previous}
   Write-Output 'error: unable to write new index file';$global:LASTEXITCODE=1;return
  }
 }
 & $global:realGit @a
 $global:LASTEXITCODE=$LASTEXITCODE
}
$extra=@{}
if($ReadOnly){$extra.ValidateOnly=$true}
if($Disabled){$extra.NoShortcutRecovery=$true}
& (Join-Path $Repository 'tools/sync_ai_worktrees.ps1') -RepositoryPath $Repository -SyncRemoteFirst -SkipAssetLibrary -NoAutoResolve @extra
exit $LASTEXITCODE
`);
 const run=(mode='none',extra=[])=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',bootstrap,'-Repository',repo,'-Agent',agent,'-Mode',mode,...extra],{encoding:'utf8',timeout:90000,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
 return {root,repo,remote,agent,meta,directory,pending,before,target,agents,originals,run,log:r=>(r.stdout||'')+'\n'+(r.stderr||''),clean(){
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(root).startsWith('sync shortcut recovery '));
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }};
}

test('actual BAT backs up hidden shortcuts, completes all worktrees/remotes and is repeatable',{skip:!windows},()=>{
 const f=fixture();try{
  const r=spawnSync('cmd.exe',['/d','/c','sync_ai_worktrees.bat','-SkipAssetLibrary','-NoAutoResolve','-NoIndexRecovery'],{cwd:f.repo,env:{...process.env,SYNC_AI_NO_PAUSE:'1'},encoding:'utf8',timeout:90000});
  assert.equal(r.status,0,f.log(r));assert.match(f.log(r),/舊捷徑替換完成/);
  for(const name of f.agents){const workspace=path.join(f.root,name),metadata=git(workspace,'rev-parse','--absolute-git-dir'),dir=path.join(metadata,'sync-index-recovery');
   assert.equal(git(workspace,'rev-parse','HEAD'),f.target);assert.equal(git(f.remote,'rev-parse','ai/'+name),f.target);assert.equal(git(workspace,'status','--porcelain'),'');
   assert.equal(fs.existsSync(path.join(workspace,old)),false);assert.deepEqual(fs.readFileSync(path.join(workspace,entry)),fs.readFileSync(path.join(source,entry)));
   assert.equal(git(workspace,'ls-files','-v','-z','--',old),'');assert.equal(fs.existsSync(path.join(dir,'shortcut-pending.json')),false);
   const backups=fs.readdirSync(dir).filter(n=>n.startsWith('shortcut-'));assert.equal(backups.length,1);
   const backup=path.join(dir,backups[0]),record=JSON.parse(fs.readFileSync(path.join(backup,'shortcut-record.json'),'utf8'));
   assert.equal(record.State,'completed');assert.equal(hash(path.join(backup,'shortcut.original.lnk')),record.ShortcutHash);
   assert.deepEqual(fs.readFileSync(path.join(backup,'shortcut.original.lnk')),f.originals[name]);assert.equal(hash(path.join(backup,'shortcut.index.before')),record.IndexHash);
  }
  assert.match(fs.readFileSync(path.join(f.repo,'logs/sync-ai-worktrees/latest.md'),'utf8'),/結果：成功/);
  const again=f.run();assert.equal(again.status,0,f.log(again));assert.equal(git(f.repo,'rev-parse','HEAD'),f.target);assert.equal(fs.readdirSync(f.directory).filter(n=>n.startsWith('shortcut-')).length,1);
 }finally{f.clean();}
});

for(const option of ['-ReadOnly','-Disabled'])test('shortcut recovery '+option+' leaves shortcuts and index untouched',{skip:!windows},()=>{
 const f=fixture();try{
  const index=path.join(f.meta,'index'),bytes=fs.readFileSync(index);const r=f.run('none',[option]);
  assert.equal(r.status,option==='-ReadOnly'?0:1,f.log(r));assert.deepEqual(fs.readFileSync(index),bytes);
  assert.deepEqual(fs.readFileSync(path.join(f.agent,old)),f.originals.antigravity);assert.equal(git(f.agent,'rev-parse','HEAD'),f.before);
  assert.equal(fs.existsSync(f.pending),false);
 }finally{f.clean();}
});

for(const mode of ['interrupt','flags-interrupt','merge-fails'])test('shortcut recovery resumes after '+mode+' and retains original backups',{skip:!windows},()=>{
 const f=fixture();try{
  if(mode==='flags-interrupt')git(f.agent,'update-index','--assume-unchanged','--',old);
  const first=f.run(mode);assert.equal(first.status,1,f.log(first));assert.ok(fs.existsSync(f.pending));assert.equal(git(f.agent,'rev-parse','HEAD'),f.before);
  const receipt=fs.readFileSync(f.pending),index=fs.readFileSync(path.join(f.meta,'index')),shortcut=fs.readFileSync(path.join(f.agent,old));
  for(const option of ['-ReadOnly','-Disabled']){const check=f.run('none',[option]);assert.equal(check.status,1,f.log(check));assert.deepEqual(fs.readFileSync(f.pending),receipt);assert.deepEqual(fs.readFileSync(path.join(f.meta,'index')),index);assert.deepEqual(fs.readFileSync(path.join(f.agent,old)),shortcut);}
  const r=f.run();assert.equal(r.status,0,f.log(r));assert.equal(git(f.agent,'rev-parse','HEAD'),f.target);assert.equal(fs.existsSync(f.pending),false);
  const record=JSON.parse(receipt);assert.deepEqual(fs.readFileSync(path.join(record.Backup,'shortcut.original.lnk')),f.originals.antigravity);
 }finally{f.clean();}
});

test('shortcut retirement and index write recovery cooperate in the same fast-forward',{skip:!windows},()=>{
 const f=fixture();try{
  const r=f.run('index-fails');assert.equal(r.status,0,f.log(r));assert.match(f.log(r),/自動修復完成/);assert.match(f.log(r),/舊捷徑替換完成/);
  assert.equal(git(f.agent,'rev-parse','HEAD'),f.target);assert.equal(fs.existsSync(f.pending),false);assert.equal(fs.existsSync(path.join(f.directory,'pending.json')),false);
  const backup=fs.readdirSync(f.directory).find(n=>n.startsWith('shortcut-'));assert.deepEqual(fs.readFileSync(path.join(f.directory,backup,'shortcut.original.lnk')),f.originals.antigravity);
 }finally{f.clean();}
});

test('shortcut recovery detects other hidden edits and can resume once that separate edit is resolved',{skip:!windows},()=>{
 const f=fixture();try{
  git(f.agent,'update-index','--assume-unchanged','untouched.txt');fs.writeFileSync(path.join(f.agent,'untouched.txt'),'hidden user work');
  const first=f.run();assert.equal(first.status,1,f.log(first));assert.match(f.log(first),/之外還有本機修改/);
  assert.deepEqual(fs.readFileSync(path.join(f.agent,old)),f.originals.antigravity);assert.equal(fs.readFileSync(path.join(f.agent,'untouched.txt'),'utf8'),'hidden user work');
  assert.equal(git(f.agent,'rev-parse','HEAD'),f.before);
  fs.writeFileSync(path.join(f.agent,'untouched.txt'),'unchanged\n');
  const r=f.run();assert.equal(r.status,0,f.log(r));assert.equal(git(f.agent,'ls-files','-v','untouched.txt'),'h untouched.txt');
 }finally{f.clean();}
});

for(const scenario of ['new-shortcut-edit','staged-edit','head-moved','backup-changed','lock'])test('shortcut resume refuses '+scenario+' without overwriting new work',{skip:!windows},()=>{
 const f=fixture();try{
  const first=f.run('interrupt');assert.equal(first.status,1,f.log(first));const record=JSON.parse(fs.readFileSync(f.pending,'utf8'));
  if(scenario==='new-shortcut-edit')fs.writeFileSync(path.join(f.agent,old),'new user shortcut');
  if(scenario==='staged-edit'){fs.writeFileSync(path.join(f.agent,'untouched.txt'),'staged user edit');git(f.agent,'add','untouched.txt');}
  if(scenario==='head-moved')git(f.agent,'update-ref','refs/heads/ai/antigravity',f.target,f.before);
  if(scenario==='backup-changed')fs.appendFileSync(path.join(record.Backup,'shortcut.original.lnk'),'changed');
  if(scenario==='lock')fs.writeFileSync(path.join(f.meta,'index.lock'),'someone else');
  const content=fs.readFileSync(path.join(f.agent,old)),index=fs.readFileSync(path.join(f.meta,'index'));
  const r=f.run();assert.equal(r.status,1,f.log(r));assert.deepEqual(fs.readFileSync(path.join(f.agent,old)),content);assert.deepEqual(fs.readFileSync(path.join(f.meta,'index')),index);assert.ok(fs.existsSync(f.pending));
 }finally{f.clean();}
});

for(const scenario of ['unknown-shortcut','nonstandard-launcher','visible-edit','new-launcher-collision','sparse-checkout'])test('shortcut recovery refuses '+scenario,{skip:!windows},()=>{
 const f=fixture({unknown:scenario==='unknown-shortcut',replacement:scenario!=='nonstandard-launcher'});try{
  if(scenario==='visible-edit')git(f.agent,'update-index','--no-skip-worktree','--',old);
  if(scenario==='new-launcher-collision')fs.writeFileSync(path.join(f.agent,entry),'user launcher');
  if(scenario==='sparse-checkout')git(f.agent,'config','core.sparseCheckout','true');
  const shortcut=path.join(f.agent,scenario==='unknown-shortcut'?'config/Excel/other.lnk':old),bytes=fs.readFileSync(shortcut),index=fs.readFileSync(path.join(f.meta,'index'));
  const r=f.run();assert.equal(r.status,1,f.log(r));assert.deepEqual(fs.readFileSync(shortcut),bytes);assert.deepEqual(fs.readFileSync(path.join(f.meta,'index')),index);assert.equal(git(f.agent,'rev-parse','HEAD'),f.before);
 }finally{f.clean();}
});
