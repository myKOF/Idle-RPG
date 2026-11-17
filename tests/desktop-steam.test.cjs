'use strict';
/* 桌面版 Steam（任務 D）：electron/steam.cjs 的容錯與成就、js/desktop-steam.js 的轉發。
   真正的 Steam 連線要 Steam 用戶端在跑，這裡用假的 steamworks.js 測邏輯；實機驗證見 docs/steam。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Steam = require('../electron/steam.cjs');

const root = path.resolve(__dirname, '..');

function fakeLib(opts = {}) {
  const calls = { init: 0, restart: 0, overlay: 0, activate: [], store: 0 };
  const unlocked = new Set(opts.already || []);
  return {
    calls,
    lib: {
      restartAppIfNecessary() { calls.restart++; return !!opts.restart; },
      init(appId) {
        calls.init++;
        calls.appId = appId;
        if (opts.initThrows) throw new Error('Steam is not running');
        return {
          achievement: {
            isActivated: (n) => unlocked.has(n),
            activate: (n) => { calls.activate.push(n); if ((opts.missing || []).includes(n)) return false; unlocked.add(n); return true; }
          },
          stats: { store: () => { calls.store++; return true; } }
        };
      },
      electronEnableSteamOverlay() { calls.overlay++; }
    }
  };
}

test('AppID：命令列優先；設定檔的正式 AppID 只在打包版、非開發／冒煙時才擋直接啟動', () => {
  assert.deepEqual(Steam.resolveAppId({ cliAppId: 480, configAppId: 123, isPackaged: true }), { appId: 480, source: 'cli', guardLaunch: false });
  assert.equal(Steam.resolveAppId({ configAppId: 123, isPackaged: true }).guardLaunch, true);
  assert.equal(Steam.resolveAppId({ configAppId: 123, isPackaged: false }).guardLaunch, false);
  assert.equal(Steam.resolveAppId({ configAppId: 123, isPackaged: true, dev: true }).guardLaunch, false);
  assert.equal(Steam.resolveAppId({ configAppId: 123, isPackaged: true, smoke: true }).guardLaunch, false);
  assert.deepEqual(Steam.resolveAppId({}), { appId: 0, source: 'none', guardLaunch: false });
});

test('提交的 steam-config.json 不能是測試用的 480（會讓正式版變成 Spacewar）', () => {
  const cfg = Steam.readConfig(path.join(root, 'electron'));
  assert.equal(cfg.error, undefined);
  assert.notEqual(cfg.appId, 480);
});

test('沒設定 AppID：完全不載入 steamworks.js，成就呼叫是空操作', () => {
  let loaded = false;
  const s = Steam.create({ loadLib: () => { loaded = true; return fakeLib().lib; } });
  assert.equal(loaded, false);
  assert.equal(s.status().enabled, false);
  assert.deepEqual(s.activateAchievements(['ACH_001']).activated, []);
});

test('Steam 沒開（init 失敗）：只是關閉 Steam 功能，不丟例外、不開 Overlay', () => {
  const f = fakeLib({ initThrows: true });
  const s = Steam.create({ cliAppId: 480, loadLib: () => f.lib });
  assert.equal(s.status().enabled, false);
  assert.match(s.status().reason, /未連線/);
  assert.equal(f.calls.overlay, 0);
  assert.equal(s.shouldQuitForRestart(), false);
});

test('steamworks.js 載入失敗（例如 dll 缺檔）：一樣只是關閉 Steam 功能', () => {
  const s = Steam.create({ cliAppId: 480, loadLib: () => { throw new Error('Cannot find module'); } });
  assert.equal(s.status().enabled, false);
  assert.match(s.status().reason, /載入 steamworks\.js 失敗/);
});

test('不是從 Steam 啟動：restartAppIfNecessary 為真時要求結束，且不初始化 Steam', () => {
  const f = fakeLib({ restart: true });
  const s = Steam.create({ configAppId: 123, isPackaged: true, loadLib: () => f.lib });
  assert.equal(s.shouldQuitForRestart(), true);
  assert.equal(f.calls.init, 0);
});

test('連線成功：開 Overlay（可用參數關掉）', () => {
  const f = fakeLib();
  const s = Steam.create({ cliAppId: 480, loadLib: () => f.lib });
  assert.equal(s.status().enabled, true);
  assert.equal(f.calls.appId, 480);
  assert.equal(f.calls.overlay, 1);
  const g = fakeLib();
  Steam.create({ cliAppId: 480, overlay: false, loadLib: () => g.lib });
  assert.equal(g.calls.overlay, 0);
});

test('成就：只送 ACH_### 名稱、已達成的跳過、後台沒有的記為失敗、整批只 store 一次', () => {
  const f = fakeLib({ already: ['ACH_002'], missing: ['ACH_099'] });
  const s = Steam.create({ cliAppId: 480, loadLib: () => f.lib });
  const r = s.activateAchievements(['ACH_001', 'ACH_002', 'ACH_001', 'ACH_099', 'evil', '../x', 7]);
  assert.deepEqual(r.activated, ['ACH_001']);
  assert.deepEqual(r.already, ['ACH_002']);
  assert.deepEqual(r.failed, ['ACH_099']);
  assert.deepEqual(f.calls.activate, ['ACH_001', 'ACH_099']);
  assert.equal(f.calls.store, 1);
});

test('成就編號 → API 名稱：三位數補零，所有成就表的編號都對應到不重複的名稱', () => {
  assert.equal(Steam.apiNameFor(1), 'ACH_001');
  assert.equal(Steam.apiNameFor(115), 'ACH_115');
  assert.equal(Steam.apiNameFor(0), null);
  assert.equal(Steam.apiNameFor('x'), null);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'achievement_data.js'), 'utf8'), ctx);
  const names = vm.runInContext('ACHIEVEMENTS', ctx).map((a) => Steam.apiNameFor(a.id));
  assert.ok(names.length > 0);
  assert.ok(names.every((n) => /^ACH_\d{3}$/.test(n)), '成就編號超過 999 時要改規則（Steamworks 後台名稱也要跟著改）');
  assert.equal(new Set(names).size, names.length);
});

/* ---- 遊戲端：js/desktop-steam.js ---- */

