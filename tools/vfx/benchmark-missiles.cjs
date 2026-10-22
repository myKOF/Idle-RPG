'use strict';
// Isolated real Core/Adapter/Pixi/WebGL benchmark; no simulation saves or null backend.
// VFX_PLAYWRIGHT_MODULE may point to the bundled Playwright package on this host.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.VFX_PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '../..');
const { loadEliteEnv, makeElite } = require('../../tests/helpers/elite-env.cjs');
const Cost = require('./preset-cost.cjs');
const ids = ['white', 'blue', 'purple', 'yellow'].map(c => 'en-missile-' + c);
function capture(id) {
  const c = loadEliteEnv(), m = makeElite(c, ['e_missile'], { x: 100, y: 0, hp: 1e12 });
  c.FIELD.player.hp = c.FIELD.player.maxHp = 1e12;
  Object.keys(m._el.cd).forEach(k => { m._el.cd[k] = 1e9; }); m._el.repoAt = Infinity;
  const events = [];
  c.playCombatVfx = spec => { if (spec.fxKind === 'projectile') events.push({ t: c.GT - 100, spec: JSON.parse(JSON.stringify(spec)) }); };
  c.eliteCastMissiles(m, { ...c.ELITE_AFFIXES.e_missile, n: [1, 1], presets: [id] });
  for (let i = 1; i <= 310; i++) { c.GT = 100 + i * .01; c.eliteTick(.01); }
  if (events.length !== 2) throw new Error('Unexpected missile flight events');
  return events;
}
const eventMap = Object.fromEntries(ids.map(id => [id, capture(id)]));
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>
<script src="/js/vendor/pixi.min.js"></script><script src="/js/vfx-core.js"></script>
<script src="/js/vfx-pixi-backend.js"></script><script src="/js/vfx-runtime.js"></script><script>
const ids=${JSON.stringify(ids)}, events=${JSON.stringify(eventMap)};
function summary(a){a.sort((x,y)=>x-y);const q=p=>a[Math.min(a.length-1,Math.floor(a.length*p))];return {p50:q(.5),p95:q(.95),p99:q(.99),max:a.at(-1),samples:a.length};}
window.runBenchmark=async()=>{
 const index=await(await fetch('/vfx/shipped-assets.json')).json();
 const resolver=VFXCore.createIndexResolver(index,'/images/vfx/assets');
 const presets=await Promise.all(ids.map(id=>fetch('/vfx/presets/'+id+'.json').then(r=>r.json())));
 await Promise.all([...new Set(presets.flatMap(p=>p.layers.map(l=>resolver.resolve(l.assetId))))].map(u=>PIXI.Assets.load(u)));
 const app=new PIXI.Application();await app.init({width:815,height:570,preference:'webgl',antialias:true,background:0x131e29,preserveDrawingBuffer:true});app.stop();document.body.append(app.canvas);
 const gl=app.renderer.gl||app.canvas.getContext('webgl2')||app.canvas.getContext('webgl');
 if(!gl||typeof gl.finish!=='function')throw Error('Synchronous WebGL completion unavailable');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');
 const environment={renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),userAgent:navigator.userAgent,devicePixelRatio:devicePixelRatio,canvas:[815,570]};
 const cases=[...ids.map(id=>({name:id,ids:[id]})),{name:'four-colors-together',ids}];
 const result=[],cleanups=[];
 for(const item of cases){const cpu=[],total=[];let peakParticles=0,peakEffects=0,missing=0;
  for(let round=0;round<3;round++){
   const root=new PIXI.Container();root.position.set(407.5,285);root.scale.set(.8);app.stage.addChild(root);
   const rt=VFXRuntime.create({core:VFXCore,resolver,fxBackend:VFXPixiBackend.createBackend({PIXI,container:root}),groundScale:.5,ctx:{posOf:()=>null,footOf:()=>null,playerPos:()=>({x:0,y:0})}});rt.registerPresets(presets);
   const all=item.ids.flatMap(id=>events[id]).sort((a,b)=>a.t-b.t);let t=0,next=0;
   for(let i=0;i<720;i++){
    const start=performance.now();
    if(t>=3.5){t=0;next=0;rt.clear();}
    while(next<all.length&&all[next].t<=t+1e-7)rt.tryPlay(all[next++].spec);
    rt.update(1/60);t+=1/60;app.render();const submitted=performance.now();gl.finish();const done=performance.now();
    const s=rt.stats();peakParticles=Math.max(peakParticles,s.fx.activeParticles);peakEffects=Math.max(peakEffects,s.fx.activeEffects);missing+=s.missing;
    if(i>=120){cpu.push(submitted-start);total.push(done-start);}
    if(i%60===59)await new Promise(r=>setTimeout(r,0));
   }
   // Keep texture owners alive through all cases; destroying a backend unloads shared Assets asynchronously.
   root.visible=false;cleanups.push(()=>{root.removeFromParent();rt.destroy();root.destroy({children:true});});gl.finish();
  }
  result.push({name:item.name,instances:item.ids.length,cpuAndSubmitMs:summary(cpu),includingGpuCompletionMs:summary(total),peakParticles,peakEffects,missing});
 }
 cleanups.forEach(fn=>fn());app.destroy(true,{children:true});return {method:'Native flight events, Core/Adapter/Pixi/WebGL; each frame includes gl.finish GPU completion; warmup 120 + measured 600 frames, 3 rounds per case; no background battle or other skills',environment,cases:result};
};window.ready=true;</script>`;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  if (url === '/favicon.ico') { res.writeHead(204).end(); return; }
  const file = path.resolve(ROOT, '.' + url);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  });
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless:true, channel:process.env.VFX_BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport:{ width:815, height:570 }, deviceScaleFactor:1 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.ready);
    const report = await page.evaluate(() => window.runBenchmark());
    const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'vfx/asset-index.json')));
    report.editorEstimates = ids.map(id => ({ id, ...Cost.estimate(JSON.parse(fs.readFileSync(path.join(ROOT, 'vfx/presets', id+'.json'))), { assetSize:Cost.sizeLookup(index.assets) }) }));
    report.errors = errors; report.observedBudgetMs = 15;
    report.withinObservedBudget = report.cases.every(c => !c.missing && c.includingGpuCompletionMs.max <= report.observedBudgetMs);
    console.log(JSON.stringify(report, null, 2));
    if (errors.length || !report.withinObservedBudget) process.exitCode = 1;
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
