'use strict';
// Isolated browser: node verify_ingame.cjs OUTPUT_DIR [FLOOR=8].
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { launchHeadless } = require('../lib/headless-browser.cjs');
const root = path.resolve(__dirname, '../..');
const output = path.resolve(process.argv[2] || path.join(root, 'tmp/boss8/game'));
const floor = Number(process.argv[3] || 8);
const suffixByFloor = { 8: '', 18: '_lv2', 28: '_lv3' };
assert.ok(Object.hasOwn(suffixByFloor, floor));
const npcId = 'tower_boss_'+floor;
const portrait = 'sprites/boss/boss8_gargoyle'+suffixByFloor[floor]+'.png';
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const mime = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'), file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, bytes) => { res.writeHead(error ? 404 : 200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(error ? '' : bytes); });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let chrome, ws;
  const errors = [];
  try {
    chrome = await launchHeadless({ exe, prefix: 'boss8-', args: ['--window-size=1280,900', '--mute-audio', '--hide-scrollbars', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
    ws = new WebSocket((await chrome.waitForPage()).webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    let sequence = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
      else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    });
    const send = (method, params = {}) => new Promise(resolve => { const id = ++sequence; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const ev = async expression => {
      const data = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (data.error || data.result.exceptionDetails) throw Error(JSON.stringify(data.error || data.result.exceptionDetails));
      return data.result.result.value;
    };
    const until = async (expression, label) => {
      for (let i=0;i<120;i++) { const value = await ev(expression); if (value) return value; await sleep(250); }
      throw Error('Timed out: ' + label);
    };
    const screenshot = async name => {
      const result = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(output, name+'.png'), Buffer.from(result.result.data,'base64'));
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width:1280,height:900,deviceScaleFactor:1,mobile:false });
    await send('Page.navigate', { url:'http://127.0.0.1:'+server.address().port+'/index.html' });
    await until('!!(window.Npc3D && window.Hero3D && window.BOSS_LIST && window.PIXI)', 'game scripts');
    const model = await ev(`(async () => {
      const definition=Npc3D.definition(BOSS_LIST.find(b=>b.id==='${npcId}'));
      const body=await Npc3D.create(definition), ctrl=body.npc3d.controller;
      const result={file:definition.file,clips:ctrl.clips.slice(),durations:{},frames:[],attackCycle:[]};
      for(const name of ['Walk','Attack1','Attack2','Attack3','Die']) result.durations[name]=ctrl.duration(name);
      const plan=[['Walk',0],['Attack1',.24],['Attack1',.50],['Attack1',.70],['Attack2',.34],['Attack2',.58],['Attack3',.50],['Die',.20],['Die',.60],['Die',1]];
      for(const [name,u] of plan){ctrl.pose(name,ctrl.duration(name)*u);ctrl.update(0);result.frames.push({name,u,png:ctrl.canvas.toDataURL('image/png')});}
      for(let i=0;i<3;i++) result.attackCycle.push(Npc3D.play(body,'attack',3).clip);
      Npc3D.dispose(body); return result;
    })()`);
    for(const [name, seconds] of Object.entries({Walk:1.6,Attack1:2.6/1.5,Attack2:2.08,Attack3:2.4,Die:113/30})) assert.ok(Math.abs(model.durations[name]-seconds)<.001,name);
    assert.deepEqual(model.attackCycle,['Attack1','Attack2','Attack3']);
    for(const [i,frame] of model.frames.entries()) fs.writeFileSync(path.join(output, i+'_'+frame.name+'.png'),Buffer.from(frame.png.split(',')[1],'base64'));
    delete model.frames;
    console.log('BOSS8_RUNTIME_MODEL_PASS',JSON.stringify(model));
    // Skip only the opening cinematic in this disposable browser profile.
    await until(`!![...document.querySelectorAll('button')].find(b=>b.offsetParent!==null && /^新遊戲$/.test(b.innerText.trim()))`, 'new game');
    await ev(`(()=>{if(window.IntroPlayer) IntroPlayer.play=()=>false; [...document.querySelectorAll('button')].find(b=>b.offsetParent!==null && /^新遊戲$/.test(b.innerText.trim())).click(); return true;})()`);
    await sleep(2000);
    for(const command of ['level 300','gold 100000000000','god 1','tower_jump '+floor]) {
      const response=await ev(`WorkerBridge.send('gm.exec',{line:${JSON.stringify(command)}})`);
      if(response?.error) throw Error(JSON.stringify(response));
    }
    await ev(`document.querySelector('button[data-tab="tower"]').click()`);
    await until(`!!document.querySelector('[data-tower-pick="${floor}"]')`, 'tower floor row');
    await ev(`document.querySelector('[data-tower-pick="${floor}"]').click()`);
    await until(`(()=>{const images=[...document.querySelectorAll('[data-tower-boss-image="${portrait}"]')];return images.length>=2 && images.every(i=>i.complete && i.naturalWidth===1080);})()`, 'tower portraits');
    const portraits=await ev(`(()=>{return [...document.querySelectorAll('[data-tower-boss-image="${portrait}"]')].map(i=>{const r=i.getBoundingClientRect(),p=i.parentElement.getBoundingClientRect();return {className:i.className,width:r.width,height:r.height,parentWidth:p.width,parentHeight:p.height,visible:i.offsetParent!==null};});})()`);
    assert.ok(await ev(`document.getElementById('tower-detail').innerText.includes('石像鬼')`));
    await screenshot('tower');
    await ev(`(()=>{const b=document.querySelector('[data-tower-floor="${floor}"]');if(!b || b.disabled) throw Error('Floor ${floor} unavailable');b.click();return true;})()`);
    const entity=await until(`(()=>{const e=window.BattleRenderer && BattleRenderer._debug().entities.find(e=>e.npc==='${npcId}' && e.npc3d);return e||false;})()`, 'live 3D gargoyle');
    const liveAttack=await until(`(()=>{const e=BattleRenderer._debug().entities.find(e=>e.npc==='${npcId}' && e.npc3d && /^Attack[123]$/.test(e.clip));return e||false;})()`, 'live attack animation');
    await screenshot('battle');
    assert.equal(errors.length,0,errors.join('\n'));
    const report={floor,model,portraits,liveEntity:entity,liveAttack,exceptions:errors,cinematicSkippedForTest:true};
    fs.writeFileSync(path.join(output,'game-qa.json'),JSON.stringify(report,null,2)+'\n');
    console.log('BOSS8_TOWER_GAME_PASS',JSON.stringify(report));
  } finally {
    if(ws)ws.close();
    if(chrome)await chrome.close();
    server.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
