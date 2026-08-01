/* 真人軌跡重播管線的單元測試。

   這條管線的失敗方式全都是「安靜的」：漏一道指令、時間戳錯一步、gt 對不齊，
   重播照樣跑得完、照樣產出漂亮的曲線，只是那條曲線不是真人那一場。所以
   scripts/verify_trace.js 用整場逐點比對當總驗收，而這裡守住它下面的兩塊積木：

     scripts/sim/trace.js     軌跡什麼時候該送出哪些指令
     scripts/sim/viewdiff.js  兩串 view 一致與否的判定

   兩塊都是純函式，不需要開引擎，跑起來是毫秒級。 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTraceSource } = require('../scripts/sim/trace.js');
const { gtKey, compareByGt } = require('../scripts/sim/viewdiff.js');

function recording(trace, extra) {
  return Object.assign({
    format: 'idle-rpg-human-trace/1',
    meta: { seed: 777, recordedAt: '2026-08-01T00:00:00.000Z' },
    startSave: null,
    trace: trace,
    rows: []
  }, extra || {});
}

/* 目前的錄製器會同時寫 simT 與 gt。simT 是對齊軸，這裡讓兩者相同，
   方便在同一組測試裡切換軸來驗證退回行為。 */
function cmd(t, name, args) {
  return { simT: t, gt: t, name: name, args: args || {}, ok: true, gtExact: true, paused: false };
}

/* 協議 v14 之前的錄製檔：只有 gt，沒有 simT。 */
function legacyCmd(gt, name, args, paused) {
  return { gt: gt, name: name, args: args || {}, ok: true, paused: paused };
}

/* decide() 只讀對齊軸那個欄位，其餘欄位形狀與 run_sim.js 給的一致。
   view 同時給 simT 與 gt，模擬協議 v14 的遊戲。 */
function at(src, t) {
  return src.decide({ view: { simT: t, gt: t }, panels: {}, gameTimeSec: t });
}

test('格式不符直接擋下，不試著猜', () => {
  assert.throws(() => createTraceSource({ format: 'something-else', trace: [] }), /idle-rpg-human-trace/);
  assert.throws(() => createTraceSource(null), /idle-rpg-human-trace/);
});

test('對齊軸倒退的軌跡擋下——游標式重播會漏掉指令', () => {
  assert.throws(
    () => createTraceSource(recording([cmd(5.0, 'a'), cmd(3.0, 'b')])),
    /單調遞增/
  );
});

test('有 simT 就以 simT 對齊，暫停不再是限制', () => {
  /* 模擬一次暫停：gt 卡在 10.0 不動，simT 照走。以 gt 對齊會把三道指令壓成一步，
     以 simT 對齊則各自落在正確的步上。 */
  const paused = [
    { simT: 10.0, gt: 10.0, name: 'a', args: {}, ok: true, paused: true },
    { simT: 12.0, gt: 10.0, name: 'b', args: {}, ok: true, paused: true },
    { simT: 14.0, gt: 10.0, name: 'c', args: {}, ok: true, paused: false }
  ];
  const src = createTraceSource(recording(paused));
  assert.equal(src.report().axis, 'simT');
  assert.deepEqual(at(src, 10.0).map((c) => c.name), ['a']);
  assert.deepEqual(at(src, 12.0).map((c) => c.name), ['b']);
  assert.deepEqual(at(src, 14.0).map((c) => c.name), ['c']);
  /* 以 simT 看，這三道各自獨立，沒有任何共用刻度 */
  assert.equal(src.report().sharedGtCommands, 0);
  assert.equal(src.report().sharedGtWhilePaused, 0);
});

test('舊錄製檔（無 simT）退回 gt 對齊，並如實回報退回了', () => {
  const src = createTraceSource(recording([
    legacyCmd(10.0, 'a', {}, true), legacyCmd(10.0, 'b', {}, true)
  ]));
  assert.equal(src.report().axis, 'gt');
  /* 退回 gt 之後，暫停期間的壓縮風險必須照樣報出來 */
  assert.equal(src.report().sharedGtWhilePaused, 1);
});

test('只要有一筆缺 simT 就整批退回 gt，不混用兩套刻度', () => {
  /* 半數用 simT、半數用 gt 會產生假對齊，比退回去更糟。 */
  const src = createTraceSource(recording([cmd(1.0, 'a'), legacyCmd(2.0, 'b')]));
  assert.equal(src.report().axis, 'gt');
});

test('軌跡要 simT 但遊戲沒有 simT 時大聲失敗，不要靜靜什麼都不做', () => {
  /* 遊戲版本比錄製檔舊。不擋的話 decide() 永遠對不上任何指令，
     跑完會產出一份「真人什麼都沒操作」的曲線，而且沒有任何錯誤訊息。 */
  const src = createTraceSource(recording([cmd(1.0, 'a')]));
  assert.throws(
    () => src.decide({ view: { gt: 1.0 }, panels: {}, gameTimeSec: 1.0 }),
    /沒有 simT/
  );
});

