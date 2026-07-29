'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const bridgeSrc = fs.readFileSync(path.join(root, 'js/bridge.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const protocolSrc = fs.readFileSync(path.join(root, 'js/worker/protocol.js'), 'utf8');

/* 指令的 Promise 在 Worker 回 ACK 時就 resolve，但那時檔案還沒寫進磁碟——Worker 只是
   序列化完並發出 persist 訊息，落地在主執行緒非同步進行。

   實際症狀：按下「立即存檔」後，存檔資料夾清單掃到的是還沒有新檔案的資料夾，玩家要自己
   再按一次「重新掃描」才看得到，會誤以為存檔失敗。 */

function loadBridge() {
  const writes = [];
  const posted = [];
  let worker = null;
  const context = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    Promise, Date, setTimeout, clearTimeout, Object, JSON, Error,
    setInterval: () => 1,
    clearInterval() {},
    performance: { now: () => 0 },
    location: { search: '', href: 'http://localhost/' },
    document: { hidden: false, addEventListener() {} },
    TabLock: { onGranted() {} },
    SaveStorage: {
      // 刻意不呼叫 done：由測試決定何時「寫完」
      persist(kind, json, meta, done) { writes.push({ kind, done }); },
      readBootSave() {},
      maxRunId: () => 1
    },
    Worker: function () {
      this.postMessage = (m) => posted.push(m);
      this.terminate = () => {};
      worker = this;
    }
  };
  vm.createContext(context);
  vm.runInContext(protocolSrc, context, { filename: 'js/worker/protocol.js' });
  vm.runInContext(bridgeSrc, context, { filename: 'js/bridge.js' });

  context.WorkerBridge.start({ save: null, maxRunId: 1 });
  worker.onmessage({
    data: { type: context.MSG_OUT.BOOTED, protocolVersion: context.WORKER_PROTOCOL_VERSION }
  });

  const sendPersist = (kind) => worker.onmessage({
    data: { type: context.MSG_OUT.PERSIST, token: 'p' + writes.length, kind: kind || 'manualFolder',
            payload: { json: '{}', meta: {} } }
  });
  return { context, writes, worker, sendPersist };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('沒有待寫入時立即回呼', async () => {
  const env = loadBridge();
  let called = null;
  env.context.WorkerBridge.whenWritesDrained((err) => { called = { err }; });
  assert.notEqual(called, null, '沒有東西要等就不該延後');
  assert.equal(called.err, null);
});

test('有待寫入時必須等它真的落地才回呼', async () => {
  const env = loadBridge();
  env.sendPersist('manualFolder');
  assert.equal(env.writes.length, 1, '前提：persist 已進入落地佇列');

  let called = null;
  env.context.WorkerBridge.whenWritesDrained((err) => { called = { err }; });

  await sleep(150);
  assert.equal(called, null,
    '寫入還沒完成就回呼，畫面會刷新到一個還沒有新檔案的資料夾——這正是原本的 bug');

  env.writes[0].done(null);          // 落地完成
  await sleep(150);
  assert.notEqual(called, null, '落地後必須回呼，否則畫面永遠不會刷新');
  assert.equal(called.err, null);
});

test('多筆寫入要全部落地才回呼', async () => {
  const env = loadBridge();
  env.sendPersist('manualFolder');
  env.sendPersist('auto');

  let called = null;
  env.context.WorkerBridge.whenWritesDrained((err) => { called = { err }; });

  env.writes[0].done(null);
  await sleep(150);
  assert.equal(called, null, '只完成一筆時不該放行');

  env.writes[1].done(null);
  await sleep(150);
  assert.notEqual(called, null);
});

test('逾時仍然回呼並帶錯誤，不得讓畫面卡在等待狀態', async () => {
  const env = loadBridge();
  env.sendPersist('manualFolder');       // 永遠不呼叫 done

  let called = null;
  env.context.WorkerBridge.whenWritesDrained((err) => { called = { err }; }, 120);

  await sleep(400);
  assert.notEqual(called, null, '永遠不回呼會讓畫面卡住，比晚一點刷新更糟');
  assert.ok(called.err instanceof Error);
});

test('接線：存檔完成後的清單刷新走 whenWritesDrained', () => {
  const start = uiSrc.indexOf("$id('btn-save')");
  assert.notEqual(start, -1, '找不到立即存檔按鈕的處理');
  const handler = uiSrc.slice(start, start + 1600);
  assert.match(handler, /WorkerBridge\.whenWritesDrained\(function \(drainErr\)[\s\S]*?renderSaveList\(\);[\s\S]*?refreshSaveFolderFilesV2\(\);/,
    '兩個刷新都必須在寫入落地之後才做，否則掃到的資料夾還沒有新檔案');
});
