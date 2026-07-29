'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workerSrc = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
const saveSrc = fs.readFileSync(path.join(root, 'js/save.js'), 'utf8');

/* 手動存檔的檔名必須通過存檔資料夾的掃描規則，否則檔案寫進去了卻永遠不會出現在
   「存檔記錄」清單裡——玩家會以為存檔失敗，實際上檔案好端端躺在資料夾。

   實際發生過：ui.js 的「立即存檔」把**存檔資料夾的名稱**當標籤傳進來，舊版直接拿標籤
   當檔名前綴，於是資料夾叫 Saves 的玩家產生 `IC_Saves_<時間戳>.json`，全部掃不到。

   所以這裡刻意**從 save.js 原始碼取出真正的掃描規則**來驗，而不是在測試裡自己抄一份
   ——抄一份的話，兩邊哪天走岔了測試還是綠的。 */
function folderScanPattern() {
  const m = saveSrc.match(/!(\/\^IC_\([^)]*\)[^/]*\/i)\.test\(ent\.name\)/);
  assert.ok(m, '找不到 scanManualMetadataV2 的檔名掃描規則，save.js 可能改過了');
  const body = m[1].replace(/^\//, '').replace(/\/i$/, '');
  return new RegExp(body, 'i');
}

const SCAN = folderScanPattern();

function loadStorageGuards() {
  const persists = [];
  const context = {
    console,
    location: { search: '' },
    performance: { now: () => 0 },
    importScripts() {},
    self: {},
    setInterval() { return 1; },
    clearInterval() {},
    Date: { now: () => 1785300000000 },
    PERSIST_KINDS: { AUTO: 'auto', FOLDER: 'folder', MANUAL: 'manual', MANUAL_FOLDER: 'manualFolder', RESTART: 'restart' }
  };
  vm.createContext(context);
  vm.runInContext(workerSrc, context, { filename: 'js/worker/sim.worker.js' });

  /* 替身一律在載入之後才設：requestPersist 是 sim.worker.js 自己宣告的函式，
     載入時會把預先放進 context 的同名替身覆蓋掉。
     只保留與檔名有關的真實邏輯（buildManualMeta），其餘給最小替身。 */
  context.reportError = (where, err) => { throw err; };
  context.saveRecMeta = (kind, id, fname) => ({ kind, id, fname });
  context.saveStamp = () => '20260729_150930';
  context.ri = () => 123;
  context.requestPersist = (kind, opts) => {
    persists.push([kind, opts && opts.meta && opts.meta.fname]);
  };
  context.installStorageGuards();
  return { context, persists };
}

test('「存到資料夾」的檔名通過資料夾掃描規則（標籤為資料夾名時）', () => {
  const env = loadStorageGuards();
  const meta = env.context.self.createManualSaveToFolderV2('Saves');

  assert.match(meta.fname, /^IC_manual_/, '檔名必須以 IC_manual_ 開頭，否則掃描時會被整個跳過');
  assert.ok(SCAN.test(meta.fname),
    `檔名 ${meta.fname} 不符合 save.js 的掃描規則，存進去也不會出現在存檔記錄裡`);
  assert.ok(meta.fname.indexOf('Saves') >= 0, '標籤資訊仍應保留在檔名裡');
});

test('沒有標籤時同樣通過掃描規則', () => {
  const env = loadStorageGuards();
  const meta = env.context.self.manualSave();
  assert.ok(SCAN.test(meta.fname), `檔名 ${meta.fname} 不符合掃描規則`);
});

test('標籤含中文或符號時不得產生掃不到的檔名', () => {
  const env = loadStorageGuards();
  for (const label of ['存檔', '我的 存檔!!', '  ', '../etc']) {
    const meta = env.context.self.createManualSaveToFolderV2(label);
    assert.ok(SCAN.test(meta.fname), `標籤「${label}」產生的 ${meta.fname} 掃不到`);
    assert.doesNotMatch(meta.fname, /[\\/]/, '標籤不得把路徑分隔字元帶進檔名');
  }
});

test('舊版那種以標籤直接當前綴的檔名確實掃不到——這就是當初的 bug', () => {
  assert.equal(SCAN.test('IC_Saves_20260729_150930.json'), false,
    '若這條變成 true，代表掃描規則被放寬了，本測試的前提要重新檢視');
  assert.equal(SCAN.test('IC_manual_Saves_20260729_150930.json'), true);
});

test('存到資料夾與一般手動存檔都會實際送出落地請求', () => {
  const env = loadStorageGuards();
  env.context.self.createManualSaveToFolderV2('Saves');
  env.context.self.manualSave('x');
  assert.deepEqual(env.persists.map((p) => p[0]), ['manualFolder', 'manual']);
  env.persists.forEach(([, fname]) => assert.ok(SCAN.test(fname), fname + ' 掃不到'));
});