test('指令在 gt 到達的那一步送出，早一步都不送', () => {
  const src = createTraceSource(recording([cmd(1.0, 'item.equip'), cmd(2.5, 'gem.socket')]));
  assert.deepEqual(at(src, 0.9), []);
  const a = at(src, 1.0);
  assert.equal(a.length, 1);
  assert.equal(a[0].name, 'item.equip');
  assert.deepEqual(at(src, 1.1), []);        // 已送出的不重送
  assert.deepEqual(at(src, 2.4), []);
  assert.equal(at(src, 2.5)[0].name, 'gem.socket');
});

test('落後的決策點會一次補送所有已到期的指令，且保持錄製順序', () => {
  const src = createTraceSource(recording([
    cmd(1.0, 'first'), cmd(1.5, 'second'), cmd(2.0, 'third')
  ]));
  const out = at(src, 2.0);
  assert.deepEqual(out.map((c) => c.name), ['first', 'second', 'third']);
});

test('同一個 gt 的多道指令一起送出，且保持錄製順序', () => {
  const src = createTraceSource(recording([cmd(4.0, 'a'), cmd(4.0, 'b'), cmd(4.0, 'c')]));
  assert.deepEqual(at(src, 4.0).map((c) => c.name), ['a', 'b', 'c']);
  assert.equal(src.report().sharedGtCommands, 2);
});

test('同一個 tick 內連送共用刻度，是描述性數字而非風險', () => {
  /* 一步 0.1 秒，人手連點兩下必定落在同一步。瀏覽器就是在同兩步之間依序執行的，
     重播也在同一步依序送出，完全重現。 */
  const sameTick = createTraceSource(recording([cmd(4.0, 'a'), cmd(4.0, 'b')]));
  assert.equal(sameTick.report().sharedGtCommands, 1);
  assert.equal(sameTick.report().sharedGtWhilePaused, 0);
});

test('舊錄製檔沒有 paused 欄位時，保守算進風險那一類', () => {
  /* 不假設「沒記錄＝安全」。舊檔應該被報成風險，讓人知道這份資料判斷不了。 */
  const old = createTraceSource(recording([
    { gt: 4.0, name: 'a', args: {}, ok: true },
    { gt: 4.0, name: 'b', args: {}, ok: true }
  ]));
  assert.equal(old.report().axis, 'gt');
  assert.equal(old.report().sharedGtWhilePaused, 1);
});

test('浮點尾差不會讓指令卡住不送', () => {
  /* GT 是 0.1 累加出來的，走到 3 秒時實際值可能是 2.9999999999999996。
     用嚴格的 <= 比較會讓這道指令永遠送不出去，而且沒有任何錯誤訊息。 */
  const src = createTraceSource(recording([cmd(3.0, 'x')]));
  assert.equal(at(src, 2.9999999999999996).length, 1);
});

test('report() 如實回報送出與未送出的數量', () => {
  const src = createTraceSource(recording([cmd(1.0, 'a'), cmd(100.0, 'b')]));
  at(src, 1.0);
  const r = src.report();
  assert.equal(r.commands, 2);
  assert.equal(r.fired, 1);
  assert.equal(r.remaining, 1);
  assert.equal(r.traceEndGt, 100.0);
});

test('錄製時就失敗的指令照樣重播，並計入回報', () => {
  const rec = recording([
    cmd(1.0, 'ok.one'),
    { gt: 2.0, name: 'fail.one', args: {}, ok: false, error: '技能點不足', gtExact: false }
  ]);
  const src = createTraceSource(rec);
  at(src, 2.0);
  assert.equal(src.report().failedWhenRecorded, 1);
  assert.equal(src.report().fired, 2);
});

test('決策間隔必須是一步——run_sim.js 與 verify_trace.js 都據此斷言', () => {
  const src = createTraceSource(recording([]));
  assert.equal(src.decideEveryGameSec, 0.1);
  assert.deepEqual(src.needPanels, []);      // 軌跡不做判斷，不需要面板
  assert.deepEqual(src.bootstrap, []);       // 起點來自錄製檔，不用 GM 墊
  assert.deepEqual(src.badPaths(), {});      // 介面要與 sim/policy.js 一致
});

test('錄製檔的 seed 與起始存檔會傳給重播端', () => {
  const rec = recording([], { meta: { seed: 12345 }, startSave: { player: { level: 7 } } });
  const src = createTraceSource(rec);
  assert.equal(src.seed, 12345);
  assert.equal(src.startSave.player.level, 7);
});

test('沒有 seed 的錄製檔要能被辨識出來（重播不可能重現那一場）', () => {
  const src = createTraceSource(recording([], { meta: {} }));
  assert.equal(src.seed, null);
});

test('錄製期間暫停過戰鬥要如實轉載——那是結構性的重現不能', () => {
  const src = createTraceSource(recording([], {
    meta: { seed: 1, pauseWindows: 2, pausedTicks: 37 }
  }));
  assert.equal(src.report().recorderPauseWindows, 2);
  assert.equal(src.report().recorderPausedTicks, 37);
});

