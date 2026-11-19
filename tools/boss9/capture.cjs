'use strict';
// Render the actual GLB and companion particle emitter; the watchdog owns browser cleanup.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {launchHeadless}=require('../lib/headless-browser.cjs');
const {resolveLibraryRoot}=require('../vfx/vfx-library-root.cjs');
const output=path.resolve(process.argv[2]||'tmp/boss9-review');
const library=path.join(resolveLibraryRoot({libraryId:'effects-materials'}).root,'codex-authored/boss9-dragon-v2-20261120');
const root=path.resolve(__dirname,'../..');
const serveOnly=process.argv.includes('--serve'),quick=process.argv.includes('--quick');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.glb':'model/gltf-binary'};
const server=http.createServer((req,res)=>{
 const url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 let base,file;
 if(url.startsWith('/three/')){base=path.join(root,'js/vendor/three');file=path.resolve(base,url.slice(7));}
 else if(url.startsWith('/assets/')){base=path.join(library,'exports');file=path.resolve(base,url.slice(8));}
 else {base=__dirname;file=path.resolve(base,url==='/'?'preview.html':url.slice(1));}
 if(!file.startsWith(base+path.sep)){res.writeHead(403);return res.end();}
 fs.readFile(file,(err,bytes)=>{if(err){res.writeHead(404);res.end('Not found');return;}
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);});
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 fs.mkdirSync(output,{recursive:true});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 console.log('BOSS9_VIEWER',url);
 if(serveOnly){for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit()));return;}
 let browser,ws;
 const errors=[],warnings=[];
 try{
  browser=await launchHeadless({prefix:'idle-boss9-',args:['--window-size=960,680','--hide-scrollbars'],maxLifetimeMs:15*60*1000});
  ws=new WebSocket((await browser.waitForPage()).webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let seq=0;const pending=new Map();
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);
   if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p.timeout);p.resolve(message);}
   else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
   else if(message.method==='Log.entryAdded'){const e=message.params.entry;if(e.level==='error')errors.push(e.text);else if(e.level==='warning')warnings.push(e.text);}
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},30000);pending.set(id,{resolve,reject,timeout});ws.send(JSON.stringify({id,method,params}));});
  const ev=async expression=>{const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
   if(response.error||response.result.exceptionDetails)throw Error(JSON.stringify(response.error||response.result.exceptionDetails));return response.result.result.value;};
  await send('Runtime.enable');await send('Page.enable');await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:600,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:url+'/?capture=1'});
  let ready=false;
  for(let i=0;i<100;i++){if(errors.length)throw Error(errors.join('\n'));if(await ev('!!window.preview?.ready')){ready=true;break;}await sleep(200);}
  if(!ready)throw Error('GLB preview did not become ready');
  const report={clips:await ev('window.preview.clips'),errors,warnings,frames:{},particleSamples:[],motionSamples:{}};
  for(const name of ['Walk','Attack1','Attack2','Attack3','Die']){
   await ev(`window.preview.select(${JSON.stringify(name)})`);
   const duration=report.clips[name],count=Math.round(duration*30);
   const indices=quick?[0,Math.round(count*.28),Math.round(count*.48),Math.round(count*.7),count]:Array.from({length:count+1},(_,i)=>i);
   const dir=path.join(output,name);fs.mkdirSync(dir,{recursive:true});
   report.motionSamples[name]=[];
   for(const i of indices){
    const motion=await ev(`(()=>{const p=window.preview;p.frame(${i});const nodes={};for(const n of ['Bone_000','Head','Bone_043','Bone_024']){const m=p.model.getObjectByName(n).matrixWorld.elements;nodes[n]={position:[m[12],m[13],m[14]]};if(n==='Head'){const l=Math.hypot(m[4],m[5],m[6]);nodes[n].direction=[m[4]/l,m[5]/l,m[6]/l];}}return {time:${i/30},nodes};})()`);
    report.motionSamples[name].push(motion);
    const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(dir,String(i).padStart(4,'0')+'.png'),Buffer.from(result.result.data,'base64'));
    if(name==='Attack3')report.particleSamples.push(await ev(`({time:${i/30},...window.preview.fire.stats})`));
   }
   report.frames[name]=indices.length;console.log('CAPTURED',name,indices.length);
  }
  if(!quick){
   const walk=report.motionSamples.Walk;
   assert.ok(walk.every(s=>Math.abs(Math.asin(-s.nodes.Head.direction[1])*180/Math.PI-30)<.01),'Exported head pitch');
   assert.ok(walk.every(s=>Math.abs(s.nodes.Head.direction[0])<.001),'Exported head forward');
   const bite=report.motionSamples.Attack1,z0=bite[0].nodes.Bone_000.position[2];
   report.maximumBiteForwardMeters=Math.max(...bite.map(s=>s.nodes.Bone_000.position[2]-z0));
   assert.ok(report.maximumBiteForwardMeters>4.97&&report.maximumBiteForwardMeters<5.03,'Exported bite displacement');
  }
  await ev(`(()=>{const p=window.preview;p.select('Walk');p.render(0);const e=p.model.getObjectByName('Head').matrixWorld.elements;p.camera.position.set(e[12],e[13]+.5,e[14]+4.5);p.camera.lookAt(e[12],e[13]+.1,e[14]);p.render(0);})()`);
  const front=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(output,'head-forward.png'),Buffer.from(front.result.data,'base64'));
  report.nozzle=await ev('(()=>{const p=window.preview.mouthAt(1.4);return {position:p.position.toArray(),direction:p.direction.toArray()};})()');
  fs.writeFileSync(path.join(output,'capture.json'),JSON.stringify(report,null,2)+'\n');
  if(errors.length)throw Error(errors.join('\n'));
  console.log('BOSS9_CAPTURE_PASS',JSON.stringify({clips:report.clips,frames:report.frames,errors,warnings,nozzle:report.nozzle}));
 }finally{if(ws)ws.close();if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
