'use strict';
/* ============ 真人軌跡決策來源 ============

   把 js/recorder.js 錄下來的真人操作，包成與 sim/policy.js 完全相同的介面，
   讓 scripts/run_sim.js 可以用 --trace= 驅動它。

   為什麼要長得跟策略一模一樣：這樣「真人那一場」與「AI 那一場」走的是同一支驅動、
   同一組快照欄位、同一份 run_summary 格式，兩邊的輸出可以直接相減。另外寫一支
   回放腳本會多出第二套報表，兩套遲早會長歪，而長歪的那一刻沒有人會發現。

   ---- 對齊用的時鐘是 view.simT，不是 gt，也不是 harness 的模擬秒 ----

   harness 的 gameTimeSec 是虛擬牆鐘，兩邊不同步，不能用。

   gt（js/util.js:4 的 GT）曾經是這裡的對齊軸，但它**在戰鬥暫停時停住**
   （js/worker/sim.worker.js 的 `if (!combatPaused)`）。暫停期間 simStep 仍在跑
   factoryTick / newForgeTick / forgeTick，狀態有在動，只是 gt 沒記錄到。
   結果是暫停那一段的指令全部擠在同一個 gt，重播時被壓成一步送出，之後整條亂數序列偏移，
   而分岔點還會落在暫停之後好幾秒，看起來像別的原因。實測踩過：暫停在 gt=51.8，
   verify_trace 到 gt=55.2 才 FAIL。

   simT（協議 v14 新增）是那條不會停的軸：每步都累加、從 0 起算、不進存檔，
   所以瀏覽器與 headless 從同一份存檔開機時它就是同一條刻度。改用它之後，
   暫停不再是限制。

   ---- 舊錄製檔 ----

   v14 之前錄的檔沒有 simT，只能退回 gt。此時上述的暫停限制原封不動存在，
   report().axis 會是 'gt'，錄製檔若同時自報暫停過，那一份就是不可用的。
   退回去是為了不讓舊檔完全不能重播，不是說兩條軸等價。

   ---- 仍然存在的一件小事 ----

   同一個 tick 內連送的多道指令會共用同一個 simT（一步 0.1 秒，人手連點兩下
   必定落在同一步）。這一種**不是問題**：瀏覽器就是在同兩步之間依序執行的，
   重播也在同一步依序送出，完全重現。 */

/* 浮點累加的尾差。GT += 0.1 累加上萬次之後與整數刻度會有微小誤差，
   兩邊的誤差方向相同但不保證位元相等，比較時要留容差。 */
const EPS = 1e-6;

