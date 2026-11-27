const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/start-menu.js'), 'utf8');
const stringData = fs.readFileSync(require.resolve('../js/strings_data.js'), 'utf8');
const strings = fs.readFileSync(require.resolve('../js/strings.js'), 'utf8');
const flush = () => new Promise(setImmediate);

function setup({ save = null, info = {}, records = [], files = [], background, deferBoot = false, host, introPlayback } = {}) {
  const nodes = new Map();
  const launches = [], timers = [];
  const audio = [];
  let confirm, finishBoot;
  let nextSave = save;
  const state = { reloads: 0 };
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      disabled: id === 'start-menu-load',
      style: { display: 'none' },
      setAttribute() {},
      addEventListener(event, fn) { this[event] = fn; },
      focus() { state.focus = id; }
    });
    return nodes.get(id);
  }
  const ctx = {
    setTimeout(fn, ms) { const timer = { fn, ms, cancelled: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cancelled = true; },
    document: { getElementById: node },
    IntroPlayer: { play: introPlayback },
    INTRO_REPLAY_TIMELINE: introPlayback && { video: 'opening_animation/shots-01-05-replay.mp4' },
    UISound: {
      preloadStartMenuAudio() { audio.push('preload'); },
      setStartScreenActive(value) { audio.push(value); },
      setStartMenuVisible() {}
    },
    StartMenuBackground: background && { mount: () => ({ ready: background, destroy() {} }) },
    WorkerBridge: { isDeterministicTest: () => false },
    SaveStorage: {
      readBootSave(cb, boot) {
        if (boot && deferBoot) finishBoot = () => cb(nextSave, info);
        else cb(nextSave, info);
      },
      maxRunId: () => 3
    },
    SaveOrigin: { gate(snapshot, details, cb) { state.gated = snapshot; cb(snapshot); } },
    GameMenu: {
      openSettings(tab) { state.settings = tab || 'game'; },
      openAchievements(got) { state.got = got; }
    },
    showConfirmDialog(message, accept, options) {
      state.confirmDialog = { message, ...options };
      confirm = accept;
    },
    showLoadingScreen() { state.loadingHidden = false; },
    hideLoadingScreen() { state.loadingHidden = true; },
    location: { reload() { state.reloads++; } },
    listSaveFolderFilesV2: () => Promise.resolve(files),
    saveIndexV2: () => records,
    AUTO_FOLDER_FILE_V2: 'IC_autosave_test.json',
    readFolderAutoFileV2: name => Promise.resolve(files.find(file => file.name === name)),
    readSaveRawV2: rec => Promise.resolve(rec.raw),
    parseSaveTextV2: raw => JSON.parse(raw)
  };
  if (host) ctx.ApexHost = host;
  vm.createContext(ctx);
  vm.runInContext(stringData, ctx);
  vm.runInContext(strings, ctx);
  vm.runInContext(source, ctx);
  ctx.StartMenu.init((snapshot, runId) => { launches.push({ snapshot, runId }); return true; });
  return {
    state, launches, audio, menu: ctx.StartMenu, node,
    finishBoot,
    click: name => node('start-menu-' + name).click(),
    confirm: () => confirm(),
    updateAuto(snapshot) { nextSave = snapshot; },
    timers
  };
}

