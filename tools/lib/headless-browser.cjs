'use strict';
// AI／工具開無畫面瀏覽器的唯一入口（規範見 AI_RULES.md 第 18 節）。
// 保證瀏覽器會被關掉：正常結束 → close()／process exit；node 被砍、finally 沒跑 → 看門狗；超過時限 → 看門狗。
//
//   const { launchHeadless } = require('../lib/headless-browser.cjs');
//   const browser = await launchHeadless({ prefix: 'idle-shot-', args: ['--window-size=1280,720'] });
//   const page = await browser.waitForPage();      // { webSocketDebuggerUrl, ... }
//   ...
//   await browser.close();
//
// 選項：exe（預設 CHROME_EXE → Edge → Chrome）、prefix（暫存設定檔資料夾前綴）、args（附加參數）、
//       port（除錯埠，預設 0＝自動）、maxLifetimeMs（預設 30 分鐘，或環境變數 IDLE_TEST_BROWSER_MAX_MIN）。
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MARKER, killTree, killByProfileDir } = require('./test-browser-kill.cjs');

const DEFAULT_LIFETIME_MIN = 30;
const BROWSER_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowserExe(candidates = BROWSER_CANDIDATES) {
  if (process.env.CHROME_EXE && fs.existsSync(process.env.CHROME_EXE)) return process.env.CHROME_EXE;
  return candidates.find(p => fs.existsSync(p)) || null;
}

const live = new Set();
let exitHooked = false;
function hookProcessExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on('exit', () => { for (const b of live) b.kill(); });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    process.on(sig, () => {
      for (const b of live) b.kill();
      if (process.listenerCount(sig) <= 1) process.exit(128);
    });
  }
}

async function launchHeadless(opts = {}) {
  const exe = opts.exe || findBrowserExe();
  if (!exe) throw new Error('找不到 Edge／Chrome，可用環境變數 CHROME_EXE 指定');
  const prefix = opts.prefix || 'idle-test-browser-';
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const lifetimeMin = Number(process.env.IDLE_TEST_BROWSER_MAX_MIN) || DEFAULT_LIFETIME_MIN;
  const maxLifetimeMs = opts.maxLifetimeMs || lifetimeMin * 60000;
  const requestedPort = opts.port || 0;

  const args = [
    '--headless=new', MARKER, `--user-data-dir=${profileDir}`, `--remote-debugging-port=${requestedPort}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--disable-background-networking', '--disable-sync', '--disable-component-update',
    // Edge 預設會自己重開一份再退出，手上的 PID 就不是真正的瀏覽器
    '--edge-skip-compat-layer-relaunch',
    ...(opts.args || []),
  ];
  if (!args.some(a => !a.startsWith('--'))) args.push('about:blank');

  const proc = cp.spawn(exe, args, { stdio: 'ignore', windowsHide: true });
  const watchdog = cp.spawn(process.execPath, [path.join(__dirname, 'headless-watchdog.cjs'), String(process.pid), profileDir, String(Date.now() + maxLifetimeMs)], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  watchdog.unref();

  let closed = false;
  const browser = {
    proc, profileDir, exe, port: requestedPort || null,
    // 同步關閉：可放在 process.exit 前、錯誤處理裡，不必 await。
    kill() {
      if (closed) return;
      closed = true;
      live.delete(browser);
      if (proc.exitCode === null && proc.signalCode === null) killTree(proc.pid);
    },
    async close() {
      browser.kill();
      // Edge 更新後重啟的那份 PID 不同，用設定檔資料夾再掃一次
      try { killByProfileDir(profileDir); } catch (_) {}
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(profileDir, { recursive: true, force: true }); break; } catch (_) { await sleep(300); }
      }
    },
    async devtoolsPort(timeoutMs = 15000) {
      if (browser.port) return browser.port;
      const file = path.join(profileDir, 'DevToolsActivePort');
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if (proc.exitCode !== null && proc.exitCode !== 0) throw new Error(`瀏覽器啟動後立即結束（exit ${proc.exitCode}）`);
        try {
          const port = Number(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]);
          if (port > 0) { browser.port = port; return port; }
        } catch (_) {}
        await sleep(100);
      }
      throw new Error('等不到瀏覽器的除錯埠');
    },
    async targets() {
      const port = await browser.devtoolsPort();
      return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    },
    async waitForPage(timeoutMs = 15000) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        try {
          const page = (await browser.targets()).find(t => t.type === 'page');
          if (page) return page;
        } catch (_) {}
        await sleep(200);
      }
      throw new Error('等不到瀏覽器分頁');
    },
  };
  live.add(browser);
  hookProcessExit();
  proc.once('exit', () => live.delete(browser));
  return browser;
}

module.exports = { launchHeadless, findBrowserExe, BROWSER_CANDIDATES };
