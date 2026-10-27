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
function publisher(f,branch='ai/claude-kpj271',file='cloud.txt') {
  const repo=path.join(f.root,'publisher-'+file.replace(/\W/g,''));
  git(f.root,'clone','--no-checkout',f.remote,repo);
  git(repo,'config','user.name','Claude');git(repo,'config','user.email','cloud@example.invalid');
  git(repo,'switch','--detach',f.initial);
  fs.writeFileSync(path.join(repo,file),'latest '+branch);git(repo,'add','.');git(repo,'commit','-m','[Claude] fix: cloud task');
  const sha=git(repo,'rev-parse','HEAD');git(repo,'push','origin','HEAD:refs/heads/'+branch);
  return {repo,sha,branch,file};
}
test('fetch後發現未簽出雲端及任意名稱AI來源，整合原始提交且不回寫來源分支',{skip:!windows},()=>{
  const f=fixture([]);try{
    const cloud=publisher(f),local=publisher(f,'work/animation-fix','local-task.txt');
    const main=publisher(f,'main','main-only.txt');
    git(f.repo,'fetch',local.repo,'HEAD:refs/heads/'+local.branch);
    assert.notEqual(spawnSync('git',['-C',f.repo,'show-ref','--verify','refs/remotes/origin/'+cloud.branch],{stdio:'ignore'}).status,0);
    const r=f.run();assert.equal(r.status,0,f.log(r));
    const head=git(f.repo,'rev-parse','HEAD');
    for(const p of [cloud,local]){
      assert.equal(git(f.repo,'merge-base','--is-ancestor',p.sha,head),'');
      assert.equal(fs.readFileSync(path.join(f.repo,p.file),'utf8'),'latest '+p.branch);
      assert.equal(git(f.remote,'rev-parse',p.branch),p.sha);
    }
    assert.equal(git(f.repo,'rev-parse',local.branch),local.sha);
    assert.ok(!fs.existsSync(path.join(f.repo,main.file)));
    assert.equal(git(f.remote,'rev-parse','main'),main.sha);
    for(const b of ['develop','ai/codex','ai/claude','ai/antigravity']){
      assert.equal(git(f.repo,'rev-parse',b),head);assert.equal(git(f.remote,'rev-parse',b),head);
    }
    assert.equal((git(f.repo,'worktree','list','--porcelain').match(/^worktree /gm)||[]).length,4);
    const again=f.run();assert.equal(again.status,0,f.log(again));assert.equal(git(f.repo,'rev-parse','HEAD'),head);
  }finally{f.clean();}
});
test('來源預檢與報告顯示未簽出分支，hold保留雲端來源直到解除',{skip:!windows},()=>{
  const f=fixture([]);try{
    const cloud=publisher(f);git(f.repo,'fetch','origin');
    const refs=git(f.repo,'show-ref');
    const preview=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(f.repo,'tools/invoke-sync-with-report.ps1'),'-RepositoryPath',f.repo,'-ValidateOnly','-SkipAssetLibrary'],{encoding:'utf8',timeout:30000});
    assert.equal(preview.status,0,f.log(preview));assert.equal(git(f.repo,'show-ref'),refs);
    const report=fs.readFileSync(path.join(f.repo,'logs/sync-ai-worktrees/latest.md'),'utf8');
    assert.match(report,/refs\/remotes\/origin\/ai\/claude-kpj271/);assert.match(report,/尚未包含於 develop/);
    assert.match(f.log(preview),/待整合來源／本機參照快照/);
    git(f.repo,'config','branch.ai/claude.codexSyncHold','true');
    const held=f.run();assert.equal(held.status,0,f.log(held));assert.ok(!fs.existsSync(path.join(f.repo,cloud.file)));
    git(f.repo,'config','branch.ai/claude.codexSyncHold','false');
    git(f.repo,'config','branch.'+cloud.branch+'.codexSyncHold','true');
    const exact=f.run();assert.equal(exact.status,0,f.log(exact));assert.ok(!fs.existsSync(path.join(f.repo,cloud.file)));
    git(f.repo,'config','branch.'+cloud.branch+'.codexSyncHold','false');
    const released=f.run();assert.equal(released.status,0,f.log(released));assert.equal(git(f.repo,'merge-base','--is-ancestor',cloud.sha,'HEAD'),'');
  }finally{f.clean();}
});
test('任意名稱已簽出AI來源有未提交內容時保留現場並停止',{skip:!windows},()=>{
  const f=fixture([]);try{
    const p=publisher(f,'work/latest-game');git(f.repo,'fetch',p.repo,'HEAD:refs/heads/'+p.branch);
    const dir=path.join(f.root,'arbitrary');git(f.repo,'worktree','add',dir,p.branch);fs.writeFileSync(path.join(dir,'draft.txt'),'keep');
    const r=f.run();assert.notEqual(r.status,0);assert.match(f.log(r),/未提交變更/);
    assert.equal(fs.readFileSync(path.join(dir,'draft.txt'),'utf8'),'keep');assert.equal(git(f.remote,'rev-parse','develop'),f.initial);
  }finally{f.clean();}
});
test('未簽出任務來源的衝突可識別並保留原MERGE_HEAD供下次接續',{skip:!windows},()=>{
  const f=fixture([]);try{
    const cloud=publisher(f);fs.writeFileSync(path.join(cloud.repo,'base.txt'),'cloud base\n');git(cloud.repo,'add','.');git(cloud.repo,'commit','-m','[Claude] fix: base');git(cloud.repo,'push','origin','HEAD:refs/heads/'+cloud.branch);
    const incoming=git(cloud.repo,'rev-parse','HEAD');
    fs.writeFileSync(path.join(f.repo,'base.txt'),'local base\n');git(f.repo,'add','.');git(f.repo,'commit','-m','[Codex] fix: local base');
    const first=f.run();assert.notEqual(first.status,0);assert.match(f.log(first),/NoAutoResolve/);
    assert.equal(git(f.repo,'rev-parse','MERGE_HEAD'),incoming);const head=git(f.repo,'rev-parse','HEAD');
    const resumed=f.run();assert.notEqual(resumed.status,0);assert.match(f.log(resumed),/自動接續 develop 尚未完成的任務來源合併/);assert.doesNotMatch(f.log(resumed),/不是已知 AI 分支/);
    assert.equal(git(f.repo,'rev-parse','MERGE_HEAD'),incoming);assert.equal(git(f.repo,'rev-parse','HEAD'),head);assert.equal(git(f.remote,'rev-parse','develop'),f.initial);
  }finally{f.clean();}
});
test('整合期間雲端來源前進時不推送不宣稱完成，重跑納入最新提交',{skip:!windows},()=>{
  const f=fixture([]);try{
    const cloud=publisher(f),hook=path.join(f.root,'advance.cjs');
    fs.writeFileSync(hook,`const fs=require('node:fs'),{execFileSync}=require('node:child_process');const repo=${JSON.stringify(cloud.repo)};const git=(...a)=>execFileSync('git',['-C',repo,...a]);const once=${JSON.stringify(path.join(f.root,'advanced'))};if(!fs.existsSync(once)){fs.writeFileSync(once,'1');fs.writeFileSync(${JSON.stringify(path.join(cloud.repo,'cloud-new.txt'))},'newest');git('add','.');git('commit','-m','[Claude] fix: newer cloud');git('push','origin','HEAD:refs/heads/${cloud.branch}');}`);
    const hooks=path.join(f.repo,'.git','hooks');fs.writeFileSync(path.join(hooks,'post-merge'),'#!/bin/sh\n"'+process.execPath.replace(/\\/g,'/')+'" "'+hook.replace(/\\/g,'/')+'"\n');
    const r=f.run();assert.notEqual(r.status,0,f.log(r));assert.match(f.log(r),/整合期間變更/);
    assert.equal(git(f.remote,'rev-parse','develop'),f.initial);assert.equal(git(f.repo,'merge-base','--is-ancestor',cloud.sha,'HEAD'),'');
    const again=f.run();assert.equal(again.status,0,f.log(again));assert.equal(fs.readFileSync(path.join(f.repo,'cloud-new.txt'),'utf8'),'newest');
    assert.equal(git(f.repo,'merge-base','--is-ancestor',git(cloud.repo,'rev-parse','HEAD'),'HEAD'),'');
  }finally{f.clean();}
});
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

