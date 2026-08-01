'use strict';
/* ============ 真人軌跡自我驗證 ============

   問題：怎麼知道 js/recorder.js 錄下來的軌跡是**完整**的？

   漏錄一道指令不會有任何錯誤訊息。軌跡照樣能重播、照樣產出漂亮的曲線，只是那條
   曲線不是真人那一場。拿它去跟 AI 比，得到的落差是假的——而且看起來很合理。

   驗證方式：錄製時同時記下了真人當下的 buildView() 樣本（rows）。用同一份存檔、
   同一個 seed 重播軌跡，如果兩邊逐檢查點完全一致，那就同時證明了三件事：

     1. 軌跡沒有漏指令      漏一道，狀態立刻分岔
     2. 時間戳是對的        錯一步，亂數序列分岔
     3. headless 忠實於瀏覽器  這是 scripts/cross_check.js 在做的事，順帶一起證了

   任何一項不成立，比對就會在分岔的那一刻紅燈，並指出最早的那個檢查點。

   用法：
     node scripts/verify_trace.js <human_trace.json>

   建議用 ?rowEvery=1 錄一段短的（幾分鐘）來做這個驗證：逐 tick 取樣的檢查點最密，
   分岔在哪一步一目了然。長時間的正式錄製用預設密度即可，那份是拿來畫曲線的。 */

const fs = require('fs');
const path = require('path');
const { createEngine } = require('./sim/engine');
const { createTraceSource } = require('./sim/trace');
const { compareByGt, printResult } = require('./sim/viewdiff');

const ROOT = path.resolve(__dirname, '..');
const TRACE_PATH = process.argv[2];

if (!TRACE_PATH) {
  console.error('用法：node scripts/verify_trace.js <human_trace.json>');
  process.exit(1);
}

const recording = JSON.parse(fs.readFileSync(path.resolve(ROOT, TRACE_PATH), 'utf8'));
const src = createTraceSource(recording);
const report0 = src.report();

if (src.seed === null) {
  console.error('❌ 錄製檔沒有 seed。沒有種子化亂數就無從重現，這份錄製不能驗證。');
  console.error('   錄製時必須以 index.html?seed=N&record=1 開啟（見 js/worker/sim.worker.js 的 installTestSeed）。');
  process.exit(1);
}
if (!src.rows.length) {
  console.error('❌ 錄製檔沒有實測樣本（rows），沒有比對對象。');
  process.exit(1);
}
if (report0.recorderUnacked) {
  console.warn(`⚠️ 錄製時有 ${report0.recorderUnacked} 道指令沒等到 ACK，軌跡已知有缺口，以下比對預期會失敗。`);
}
console.log(`  對齊軸 ${report0.axis}` + (report0.axis === 'gt'
  ? '（協議 v14 之前的舊錄製檔，暫停限制仍然存在）' : '（暫停時照走）'));

/* 只有退回 gt 對齊時暫停才是結構性的重現不能。先講清楚，免得那個 FAIL 被當成別的原因去追。 */
if (report0.recorderPauseWindows && report0.axis === 'gt') {
  console.warn(`\n⚠️ 這份錄製暫停過戰鬥 ${report0.recorderPauseWindows} 次（共 ${report0.recorderPausedTicks} 則 tick），而它是以 gt 對齊的舊錄製檔。`);
  console.warn('   暫停期間 gt 不前進，但 simStep 仍在跑 factoryTick / newForgeTick / forgeTick，');
  console.warn('   重播無從得知那一段燒掉了幾步——**以下比對必定失敗**，');
  console.warn('   而且分岔點會出現在暫停之後好幾秒，看起來像別的原因。');
  console.warn('   請用目前版本重錄一份（協議 v14 起以 simT 對齊，暫停不再是問題）。');
}

console.log(`\n錄製檔 ${TRACE_PATH}`);
console.log(`  錄於 ${report0.recordedAt}　seed ${src.seed}　指令 ${report0.commands} 道　樣本 ${src.rows.length} 筆`);
/* 見 js/recorder.js 的 startSaveCaptured：null 起點有兩種意思，只有一種是問題。 */
console.log('  起始存檔 ' + (recording.startSave ? '有'
  : report0.startSaveCaptured === true ? '無（錄製時就是全新角色）'
  : report0.startSaveCaptured === false ? '無 ⚠️ 錄製器沒接到開機事件，起點不明'
  : '無（舊版錄製器，未記錄原因）'));

