'use strict';
/* ============================================================
   vfx-editor-history.test.cjs — Editor 的 Undo / Redo

   受測對象：
     tools/vfx/editor/history.js   歷史堆疊與交易的純邏輯
     tools/vfx/editor/editor.js    各個編輯入口有沒有真的接上同一份歷史

   為什麼堆疊邏輯要抽出來測：會出錯的地方是「Undo 之後又做新編輯，
   舊的 Redo 有沒有作廢」「拖曳兩百次是不是只留一步」「超過上限丟掉的
   是不是最舊那筆」。這些用手點很難點出來，也很難一眼看出錯。

   全檔反覆驗證的一條不變量：
     **整個 Editor 只有一份歷史，而且歷史狀態永遠不進 preset。**
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const H = require('../tools/vfx/editor/history.js');
const VFXCore = require('../js/vfx-core.js');

const REPO = path.resolve(__dirname, '..');

/* 一個最小的「編輯器」：狀態就是一個字串，快照就是它本身。
   history.js 不認識 preset，所以測試也不需要真的 preset。 */
function harness(opts) {
  const box = { value: 'A', applied: 0, changed: 0 };
  box.history = H.create(Object.assign({
    capture: () => box.value,
    apply: (v) => { box.value = v; box.applied++; },
    onChange: () => { box.changed++; }
  }, opts || {}));
  return box;
}

/* ============================================================
   堆疊基本行為
   ============================================================ */

test('HISTORY-1/2 一開始不能 Undo 也不能 Redo', function () {
  const b = harness();
  assert.equal(b.history.canUndo(), false);
  assert.equal(b.history.canRedo(), false);
  assert.equal(b.history.undoLabel(), null);
  assert.equal(b.history.redoLabel(), null);
  assert.equal(b.history.undo(), false, '沒東西可還原時要回報失敗而不是丟例外');
  assert.equal(b.history.redo(), false);
});

test('HISTORY-3/4 一次編輯之後可以 Undo，Undo 之後可以 Redo', function () {
  const b = harness();
  b.history.execute('改成 B', () => { b.value = 'B'; });
  assert.equal(b.history.canUndo(), true);
  assert.equal(b.history.undoLabel(), '改成 B');
  assert.equal(b.history.canRedo(), false, '還沒 Undo 就不該有 Redo');

  b.history.undo();
  assert.equal(b.value, 'A');
  assert.equal(b.history.canUndo(), false);
  assert.equal(b.history.canRedo(), true);
  assert.equal(b.history.redoLabel(), '改成 B');

  b.history.redo();
  assert.equal(b.value, 'B');
  assert.equal(b.history.canRedo(), false);
});

test('HISTORY-5/6 連續多步的 Undo 與 Redo 一步一步走', function () {
  const b = harness();
  ['B', 'C', 'D'].forEach(function (v) {
    b.history.execute('改成 ' + v, () => { b.value = v; });
  });
  assert.equal(b.value, 'D');
  b.history.undo(); assert.equal(b.value, 'C');
  b.history.undo(); assert.equal(b.value, 'B');
  b.history.undo(); assert.equal(b.value, 'A');
  assert.equal(b.history.canUndo(), false, '回到最初就不能再往回');
  b.history.redo(); assert.equal(b.value, 'B');
  b.history.redo(); assert.equal(b.value, 'C');
  b.history.redo(); assert.equal(b.value, 'D');
  assert.equal(b.history.canRedo(), false);
});

test('HISTORY-7 Undo 之後做新編輯，舊的 Redo 必須作廢', function () {
  /* A → B → C，Undo 回 B，再做 D。此時不能再 Redo 回 C——
     那條分支已經不存在了，讓它還在只會走到一個誰都沒看過的狀態。 */
  const b = harness();
  b.history.execute('B', () => { b.value = 'B'; });
  b.history.execute('C', () => { b.value = 'C'; });
  b.history.undo();
  assert.equal(b.value, 'B');
  assert.equal(b.history.canRedo(), true);

  b.history.execute('D', () => { b.value = 'D'; });
  assert.equal(b.history.canRedo(), false, '新分支一出現，舊的 Redo 就該消失');
  assert.deepEqual(b.history.debug().labels, ['B', 'D']);
  b.history.undo(); assert.equal(b.value, 'B');
  b.history.undo(); assert.equal(b.value, 'A');
});

