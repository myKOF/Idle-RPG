'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const crypto=require('node:crypto');
const {launchHeadless}=require('../lib/headless-browser.cjs');
const {resolveLibraryRoot}=require('../vfx/vfx-library-root.cjs');
const out=path.resolve(process.argv[2]||'tmp/boss9-flight');
const packageArg=process.argv.indexOf('--package'),packageId=packageArg<0?'boss9-flight-reference-20261120':process.argv[packageArg+1];
if(!/^boss9-[a-z0-9-]+$/.test(packageId||''))throw Error('Invalid package id');
const pack=path.join(resolveLibraryRoot({libraryId:'effects-materials'}).root,'codex-authored',packageId);
const repo=path.resolve(__dirname,'../..'),quick=process.argv.includes('--quick'),serve=process.argv.includes('--serve');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.glb':'model/gltf-binary'};
const server=http.createServer((req,res)=>{const url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let base,rel;
 if(url.startsWith('/three/')){base=path.join(repo,'js/vendor/three');rel=url.slice(7);}
 else if(url.startsWith('/assets/')){base=path.join(pack,'exports');rel=url.slice(8);}
 else {base=__dirname;rel=url==='/'?'flight_preview.html':url.slice(1);}
 const file=path.resolve(base,rel);if(!file.startsWith(base+path.sep)){res.writeHead(403);return res.end();}
 fs.readFile(file,(err,b)=>{if(err){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(b);});});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;console.log('FLIGHT_VIEWER',url);
 if(serve){for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>process.exit()));return;}
 let browser,ws;const errors=[],warnings=[];
 try{browser=await launchHeadless({prefix:'idle-flight-',args:['--window-size=640,460','--hide-scrollbars'],maxLifetimeMs:10*60*1000});
 ws=new WebSocket((await browser.waitForPage()).webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timeout);pending.delete(m.id);p.resolve(m);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);else if(m.method==='Log.entryAdded'){if(m.params.entry.level==='error')errors.push(m.params.entry.text);else if(m.params.entry.level==='warning')warnings.push(m.params.entry.text);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timeout=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timeout});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.error||r.result.exceptionDetails)throw Error(JSON.stringify(r.error||r.result.exceptionDetails));return r.result.result.value;};
 const full=process.argv.includes('--full');
 const azIndex=process.argv.indexOf('--azimuth'),azimuth=azIndex<0?null:Number(process.argv[azIndex+1]);if(azimuth!==null&&(!Number.isFinite(azimuth)||azimuth<0||azimuth>360))throw Error('Invalid azimuth');
 await send('Runtime.enable');await send('Page.enable');await send('Log.enable');await send('Emulation.setDeviceMetricsOverride',{width:full?800:640,height:full?600:360,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:url+'/?capture=1'+(full?'&full=1':'')+(azimuth===null?'':'&azimuth='+azimuth)});
 let ready=false;for(let i=0;i<100;i++){if(errors.length)throw Error(errors.join('\n'));if(await ev('!!window.flight?.ready')){ready=true;break;}await sleep(100);}if(!ready)throw Error('Flight not ready');
 const frames=quick?[0,9,15,24,30,42,54,59]:Array.from({length:60},(_,i)=>i);const report={period:await ev('window.flight.period'),glbSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(pack,'exports/boss9_flight.glb'))).digest('hex'),full,azimuth,frames:[],errors,warnings};
 for(const i of frames){const state=await ev(`(()=>{flight.render(${i/30});return {nodes:flight.snapshot(),bounds:flight.bounds()};})()`);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,String(i).padStart(4,'0')+'.png'),Buffer.from(shot.result.data,'base64'));report.frames.push({frame:i,time:i/30,...state});}
 fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(report,null,2)+'\n');if(errors.length||warnings.length)throw Error(JSON.stringify({errors,warnings}));console.log('FLIGHT_CAPTURE_PASS',report.frames.length,'frames, period',report.period);
 }finally{if(ws)ws.close();if(browser)await browser.close();await new Promise(r=>server.close(r));}}
main().catch(e=>{console.error(e);process.exitCode=1;});
