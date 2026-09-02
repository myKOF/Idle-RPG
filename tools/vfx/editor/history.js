'use strict';
/* ============================================================
   history.js — Editor 的 Undo / Redo

   **整個 Editor 只有這一份歷史。** 不是 Gizmo 一份、曲線一份、圖層面板一份——
   那樣的話「上一步」到底是哪一步就沒有答案了，而且三份堆疊之間的先後
   關係無法表達。

   這個模組不認識 preset、layout 或 selection，它只知道：
     capture()  把「現在的狀態」變成一個可比較、可還原的快照
     apply(s)   把快照套回去
   要記什麼、怎麼還原，全部由呼叫端決定。所以它可以在 Node 裡測，
   也不會把 authoring 的知識散到兩個地方。

   ---- 為什麼用快照而不是 command ----

   command（記錄「做了什麼」＋反向操作）省記憶體，但每一種操作都要自己寫
   一份正確的反向邏輯，而且反向邏輯錯了通常要到很久以後才會發現。
   這個專案的 preset canonical 文字最大 45.8 KB（lightning-orb-field-b，
   30 層各帶 13 點曲線），典型是 7 KB。實測 100 步：典型 2.7 MB、
   最壞 17.9 MB（每筆存 before ＋ after，JS 字串是 UTF-16 所以再乘二）。
   下面的相鄰共用把線性編輯的部分砍掉一半。
   用幾 MB 換掉一整類「undo 之後資料變得很奇怪」的 bug 很划算。

   ---- 交易 ----

   連續拖曳會產生上百次 pointermove。若每次都記一步，Ctrl+Z 要按兩百次才
   回得去。所以拖曳是一筆交易：

     begin(label)   記下 before
     …live 更新…    不進歷史
     commit()       記下 after，如果和 before 相同就整筆丟掉
     cancel()       什麼都不記（呼叫端自己還原）
   ============================================================ */

var VFXHistory = (function () {

  var DEFAULT_LIMIT = 100;

  /* opts.capture  fn() -> snapshot（必須是可以用 equal 比較的值）
     opts.apply    fn(snapshot)
     opts.equal    fn(a, b) -> bool，預設用 === 比較
                   （呼叫端若把快照做成字串，預設就夠用了）
     opts.onChange fn()，堆疊或指標變動時通知（更新按鈕的 disabled 狀態）
     opts.limit    上限，預設 100 */
  function create(opts) {
    var capture = opts.capture;
    var apply = opts.apply;
    var equal = opts.equal || function (a, b) { return a === b; };
    var onChange = opts.onChange || function () {};
    var limit = opts.limit || DEFAULT_LIMIT;

    /* entries[i] 描述「從狀態 i 變成狀態 i+1」這一步。
       pointer＝已經套用了幾步。這個表示法讓 redo 失效變得不必特別處理：
       push 之前先把 pointer 之後的全部截掉就對了。 */
    var entries = [];
    var pointer = 0;
    var open = null;              // 進行中的交易
    var applying = false;         // 套用快照時不得再記錄，否則會自我遞迴

    function canUndo() { return pointer > 0; }
    function canRedo() { return pointer < entries.length; }
    function undoLabel() { return canUndo() ? entries[pointer - 1].label : null; }
    function redoLabel() { return canRedo() ? entries[pointer].label : null; }

    function begin(label) {
      if (applying) return;
      /* 還有交易開著就先收掉。會走到這裡通常是使用者在輸入框還沒失焦時
         直接去點了別的東西——那一筆該算完整的一步，不該被丟掉或和下一步併在一起。 */
      if (open) commit();
      open = { label: label, before: capture() };
    }

    function commit() {
      if (applying || !open) return false;
      var t = open;
      open = null;
      var after = capture();
      /* 拖了一圈又回到原位＝什麼都沒改，不該佔一步。
         使用者按 Ctrl+Z 期望回到「上一個看得出差別的狀態」。 */
      if (equal(t.before, after)) return false;
      push(t.label, t.before, after);
      return true;
    }

    function cancel() {
      if (applying) return;
      open = null;
    }

    function push(label, before, after) {
      entries.length = pointer;              // 分岔：舊的 redo 全部作廢
      /* 相鄰兩步的 before 與上一步的 after 通常是同一個狀態，但 capture()
         每次都產生新字串，於是同樣的內容被存了兩份。內容相同時改成指向
         同一個物件，線性編輯下的記憶體直接砍半。
         只在「值相等」時才共用，所以不會把不同的狀態綁在一起。 */
      var prev = entries[entries.length - 1];
      if (prev && prev.after && before && typeof before === 'object') {
        Object.keys(before).forEach(function (k) {
          if (typeof before[k] === 'string' && before[k] === prev.after[k]) {
            before[k] = prev.after[k];
          }
        });
      }
      entries.push({ label: label, before: before, after: after });
      pointer++;
      /* 超過上限就丟最舊的。pointer 跟著往前挪，指到的仍然是同一筆。 */
      while (entries.length > limit) {
        entries.shift();
        pointer--;
      }
      onChange();
    }

    /* 單一動作的糖衣：begin → 執行 → commit。
       fn 內部若丟例外，交易要取消掉，不能留一筆開著的交易污染下一次操作。 */
    function execute(label, fn) {
      begin(label);
      try {
        fn();
      } catch (e) {
        cancel();
        throw e;
      }
      return commit();
    }

    function undo() {
      if (open) commit();                    // 拖到一半按 Ctrl+Z：先把這一步結掉
      if (!canUndo()) return false;
      pointer--;
      run(entries[pointer].before);
      onChange();
      return true;
    }

    function redo() {
      if (open) commit();
      if (!canRedo()) return false;
      run(entries[pointer].after);
      pointer++;
      onChange();
      return true;
    }

    function run(snapshot) {
      applying = true;
      try { apply(snapshot); }
      finally { applying = false; }
    }

    function clear() {
      entries = [];
      pointer = 0;
      open = null;
      onChange();
    }

    return {
      begin: begin, commit: commit, cancel: cancel, execute: execute,
      undo: undo, redo: redo, clear: clear,
      canUndo: canUndo, canRedo: canRedo,
      undoLabel: undoLabel, redoLabel: redoLabel,
      isApplying: function () { return applying; },
      hasOpen: function () { return !!open; },
      /* 診斷與測試用。回傳複本，外部改不到內部狀態。 */
      debug: function () {
        return {
          limit: limit, pointer: pointer, length: entries.length,
          labels: entries.map(function (e) { return e.label; })
        };
      }
    };
  }

  return { create: create, DEFAULT_LIMIT: DEFAULT_LIMIT };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXHistory;
}
