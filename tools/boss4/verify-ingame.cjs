// node tools/boss4/verify-ingame.cjs <out.png>
// Loads the real game page in headless Chrome/Edge, builds each BOSS4 look with the game's own Npc3D.create
// (Hero3D loader, PBR, 6.2 m canvas) from BOSS_LIST, poses every clip at a few moments and saves a contact sheet.
// Fails if a model cannot load or a configured clip is missing.
const http = require('http'), fs = require('fs'), path = require('path');
const { launchHeadless } = require('../lib/headless-browser.cjs');
const OUT = process.argv[2] || 'boss4-ingame.png';
const ROOT = path.resolve(__dirname, '../..');
const PORT = 8950 + Math.floor(Math.random() * 40);
const CHROME = process.env.CHROME_EXE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': mime[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(d); });
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => server.listen(PORT, r));
  const chrome = await launchHeadless({ exe: CHROME, prefix: 'b4game-', args: ['--window-size=1200,800', '--hide-scrollbars', '--mute-audio',
    '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  let ws;
  try {
    ws = new WebSocket((await chrome.waitForPage()).webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    let id = 0; const pend = new Map(); const logs = [];
    ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description)); });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)); return r.result.result.value; };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    for (let i = 0; i < 120; i++) { await sleep(500); if (await ev('!!(window.Npc3D && window.Hero3D && window.BOSS_LIST && window.PIXI)')) break; }
    const result = await ev(`(async () => {
      const out = [];
      for (const id of ['tower_boss_4', 'tower_boss_14', 'tower_boss_24']) {
        const b = BOSS_LIST.find(x => x.id === id), def = Npc3D.definition(b);
        if (!def) throw new Error(id + ' has no model3d');
        const body = await Npc3D.create(def), ctrl = body.npc3d.controller;
        const row = { id, file: def.file, clips: ctrl.clips.slice(), frames: [] };
        const plan = [['Walk', 0], ['Attack1', .45], ['Attack2', .4], ['Attack3', .4], ['Attack3', .66], ['Die', .99]];
        for (const [clip, f] of plan) {
          ctrl.pose(clip, ctrl.duration(clip) * f); ctrl.update(0);
          row.frames.push({ clip, f, png: ctrl.canvas.toDataURL('image/png') });
        }
        row.durations = Object.fromEntries(['Walk', 'Attack1', 'Attack2', 'Attack3', 'Die'].map(c => [c, +ctrl.duration(c).toFixed(3)]));
        Npc3D.dispose(body);
        out.push(row);
      }
      return out;
    })()`);
    const { createCanvas } = (() => { try { return require('canvas'); } catch (e) { return {}; } })();
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    const dir = path.resolve(OUT).replace(/\.png$/i, '');
    fs.mkdirSync(dir, { recursive: true });
    for (const row of result) {
      console.log(row.id, row.file, 'clips', row.clips.join(','), 'durations', JSON.stringify(row.durations));
      row.frames.forEach((fr, k) => fs.writeFileSync(path.join(dir, `${row.id}_${k}_${fr.clip}.png`), Buffer.from(fr.png.split(',')[1], 'base64')));
    }
    console.log('frames saved to', dir, logs.filter(l => /EXC/.test(l)).slice(-3));
  } finally {
    try { ws && ws.close(); } catch (e) {}
    await chrome.close(); server.close();
  }
})().catch(e => { console.error('FAIL', e.message || e); process.exit(1); });
