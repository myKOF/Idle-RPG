'use strict';
/* node tools/desktop/verify-window-bounds.cjs [report.json]
   使用隔離 profile 跨三個真正 Electron 程序驗證，不顯示測試視窗、不碰玩家資料。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.type !== 'browser') {
  const { spawn, spawnSync } = require('child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-window-bounds-'));
  const output = path.resolve(process.argv[2] || path.join(ROOT, 'tmp/desktop-window-bounds/report.json'));
  const report = { phases: [] };
  async function phase(number) {
    const env = { ...process.env, IDLE_BOUNDS_PHASE: String(number) }; delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, '--profile=' + profile, '--no-steam-overlay', ...(number === 1 ? ['--windowed'] : [])],
        { cwd: ROOT, env, stdio: 'inherit', windowsHide: true });
      const deadline = setTimeout(() => {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
        else child.kill('SIGKILL');
      }, 60000);
      child.once('error', error => { clearTimeout(deadline); reject(error); });
      child.once('exit', code => { clearTimeout(deadline); code === 0 ? resolve() : reject(new Error('Phase ' + number + ' exit ' + code)); });
    });
    report.phases.push(JSON.parse(fs.readFileSync(path.join(profile, 'phase-' + number + '.json'), 'utf8')));
  }
  (async () => {
    try { for (let n = 1; n <= 3; n++) await phase(n); report.passed = true; }
    catch (error) { report.passed = false; report.error = error.stack; process.exitCode = 1; }
    finally {
      fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
      if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('idle-window-bounds-')) {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
      }
      console.log(JSON.stringify(report));
    }
  })();
} else {
  const { app, BrowserWindow } = require('electron');
  const phase = Number(process.env.IDLE_BOUNDS_PHASE);
  // 真正建立原生視窗，僅抑制測試顯示，避免打擾使用者。
  app.on('browser-window-created', (_event, win) => { win.show = function () {}; });
  app.setAppPath(ROOT);
  require('../../electron/main.cjs');
  const profile = app.getPath('userData');
  const boundsFile = path.join(profile, 'window-bounds.json');
  const expectedFile = path.join(profile, 'expected.json');
  const report = { phase, errors: [] };
  let win;
  async function until(check, label) {
    const end = Date.now() + 35000;
    while (Date.now() < end) { if (await check()) return; await wait(100); }
    throw new Error('Timed out: ' + label);
  }
  const page = code => win.webContents.executeJavaScript(code, true);
  const deadline = setTimeout(() => app.exit(1), 50000);
  app.whenReady().then(async () => {
    try {
      win = BrowserWindow.getAllWindows()[0];
      win.webContents.on('console-message', event => { if (event.level === 'error') report.errors.push(event.message); });
      await until(() => page("typeof GameSettings !== 'undefined' && typeof DisplaySettingsUI !== 'undefined' && !!window.ApexHost"), 'page loaded');
      await page("GameSettings.set('mute', true)");
      await until(() => page("document.getElementById('loading-screen').classList.contains('is-hidden')"), 'display initialized');
      await wait(800);
      report.initialMode = win.displaySettings.get().mode;
      report.initialBounds = win.getBounds();
      if (phase === 1) {
        await win.displaySettings.setMode('windowed');
        win.setBounds({ x: 65, y: 70, width: 1013, height: 677 });
        fs.writeFileSync(expectedFile, JSON.stringify(win.getBounds()));
        // 不等250ms debounce，關窗必須立即保存。
      } else {
        const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
        assert.equal(win.displaySettings.get().hasWindowBounds, true);
        if (phase === 2) {
          assert.equal(report.initialMode, 'windowed');
          assert.deepEqual(win.getBounds(), expected, '啟動與顯示頁初始化不能改大視窗');
          const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
          win.webContents.reload(); await loaded; await wait(800);
          assert.deepEqual(win.getBounds(), expected, '重載頁面仍保留自訂視窗');
          await win.displaySettings.setMode('borderless');
          assert.deepEqual(JSON.parse(fs.readFileSync(boundsFile, 'utf8')), expected, '全螢幕不覆蓋一般視窗');
        } else {
          assert.equal(report.initialMode, 'borderless');
          await win.displaySettings.setMode('windowed');
          await wait(400);
          assert.deepEqual(win.getBounds(), expected, '重開全螢幕再還原仍是上次自訂大小');
          win.minimize(); await wait(400);
          assert.deepEqual(JSON.parse(fs.readFileSync(boundsFile, 'utf8')), expected);
          win.restore();
          await page("var select=document.getElementById('set-display-resolution'); select.value='1280x720'; select.dispatchEvent(new Event('change',{bubbles:true}));");
          await wait(500);
          assert.notDeepEqual(win.getBounds(), expected, '玩家主動選解析度仍改變尺寸');
        }
      }
      report.finalBounds = win.getBounds();
      assert.deepEqual(report.errors, []);
      const closed = new Promise(resolve => win.once('closed', resolve));
      win.close(); await closed;
      report.saved = JSON.parse(fs.readFileSync(boundsFile, 'utf8'));
      if (phase === 1) assert.deepEqual(report.saved, JSON.parse(fs.readFileSync(expectedFile, 'utf8')));
      report.passed = true;
    } catch (error) { report.passed = false; report.error = error.stack; console.error(error); }
    finally {
      clearTimeout(deadline);
      fs.writeFileSync(path.join(profile, 'phase-' + phase + '.json'), JSON.stringify(report, null, 2));
      if (win && !win.isDestroyed()) win.destroy();
      app.exit(report.passed ? 0 : 1);
    }
  });
}
