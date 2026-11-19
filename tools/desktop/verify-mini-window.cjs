'use strict';
/* node tools/desktop/verify-mini-window.cjs [輸出資料夾] [full|demo|internal]
   使用真正 Electron 與隔離存檔，會短暫顯示視窗並切換三種顯示模式。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.type !== 'browser') {
  const { spawn, spawnSync } = require('child_process');
  const out = path.resolve(process.argv[2] || path.join(ROOT, 'tmp', 'desktop-mini'));
  const edition = process.argv[3] || 'full';
  if (!['full', 'demo', 'internal'].includes(edition)) throw new Error('Unknown edition');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-mini-'));
  fs.mkdirSync(out, { recursive: true });
  const env = { ...process.env, IDLE_MINI_REPORT: out, IDLE_MINI_EDITION: edition };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [__filename, '--windowed', '--profile=' + profile, '--no-steam-overlay'];
  if (edition !== 'full') args.push('--' + edition);
  const child = spawn(require('electron'), args, { cwd: ROOT, env, stdio: 'inherit', windowsHide: true });
  const deadline = setTimeout(() => {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    else child.kill('SIGKILL');
  }, 180000);
  child.on('exit', (code, signal) => {
    console.log('[mini] Electron exit', code, signal);
    clearTimeout(deadline);
    if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('idle-mini-')) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
    }
    process.exitCode = code === null ? 1 : code;
  });
} else {
  const { app, BrowserWindow } = require('electron');
  const out = process.env.IDLE_MINI_REPORT, internal = process.env.IDLE_MINI_EDITION === 'internal';
  app.setAppPath(ROOT);
  require('../../electron/main.cjs');
  let win, other;
  const report = { edition: process.env.IDLE_MINI_EDITION, modes: [], errors: [] };
  const page = code => win.webContents.executeJavaScript(code, true);
  const miniWindow = () => BrowserWindow.getAllWindows().find(candidate => candidate !== win && candidate !== other);
  async function until(check, label, ms = 45000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await check()) return; await wait(100); }
    throw new Error('Timed out: ' + label);
  }
  function key(target, keyCode = 'Enter') {
    target.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    target.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  }
  async function focus(target) {
    target.show(); target.focus();
    await until(() => target.webContents.executeJavaScript('document.hasFocus()'), 'focus', 5000);
  }
  async function open(useKey) {
    await focus(win);
    await page('if(document.activeElement)document.activeElement.blur()');
    if (useKey) key(win); else await page("document.getElementById('btn-pip').click()");
    await until(() => miniWindow() && miniWindow().isVisible() && !win.isVisible(), 'mini visible and main hidden');
    const mini = miniWindow();
    await until(() => mini.isAlwaysOnTop(), 'mini always on top', 5000);
    mini.webContents.on('console-message', event => { if (event.level === 'error') report.errors.push(event.message); });
    assert.equal(mini.isAlwaysOnTop(), true);
    assert.equal(await mini.webContents.executeJavaScript("document.querySelector('button') === null"), true, '內容區不再有還原鈕');
    assert.equal(mini.isMaximizable(), true);
    assert.equal(mini.isMinimizable(), true);
    await focus(mini);
    return mini;
  }
  async function restored() {
    await until(async () => !miniWindow() && win.isVisible() && await page('!MINI.desktop && MINI.timer === null'), 'main restored');
    await focus(win);
  }
  const deadline = setTimeout(() => { console.error('Mini verification deadline'); app.exit(1); }, 165000);
  app.whenReady().then(async () => {
    try {
      win = BrowserWindow.getAllWindows()[0]; win.setSize(1100, 760);
      win.webContents.on('console-message', event => { if (event.level === 'error') report.errors.push(event.message); });
      await until(() => page("typeof GameSettings !== 'undefined' && typeof StartMenu !== 'undefined'"), 'loaded');
      console.log('[mini] page loaded');
      await focus(win);
      await page("GameSettings.set('mute', true)");
      await until(() => page("document.getElementById('loading-screen').classList.contains('is-hidden')"), 'menu');
      await page("document.getElementById('start-menu-new').click()");
      await until(() => page('IntroPlayer.isPlaying()'), 'intro'); await page("IntroPlayer.abort('skip')");
      await focus(win);
      await wait(2000);
      console.log('[mini] startup', await page("({focused:document.hasFocus(),hidden:GameVisibility.isHidden(),sceneReady:BattleRenderer.status().sceneReady})"));
      await until(() => {
        if (!win.isFocused()) win.focus();
        return page("WorkerBridge.status().booted && !document.body.classList.contains('start-menu-pending') && document.getElementById('loading-screen').classList.contains('is-hidden')");
      }, 'game');
      assert.equal(await page('miniShortcutEnabled()'), !internal);
      report.tip = await page("document.getElementById('btn-pip').getAttribute('data-tt-title')");
      assert.equal(report.tip, internal ? '迷你視窗' : '迷你視窗 (Enter)');
      other = new BrowserWindow({ show: false, width: 300, height: 140, webPreferences: { sandbox: true } });
      await other.loadURL('data:text/html,<title>Mini focus verification</title>Focus test');
      let previousPosition = null;
      for (const mode of ['windowed', 'borderless', 'fullscreen']) {
        await win.displaySettings.setMode(mode); await focus(win); await wait(300);
        const bounds = win.getBounds(), state = win.displaySettings.get();
        await focus(other); key(win); await wait(250);
        assert.equal(miniWindow(), undefined, '失焦的主窗 Enter 不得開啟迷你');
        other.hide(); await focus(win);
        if (internal) {
          key(win); await wait(250); assert.equal(miniWindow(), undefined);
          assert.equal(await page("document.getElementById('gm-command-panel').style.display !== 'none'"), true);
          key(win, 'Escape');
        }
        const mini = await open(!internal);
        console.log('[mini]', mode, 'opened');
        const area = require('electron').screen.getDisplayMatching(bounds).workArea;
        if (!previousPosition) {
          const size = mini.getSize();
          assert.deepEqual(mini.getPosition(), [Math.round(area.x + (area.width - size[0]) / 2),
            Math.round(area.y + (area.height - size[1]) / 2)], '首次依主窗所在螢幕置中');
        } else assert.deepEqual(mini.getPosition(), previousPosition, '重開不得重設位置');
        mini.setPosition(area.x + 80 + report.modes.length * 35, area.y + 100 + report.modes.length * 25);
        previousPosition = mini.getPosition();
        mini.minimize();
        console.log('[mini]', mode, 'minimize requested');
        await until(() => mini.isMinimized(), 'mini minimized', 5000);
        assert.equal(win.isVisible(), false, '－不得重新顯示主遊戲');
        mini.restore(); await focus(mini);
        console.log('[mini]', mode, 'minimize restored');
        assert.deepEqual(mini.getPosition(), previousPosition, '最小化還原保留位置');
        const before = await page('({ticks:WorkerBridge.status().ticks,gt:viewState().gt})');
        const stage = await mini.webContents.executeJavaScript("document.getElementById('m-stage').textContent");
        assert.ok(stage.length > 0);
        await page("window.__savedMiniSnapshot=miniSnapshot; miniSnapshot=function(){var s=window.__savedMiniSnapshot();s.stage='LIVE-MINI-CHECK';return s;};true");
        await until(() => mini.webContents.executeJavaScript("document.getElementById('m-stage').textContent === 'LIVE-MINI-CHECK'"), 'live snapshot update', 5000);
        await page('miniSnapshot=window.__savedMiniSnapshot;delete window.__savedMiniSnapshot');
        await wait(1200);
        const after = await page('({ticks:WorkerBridge.status().ticks,gt:viewState().gt,hidden:GameVisibility.isHidden()})');
        assert.ok(after.ticks > before.ticks && after.gt > before.gt, '迷你模式仍持續模擬');
        assert.equal(after.hidden, true, '隱藏主窗須降載');
        await focus(other); key(mini); await wait(200);
        assert.equal(mini.isDestroyed(), false, '失焦迷你 Enter 不得還原');
        other.hide(); await focus(mini);
        fs.writeFileSync(path.join(out, mode + '-mini.png'), (await mini.webContents.capturePage()).toPNG());
        if (internal) { key(mini); await wait(150); assert.equal(mini.isDestroyed(), false); }
        if (mode === 'windowed') mini.maximize();
        else if (mode === 'borderless') key(mini, internal ? 'Escape' : 'Enter');
        else mini.close();
        await restored();
        assert.deepEqual(win.displaySettings.get(), state);
        assert.deepEqual(win.getBounds(), bounds);
        assert.equal(await page('!!document.fullscreenElement'), mode === 'fullscreen');
        report.modes.push({ mode, stage, before, after, miniPosition: previousPosition, restoredBounds: win.getBounds() });
        console.log('[mini]', report.edition, mode, 'PASS');
      }
      await win.displaySettings.setMode('windowed');
      win.miniMonitor.dispose();
      win.miniMonitor = require('../../electron/mini-window.cjs').create({
        owner: win, BrowserWindow, screen: require('electron').screen,
        positionFile: path.join(app.getPath('userData'), 'mini-window-position.json')
      });
      const reloaded = await open(false);
      assert.deepEqual(reloaded.getPosition(), previousPosition, '重建原生控制器後讀回磁碟位置');
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'mini-window-position.json'), 'utf8')),
        { x: previousPosition[0], y: previousPosition[1] });
      report.positionReloaded = true;
      win.miniMonitor.restore(); await restored();
      const first = await open(false);
      await page('openMiniWindow();openMiniWindow()');
      assert.equal(miniWindow(), first);
      win.miniMonitor.restore(); await restored();
      await page('WorkerBridge.saveAutoNow()');
      assert.deepEqual(report.errors, []);
      report.passed = true;
    } catch (error) {
      report.passed = false; report.error = error.stack; console.error(error);
      if (win && !win.isDestroyed()) {
        report.diagnostic = await page("({body:document.body.className,loading:document.getElementById('loading-screen').className,worker:typeof WorkerBridge!=='undefined'?WorkerBridge.status():null,focus:document.hasFocus(),menu:StartMenu.isActive(),intro:IntroPlayer.isPlaying(),hidden:GameVisibility.isHidden(),paused:GameClock.isPaused(),renderer:BattleRenderer.status(),dirty:UI.dirty,panels:Object.keys(UI_WORKER_STATE.panels)})").catch(() => null);
        const failureImage = await Promise.race([win.webContents.capturePage(), wait(2000).then(() => null)]);
        if (failureImage) fs.writeFileSync(path.join(out, 'failure.png'), failureImage.toPNG());
      }
    }
    finally {
      clearTimeout(deadline);
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      if (other && !other.isDestroyed()) other.destroy();
      if (win && !win.isDestroyed()) win.destroy();
      app.exit(report.passed ? 0 : 1);
    }
  });
}