function loadDesktopSteam(host) {
  const ctx = { console, Promise };
  ctx.window = ctx;
  if (host) ctx.ApexHost = { steam: host };
  vm.createContext(ctx);
  vm.runInContext('var ACHIEVEMENTS = [{ id: 1 }, { id: 2 }, { id: 115 }];', ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'desktop-steam.js'), 'utf8'), ctx);
  return ctx.DesktopSteam;
}

test('網頁版沒有 ApexHost.steam：DesktopSteam 是空操作', async () => {
  const d = loadDesktopSteam(null);
  assert.equal(d.enabled, false);
  assert.equal(await d.onUnlocked({ id: 1 }), null);
  assert.equal(await d.syncFromSave({ achv: { got: { 1: 123 } } }), null);
});

test('轉發：即時解鎖與開機補發都換成 ACH_###，只送成就表裡有的編號', async () => {
  const sent = [];
  const d = loadDesktopSteam({ activateAchievements: (names) => { sent.push(names); return Promise.resolve({}); } });
  assert.equal(d.enabled, true);
  await d.onUnlocked({ id: 2 });
  await d.syncFromSave({ achv: { got: { 1: 111, 115: 222, 999: 333, 2: 0 } } });
  await d.syncFromSave(null);
  // vm 裡建立的陣列原型不同，用 JSON 比內容
  assert.equal(JSON.stringify(sent), JSON.stringify([['ACH_002'], ['ACH_001', 'ACH_115']]));
});

test('轉發失敗不影響遊戲（不丟例外）', async () => {
  const d = loadDesktopSteam({ activateAchievements: () => Promise.reject(new Error('IPC 掛了')) });
  const origWarn = console.warn;
  console.warn = () => {};
  try { assert.equal(await d.onUnlocked({ id: 1 }), null); } finally { console.warn = origWarn; }
});

test('接線：ui.js 的成就通知與 main.js 的 enterGame 都會呼叫 DesktopSteam；desktop-steam.js 在 main.js 之前載入', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(ui, /achievementUnlocked[\s\S]{0,300}DesktopSteam\.onUnlocked\(event\.data\)/);
  assert.match(main, /function enterGame[\s\S]{0,600}DesktopSteam\.syncFromSave\(save\)/);
  assert.ok(html.indexOf('js/desktop-steam.js') > 0 && html.indexOf('js/desktop-steam.js') < html.indexOf('js/main.js'));
});
