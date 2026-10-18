'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync,execFileSync}=require('node:child_process');
const windows=process.platform==='win32',source=path.resolve(__dirname,'..');
function git(root,...args){return execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function fixture({autocrlf=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync index recovery '));
 const repo=path.join(root,'develop'),remote=path.join(root,'remote.git');fs.mkdirSync(repo);
 git(repo,'init','-b','develop');git(repo,'config','user.name','Index Recovery Test');git(repo,'config','user.email','index@example.invalid');
 git(repo,'config','core.autocrlf',String(autocrlf));
 fs.mkdirSync(path.join(repo,'tools'));
 for(const file of ['sync_ai_worktrees.ps1','sync-index-recovery.ps1','invoke-sync-with-report.ps1'])fs.copyFileSync(path.join(source,'tools',file),path.join(repo,'tools',file));
 fs.writeFileSync(path.join(repo,'.gitignore'),'logs/\n');
 fs.writeFileSync(path.join(repo,'state.txt'),'old\n');fs.writeFileSync(path.join(repo,'removed.txt'),'deleted in incoming\n');fs.writeFileSync(path.join(repo,'untouched.txt'),'same\n');
 fs.writeFileSync(path.join(repo,'本機 shortcut.lnk'),Buffer.from([0,255,7,11,83,19]));
 git(repo,'add','.');git(repo,'commit','-m','old');const before=git(repo,'rev-parse','HEAD');
 for(const name of ['antigravity','claude','codex'])git(repo,'worktree','add','-b','ai/'+name,path.join(root,name));
 git(repo,'init','--bare',remote);git(repo,'remote','add','origin',remote);git(repo,'push','origin','--all');
 fs.writeFileSync(path.join(repo,'state.txt'),'new 中文\n');fs.unlinkSync(path.join(repo,'removed.txt'));fs.writeFileSync(path.join(repo,'added.txt'),'new file\n');
 git(repo,'add','--all');git(repo,'commit','-m','target');const target=git(repo,'rev-parse','HEAD');
 git(repo,'push','origin','develop',...['antigravity','claude','codex'].map(n=>'HEAD:ai/'+n));
 const agent=path.join(root,'antigravity'),meta=git(agent,'rev-parse','--absolute-git-dir');
 const pending=path.join(meta,'sync-index-recovery','pending.json');
 const bootstrap=path.join(root,'run.ps1');
 fs.writeFileSync(bootstrap,'\ufeff'+String.raw`
param([string]$Repository,[string]$Agent,[string]$Mode,[switch]$ReadOnly,[switch]$NoRecovery)
$ErrorActionPreference='Stop'
$global:realGit=(Get-Command git.exe).Source
$global:injected=$false
function global:git {
    $a=@($args)
    if ($Mode -ne 'none' -and -not $global:injected -and $a.Count -eq 5 -and $a[0] -eq '-C' -and
        $a[1].Replace('/','\') -eq $Agent.Replace('/','\') -and $a[2] -eq 'merge' -and $a[3] -eq '--ff-only') {
        $global:injected=$true
        $target=$a[4]
        if ($Mode -eq 'other-error') { Write-Output 'fatal: unrelated merge failure';$global:LASTEXITCODE=1;return }
        $old=(& $global:realGit -C $Agent rev-parse HEAD).Trim()
        $meta=(& $global:realGit -C $Agent rev-parse --absolute-git-dir).Trim()
        $previous=$env:GIT_INDEX_FILE
        try {
            $env:GIT_INDEX_FILE=Join-Path $meta 'fault-checkout.index'
            Copy-Item -LiteralPath (Join-Path $meta 'index') -Destination $env:GIT_INDEX_FILE
            & $global:realGit -C $Agent read-tree -m -u $old $target
            if ($LASTEXITCODE -ne 0) { throw 'Could not simulate checkout failure.' }
        } finally { $env:GIT_INDEX_FILE=$previous }
        if ($Mode -eq 'extra-edit') { [IO.File]::WriteAllText((Join-Path $Agent 'state.txt'),'user edit after checkout') }
        if ($Mode -eq 'hidden-edit') {
            [IO.File]::WriteAllText((Join-Path $Agent 'untouched.txt'),'hidden local edit')
        }
        if ($Mode -eq 'untracked') { [IO.File]::WriteAllText((Join-Path $Agent 'user-note.txt'),'do not remove') }
        if ($Mode -eq 'lock') { [IO.File]::WriteAllText((Join-Path $meta 'index.lock'),'owned by another process') }
        if ($Mode -eq 'head-moved') { & $global:realGit -C $Agent update-ref refs/heads/ai/antigravity $target $old }
        if ($Mode -eq 'index-changed') { & $global:realGit -C $Agent add state.txt }
        Write-Output 'error: unable to write new index file'
        $global:LASTEXITCODE=1
        return
    }
    if ($Mode -eq 'repair-fails' -and $a.Count -eq 4 -and $a[1].Replace('/','\') -eq $Agent.Replace('/','\') -and
        $a[2] -eq 'read-tree' -and -not $env:GIT_INDEX_FILE) {
        Write-Output 'persistent index write failure';$global:LASTEXITCODE=1;return
    }
    if ($Mode -eq 'cas-fails' -and $a -contains 'update-ref' -and $a -contains 'refs/heads/ai/antigravity') {
        # Simulate another writer advancing the branch immediately before compare-and-swap.
        $target=$a[-2]
        $concurrent=(& $global:realGit -C $Agent commit-tree ($target+'^{tree}') -p $target -m 'concurrent writer').Trim()
        & $global:realGit -C $Agent update-ref refs/heads/ai/antigravity $concurrent
        # Execute the real compare-and-swap; Git must reject the unexpected current value.
        & $global:realGit @a
        $global:LASTEXITCODE=$LASTEXITCODE;return
    }
    & $global:realGit @a
    $global:LASTEXITCODE=$LASTEXITCODE
}
$extra=@{}
if($ReadOnly){$extra.ValidateOnly=$true}
if($NoRecovery){$extra.NoIndexRecovery=$true}
$guard=$null
if($Mode -eq 'busy-controller'){
    $meta=(& $global:realGit -C $Agent rev-parse --absolute-git-dir).Trim()
    $directory=Join-Path $meta 'sync-index-recovery'
    [void][IO.Directory]::CreateDirectory($directory)
    $guard=[IO.File]::Open((Join-Path $directory 'controller.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
}
try {
    & (Join-Path $Repository 'tools\sync_ai_worktrees.ps1') -RepositoryPath $Repository -SyncRemoteFirst -SkipAssetLibrary @extra
    $code=$LASTEXITCODE
}finally{if($guard){$guard.Dispose()}}
exit $code
`);
 const run=(mode='normal',extra=[])=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',bootstrap,'-Repository',repo,'-Agent',agent,'-Mode',mode,...extra],{encoding:'utf8',timeout:90000});
 return {root,repo,remote,agent,meta,pending,before,target,run,log:r=>(r.stdout||'')+'\n'+(r.stderr||''),clean(){
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(root).startsWith('sync index recovery '));
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }};
}
test('Index recovery: failed checkout repairs metadata and completes the whole sync without changing game files',{skip:!windows},()=>{
 const f=fixture();try{
  const r=f.run();assert.equal(r.status,0,f.log(r));assert.match(f.log(r),/自動修復完成/);
  assert.equal(fs.readFileSync(path.join(f.agent,'state.txt'),'utf8'),'new 中文\n');
  assert.equal(fs.readFileSync(path.join(f.agent,'added.txt'),'utf8'),'new file\n');assert.equal(fs.existsSync(path.join(f.agent,'removed.txt')),false);
  for(const name of ['develop','antigravity','claude','codex']){
   const worktree=path.join(f.root,name);assert.equal(git(worktree,'rev-parse','HEAD'),f.target);assert.equal(git(worktree,'status','--porcelain'),'');
  }
  assert.equal(fs.existsSync(f.pending),false);
  const attempts=path.join(f.meta,'sync-index-recovery');const backup=fs.readdirSync(attempts).find(n=>fs.statSync(path.join(attempts,n)).isDirectory());
  assert.ok(fs.existsSync(path.join(attempts,backup,'index.before')));assert.match(fs.readFileSync(path.join(attempts,backup,'git.log'),'utf8'),/unable to write new index file/);
 }finally{f.clean();}
});
test('Index recovery: disabled repair records the failure; ValidateOnly is read-only; next run resumes',{skip:!windows},()=>{
 const f=fixture();try{
  const first=f.run('normal',['-NoRecovery']);assert.equal(first.status,1,f.log(first));assert.ok(fs.existsSync(f.pending),f.log(first));assert.equal(git(f.agent,'rev-parse','HEAD'),f.before);
  const snapshot=fs.readFileSync(f.pending);const check=f.run('none',['-ReadOnly']);assert.equal(check.status,1,f.log(check));assert.deepEqual(fs.readFileSync(f.pending),snapshot);
  assert.equal(git(f.agent,'rev-parse','HEAD'),f.before);
  const resume=f.run('none');assert.equal(resume.status,0,f.log(resume));assert.equal(git(f.agent,'rev-parse','HEAD'),f.target);assert.equal(fs.existsSync(f.pending),false);
 }finally{f.clean();}
});
for(const mode of ['extra-edit','hidden-edit','untracked','lock','head-moved','index-changed','repair-fails','cas-fails'])test(`Index recovery refuses unsafe ${mode} and keeps evidence`,{skip:!windows},()=>{
 const f=fixture();try{
  if(mode==='hidden-edit')git(f.agent,'update-index','--skip-worktree','untouched.txt');
  const r=f.run(mode);assert.equal(r.status,1,f.log(r));assert.ok(fs.existsSync(f.pending));
  if(mode==='cas-fails'){
   assert.equal(git(f.agent,'log','-1','--format=%s'),'concurrent writer');
   git(f.agent,'merge-base','--is-ancestor',f.target,'HEAD');
  }else assert.equal(git(f.agent,'rev-parse','HEAD'),mode==='head-moved'?f.target:f.before);
  const record=JSON.parse(fs.readFileSync(f.pending,'utf8'));assert.ok(fs.existsSync(path.join(record.Backup,'index.before')));
  if(mode==='extra-edit')assert.equal(fs.readFileSync(path.join(f.agent,'state.txt'),'utf8'),'user edit after checkout');
  if(mode==='untracked')assert.equal(fs.readFileSync(path.join(f.agent,'user-note.txt'),'utf8'),'do not remove');
  if(mode==='lock')assert.equal(fs.readFileSync(path.join(f.meta,'index.lock'),'utf8'),'owned by another process');
  assert.equal(git(path.join(f.root,'claude'),'rev-parse','HEAD'),f.before,'sync stopped before other worktrees');
 }finally{f.clean();}
});
test('Index recovery: CRLF working files and existing index flags are preserved',{skip:!windows},()=>{
 const f=fixture({autocrlf:true});try{
  git(f.agent,'update-index','--skip-worktree','untouched.txt');
  git(f.agent,'update-index','--assume-unchanged','untouched.txt');
  git(f.agent,'update-index','--skip-worktree','本機 shortcut.lnk');
  const r=f.run();assert.equal(r.status,0,f.log(r));
  assert.equal(fs.readFileSync(path.join(f.agent,'state.txt'),'utf8'),'new 中文\r\n');
  assert.equal(git(f.agent,'ls-files','-v','untouched.txt'),'s untouched.txt');
  assert.equal(git(f.agent,'ls-files','-v','-z','--','本機 shortcut.lnk'),'S 本機 shortcut.lnk\0');
  assert.deepEqual(fs.readFileSync(path.join(f.agent,'本機 shortcut.lnk')),Buffer.from([0,255,7,11,83,19]));
 }finally{f.clean();}
});
test('Index recovery: unrelated merge failure never triggers metadata repair',{skip:!windows},()=>{
 const f=fixture();try{
  const r=f.run('other-error');assert.equal(r.status,1,f.log(r));assert.match(f.log(r),/unrelated merge failure/);assert.doesNotMatch(f.log(r),/自動修復完成/);
  assert.equal(git(f.agent,'rev-parse','HEAD'),f.before);assert.equal(git(f.agent,'status','--porcelain'),'');assert.equal(fs.existsSync(f.pending),false);
 }finally{f.clean();}
});
test('Index recovery: an unrecorded dirty checkout is never guessed to be a sync failure',{skip:!windows},()=>{
 const f=fixture();try{
  const alternate=path.join(f.meta,'manual-checkout.index');fs.copyFileSync(path.join(f.meta,'index'),alternate);
  execFileSync('git',['-C',f.agent,'read-tree','-m','-u',f.before,f.target],{env:{...process.env,GIT_INDEX_FILE:alternate},stdio:'pipe'});
  const r=f.run('none');assert.equal(r.status,1,f.log(r));assert.equal(git(f.agent,'rev-parse','HEAD'),f.before);
  assert.equal(fs.existsSync(f.pending),false);assert.equal(fs.readFileSync(path.join(f.agent,'state.txt'),'utf8'),'new 中文\n');
 }finally{f.clean();}
});
test('Index recovery: a changed target ref blocks resuming the old receipt',{skip:!windows},()=>{
 const f=fixture();try{
  const first=f.run('normal',['-NoRecovery']);assert.equal(first.status,1,f.log(first));
  git(f.agent,'update-ref','refs/remotes/origin/ai/antigravity',f.before,f.target);
  const r=f.run('none');assert.equal(r.status,1,f.log(r));assert.match(f.log(r),/目標已移動/);
  assert.equal(git(f.agent,'rev-parse','HEAD'),f.before);assert.equal(fs.existsSync(f.pending),true);
 }finally{f.clean();}
});
test('Index recovery: another controller holding the worktree guard prevents simultaneous repair',{skip:!windows},()=>{
 const f=fixture();try{
  const r=f.run('busy-controller');assert.equal(r.status,1,f.log(r));assert.equal(fs.existsSync(f.pending),false);
  assert.equal(git(f.agent,'rev-parse','HEAD'),f.before);assert.equal(git(f.agent,'status','--porcelain'),'');
 }finally{f.clean();}
});