function createTraceSource(recording, opts) {
  opts = opts || {};

  if (!recording || recording.format !== 'idle-rpg-human-trace/1') {
    throw new Error('不是 idle-rpg-human-trace/1 格式的錄製檔（format=' +
      (recording && recording.format) + '）');
  }
  const trace = Array.isArray(recording.trace) ? recording.trace.slice() : [];
  const meta = recording.meta || {};

  /* 對齊軸：全部指令都有 simT 才用它，缺一筆就整批退回 gt（見檔頭「舊錄製檔」）。
     半數用 simT、半數用 gt 會產生兩套刻度混在一起的假對齊，比退回去更糟。 */
  const AXIS = trace.every((t) => t && typeof t.simT === 'number') ? 'simT' : 'gt';

  /* 對齊軸必須單調不減，否則游標式重播會漏掉指令。錄製端是照 tick 順序寫入的，
     不該發生；真的發生就代表錄製檔被人手改過或合併過，直接擋下。 */
  for (let i = 1; i < trace.length; i++) {
    if (trace[i][AXIS] + EPS < trace[i - 1][AXIS]) {
      throw new Error(`軌跡的 ${AXIS} 不是單調遞增：第 ${i} 筆 ${trace[i][AXIS]} < 第 ${i - 1} 筆 ${trace[i - 1][AXIS]}`);
    }
  }

  /* 與前一道共用同一個刻度的指令數。
     用 simT 對齊時這只有「同一個 tick 內連送」一種成因，重播會完整重現，純描述性。
     退回 gt 時才要分辨暫停那一種——舊錄製檔沒有 paused 欄位（undefined）就保守算進
     風險那一類，不假設它是安全的。 */
  let sharedGt = 0;
  let sharedGtWhilePaused = 0;
  for (let i = 1; i < trace.length; i++) {
    if (Math.abs(trace[i][AXIS] - trace[i - 1][AXIS]) >= EPS) continue;
    sharedGt++;
    if (AXIS === 'gt' && trace[i].paused !== false) sharedGtWhilePaused++;
  }

  let cursor = 0;
  let fired = 0;
  let lastGt = 0;

  return {
    name: 'human-trace',
    /* 一步一決策。真人的指令可能落在任何一步上，決策間隔大於一步就會把它們
       擠到格點上，亂數序列跟著錯開。真人錄製本來就只有幾小時，付得起這個成本。 */
    decideEveryGameSec: 0.1,
    needPanels: [],          // 軌跡不需要看面板，它不做判斷
    bootstrap: [],           // 起點來自錄製檔的存檔，不用 GM 墊

    /* 錄製檔自帶的起始存檔。run_sim.js 用它開機（--save 可覆蓋）。 */
    startSave: recording.startSave || null,
    seed: (meta.seed === null || meta.seed === undefined) ? null : Number(meta.seed),
    /* 錄製當下的實測樣本，交給 scripts/verify_trace.js 做逐點比對。 */
    rows: Array.isArray(recording.rows) ? recording.rows : [],
    meta: meta,

    decide(state) {
      const view = (state && state.view) || {};
      /* 軌跡用 simT 對齊，但重播的遊戲是協議 v14 之前的版本（view 沒有 simT）——
         那會靜靜地永遠對不上任何指令。大聲失敗，不要讓它跑出一份「什麼都沒做」的曲線。 */
      if (AXIS === 'simT' && typeof view.simT !== 'number') {
        throw new Error('軌跡以 simT 對齊，但遊戲的 buildView() 沒有 simT 欄位——遊戲版本比錄製檔舊（協議 v14 才加入）。');
      }
      const gt = (typeof view[AXIS] === 'number') ? view[AXIS] : 0;
      lastGt = gt;
      const out = [];
      while (cursor < trace.length && trace[cursor][AXIS] <= gt + EPS) {
        const t = trace[cursor];
        out.push({
          /* run_sim.js 的指令統計以 ruleId 分組。用序號當 id 會讓統計表變成
             一行一筆，看不出全貌；改用指令名分組，統計表就是「真人各操作各做了幾次」。 */
          ruleId: 'trace',
          name: t.name,
          args: t.args || {}
        });
        cursor++;
        fired++;
      }
      return out;
    },

    /* 策略層用來回報「指到不存在的狀態路徑」。軌跡沒有條件式，不會有這種失效，
       但介面要一致——run_sim.js 的摘要無條件會呼叫它。 */
    badPaths() { return {}; },

    report() {
      return {
        source: 'human-trace',
        /* 實際用了哪條軸。'gt' 代表這是協議 v14 之前的舊錄製檔，暫停限制仍然存在。 */
        axis: AXIS,
        recordedAt: meta.recordedAt || null,
        seed: meta.seed === undefined ? null : meta.seed,
        commands: trace.length,
        fired: fired,
        /* 沒送出去的指令＝重播的 gt 沒有走到那麼遠。多半是 --hours 給太短，
           也可能是重播提早分岔導致 GT 停在某處。非 0 一定要看。 */
        remaining: trace.length - cursor,
        lastGt: +lastGt.toFixed(1),
        traceEndGt: trace.length ? trace[trace.length - 1].gt : 0,
        /* 錄製端自報的健康度，原文轉載。 */
        recorderTruncated: !!meta.truncated,
        recorderUnacked: meta.unacked || 0,
        /* 暫停過幾次。非 0 代表這份錄製**重播不出來**——不是誤差，是結構上做不到：
           暫停期間 GT 不前進，重播端只有 gt 這一條軸，無從得知那段燒掉了幾步。
           舊錄製檔沒有這兩個欄位，回報 null 而不是 0，不假裝它沒暫停過。 */
        recorderPauseWindows: (meta.pauseWindows === undefined) ? null : meta.pauseWindows,
        recorderPausedTicks: (meta.pausedTicks === undefined) ? null : meta.pausedTicks,
        /* startSave 是 null 時用來分辨「本來就是全新角色」與「錄製器沒接到開機事件」。
           舊錄製檔沒有這個欄位，同樣回 null＝不知道。 */
        startSaveCaptured: (meta.startSaveCaptured === undefined) ? null : !!meta.startSaveCaptured,
        /* sharedGtCommands 是描述性數字：同一個 tick 內連送很常見，而且會被完整重現。
           sharedGtWhilePaused 只有在退回 gt 對齊時才可能非 0，那才代表有壓縮風險；
           以 simT 對齊時暫停已經不是問題，它恆為 0。 */
        sharedGtCommands: sharedGt,
        sharedGtWhilePaused: sharedGtWhilePaused,
        failedWhenRecorded: trace.filter((t) => t.ok === false).length
      };
    }
  };
}

module.exports = { createTraceSource, EPS };
