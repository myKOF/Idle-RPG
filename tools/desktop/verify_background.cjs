'use strict';
/* 真正 Electron 原生視窗驗證：不使用 --smoke、不改玩家存檔。
   node tools/desktop/verify_background.cjs [輸出資料夾]
   會短暫顯示遊戲與測試焦點視窗，最後關閉並清除隔離 profile。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const ROOT = path.resolve(__dirname, '../..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.type !== 'browser') {
  const { spawn } = require('child_process');
  const out = path.resolve(process.argv[2] || path.join(ROOT, 'tmp', 'desktop-background'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-background-'));
  fs.mkdirSync(out, { recursive: true });
  fs.rmSync(path.join(out, 'report.json'), { force: true });
  const env = { ...process.env, IDLE_BACKGROUND_REPORT: out };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, '--windowed', '--profile=' + profile, '--no-steam-overlay'],
    { cwd: ROOT, env, stdio: 'inherit', windowsHide: true });
  const deadline = setTimeout(() => {
    if (process.platform === 'win32') require('child_process').spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    else child.kill('SIGKILL');
  }, 180000);
  child.on('exit', code => {
    clearTimeout(deadline);
    // profile 是本次 mkdtemp 建立的絕對路徑，刪除前再次確認邊界。
    if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('idle-background-')) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
    }
    const reportPath = path.join(out, 'report.json');
    const passed = fs.existsSync(reportPath) && JSON.parse(fs.readFileSync(reportPath, 'utf8')).passed;
    process.exitCode = code || (passed ? 0 : 1);
  });
} else {
  const { app, BrowserWindow } = require('electron');
  const out = process.env.IDLE_BACKGROUND_REPORT;
  console.log('[verify] boot', JSON.stringify(process.argv));
  app.setAppPath(ROOT);
  require('../../electron/main.cjs');
  console.log('[verify] profile', app.getPath('userData'), 'lock', app.hasSingleInstanceLock());
  let win, other;
  const report = { mode: 'normal (no smoke)', samples: [], pageErrors: [] };
  async function page(code) {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(code.slice(0, 140) + ': ' + error.message); }
  }
  async function until(code, label, timeout = 60000) {
    console.log('[verify] waiting', label);
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (['page loaded', 'start menu', 'intro', 'game revealed'].includes(label) && !win.isFocused()) win.focus();
      if (await page(code)) { console.log('[verify] ready', label); return; }
      await wait(150);
    }
    const diagnostic = await page(`JSON.stringify({body:document.body.className, hidden:GameVisibility.isHidden(), loading:document.getElementById('loading-screen').className, worker:WorkerBridge.status(), renderer:BattleRenderer.status(), dirty:UI.dirty, paused:GameClock.isPaused()})`);
    throw new Error('Timed out: ' + label + ' ' + diagnostic);
  }
  async function sample(label) {
    const state = await page(`(function(){ var v = viewState() || {}, w = WorkerBridge.status(), b = BattleRenderer.status();
      return { hidden: GameVisibility.isHidden(), chromiumHidden: document.hidden, gt: v.gt, gold: v.gold, level: v.level, xp: v.xp,
        ticks: w.ticks, persists: w.persists, persistErrors: w.persistErrors, workerErrors: w.errors, restarts: w.restarts,
        frames: window.__backgroundFrames || 0, rendering: BattleRenderer._app().ticker.started,
        vfxEnabled: _vfxEnabled, fx: b.fx, floats: b.floats, later: b.later.q, visualQueue: UI_WORKER_VISUAL_EVENT_QUEUE.length };
    })()`);
    state.label = label; state.at = Date.now(); state.focused = win.isFocused(); state.minimized = win.isMinimized();
    report.samples.push(state); console.log('[background]', JSON.stringify(state)); return state;
  }
  async function interval(label, hidden) {
    await wait(500);
    const before = await sample(label + ':start');
    assert.equal(before.hidden, hidden); assert.equal(before.rendering, !hidden); assert.equal(before.vfxEnabled, !hidden);
    if (!hidden) assert.equal(before.focused, false, '失焦繪圖驗證不可讓主遊戲取得焦點');
    await wait(18000);
    const after = await sample(label + ':end');
    assert.ok(after.gt - before.gt >= 16, '背景遊戲時間必須跟隨牆鐘');
    assert.ok(after.ticks > before.ticks + 50, 'Worker 持續送出 tick');
    assert.ok(after.persists > before.persists, '背景自動存檔仍須執行');
    assert.equal(after.persistErrors, 0); assert.equal(after.workerErrors, 0);
    assert.equal(after.hidden, hidden); assert.equal(after.rendering, !hidden);
    assert.equal(after.vfxEnabled, !hidden);
    if (hidden) {
      assert.equal(after.frames, before.frames, '最小化／隱藏時主要畫布不得持續繪圖');
      assert.equal(after.fx, 0); assert.equal(after.floats, 0); assert.equal(after.later, 0);
    } else {
      assert.equal(after.focused, false);
      assert.ok(after.frames > before.frames + 30, '遊戲可見但失焦時必須持續繪圖');
      assert.ok(after.visualQueue < 20, '失焦時持續消費畫面事件，不累積至取回焦點才播放');
    }
    assert.ok(after.gold > before.gold || after.xp !== before.xp || after.level > before.level, '背景戰鬥仍有實際收益');
  }
  const deadline = setTimeout(() => { console.error('Electron verification deadline'); app.exit(1); }, 160000);
  app.whenReady().then(async () => {
    try {
      win = BrowserWindow.getAllWindows()[0];
      win.webContents.on('console-message', event => { if (event.level === 'error') report.pageErrors.push(event.message); });
      win.setSize(1100, 760); win.show(); win.focus();
      assert.equal(win.webContents.getBackgroundThrottling(), false);
      await until(`typeof GameSettings !== 'undefined' && typeof StartMenu !== 'undefined'`, 'page loaded');
      await page(`GameSettings.set('mute', true)`);
      await until(`document.getElementById('start-menu-new') && document.getElementById('loading-screen').classList.contains('is-hidden')`, 'start menu');
      await page(`document.getElementById('start-menu-new').click()`);
      await until(`window.IntroPlayer && IntroPlayer.isPlaying()`, 'intro');
      await page(`IntroPlayer.abort('skip')`);
      await until(`WorkerBridge.status().booted && BattleRenderer._app() && !document.body.classList.contains('start-menu-pending') && document.getElementById('loading-screen').classList.contains('is-hidden')`, 'game revealed');
      await page(`window.__backgroundFrames = 0; BattleRenderer._app().ticker.add(function(){window.__backgroundFrames++;}); true;`);
      await wait(2000);
      const visible = await sample('foreground'); assert.equal(visible.hidden, false); assert.ok(visible.frames > 10);
      other = new BrowserWindow({ width: 350, height: 140, title: 'Background verification', webPreferences: { sandbox: true, contextIsolation: true } });
      await other.loadURL('data:text/html,<title>Background verification</title><p>Desktop background test</p>');
      other.show(); other.focus();
      await interval('blur', false);
      other.hide(); win.focus();
      await until(`!GameVisibility.isHidden() && BattleRenderer._app().ticker.started`, 'focus restore');
      await wait(1200); const restored = await sample('focus-restored');
      assert.ok(restored.frames > visible.frames); assert.ok(restored.visualQueue < 20);
      win.minimize(); await interval('minimized', true);
      win.restore(); win.show(); win.focus();
      await until(`!GameVisibility.isHidden() && BattleRenderer._app().ticker.started`, 'minimize restore');
      await wait(1200); await sample('minimize-restored');
      win.hide(); await interval('hidden', true);
      win.showInactive();
      await until(`!GameVisibility.isHidden() && BattleRenderer._app().ticker.started`, 'unfocused show');
      const shown = await sample('unfocused-shown'); assert.equal(shown.focused, false);
      await wait(1200); const shownLater = await sample('unfocused-shown-later');
      assert.equal(shownLater.focused, false); assert.ok(shownLater.frames > shown.frames + 10);
      win.focus();
      // 選單暫停與背景顯示暫停交錯：前景還原不得解除玩家選單暫停。
      await page(`GameMenu.handleEscape()`);
      await until(`GameClock.isPaused()`, 'menu paused');
      const paused = await sample('menu-paused');
      win.minimize(); await wait(1200); win.restore(); win.show(); win.focus(); await wait(1200);
      const stillPaused = await sample('menu-restored');
      assert.equal(stillPaused.gt, paused.gt); assert.equal(stillPaused.rendering, false);
      await page(`GameMenu.handleEscape()`);
      await until(`!GameClock.isPaused() && BattleRenderer._app().ticker.started`, 'menu resumed');
      await wait(1500); const resumed = await sample('menu-resumed'); assert.ok(resumed.gt > paused.gt);
      fs.writeFileSync(path.join(out, 'restored.png'), (await win.webContents.capturePage()).toPNG());
      await page(`WorkerBridge.saveAutoNow()`);
      report.saves = fs.readdirSync(global.__desktopSavesDir).filter(name => /\.json$/.test(name));
      assert.ok(report.saves.length > 0); assert.deepEqual(report.pageErrors, []);
      report.passed = true;
    } catch (error) { report.passed = false; report.error = error.stack; console.error(error); }
    finally {
      clearTimeout(deadline);
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      if (other && !other.isDestroyed()) other.destroy();
      if (win && !win.isDestroyed()) win.destroy();
      app.exit(report.passed ? 0 : 1);
    }
  });
}