test('固定AI分支hold不重建或納入同步，解除後才整合保留的提交',{skip:!windows},()=>{
  const f=fixture([]);try{
    const branch='ai/claude',worktree=path.join(f.root,'claude');
    const before=git(worktree,'rev-parse','HEAD'),draft=path.join(worktree,'draft.txt');
    fs.writeFileSync(draft,'private pipeline draft');
    git(f.repo,'config','branch.'+branch+'.codexSyncHold','true');
    const preview=f.run(['-ValidateOnly']);assert.equal(preview.status,0,f.log(preview));
    assert.doesNotMatch(f.log(preview),/將建立 ai\/claude/);
    const r=f.run();assert.equal(r.status,0,f.log(r));
    const head=git(f.repo,'rev-parse','HEAD');
    assert.equal(git(worktree,'rev-parse','HEAD'),before);
    assert.equal(git(f.remote,'rev-parse',branch),f.initial);
    assert.equal(fs.readFileSync(draft,'utf8'),'private pipeline draft');
    assert.ok(!fs.existsSync(path.join(f.root,'.ai-sync-worktrees','claude')));
    assert.ok(!fs.existsSync(path.join(f.repo,'claude.txt')));
    for(const other of ['ai/antigravity','ai/codex'])assert.equal(git(f.remote,'rev-parse',other),head);
    const again=f.run();assert.equal(again.status,0,f.log(again));
    assert.equal(git(f.repo,'rev-parse','HEAD'),head);
    git(f.repo,'config','branch.'+branch+'.codexSyncHold','false');
    const dirty=f.run();assert.notEqual(dirty.status,0);assert.match(f.log(dirty),/未提交變更/);
    fs.unlinkSync(draft);
    const released=f.run();assert.equal(released.status,0,f.log(released));
    assert.equal(fs.readFileSync(path.join(f.repo,'claude.txt'),'utf8'),'claude');
    assert.equal(git(f.repo,'merge-base','--is-ancestor',before,'HEAD'),'');
    assert.equal(git(f.remote,'rev-parse',branch),git(f.repo,'rev-parse','HEAD'));
  }finally{f.clean();}
});
