'use strict';
/* ============ view 逐檢查點比對 ============

   兩個「同一個遊戲跑出來的 buildView() 序列」該不該一致，是模擬器裡反覆要回答的問題：

     scripts/cross_check.js   真瀏覽器 vs headless（證明 headless 沒有偷算）
     scripts/verify_trace.js  真人錄製當下 vs 軌跡重播（證明軌跡錄全了）

   兩邊要的判定完全一樣，所以放在同一支。比對邏輯只有一份，改了就兩邊一起改，
   不會出現「一邊比得嚴、一邊比得鬆」這種只有在出事時才會發現的落差。

   ---- 比對鍵是 simT，不是 gt，更不是真實時間 ----

   真實時間不能用：瀏覽器與 headless 的執行速度本來就不同。

   gt 也不能用：它在戰鬥暫停時停住（js/worker/sim.worker.js 的 `if (!combatPaused)`），
   但暫停期間 simStep 仍在跑 factoryTick / newForgeTick / forgeTick——狀態有在動。
   以 gt 當鍵，暫停的那一段會有好幾步擠在同一個刻度上，兩次執行的「同一個 gt」
   其實是不同的狀態，比對必然錯開，而分岔點還會落在暫停之後好幾秒。

   simT（協議 v14 新增）是那條不會停的軸：每步都累加，從 0 起算，不進存檔。
   兩次執行從同一份存檔開機時它就是同一條刻度。

   舊資料沒有 simT，此時退回 gt 並在結果標記 axis，讓讀報告的人知道那一次比對
   有暫停就不準——退回去是為了不讓舊檔完全不能比，不是說兩者等價。

   兩者都是浮點累加，上萬步之後與整數刻度必有尾差，所以四捨五入到 0.1 當鍵。 */

function gtKey(gt) {
  return (Math.round(Number(gt) * 10) / 10).toFixed(1);
}

/* 這批資料要用哪條軸。只要有一筆缺 simT 就整批退回 gt——半數用 simT、半數用 gt
   會產生兩套刻度混在一起的假共同點，那比完全不比更糟。 */
function pickAxis(rows) {
  for (const r of rows) {
    if (!r) continue;
    if (typeof r.simT !== 'number') return 'gt';
  }
  return 'simT';
}

/* rows → Map(key → row)。同一個刻度有多筆時保留最後一筆。
   用 simT 時這幾乎不會發生（每步都前進）；退回 gt 時暫停那一段會大量發生，
   而那正是 gt 不可靠的原因。 */
function indexByGt(rows, axis) {
  axis = axis || 'gt';
  const m = new Map();
  for (const r of rows) {
    if (!r || typeof r[axis] !== 'number') continue;
    m.set(gtKey(r[axis]), r);
  }
  return m;
}

/* 逐欄比對兩個 view。回傳不一致的欄位描述，空陣列代表完全相同。 */
function diffRow(a, b, labelA, labelB, ignore) {
  const out = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const f of keys) {
    if (ignore && ignore.has(f)) continue;
    if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) {
      out.push(`${f}: ${labelA} ${JSON.stringify(a[f])} ≠ ${labelB} ${JSON.stringify(b[f])}`);
    }
  }
  return out;
}

/* 只比兩邊都有的檢查點。一邊有、另一邊沒有不算不一致——收集器掛上的時機不同、
   取樣密度不同都會造成這種缺漏，那是取樣問題不是行為問題，另外用 onlyIn* 回報。
   ⚠️ 但 shared 為 0 時不能報 PASS：那代表兩邊根本沒有共同刻度，什麼都沒比到。 */
function compareByGt(rowsA, rowsB, opts) {
  opts = opts || {};
  const labelA = opts.labelA || 'A';
  const labelB = opts.labelB || 'B';
  const ignore = new Set(opts.ignore || []);

  /* 兩邊各自看有沒有 simT，取較保守的那條軸：一邊是舊資料就整批退回 gt。 */
  const axis = (pickAxis(rowsA) === 'simT' && pickAxis(rowsB) === 'simT') ? 'simT' : 'gt';
  const A = indexByGt(rowsA, axis);
  const B = indexByGt(rowsB, axis);
  const shared = [...A.keys()].filter((k) => B.has(k)).sort((x, y) => Number(x) - Number(y));

  let mismatches = 0;
  let firstMismatch = null;
  for (const k of shared) {
    const diffs = diffRow(A.get(k), B.get(k), labelA, labelB, ignore);
    if (diffs.length) {
      mismatches++;
      if (!firstMismatch) firstMismatch = { gt: k, diffs };
    }
  }

  return {
    /* 實際用了哪條軸。'gt' 代表至少一邊是舊資料，那一次比對碰到暫停就不準。 */
    axis: axis,
    countA: A.size,
    countB: B.size,
    shared: shared.length,
    onlyInA: A.size - shared.length,
    onlyInB: B.size - shared.length,
    mismatches: mismatches,
    /* 最早不一致的那一點才是線索，之後的都是它的後果。 */
    firstMismatch: firstMismatch,
    pass: shared.length > 0 && mismatches === 0
  };
}

/* 兩支腳本的結論輸出格式一致，讀報告的人不必記兩種。回傳 process.exit 用的碼。 */
function printResult(res, opts) {
  opts = opts || {};
  const labelA = opts.labelA || 'A';
  const labelB = opts.labelB || 'B';
  console.log(`${labelA} 檢查點 ${res.countA} 筆，${labelB} 檢查點 ${res.countB} 筆，共同 ${res.shared} 筆　對齊軸 ${res.axis}`);
  if (res.axis === 'gt') {
    console.log('⚠️ 退回以 gt 對齊（至少一邊是協議 v14 之前的舊資料）。');
    console.log('   gt 在戰鬥暫停時會停住，那一段的比對結果不可信。');
  }
  console.log('──────── 結論 ────────');
  if (!res.shared) {
    console.log(`❌ FAIL  沒有任何共同檢查點，什麼都沒比到。`);
    console.log(`   兩邊的 ${res.axis} 完全不重疊，多半是起始存檔或取樣密度不同。`);
    return 1;
  }
  if (res.pass) {
    console.log(`✅ PASS  ${res.shared} 個共同檢查點的 buildView() 完全一致`);
    return 0;
  }
  console.log(`❌ FAIL  ${res.shared} 個檢查點中有 ${res.mismatches} 個不一致`);
  console.log(`   最早不一致於 ${res.axis}=${res.firstMismatch.gt}s：`);
  res.firstMismatch.diffs.slice(0, 12).forEach((d) => console.log('     ' + d));
  console.log('\n   最早的那一點才是線索——之後的不一致都是它的後果。');
  return 1;
}

module.exports = { gtKey, indexByGt, diffRow, compareByGt, printResult };