test('HISTORY-8/9 上限至少 50，超過時丟掉最舊的那一筆', function () {
  assert.ok(H.DEFAULT_LIMIT >= 50, '預設上限 ' + H.DEFAULT_LIMIT + ' 不得低於 50');
  assert.equal(H.DEFAULT_LIMIT, 100, '建議值');

  const b = harness({ limit: 5 });
  for (let i = 1; i <= 8; i++) {
    b.history.execute('step' + i, () => { b.value = 'v' + i; });
  }
  const dbg = b.history.debug();
  assert.equal(dbg.length, 5, '不得無限增長');
  assert.deepEqual(dbg.labels, ['step4', 'step5', 'step6', 'step7', 'step8'],
    '留下的要是最新的五筆');
  /* 丟掉最舊的之後，指標仍要指在最新狀態上 */
  assert.equal(b.history.canRedo(), false);
  for (let i = 0; i < 5; i++) b.history.undo();
  assert.equal(b.value, 'v3', '只能回到還留著的最早狀態');
  assert.equal(b.history.canUndo(), false);
});

test('HISTORY-10 沒有實際改變就不留下任何一步', function () {
  /* 拖了一圈又回到原位＝什麼都沒改。留一筆空的會讓 Ctrl+Z 看起來沒反應。 */
  const b = harness();
  b.history.begin('拖一圈');
  b.value = 'B';
  b.value = 'A';                 // 回到原位
  const pushed = b.history.commit();
  assert.equal(pushed, false);
  assert.equal(b.history.canUndo(), false);
  assert.equal(b.history.debug().length, 0);

  /* execute 也一樣 */
  b.history.execute('什麼都沒做', () => {});
  assert.equal(b.history.canUndo(), false);
});

/* ============================================================
   交易
   ============================================================ */

test('HISTORY-19~22 一次拖曳只留一步，不管中間動了幾次', function () {
  const b = harness();
  b.history.begin('移動圖層');
  for (let i = 0; i < 200; i++) b.value = 'move' + i;     // 模擬 200 次 pointermove
  b.history.commit();
  assert.equal(b.history.debug().length, 1, '兩百次移動只能是一步');
  assert.equal(b.history.undoLabel(), '移動圖層');
  b.history.undo();
  assert.equal(b.value, 'A', '要一路回到拖曳開始之前');
});

test('HISTORY-23 取消的拖曳完全不進歷史', function () {
  const b = harness();
  b.history.begin('移動圖層');
  b.value = 'dragging';
  b.history.cancel();
  b.value = 'A';                 // 呼叫端自己還原
  assert.equal(b.history.canUndo(), false);
  assert.equal(b.history.debug().length, 0);
});

test('HISTORY-37 交易還開著就開下一筆，前一筆要先收掉', function () {
  /* 使用者在輸入框還沒失焦時直接去點別的東西。那一筆是完整的一步，
     不該被丟掉，也不該和下一步併在一起。 */
  const b = harness();
  b.history.begin('改欄位');
  b.value = 'B';
  b.history.begin('點了別的');   // 沒有 commit 就開下一筆
  b.value = 'C';
  b.history.commit();
  assert.deepEqual(b.history.debug().labels, ['改欄位', '點了別的']);
  b.history.undo(); assert.equal(b.value, 'B');
  b.history.undo(); assert.equal(b.value, 'A');
});

test('HISTORY-38 套用快照的過程中不得再記錄，否則會自我遞迴', function () {
  const b = harness();
  b.history.execute('B', () => { b.value = 'B'; });
  /* apply 內部若有人呼叫 begin/commit，必須被忽略 */
  let sawApplying = null;
  const b2 = harness({
    apply: (v) => { sawApplying = b2.history.isApplying(); b2.value = v; }
  });
  b2.history.execute('B', () => { b2.value = 'B'; });
  b2.history.undo();
  assert.equal(sawApplying, true, 'apply 期間 isApplying 要是 true');
  assert.equal(b2.history.debug().length, 1, 'Undo 本身不得產生新的一步');
});

test('HISTORY-39 execute 內部丟例外時不得留下開著的交易', function () {
  const b = harness();
  assert.throws(function () {
    b.history.execute('會爆的操作', () => { b.value = 'X'; throw new Error('boom'); });
  }, /boom/);
  assert.equal(b.history.hasOpen(), false, '交易要被取消掉');
  assert.equal(b.history.canUndo(), false);
});