test('新玩家先完成存檔檢查，背景在等待上限內就緒則正常揭幕', async () => {
  let finishBackground;
  const background = new Promise(resolve => { finishBackground = resolve; });
  const e = setup({ background, deferBoot: true });
  assert.equal(e.node('start-menu').style.display, 'none');
  assert.equal(e.state.loadingHidden, false);
  assert.deepEqual(e.audio, ['preload']);
  e.finishBoot();
  await flush();
  assert.equal(e.node('start-menu').style.display, 'none');
  assert.equal(e.state.loadingHidden, false);
  assert.deepEqual(e.launches, []);
  finishBackground(true);
  await flush();
  assert.equal(e.timers[0].cancelled, true);
  assert.equal(e.state.introStarted, undefined);
  assert.equal(e.state.loadingHidden, true);
  assert.equal(e.node('start-menu').style.display, 'flex');
  assert.equal(e.node('start-menu-continue').hidden, true);
  assert.equal(e.node('start-menu-load').disabled, true);
  assert.equal(e.state.focus, 'start-menu-new');
  assert.deepEqual(e.audio, ['preload', true]);
  e.click('settings');
  assert.equal(e.state.settings, 'game');
  e.menu.show();
  e.click('achv');
  e.menu.show();
  assert.deepEqual(e.audio, ['preload', true]);
  e.click('new');
  assert.deepEqual(e.launches, [{ snapshot: null, runId: 3 }]);
  assert.equal(e.menu.isActive(), false);
  assert.deepEqual(e.audio, ['preload', true, false]);
});

test('背景解碼無回覆時，一秒後可繼續遊戲，較晚就緒不會重開選單', async () => {
  let finishBackground;
  const background = new Promise(resolve => { finishBackground = resolve; });
  const save = { runId: 3 };
  const e = setup({ save, background });
  await flush();
  assert.equal(e.state.loadingHidden, false);
  assert.deepEqual(e.launches, []);
  assert.equal(e.timers[0].ms, 1000);
  e.timers[0].fn();
  assert.equal(e.state.loadingHidden, true);
  assert.equal(e.node('start-menu').style.display, 'flex');
  assert.equal(e.state.focus, 'start-menu-continue');
  assert.deepEqual(e.launches, [], '背景逾時只放行選單，不啟動模擬或存檔');
  e.click('continue');
  assert.equal(e.state.gated, save);
  assert.equal(e.launches.length, 1);
  assert.equal(e.menu.isActive(), false);
  finishBackground(true);
  await flush();
  assert.equal(e.node('start-menu').style.display, 'none');
  assert.equal(e.launches.length, 1);
  assert.deepEqual(e.audio, ['preload', true, false]);
});

test('背景等待上限不會跳過尚未完成的讀檔檢查', async () => {
  const e = setup({ save: { runId: 3 }, background: new Promise(() => {}), deferBoot: true });
  await flush();
  assert.equal(e.timers.length, 0, '讀檔完成前不開始背景揭幕倒數');
  assert.equal(e.state.loadingHidden, false);
  assert.equal(e.node('start-menu').style.display, 'none');
  assert.deepEqual(e.launches, []);
  e.finishBoot();
  e.timers[0].fn();
  assert.equal(e.state.loadingHidden, true);
  assert.equal(e.state.focus, 'start-menu-continue');
});

