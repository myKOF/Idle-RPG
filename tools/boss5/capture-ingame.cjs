// node tools/boss5/capture-ingame.cjs <out.gif> [seconds=20] [intervalMs=100] [floor=5]
// 用無頭 Chrome 開真正的遊戲（不被背景分頁節流）：新遊戲 → GM 鎖血／給金幣 → 跳到塔第 N 層並挑戰 → 連續截戰鬥畫布成 GIF。
// 環境變數：CHROME_EXE、FRAMES_DUMP=資料夾（另存每張 PNG）、CROP=x,y,w,h（覆寫裁切區）、SCALE（縮圖倍率，預設 1）
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const { decodePNG, encodeGIF } = require('./gifenc.cjs');
const [outGif, secArg, intArg, floorArg] = process.argv.slice(2);
const SECONDS = Number(secArg || 20), INTERVAL = Number(intArg || 100), FLOOR = Number(floorArg || 5);
const ROOT = path.resolve(__dirname, '../..');
const W = 1400, H = 800, PORT = 8800 + Math.floor(Math.random() * 150), DBG = 9500 + Math.floor(Math.random() * 150);
const CHROME = process.env.CHROME_EXE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.css': 'text/css', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': mime[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(d); });
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => server.listen(PORT, r));
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'b5game-'));
  const chrome = cp.spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${ud}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (tabs.find(t => t.type === 'page')) break; } catch (e) { } await sleep(200); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.type + ': ' + d.params.args.map(a => a.value || a.description).join(' ')); else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description)); });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)); return r.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(4000);
  const step = async (name, js, wait) => { const v = await ev(js); console.log(name, '→', typeof v === 'string' ? v.slice(0, 160) : v); await sleep(wait || 800); return v; };
  await step('mute', `(()=>{try{GameSettings.set('mute',true)}catch(e){}; const b=[...document.querySelectorAll('button')].find(b=>/^新遊戲$/.test((b.innerText||'').trim())&&b.offsetParent!==null); b&&b.click(); return !!b})()`, 1500);
  await step('confirm', `(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>/^新遊戲$/.test((b.innerText||'').trim())&&b.offsetParent!==null); if(bs.length>0) bs[bs.length-1].click(); return bs.length})()`, 5000);
  const gm = (c) => step('gm ' + c, `(async()=>{const t=document.querySelector('textarea[placeholder^="GM"]'); t.value=${JSON.stringify(c)}; t.dispatchEvent(new Event('input',{bubbles:true})); t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true})); return 'sent'})()`, 600);
  await gm('gold 100000000000'); await gm('level 300'); await gm('god 1'); await gm('tower_jump ' + FLOOR);
  await step('tower tab', `(()=>{document.querySelector('button[data-tab="tower"]').click(); return 1})()`, 1500);
  const started = await step('challenge', `(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.offsetParent!==null&&/挑戰第 ${FLOOR} 層/.test(e.getAttribute('aria-label')||e.innerText||'')); if(!b) return 'no button'; b.click(); return 'clicked'})()`, 2500);
  if (started !== 'clicked') { console.log('FAIL', logs.slice(-8)); chrome.kill(); server.close(); process.exit(1); }
  if (process.env.EVAL) { await sleep(Number(process.env.EVAL_WAIT || 4000)); { const v = await ev(process.env.EVAL); if (process.env.EVAL_OUT) { const m = /^data:image\/png;base64,(.*)$/.exec(String(v)); fs.writeFileSync(process.env.EVAL_OUT, m ? Buffer.from(m[1], 'base64') : String(v)); console.log('EVAL saved', process.env.EVAL_OUT); } else console.log('EVAL', v); } chrome.kill(); server.close(); process.exit(0); }
  if (process.env.PRE_EVAL) { await sleep(2500); console.log('PRE_EVAL', await ev(fs.readFileSync(process.env.PRE_EVAL, 'utf8'))); }
  let cropEnt = null;
  if (process.env.CROP_ENT) {
    await sleep(2500);
    cropEnt = JSON.parse(await ev('JSON.stringify((()=>{const a=BattleRenderer.status().oniAnchors[0]; const c=[...document.querySelectorAll("canvas")].filter(c=>c.offsetParent!==null).sort((a,b)=>b.width*b.height-a.width*a.height)[0]; const r=c.getBoundingClientRect(); const k=r.width/c.width; return {a, cx:r.x, cy:r.y, k}})())'));
    console.log('ent', JSON.stringify(cropEnt));
  }
  const rectStr = process.env.CROP || (cropEnt ? [Math.max(0, Math.round(cropEnt.cx + (cropEnt.a.bounds.x - 40) * cropEnt.k)), Math.max(0, Math.round(cropEnt.cy + (cropEnt.a.bounds.y - 40) * cropEnt.k)), Math.round((cropEnt.a.bounds.w + 80) * cropEnt.k), Math.round((cropEnt.a.bounds.h + 80) * cropEnt.k)].join(',') : null) || await ev(`(()=>{const c=[...document.querySelectorAll('canvas')].filter(c=>c.offsetParent!==null).sort((a,b)=>b.width*b.height-a.width*a.height)[0]; const r=c.getBoundingClientRect(); return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)].join(',')})()`);
  const [cx, cy, cw, ch] = rectStr.split(',').map(Number); console.log('crop', rectStr);
  const frames = [], states = []; const t0 = Date.now(); let n = 0;
  while (Date.now() - t0 < SECONDS * 1000) {
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: cx, y: cy, width: cw, height: ch, scale: process.env.SCALE ? Number(process.env.SCALE) : 1 } });
    const raw = Buffer.from(shot.result.data, 'base64');
    if (process.env.FRAMES_DUMP) { fs.mkdirSync(process.env.FRAMES_DUMP, { recursive: true }); fs.writeFileSync(path.join(process.env.FRAMES_DUMP, String(n).padStart(4, '0') + '.png'), raw); }
    frames.push(decodePNG(raw)); n++;
    const st = JSON.parse(await ev('JSON.stringify(BattleRenderer.status().oni)'));
    states.push(st);
    if (st && (st.skulls || st.flames || (st.timers && st.timers.length) || st.pending)) console.log('frame', n - 1, JSON.stringify(st));
    await sleep(Math.max(0, INTERVAL - 60));
  }
  console.log('captured', frames.length, 'frames', logs.filter(l => /error|EXC/i.test(l)).slice(-5));
  const bytes = encodeGIF(frames, Math.max(2, Math.round(INTERVAL / 10)), outGif, { dither: 0 });
  console.log('GIF', outGif, (bytes / 1048576).toFixed(2), 'MB');
  ws.close(); chrome.kill(); server.close();
  try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { }
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