test('HISTORY-40 clear 之後兩邊都不能走', function () {
  const b = harness();
  b.history.execute('B', () => { b.value = 'B'; });
  b.history.execute('C', () => { b.value = 'C'; });
  b.history.undo();
  b.history.clear();
  assert.equal(b.history.canUndo(), false);
  assert.equal(b.history.canRedo(), false);
  assert.equal(b.history.debug().length, 0);
  assert.equal(b.value, 'B', 'clear 不改變目前狀態，只是忘掉歷史');
});

test('HISTORY-41 拖到一半按 Undo：先把這一步收掉再往回', function () {
  const b = harness();
  b.history.begin('拖曳中');
  b.value = 'B';
  b.history.undo();              // 拖曳還沒放開就按 Ctrl+Z
  assert.equal(b.value, 'A', '應該回到拖曳開始之前');
  assert.equal(b.history.canRedo(), true, '而且那一步要留著可以 Redo');
});

/* ============================================================
   記憶體
   ============================================================ */

test('HISTORY-42 100 步的快照記憶體是可接受的量級', function () {
  /* 用最大的那份 preset 實際量。這是選擇「整份快照」而不是 command 的依據：
     幾 MB 換掉一整類「undo 之後資料變得很奇怪」的 bug 很划算。 */
  const dir = path.join(REPO, 'vfx', 'presets');
  let worst = 0, worstName = '';
  fs.readdirSync(dir).filter(f => /\.json$/.test(f)).forEach(function (f) {
    const text = VFXCore.serialisePreset(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    if (text.length > worst) { worst = text.length; worstName = f; }
  });
  /* 每筆歷史存 before ＋ after，而 JS 字串是 UTF-16 —— 兩個都要乘進去，
     否則會低估一半以上。相鄰共用之後線性編輯大約能省掉一半。 */
  const mb = worst * 2 * 2 * 100 / 1024 / 1024;
  assert.ok(worst > 0);
  assert.ok(mb < 25, '最大的 ' + worstName + ' 是 ' + (worst / 1024).toFixed(1) +
    ' KB，100 步上界約 ' + mb.toFixed(1) + ' MB，超過 25 MB 就該重新考慮設計');

  /* 相鄰兩步共用同一個字串物件：這是把上界砍半的機制，要守住 */
  const hist = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/history.js'), 'utf8');
  assert.ok(/prev\.after\[k\]/.test(hist), '相鄰快照要共用內容相同的字串');
});

/* ============================================================
   與 Editor 的整合
   ============================================================ */

function editorSrc() {
  return fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
}
function stripped() {
  return editorSrc().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('HISTORY-43 整個 Editor 只有一份歷史', function () {
  const src = stripped();
  assert.equal((src.match(/VFXHistory\.create\(/g) || []).length, 1,
    '只能建立一個歷史實例');
  ['gizmoUndoStack', 'curveUndoStack', 'layerUndoStack', 'undoStack', 'redoStack']
    .forEach(function (bad) {
      assert.ok(src.indexOf(bad) < 0, '不得另外維護 ' + bad);
    });
});

test('HISTORY-11~16 各個編輯入口都接上了同一份歷史', function () {
  const src = stripped();
  const wrapped = [
    ['新增圖層', 'addLayer'],
    ['刪除圖層', 'deleteSelection'],
    ['貼上圖層', 'pasteClipboard'],
    ['調整順序', 'performDrop'],
    ['組成群組', 'groupSelection'],
    ['解散群組', 'ungroupSelection'],
    ['更換素材', 'applyPicker']
  ];
  wrapped.forEach(function (pair) {
    assert.ok(src.indexOf("edit('" + pair[0] + "'") >= 0,
      pair[1] + ' 沒有包成一筆歷史（找不到標籤「' + pair[0] + '」）');
  });
  /* Inspector 欄位走 focus/blur 交易 */
  assert.ok(/function wireFieldTransaction/.test(src));
  assert.ok(/wireFieldTransaction\(control, f\.label\)/.test(src),
    '每個 Inspector 欄位都要接上交易');
});

test('HISTORY-19~22 Gizmo 與曲線的拖曳都是交易，不是每次移動一步', function () {
  const src = stripped();
  /* Gizmo：beginDrag 開、pointerup 收、Escape 取消 */
  const beginFn = src.slice(src.indexOf('function beginDrag'));
  assert.ok(/editBegin\(/.test(beginFn.slice(0, 400)), 'beginDrag 要開交易');
  const upFn = src.slice(src.indexOf('function onPreviewPointerUp'));
  const upBody = upFn.slice(0, upFn.indexOf('\n  }'));
  assert.ok(/editCommit\(\)/.test(upBody), 'pointerup 要收交易');
  assert.ok(/editCancel\(\)/.test(upBody), '沒有實際移動時要取消');
  const cancelFn = src.slice(src.indexOf('function cancelDrag'));
  assert.ok(/editCancel\(\)/.test(cancelFn.slice(0, 500)), 'Escape 要取消交易');

  /* pointermove 期間不得直接寫歷史 */
  const moveFn = src.slice(src.indexOf('function onPreviewPointerMove'));
  const moveBody = moveFn.slice(0, moveFn.indexOf('\n  }'));
  ['editBegin(', 'editCommit(', 'edit('].forEach(function (bad) {
    assert.ok(moveBody.indexOf(bad) < 0, 'pointermove 期間不得呼叫 ' + bad);
  });

  /* 曲線元件要有 onBegin 這個交易起點 */
  const ce = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/curve-editor.js'), 'utf8');
  assert.ok(/opts\.onBegin/.test(ce), '曲線元件要能通知呼叫端「一次操作開始了」');
  assert.ok(/onBegin: function/.test(src), 'Editor 要把它接到 editBegin');
});

test('HISTORY-26~30 鍵盤路由：Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 與搜尋框的例外', function () {
  const src = stripped();
  const fn = src.slice(src.indexOf('function onKeyDown'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/uk === 'z' && !e\.shiftKey/.test(body), 'Ctrl+Z 是 Undo');
  assert.ok(/uk === 'y'/.test(body), 'Ctrl+Y 是 Redo');
  assert.ok(/uk === 'z' && e\.shiftKey/.test(body), 'Ctrl+Shift+Z 也是 Redo');
  assert.ok(/e\.preventDefault\(\)/.test(body), '接管了就要擋掉瀏覽器預設');
  assert.ok(/isSearchInput\(document\.activeElement\)/.test(body),
    '搜尋框要排除在外');

  /* 順序：Undo 要排在 isTextEntry 守門之前——這是編輯器，
     在數值欄位按 Ctrl+Z 應該回上一步編輯 */
  const undoAt = body.indexOf("uk === 'z'");
  const textAt = body.indexOf('isTextEntry(document.activeElement)');
  assert.ok(undoAt >= 0 && textAt >= 0);
  assert.ok(undoAt < textAt, 'Ctrl+Z 要排在文字守門之前');

  /* 搜尋框的判定要看 type=search，不是列 id——新增搜尋框時不必回來改 */
  const isSearch = src.slice(src.indexOf('function isSearchInput'));
  assert.ok(/'search'/.test(isSearch.slice(0, 300)));
});

test('HISTORY-31/32 換 preset 要清空歷史', function () {
  const src = stripped();
  assert.ok(/function clearHistoryForNewPreset/.test(src));
  const load = src.slice(src.indexOf('function loadPresetFromFile'));
  const body = load.slice(0, load.indexOf('reader.readAsText'));
  assert.ok(/clearHistoryForNewPreset\(\)/.test(body),
    '匯入新 preset 時必須清空，否則會把上一份的 Undo 套到這一份');
});

test('HISTORY-33~35 Undo/Redo 之後畫面三邊都要同步', function () {
  const src = stripped();
  const fn = src.slice(src.indexOf('function historyApply'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/renderLayerList\(\)/.test(body), 'Layer List 要重繪');
  assert.ok(/renderInspector\(\)/.test(body), 'Inspector 要重繪');
  assert.ok(/onPresetChanged\(\)/.test(body), 'Preview 要更新');
  assert.ok(/markGizmoDirty\(\)/.test(body), 'Preview 的框也要跟著移動');
  /* 不得重載素材或重啟 runtime——走既有的更新路徑就好 */
  ['fetchJson', 'createRuntime', 'new PIXI.Application'].forEach(function (bad) {
    assert.ok(body.indexOf(bad) < 0, 'Undo 不該 ' + bad);
  });
});

test('HISTORY-24/25 還原選取時要確認那些圖層還在', function () {
  /* Undo 回到「圖層還沒建立」的狀態時，舊的 activeKey 會指向不存在的圖層，
     Inspector 就會空引用。 */
  const src = stripped();
  const fn = src.slice(src.indexOf('function historyApply'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/keyStillExists/.test(body), '還原選取前要先確認存在');
  const helper = src.slice(src.indexOf('function keyStillExists'));
  const hb = helper.slice(0, helper.indexOf('\n  }'));
  assert.ok(/groupById\(/.test(hb) && /layerById\(/.test(hb),
    '群組與圖層兩種 key 都要檢查');
});

test('HISTORY-36 歷史狀態永遠不進 preset', function () {
  /* 快照記在 Editor 的記憶體裡，不寫進 preset、不寫 localStorage、
     不進 Core、不進 Runtime。 */
  const src = editorSrc();
  const snapFn = src.slice(src.indexOf('function historySnapshot'));
  const body = snapFn.slice(0, snapFn.indexOf('\n  }'));
  ['assetIndex', 'state.index', 'state.semantics', 'texture', 'runtime']
    .forEach(function (bad) {
      assert.ok(body.indexOf(bad) < 0, '快照不該包含 ' + bad);
    });

  const hist = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/history.js'), 'utf8');
  ['localStorage', 'sessionStorage', 'fetch(', 'VFXCore']
    .forEach(function (bad) {
      assert.ok(hist.indexOf(bad) < 0, 'history.js 不該用到 ' + bad);
    });

  /* Core / Backend / Schema 完全不知道有歷史這回事 */
  ['js/vfx-core.js', 'js/vfx-pixi-backend.js'].forEach(function (rel) {
    const s = fs.readFileSync(path.join(REPO, rel), 'utf8');
    ['history', 'History', 'undo', 'Undo', 'redo']
      .forEach(function (w) {
        assert.ok(s.indexOf(w) < 0, rel + ' 不該提到 ' + w);
      });
  });

  /* 存出去的 preset 不含任何歷史欄位 */
  const dir = path.join(REPO, 'vfx', 'presets');
  fs.readdirSync(dir).filter(f => /\.json$/.test(f)).forEach(function (f) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    ['history', 'undo', 'redo', 'snapshot'].forEach(function (w) {
      assert.ok(text.indexOf(w) < 0, f + ' 不該出現 ' + w);
    });
  });
});

test('HISTORY-44 Undo/Redo 按鈕的 disabled 與提示會跟著更新', function () {
  const src = stripped();
  assert.ok(/function refreshHistoryButtons/.test(src));
  const fn = src.slice(src.indexOf('function refreshHistoryButtons'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/disabled = !history\.canUndo\(\)/.test(body));
  assert.ok(/disabled = !history\.canRedo\(\)/.test(body));
  assert.ok(/undoLabel\(\)/.test(body) && /redoLabel\(\)/.test(body),
    '提示要說出「上一步是什麼」');

  const html = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/index.html'), 'utf8');
  assert.ok(/id="btn-undo"/.test(html) && /id="btn-redo"/.test(html),
    '不能只有快捷鍵，工具列也要有按鈕');
  assert.ok(/id="btn-undo" disabled/.test(html), '一開始就該是停用狀態');
  assert.ok(/history\.js/.test(html), '頁面要載入歷史模組');
});

test('HISTORY-45 播放與檢視狀態不進歷史', function () {
  /* 播放、暫停、背景色、搜尋、收合這些改變的是「怎麼看」，不是「內容」。
     把它們記進去，Ctrl+Z 就會變成一件無法預期的事。 */
  const src = stripped();
  const snapFn = src.slice(src.indexOf('function historySnapshot'));
  const body = snapFn.slice(0, snapFn.indexOf('\n  }'));
  ['playing', 'collapsed', 'sortMode', 'clipboard', 'background', 'handle']
    .forEach(function (bad) {
      assert.ok(body.indexOf(bad) < 0, '快照不該包含 ' + bad);
    });

  /* 這幾個按鈕不得包成歷史 */
  const play = src.slice(src.indexOf("$('btn-play').onclick"), src.indexOf("$('btn-restart').onclick"));
  assert.ok(play.indexOf('edit(') < 0, '播放不該進歷史');
});

test('HISTORY-46 dirty 判斷靠內容比對，所以 Undo 回存檔狀態會自動變乾淨', function () {
  /* 不是「Undo → dirty = true」。使用者存檔後改了又 Undo 回來，
     應該重新變成未修改。 */
  const src = stripped();
  const fn = src.slice(src.indexOf('function isDirty'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/currentPresetText\(\) !== state\.savedText/.test(body),
    'dirty 要比對 canonical 內容，不是設一個旗標');
  /* 快照與 dirty 用同一種表示法，兩邊才不會各說各話 */
  const snapFn = src.slice(src.indexOf('function historySnapshot'));
  assert.ok(/currentPresetText\(\)/.test(snapFn.slice(0, 400)),
    '快照要用同一個 canonical 文字');
});