test('確認新遊戲後播放正式成片，結束或略過才建立一局', () => {
  let onDone;
  let playbackCount = 0;
  const e = setup({ save: { runId: 5 }, introPlayback(timeline, options) {
    playbackCount++;
    assert.match(timeline.video, /^opening_animation\//);
    assert.equal(options.waitForScene, true);
    onDone = options.onDone;
    return true;
  } });
  e.click('new');
  assert.equal(playbackCount, 0);
  e.confirm();
  assert.equal(playbackCount, 1);
  assert.equal(e.node('start-menu').style.display, 'none');
  assert.deepEqual(e.launches, []);
  e.click('new');
  assert.equal(playbackCount, 1);
  onDone('skip');
  onDone('end');
  assert.deepEqual(e.launches, [{ snapshot: null, runId: 6 }]);
});

test('背景載入失敗時仍顯示選單與繼續遊戲', async () => {
  let failBackground;
  const background = new Promise((_, reject) => { failBackground = reject; });
  const e = setup({ save: { runId: 3 }, background });
  failBackground(new Error('image decode failed'));
  await flush();
  assert.equal(e.node('start-menu').style.display, 'flex');
  assert.equal(e.state.loadingHidden, true);
  assert.equal(e.state.introStarted, undefined);
  assert.equal(e.state.focus, 'start-menu-continue');
  assert.deepEqual(e.launches, []);
});

test('遊戲內讀檔重載會直接接續，由遊戲首畫流程揭開 Loading', () => {
  const save = { runId: 2 };
  const e = setup({ save, info: { resume: true }, background: new Promise(() => {}) });
  assert.deepEqual(e.launches, [{ snapshot: save, runId: 3 }]);
  assert.equal(e.node('start-menu').style.display, 'none');
  assert.equal(e.state.loadingHidden, false);
  assert.equal(e.state.introStarted, undefined);
});

test('繼續遊戲在點擊時再查最新自動存檔並經來源關卡', () => {
  const old = { runId: 2 }, latest = { runId: 3 };
  const e = setup({ save: old });
  assert.equal(e.node('start-menu-continue').hidden, false);
  e.updateAuto(latest);
  e.click('continue');
  assert.equal(e.state.gated, latest);
  assert.equal(e.launches[0].snapshot, latest);
});

test('已有自動存檔時，新遊戲確認後才啟動，並使用新局號', () => {
  const e = setup({ save: { runId: 5 } });
  e.click('new');
  assert.match(e.state.confirmDialog.message, /取代目前的自動存檔/);
  assert.equal(e.state.confirmDialog.title, '新遊戲');
  assert.equal(e.state.confirmDialog.okText, '新遊戲');
  assert.equal(e.state.confirmDialog.danger, true);
  assert.deepEqual(e.launches, []);
  e.confirm();
  assert.deepEqual(e.launches, [{ snapshot: null, runId: 6 }]);
});

test('只有手動存檔時可開啟存檔分頁，確認所選檔案後直接進入遊戲', async () => {
  const rec = { folderOnly: true, fname: 'IC_manual_1.json', kind: 'manual', raw: '{"runId":2}' };
  const e = setup({ records: [rec], files: [{ name: rec.fname }] });
  await flush();
  assert.equal(e.node('start-menu-load').disabled, false);
  assert.equal(e.node('start-menu-continue').hidden, true);
  e.click('load');
  assert.equal(e.state.settings, 'save');
  assert.deepEqual(e.launches, []);
  assert.deepEqual(e.audio, ['preload', true]);
  await e.menu.loadRecord(rec);
  assert.equal(e.launches[0].snapshot.runId, 2);
  assert.deepEqual(e.audio, ['preload', true, false]);
});

test('成就讀取存檔的紀錄，模式與離開不啟動模擬', () => {
  const got = { first: 123 };
  const e = setup({ save: { achv: { got } } });
  e.click('achv');
  assert.equal(e.state.got, got);
  e.menu.show();
  e.click('mode');
  assert.equal(e.node('start-menu-modes').hidden, false);
  e.click('hard');
  assert.equal(e.node('start-menu-modes').hidden, true);
  e.click('exit');
  assert.equal(e.state.reloads, 1);
  assert.deepEqual(e.launches, []);
});

test('桌面版（electron/preload.cjs 的 ApexHost）按離開遊戲會關閉程式而不是重新整理', () => {
  let quits = 0;
  const e = setup({ host: { isDesktop: true, quit() { quits++; } } });
  e.click('exit');
  assert.equal(quits, 1);
  assert.equal(e.state.reloads, 0);
  assert.deepEqual(e.launches, []);
});

test('載入設定列表中的自動檔時，使用玩家選定的資料夾檔案', async () => {
  const rec = { kind: 'auto', fname: 'IC_autosave_test.json' };
  const folderSnapshot = { runId: 2 };
  const e = setup({
    save: { runId: 3 },
    info: { folderAuto: rec },
    files: [{ name: rec.fname, data: folderSnapshot }]
  });
  await flush();
  assert.equal(e.node('start-menu-load').disabled, false);
  await e.menu.loadRecord(e.menu.autoRecord());
  assert.equal(e.launches[0].snapshot, folderSnapshot);
});
