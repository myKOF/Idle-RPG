// node tools/boss5/capture.cjs <clip> <out.gif> [asset.glb|-] [fps]
// Renders viewer/ (three.js, the game's vendored copy) in headless Chrome, screenshots every frame and writes a GIF.
// env: BOSS5_ASSETS = folder holding boss5.glb + boss5_skull.glb (default tools/boss5/out), CHROME_EXE, FRAMES=1,5 (only these), DUMP=1 (also save PNGs), DITHER=0..8, EVAL / EVAL_PRE (debug)
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const { decodePNG, encodeGIF } = require('./gifenc.cjs');
const [clip, outGif, assetArg, fpsArg] = process.argv.slice(2);
const ROOT = path.resolve(__dirname, '../..');
const ASSETS = process.env.BOSS5_ASSETS || path.join(__dirname, 'out');
fs.mkdirSync(ASSETS, { recursive: true });
const HERE = __dirname;
const W = 640, H = 360, PORT = 8765 + Math.floor(Math.random() * 200), DBG = 9333 + Math.floor(Math.random() * 200);
const CHROME = process.env.CHROME_EXE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let f;
  if (u.startsWith('/three/')) f = path.join(ROOT, 'js/vendor/three', u.slice(7));
  else if (u.startsWith('/assets/')) f = path.join(ASSETS, u.slice(8));
  else f = path.join(HERE, 'viewer', u === '/' ? 'index.html' : u.slice(1));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => server.listen(PORT, r));
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'b5chrome-'));
  const chrome = cp.spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${ud}`, `--window-size=${W},${H + 100}`, '--hide-scrollbars', '--mute-audio',
    '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', 'about:blank'], { stdio: 'ignore' });
  let ws, tabs;
  for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (tabs.find(t => t.type === 'page')) break; } catch (e) { } await sleep(200); }
  const page = tabs.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.args.map(a => a.value || a.description).join(' ')); else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description)); });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const q = `clip=${clip}` + (assetArg && assetArg !== '-' ? `&asset=${encodeURIComponent(assetArg)}` : '');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?${q}` });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)); return r.result.result.value; };
  let ok = false;
  for (let i = 0; i < 300; i++) { await sleep(200); const s = await ev('JSON.stringify({r:!!window.__ready,e:window.__err||null})'); const j = JSON.parse(s); if (j.e) { console.log('PAGE ERR', j.e, logs.slice(-5)); break; } if (j.r) { ok = true; break; } }
  if (!ok) { console.log('not ready', logs.slice(-10)); chrome.kill(); server.close(); process.exit(1); }
  if (process.env.EVAL) { console.log('EVAL', await ev(process.env.EVAL)); chrome.kill(); server.close(); process.exit(0); }
  if (process.env.EVAL_PRE) console.log('PRE', await ev(process.env.EVAL_PRE));
  const n = await ev('window.frames()');
  const only = process.env.FRAMES ? process.env.FRAMES.split(',').map(Number) : null;
  const frames = []; const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await ev(`window.frame(${i})`);
    if (only && !only.includes(i)) continue;
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    const png = decodePNG(Buffer.from(shot.result.data, 'base64')); frames.push(png);
    if (process.env.DUMP) fs.writeFileSync(path.join(ASSETS, `${clip}_${String(i).padStart(3, '0')}.png`), Buffer.from(shot.result.data, 'base64'));
  }
  console.log('captured', frames.length, 'frames in', ((Date.now() - t0) / 1000).toFixed(1), 's', logs.slice(-3));
  const fps = Number(fpsArg || 25); const bytes = encodeGIF(frames, Math.round(100 / fps), outGif, { dither: process.env.DITHER === undefined ? 3 : Number(process.env.DITHER) });
  console.log('GIF', outGif, (bytes / 1048576).toFixed(2), 'MB');
  ws.close(); chrome.kill(); server.close();
  try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { }
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
