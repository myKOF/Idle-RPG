'use strict';
/* node tools/desktop/verify-startup.cjs [report.json] [save.json]
   Real Electron startup/reload with an isolated profile; never opens player storage.
   An optional save is copied read-only into that profile. No screenshots or visible windows. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.type !== 'browser') {
  const { spawn, spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-startup-'));
  const output = path.resolve(process.argv[2] || path.join(ROOT, 'tmp/desktop-startup/report.json'));
  if (process.argv[3]) {
    fs.mkdirSync(path.join(profile, 'saves'));
    fs.copyFileSync(path.resolve(process.argv[3]), path.join(profile, 'saves/IC_autosave_app-localhost.json'));
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const env = { ...process.env, IDLE_STARTUP_REPORT: output };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, '--internal', '--windowed', '--profile=' + profile, '--no-steam-overlay'],
    { cwd: ROOT, env, stdio: 'inherit', windowsHide: true });
  const deadline = setTimeout(() => {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    else child.kill('SIGKILL');
  }, 150000);
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', code => {
    clearTimeout(deadline);
    // Only this tool's freshly created absolute profile may be removed.
    if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('idle-startup-')) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
    }
    const report = fs.existsSync(output) && JSON.parse(fs.readFileSync(output, 'utf8'));
    process.exitCode = code || (report && report.passed ? 0 : 1);
  });
} else {
  const { app, BrowserWindow } = require('electron');
  app.on('browser-window-created', (_event, win) => {
    win.show = function () {};
    win.showInactive = function () {};
    // Keep the isolated renderer active without showing a native window.
    win.isVisible = function () { return true; };
  });
  app.setAppPath(ROOT);
  require('../../electron/main.cjs');
  const report = { phases: [], errors: [] };
  let win;
  const page = code => win.webContents.executeJavaScript(code, true);
  async function until(code, label, timeout = 35000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await page(code)) return;
      await wait(100);
    }
    throw new Error('Timed out: ' + label);
  }
  async function snapshot() {
    return page(`({ at: performance.now(), menu: StartMenu.isActive(), busy: StartMenu.isBusy(),
      loading: !document.getElementById('loading-screen').classList.contains('is-hidden'),
      worker: WorkerBridge.status().booted, backgroundPending: window.__startupBackgroundPending || 0,
      resources: performance.getEntriesByType('resource').filter(e=>e.duration>250).map(e=>({name:e.name,duration:e.duration})) })`);
  }
  const deadline = setTimeout(() => app.exit(1), 140000);
  app.whenReady().then(async () => {
    try {
      win = BrowserWindow.getAllWindows()[0];
      win.webContents.on('console-message', event => { if (event.level === 'error') report.errors.push(event.message); });
      await until(`typeof StartMenu !== 'undefined' && typeof GameSettings !== 'undefined'`, 'scripts');
      await page(`GameSettings.set('mute', true)`);
      await until(`document.getElementById('start-menu').style.display === 'flex' && !StartMenu.isBusy() && document.getElementById('loading-screen').classList.contains('is-hidden')`, 'initial menu');
      report.phases.push({ name: 'initial-menu', ...await snapshot() });
      // Stall only decorative image decoding on the next navigation. Reads remain real.
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Page.enable');
      await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
        const originalDecode = Image.prototype.decode;
        window.__startupBackgroundPending = 0;
        Image.prototype.decode = function () {
          if (!String(this.src).includes('/images/start-menu/')) return originalDecode.call(this);
          window.__startupBackgroundPending++;
          return new Promise(() => {});
        };
      ` });
      const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
      win.webContents.reload();
      await loaded;
      await until(`typeof StartMenu !== 'undefined' && document.getElementById('start-menu').style.display === 'flex' && document.getElementById('loading-screen').classList.contains('is-hidden')`, 'menu with stalled decoration', 8000);
      const stalled = await snapshot();
      report.phases.push({ name: 'stalled-background', ...stalled });
      assert.ok(stalled.backgroundPending >= 1);
      assert.equal(stalled.worker, false, 'Opening the menu must not start simulation or save');
      const continuing = await page(`!document.getElementById('start-menu-continue').hidden`);
      if (continuing) {
        const started = Date.now();
        await page(`document.getElementById('start-menu-continue').click()`);
        await until(`WorkerBridge.status().booted && document.getElementById('loading-screen').classList.contains('is-hidden')`, 'continue', 45000);
        report.phases.push({ name: 'continue', ms: Date.now() - started, ...await snapshot() });
        assert.equal(await page(`WorkerBridge.status().errors`), 0);
      }
      assert.deepEqual(report.errors, []);
      report.passed = true;
    } catch (error) {
      report.passed = false; report.error = error.stack;
      if (win && !win.isDestroyed()) report.last = await snapshot().catch(() => null);
      console.error(error);
    } finally {
      clearTimeout(deadline);
      fs.writeFileSync(process.env.IDLE_STARTUP_REPORT, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
      if (win && !win.isDestroyed()) {
        if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
        win.destroy();
      }
      app.exit(report.passed ? 0 : 1);
    }
  });
}
