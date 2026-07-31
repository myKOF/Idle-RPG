/* headless 模擬器與遊戲本體的同步哨兵。

   模擬器（scripts/sim/engine.js）自己驅動遊戲迴圈，所以它必須跑齊 loop() 裡
   那些「不在 simStep 內、但會改變遊戲狀態」的維護函式。少跑一支不會報錯，
   只會讓那個系統在模擬裡整場不動——這種失真沒有任何徵兆，只能靠這支測試擋。

   同步的方向是「遊戲改了、模擬器沒跟上」，所以基準取自 js/worker/sim.worker.js
   的原始碼，不是取自模擬器自己的清單。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workerSrc = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
const { MAINTENANCE_FNS } = require('../scripts/sim/engine.js');

/* 從一段原始碼取出被呼叫的函式名。只認「識別字 + (」，
   夠用且不會誤抓字串或屬性存取（xxx.yyy() 的 yyy 會被抓到，但維護函式都是全域呼叫）。 */
function calledFunctions(src) {
  const out = new Set();
  const re = /(?:^|[^\w.$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

/* 取出 `function 名稱(...) { ... }` 的函式主體，以大括號配對找結尾。 */
function functionBody(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, `找不到 ${name}()——sim.worker.js 的結構變了，請同步更新本測試`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`${name}() 的大括號沒有配對成功`);
}

/* 取出以 marker 開頭那一段大括號區塊（例如 loop() 內的 5Hz 維護區塊）。 */
function blockAfter(src, marker) {
  const at = src.indexOf(marker);
  assert.notEqual(at, -1, `找不到區塊起點：${marker}——sim.worker.js 的結構變了，請同步更新本測試`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`區塊沒有配對成功：${marker}`);
}

/* ⚠️ 這裡刻意用**反向比對**（全部呼叫扣掉已知非維護者），不是白名單。
   白名單只認得清單上的名字，日後新增一支叫別的名字的維護函式會從縫隙溜過去——
   而那正是本測試存在的唯一理由。要新增例外，必須具名寫進 NOT_MAINTENANCE 並說明理由。 */
const NOT_MAINTENANCE = new Set([
  'simStep',        // 推進時間本身，不是維護
  'emitTick',       // 純 I/O：把快照送給主執行緒
  'reportError',    // 錯誤處理
  'requestPersist'  // 存檔落地，屬 I/O
]);

function maintenanceIn(block) {
  return [...calledFunctions(block)].filter((fn) => !NOT_MAINTENANCE.has(fn)).sort();
}

test('模擬器跑齊 loop() 的所有維護函式（新增維護函式時本測試會擋下）', () => {
  const maintenanceInLoop = maintenanceIn(blockAfter(workerSrc, 'if (now - _lastEmitAt >= TICK_EMIT_MS)'));

  assert.deepEqual(
    maintenanceInLoop.slice().sort(),
    MAINTENANCE_FNS.slice().sort(),
    '\nloop() 呼叫的維護函式與 scripts/sim/engine.js 的 MAINTENANCE_FNS 不一致。' +
    '\n若 loop() 新增了維護函式，請一併加進 MAINTENANCE_FNS——' +
    '\n沒加的話 headless 模擬會整場不跑那一支，而且不會有任何錯誤訊息。' +
    `\nloop() 內：${maintenanceInLoop.join(', ')}` +
    `\nMAINTENANCE_FNS：${MAINTENANCE_FNS.join(', ')}`
  );
});

test('決定論測試模式與正式迴圈跑同一組維護函式', () => {
  const a = maintenanceIn(blockAfter(workerSrc, 'if (now - _lastEmitAt >= TICK_EMIT_MS)'));
  const b = maintenanceIn(blockAfter(workerSrc, 'if (_detSteps % Math.round(TICK_EMIT_MS / TICK_MS)'));

  assert.deepEqual(b, a,
    '\ndeterministicLoop() 與 loop() 的維護區塊不一致。' +
    '\n兩者不同就代表「?seed=N 開出來的遊戲」與「玩家實際玩的遊戲」不是同一個，' +
    '\n瀏覽器交叉驗證的結論會失去意義。');
});

test('MAINTENANCE_FNS 列的每一支在遊戲裡都真的存在', () => {
  for (const fn of MAINTENANCE_FNS) {
    assert.ok(
      new RegExp('function\\s+' + fn + '\\s*\\(').test(workerSrc),
      `MAINTENANCE_FNS 列了 ${fn}()，但 sim.worker.js 裡沒有這支函式（改名了？）`
    );
  }
});
