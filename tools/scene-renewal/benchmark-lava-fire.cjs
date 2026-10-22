'use strict';
// LAVA_PLAYWRIGHT_MODULE可指定本機Playwright；預設使用獨立Edge硬體WebGL。
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.LAVA_PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'../..');
const paced=process.env.LAVA_BENCHMARK_PACED==='1';
const html=`<!doctype html><meta charset="utf-8"><div id="host" style="width:920px;height:760px"></div>
<script>window.__lavaBenchmarkCapture=h=>window.lavaHook=h;</script>
<script src="/js/vendor/pixi.min.js"></script><script src="/js/decor-sculpt.js"></script><script src="/js/decor-nature.js"></script><script src="/js/battle-terrain.js"></script><script src="/js/battle-decor.js"></script><script src="/js/battle-arena.js"></script><script src="/js/battle-renderer.js"></script>
<script>
window.runBenchmark=async function(){
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 if(!await BattleRenderer.init(document.querySelector('#host')))throw Error('Renderer init failed');
 BattleRenderer.syncBattle({gt:1,stage:{zone:'lava_mountain',current:1},field:{playerPos:{x:0,y:0},player:{hp:100,maxHp:100},monsters:[]}});
 for(let i=0;i<2400;i++){const s=BattleRenderer.status();if(s.decor.ready&&s.decor.scene==='lava_mountain'&&!s.scene.phase)break;await delay(25);if(i===2399)throw Error('Scene timeout');}
 BattleRenderer._app().stop();const h=window.lavaHook,all=h.state.localActive.filter(g=>g.source.kind==='fire');if(all.length!==6)throw Error('Expected six real fire groups');
 const app=new PIXI.Application();await app.init({width:920,height:760,preference:'webgl',antialias:false,autoStart:false,resolution:1,backgroundAlpha:0});document.body.append(app.canvas);
 const light=new PIXI.Container(),props=new PIXI.Container();light.position.set(460,380);light.scale.y=.5;props.position.set(460,380);app.stage.addChild(light,props);props.sortableChildren=true;
 const gl=app.renderer.gl,ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)throw Error('Hardware GPU timer unavailable');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');const environment={renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),userAgent:navigator.userAgent,crossOriginIsolated,canvas:[920,760],devicePixelRatio};
 const view={camX:0,camY:0,W:920,H:760},summary=a=>{const s=Array.from(a).sort((x,y)=>x-y);return{samples:s.length,median:s[Math.floor(s.length*.5)],p95:s[Math.floor(s.length*.95)],p99:s[Math.floor(s.length*.99)],max:s[s.length-1]};};
 const largest=all.slice().sort((a,b)=>b.source.scale-a.source.scale)[0];const cases=[{name:'empty',groups:[]},{name:'one-largest-fire',groups:[largest]},{name:'six-fires',groups:all}],results=[];
 for(const item of cases){
  for(const group of all)for(const s of group.sprites)s.removeFromParent();
  h.state.localGroups=new Map(item.groups.map((g,i)=>[String(i),g]));h.state.localActive=item.groups;h.state.localSelection=h.state.lastChunkKey+':0:0';
  item.groups.forEach((g,i)=>{g.source.x=item.groups.length===1?0:(i%3-1)*270;g.source.y=item.groups.length===1?0:(Math.floor(i/3)-.5)*300;g.source.anchor.x=g.source.x;g.source.anchor.y=g.source.y*.5;for(const s of g.sprites)(s._natureFireHalo?light:props).addChild(s);});
  const update=new Float64Array(1800),cpu=new Float64Array(1800),gpu=new Float64Array(1800),combined=new Float64Array(1800);let cursor=0;
  for(let round=0;round<3;round++){
   for(let i=0;i<240;i++){h.state.time+=1/60;h.update(view);app.render();}gl.finish();
   const queries=Array.from({length:600},()=>gl.createQuery());
   for(let i=0;i<600;i++){
    if(${paced})await new Promise(requestAnimationFrame);
    gl.beginQuery(ext.TIME_ELAPSED_EXT,queries[i]);const begin=performance.now();h.state.time+=1/60;h.update(view);update[cursor+i]=performance.now()-begin;app.render();cpu[cursor+i]=performance.now()-begin;gl.endQuery(ext.TIME_ELAPSED_EXT);gl.flush();
    if(i%60===59)await delay(0);
   }
   gl.finish();for(let wait=0;!gl.getQueryParameter(queries[599],gl.QUERY_RESULT_AVAILABLE);wait++){if(wait>1000)throw Error('GPU query timeout');await delay(5);}if(gl.getParameter(ext.GPU_DISJOINT_EXT))throw Error('GPU disjoint: timing invalid');
   for(let i=0;i<600;i++){if(!gl.getQueryParameter(queries[i],gl.QUERY_RESULT_AVAILABLE))throw Error('GPU timing not ready');gpu[cursor+i]=gl.getQueryParameter(queries[i],gl.QUERY_RESULT)/1e6;combined[cursor+i]=cpu[cursor+i]+gpu[cursor+i];gl.deleteQuery(queries[i]);}cursor+=600;
  }
  const n=item.groups.length;results.push({name:item.name,instances:n,sprites:n*3,cpuEffectUpdateMs:summary(update),effectUpdatePlusGpuMs:n?summary(update.map((v,i)=>(v+gpu[i])/n)):null,cpuUpdateAndSubmitMs:summary(cpu),gpuElapsedMs:summary(gpu),conservativeCpuPlusGpuMs:summary(combined),perFireCpuPlusGpuMs:n?summary(combined.map(v=>v/n)):null,overBudgetFrames:n?Array.from(combined).filter(v=>v/n>.15).length:null});
 }
 const hardware=!/SwiftShader|llvmpipe|software/i.test(environment.renderer),withinBudget=hardware&&results.filter(c=>c.instances).every(c=>c.perFireCpuPlusGpuMs.max<=.15);
 app.destroy(true,{children:true,texture:false,textureSource:false});return{paced:${paced},method:'Actual production local update function, original Renderer billboard projection, three real sprites per source; independent Pixi/WebGL draw. 240 warmup + 600 samples x 3 rounds. GPU EXT timer measures execution, CPU includes update and draw submission; sum is conservative (possible overlap). No outlier removal; empty baseline is reported, not subtracted. Scene generation/loading excluded from per-frame budget.',environment,hardware,budgetMs:.15,withinBudget,results};
};window.ready=true;</script>`;
const source=fs.readFileSync(path.join(ROOT,'js/battle-decor.js'),'utf8');
const needle='    return { setScene: setScene';if(source.split(needle).length!==2)throw Error('Benchmark capture anchor changed');
const instrumented=source.replace(needle,"    if(typeof window!=='undefined'&&window.__lavaBenchmarkCapture)window.__lavaBenchmarkCapture({state:D,update:updateLocalEffects});\n"+needle);
const server=http.createServer((req,res)=>{
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
 const url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}if(url==='/favicon.ico'){res.writeHead(204).end();return;}
 if(url==='/js/battle-decor.js'){res.setHeader('Content-Type','text/javascript');res.end(instrumented);return;}
 const file=path.resolve(ROOT,'.'+url);if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(error,body)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(body);});
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{browser=await chromium.launch({headless:true,channel:process.env.LAVA_BROWSER_CHANNEL||'msedge'});const page=await browser.newPage({viewport:{width:1000,height:900},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);const report=await page.evaluate(()=>window.runBenchmark());report.errors=errors;if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(errors.length||!report.withinBudget)process.exitCode=1;}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
