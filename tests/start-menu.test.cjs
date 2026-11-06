const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/start-menu.js'), 'utf8');
const flush = () => new Promise(setImmediate);

function setup({ save = null, info = {}, records = [], files = [] } = {}) {
  const nodes = new Map();
  const launches = [];
  let confirm, introDone;
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
    document: { getElementById: node },
    IntroPlayer: { startupBegin: () => true, release() {}, whenIdle(fn) { introDone = fn; } },
    WorkerBridge: { isDeterministicTest: () => false },
    SaveStorage: { readBootSave(cb) { cb(nextSave, info); }, maxRunId: () => 3 },
    SaveOrigin: { gate(snapshot, details, cb) { state.gated = snapshot; cb(snapshot); } },
    GameMenu: {
      openSettings(tab) { state.settings = tab || 'game'; },
      openAchievements(got) { state.got = got; }
    },
    showConfirmDialog(message, accept) { confirm = accept; },
    hideLoadingScreen() { state.loadingHidden = true; },
    location: { reload() { state.reloads++; } },
    listSaveFolderFilesV2: () => Promise.resolve(files),
    saveIndexV2: () => records,
    AUTO_FOLDER_FILE_V2: 'IC_autosave_test.json',
    readFolderAutoFileV2: name => Promise.resolve(files.find(file => file.name === name)),
    readSaveRawV2: rec => Promise.resolve(rec.raw),
    parseSaveTextV2: raw => JSON.parse(raw)
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  ctx.StartMenu.init((snapshot, runId) => { launches.push({ snapshot, runId }); return true; });
  return {
    state, launches, menu: ctx.StartMenu, node,
    finishIntro: () => introDone(),
    click: name => node('start-menu-' + name).click(),
    confirm: () => confirm(),
    updateAuto(snapshot) { nextSave = snapshot; }
  };
}

test('動畫播完才顯示選單，空白存檔以新遊戲為首並停用載入', async () => {
  const e = setup();
  assert.equal(e.node('start-menu').style.display, 'none');
  assert.deepEqual(e.launches, []);
  e.finishIntro();
  await flush();
  assert.equal(e.node('start-menu').style.display, 'flex');
  assert.equal(e.node('start-menu-continue').hidden, true);
  assert.equal(e.node('start-menu-load').disabled, true);
  assert.equal(e.state.focus, 'start-menu-new');
  e.click('settings');
  assert.equal(e.state.settings, 'game');
  e.menu.show();
  e.click('new');
  assert.deepEqual(e.launches, [{ snapshot: null, runId: 3 }]);
  assert.equal(e.menu.isActive(), false);
});

test('繼續遊戲在點擊時再查最新自動存檔並經來源關卡', () => {
  const old = { runId: 2 }, latest = { runId: 3 };
  const e = setup({ save: old });
  e.finishIntro();
  assert.equal(e.node('start-menu-continue').hidden, false);
  e.updateAuto(latest);
  e.click('continue');
  assert.equal(e.state.gated, latest);
  assert.equal(e.launches[0].snapshot, latest);
});

test('已有自動存檔時，新遊戲確認後才啟動，並使用新局號', () => {
  const e = setup({ save: { runId: 5 } });
  e.finishIntro();
  e.click('new');
  assert.deepEqual(e.launches, []);
  e.confirm();
  assert.deepEqual(e.launches, [{ snapshot: null, runId: 6 }]);
});

test('只有手動存檔時可開啟存檔分頁，確認所選檔案後直接進入遊戲', async () => {
  const rec = { folderOnly: true, fname: 'IC_manual_1.json', kind: 'manual', raw: '{"runId":2}' };
  const e = setup({ records: [rec], files: [{ name: rec.fname }] });
  e.finishIntro();
  await flush();
  assert.equal(e.node('start-menu-load').disabled, false);
  assert.equal(e.node('start-menu-continue').hidden, true);
  e.click('load');
  assert.equal(e.state.settings, 'save');
  assert.deepEqual(e.launches, []);
  await e.menu.loadRecord(rec);
  assert.equal(e.launches[0].snapshot.runId, 2);
});

test('成就讀取存檔的紀錄，模式與離開不啟動模擬', () => {
  const got = { first: 123 };
  const e = setup({ save: { achv: { got } } });
  e.finishIntro();
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

test('載入設定列表中的自動檔時，使用玩家選定的資料夾檔案', async () => {
  const rec = { kind: 'auto', fname: 'IC_autosave_test.json' };
  const folderSnapshot = { runId: 2 };
  const e = setup({
    save: { runId: 3 },
    info: { folderAuto: rec },
    files: [{ name: rec.fname, data: folderSnapshot }]
  });
  e.finishIntro();
  await flush();
  assert.equal(e.node('start-menu-load').disabled, false);
  await e.menu.loadRecord(e.menu.autoRecord());
  assert.equal(e.launches[0].snapshot, folderSnapshot);
});
