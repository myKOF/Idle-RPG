'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync,execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'..');
const windows=process.platform==='win32';
function git(cwd,...args){return execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function fixture({conflict=true,buildFails=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync auto conflicts '));
 const repo=path.join(root,'develop'),remote=path.join(root,'remote.git');
 fs.mkdirSync(repo);git(repo,'init','-b','develop');git(repo,'config','user.name','Sync Test');git(repo,'config','user.email','sync@example.invalid');
 fs.mkdirSync(path.join(repo,'tools'));
 for(const name of ['sync_ai_worktrees.ps1','resolve-sync-conflicts.ps1'])fs.copyFileSync(path.join(source,'tools',name),path.join(repo,'tools',name));
 fs.writeFileSync(path.join(repo,'tools','build_check.cjs'),`process.exit(${buildFails?1:0});\n`);
 fs.writeFileSync(path.join(repo,'state.txt'),'base\n');git(repo,'add','.');git(repo,'commit','-m','base');
 fs.writeFileSync(path.join(repo,'untouched.txt'),'unchanged\n');git(repo,'add','untouched.txt');git(repo,'commit','-m','untouched guard');
 for(const name of ['antigravity','claude','codex'])git(repo,'worktree','add','-b','ai/'+name,path.join(root,name));
 git(repo,'init','--bare',remote);git(repo,'remote','add','origin',remote);git(repo,'push','origin','--all');
 const initialRemote=git(repo,'rev-parse','refs/remotes/origin/develop');
 if(conflict){
  fs.writeFileSync(path.join(repo,'state.txt'),'ours\n');git(repo,'add','state.txt');git(repo,'commit','-m','ours');
  const agent=path.join(root,'codex');fs.writeFileSync(path.join(agent,'state.txt'),'theirs\n');git(agent,'add','state.txt');git(agent,'commit','-m','theirs');
 }
 const original=git(repo,'rev-parse','HEAD'),incoming=git(repo,'rev-parse','ai/codex');
 const fake=path.join(root,'fake codex.cmd');
 fs.writeFileSync(path.join(root,'fake-codex.cjs'),String.raw`
const fs=require('fs'),path=require('path'),cp=require('child_process');
const args=process.argv.slice(2),arg=n=>args[args.indexOf(n)+1];
const repo=arg('--cd'),mode=process.env.SYNC_FAKE_MODE||'resolved';
const assets=process.env.SYNC_FAKE_ASSET_ROOT;
const prompt=fs.readFileSync(0,'utf8');
if(!prompt.includes('DO NOT commit the GAME')||!args.includes('never')||!args.includes('--ignore-user-config')||arg('--sandbox')!=='workspace-write')process.exit(8);
fs.appendFileSync(path.join(__dirname,'calls.txt'),mode+'\n');
const git=(...a)=>cp.execFileSync('git',['-C',repo,...a],{stdio:'pipe'});
if(mode==='exit')process.exit(7);
if(!['blocked','unmerged'].includes(mode)){
 fs.writeFileSync(path.join(repo,'state.txt'),mode==='markers'?'<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n':'ours + theirs\n');
 git('add','state.txt');
 if(mode==='dirty')fs.appendFileSync(path.join(repo,'untouched.txt'),'unstaged\n');
 if(mode==='untracked')fs.writeFileSync(path.join(repo,'leftover.tmp'),'not staged');
 if(mode==='commit')git('commit','-m','unexpected agent commit');
}
if(assets)fs.writeFileSync(path.join(assets,'new.json'),'{"saved":true}\n');
fs.writeFileSync(arg('--output-last-message'),JSON.stringify({status:mode==='blocked'?'blocked':'resolved',summary:mode,tests:['fixture regression passed'],files:mode==='escape'?['../outside.txt']:['state.txt'],asset_files:assets?['new.json']:[]}));
`);
 fs.writeFileSync(fake,'@echo off\r\n"'+process.execPath+'" "'+path.join(root,'fake-codex.cjs')+'" %*\r\nexit /b %ERRORLEVEL%\r\n');
 const run=(mode='resolved',extra=[])=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(repo,'tools','sync_ai_worktrees.ps1'),'-RepositoryPath',repo,'-SyncRemoteFirst','-SkipAssetLibrary','-CodexCommand',fake,...extra],{encoding:'utf8',timeout:90000,env:{...process.env,SYNC_FAKE_MODE:mode}});
 const remoteHead=()=>git(remote,'rev-parse','develop');
 const pending=()=>spawnSync('git',['-C',repo,'rev-parse','--verify','MERGE_HEAD'],{encoding:'utf8'}).status===0;
 const log=r=>(r.stdout||'')+'\n'+(r.stderr||'');
 return {root,repo,remote,run,remoteHead,pending,original,incoming,initialRemote,log,clean:()=>{
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(root).startsWith('sync auto conflicts '));
  fs.rmSync(root,{recursive:true,force:true,maxRetries:6,retryDelay:200});
 }};
}
test('PowerShell scripts parse and BAT stays ASCII/CRLF', {skip:!windows},()=>{
 const bat=fs.readFileSync(path.join(source,'sync_ai_worktrees.bat'));
 assert.ok([...bat].every(n=>n<128));assert.ok(!/(?<!\r)\n/.test(bat.toString()));
 for(const file of ['sync_ai_worktrees.ps1','resolve-sync-conflicts.ps1']){
  const p=path.join(source,'tools',file).replace(/'/g,"''");
  const cmd=`$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile('${p}',[ref]$t,[ref]$e)>$null;if($e.Count){$e|%{$_.Message};exit 1}`;
  const r=spawnSync('powershell.exe',['-NoProfile','-Command',cmd],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
 }
});
test('Real local remotes: automatic resolution commits both parents, pushes develop and fast-forwards every AI worktree', {skip:!windows},()=>{
 const f=fixture();try{
  const r=f.run();assert.equal(r.status,0,f.log(r));const head=git(f.repo,'rev-parse','HEAD');
  assert.equal(f.remoteHead(),head);assert.equal(f.pending(),false);
  assert.equal(fs.readFileSync(path.join(f.repo,'state.txt'),'utf8'),'ours + theirs\n');
  assert.deepEqual(git(f.repo,'show','-s','--format=%P','HEAD').split(' '),[f.original,f.incoming]);
  for(const name of ['antigravity','claude','codex'])assert.equal(git(path.join(f.root,name),'rev-parse','HEAD'),head);
  assert.equal(git(f.repo,'status','--porcelain'),'');assert.equal(fs.readFileSync(path.join(f.root,'calls.txt'),'utf8'),'resolved\n');
 }finally{f.clean();}
});
test('No conflict and ValidateOnly never call the resolver', {skip:!windows},()=>{
 const f=fixture({conflict:false});try{
  for(const extra of [['-ValidateOnly'],[]]){const r=f.run('resolved',extra);assert.equal(r.status,0,f.log(r));}
  assert.ok(!fs.existsSync(path.join(f.root,'calls.txt')));assert.equal(f.remoteHead(),f.initialRemote);
 }finally{f.clean();}
});
for(const mode of ['blocked','exit','unmerged','markers','dirty','untracked','escape','commit'])test(`Resolver ${mode}: preserve evidence and never push develop`,{skip:!windows},()=>{
 const f=fixture();try{
  const r=f.run(mode);assert.notEqual(r.status,0,f.log(r));assert.equal(f.remoteHead(),f.initialRemote);
  if(mode!=='commit'){assert.equal(git(f.repo,'rev-parse','HEAD'),f.original);assert.equal(f.pending(),true);}
  const logs=path.join(git(f.repo,'rev-parse','--absolute-git-dir'),'sync-auto-conflicts');assert.ok(fs.readdirSync(logs).length>0);
 }finally{f.clean();}
});
test('Missing Codex executable preserves the merge and does not push develop', {skip:!windows},()=>{
 const f=fixture();try{
  fs.unlinkSync(path.join(f.root,'fake codex.cmd'));
  const r=f.run();assert.notEqual(r.status,0,f.log(r));assert.match(f.log(r),/Cannot find Codex CLI/);
  assert.equal(f.pending(),true);assert.equal(f.remoteHead(),f.initialRemote);assert.equal(git(f.repo,'rev-parse','HEAD'),f.original);
 }finally{f.clean();}
});
test('Independent build failure blocks merge commit and push', {skip:!windows},()=>{
 const f=fixture({buildFails:true});try{
  const r=f.run();assert.notEqual(r.status,0,f.log(r));assert.match(f.log(r),/Independent build failed/);
  assert.equal(git(f.repo,'rev-parse','HEAD'),f.original);assert.equal(f.remoteHead(),f.initialRemote);assert.equal(f.pending(),true);
 }finally{f.clean();}
});
test('Rerun resumes a known pending merge, without requiring a human to resolve it', {skip:!windows},()=>{
 const f=fixture();try{
  const a=f.run('blocked');assert.notEqual(a.status,0);assert.equal(f.pending(),true);
  const before=f.run('resolved',['-ValidateOnly']);assert.notEqual(before.status,0);assert.equal(f.pending(),true);
  const b=f.run();assert.equal(b.status,0,f.log(b));assert.equal(f.pending(),false);assert.equal(f.remoteHead(),git(f.repo,'rev-parse','HEAD'));
  assert.equal(fs.readFileSync(path.join(f.root,'calls.txt'),'utf8'),'blocked\nresolved\n');
 }finally{f.clean();}
});
test('NoAutoResolve leaves conflicts intact without invoking Codex', {skip:!windows},()=>{
 const f=fixture();try{
  const r=f.run('resolved',['-NoAutoResolve']);assert.notEqual(r.status,0);assert.equal(f.pending(),true);assert.equal(f.remoteHead(),f.initialRemote);
  assert.ok(!fs.existsSync(path.join(f.root,'calls.txt')));
 }finally{f.clean();}
});
for(const preStaged of [false,true])test(`Asset controller: ${preStaged?'reject existing staged work':'commit only reported necessary files'}`,{skip:!windows},()=>{
 const f=fixture();try{
  const assets=path.join(f.root,'assets');fs.mkdirSync(assets);git(assets,'init','-b','materials');git(assets,'config','user.name','Asset Test');git(assets,'config','user.email','assets@example.invalid');
  fs.writeFileSync(path.join(assets,'other.txt'),'base\n');git(assets,'add','.');git(assets,'commit','-m','base');const old=git(assets,'rev-parse','HEAD');
  fs.writeFileSync(path.join(assets,'other.txt'),'someone else working\n');if(preStaged)git(assets,'add','other.txt');
  spawnSync('git',['-C',f.repo,'merge','--no-ff','ai/codex'],{stdio:'ignore'});
  const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(f.repo,'tools','resolve-sync-conflicts.ps1'),'-Worktree',f.repo,'-IncomingSha',f.incoming,'-CodexCommand',path.join(f.root,'fake codex.cmd'),'-AssetLibraryRoot',assets],{encoding:'utf8',timeout:60000,env:{...process.env,SYNC_FAKE_MODE:'resolved',SYNC_FAKE_ASSET_ROOT:assets}});
  assert.equal(git(f.repo,'rev-parse','HEAD'),f.original);assert.equal(f.pending(),true);
  if(preStaged){assert.notEqual(r.status,0,f.log(r));assert.equal(git(assets,'rev-parse','HEAD'),old);}
  else{assert.equal(r.status,0,f.log(r));assert.equal(git(assets,'show','HEAD:other.txt'),'base');assert.equal(git(assets,'show','HEAD:new.json'),'{"saved":true}');assert.equal(git(assets,'diff','--name-only'),'other.txt');assert.equal(git(assets,'diff','--cached','--name-only'),'');}
 }finally{f.clean();}
});
for(const dirty of [false,true])test(`Full sync asset gate: ${dirty?'unpublished necessary assets block develop push':'new necessary assets sync before develop push'}`,{skip:!windows},()=>{
 const f=fixture();try{
  const assets=path.join(f.root,'assets'),assetRemote=path.join(f.root,'asset-remote.git');fs.mkdirSync(assets);git(assets,'init','-b','materials');git(assets,'config','user.name','Asset Sync');git(assets,'config','user.email','assets@example.invalid');
  fs.writeFileSync(path.join(assets,'other.txt'),'base\n');git(assets,'add','.');git(assets,'commit','-m','base');git(assets,'init','--bare',assetRemote);git(assets,'remote','add','origin',assetRemote);git(assets,'push','-u','origin','materials');const initialAsset=git(assets,'rev-parse','HEAD');
  if(dirty)fs.writeFileSync(path.join(assets,'other.txt'),'unfinished unrelated work\n');
  fs.mkdirSync(path.join(f.repo,'tools','vfx'));fs.writeFileSync(path.join(f.repo,'tools','vfx','vfx-library-root.cjs'),'console.log('+JSON.stringify(assets)+');\n');git(f.repo,'add','tools/vfx/vfx-library-root.cjs');git(f.repo,'commit','-m','local asset resolver fixture');
  const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(f.repo,'tools','sync_ai_worktrees.ps1'),'-RepositoryPath',f.repo,'-SyncRemoteFirst','-CodexCommand',path.join(f.root,'fake codex.cmd')],{encoding:'utf8',timeout:90000,env:{...process.env,SYNC_FAKE_MODE:'resolved',SYNC_FAKE_ASSET_ROOT:assets}});
  assert.notEqual(git(assets,'rev-parse','HEAD'),initialAsset,'controller saves necessary assets locally');
  if(dirty){assert.notEqual(r.status,0,f.log(r));assert.equal(f.remoteHead(),f.initialRemote);assert.equal(git(assetRemote,'rev-parse','materials'),initialAsset);assert.equal(git(assets,'diff','--name-only'),'other.txt');}
  else{assert.equal(r.status,0,f.log(r));assert.equal(f.remoteHead(),git(f.repo,'rev-parse','HEAD'));assert.equal(git(assetRemote,'rev-parse','materials'),git(assets,'rev-parse','HEAD'));}
 }finally{f.clean();}
});
