'use strict';
// 執行前啟動 editor-server；NODE_PATH 提供 Playwright。只讀驗證及效能比較。
const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch({headless:true,channel:'msedge'}),p=await b.newPage({viewport:{width:1000,height:650}});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto((process.env.VFX_TEST_URL||'http://127.0.0.1:18765')+'/tools/vfx/editor/index.html');await p.waitForTimeout(700);
 const result=await p.evaluate(async()=>{
  document.body.innerHTML='';const app=new PIXI.Application();await app.init({width:1000,height:650,background:0x152030,preference:'webgl',autoStart:false});document.body.appendChild(app.canvas);
  const ix=await(await fetch('/vfx/asset-index.json')).json();
  const by=Object.fromEntries(ix.assets.map(a=>[a.assetId,'/asset-library/'+ix.libraryId+'/'+a.relativePath]));
  const backend=VFXPixiBackend.createBackend({PIXI,container:app.stage});
  const rt=VFXCore.createRuntime({backend,resolver:{has:id=>!!by[id],resolve:id=>by[id]},budget:{maxActiveEffects:256,maxParticles:5000,perEffectParticleLimit:500}});
  const ids=['bolt-thunderstrike-bluewhite','bolt-sky-purple','bolt-chain-bluewhite','beam-gale-thunder-flash'];
  const presets=await Promise.all(ids.map(id=>fetch('/vfx/presets/'+id+'.json').then(r=>r.json())));
  await Promise.all([...new Set(presets.flatMap(v=>v.layers.map(l=>by[l.assetId]).filter(Boolean)))].map(url=>PIXI.Assets.load(url)));
  presets.forEach(v=>rt.registerPreset(v));
  for(let i=0;i<3;i++)rt.play(ids[0],{position:{x:150+i*280,y:420},seed:88+i*913});
  rt.update(.12);await new Promise(r=>setTimeout(r,40));rt.update(0);app.renderer.render(app.stage);
  window.warpApp=app;
  const meshes=app.stage.children.filter(n=>n.__warp);
  if(meshes.length!==9)throw Error('expected 9 meshes, got '+meshes.length);
  const snapshots=meshes.map(n=>Array.from(n.geometry.getBuffer('aPosition').data));
  if(snapshots.some(a=>a.some(v=>!Number.isFinite(v))))throw Error('invalid mesh');
  let updates=0;const buffer=meshes[0].geometry.getBuffer('aPosition'),update=buffer.update.bind(buffer);buffer.update=(...args)=>{updates++;return update(...args);};
  rt.update(0);
  buffer.update=update;if(updates)throw Error('unchanged mesh rebuilt');
  const report={meshes:meshes.length,vertices:meshes[0].geometry.getBuffer('aPosition').data.length/2,stableGeometry:updates===0,errors:backend.takeErrors()};
  window.warpRT=rt;window.warpPresets=presets;window.warpBackend=backend;
  return report;
 });
 if(process.env.VFX_SCREENSHOT)await p.screenshot({path:process.env.VFX_SCREENSHOT});
 const allIds=require('fs').readdirSync(require('path').join(__dirname,'../../vfx/presets')).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'../../vfx/presets',f)))).filter(v=>v.deformation).map(v=>v.id);
 const coverage=await p.evaluate(async ids=>{
   const container=new PIXI.Container();warpApp.stage.addChild(container);
   const backend=VFXPixiBackend.createBackend({PIXI,container});
   const ix=await(await fetch('/vfx/asset-index.json')).json(),by=Object.fromEntries(ix.assets.map(a=>[a.assetId,'/asset-library/'+ix.libraryId+'/'+a.relativePath]));
   const presets=await Promise.all(ids.map(id=>fetch('/vfx/presets/'+id+'.json').then(r=>r.json())));
   const urls=[...new Set(presets.flatMap(v=>v.layers.map(l=>by[l.assetId]).filter(Boolean)))];
   await Promise.all(urls.map(url=>PIXI.Assets.load(url)));
   const rt=VFXCore.createRuntime({backend,resolver:{has:id=>!!by[id],resolve:id=>by[id]},budget:{maxActiveEffects:128,maxParticles:5000,perEffectParticleLimit:500}});
   presets.forEach(v=>{rt.registerPreset(v);rt.play(v.id,{position:{x:400,y:450},rotation:.4,scaleX:1.3,scaleY:.8});});
   rt.update(.03);await new Promise(r=>setTimeout(r,30));rt.update(.03);warpApp.renderer.render(warpApp.stage);
   let meshes=0;
   container.children.forEach(n=>{if(n.__warp){meshes++;if(Array.from(n.__warp.positions).some(v=>!Number.isFinite(v)))throw Error('nonfinite vertices');}});
   const failures=backend.takeErrors();if(failures.length)throw Error(JSON.stringify(failures));
   rt.destroy();container.destroy({children:true});return {presets:presets.length,meshes};
 },allIds);
 const performance=await p.evaluate(async()=>{
   window.warpRT.destroy();
   async function measure(enabled){
     const container=new PIXI.Container();warpApp.stage.addChild(container);
     const backend=VFXPixiBackend.createBackend({PIXI,container});
     const ix=await(await fetch('/vfx/asset-index.json')).json(),by=Object.fromEntries(ix.assets.map(a=>[a.assetId,'/asset-library/'+ix.libraryId+'/'+a.relativePath]));
     const rt=VFXCore.createRuntime({backend,resolver:{has:id=>!!by[id],resolve:id=>by[id]},budget:{maxActiveEffects:128,maxParticles:5000,perEffectParticleLimit:500}});
     const preset=structuredClone(warpPresets[0]);if(!enabled)delete preset.deformation;rt.registerPreset(preset);
     for(let i=0;i<40;i++)rt.play(preset.id,{position:{x:20+(i%10)*96,y:180+Math.floor(i/10)*110},scale:.4,seed:i+12});
     rt.update(.08);await new Promise(r=>setTimeout(r,80));rt.update(0);
     const times=[],render=[];
     for(let f=0;f<90;f++){
       let t=performance.now();rt.update(.0005);times.push(performance.now()-t);
       t=performance.now();warpApp.renderer.render(warpApp.stage);render.push(performance.now()-t);
     }
     const meshes=container.children.filter(n=>n.__warp).length;
     rt.destroy();container.destroy({children:true});
     const avg=a=>a.reduce((x,y)=>x+y)/a.length,p95=a=>a.sort((x,y)=>x-y)[Math.floor(a.length*.95)];
     return {effects:40,meshes,cpuAvg:avg(times),cpuP95:p95(times),renderSubmitAvg:avg(render),renderSubmitP95:p95(render)};
   }
   return {baseline:await measure(false),deformed:await measure(true)};
 });
 console.log(JSON.stringify({result,coverage,performance,errors}));await b.close();if(errors.length)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
