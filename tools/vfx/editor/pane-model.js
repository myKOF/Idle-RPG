'use strict';
/* ============================================================
   pane-model.js — 多視窗預覽的純邏輯（不碰 DOM、不碰 Pixi）

   預覽區可以切成最多四個視窗，每個視窗各開一份特效、各有自己的歷史與選取；
   Layers 面板、Inspector 與工具列顯示「焦點視窗」那一份。畫面怎麼接線在 editor.js，
   這裡回答接線時要問的問題，同樣一份給畫面、一份給測試：

     gridLayout          幾個視窗怎麼排
     clickPane／afterClose  點擊、Ctrl+點擊、關閉之後，焦點與多選落在誰身上
     playbackState       多選時工具列的「播放／暫停」與「預覽循環」怎麼顯示
     presetsFromSearch／searchFor  網址記住每個視窗開的特效，重新整理後還原
     blankPresetId／blankPreset    新視窗的空白特效
     portableClipboard   複製到「另一份特效」時剪貼簿要怎麼改寫
     foreignPasteAnchor  貼到另一份特效時插在哪裡
   ============================================================ */

(function (root, factory) {
  var node = typeof module !== 'undefined' && module.exports;
  var api = factory(
    node ? require('../../../js/vfx-core.js') : root.VFXCore,
    node ? require('./layer-model.js') : root.VFXLayerModel,
    node ? require('./hierarchy-model.js') : root.VFXHierarchyModel);
  if (node) module.exports = api;
  else root.VFXPaneModel = api;
})(typeof self !== 'undefined' ? self : this, function (Core, M, H) {

  /* 預覽區十字切開就是四格。再多的話每格太小，看不出特效的細節。 */
  var MAX_PANES = 4;

  /* ---------------- 版面 ----------------

     依閱讀順序填：一個佔滿、兩個左右並排（原本的在左）、四個田字。
     三個時下面那一個橫跨整列——原本的兩個只是變矮，不會換位置；
     再加第四個時它才讓出右半邊。 */
  function gridLayout(n) {
    var count = Math.max(1, Math.min(MAX_PANES, Math.floor(n) || 1));
    var spans = [];
    for (var i = 0; i < count; i++) spans.push(1);
    if (count === 3) spans[2] = 2;
    return { cols: count === 1 ? 1 : 2, rows: count <= 2 ? 1 : 2, spans: spans };
  }

  /* ---------------- 焦點與多選 ----------------

     sel = { focused: id, selected: [id…] }。selected 依加入的先後排，而且一定含 focused。

     焦點＝面板與工具列顯示、鍵盤與編輯作用的那一個，永遠只有一個。
     多選＝工具列的「播放／暫停」「Restart」「預覽循環」一起作用的那幾個。

       一般點擊  已在多選裡 → 只換焦點，多選不動（在其中一格拖圖層，不該讓同步播放的另一格被踢掉）
                 不在多選裡 → 只選它
       Ctrl      不在 → 加入並取得焦點
                 在   → 移出；移出的是焦點就交給最後加入的那一個；只剩它自己時不動 */
  function clickPane(sel, id, opts) {
    var selected = (sel && sel.selected ? sel.selected : []).slice();
    var focused = sel ? sel.focused : null;
    var at = selected.indexOf(id);
    if (!(opts && opts.ctrl)) {
      if (at < 0) return { focused: id, selected: [id] };
      return { focused: id, selected: selected };
    }
    if (at < 0) {
      selected.push(id);
      return { focused: id, selected: selected };
    }
    if (selected.length === 1) return { focused: focused, selected: selected };
    selected.splice(at, 1);
    return { focused: focused === id ? selected[selected.length - 1] : focused, selected: selected };
  }

  /* 關掉一個視窗之後。order＝關之前畫面上的順序。
     焦點被關掉時交給多選裡最後加入的；多選裡只剩它自己時，交給畫面上它的前一格（沒有就後一格），
     那一格也成為唯一的選取。 */
  function afterClose(sel, id, order) {
    var remaining = (order || []).filter(function (x) { return x !== id; });
    if (!remaining.length) return { focused: null, selected: [] };
    var selected = (sel && sel.selected ? sel.selected : []).filter(function (x) {
      return x !== id && remaining.indexOf(x) >= 0;
    });
    var focused = sel ? sel.focused : null;
    if (focused !== id && remaining.indexOf(focused) >= 0) {
      if (selected.indexOf(focused) < 0) selected.push(focused);
      return { focused: focused, selected: selected };
    }
    if (selected.length) return { focused: selected[selected.length - 1], selected: selected };
    var at = order.indexOf(id);
    var next = at > 0 ? order[at - 1] : remaining[0];
    return { focused: next, selected: [next] };
  }

  /* ---------------- 多選時的工具列 ----------------

     panes：選取的視窗 [{ playing, previewLoop }]。
     播放按鈕顯示「按下去會發生什麼」：有任何一個在播就是「暫停」（全部停下），
     全部停著才是「播放」（全部開始）——混合狀態時按一下先讓大家一致。
     預覽循環：全開打勾、全關不勾、混合時 indeterminate；點下去全部設成同一個值。 */
  function playbackState(panes) {
    var list = panes || [];
    var loopOn = list.filter(function (p) { return !!p.previewLoop; }).length;
    return {
      playing: list.some(function (p) { return !!p.playing; }),
      loop: list.length > 0 && loopOn === list.length,
      loopMixed: loopOn > 0 && loopOn < list.length
    };
  }

  /* ---------------- 網址 ----------------

     ?preset=a&preset=b&focus=2 —— 每個視窗開的特效照畫面順序各一個 preset，
     focus 是焦點視窗在這串裡的序號（從 1 起算；第一個就省略）。
     只有一個 preset 時與原本的 ?preset=<id> 完全相同，舊的書籤照樣能開。

     isValid 由呼叫端給（VFXPresetIdPolicy.isWritablePresetId）：網址是外部輸入，
     不合規則的 id（例如 ../）一律丟掉，而不是拿去組檔案路徑。重複的只留第一個。 */
  function presetsFromSearch(search, isValid) {
    var ids = [];
    var focus = 0;
    var params = null;
    try { params = new URLSearchParams(search || ''); } catch (e) { params = null; }
    if (!params) return { ids: ids, focus: focus };
    params.getAll('preset').forEach(function (raw) {
      var id = String(raw || '');
      if (!id || ids.indexOf(id) >= 0 || ids.length >= MAX_PANES) return;
      if (isValid && !isValid(id)) return;
      ids.push(id);
    });
    var f = parseInt(params.get('focus'), 10);
    if (f >= 1 && f <= ids.length) focus = f - 1;
    return { ids: ids, focus: focus };
  }

  /* ids 裡的 null（空白視窗、從本機匯入還沒進 repo 的）不寫進網址——重新整理時沒有檔案可以開。
     focus 跟著換算成過濾之後的序號；焦點視窗本身寫不進網址就不帶 focus。 */
  function searchFor(ids, focusIndex) {
    var kept = [];
    var focus = -1;
    (ids || []).forEach(function (id, i) {
      if (!id) return;
      if (i === focusIndex) focus = kept.length;
      kept.push(id);
    });
    if (!kept.length) return '';
    return '?' + kept.map(function (id) { return 'preset=' + encodeURIComponent(id); }).join('&') +
      (focus > 0 ? '&focus=' + (focus + 1) : '');
  }

  /* ---------------- 空白特效 ----------------

     新視窗一打開就是一份空白特效：可以直接新增圖層、貼上別的視窗複製來的圖層，
     也可以載入既有的特效把它換掉。名字避開 repo 裡已經有的與其他視窗開著的，
     第一次存檔仍然要走「另存新檔」問名字——這裡的名字只是暫時的。 */
  var BLANK_BASE = 'new-effect';

  function blankPresetId(taken) {
    var used = Object.create(null);
    (taken || []).forEach(function (id) { used[id] = true; });
    if (!used[BLANK_BASE]) return BLANK_BASE;
    var n = 2;
    while (used[BLANK_BASE + '-' + n]) n++;
    return BLANK_BASE + '-' + n;
  }

  /* layers 是空的：Core 的驗證不接受沒有圖層的 preset，所以空白特效在加入第一層之前
     存不了檔、也不會註冊進預覽——那正是「還沒有東西」的誠實狀態。 */
  function blankPreset(id) {
    return { schemaVersion: Core.SCHEMA_VERSION, id: id, duration: 1, loop: false, layers: [] };
  }

  /* ---------------- 跨特效的剪貼簿 ----------------

     同一份特效裡貼上時，副本的 parent 仍指向原本的父物件、子發射器照舊打到原本的目標——
     那些圖層就在旁邊（layer-model 的 remapPastedRefs）。換到另一份特效就不成立了：
     那一份裡沒有它們，或剛好有同名卻毫不相干的圖層，貼上去會掛錯人或存不了檔。所以：

       父物件沒一起複製     卸下成根層級。數值換算成畫面位置、角度、大小、出現時間都不變，
                            與 Inspector 的父物件選「無」走同一條路（H.attach）。
                            父物件的透明度、顏色與曲線動畫不會跟過去（它們是從父物件繼承來的）
       子發射器目標沒一起複製  拿掉 subEmitter（另一份特效裡指不到任何東西）
       只複製了子發射器的目標  照樣貼上；它是 sub 模式、沒有人觸發，驗證會說出來，由使用者決定
       群組                 攤成圖層：目標特效有自己的根群組，貼進去不能多出第二個群組
                            （VFX_AGENT_WORKFLOW §9.11）

     換算在複本上做，原本的特效一個 byte 都不動。回傳 { items, notes }（items 與
     M.copySelection 同一個形狀，全部是 layer 項目）；什麼都沒選到回傳 null。 */
  function portableClipboard(preset, layout, keys) {
    var expanded = H.withDescendants(preset, layout, keys || []);
    var clone = JSON.parse(JSON.stringify(preset));
    var first = M.copySelection(clone, layout, expanded);
    if (!first) return null;

    var copied = Object.create(null);
    first.items.forEach(function (item) {
      (item.kind === 'group' ? item.layers : [item.layer]).forEach(function (l) { copied[l.id] = true; });
    });

    var notes = [];
    clone.layers.forEach(function (l) {
      var se = l.subEmitter;
      if (!se || typeof se.layer !== 'string') return;
      if (!!copied[l.id] === !!copied[se.layer]) return;
      /* 沒被複製的那一層也在複本上拿掉：它不會進剪貼簿，拿掉只是讓下面的卸下不被
         「子發射器的來源與目標要同一個父物件」擋住 */
      if (copied[l.id]) notes.push({ id: l.id, kind: 'subEmitter' });
      delete l.subEmitter;
    });

    var roots = clone.layers.filter(function (l) {
      var p = H.parentIdOf(l);
      return copied[l.id] && p && !copied[p];
    }).map(function (l) { return l.id; });
    if (roots.length) {
      var result = H.attach(clone, roots, null);
      if (result.ok) {
        roots.forEach(function (id) { notes.push({ id: id, kind: 'detached' }); });
        (result.notes || []).forEach(function (n) { notes.push(n); });
      } else {
        /* 檔案本身就有層級錯誤（手改出來的）時換算不了：至少不要帶著指不到的 parent 過去 */
        clone.layers.forEach(function (l) {
          if (roots.indexOf(l.id) >= 0) { delete l.parent; notes.push({ id: l.id, kind: 'detachedRaw' }); }
        });
      }
    }

    var items = [];
    M.copySelection(clone, layout, expanded).items.forEach(function (item) {
      if (item.kind === 'group') {
        item.layers.forEach(function (l) { items.push({ kind: 'layer', layer: l }); });
      } else {
        items.push(item);
      }
    });
    return { items: items, notes: notes };
  }

  /* 貼到另一份特效時插在哪裡。選著一層就排在它後面（M.pasteClipboard 本來的規則）。
     選的是群組列或什麼都沒選、而那份特效是「一個根群組收著全部圖層」的標準形狀時，
     排在根群組最後一層後面——否則會落在群組外的根層級，存檔後就違反單一根群組。 */
  function foreignPasteAnchor(preset, layout, activeKey) {
    if (activeKey && M.keyKind(activeKey) === 'layer' && M.layerById(preset, M.keyId(activeKey))) {
      return activeKey;
    }
    var groups = (layout && layout.groups) || [];
    var layers = (preset && preset.layers) || [];
    if (groups.length === 1 && groups[0].layerIds.length &&
        layers.every(function (l) { return groups[0].layerIds.indexOf(l.id) >= 0; })) {
      return M.keyOf('layer', groups[0].layerIds[groups[0].layerIds.length - 1]);
    }
    return activeKey || null;
  }

  var NOTE_TEXT = {
    detached: '父物件沒有一起複製，貼上後改成根層級（位置、角度、大小與出現時間已換算成不變；' +
      '父物件的透明度、顏色與曲線動畫不會帶過來）',
    detachedRaw: '父物件沒有一起複製，而且原本的父子層級有錯誤，換算不了；已直接改成根層級，位置可能會跑掉',
    subEmitter: '子發射器的目標沒有一起複製，這份特效裡找不到它，已拿掉 subEmitter'
  };

  /* 貼上時沒辦法完全照原樣的地方。父子層級換算的說明沿用 hierarchy-model 那一份。 */
  function describeNotes(notes) {
    return (notes || []).map(function (n) {
      return NOTE_TEXT[n.kind] ? n.id + '：' + NOTE_TEXT[n.kind] : H.describeNotes([n])[0];
    });
  }

  return {
    MAX_PANES: MAX_PANES,
    gridLayout: gridLayout,
    clickPane: clickPane,
    afterClose: afterClose,
    playbackState: playbackState,
    presetsFromSearch: presetsFromSearch,
    searchFor: searchFor,
    blankPresetId: blankPresetId,
    blankPreset: blankPreset,
    portableClipboard: portableClipboard,
    foreignPasteAnchor: foreignPasteAnchor,
    describeNotes: describeNotes
  };
});