/* 重播範圍取樣本與軌跡的較晚者，再加一步餘裕。 */
const lastRowGt = src.rows[src.rows.length - 1].gt || 0;
const endGt = Math.max(lastRowGt, report0.traceEndGt);

const engine = createEngine({ seed: src.seed }).boot(recording.startSave || null);

if (Math.abs(src.decideEveryGameSec - engine.dt) > 1e-9) {
  console.error(`軌跡重播的決策間隔必須等於引擎步長：${src.decideEveryGameSec} ≠ ${engine.dt}`);
  process.exit(1);
}

/* 逐步推進，每一步都取一次 view。

   為什麼每步都取而不是照瀏覽器的 5Hz 節奏：瀏覽器的 tick 不是等間隔的——
   指令成功後 js/worker/sim.worker.js:1415 會補送一則，所以錄到的樣本可能落在
   任何一步上。headless 這邊每步都取，錄製端的每一個 gt 才都找得到對應點。

   ⚠️ engine.view() 會順帶呼叫 updateShownRes()（見 sim/engine.js），比瀏覽器
   呼叫得更頻繁。shownRes 是黏著式旗標且不在 buildView() 的輸出裡，所以不影響這裡的
   比對，但會讓重播存檔的 shownRes 比瀏覽器那份早一點被點亮。 */
const replayRows = [];
/* 步數上限：GT 只在戰鬥沒暫停時前進，所以走到 endGt 至少要 endGt/dt 步，暫停會更多。
   給 4 倍餘裕，用盡時明講——不做靜默截斷。 */
const MAX_STEPS = Math.ceil((endGt + 1) / engine.dt) * 4;
let steps = 0;
let view = engine.view();
while (steps < MAX_STEPS && view.gt < endGt + engine.dt / 2) {
  engine.step(1);
  steps++;
  view = engine.view();
  /* 決策來源看到的 state 形狀與 run_sim.js 給的一致，軌跡只讀 view.gt。 */
  const cmds = src.decide({ view: view, panels: {}, gameTimeSec: engine.gameTimeSec() });
  if (cmds.length) {
    for (const c of cmds) engine.cmd(c.name, c.args);
    /* 指令送完之後重取：瀏覽器那筆補送的 tick 也是在指令執行之後才 buildView。 */
    view = engine.view();
  }
  replayRows.push(view);
}
if (steps >= MAX_STEPS) {
  console.warn(`⚠️ 已達步數上限 ${MAX_STEPS} 步仍未走到 gt=${endGt}s，重播提早停住了。`);
}

const report = src.report();
console.log(`\n重播完成：送出 ${report.fired}/${report.commands} 道指令，走到 gt=${report.lastGt}s（樣本 ${replayRows.length} 筆）`);
if (report.remaining) {
  console.warn(`⚠️ 還有 ${report.remaining} 道指令沒送出——GT 沒有走到 ${report.traceEndGt}s。`);
  console.warn('   這本身就是分岔的徵兆：重播的戰鬥暫停狀態與錄製當下不同。');
}

const res = compareByGt(src.rows, replayRows, {
  labelA: '真人實測', labelB: '重播',
  /* 目前沒有需要豁免的欄位。要加必須在這裡具名並寫下理由——
     沿用 scripts/cross_check.js 的規矩，豁免清單不得是空白支票。 */
  ignore: []
});

console.log('');
const code = printResult(res, { labelA: '真人實測', labelB: '重播' });
if (code === 0) {
  console.log('   軌跡完整、時間戳正確，headless 重播出來的就是真人那一場。');
  console.log('   可以拿 run_sim.js --trace 的輸出去跟 AI 策略比對了。');
} else {
  console.log('   軌跡與實測對不上，先別拿這份資料做結論。常見原因（依可能性排序）：');
  if (report0.recorderPauseWindows && report0.axis === 'gt') {
    console.log(`     - **錄製期間暫停過戰鬥 ${report0.recorderPauseWindows} 次，且以 gt 對齊**（見上方警告）。`);
    console.log('       這是結構性的重現不能，先排除這一項再看其他可能。');
  }
  console.log('     - 錄製時沒有從頭錄（起始存檔不是那一場真正的起點）');
  console.log('     - 有玩家操作沒有走 WorkerBridge.send（那條路徑錄不到，要補鉤子）');
  console.log('     - 錄製期間分頁被切走過，存檔被落地並改變了狀態');
  if (report0.recorderPauseWindows === null) {
    console.log('     - 這份錄製是舊版錄製器產生的，沒有暫停紀錄，無從排除暫停這個原因');
  }
}
process.exit(code);