test('舊錄製檔沒有暫停紀錄時回報 null，不假裝它沒暫停過', () => {
  /* 回 0 會讓讀報告的人以為「已確認沒暫停」，但實際上是「不知道」。 */
  const src = createTraceSource(recording([], { meta: { seed: 1 } }));
  assert.equal(src.report().recorderPauseWindows, null);
  assert.equal(src.report().recorderPausedTicks, null);
});

test('startSave 為 null 要分辨「全新角色」與「沒接到開機事件」', () => {
  /* 全新角色是最常見的錄製情境，把它報成警告只會讓人學會忽略警告。 */
  const fresh = createTraceSource(recording([], { meta: { seed: 1, startSaveCaptured: true } }));
  assert.equal(fresh.report().startSaveCaptured, true);
  assert.equal(fresh.startSave, null);

  const missed = createTraceSource(recording([], { meta: { seed: 1, startSaveCaptured: false } }));
  assert.equal(missed.report().startSaveCaptured, false);

  const legacy = createTraceSource(recording([], { meta: { seed: 1 } }));
  assert.equal(legacy.report().startSaveCaptured, null);
});

/* ---- viewdiff ---- */

test('刻度四捨五入到 0.1 當鍵，吸收浮點尾差', () => {
  assert.equal(gtKey(2.9999999999999996), '3.0');
  assert.equal(gtKey(3.04), '3.0');
  assert.equal(gtKey(3.06), '3.1');
});

test('完全一致回 pass', () => {
  const rows = [{ gt: 0.2, level: 1, gold: 10 }, { gt: 0.4, level: 1, gold: 12 }];
  const res = compareByGt(rows, rows.map((r) => Object.assign({}, r)));
  assert.equal(res.pass, true);
  assert.equal(res.shared, 2);
  assert.equal(res.mismatches, 0);
});

test('兩邊都有 simT 就以 simT 對齊，暫停不會製造假的共同點', () => {
  /* 暫停時 gt 停住：以 gt 當鍵，這三筆會塌成一個檢查點，而且是「最後一筆覆蓋前面」，
     等於默默丟掉兩個觀測點。以 simT 當鍵則是三個各自獨立的檢查點。 */
  const a = [
    { simT: 1.0, gt: 1.0, hp: 100 },
    { simT: 1.1, gt: 1.0, hp: 90 },
    { simT: 1.2, gt: 1.0, hp: 80 }
  ];
  const res = compareByGt(a, a.map((r) => Object.assign({}, r)));
  assert.equal(res.axis, 'simT');
  assert.equal(res.shared, 3);
  assert.equal(res.pass, true);
});

test('任一邊缺 simT 就整批退回 gt，並在結果標記軸別', () => {
  const withSimT = [{ simT: 1.0, gt: 1.0, hp: 100 }];
  const legacy = [{ gt: 1.0, hp: 100 }];
  const res = compareByGt(withSimT, legacy);
  assert.equal(res.axis, 'gt');
  /* simT 只存在於其中一邊，逐欄比對時算不一致——這是對的，兩邊本來就不是同一份資料 */
  assert.equal(res.pass, false);
});

test('任一欄位不同就 fail，並指出最早的那一點', () => {
  const a = [{ gt: 0.2, level: 1 }, { gt: 0.4, level: 1 }, { gt: 0.6, level: 2 }];
  const b = [{ gt: 0.2, level: 1 }, { gt: 0.4, level: 2 }, { gt: 0.6, level: 9 }];
  const res = compareByGt(a, b);
  assert.equal(res.pass, false);
  assert.equal(res.mismatches, 2);
  assert.equal(res.firstMismatch.gt, '0.4');   // 最早的那一點才是線索
});

test('沒有共同檢查點不算 pass——那是什麼都沒比到', () => {
  const res = compareByGt([{ gt: 0.2, level: 1 }], [{ gt: 5.0, level: 1 }]);
  assert.equal(res.shared, 0);
  assert.equal(res.pass, false);
});

test('一邊有、另一邊沒有的檢查點不算不一致，另外計數', () => {
  const a = [{ gt: 0.2, level: 1 }, { gt: 0.4, level: 1 }];
  const b = [{ gt: 0.2, level: 1 }];
  const res = compareByGt(a, b);
  assert.equal(res.pass, true);
  assert.equal(res.shared, 1);
  assert.equal(res.onlyInA, 1);
});

test('同一個 gt 有多筆時取最後一筆（暫停期間同刻度會對到好幾步）', () => {
  const a = [{ gt: 1.0, hp: 100 }, { gt: 1.0, hp: 50 }];
  const b = [{ gt: 1.0, hp: 50 }];
  assert.equal(compareByGt(a, b).pass, true);
});

test('缺欄位與多欄位都算不一致，不做欄位交集', () => {
  /* 只比交集的話，遊戲新增一個 view 欄位時兩邊會「一致」到天荒地老。 */
  const res = compareByGt([{ gt: 1.0, a: 1 }], [{ gt: 1.0, a: 1, b: 2 }]);
  assert.equal(res.pass, false);
});
