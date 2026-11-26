'use strict';
// Actual page, shared Hero3D/Npc3D renderer, then a live Worker tower fight.
// Uses a disposable browser profile and the project's watchdog/cleanup entry.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {launchHeadless}=require('../../lib/headless-browser.cjs');
const {resolveLibraryRoot}=require('../../vfx/vfx-library-root.cjs');
const root=path.resolve(__dirname,'../../..');
const idleCheck=process.argv.includes('--idle-check');
const out=idleCheck?path.join(root,'tmp/boss9-variants-idle-check'):path.join(resolveLibraryRoot({libraryId:'effects-materials'}).root,'codex-authored/boss9-lizard-variants-20261127/qa');
const mime={'.html':'text/html','.js':'text/javascript','.cjs':'text/javascript','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.webp':'image/webp','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.mp4':'video/mp4'};
const server=http.createServer((req,res)=>{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(p==='/'?'/index.html':p));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(e,b)=>{res.writeHead(e?404:200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(e?'missing':b);});});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser,ws;const errors=[],warnings=[];
  try{
    browser=await launchHeadless({prefix:'idle-boss9-variants-',exe:process.env.CHROME_EXE,args:['--window-size=1400,900','--mute-audio','--autoplay-policy=no-user-gesture-required','--hide-scrollbars','--disable-background-timer-throttling','--disable-renderer-backgrounding'],maxLifetimeMs:10*60*1000});
    ws=new WebSocket((await browser.waitForPage()).webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
    let seq=0;const pending=new Map();
    ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timer);pending.delete(m.id);p.resolve(m);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);else if(m.method==='Log.entryAdded'&&m.params.entry.level==='warning')warnings.push(m.params.entry.text);});
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},90000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
    const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.error||r.result.exceptionDetails)throw Error(JSON.stringify(r.error||r.result.exceptionDetails));return r.result.result.value;};
    const wait=async(expression,seconds=45)=>{for(let i=0;i<seconds*5;i++){if(errors.length)throw Error(errors.join('\n'));const r=await ev(expression);if(r)return r;await sleep(200);}throw Error('Timeout: '+expression);};
    const shot=async(name,clip)=>{const r=await send('Page.captureScreenshot',{format:'png',...(clip?{clip:{...clip,scale:1}}:{})});assert.ok(r.result?.data,JSON.stringify(r));fs.writeFileSync(path.join(out,name),Buffer.from(r.result.data,'base64'));};
    await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false});
    const variants=[];
    for(const floor of [9,19,29]){
    await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/index.html?seed=9'});
    await wait('!!(window.Npc3D&&window.Hero3D&&window.BOSS_LIST&&window.PIXI)');
    // This pass validates models and animation, with the disposable game's
    // normal mute setting enabled before combat can schedule synthesized SFX.
    await ev("GameSettings.set('mute',true);true");
    const render=await ev(`(async()=>{
      const b=BOSS_LIST.find(b=>b.id==='tower_boss_${floor}'),body=await Npc3D.create(b.model3d),ctrl=body.npc3d.controller;
      if(!(ctrl.locomotionMetersPerSecond>0))throw Error('Custom foot stride was not measured');
      const copy=document.createElement('canvas');copy.width=copy.height=512;const cx=copy.getContext('2d',{willReadFrequently:true});
      const contact=document.createElement('canvas');contact.width=1536;contact.height=1024;const mosaic=contact.getContext('2d');mosaic.fillStyle='#34434e';mosaic.fillRect(0,0,1536,1024);
      Npc3D.play(body,'idle');body.update(null,1);
      const idle=ctrl.captureState();if(ctrl.clip!=='Walk'||idle.time!==0||!idle.paused)throw Error('Idle must hold Walk first pose');
      cx.drawImage(ctrl.canvas,0,0);const firstIdle=cx.getImageData(0,0,512,512).data;
      const idleBefore={yaw:ctrl.yaw,time:idle.time};
      ctrl.update(0);cx.clearRect(0,0,512,512);cx.drawImage(ctrl.canvas,0,0);const secondIdle=cx.getImageData(0,0,512,512).data;
      ctrl.pose('Walk',0);cx.clearRect(0,0,512,512);cx.drawImage(ctrl.canvas,0,0);const canonicalIdle=cx.getImageData(0,0,512,512).data;
      let idleDiff=0,secondDiff=0;for(let i=3;i<firstIdle.length;i+=4){if(firstIdle[i]!==canonicalIdle[i])idleDiff++;if(secondIdle[i]!==canonicalIdle[i])secondDiff++;}
      const idleAudit={firstAlphaDifferences:idleDiff,secondAlphaDifferences:secondDiff,before:idleBefore};
      if(idleDiff||secondDiff)throw Error('First idle image differs from the held pose: '+JSON.stringify(idleAudit));
      mosaic.drawImage(ctrl.canvas,0,0);mosaic.fillStyle='white';mosaic.font='18px sans-serif';mosaic.fillText('Idle: Walk / 0.00 s',12,25);
      const plan=[...new Set(Object.values(b.model3d.clips))],frames=[];let count=0;
      for(let j=0;j<plan.length;j++)for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(let i=0;i<=8;i++){
        const clip=plan[j],t=ctrl.duration(clip)*i/8;ctrl.yaw=ctrl.yawTarget=yaw;ctrl.pose(clip,t);
        cx.clearRect(0,0,512,512);cx.drawImage(ctrl.canvas,0,0);const pixels=cx.getImageData(0,0,512,512).data;
        let minX=512,minY=512,maxX=-1,maxY=-1,solid=0;for(let y=0;y<512;y++)for(let x=0;x<512;x++)if(pixels[(y*512+x)*4+3]>8){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);solid++;}
        if(solid<500||minX<2||minY<2||maxX>509||maxY>509)throw Error('Empty/clipped '+clip+' '+t+' '+yaw);
        frames.push({clip,t,yaw,bounds:{minX,maxX,minY,maxY},solid});count++;
        if(yaw===0&&i===(clip==='Die'?8:4)){const tile=j+1;mosaic.drawImage(ctrl.canvas,tile%3*512,Math.floor(tile/3)*512);mosaic.fillStyle='white';mosaic.font='18px sans-serif';mosaic.fillText(clip+' / '+t.toFixed(2)+' s',tile%3*512+12,Math.floor(tile/3)*512+25);}
      }
      const attacks=[];body.onComplete=null;
      for(let k=0;k<3;k++){
        Npc3D.play(body,'attack',3,.85/3);let completed=0;body.onComplete=()=>completed++;
        for(let i=0;i<16;i++)body.update(null,1/60);
        if(completed)throw Error('Attack completed too early');body.update(null,1/60+1e-6);
        if(completed!==1)throw Error('Attack did not finish at ACT boundary: '+JSON.stringify({clip:ctrl.clip,time:ctrl.captureState().time,speed:ctrl.speed}));attacks.push({clip:ctrl.clip,speed:ctrl.speed,seconds:17/60+1e-6});
      }
      Npc3D.play(body,'die');body.onComplete=null;for(let i=0;i<300;i++)body.update(null,1/60);
      const held=ctrl.captureState();if(Math.abs(held.time-4)>1e-6||!held.paused||ctrl.speed!==1)throw Error('Death not clamped at four seconds');
      const result={frames,count,attacks,idle:{clip:idle.cfg.clip,time:idle.time,paused:idle.paused},idleAudit,death:{time:held.time,paused:held.paused,speed:ctrl.speed},locomotionMetersPerSecond:ctrl.locomotionMetersPerSecond,contact:contact.toDataURL('image/png')};
      Npc3D.dispose(body);body.destroy();return result;
    })()`);
    fs.writeFileSync(path.join(out,(idleCheck?'idle-check-':'runtime-contact-')+floor+'.png'),Buffer.from(render.contact.split(',')[1],'base64'));delete render.contact;
    console.log('BOSS9_RENDER_PASS',render.count,'poses; stride',render.locomotionMetersPerSecond);
    console.log('BOSS9_IDLE_AUDIT',floor,JSON.stringify(render.idleAudit));
    if(idleCheck){variants.push({floor,render});continue;}
    // The project's local seeded mode starts a disposable new game and uses
    // fixed simulation steps. Disable auto-advance to observe the whole corpse.
    await wait('window.WorkerBridge&&WorkerBridge.status().booted&&WorkerBridge.status().ticks>0',60);
    const commands=[];
    const gm=async line=>{const r=await ev(`WorkerBridge.send('gm.exec',{line:${JSON.stringify(line)}})`);assert.notEqual(r.ok,false,JSON.stringify(r));assert.notEqual(r.result?.ok,false,JSON.stringify(r));commands.push({line,result:r});};
    for(const line of ['gold 100000000000','level 300','god 1','damage 0','tower_jump '+floor])await gm(line);
    await ev("WorkerBridge.send('tower.setAutoAdvance',{on:false})");
    await ev("document.querySelector('button[data-tab=\"tower\"]').click();true");
    await wait(`!!document.querySelector('[data-tower-pick="${floor}"]')`);
    await ev(`document.querySelector('[data-tower-pick="${floor}"]').click();document.querySelector('[data-tower-pick="${floor}"]').scrollIntoView({block:'nearest'});true`);
    await wait(`(()=>{const img=document.querySelector('.twx-boss-img');return img&&img.complete&&img.naturalWidth===1080&&img.dataset.towerBossImage===BOSS_LIST[${floor-1}].img})()`);
    const portraits=await ev(`['.twx-boss-img','[data-tower-pick="${floor}"] .twx-fl-ico'].map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return {selector,src:e.getAttribute('data-tower-boss-image'),naturalWidth:e.naturalWidth,bounds:{x:r.x,y:r.y,width:r.width,height:r.height}}})`);
    for(let i=0;i<portraits.length;i++){assert.equal(portraits[i].naturalWidth,1080);await shot('portrait-'+floor+'-'+(i?'list':'detail')+'.png',portraits[i].bounds);}
    const started=await ev("WorkerBridge.send('tower.start',{floor:"+floor+"})");assert.notEqual(started.ok,false,JSON.stringify(started));
    await wait("BattleRenderer._debug().entities.some(e=>e.id==='tb-float'&&e.npc3d)",45);
    const states=[],seen=new Set();let entered=false;
    for(let i=0;i<180;i++){
      const state=await ev("BattleRenderer._debug().entities.find(e=>e.id==='tb-float')||null");
      if(state){states.push({at:Date.now(),...state});if(state.clip)seen.add(state.clip);if(state.anim==='walk'||state.state==='entering')entered=true;}
      if(['Attack1','Attack2','Attack3'].every(c=>seen.has(c)))break;
      await sleep(100);
    }
    assert.ok(['Attack1','Attack2','Attack3'].every(c=>seen.has(c)),JSON.stringify([...seen]));
    await shot('tower-boss9-'+floor+'.png');
    // Only after observing all three boss attacks, use the existing GM test
    // baseline to avoid waiting on the new character's low hit/attack rate.
    await gm('maxstats');
    await gm('damage 100%');
    await wait("BattleRenderer._debug().entities.some(e=>e.id==='tb-float'&&e.state==='dying'&&e.clip==='Die')",60);
    const deathStart=Date.now();let lastAlive=0,goneAt=null;
    for(let i=0;i<65;i++){
      const state=await ev("BattleRenderer._debug().entities.find(e=>e.id==='tb-float')||null"),elapsed=(Date.now()-deathStart)/1000;
      if(state){lastAlive=elapsed;states.push({at:Date.now(),...state});if(i===10)await shot('tower-boss9-howl-'+floor+'.png');if(i===30)await shot('tower-boss9-fallen-'+floor+'.png');}
      else{goneAt=elapsed;break;}
      await sleep(100);
    }
    const result={name:'boss9'+(floor===9?'':'_lv'+(floor===19?2:3)),floor,glbSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'images/models/npc3d/boss9'+(floor===9?'':'_lv'+(floor===19?2:3))+'.glb'))).digest('hex'),testMode:{seed:9,fixedSimulationSteps:true,autoAdvance:false,muted:true},render,portraits,live:{commands,entered,seen:[...seen],states,deathLastAliveSeconds:lastAlive,deathGoneSeconds:goneAt,worker:await ev('WorkerBridge.status()')},errors,warnings};
    variants.push(result);
    assert.ok(lastAlive>3.4,'death was removed before its four-second clip finished: '+JSON.stringify({lastAlive,goneAt,states:states.slice(-4)}));assert.ok(goneAt!==null&&goneAt<6.5,'corpse was not disposed after fade');
    assert.deepEqual(errors,[]);console.log('BOSS9_VARIANT_LIVE_PASS',floor,JSON.stringify({seen:[...seen],lastAlive,goneAt,errors}));
    }
    fs.writeFileSync(path.join(out,idleCheck?'idle-check.json':'runtime.json'),JSON.stringify({variants,errors,warnings},null,2)+'\n');
  }finally{
    if(ws)ws.close();if(browser)await browser.close();await new Promise(r=>server.close(r));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
