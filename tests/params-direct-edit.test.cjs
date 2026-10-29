'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const project=path.resolve(__dirname,'..');
const retired=path.join(project,'tools/param-patches.cjs');
function clean(root){
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
  assert.ok(path.basename(root).startsWith('params-direct-edit-'));
  fs.rmSync(root,{recursive:true,force:true});
}

for(const command of ['--stage','--merge'])test('retired '+command+' refuses without consuming or changing a request',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'params-direct-edit-'));
  try{
    const request=path.join(root,'request.json'),bytes=Buffer.from('{"old_request":"preserve"}\n');
    fs.writeFileSync(request,bytes);
    const r=spawnSync(process.execPath,[retired,command,command==='--stage'?request:root],{encoding:'utf8',timeout:10000});
    assert.equal(r.status,1);assert.match(r.stderr,/停用暫存與集中合併/);
    assert.deepEqual(fs.readFileSync(request),bytes);assert.deepEqual(fs.readdirSync(root),['request.json']);
  }finally{clean(root);}
});

for(const failure of [false,true])test('real BAT '+(failure?'stops on table export failure':'exports saved XLSX without invoking Excel or legacy merge'),{skip:process.platform!=='win32'},()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'params-direct-edit-'));
  try{
    for(const dir of ['tools/string-table','config/Excel','config/CSV','config/param-patches'])fs.mkdirSync(path.join(root,dir),{recursive:true});
    fs.copyFileSync(path.join(project,'套用參數.bat'),path.join(root,'套用參數.bat'));
    fs.copyFileSync(path.join(project,'tools/xlsx_to_csv.cjs'),path.join(root,'tools/xlsx_to_csv.cjs'));
    fs.copyFileSync(path.join(project,'config/Excel/game_parameters.xlsx'),path.join(root,'config/Excel/game_parameters.xlsx'));
    const pending=path.join(root,'config/param-patches/old.json');fs.writeFileSync(pending,'old retired request: do not replay');
    fs.writeFileSync(path.join(root,'tools/param-patches.cjs'),"require('node:fs').writeFileSync('legacy-called','unexpected');process.exit(99);\n");
    fs.writeFileSync(path.join(root,'tools/config_tables.cjs'),"const fs=require('node:fs');fs.appendFileSync('flow.log',process.argv[2]+'\\n');if(process.argv[2]==='--sync'&&process.env.DIRECT_TEST_FAIL==='1')process.exit(7);\n");
    fs.writeFileSync(path.join(root,'tools/string-table/apply_strings.cjs'),"require('node:fs').appendFileSync('flow.log','strings\\n');\n");
    fs.writeFileSync(path.join(root,'tools/apply_params.cjs'),"const fs=require('node:fs');if(!fs.readFileSync('config/CSV/game_parameters.csv','utf8').includes('施放硬直'))process.exit(9);fs.appendFileSync('flow.log','params\\n');\n");
    const r=spawnSync('cmd.exe',['/d','/c','call','套用參數.bat'],{cwd:root,input:'\r\n',encoding:'utf8',timeout:20000,windowsHide:true,env:{...process.env,DIRECT_TEST_FAIL:failure?'1':'0'}});
    assert.equal(r.error,undefined);assert.equal(r.signal,null);
    assert.equal(fs.existsSync(path.join(root,'legacy-called')),false);
    assert.equal(fs.readFileSync(pending,'utf8'),'old retired request: do not replay');
    assert.equal(fs.existsSync(path.join(root,'config/param-patches/archive')),false);
    const steps=fs.readFileSync(path.join(root,'flow.log'),'utf8');
    if(failure){assert.equal(steps,'--sync\n');assert.equal(fs.existsSync(path.join(root,'config/CSV/game_parameters.csv')),false);}
    else{assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(steps,'--sync\n--apply\nstrings\nparams\n');assert.doesNotMatch(r.stdout,/\[0\/3\]/);}
  }finally{clean(root);}
});
