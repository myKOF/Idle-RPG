'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'..');
const windows=process.platform==='win32';
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(owners=['codex']) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync feature branches '));
  const repo=path.join(root,'develop'),remote=path.join(root,'remote.git');
  fs.mkdirSync(repo);git(repo,'init','-b','develop');
  git(repo,'config','user.name','Sync Feature Test');git(repo,'config','user.email','sync@example.invalid');
  fs.mkdirSync(path.join(repo,'tools'));
  for(const file of ['sync_ai_worktrees.ps1','sync-index-recovery.ps1','invoke-sync-with-report.ps1'])fs.copyFileSync(path.join(source,'tools',file),path.join(repo,'tools',file));
  fs.writeFileSync(path.join(repo,'.gitignore'),'logs/\n');
  fs.writeFileSync(path.join(repo,'base.txt'),'base\n');git(repo,'add','.');git(repo,'commit','-m','base');
  for(const owner of ['antigravity','claude','codex'])git(repo,'worktree','add','-b','ai/'+owner,path.join(root,owner));
  git(repo,'init','--bare',remote);git(repo,'remote','add','origin',remote);git(repo,'push','origin','--all');
  const initial=git(repo,'rev-parse','HEAD'),commits=[],features=[];
  for(const owner of ['antigravity','claude','codex']) {
    const worktree=path.join(root,owner);
    fs.writeFileSync(path.join(worktree,owner+'.txt'),owner);git(worktree,'add','.');git(worktree,'commit','-m',owner+' change');
    commits.push(git(worktree,'rev-parse','HEAD'));
    if(owners.includes(owner)) {
      const branch=owner+'/knight-motion';features.push(branch);git(worktree,'switch','-c',branch);
      fs.writeFileSync(path.join(worktree,owner+'-motion.txt'),'motion');git(worktree,'add','.');git(worktree,'commit','-m',owner+' motion');
      commits.push(git(worktree,'rev-parse','HEAD'));
    }
  }
  const run=(extra=[])=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(repo,'tools/sync_ai_worktrees.ps1'),'-RepositoryPath',repo,'-SkipAssetLibrary','-SyncRemoteFirst','-NoAutoResolve',...extra],{encoding:'utf8',timeout:60000});
  const log=r=>(r.stdout||'')+'\n'+(r.stderr||'');
  return {root,repo,remote,initial,commits,features,run,log,clean(){
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    assert.ok(path.basename(root).startsWith('sync feature branches '));
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }};
}
test('專用分支預檢不建立副本、不切換分支、不推送',{skip:!windows},()=>{
  const f=fixture();try{
    const r=f.run(['-ValidateOnly']);assert.equal(r.status,0,f.log(r));
    assert.match(f.log(r),/將建立 ai\/codex/);
    assert.ok(!fs.existsSync(path.join(f.root,'.ai-sync-worktrees')));
    assert.equal(git(path.join(f.root,'codex'),'branch','--show-current'),'codex/knight-motion');
    assert.equal(git(f.remote,'rev-parse','develop'),f.initial);
    assert.equal(git(f.repo,'rev-parse','develop'),f.initial);
  }finally{f.clean();}
});
test('真Git完整同步保留三AI及兩個專用分支，缺固定副本自動建立，重跑不重建',{skip:!windows},()=>{
  const f=fixture(['codex','claude']);try{
    const r=f.run();assert.equal(r.status,0,f.log(r));
    const head=git(f.repo,'rev-parse','HEAD');
    for(const commit of f.commits)assert.equal(git(f.repo,'merge-base','--is-ancestor',commit,head),'');
    for(const owner of ['antigravity','claude','codex'])assert.equal(fs.readFileSync(path.join(f.repo,owner+'.txt'),'utf8'),owner);
    for(const branch of ['ai/antigravity','ai/claude','ai/codex',...f.features]){
      assert.equal(git(f.repo,'rev-parse',branch),head,branch);
      assert.equal(git(f.remote,'rev-parse',branch),head,branch+' remote');
    }
    for(const owner of ['claude','codex']){
      assert.equal(git(path.join(f.root,owner),'branch','--show-current'),owner+'/knight-motion');
      assert.equal(fs.readFileSync(path.join(f.repo,owner+'-motion.txt'),'utf8'),'motion');
      const fixed=path.join(f.root,'.ai-sync-worktrees',owner);
      assert.equal(git(fixed,'branch','--show-current'),'ai/'+owner);
      assert.equal(git(fixed,'status','--porcelain'),'');
      assert.equal(git(path.join(f.root,owner),'rev-parse','--abbrev-ref','@{upstream}'),'origin/'+owner+'/knight-motion');
    }
    const again=f.run();assert.equal(again.status,0,f.log(again));assert.equal(git(f.repo,'rev-parse','HEAD'),head);
    assert.doesNotMatch(f.log(again),/建立 ai\/.*固定同步副本/);
  }finally{f.clean();}
});
test('專用副本未提交內容先停止，保留檔案且不建立固定副本或推送',{skip:!windows},()=>{
  const f=fixture();try{
    const file=path.join(f.root,'codex','base.txt');fs.writeFileSync(file,'unfinished');
    const r=f.run();assert.notEqual(r.status,0);assert.match(f.log(r),/未提交變更/);
    assert.equal(fs.readFileSync(file,'utf8'),'unfinished');
    assert.ok(!fs.existsSync(path.join(f.root,'.ai-sync-worktrees')));
    assert.equal(git(f.remote,'rev-parse','develop'),f.initial);
  }finally{f.clean();}
});
test('固定副本目標已存在時拒絕覆蓋，保留使用者檔案與所有分支',{skip:!windows},()=>{
  const f=fixture();try{
    const dir=path.join(f.root,'.ai-sync-worktrees','codex');fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'user.txt'),'keep');
    const r=f.run();assert.notEqual(r.status,0);assert.match(f.log(r),/路徑已存在/);
    assert.equal(fs.readFileSync(path.join(dir,'user.txt'),'utf8'),'keep');
    assert.equal(git(f.repo,'rev-parse','HEAD'),f.initial);
  }finally{f.clean();}
});
test('同步報告列出專用分支與固定副本計畫，預檢不建立副本',{skip:!windows},()=>{
  const f=fixture();try{
    const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(f.repo,'tools/invoke-sync-with-report.ps1'),'-RepositoryPath',f.repo,'-ValidateOnly','-SkipAssetLibrary'],{encoding:'utf8',timeout:30000});
    assert.equal(r.status,0,f.log(r));
    const report=fs.readFileSync(path.join(f.repo,'logs/sync-ai-worktrees/latest.md'),'utf8');
    assert.match(report,/## codex\/knight-motion 狀態/);
    assert.match(report,/將建立 ai\/codex/);
    assert.ok(!fs.existsSync(path.join(f.root,'.ai-sync-worktrees')));
  }finally{f.clean();}
});
test('未核准試作保留分支與未提交內容、不推送不合併，三個AI仍可完整同步',{skip:!windows},()=>{
  const f=fixture();try{
    const worktree=path.join(f.root,'codex'),branch=f.features[0];
    git(f.repo,'config','branch.'+branch+'.codexSyncHold','true');
    const before=git(worktree,'rev-parse','HEAD'),draft=path.join(worktree,'draft.txt');
    fs.writeFileSync(draft,'unfinished model');
    const r=f.run();assert.equal(r.status,0,f.log(r));assert.match(f.log(r),/試作保護/);
    assert.equal(git(worktree,'rev-parse','HEAD'),before);assert.equal(git(worktree,'branch','--show-current'),branch);
    assert.equal(fs.readFileSync(draft,'utf8'),'unfinished model');
    assert.ok(!fs.existsSync(path.join(f.repo,'codex-motion.txt')));
    assert.notEqual(spawnSync('git',['-C',f.remote,'show-ref','--verify','refs/heads/'+branch],{stdio:'ignore'}).status,0);
    const head=git(f.repo,'rev-parse','HEAD');
    for(const fixed of ['ai/antigravity','ai/claude','ai/codex'])assert.equal(git(f.remote,'rev-parse',fixed),head);
    assert.equal(git(f.repo,'merge-base','--is-ancestor',f.commits[2],head),'');
  }finally{f.clean();}
});
