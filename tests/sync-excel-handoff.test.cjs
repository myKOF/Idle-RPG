'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'..'),windows=process.platform==='win32';
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
for(const mode of ['unauthorized','escape','stale','duplicate','linked'])test('Excel handoff rejects '+mode+' without touching workbook',{skip:!windows},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync excel guard '));
 try{
  fs.mkdirSync(path.join(root,'config','Excel'),{recursive:true});fs.mkdirSync(path.join(root,'private'));
  const book=path.join(root,'config','Excel','String.xlsx');fs.writeFileSync(book,'original bytes');
  const helper=path.join(source,'tools','sync-excel-handoff.ps1');
  const script=`$ErrorActionPreference='Stop';. ${quote(helper)};$ctx=New-SyncExcelContext -Root ${quote(root)} -RunDirectory ${quote(path.join(root,'private','attempt'))} -Conflicts @('config/Excel/String.xlsx') -Updater ${quote(path.join(source,'tools','excel-update-sheets.ps1'))};$plan=Join-Path $ctx.Plans 'plan.json';[IO.File]::WriteAllText($plan,'{"sheets":[{"name":"String","rows":[["x"]]}]}');$req=@{workbook='config/Excel/String.xlsx';data_file=$ctx.PlansRelative+'/plan.json'};`+
   ({unauthorized:"$req.workbook='config/Excel/Other.xlsx';",escape:"$req.data_file='../outside.json';",stale:"[IO.File]::WriteAllText("+quote(book)+",'external change');",duplicate:"",linked:"$link=Join-Path $ctx.Plans 'link';New-Item -ItemType Junction -Path $link -Target "+quote(root)+"|Out-Null;$req.data_file=$ctx.PlansRelative+'/link/config/Excel/String.xlsx.json';[IO.File]::WriteAllText("+quote(book+'.json')+",'{}');"}[mode])+
   `$requests=@($req);${mode==='duplicate'?'$requests+=@($req);':''}try{Invoke-SyncExcelHandoff -Context $ctx -Requests $requests|Out-Null;throw 'ACCEPTED_UNSAFE_REQUEST'}catch{if($_.Exception.Message -eq 'ACCEPTED_UNSAFE_REQUEST'){throw};Write-Output $_.Exception.Message}`;
  const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',timeout:20000});
  assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,({unauthorized:/not originally authorized/,escape:/relative JSON/,stale:/source changed/,duplicate:/cover every/,linked:/linked files/})[mode]);assert.equal(fs.readFileSync(book,'utf8'),mode==='stale'?'external change':'original bytes');
  if(mode==='linked')fs.rmdirSync(path.join(root,'logs','sync-excel-plans','attempt','link'));
 }finally{const link=path.join(root,'logs','sync-excel-plans','attempt','link');if(fs.existsSync(link))fs.rmdirSync(link);assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert(path.basename(root).startsWith('sync excel guard '));fs.rmSync(root,{recursive:true,force:true});}
});
test('Excel source lock blocks the snapshot without overwriting the source',{skip:!windows},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync excel guard '));
 try{
  fs.mkdirSync(path.join(root,'config','Excel'),{recursive:true});const book=path.join(root,'config','Excel','String.xlsx');fs.writeFileSync(book,'unsaved source');
  const script=`$ErrorActionPreference='Stop';. ${quote(path.join(source,'tools','sync-excel-handoff.ps1'))};$lock=[IO.File]::Open(${quote(book)},'Open','Read','Read');try{try{New-SyncExcelContext -Root ${quote(root)} -RunDirectory ${quote(path.join(root,'private','attempt'))} -Conflicts @('config/Excel/String.xlsx') -Updater ${quote(path.join(source,'tools','excel-update-sheets.ps1'))}|Out-Null;throw 'UNSAFE'}catch{if($_.Exception.Message -eq 'UNSAFE'){throw};Write-Output 'locked snapshot blocked'}}finally{$lock.Dispose()}`;
  const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/locked snapshot blocked/);assert.equal(fs.readFileSync(book,'utf8'),'unsaved source');
 }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert(path.basename(root).startsWith('sync excel guard '));fs.rmSync(root,{recursive:true,force:true});}
});
