'use strict';
/* ============================================================
   editor.js — VFX Editor MVP（Editor 專屬的殼，不含任何繪圖邏輯）

   Editor 只做三件事：編輯 Preset、瀏覽 metadata、把 Preset 交給 VFX Core 播放。
   **預覽畫面完全由 js/vfx-core.js ＋ js/vfx-pixi-backend.js 產生**，
   Editor 沒有自己的 renderer，因此看到的就是 Runtime 之後會播的東西。

   Inspector 由「圖層型別的欄位描述」驅動，不是為每個特效寫一個 Inspector；
   未來新增 layer type 只要加一組欄位描述。
   ============================================================ */

(function () {

  var ASSET_INDEX_URL = '/vfx/asset-index.json';
  var ASSET_SEMANTICS_URL = '/vfx/asset-semantics.json';

  /* ?preset=<id> 決定開場載入哪一份 preset；多視窗時一個視窗一個（?preset=a&preset=b&focus=2，
     格式見 pane-model.js 的 presetsFromSearch）。id 限制成 preset id 的合法字元
     （見 Core 的 preset.id 規則），順便擋掉 ../ 之類的路徑穿越。

     網址沒帶 preset＝空場景，一份特效都不開（2026-09-17 使用者要求）。以前會開一份預設的
     （這裡是 demo-basic、啟動器是 lightning-orb-field），打開編輯器第一眼看到的是別人的特效，
     還得先分辨它是不是自己要改的那一份。 */
  function presetsFromQuery() {
    return VFXPaneModel.presetsFromSearch(window.location.search, VFXPresetIdPolicy.isWritablePresetId);
  }

  function presetUrl(id) { return '/vfx/presets/' + id + '.json'; }
  var PRESET_LIST_URL = '/__presets';
  /* 另存新檔的 Windows 存檔視窗由伺服器開（見 askSaveAsName） */
  var SAVE_AS_DIALOG_URL = '/__save-as-dialog';

  /* ---------------- topbar 的 Preset 切換 ----------------

     搜尋框 ＋ 自繪清單，不是原生 <select>。原生下拉沒有辦法在打開的狀態下篩選，
     而 157 份 preset 用捲的已經找不到東西——那正是它被換掉的原因。

     選了就把那一份開進焦點視窗。原本是整頁重載成 ?preset=<id>：preset、layout、歷史、
     選取、gizmo 全部要換成另一份，重載能保證不會混到上一份殘留。多視窗之後重載會把
     其他視窗一起關掉，所以改成換上一份全新的編輯狀態物件（newDoc）——整份換掉而不是
     逐欄清空，是同一個保證（見 openPresetInPane）。

     「目前是哪一份」的真相是 state.sourcePresetId（載入來源），不是這個輸入框的
     文字——輸入框裡放的是使用者正在打的關鍵字。兩者混在一起的話，打到一半
     按 Esc 或去點別的地方，就會不知道自己現在開的是什麼。 */

  /* 伺服器版本對不上時要顯示的那一行；正常時是 null。 */
  var comboNotice = null;

  /* 上一次打的關鍵字。存 sessionStorage 而不是記在變數裡：當初選一份
     preset 就會整頁重載，而「搜尋 → 開一個來看 → 回去看
     下一個符合的」正是最常見的用法——只記在記憶體的話，最需要它的那一次
     剛好沒有。現在改成就地載入了，但重新整理頁面時仍然要留著。

     也刻意不是 localStorage：那是長期偏好（格線、背景色）的位置，而
     「剛才在找什麼」是當下的工作方式，跟 zoom／平移同一類。隔天打開編輯器
     還躺著昨天的關鍵字，只會讓人以為清單壞了。sessionStorage 的生命週期
     正好是一個分頁，撐得過重載、關掉就沒了。 */
  var SEARCH_STORAGE_KEY = 'vfx-editor.presetSearch';

  function lastComboQuery() {
    try { return window.sessionStorage.getItem(SEARCH_STORAGE_KEY) || ''; }
    catch (e) { return ''; }
  }

  function rememberComboQuery(q) {
    try { window.sessionStorage.setItem(SEARCH_STORAGE_KEY, q || ''); } catch (e) { }
  }

  var combo = {
    rows: [],          // [{ id, label, text, search }]
    shown: [],         // 目前符合關鍵字的（rows 的子集）
    active: -1,        // shown 裡被高亮的索引
    open: false,
    /* 目前開著的是哪一份。放在這裡而不是用閉包帶著跑，是因為「另存新檔」
       之後清單要重建、而目前這一份也換人了——閉包版本會讓舊的 id 留在
       事件處理常式裡，於是切回自己會被當成「已經是這一份」而沒反應。 */
    currentId: null,
    wired: false       // 事件只註冊一次，重建清單不得重複掛
  };

  function comboDisplayText() {
    /* 空白特效的名字（new-effect）是暫時的，不是 repo 裡的哪一份：搜尋框留空，顯示提示字 */
    if (state.isNew) return '';
    var id = state.sourcePresetId || (state.preset && state.preset.id) || '';
    var row = null;
    for (var i = 0; i < combo.rows.length; i++) {
      if (combo.rows[i].id === id) { row = combo.rows[i]; break; }
    }
    return row ? row.text : id;
  }

  /* 抓 repo 裡的 preset 清單（含用途標註）。「目前這份」不在這裡決定：清單晚一步到，
     那時焦點視窗可能已經換人或換了一份，所以回來時才照焦點視窗現況同步（syncPresetIdentity）。 */
  function fillPresetPicker() {
    var input = $('preset-search');
    if (!input) return;
    fetch(PRESET_LIST_URL).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var ids = (data && data.presets) || [];
        if (!ids.length) return;
        /* usage[id].label ＝這份 preset 在遊戲裡的第一個使用者（技能名稱，或
           普攻那種寫死對應的標籤）。來源與判定規則見 tools/vfx/preset-usage.cjs。
           **沒有括號就代表沒有人在用**——那個空白本身是資訊，157 份裡有 56 份
           是這種狀態，挑素材時一眼就分得出哪些還是孤兒。 */
        var usage = (data && data.usage) || {};
        /* 伺服器是常駐行程，而它服務的這一支 editor.js 是每次請求才讀磁碟的
           （no-store）。所以「頁面已經是新版、伺服器還是舊版」會同時成立，
           結果就是功能少了一半而畫面上沒有任何線索——2026-09-09 實測踩過：
           可搜尋的清單出來了，用途標註一個都沒有。

           兩種偵測方式，因為它們涵蓋不同的舊法：
             usage 欄位整個不存在 → 伺服器舊到還沒有這個功能（只有這一招抓得到，
                                    舊程式沒辦法回報自己舊）
             staleFiles 有東西    → 伺服器有這個功能，而且自己發現載入後檔案被改過 */
        comboNotice = null;
        if (!data || data.usage === undefined) {
          comboNotice = '用途標註沒有出現：編輯器伺服器還是舊版的。' +
            '關掉「VFX 編輯器伺服器」視窗，再執行一次 啟動VFX編輯器.bat。';
        } else if (data.staleFiles && data.staleFiles.length) {
          comboNotice = '伺服器程式在啟動之後被改過（' + data.staleFiles.join('、') +
            '），畫面與伺服器可能對不上。關掉伺服器視窗再啟動一次。';
        }
        if (comboNotice) {
          var msg = $('preview-msg');
          if (msg) { msg.className = 'hint err'; msg.textContent = comboNotice; }
        }
        combo.rows = ids.map(function (id) {
          var u = usage[id];
          /* labels 是收攏過的（一個群組用到多階時只寫群組名），
             all 是逐階的完整清單——前者給列上顯示，後者給 tooltip 與搜尋。
             搜尋要用完整的那一份，否則打「水龍捲」這種階段名會找不到。 */
          var labels = (u && u.labels) || [];
          var all = (u && u.all) || labels;
          var label = labels.join('、');
          return {
            id: id,
            label: label,
            all: all,
            count: (u && u.count) || 0,
            text: label ? id + '（' + label + '）' : id,
            /* 關鍵字同時比對 id 與用途，所以打「雷球」找得到 lightning-orb-field。
               id 一律小寫，中文沒有大小寫，所以只要把輸入轉小寫就夠了。 */
            search: (id + ' ' + all.join(' ')).toLowerCase()
          };
        });
        /* 有清單才知道哪些視窗開的是 repo 裡的特效，網址這時才寫得完整 */
        if (focusedPane) withPane(focusedPane, syncPresetIdentity);
        wirePresetCombo();
        /* 清單比頁面晚一步到：瀏覽特效已經開著的話要跟著補上 */
        if ($('preset-browser') && !$('preset-browser').hidden) renderPresetBrowser();
      })
      .catch(function () { /* 清單拿不到就維持原本的檔案對話框流程 */ });
  }

  function comboFilter(text) {
    var q = String(text || '').trim().toLowerCase();
    if (!q) return combo.rows.slice();
    /* 空白分隔的多個關鍵字要全部命中：打「ground fire」找得到 ground-field-fire，
       但不會被「fire」的一大堆結果淹掉。 */
    var terms = q.split(/\s+/);
    return combo.rows.filter(function (row) {
      for (var i = 0; i < terms.length; i++) {
        if (row.search.indexOf(terms[i]) < 0) return false;
      }
      return true;
    });
  }

  function renderComboList() {
    var currentId = combo.currentId;
    var host = $('preset-list');
    if (!host) return;
    host.textContent = '';
    /* 提示放在清單最上面，因為「為什麼沒有技能名？」就是在這裡問出來的。 */
    if (comboNotice) {
      var warn = document.createElement('div');
      warn.className = 'combo-warn';
      warn.textContent = '⚠ ' + comboNotice;
      host.appendChild(warn);
    }
    if (!combo.shown.length) {
      var none = document.createElement('div');
      none.className = 'combo-empty';
      none.textContent = '沒有符合的 preset';
      host.appendChild(none);
      return;
    }
    combo.shown.forEach(function (row, i) {
      var el = document.createElement('div');
      el.className = 'combo-row' +
        (i === combo.active ? ' active' : '') +
        (row.id === currentId ? ' current' : '');
      var name = document.createElement('span');
      name.className = 'combo-id';
      name.textContent = row.id;
      el.appendChild(name);
      if (row.label) {
        var tag = document.createElement('span');
        /* 用途另外一格而不是接在 id 後面：一整排對齊之後，
           掃視「哪些沒人用」比讀每一行的括號快得多。 */
        tag.className = 'combo-use';
        tag.textContent = row.label;
        el.appendChild(tag);
      }
      /* tooltip 給逐階的完整清單：列上為了長度把同群組的多個階段收攏成群組名，
         真的要知道是哪幾階時，滑鼠停一下就有。 */
      el.title = row.all && row.all.length
        ? row.id + '\n共 ' + row.count + ' 處使用：\n· ' + row.all.join('\n· ')
        : row.id + '：目前沒有任何技能或程式碼用到';
      /* mousedown 而不是 click：input 的 blur 會先關掉清單，click 就永遠打不中。 */
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        choosePreset(row.id);
      });
      host.appendChild(el);
    });
  }

  function openCombo(query) {
    var currentId = combo.currentId;
    combo.open = true;
    combo.shown = comboFilter(query);
    /* 預設高亮目前這一份，找不到就第一筆——打開之後直接按 Enter
       不該把人帶到一個沒預期的 preset。 */
    combo.active = 0;
    for (var i = 0; i < combo.shown.length; i++) {
      if (combo.shown[i].id === currentId) { combo.active = i; break; }
    }
    $('preset-list').hidden = false;
    renderComboList();
    scrollComboActive();
  }

  function closeCombo() {
    combo.open = false;
    var host = $('preset-list');
    if (host) { host.hidden = true; host.textContent = ''; }
  }

  function scrollComboActive() {
    var host = $('preset-list');
    if (!host) return;
    /* 用 class 查而不是 children[i]：清單最上面可能還有一行警告，
       用索引會整個差一格——高亮在 A、捲到的卻是 B。 */
    var el = host.querySelectorAll('.combo-row')[combo.active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function moveComboActive(delta) {
    if (!combo.shown.length) return;
    combo.active = (combo.active + delta + combo.shown.length) % combo.shown.length;
    renderComboList();
    scrollComboActive();
  }

  function choosePreset(id) {
    var currentId = combo.currentId;
    closeCombo();
    $('preset-search').value = comboDisplayText();
    if (!id || id === currentId) return;
    openPresetInFocus(id);
  }

  /* 選單、瀏覽特效共用的「開這一份」：開進焦點視窗。回傳 Promise<boolean>（true＝開好了）。

     同一份特效只能開在一個視窗：兩邊各改各的，誰後存檔誰就把另一邊的修改蓋掉，
     而且畫面上完全看不出來。已經開在別的視窗就直接把焦點切過去。 */
  function openPresetInFocus(id) {
    var holder = paneHolding(id);
    if (holder) {
      if (holder !== focusedPane) {
        activatePane(holder, {});
        /* 只是說明「為什麼跳到這一格」：離開這一格時就收掉（見 focusPane），不留在它的狀態列上 */
        setSaveStatus('「' + id + '」已經開在' + paneLabel(holder) + '，已切換過來', 'note');
        state.saveStatus.transient = true;
      }
      return Promise.resolve(true);
    }
    /* 未存檔的內容換過去就沒了，先問一聲。 */
    if (isDirty() && !window.confirm('目前的修改尚未存檔，切換 Preset 會失去這些修改。要繼續嗎？')) {
      return Promise.resolve(false);
    }
    return openPresetInPane(focusedPane, id);
  }

  /* ---------------- 瀏覽特效（縮圖） ----------------

     下拉適合「已經知道名字」。要「找一份長得像的來改」得看得到樣子——使用者原本
     是開作業系統的檔案視窗一個一個找 JSON（2026-09-14）。那個視窗看不到畫面，
     而且用它複製檔案再開，JSON 裡的 id 還是原本那份，一按存檔就蓋掉原檔。

     縮圖由伺服器即時畫（tools/vfx/preset-thumbs.cjs，有快取），卡片捲進畫面才要圖：
     一次要兩百張的話，伺服器得一張一張畫上好一陣子。清單與搜尋沿用下拉那一份
     （combo.rows／comboFilter），不另外抓、也不另寫一套比對規則。 */
  var browser = { wired: false, observer: null };

  function openPresetBrowser() {
    wirePresetBrowser();
    $('preset-browser').hidden = false;
    renderPresetBrowser();
    $('pb-search').focus();
  }

  function closePresetBrowser() {
    $('preset-browser').hidden = true;
    if (browser.observer) { browser.observer.disconnect(); browser.observer = null; }
  }

  function wirePresetBrowser() {
    if (browser.wired) return;
    browser.wired = true;
    $('pb-search').addEventListener('input', renderPresetBrowser);
    $('pb-close').onclick = closePresetBrowser;
    $('preset-browser').addEventListener('mousedown', function (e) {
      if (e.target === $('preset-browser')) closePresetBrowser();       // 點外框關閉
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('preset-browser').hidden) {
        closePresetBrowser();
        e.preventDefault();
      }
    });
  }

  function renderPresetBrowser() {
    var grid = $('pb-grid');
    if (!grid) return;
    grid.textContent = '';
    if (browser.observer) browser.observer.disconnect();
    browser.observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var img = entry.target;
          img.src = img.getAttribute('data-src');
          browser.observer.unobserve(img);
        });
      }, { root: grid, rootMargin: '240px' })
      : null;
    var rows = comboFilter($('pb-search').value);
    $('pb-count').textContent = combo.rows.length
      ? rows.length + ' / ' + combo.rows.length + ' 份' : '清單載入中…';
    rows.forEach(function (row) { grid.appendChild(presetCard(row)); });
  }

  function presetCard(row) {
    var isCurrent = row.id === combo.currentId;
    var card = document.createElement('div');
    card.className = 'pb-card' + (isCurrent ? ' current' : '');
    card.title = row.all && row.all.length
      ? row.id + '\n共 ' + row.count + ' 處使用：\n· ' + row.all.join('\n· ')
      : row.id;

    var img = document.createElement('img');
    img.alt = row.id;
    img.setAttribute('data-src', '/__thumbs/' + encodeURIComponent(row.id) + '.png');
    img.onerror = function () { card.classList.add('no-thumb'); };
    img.onclick = function () { openFromBrowser(row.id); };
    if (browser.observer) browser.observer.observe(img);
    else img.src = img.getAttribute('data-src');
    card.appendChild(img);

    var name = document.createElement('div');
    name.className = 'pb-id';
    name.textContent = row.id;
    card.appendChild(name);

    /* 沒有人用就留白：下拉上也是這樣，空白本身就代表沒有被任何地方使用。 */
    var use = document.createElement('div');
    use.className = 'pb-use';
    use.textContent = row.label || '';
    card.appendChild(use);

    var actions = document.createElement('div');
    actions.className = 'pb-actions';
    var open = document.createElement('button');
    open.type = 'button';
    open.textContent = isCurrent ? '目前這份' : '開啟';
    open.disabled = isCurrent;
    open.onclick = function () { openFromBrowser(row.id); };
    var dup = document.createElement('button');
    dup.type = 'button';
    dup.textContent = '複製成新特效';
    dup.title = '以這份為底另存成新的特效，原本那份不會被改到';
    dup.onclick = function () { duplicatePreset(row.id); };
    actions.appendChild(open);
    actions.appendChild(dup);
    card.appendChild(actions);
    return card;
  }

  function openFromBrowser(id) {
    if (id === combo.currentId) { closePresetBrowser(); return; }
    /* 未存檔先問、已開在別的視窗就切過去，都在那裡。取消的話瀏覽特效留著，可以挑別份 */
    openPresetInFocus(id).then(function (opened) { if (opened) closePresetBrowser(); });
  }

  /* 複製成新特效＝以那一份為底「另存新檔」，原本那份不動。
     不另寫一套複製檔案的邏輯：名稱檢查、根群組改名、存檔驗證只有 saveAsPreset 一份。
     已經開著那一份（焦點視窗或別的視窗）時就在那個視窗直接另存（含尚未存檔的修改）；
     沒開著就先開進焦點視窗，載入完成後接著另存。 */
  function duplicatePreset(id) {
    var holder = paneHolding(id);
    if (holder) {
      closePresetBrowser();
      if (holder !== focusedPane) activatePane(holder, {});
      saveAsPreset();
      return;
    }
    if (isDirty() && !window.confirm('目前的修改尚未存檔，開啟另一份會失去這些修改。要繼續嗎？')) {
      return;
    }
    closePresetBrowser();
    var pane = focusedPane;
    openPresetInPane(pane, id).then(function (opened) {
      if (!opened || pane.closed) return;
      /* 載入途中焦點可能被點走了：另存的對象是剛開好的這一份，焦點要跟著回來，
         否則存檔視窗問的名字會套到眼前另一份特效上 */
      if (pane !== focusedPane) activatePane(pane, {});
      saveAsPreset();
    });
  }

  function wirePresetCombo() {
    if (combo.wired) return;
    combo.wired = true;
    var input = $('preset-search');
    var toggle = $('preset-toggle');

    /* 點進搜尋框時，游標定位交給下面的 mousedown 擋掉，這裡才敢做全選。
       歷史紀錄：這一段原本是「取得焦點就清空」，因為當時試過全選而失敗——
       點進來的那一下 mouseup 會把 focus 時做的選取取消掉，於是變成在既有
       文字中間插字，打出來的關鍵字一個都對不上。當時的結論是「不用全選」，
       但真正的原因不是全選不可行，而是少擋一個事件。
       現在由 mousedown 阻止瀏覽器依點擊位置放游標，選取就留得住。

       目前開著哪一份不會因此消失——清單裡那一列有左緣色條標著，
       而且失焦時會把顯示文字放回去。 */
    /* 還原關鍵字→全選→依關鍵字開清單，是一組不可分的動作。抽出來讓
       focus 與箭頭鈕走同一條路：兩邊各寫一次遲早會分家，而分家的症狀是
       「點輸入框有篩選、點箭頭沒有」這種說不清楚的行為差異。 */
    function openComboWithLastQuery() {
      var q = lastComboQuery();
      input.value = q;
      input.select();                           // 直接打就整段取代，不必先清空
      openCombo(q);
    }

    input.addEventListener('focus', openComboWithLastQuery);
    /* 讓 focus 時的全選活下來。第一次點（還沒 focus）時阻止預設行為，
       改成自己呼叫 focus()：瀏覽器就不會在 mouseup 依點擊位置重設選取。
       已經 focus 的情況不攔，這樣第二次點仍然可以把游標放到想改的位置，
       與網址列同一種手感。 */
    input.addEventListener('mousedown', function (e) {
      if (document.activeElement === input) return;
      e.preventDefault();
      input.focus();
    });
    input.addEventListener('input', function () {
      rememberComboQuery(input.value);
      combo.shown = comboFilter(input.value);
      combo.active = 0;
      $('preset-list').hidden = false;
      combo.open = true;
      renderComboList();
    });
    input.addEventListener('blur', function () {
      /* 沒選任何一份就離開＝取消，把顯示文字放回去。 */
      closeCombo();
      input.value = comboDisplayText();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { if (!combo.open) openCombo(input.value); else moveComboActive(1); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { moveComboActive(-1); e.preventDefault(); return; }
      if (e.key === 'Enter') {
        var row = combo.shown[combo.active];
        if (row) choosePreset(row.id);
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        /* Esc 只收掉這個清單，不往上冒泡——外面的 onKeyDown 會拿它去取消拖曳。 */
        closeCombo();
        input.value = comboDisplayText();
        input.blur();
        e.preventDefault();
        e.stopPropagation();
      }
    });

    toggle.addEventListener('mousedown', function (e) {
      e.preventDefault();                       // 不要讓 input 失焦
      if (combo.open) { closeCombo(); return; }
      /* 未聚焦時交給 focus handler；已經聚焦時 focus() 不會再觸發事件，
         必須自己呼叫，否則「按箭頭收起、再按一次」會收得起來卻打不開。
         這裡刻意不補 openCombo('')：那會把剛篩好的清單換成未篩選的全部，
         箭頭鈕與直接點輸入框就會有說不清楚的行為差異。 */
      if (document.activeElement === input) openComboWithLastQuery();
      else input.focus();
    });
  }

  /* ---------------- 複製 Preset 名稱 ----------------

     下拉是原生 <select>，它的文字在任何瀏覽器裡都框不起來，所以「挑好一份特效
     之後把名稱複製走」（貼進文件、prompt、檔名）沒有別的路。

     複製的是**下拉上顯示的那個 id**，也就是實際載入的來源，而不是 state.preset.id：
     後者是可編輯欄位，兩者不一致時存檔本來就會被擋下（見 saveTargetProblem），
     這裡跟著畫面走才不會複製到一個還沒落檔的名字。 */

  var copyFlashTimer = 0;

  function copyPresetName() {
    /* 用載入來源而不是搜尋框裡的文字：那個框裡放的是使用者正在打的關鍵字，
       而且顯示時是「id（用途）」，不是可以直接貼去用的檔名。 */
    var id = state.sourcePresetId || (state.preset && state.preset.id) || '';
    if (!id || state.isNew) return;          // 空白特效還沒有名字可以複製
    writeClipboard(id).then(flashCopyResult);
  }

  /* 兩條路都走，不挑一條：

       execCommand('copy')            走文件自己的編輯指令，也就是使用者按 Ctrl+C
                                      那一條。已被標為 deprecated，但相容性最好。
                                      要求文字在文件裡而且被選取，所以借一個
                                      暫時的 textarea。
       navigator.clipboard.writeText  需要安全來源（127.0.0.1 算），舊環境沒有。

     為什麼不挑一條：**兩條都無法回頭驗證自己有沒有真的寫進去**。readText 需要
     另一個權限而且會跳詢問，所以「回報成功」只代表 API 沒有丟出錯誤。
     2026-09-09 實測：在 Claude Code 的內嵌瀏覽器裡兩條都回報成功、剪貼簿卻完全
     沒變（同一個環境裡真實的 Ctrl+C／Ctrl+V 正常），也就是說那個環境根本不把
     頁面發起的寫入送到系統剪貼簿。既然分不出誰比較可靠，就兩條都試——
     寫的是同一段文字，誰覆蓋誰都不影響結果。

     兩條都回報失敗才顯示失敗，不 silent：複製沒成功卻不說，使用者會貼出
     上一次的內容而且不會發現。 */
  function writeClipboard(text) {
    var legacy = legacyCopy(text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return legacy; });
    }
    return Promise.resolve(legacy);
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    /* 不能用 display:none 或 visibility:hidden——選取不到就複製不了。
       改成移出畫面，並關掉 readonly 之外的一切互動痕跡。 */
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.select();
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function flashCopyResult(ok) {
    var btn = document.getElementById('btn-copy-preset');
    if (!btn) return;
    window.clearTimeout(copyFlashTimer);
    btn.textContent = ok ? '✓ 已複製' : '✕ 失敗';
    btn.classList.toggle('err', !ok);
    copyFlashTimer = window.setTimeout(function () {
      btn.textContent = '⧉ 複製';
      btn.classList.remove('err');
    }, 1400);
  }

  /* ---------------- 編輯器狀態 ----------------

     多視窗（2026-09-17）：預覽區可以切成最多四個視窗，每個視窗各開一份特效。
     state 上的欄位分成兩種：

       全部視窗共用    素材索引、剪貼簿、顯示排序、格線、背景色——直接寫在下面這個物件上
       每個視窗各一份  preset、歷史、選取、預覽 runtime、鏡頭……（DOC_FIELDS／PANE_FIELDS）
                       由 defineProperty 轉到「目前在操作的視窗」（ctx）身上

     既有程式照舊寫 state.preset，拿到的就是那個視窗的 preset。平常 ctx 就是焦點視窗；
     非同步回來的回呼（存檔、載入）與每個視窗自己的繪製迴圈會先用 withPane 換成
     自己的視窗再執行，不會寫到當下剛好有焦點的那一個（見「視窗」段落）。 */
  var state = {
    index: null,
    semantics: null,
    semanticById: {},
    /* assetId → 事實層的 backgroundVariant（見 buildBackgroundMap）。
       篩選要逐筆問，現查太慢，所以攤成一張表。 */
    backgroundById: {},
    vocab: null,             // 篩選下拉的字彙，Asset Browser 與 Picker 共用
    sortMode: 'creation',     // 'creation' | 'name'，純顯示排序
    /* Editor 內部剪貼簿，不碰 OS clipboard。所有視窗共用：A 視窗複製、B 視窗貼上。 */
    clipboard: null,
    resolver: null,
    gridOn: true
  };

  /* 一份特效的編輯狀態。開另一份特效＝換上一個全新的物件，不是逐欄清空：
     preset、layout、歷史、選取全部要換成另一份，整份換掉才能保證不會混到上一份的殘留。 */
  function newDoc() {
    return {
      preset: null,
      /* ---- Layer 面板的狀態 ----
         selectedKeys 是「被選取的」，activeKey 是「有焦點的那一個」。
         兩者必須分開：多選時 Inspector 只能顯示一個，顯示哪一個由 activeKey 決定。
         key 的形式是 'layer:<id>' 或 'group:<id>'，讓兩種列可以放在同一個集合裡。 */
      selectedKeys: [],
      activeKey: null,
      anchorKey: null,          // Shift 範圍選取的起點
      layout: null,             // vfx/layouts/<id>.json 的內容（Editor 專用）
      layoutRevision: 0,
      collapsed: {},            // groupId -> true，只存 localStorage
      dragKeys: null,           // 拖曳中的 key 陣列
      selectedLayerId: null,
      history: null,            // 這一份特效自己的 Undo／Redo（見 initHistory）
      /* 上次「與 repo 檔案一致」的 canonical 文字。
         null 代表這份 preset 從來沒有存回 repo 過（例如從本機檔案匯入的），
         此時一律視為 dirty——比起假裝乾淨，寧可讓人多按一次存檔。 */
      savedText: null,
      savedLayoutText: undefined,   // undefined＝分組還沒載完（見 layoutDirty）
      saving: false,
      layoutSave: null,
      /* 這份內容是「以哪個 id 載進來的」。存檔目標是 preset.id，兩者不一致時
         按下存檔會寫到另一個檔案上——開著 fire-tornado 卻改掉 black-hole.json。
         所以不一致就直接擋住存檔，而不是只顯示一行警告。
         之後做 Save As 時，就是由 Save As 明確地把這個值改成新 id。 */
      sourcePresetId: null,
      /* 新視窗的空白特效：還沒存過檔，名字是暫時的。第一次按儲存要走另存新檔問名字。 */
      isNew: false
    };
  }

  var DOC_FIELDS = Object.keys(newDoc());
  /* 視窗本身（不隨換一份特效而重來）：畫布、預覽 runtime、播放狀態、鏡頭、狀態列訊息。 */
  var PANE_FIELDS = ['app', 'stageRoot', 'bgSolid', 'checker', 'syncCanvasSize', 'effectRoot',
    'backend', 'runtime', 'handle', 'playing', 'previewLoop', 'zoom', 'panX', 'panY', 'pan',
    'previewPending', 'saveStatus', 'validation', 'dirtyFlag', 'deformationSeed'];

  DOC_FIELDS.forEach(function (key) {
    Object.defineProperty(state, key, {
      enumerable: true,
      get: function () { return ctxDoc ? ctxDoc[key] : undefined; },
      set: function (v) { ctxDoc[key] = v; }
    });
  });
  PANE_FIELDS.forEach(function (key) {
    Object.defineProperty(state, key, {
      enumerable: true,
      get: function () { return ctx ? ctx[key] : undefined; },
      set: function (v) { ctx[key] = v; }
    });
  });
  /* 目前操作的不是畫面上的那一份：背景視窗（非同步回呼、逐幀繪製），或這個視窗在等回應的
     這段時間已經換成別份特效了（staleDoc）。面板與工具列顯示的是焦點視窗的現況，
     這時候不能把自己的內容畫上去——資料照寫，切換焦點時 renderPanels 會整組重畫。 */
  Object.defineProperty(state, 'inBackground', {
    get: function () { return !!ctx && (ctx !== focusedPane || ctxDoc !== ctx.doc); }
  });
  Object.defineProperty(state, 'staleDoc', {
    get: function () { return !!ctx && ctxDoc !== ctx.doc; }
  });

  /* ---------------- 視窗：目前在操作哪一個 ----------------

     panes        畫面上的視窗，照閱讀順序（最多 VFXPaneModel.MAX_PANES 個）
     focusedPane  焦點視窗：Layers、Inspector、工具列顯示它，鍵盤與編輯作用在它身上
     selectedPanes  Ctrl+點擊多選的視窗（一定含焦點視窗）：播放、暫停、Restart、預覽循環一起作用
     ctx／ctxDoc  state 的 per-pane／per-doc 欄位此刻指向的視窗與那一份特效。
                  平常就是焦點視窗與它開著的那一份。

     非同步回呼一律用 bindPane 包起來：回應回來時焦點可能已經換到別的視窗，
     這個視窗也可能換成了別份特效——包起來的回呼寫的仍是發出請求的那一份。 */
  var panes = [];
  var focusedPane = null;
  var selectedPanes = [];
  var ctx = null;
  var ctxDoc = null;

  function withPane(pane, fn, doc) {
    var prevPane = ctx, prevDoc = ctxDoc;
    /* 外層原本跟著視窗「現在開著的那一份」：裡面換了一份特效（beginDoc）的話，出來之後要跟到新的，
       不能退回換掉之前的那一份——否則整個編輯器會一直對著已經丟掉的舊文件操作。
       外層本來就綁著某一份（bindPane 帶進來的舊文件）時才照原樣還原。 */
    var followDoc = !!prevPane && prevDoc === prevPane.doc;
    ctx = pane;
    ctxDoc = doc || (pane ? pane.doc : null);
    try { return fn(); }
    finally { ctx = prevPane; ctxDoc = followDoc ? prevPane.doc : prevDoc; }
  }

  function bindPane(fn) {
    var pane = ctx, doc = ctxDoc;
    return function () {
      var self = this, args = arguments;
      return withPane(pane, function () { return fn.apply(self, args); }, doc);
    };
  }

  function paneLabel(pane) { return '視窗 ' + (panes.indexOf(pane) + 1); }

  /* 開著這一份 repo 特效的視窗（沒有就 null）。從本機匯入的也算：兩邊存檔寫的是同一個檔。
     空白特效的名字是暫時的，不算。 */
  function paneHolding(id) {
    for (var i = 0; i < panes.length; i++) {
      var d = panes[i].doc;
      if (!d.preset || d.isNew) continue;
      if (d.sourcePresetId === id || (d.sourcePresetId === null && d.preset.id === id)) return panes[i];
    }
    return null;
  }

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 檢視偏好（背景色、格線、預覽循環）----------------

     放 cookie 而不是 localStorage，理由只有一個：**localStorage 依 origin
     分隔，而 origin 含連接埠**。五份工作副本共用 28361~28370，啟動器抓到哪一個
     埠取決於當下誰先占著——昨天在 28361 調好的背景色，今天開在 28363 就整份
     不見了，看起來就是「編輯器不記得我的設定」。cookie 不分連接埠，
     同一台機器上的編輯器因此共用同一份偏好。

     只放這三個「長期、少量、跨 preset」的偏好。圖層收合狀態仍然留在
     localStorage：那是每一份 preset 各一筆，162 份塞進 cookie 會撞上 4KB 上限，
     而且它本來就是跟著「現在在編哪一份」的短期狀態。 */

  var PREFS_COOKIE = 'vfx-editor-prefs';
  var PREFS_MAX_AGE = 60 * 60 * 24 * 365;

  function readPrefs() {
    try {
      var m = new RegExp('(?:^|; )' + PREFS_COOKIE + '=([^;]*)').exec(document.cookie || '');
      if (!m) return {};
      var o = JSON.parse(decodeURIComponent(m[1]));
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  }

  function writePref(key, value) {
    try {
      var all = readPrefs();
      all[key] = value;
      document.cookie = PREFS_COOKIE + '=' + encodeURIComponent(JSON.stringify(all)) +
        ';path=/;max-age=' + PREFS_MAX_AGE + ';samesite=lax';
    } catch (e) { /* cookie 被關掉就是不記得，不該讓編輯器起不來 */ }
  }

  /* 讀取時順手把舊的 localStorage 值搬過來一次：使用者現有的設定不該因為
     換了儲存方式就被重設成預設值。搬完就以 cookie 為準。 */
  function readPref(key, legacyStorageKey) {
    var prefs = readPrefs();
    if (Object.prototype.hasOwnProperty.call(prefs, key)) return prefs[key];
    var legacy = null;
    try { legacy = window.localStorage.getItem(legacyStorageKey); } catch (e) { }
    if (legacy === null) return undefined;
    writePref(key, legacy);
    return legacy;
  }

  /* ---------------- Inspector 欄位描述（schema 驅動） ---------------- */

  /* range：{ min, max }，與 Core 的驗證同一個範圍。數字框用方向鍵或滾輪調的時候停在邊界上：
     超出範圍的 preset 整份都不能註冊，預覽會停在上一次合法的樣子，縮放、拖曳全都像是失效了
     （2026-09-18 使用者回報：alpha 被方向鍵一路加過 1，「整體縮放沒反應」）。打字仍然打得進去，
     那是明確的輸入，驗證面板會說出原因。 */
  function num(key, label, step, range) {
    var f = { key: key, label: label, kind: 'number', step: step || 0.01 };
    if (range) { f.min = range.min; f.max = range.max; }
    return f;
  }
  /* 角度欄位：畫面上是度，檔案裡是弧度。
     Schema 不動——Core 把 rotation 直接交給 Pixi 的 node.rotation，那就是弧度。
     但整個編輯器（以及遊戲的其他參數表）都以度為單位，Inspector 裡混著
     1.5708 這種數字只會逼人拿計算機。換算集中在這個 kind，不散落各處。 */
  function deg(key, label, step) {
    return { key: key, label: label, kind: 'angle', step: step || 1 };
  }
  /* 角度範圍：值可能是單一數字或 [min, max]（Core 的 sampleRange）。
     兩種形式都要換算，所以不能沿用純 JSON 欄位。 */
  function degRange(key, label) { return { key: key, label: label, kind: 'angleRange' }; }
  function vec(key, label) { return { key: key, label: label, kind: 'vec2' }; }
  function json(key, label) { return { key: key, label: label, kind: 'json' }; }

  var COMMON_FIELDS = [
    { key: 'id', label: 'id', kind: 'text' },
    /* 父子層級（2026-09-17）。選了就換算數值讓畫面不動，見 parentSelect。 */
    { key: 'parent', label: '父物件', kind: 'parent' },
    { key: 'enabled', label: 'enabled', kind: 'bool', default: true },
    { key: 'assetId', label: 'assetId', kind: 'asset' },
    num('zIndex', 'zIndex', 1),
    vec('position', 'position'),
    deg('rotation', 'rotation(°)'),
    vec('scale', 'scale'),
    vec('anchor', 'anchor'),
    num('alpha', 'alpha', 0.01, { min: 0, max: 1 }),
    { key: 'tint', label: 'tint', kind: 'color' },
    { key: 'blendMode', label: 'blendMode', kind: 'select', options: function () { return VFXCore.BLEND_MODES; } },
    num('delay', 'delay(s)', 0.01, { min: 0 }),
    num('duration', 'duration(s)', 0.01, { min: 0 }),
    /* 序列幀（2026-09-06）。掛在共通欄位而不是型別專屬：三種圖層都真的吃得到
       ——procedural 走 TilingSprite，換格等於換它平鋪的那一小塊，
       與 uvScroll 疊起來就是「會播動畫的平鋪紋理」，是有意義的組合。
         { columns, rows, count?, mode?('life'|'fps'), fps?, randomStart?, loop? }
       素材庫目前一張圖集都沒有，所以正式 preset 還沒有人用（Material Gap）。 */
    json('sheet', 'sheet')
  ];

  /* 與 vfx-core.js layerDefaults() 對齊的向量預設值 */
  var VEC_DEFAULTS = {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    outerScale: { x: 1, y: 1 },
    anchor: { x: 0.5, y: 0.5 },
    gravity: { x: 0, y: 0 },
    size: { x: 256, y: 256 },
    scrollSpeed: { x: 0, y: 0 }
  };

  /* ---------------- Over-Life 曲線區塊 ----------------

     每個屬性的 policy 決定值的上下限、單位與顯示換算；curve-editor 本身
     不認識 alpha／scale／rotation，換一個屬性只要換一份 policy。

     透明度**不夾到 1**。alphaOverLife 是乘在 layer.alpha 上的係數，不是
     絕對不透明度：現有 preset（lightning-orb-field-b 的 field-glow、orb-*-glow…）
     大量使用 1.09～1.26 讓亮部過曝。夾到 1 會靜靜改掉這些既有數值，
     那正是規格禁止的行為。所以只夾下限 0（與 Core 的 nonNegative 一致），
     Y 軸基準顯示 0..1，超過就自動放大。 */
  var CURVE_POLICY = {
    alpha: {
      min: 0, max: null, baseline: [0, 1], defaultValue: 1, decimals: 3, unit: ''
    },
    scale: {
      min: 0, max: null, baseline: [0, 1.5], defaultValue: 1, decimals: 3, unit: ''
    },
    /* 旋轉在檔案裡是弧度，在畫面上是度。
       不設上下限：多圈旋轉是常態（黑洞 1440°、虛空盤 1080°、刀環 468°）。
       Y 軸至少顯示 ±360°（一整圈），資料超出就跟著放大；拖曳期間軸凍結，
       拖出框外照同一比例繼續算，放開後軸重新框住全部的點（curve-editor frozenRange）。
       刻度用整數角度，一眼看得出轉了幾分之幾圈。

       min／max／baseline 都是拿來跟**儲存值**比的，所以一律寫成弧度。
       寫 [-360, 360] 會被當成 360 弧度（兩萬多度）——見測試 CURVE-20。
       tickSteps 則是**顯示單位**（度）。 */
    rotation: {
      min: null, max: null,
      baseline: [-Math.PI * 2, Math.PI * 2], defaultValue: 0, decimals: 1,
      unit: '°', toDisplay: VFXCurveModel.radToDeg, fromDisplay: VFXCurveModel.degToRad,
      tickSteps: [1, 5, 15, 30, 45, 90, 180, 360]
    },
    /* 位移與上面三條都不同：它是**加**在 position 上的，不是乘。
       所以預設值是 0（不是 1），而且上下限都放開——位移本來就可以是負的，
       也沒有天然的上界（一道 60 米的貫穿是 600px）。

       基準線取 ±60px＝±6 米，剛好是預覽格線的一大格；資料超出時軸會自動放大。 */
    offset: {
      min: null, max: null, baseline: [-60, 60], defaultValue: 0, decimals: 1, unit: 'px'
    }
  };

  /* 哪些型別支援分軸縮放。與 Core 的 TYPE_ONLY_FIELDS／EMPTY_LAYER_FIELDS 對齊：
     sprite 與 procedural 走 updateSpriteLayer（兩軸各自取樣）；空物件的曲線整組傳給子物件；
     粒子層的兩軸永遠相等。 */
  function supportsPerAxisScale(layer) {
    return layer.type === 'sprite' || layer.type === 'procedural' || layer.type === 'empty';
  }

  /* 外層縮放：在圖層旋轉**之後**才套用，等同把這一層放進一個不會跟著轉的外框。
     只掛 sprite 與 procedural，與 Core 的 TYPE_ONLY_FIELDS 對齊。

     典型用途：讓一個正圓環在固定的橢圓軌道上流動——環自己保持正圓並繞 Z 轉，
     外框固定壓成 X=1／Y=0.3。用 scale 壓的話橢圓會跟著一起轉，長軸就不是水平的了。 */
  var OUTER_SCALE_FIELD = vec('outerScale', 'outerScale（旋轉後）');

  var TYPE_FIELDS = {
    sprite: [OUTER_SCALE_FIELD],
    /* 空物件不畫東西，只收會被子物件繼承的欄位；共通欄位裡不適用的由 fieldsOf 濾掉 */
    empty: [OUTER_SCALE_FIELD],
    particle: [
      json('emission', 'emission'),
      num('maxParticles', 'maxParticles', 1),
      json('lifetime', 'lifetime'),
      json('spawn', 'spawn'),
      json('speed', 'speed'),
      num('direction', 'direction(deg)', 1),
      num('spread', 'spread(deg)', 1),
      vec('gravity', 'gravity'),
      /* 運動的三個補充項（2026-09-06）。都可以留白＝0，留白時的行為與加入
         它們之前完全相同，所以既有 preset 不必也不該補上這些欄位。
           drag         每秒衰減率，1/(1+drag*dt)
           radialSpeed  px／秒，正＝離心、負＝向心（吸引子）
           orbitalSpeed 畫面上是度／秒、檔案裡是弧度／秒；正值在螢幕上是順時針
           noise        { strength(px), frequency(每 px 的週期), scrollSpeed(每秒) }
                        位移擾動，不進速度，所以粒子不會被吹走 */
      num('drag', 'drag(/s)', 0.1),
      num('radialSpeed', 'radialSpeed(px/s)', 1),
      deg('orbitalSpeed', 'orbitalSpeed(°/s)', 1),
      json('noise', 'noise'),
      /* 子發射器（2026-09-06）：{ layer, on?('death'|'birth'), count?, inheritVelocity? }
         目標層必須是同一份 preset 裡 emission.mode = 'sub' 的 particle 層。
         驗證會擋掉指錯層、目標不是 sub、沒人觸發的 sub 層、以及成環。 */
      json('subEmitter', 'subEmitter'),
      json('startScale', 'startScale'),
      degRange('rotationStart', 'rotationStart(°)'),
      degRange('rotationSpeed', 'rotationSpeed(°/s)'),
      /* particle 專屬：只掛在 TYPE_FIELDS.particle 底下，
         sprite／procedural 的 Inspector 不會出現這兩欄。 */
      { key: 'alignToVelocity', label: 'alignToVelocity', kind: 'bool', default: false },
      deg('velocityRotationOffset', 'velocityRotationOffset(°)')
    ],
    procedural: [
      { key: 'effect', label: 'effect', kind: 'select', options: function () { return VFXCore.PROCEDURAL_EFFECTS; } },
      vec('size', 'size(px)'),
      vec('scrollSpeed', 'scrollSpeed'),
      OUTER_SCALE_FIELD
    ]
  };

  /* ---------------- 資料載入 ---------------- */

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---------------- Asset Browser ---------------- */

  /* 用 createElement + textContent，不用 innerHTML 拼字串：
     語意 metadata 是產生出來的資料，不應該有機會變成 Editor 的 DOM。 */
  /* group 是詞彙表的分組名（shape／usage／element／tag）。
     option 的 value 一律維持英文原值——它會直接拿去和 semantics 檔比對，
     改成中文就等於把顯示問題變成資料問題。只有 textContent 換成中文。 */
  function fillSelect(el, values, group) {
    el.textContent = '';
    var all = document.createElement('option');
    all.value = '';
    /* 沒登記在詞彙表裡的分組（例如圖層型別）就用原字串當標題。
       少了這個 fallback，第一個選項會顯示成「undefined（全部）」。 */
    all.textContent = (VFXSemanticVocab.LABELS.field[group] || group) + '（全部）';
    el.appendChild(all);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = VFXSemanticVocab.labelOf(group, v);
      el.appendChild(o);
    });
  }

  /* prefix 是控制項的 id 前綴。左欄原本還有一組 'f-' 的素材瀏覽器，2026-09-10
     整區刪掉了——選材的實際流程一直是走素材選擇器（有預覽、有詳情、有篩選），
     那份 300 列的清單只是把左欄佔滿。留下 prefix 參數是因為篩選邏輯本來就是
     共用的，之後要再開第二個選擇器不必動這裡。 */
  function currentAssetFilters(prefix) {
    var p = prefix || 'pf-';
    return {
      text: $(p + 'text').value.trim().toLowerCase(),
      usage: $(p + 'usage').value,
      shape: $(p + 'shape').value,
      element: $(p + 'element').value,
      tag: $(p + 'tag').value,
      background: $(p + 'background').value,
      high: $(p + 'high').checked
    };
  }

  /* assetId → backgroundVariant。

     其他篩選條件都在語意紀錄上，背景底色卻在**事實層**（asset-index 的
     facts.backgroundVariant）——那是量出來的，不是判斷出來的，所以刻意
     沒有被複製進語意檔（見 vfx-semantic-vocab 的 blendModeFromFacts）。

     篩選要逐筆問，所以先攤成一張表。用 findById 現查的話是每筆掃一次
     2399 筆的陣列，2111 筆語意紀錄就是五百萬次比對——每打一個字重跑一次。 */
  function buildBackgroundMap() {
    var map = Object.create(null);
    (state.index.assets || []).forEach(function (a) {
      if (a.facts && a.facts.backgroundVariant) map[a.assetId] = a.facts.backgroundVariant;
    });
    state.backgroundById = map;
  }

  function filterAssets(prefix, limit) {
    var cap = limit || 300;
    var f = currentAssetFilters(prefix);
    var out = [];
    for (var i = 0; i < state.semantics.records.length; i++) {
      var rec = state.semantics.records[i];
      if (rec.kind !== 'vfx') continue;                  // 植物與宣傳圖不進選材清單
      if (f.high && rec.confidence !== 'high') continue;
      if (f.shape && rec.shape !== f.shape) continue;
      if (f.element && rec.element !== f.element) continue;
      if (f.usage && (!rec.usage || rec.usage.indexOf(f.usage) < 0)) continue;
      if (f.tag && (!rec.tags || rec.tags.indexOf(f.tag) < 0)) continue;
      if (f.background && state.backgroundById[rec.assetId] !== f.background) continue;
      if (f.text && rec.assetId.toLowerCase().indexOf(f.text) < 0) continue;
      out.push(rec);
      if (out.length >= cap) break;                      // 清單上限，避免一次塞上千個 DOM
    }
    return out;
  }

  /* ---------------- Asset Picker ----------------

     選的是 Asset Library Index 裡的 assetId，不是檔案系統路徑。刻意不用作業
     系統的檔案選擇器：那會選到本機絕對路徑，一旦寫進 Preset 就不可攜，
     換一台電腦或別人 clone 下來就壞。

     搜尋與篩選直接重用 Asset Browser 的 filterAssets()，沒有第二套實作。 */

  /* layers 為 null 而 createType 有值＝「挑一張素材，直接新增成一個圖層」。
     兩種用法共用同一個對話框，因為挑素材這件事本身完全一樣——差別只在
     選完之後把 assetId 寫到哪裡。 */
  var picker = { layers: null, field: 'assetId', selected: null, createType: null };

  function wirePicker() {
    ['pf-text', 'pf-usage', 'pf-shape', 'pf-element', 'pf-tag', 'pf-background', 'pf-high']
      .forEach(function (id) { $(id).addEventListener('input', renderPickerList); });
    $('picker-close').onclick = closePicker;
    $('picker-apply').onclick = applyPicker;
    $('picker').addEventListener('mousedown', function (e) {
      if (e.target === $('picker')) closePicker();          // 點外框關閉
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('picker').hidden) { closePicker(); e.preventDefault(); }
    });
  }

  /* layers 是 Inspector 目前的編輯對象：單選時一層，多選時全部選到的圖層。
     各層素材不同時不預選任何一個——預選第一層的，「直接按套用」就會把全部換成
     第一層的素材，而使用者可能根本沒注意到它們原本不同。 */
  function openPicker(layers, field) {
    picker.layers = layers;
    picker.field = field;
    picker.createType = null;
    var shared = MX.commonValue(layers, function (l) { return l[field] || null; });
    picker.selected = shared.mixed ? null : shared.value;
    $('picker-target').textContent = layers.length === 1
      ? '圖層 ' + layers[0].id : layers.length + ' 個圖層';
    showPicker();
  }

  /* 「＋ 新增素材」：挑完直接長出一個新圖層，不必先新增空圖層再回頭選素材。
     型別沿用 Layers 那個下拉——它本來就是「我要加哪一種圖層」的控制項，
     這裡另外訂一個預設值只會讓兩顆按鈕的行為不一致。 */
  function openPickerForNewLayer() {
    if (!state.preset) return;
    picker.layers = null;
    picker.field = 'assetId';
    /* 空物件不畫東西、沒有素材欄位：挑了素材就是要一張圖，改成 sprite */
    var wanted = $('new-layer-type').value;
    picker.createType = wanted && wanted !== 'empty' ? wanted : 'sprite';
    picker.selected = null;
    $('picker-target').textContent = '新增 ' + picker.createType + ' 圖層';
    showPicker();
  }

  function showPicker() {
    /* 按鈕文字跟著用途走：同一個對話框在「換掉這一層的素材」與「長出一個新
       圖層」兩種情境下按下去的結果不一樣，標籤不能只寫一種。 */
    $('picker-apply').textContent = picker.createType ? '新增為圖層'
      : (picker.layers && picker.layers.length > 1
        ? '套用到 ' + picker.layers.length + ' 個圖層' : '套用到目前圖層');
    $('picker').hidden = false;
    renderPickerList();
    renderPickerDetail();
    $('pf-text').focus();
  }

  function closePicker() {
    $('picker').hidden = true;
    picker.layers = null;
    picker.createType = null;
    picker.selected = null;
  }

  function applyPicker() {
    if (!picker.selected) return;
    var value = picker.selected;
    if (picker.createType) {
      var type = picker.createType;
      /* 新增與設定素材是一步，不是兩步：分成兩筆歷史的話，Ctrl+Z 一次只會
         把素材清掉、留下一個空圖層，看起來像沒還原乾淨。 */
      edit('新增素材圖層', function () { addLayerInner(type, value); });
      closePicker();
      return;
    }
    if (!picker.layers || !picker.layers.length) return;
    var targets = picker.layers, field = picker.field;
    edit('更換素材', function () { MX.writeAll(targets, field, value); onPresetChanged(); });
    closePicker();
    renderInspector();
  }

  function renderPickerList() {
    var rows = filterAssets('pf-', 400);
    $('picker-count').textContent = rows.length + ' 筆' + (rows.length >= 400 ? '（已截斷）' : '');
    var host = $('picker-list');
    host.textContent = '';
    rows.forEach(function (rec) {
      var cell = document.createElement('div');
      cell.className = 'pick' + (rec.assetId === picker.selected ? ' sel' : '');
      cell.title = rec.assetId;
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.src = state.resolver.resolve(rec.assetId);
      var name = document.createElement('span');
      name.textContent = rec.assetId.split('/').pop();
      cell.appendChild(img); cell.appendChild(name);
      cell.onclick = function () {
        picker.selected = rec.assetId;
        renderPickerList();
        renderPickerDetail();
      };
      cell.ondblclick = applyPicker;
      host.appendChild(cell);
    });
    $('picker-apply').disabled = !picker.selected;
  }

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) { if (list[i].assetId === id) return list[i]; }
    return null;
  }

  function renderPickerDetail() {
    var host = $('picker-preview');
    var meta = $('picker-meta');
    host.textContent = ''; meta.textContent = '';
    if (!picker.selected) return;

    var img = document.createElement('img');
    img.src = state.resolver.resolve(picker.selected);
    host.appendChild(img);

    function row(k, v) {
      if (v === undefined || v === null || v === '') return;
      var line = document.createElement('div'); line.className = 'row2';
      var a = document.createElement('span'); a.className = 'k'; a.textContent = k;
      var b = document.createElement('span'); b.className = 'v'; b.textContent = String(v);
      line.appendChild(a); line.appendChild(b); meta.appendChild(line);
    }

    var sem = findById(state.semantics.records, picker.selected);
    var fact = findById(state.index.assets, picker.selected);
    var L = VFXSemanticVocab.labelOf;
    row('assetId', picker.selected);
    if (fact && fact.facts && fact.facts.dimensions) {
      row('尺寸', fact.facts.dimensions.width + ' × ' + fact.facts.dimensions.height);
    }
    if (sem) {
      /* 這裡跟著下拉選單一起中文化，但保留括號裡的英文原值：
         使用者用中文找素材，看到的資訊要對得上他剛才選的那一項。 */
      row('形狀', L('shape', sem.shape));
      row('用途', (sem.usage || []).map(function (u) { return L('usage', u); }).join('、'));
      row('元素', L('element', sem.element));
      row('標籤', (sem.tags || []).map(function (t) { return L('tag', t); }).join('、'));
      row('信心', L('confidence', sem.confidence) + (sem.needsReview ? ' 需人工確認' : ''));
    }
    /* blendMode 與 tintable 是**推導**出來的，不是存下來的欄位。規則只有一份，
       在 vfx-semantic-vocab.cjs，這裡直接呼叫，不在 Editor 裡抄第二份。 */
    if (fact && fact.facts) {
      row('背景', fact.facts.backgroundVariant);
      var bm = VFXSemanticVocab.blendModeFromFacts(fact.facts);
      row('建議 blend', bm === 'additive' ? 'add' : (bm === 'alphaBlend' ? 'normal' : bm));
      var tint = VFXSemanticVocab.tintableFromFacts(fact.facts);
      row('可染色', tint === null ? '未知' : (tint ? '是（灰階，可用 tint 換色）' : '否（已上色）'));
    }
  }


  /* ---------------- Preview Gizmo ----------------

     選取的圖層在預覽上會出現一個框，可以直接拖曳移動、縮放、旋轉。

     三個必須守住的邊界：

     1. **不進 Renderer。** 框畫在 app.stage 底下、stageRoot 之外的另一個容器，
        後端從頭到尾看不到它。正式遊戲的 Runtime 也不會知道有 gizmo 這回事。
     2. **只改 base transform。** 曲線在當下時間的取樣值不寫回 preset，
        否則播到 1.5 倍時拖一下就變 2.25，再拖一次 3.375。
     3. **座標換算集中一處。** 不直接用 clientX 加減，否則之後加 zoom 或
        換 DPI 一定壞。 */

  var gizmo = {
    assetSize: null         // assetId → { width, height }（全部視窗共用）
  };
  /* 框的圖層、畫筆、重畫旗標與拖曳狀態每個視窗各一份（newPane 的 gizmo），
     這裡轉到目前操作的視窗上，程式照舊寫 gizmo.drag。 */
  ['overlay', 'gfx', 'dirty', 'drag'].forEach(function (key) {
    Object.defineProperty(gizmo, key, {
      get: function () { return ctx ? ctx.gizmo[key] : null; },
      set: function (v) { if (ctx) ctx.gizmo[key] = v; }
    });
  });

  /* 素材尺寸取自 asset-index 的事實層。不問 renderer：貼圖可能還沒載完，
     而且那會讓框的大小取決於載入時序。 */
  function buildAssetSizeMap() {
    var map = Object.create(null);
    (state.index.assets || []).forEach(function (a) {
      var d = a.facts && a.facts.dimensions;
      if (d) map[a.assetId] = { width: d.width, height: d.height };
    });
    gizmo.assetSize = map;
  }

  function sizeOf(layer) {
    var size = (gizmo.assetSize && layer.assetId && gizmo.assetSize[layer.assetId]) || null;
    // 序列素材的編輯框使用單格尺寸，不能把整張 atlas 當成水柱本體。
    if (layer.effect === 'waterTornado') return { width: 320, height: 320 };
    if (size && layer.sheet) return { width: size.width / layer.sheet.columns, height: size.height / layer.sheet.rows };
    return size;
  }

  function boundsOf(layer) { return G.baseBounds(layer.effect === 'waterTornado' ? Object.assign({}, layer, { type: 'sprite' }) : layer, sizeOf(layer)); }

  /* 父子層級：圖層的 position／rotation／scale 所在的座標＝父物件的世界矩陣（基本數值）。
     框、把手與拖曳的數學都在這個座標裡算（見 gizmo-model.js「父子層級的座標空間」）。
     根層級回傳 undefined：原本的路徑一個位元都不差。 */
  function spaceOf(layer) {
    var pid = H.parentIdOf(layer);
    return pid ? H.parentMatrixOf(state.preset, pid) : undefined;
  }

  /* 一起變形時只動最上層：父物件與它的子物件同時在裡面時，子物件跟著父物件走，
     自己再動一次就是動兩次。 */
  function transformRoots(layers) {
    var inSet = {};
    layers.forEach(function (l) { inSet[l.id] = true; });
    return layers.filter(function (l) {
      return !H.ancestorIds(state.preset, l.id).some(function (a) { return inSet[a]; });
    });
  }

  /* 在預覽區點選時認得到的圖層。空物件不畫東西，點到它等於點穿到看不見的框，
     會搶走底下真正看得到的圖層（空物件從圖層面板選）；父物件停用的子物件在遊戲裡不會出現。 */
  function pickableLayers() {
    return state.preset.layers.filter(function (l) {
      if (l.type === 'empty') return false;
      return !H.ancestorIds(state.preset, l.id).some(function (a) { return layerById(a).enabled === false; });
    });
  }

  /* 目前的變形目標。圖層與群組共用同一套框、把手與拖曳邏輯，
     差別只在「動的是一層還是一批」。

     群組是 authoring 上的父物件，但 preset 裡沒有父子結構——
     變形會當場攤到子圖層的 base transform 上，存出去仍是一張平的表。
     細節見 gizmo-model.js 的「群組變形」段落。 */
  function gizmoTarget() {
    /* 多選：每一層各有自己的框，拖其中任何一層都帶著其他選到的一起動
       （見 gizmo-model.js 的「多選變形」）。判斷條件與 Inspector 共用 inspectorTargets——
       左邊選了幾層，框就畫幾個、Inspector 就寫幾層，不會各說各話。 */
    var many = inspectorTargets();
    if (many.length > 1) {
      var movers = transformRoots(many);
      return {
        kind: 'multi', layers: movers,
        items: movers.map(function (l) {
          return { layer: l, bounds: boundsOf(l), caps: G.capabilities(l), space: spaceOf(l) };
        })
      };
    }
    var layer = selectedLayer();
    if (layer) {
      return {
        kind: 'layer', layer: layer, layers: [layer],
        bounds: boundsOf(layer), caps: G.capabilities(layer), space: spaceOf(layer)
      };
    }
    var g = activeGroup();
    if (!g) return null;
    var members = g.layerIds.map(layerById).filter(Boolean);
    if (!members.length) return null;
    /* 框包住全部成員（子物件也在畫面上）；變形只寫最上層，子物件跟著父物件走 */
    return {
      kind: 'group', group: g, layers: transformRoots(members),
      bounds: G.groupBounds(members, sizeOf, spaceOf), caps: G.groupCapabilities(members)
    };
  }

  /* 目標拆成「一個一個框」：單層與群組各一個，多選時每層一個。
     畫框、命中把手、游標形狀都走這一份，不必各自分三種情況。 */
  function gizmoItems(target) {
    if (!target) return [];
    if (target.kind === 'multi') return target.items;
    return target.bounds
      ? [{ layer: target.layer || null, bounds: target.bounds, caps: target.caps, space: target.space }] : [];
  }

  /* 滑鼠底下的把手。多選時所有框的把手一起比、取最近的那個；
     回傳的把手帶著 item（第幾個框）——拖曳要知道以哪一層為基準。 */
  function hitGizmoHandle(items, pt) {
    var list = [];
    items.forEach(function (it, i) {
      /* 把手的位置換到特效座標再比：命中半徑是螢幕上的固定像素，在父物件座標裡比會被它的縮放拉歪 */
      G.handles(it.bounds, it.caps).forEach(function (h) {
        var p = G.mapPoint(it.space, h);
        list.push({ id: h.id, kind: h.kind, axis: h.axis, x: p.x, y: p.y, item: i });
      });
    });
    return G.hitHandle(pt, list, screenRadiusToLocal(9));
  }

  /* 滑鼠底下是第幾個框的內部（-1＝都不是）。多選時重疊的框照繪製順序取最上面那層，
     與點選圖層的規則一致。 */
  function hitGizmoBody(target, items, pt) {
    if (target.kind === 'multi') {
      var hit = G.hitLayer(pt, target.layers, boundsOf, spaceOf);
      for (var i = 0; hit && i < items.length; i++) {
        if (items[i].layer === hit && items[i].caps.move) return i;
      }
      return -1;
    }
    var local = G.unmapPoint(items[0].space, pt);
    return items[0].caps.move && local && G.insideBounds(local, items[0].bounds) ? 0 : -1;
  }

  /* ---------------- 座標換算 ----------------

     client（滑鼠事件）→ preview（畫布內像素）→ effect-local（特效原點為 0,0）

     preview 這一段用 canvas 的實際 bounding rect 去換算，而不是假設
     1 CSS px = 1 renderer px：畫布被 CSS 縮放、DPR 不是 1、或之後加了 zoom，
     這個比例就不是 1。全部集中在這兩個函式裡，之後加 zoom 只要改這裡。 */
  function clientToPreview(clientX, clientY) {
    var rect = state.app.canvas.getBoundingClientRect();
    var sx = rect.width ? state.app.renderer.width / rect.width : 1;
    var sy = rect.height ? state.app.renderer.height / rect.height : 1;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }

  /* stageRoot 目前只被平移到畫布中心（見 boot 的 centre()），沒有縮放或旋轉。
     還是把 scale 與 rotation 算進去，這樣之後加 zoom 不必回頭改拖曳邏輯。 */
  function previewToEffectLocal(px, py) {
    var root = state.stageRoot;
    var dx = px - root.x, dy = py - root.y;
    var s = root.scale && root.scale.x ? root.scale.x : 1;
    var rot = root.rotation || 0;
    if (rot) {
      var c = Math.cos(-rot), sn = Math.sin(-rot);
      var rx = dx * c - dy * sn, ry = dx * sn + dy * c;
      dx = rx; dy = ry;
    }
    return { x: dx / s, y: dy / s };
  }

  function clientToEffectLocal(clientX, clientY) {
    var p = clientToPreview(clientX, clientY);
    return previewToEffectLocal(p.x, p.y);
  }

  /* 螢幕上想要固定的像素半徑，換算成 effect 單位 */
  function screenRadiusToLocal(px) {
    var root = state.stageRoot;
    var s = root.scale && root.scale.x ? root.scale.x : 1;
    return px / s;
  }

  /* ---------------- 繪製 ---------------- */

  function ensureOverlay() {
    if (gizmo.overlay) return;
    /* 加在 stageRoot **之後**＝畫在特效上面，而且與 stageRoot 平行——
       後端只拿到 stageRoot，永遠碰不到這一層。 */
    var c = new PIXI.Container();
    c.x = state.stageRoot.x; c.y = state.stageRoot.y;
    state.app.stage.addChild(c);
    var g = new PIXI.Graphics();
    c.addChild(g);
    gizmo.overlay = c;
    gizmo.gfx = g;
  }

  function markGizmoDirty() { gizmo.dirty = true; }

  /* 只在需要時重畫。每幀 clear() 一個 Graphics 是實測過的效能陷阱，
     而 base transform 只有在編輯時才會變。 */
  function drawGizmo() {
    if (!gizmo.gfx) return;
    var c = gizmo.overlay;
    /* 只有焦點視窗畫框：其他視窗是拿來看的，框留在那裡會讓人以為拖下去改的是它 */
    var shown = !state.inBackground;
    if (c.visible !== shown) { c.visible = shown; gizmo.dirty = true; }
    if (!shown) return;
    /* 框畫的是 effect-local 座標，所以這一層要與 stageRoot 保持同一個變換：
       畫布尺寸變了要跟著移動，縮放變了要跟著縮。少同步 scale 的話，
       放大之後框會停在 100% 的大小，看起來像框跑掉了。
       把手與十字的**螢幕**尺寸不受影響——它們走 screenRadiusToLocal 反算。 */
    if (c.x !== state.stageRoot.x || c.y !== state.stageRoot.y ||
        c.scale.x !== state.stageRoot.scale.x) {
      c.x = state.stageRoot.x; c.y = state.stageRoot.y;
      c.scale.set(state.stageRoot.scale.x, state.stageRoot.scale.y);
      gizmo.dirty = true;
    }
    if (!gizmo.dirty) return;
    gizmo.dirty = false;

    var g = gizmo.gfx;
    g.clear();
    var target = gizmoTarget();
    var items = gizmoItems(target);
    if (!items.length) return;
    /* 群組用綠色粗線區分，一眼看得出動的是一整批而不是單層 */
    var isGroup = target.kind === 'group';
    /* 多選時每一層都有框與把手，抓哪一個都帶著全部一起動。作用中的那一層
       （清單上有外框的那列）畫得最亮，其餘淡一點——看得出 Inspector 以誰為準。 */
    var active = selectedLayer();
    items.forEach(function (it) {
      var dim = target.kind === 'multi' && it.layer !== active;
      drawGizmoBox(g, it.bounds, it.caps, isGroup, dim ? 0.5 : 1, it.space);
    });
  }

  /* 一個框：外框、旋轉把手的連線、pivot 十字、把手。emphasis 1＝正常，越小越淡。
     space：框所在的父物件座標。每個點換到特效座標再畫——父物件非等比縮放時框是平行四邊形，
     與畫面上的圖一致；十字與把手的大小仍是螢幕上的固定像素。 */
  function drawGizmoBox(g, b, caps, isGroup, emphasis, space) {
    var hs = G.handles(b, caps).map(function (h) {
      var p = G.mapPoint(space, h);
      return { kind: h.kind, x: p.x, y: p.y };
    });
    var corners = [
      { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }
    ].map(function (p) { return G.mapPoint(space, G.rotateAround(p, b.pivot, b.rotation)); });

    /* 框。白色細線在任何背景上都看得見，而且不會被誤認為特效的一部分。 */
    g.moveTo(corners[0].x, corners[0].y);
    corners.slice(1).forEach(function (p) { g.lineTo(p.x, p.y); });
    g.lineTo(corners[0].x, corners[0].y);
    g.stroke({ width: isGroup ? 2 : 1, color: isGroup ? 0x9be08a : 0xffffff, alpha: 0.85 * emphasis });

    /* 旋轉把手到框上緣的連線 */
    var rot = hs.filter(function (h) { return h.kind === 'rotate'; })[0];
    if (rot) {
      var top = G.mapPoint(space, G.rotateAround({ x: b.x + b.w / 2, y: b.y }, b.pivot, b.rotation));
      g.moveTo(top.x, top.y); g.lineTo(rot.x, rot.y);
      g.stroke({ width: 1, color: 0xffffff, alpha: 0.5 * emphasis });
    }

    /* pivot：十字，標出 position 實際落在哪裡（受 anchor 影響） */
    var pv = G.mapPoint(space, b.pivot), r = screenRadiusToLocal(6);
    g.moveTo(pv.x - r, pv.y); g.lineTo(pv.x + r, pv.y);
    g.moveTo(pv.x, pv.y - r); g.lineTo(pv.x, pv.y + r);
    g.stroke({ width: 1, color: 0xffb454, alpha: 0.95 * emphasis });

    var hr = screenRadiusToLocal(4);
    hs.forEach(function (h) {
      if (h.kind === 'rotate') {
        g.circle(h.x, h.y, hr);
        g.fill({ color: 0x7fb2ff, alpha: emphasis });
        g.stroke({ width: 1, color: 0xffffff, alpha: 0.9 * emphasis });
      } else {
        g.rect(h.x - hr, h.y - hr, hr * 2, hr * 2);
        g.fill({ color: 0xffffff, alpha: emphasis });
      }
    });
  }

  /* ---------------- 指標操作 ---------------- */

  /* keepSelection：這一下同時把焦點切到這個視窗（見 onPanePointerDown），點到空白處也不取消選取 */
  function onPreviewPointerDown(e, keepSelection) {
    if (!state.preset || !state.app) return;
    /* 中鍵或右鍵＝拖曳平移鏡頭。preventDefault 同時擋掉瀏覽器的中鍵自動捲動
       （右鍵選單另外由 contextmenu 擋，見 wirePreviewView）。 */
    if (e.button === 1 || e.button === 2) { e.preventDefault(); beginPan(e); return; }
    if (e.button !== 0) return;
    var pt = clientToEffectLocal(e.clientX, e.clientY);
    var target = gizmoTarget();
    var items = gizmoItems(target);

    /* 先問把手，再問框內，最後才重新選取：
       已經選好的目標上有把手時，把手優先，否則永遠拖不到角落。
       多選時每一層的框都算，抓到哪一層，那一層就是這次拖曳的基準。 */
    if (items.length) {
      /* 多選時在框上點一下（沒有拖）＝只選這一層。不這樣做的話，選好一批之後
         在預覽區就再也點不出單獨一層，只能回左邊清單。
         把手也算：小物件的框只有十幾 px，把手的命中範圍會蓋滿整個框，
         只認框內的話那種物件永遠點不出來（2026-09-14 實測擴散圈）。 */
      var h = hitGizmoHandle(items, pt);
      if (h) {
        beginDrag(target, h.kind, h, pt, items[h.item].bounds, h.item);
        if (target.kind === 'multi') gizmo.drag.collapseTo = items[h.item].layer.id;
        e.preventDefault(); return;
      }
      var inside = hitGizmoBody(target, items, pt);
      if (inside >= 0) {
        beginDrag(target, 'move', null, pt, items[inside].bounds, inside);
        if (target.kind === 'multi') gizmo.drag.collapseTo = items[inside].layer.id;
        e.preventDefault(); return;
      }
    }

    /* 沒打中就當作重新選取。命中規則與繪製順序一致：最上面的優先。 */
    var hit = G.hitLayer(pt, pickableLayers(), boundsOf, spaceOf);
    if (!hit) {
      /* 點到空白處＝取消選取（2026-09-17 使用者要求）。keepSelection：這一下是用來把焦點
         切到這個視窗的，只換焦點、保留它原本的選取——切過去多半是要接著調那一層 */
      if (!keepSelection) clearSelection();
      return;
    }
    selectLayerById(hit.id);
    /* 選到就直接可以拖，不必先放開再按一次 */
    var nt = gizmoTarget();
    if (nt && nt.caps.move) beginDrag(nt, 'move', null, pt, nt.bounds);
    e.preventDefault();
  }

  var DRAG_LABEL = { move: '移動', scale: '縮放', rotate: '旋轉' };
  var DRAG_WHAT = { layer: '圖層', group: '群組', multi: '多個圖層' };

  /* itemIndex：多選時被抓的是第幾層——它的 pivot 與角度是這次拖曳的基準 */
  function beginDrag(target, mode, handle, startPoint, bounds, itemIndex) {
    /* 一次拖曳＝一筆歷史。pointermove 期間只更新畫面，不記錄。 */
    editBegin((DRAG_LABEL[mode] || '變形') + (DRAG_WHAT[target.kind] || '圖層'));
    var multi = target.kind === 'multi';
    /* 被抓的那個框所在的父物件座標。起點與之後每一個滑鼠位置都換進這裡，
       pivot 與角度本來就是框在這個座標裡的值，拖曳的數學與根層級相同。
       換不過去（父物件縮放是 0）就留在特效座標——那種圖層畫面上看不到，框也抓不到。 */
    var space = multi ? target.items[itemIndex || 0].space : target.space;
    gizmo.drag = {
      target: target,
      mode: mode,
      handle: handle,
      space: space,
      /* 多選時每一層各自的父物件座標：同一個畫面位移換到各層是不同的數字 */
      spaces: multi ? target.items.map(function (it) { return it.space; }) : null,
      startPoint: G.unmapPoint(space, startPoint) || startPoint,
      pivot: { x: bounds.pivot.x, y: bounds.pivot.y },
      rotation: bounds.rotation,
      /* 群組要多存幾個欄位：縮放會動到粒子的 speed／spawn／startScale，
         旋轉會動到 direction 與 gravity。多選是每層各存一份。 */
      snap: target.kind === 'group' ? G.groupSnapshot(target.layers)
        : multi ? G.multiSnapshot(target.layers) : G.snapshot(target.layer),
      ref: multi ? (itemIndex || 0) : 0,
      caps: multi ? target.items.map(function (it) { return it.caps; }) : null,
      startScale: target.kind !== 'layer'
        ? null : (target.layer.scale ? { x: target.layer.scale.x, y: target.layer.scale.y } : { x: 1, y: 1 }),
      collapseTo: null,
      moved: false
    };
    setPreviewCursor(mode);
  }

  function onPreviewPointerMove(e) {
    if (!ctx) return;
    if (state.pan) { updatePan(e); e.preventDefault(); return; }
    if (!gizmo.drag) {
      updateHoverCursor(e);
      return;
    }
    var d = gizmo.drag;
    var pt = clientToEffectLocal(e.clientX, e.clientY);
    var shift = e.shiftKey;

    if (d.target.kind === 'group') dragGroup(d, pt, shift);
    else if (d.target.kind === 'multi') dragMulti(d, pt, shift);
    else dragLayer(d, pt, shift);

    d.moved = true;
    markGizmoDirty();
    syncTransformInputs();
    previewSoon();                // rAF 合併，不重載素材
    e.preventDefault();
  }

  function dragLayer(d, pt, shift) {
    pt = G.unmapPoint(d.space, pt);
    if (!pt) return;
    var layer = d.target.layer;
    if (d.mode === 'move') {
      layer.position = G.applyMove(d.snap.position || { x: 0, y: 0 }, d.startPoint, pt, { snap: shift });
    } else if (d.mode === 'scale') {
      layer.scale = G.applyScale(d.snap.scale || { x: 1, y: 1 }, d.handle,
        d.pivot, d.rotation, d.startPoint, pt, { snap: shift });
    } else if (d.mode === 'rotate') {
      layer.rotation = G.applyRotate(d.snap.rotation || 0, d.pivot, d.startPoint, pt, { snap: shift });
    }
  }

  /* 群組：把一次變形量攤到所有子圖層。每次都從快照重算，不累加。 */
  function dragGroup(d, pt, shift) {
    var delta = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0 };
    if (d.mode === 'move') {
      var m = G.applyMove({ x: 0, y: 0 }, d.startPoint, pt, { snap: shift });
      delta.dx = m.x; delta.dy = m.y;
    } else if (d.mode === 'scale') {
      /* 借用單層的縮放計算：以 1 當起始倍率，算出來的就是倍率本身 */
      var f = G.applyScale({ x: 1, y: 1 }, d.handle, d.pivot, 0, d.startPoint, pt, { snap: shift });
      delta.sx = f.x; delta.sy = f.y;
    } else if (d.mode === 'rotate') {
      delta.rot = G.applyRotate(0, d.pivot, d.startPoint, pt, { snap: shift });
    }
    writeGroupDelta(d.target.layers, d.snap, d.pivot, delta);
  }

  /* 群組變形寫回成員。框與變形量都在特效座標；成員的父物件不在群組裡時（它的數值相對那個
     父物件），把 pivot 與變形量換進那個父物件的座標再套。根層級的成員原樣，與加入父子層級之前相同。 */
  function writeGroupDelta(layers, snaps, pivot, delta) {
    G.writeGroupTransform(layers, snaps.map(function (snap, i) {
      var local = G.groupDeltaInSpace(pivot, delta, spaceOf(layers[i]));
      return local ? G.applyGroupTransform([snap], local.pivot, local.delta)[0] : { id: snap.id };
    }));
  }

  /* 多選：由被抓的那一層算出相對量（位移、倍率、角度），每一層各自繞自己的 pivot 套用。
     每次都從快照重算，不累加。 */
  function dragMulti(d, pt, shift) {
    pt = G.unmapPoint(d.space, pt);
    if (!pt) return;
    var delta = G.multiDelta(d.mode, d.snap[d.ref], d.handle, d.pivot, d.rotation,
      d.startPoint, pt, { snap: shift });
    /* 由被抓那一層的座標換到每一層自己的父物件座標 */
    var deltas = d.spaces.map(function (s) { return G.deltaToSpace(delta, d.space, s); });
    G.writeMultiTransform(d.target.layers, d.snap, G.applyMultiTransform(d.snap, d.caps, deltas));
  }

  function onPreviewPointerUp() {
    if (!ctx) return;
    if (state.pan) { endPan(); return; }
    if (!gizmo.drag) return;
    var moved = gizmo.drag.moved;
    var collapseTo = gizmo.drag.collapseTo;
    gizmo.drag = null;
    setPreviewCursor(null);
    if (!moved) {                            // 只是點一下選取，不算修改
      editCancel();
      if (collapseTo) selectLayerById(collapseTo);
      return;
    }
    markGizmoDirty();
    onPresetChanged();            // 這一刻才寫進 dirty 狀態並重建預覽
    renderInspector();
    editCommit();                 // 整段拖曳在這裡才變成一步
  }

  /* Escape 取消：把 pointerdown 當下的快照寫回去。
     一次完整拖曳只有一個還原點，中途的每個 pointermove 都不留歷史。 */
  function cancelDrag() {
    if (!gizmo.drag) return false;
    var d = gizmo.drag;
    if (d.target.kind === 'group') G.restoreGroup(d.target.layers, d.snap);
    else if (d.target.kind === 'multi') G.restoreMulti(d.target.layers, d.snap);
    else G.restore(d.target.layer, d.snap);
    editCancel();                 // 取消的拖曳不進歷史
    gizmo.drag = null;
    setPreviewCursor(null);
    markGizmoDirty();
    onPresetChanged();
    renderInspector();
    return true;
  }

  /* ---------------- 方向鍵移動 ----------------

     選取的圖層（單選、多選、群組）每按一下方向鍵移動 1px，按住 Shift 一次 10px
     （與拖曳時按 Shift 對齊的 10px 同一個單位）。2026-09-17 使用者要求。

     方向是畫面上的方向、距離是特效座標的 px，與拖曳框同一個語意（G.nudgePositions）：
     掛在轉過角度的父物件底下也往畫面右邊走；多選時父子一起被選只動最上層（transformRoots）。

     按住不放會連續移動，**一次按住到放開算一步歷史**：每一下各記一步的話，按住一秒就是
     幾十步，Ctrl+Z 要按到手痠，還會把 100 步的歷史擠掉。交易開著的這段時間別的操作可能插進來
     （點輸入框、拖曳），收尾時用交易代號只收自己那一筆，不會替別人提早收掉。 */
  var NUDGE_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  var NUDGE_SHIFT_STEP = VFXGizmoModel.SNAP.move;   // 拖曳時 Shift 對齊的格距，同一個數字只寫一處
  var nudge = null;                // 按住中：{ pane, doc, history, token }

  function nudgeSelection(dx, dy) {
    var target = gizmoTarget();
    if (!target) return false;
    var layers = target.kind === 'group'
      ? (target.caps.move ? target.layers : [])
      : target.layers.filter(function (l) { return G.capabilities(l).move; });
    if (!layers.length) return false;
    var history = state.history;
    if (!nudge || nudge.history !== history) {
      finishNudge();
      nudge = {
        pane: ctx, doc: ctxDoc, history: history,
        token: history ? history.begin('方向鍵移動' + (DRAG_WHAT[target.kind] || '圖層')) : 0
      };
    }
    var next = G.nudgePositions(layers, layers.map(spaceOf), dx, dy);
    layers.forEach(function (l, i) { if (next[i]) l.position = next[i]; });
    markGizmoDirty();
    syncTransformInputs();
    previewSoon();                 // rAF 合併：按住時每秒幾十下，一幀只重建一次
    return true;
  }

  /* 放開方向鍵、按下滑鼠、切換視窗、瀏覽器失焦時收尾：這一段移動變成一步歷史，Inspector 重畫。 */
  function finishNudge() {
    if (!nudge) return;
    var n = nudge;
    nudge = null;
    if (n.pane.closed) return;
    withPane(n.pane, function () {
      if (n.history) n.history.commit(n.token);
      markGizmoDirty();
      onPresetChanged();
      renderInspector();
    }, n.doc);
  }

  function updateHoverCursor(e) {
    if (!state.app) return;
    var target = gizmoTarget();
    var items = gizmoItems(target);
    if (!items.length) { setPreviewCursor(null); return; }
    var pt = clientToEffectLocal(e.clientX, e.clientY);
    var h = hitGizmoHandle(items, pt);
    if (h) setPreviewCursor(h.kind === 'rotate' ? 'rotate' : 'scale');
    else if (hitGizmoBody(target, items, pt) >= 0) setPreviewCursor('move');
    else setPreviewCursor(null);
  }

  var CURSORS = { move: 'move', scale: 'nwse-resize', rotate: 'grab', pan: 'grabbing' };
  function setPreviewCursor(mode) {
    if (!state.app) return;
    state.app.canvas.style.cursor = (mode && CURSORS[mode]) || 'default';
  }

  /* ---------------- 與 Inspector 的雙向同步 ----------------

     SSOT 仍然是 preset 上的 layer 物件。拖曳期間不重建整個 Inspector
     （那會把曲線元件整組換掉、也會讓輸入框失焦），只把這三個欄位的
     輸入值寫過去。反方向本來就成立：Inspector 改值 → onPresetChanged →
     markGizmoDirty → 框跟著移動。 */
  function syncTransformInputs() {
    var host = $('inspector');
    if (!host || state.inBackground) return;
    /* 看的是 Inspector 的全部目標，不只是被拖的那一層：多選時框拖的是作用中那一層，
       其餘選到的圖層沒動，拖完之後那一格就不再是共同值，要跟著變成「多個值」。 */
    var targets = inspectorTargets();
    if (!targets.length) return;
    ['position', 'scale'].forEach(function (key) {
      ['x', 'y'].forEach(function (axis) {
        var el = host.querySelector('[data-tf="' + key + '.' + axis + '"]');
        if (el) showCommon(el, MX.commonValue(targets, vecAxisReader(key, axis)));
      });
    });
    var rotEl = host.querySelector('[data-tf="rotation"]');
    if (rotEl) showCommon(rotEl, MX.commonValue(targets, function (l) { return l.rotation; }), toDegrees);
  }

  /* 每個視窗的畫布各接一次。按下去先交給 onPanePointerDown 換焦點，再走原本的選取與拖曳。
     window 上的 pointermove／pointerup 整頁只接一次（見 boot）：拖曳一定是在焦點視窗
     按下去的，所以它們作用在焦點視窗上就對了。 */
  function wireGizmo() {
    ensureOverlay();
    state.app.canvas.addEventListener('pointerdown', onPanePointerDown);
  }

  /* 畫布上按下去。焦點已經在 .pane 的捕獲階段換好（見 createPane），這裡的 state 就是這個視窗。
     Ctrl+點擊只管多選（加入或移出視窗），不動圖層——那一下是在挑視窗，不是在編輯。 */
  function onPanePointerDown(e) {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); return; }
    onPreviewPointerDown(e, focusClickEvent === e);
  }

  /* 最近一次「按下去同時換了焦點」的 pointerdown（由 .pane 的捕獲階段記下，見 createPane）。
     畫布自己的處理拿它判斷：點另一格的空白處是為了切過去，不是要取消那一格的選取。 */
  var focusClickEvent = null;

  /* ---------------- 座標格線與縮放 ----------------

     格線是量尺，不是裝飾：它讓「這顆爆點在遊戲裡有多大」變成讀得出來的數字，
     而不是靠感覺。比例尺與遊戲相同（1 米 = 10px、一大格 6 米），
     間距與取捨規則全部在 view-model.js，連同它為什麼是 10px 的來源說明；
     這裡只負責畫出來與接滑鼠。

     兩件刻意不做的事：

     1. **格線不掛在 stageRoot 底下。** 它畫在畫布座標上，線寬永遠是 1px。
        跟著縮放的話，放大 8 倍時線也會變成 8px 粗的柵欄，量尺變成鐵窗。
     2. **不每幀重畫。** 每幀 clear() 一個 Graphics 是實測過的效能陷阱
        （與 drawGizmo 同一條理由）。這裡比對「上次是用什麼條件畫的」，
        條件沒變就整個跳過——用欄位逐一比較而不是組字串，避免每幀產生垃圾。 */

  /* 畫筆與「上次用什麼條件畫的」每個視窗各一份（newPane 的 grid） */
  var grid = {};
  ['gfx', 'last'].forEach(function (key) {
    Object.defineProperty(grid, key, {
      get: function () { return ctx ? ctx.grid[key] : null; },
      set: function (v) { ctx.grid[key] = v; }
    });
  });

  function drawGrid() {
    var g = grid.gfx;
    if (!g || !state.stageRoot) return;
    var w = state.app.renderer.width, h = state.app.renderer.height;
    var ox = state.stageRoot.x, oy = state.stageRoot.y;
    var last = grid.last;
    if (last && last.w === w && last.h === h && last.ox === ox && last.oy === oy &&
        last.zoom === state.zoom && last.on === state.gridOn && last.bg === state.background) {
      return;
    }
    grid.last = { w: w, h: h, ox: ox, oy: oy, zoom: state.zoom,
                  on: state.gridOn, bg: state.background };
    g.clear();
    if (!state.gridOn) return;

    var spec = VFXViewModel.gridSpec({
      width: w, height: h, originX: ox, originY: oy, zoom: state.zoom
    });
    var pal = VFXViewModel.gridPalette(state.background);
    strokeGridLines(g, spec.minorX, spec.minorY, w, h, pal.colour, pal.minorAlpha);
    strokeGridLines(g, spec.majorX, spec.majorY, w, h, pal.colour, pal.majorAlpha);
    /* 軸線最後畫、也最亮：它標的是特效原點，拖曳與 position 都以它為 0。 */
    strokeGridLines(g,
      spec.axisX === null ? [] : [spec.axisX],
      spec.axisY === null ? [] : [spec.axisY],
      w, h, pal.colour, pal.axisAlpha);
  }

  /* 同一種線一次 stroke 完。每條線各自 stroke() 會變成幾百次填色，
     而它們的顏色與 alpha 完全一樣。 */
  function strokeGridLines(g, xs, ys, w, h, colour, alpha) {
    if (!xs.length && !ys.length) return;
    /* 半像素對齊：1px 的線落在整數座標上會跨到相鄰兩個像素，
       變成兩條半亮的灰線——整張圖看起來會糊。 */
    xs.forEach(function (x) {
      var v = Math.round(x) + 0.5;
      g.moveTo(v, 0); g.lineTo(v, h);
    });
    ys.forEach(function (y) {
      var v = Math.round(y) + 0.5;
      g.moveTo(0, v); g.lineTo(w, v);
    });
    g.stroke({ width: 1, color: colour, alpha: alpha });
  }

  /* ---------------- 鏡頭平移 ----------------

     鏡頭位置＝畫布中心 ＋ 平移量。平移量獨立存著而不是直接寫 root.x：
     畫布尺寸一變（拉側欄、改視窗大小）就得重算中心，記絕對座標的話
     鏡頭會跟著跳掉。

     用中鍵或右鍵拖曳，把左鍵完整留給 Gizmo——左鍵在預覽區已經是「選取與變形」，
     再兼一個平移就必須靠修飾鍵區分，而修飾鍵拖到一半放開就會變成在拖圖層。 */

  function recentreStage() {
    if (!state.app || !state.stageRoot) return;
    state.stageRoot.x = state.app.renderer.width / 2 + state.panX;
    state.stageRoot.y = state.app.renderer.height / 2 + state.panY;
  }

  function resetCamera() {
    state.panX = 0;
    state.panY = 0;
    applyZoom(1);
    recentreStage();
  }

  /* 拖曳平移中的狀態（state.pan）：{ startClientX, startClientY, startPanX, startPanY }，每個視窗各一份 */
  function beginPan(e) {
    state.pan = {
      startClientX: e.clientX, startClientY: e.clientY,
      startPanX: state.panX, startPanY: state.panY
    };
    setPreviewCursor('pan');
  }

  function updatePan(e) {
    /* client 座標換算成畫布像素：畫布可能被 CSS 縮放，也可能不是 1:1 DPR。
       平移量本身是螢幕空間的，所以不必再除以 zoom——畫面跟著滑鼠 1:1 走。 */
    var pan = state.pan;
    var a = clientToPreview(pan.startClientX, pan.startClientY);
    var b = clientToPreview(e.clientX, e.clientY);
    state.panX = pan.startPanX + (b.x - a.x);
    state.panY = pan.startPanY + (b.y - a.y);
    recentreStage();
  }

  function endPan() {
    state.pan = null;
    setPreviewCursor(null);
  }

  /* 縮放與平移是每個視窗各自的鏡頭：兩份大小差很多的特效並排時，各看各的倍率。 */
  function applyZoom(z) {
    state.zoom = VFXViewModel.clampZoom(z);
    /* 縮放中心固定在特效原點（畫布正中央）。不做「以游標為中心」是因為那必須
       一併引入平移，而預覽區的左鍵已經是 Gizmo 拖曳；特效本來就繞著原點做，
       對著原點縮放就夠用，而且永遠不會縮到迷路。 */
    if (state.stageRoot) state.stageRoot.scale.set(state.zoom);
    markGizmoDirty();                 // 框畫的是 effect-local，換算比例變了
    updateViewReadout();
  }

  var GRID_STORAGE_KEY = 'vfx-editor.grid';

  function setGridOn(on) {
    state.gridOn = !!on;
    var chk = $('chk-grid');
    if (chk) chk.checked = state.gridOn;
    /* 與背景色同一類的檢視偏好，走同一份 cookie（見 readPrefs 的說明）。 */
    writePref('grid', state.gridOn ? '1' : '0');
    updateViewReadout();
  }

  function updateViewReadout() {
    if (!ctx || state.inBackground) return;   // 讀數是焦點視窗的鏡頭
    var btn = $('zoom-reset');
    if (btn) btn.textContent = '縮放 ' + Math.round(state.zoom * 100) + '%';
    var note = $('grid-scale');
    if (!note) return;
    /* 格線關掉時不留「1 大格 = 6 米」那行字：畫面上沒有格可以對照，
       那句話只會讓人去找不存在的線。 */
    note.textContent = state.gridOn
      ? '1 大格 = ' + VFXViewModel.METRES_PER_CELL + ' 米（' +
        Math.round(VFXViewModel.PX_PER_METRE * VFXViewModel.METRES_PER_CELL * state.zoom) + 'px）'
      : '';
  }

  /* 每個視窗的畫布各接一次。 */
  function wirePreviewView(pane) {
    /* passive:false 才 preventDefault 得了。少了它，滾輪會在縮放的同時
       把整頁一起捲走——而這一頁本來就會因為工具列換行而出現捲軸。
       縮放的是滑鼠底下那個視窗，不必先點它（不換焦點，面板不會跟著跳）。 */
    state.app.canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      withPane(pane, function () {
        applyZoom(VFXViewModel.zoomByWheel(state.zoom, e.deltaY, e.deltaMode));
      });
    }, { passive: false });

    /* 右鍵要能拖曳平移，就不能讓瀏覽器的內容功能表跳出來。只擋畫布這一塊——
       其他地方（素材清單、輸入框）的右鍵仍然是正常的。 */
    state.app.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* 格線開關與「回到預設視角」：預覽區上方各一個，整頁接一次。
     格線是全部視窗共用的偏好；回到預設視角作用在焦點視窗。 */
  function wireViewControls() {
    var saved = readPref('grid', GRID_STORAGE_KEY);
    state.gridOn = saved === undefined ? true : saved === '1';

    var chk = $('chk-grid');
    if (chk) {
      chk.checked = state.gridOn;
      chk.onchange = function () { setGridOn(chk.checked); };
    }
    /* 這顆現在連平移一起歸零：縮放與平移是同一個鏡頭的兩個自由度，
       「回到預設視角」應該兩個都回，不然按完還要自己把特效拖回中間。 */
    var btn = $('zoom-reset');
    if (btn) btn.onclick = resetCamera;
    updateViewReadout();
  }

  /* ---------------- Undo / Redo ----------------

     一份特效只有一份歷史（state.history，跟著那份特效走）。多視窗時每個視窗各一份：
     在 B 視窗按 Ctrl+Z 不該把 A 視窗剛才的修改復原。快照記的是 authoring 資料，
     不記播放狀態、搜尋字串、收合狀態、hover、粒子、貼圖快取那些。

     快照用 canonical 文字：比較是否相同就是字串比較（免費），
     而且與 dirty 判斷用的是同一種表示法，「Undo 回到存檔時的狀態」
     會自動變回乾淨，不需要另外處理。 */

  function historySnapshot() {
    return {
      preset: currentPresetText(),
      layout: state.layout ? VFXLayoutSchema.serialiseLayout(state.layout) : null,
      /* 選取也記：刪掉一層再 Undo，焦點應該回到那一層而不是隨便一個。
         這是 authoring 的一部分，不是「UI 狀態」。 */
      selected: state.selectedKeys.slice(),
      active: state.activeKey,
      anchor: state.anchorKey
    };
  }

  function snapshotEqual(a, b) {
    /* 只比 authoring 資料。選取不同不足以成為一步——
       否則單純點來點去就會塞滿整個歷史。 */
    return a.preset === b.preset && a.layout === b.layout;
  }

  function historyApply(snap) {
    if (snap.preset === null) return;         // 序列化不出來的狀態不該被記進去
    state.preset = JSON.parse(snap.preset);
    if (snap.layout !== null) {
      state.layout = JSON.parse(snap.layout);
      state.layoutRevision = (state.layoutRevision || 0) + 1;
    }
    /* 還原選取，但要先確認那些 key 還存在：Undo 回到「圖層還沒建立」的狀態時，
       舊的 activeKey 會指向不存在的圖層，Inspector 就會空引用。 */
    var alive = snap.selected.filter(keyStillExists);
    var active = keyStillExists(snap.active) ? snap.active : (alive.length ? alive[0] : null);
    setSelection(alive, active);
    state.anchorKey = keyStillExists(snap.anchor) ? snap.anchor : active;

    markGizmoDirty();
    renderLayerList();
    renderInspector();
    onPresetChanged();
    refreshHistoryButtons();
  }

  function keyStillExists(key) {
    if (!key) return false;
    if (keyKind(key) === 'group') return !!groupById(keyId(key));
    return !!layerById(keyId(key));
  }

  function initHistory() {
    state.history = VFXHistory.create({
      capture: historySnapshot,
      apply: historyApply,
      equal: snapshotEqual,
      onChange: refreshHistoryButtons
    });
    refreshHistoryButtons();
  }

  function refreshHistoryButtons() {
    var u = $('btn-undo'), r = $('btn-redo');
    var history = state.history;
    if (!u || !r || !history || state.inBackground) return;
    u.disabled = !history.canUndo();
    r.disabled = !history.canRedo();
    u.title = history.canUndo() ? ('復原：' + history.undoLabel() + '（Ctrl+Z）') : '沒有可復原的動作';
    r.title = history.canRedo() ? ('重做：' + history.redoLabel() + '（Ctrl+Y）') : '沒有可重做的動作';
  }

  /* 給呼叫端用的三個入口。history 還沒建好時（啟動途中）直接執行，
     不要因為歷史沒準備好就讓編輯功能壞掉。 */
  function edit(label, fn) {
    var history = state.history;
    if (!history) { fn(); return; }
    history.execute(label, fn);
  }
  function editBegin(label) { if (state.history) state.history.begin(label); }
  function editCommit() { if (state.history) state.history.commit(); }
  function editCancel() { if (state.history) state.history.cancel(); }

  /* ---------------- Layer list ---------------- */

  /* ============================================================
     Layer 面板：Group / 多選 / 排序 / Copy-Paste / Drag

     三個必須分清楚的順序，混在一起就會出現「排個序畫面就變了」這種災難：

       RENDER ORDER   由 layer.zIndex 決定（Pixi container.sortableChildren）。
                      本面板的任何操作都不會動它。
       AUTHORING ORDER preset.layers 的陣列順序。拖曳改的是這個。
                      它不影響畫面，只影響人看到的排列與檔案 diff。
       VIEW SORT      「建立順序 / 名稱」下拉選單。純顯示，什麼都不改。
     ============================================================ */

  /* 所有「這個操作對資料做了什麼」的邏輯都在 layer-model.js，
     這裡只負責畫面與事件。兩邊各寫一份的話遲早會分家，
     而分家的症狀是「測試都過、實際點下去行為不一樣」。 */
  var M = VFXLayerModel;
  var G = VFXGizmoModel;
  var MX = VFXMultiEditModel;
  /* 父子層級：掛上時的數值換算、面板的樹、拖曳落點。同樣一份給畫面、一份給測試。 */
  var H = VFXHierarchyModel;

  function keyOf(kind, id) { return M.keyOf(kind, id); }
  function keyKind(key) { return M.keyKind(key); }
  function keyId(key) { return M.keyId(key); }
  function layerById(id) { return M.layerById(state.preset, id); }

  /* 作用中的那一層（清單上有外框的那列），不是「選取的第一個」——多選時這兩者常常不同。
     Gizmo 的框看它；Inspector 看的是 inspectorTargets()。 */
  function selectedLayer() {
    if (keyKind(state.activeKey) !== "layer") return null;
    return layerById(keyId(state.activeKey));
  }

  /* Inspector 的編輯對象。

     選了兩項以上、而且展開之後（群組 key 換成成員）至少兩層 → 全部選到的圖層。
     其餘情況 → 作用中的那一層；沒有的話回傳空的，Inspector 改顯示群組區塊或提示。

     單選與多選走的是同一份欄位程式，差別只在這裡回傳幾層。
     只點一個群組列時仍然顯示群組區塊：那裡的中心、寬高、縮放 × 是把整組當成
     一個物件來變形，與「每一層的參數一起改」是兩回事。 */
  function inspectorTargets() {
    if (state.selectedKeys.length >= 2) {
      var ids = MX.targetLayerIds(state.preset, state.layout, state.selectedKeys);
      if (ids.length >= 2) return ids.map(layerById).filter(Boolean);
    }
    var layer = selectedLayer();
    return layer ? [layer] : [];
  }

  /* 多選時「以哪一層為準」：作用中的那一層；它不在選取裡（被 Ctrl 點掉了）就用第一層。 */
  function referenceLayer(targets) {
    var active = selectedLayer();
    return active && targets.indexOf(active) >= 0 ? active : targets[0];
  }

  /* 選取群組。與 selectLayerById 走同一條路，只是 key 的種類不同。 */
  function selectGroupById(gid) {
    var key = keyOf('group', gid);
    if (state.activeKey === key && state.selectedKeys.length === 1) return;
    setSelection([key], key);
    state.anchorKey = key;
    markGizmoDirty();
    renderLayerList();
    renderInspector();
  }

  /* 就地改名。原本用 window.prompt——那會擋住整個分頁，而且看不到自己
     正在改的是哪一列。改成把文字換成輸入框，Enter 套用、Escape 取消、
     失焦視同套用（照使用者的直覺，離開就是寫下去）。 */
  function beginInlineRename(span, row) {
    /* row 是 reconcile 產生的顯示列，name 只是副本；真正的群組在 layout 裡。
       寫到 row 上不會有任何效果，而且畫面重繪後就消失了。 */
    var group = groupById(row.id);
    if (!group) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'gname-edit';
    input.value = group.name;
    input.maxLength = VFXLayoutSchema.LIMITS.maxNameLength;
    /* 這是文字輸入：Delete 與方向鍵都歸它，不能讓圖層面板的快捷鍵搶走。
       onKeyDown 的第一道守門本來就是 isTextEntry，所以只要它是 input 就安全。 */
    var done = false;
    function commit(save) {
      if (done) return;
      done = true;
      var next = String(input.value).trim();
      if (save && next && next !== group.name) {
        edit('重新命名群組', function () {
          group.name = next.slice(0, VFXLayoutSchema.LIMITS.maxNameLength);
          markLayoutDirty();
        });
      }
      renderLayerList();
    }
    input.onkeydown = function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { commit(true); e.preventDefault(); }
      else if (e.key === 'Escape') { commit(false); e.preventDefault(); }
    };
    input.onblur = function () { commit(true); };
    input.onmousedown = function (e) { e.stopPropagation(); };
    input.onclick = function (e) { e.stopPropagation(); };
    input.ondblclick = function (e) { e.stopPropagation(); };
    span.textContent = '';
    span.appendChild(input);
    input.focus();
    input.select();
  }

  /* 從 Preview 選取。刻意走與 Layer List 完全相同的 state 與重繪路徑——
     兩套 selection state 遲早會分家，變成左邊選 A、中間框 B。 */
  function selectLayerById(id) {
    var key = keyOf('layer', id);
    if (state.activeKey === key && state.selectedKeys.length === 1) return;
    setSelection([key], key);
    state.anchorKey = key;
    markGizmoDirty();
    renderLayerList();
    renderInspector();
  }

  /* 預覽區點空白處：什麼都不選。與圖層面板「再點一次唯一選取的那一列」同一個結果，
     一樣不進歷史（選取不是 authoring 資料的修改，見 snapshotEqual）。 */
  function clearSelection() {
    if (!state.selectedKeys.length && !state.activeKey) return;
    setSelection([], null);
    state.anchorKey = null;
    markGizmoDirty();
    renderLayerList();
    renderInspector();
  }

  function activeGroup() {
    if (keyKind(state.activeKey) !== "group") return null;
    return groupById(keyId(state.activeKey));
  }

  function groupById(id) { return M.groupById(state.layout, id); }
  function groupOfLayer(id) { return M.groupOfLayer(state.layout, id); }

  /* ---------------- 列的組成 ---------------- */

  /* 先用 layout-schema 的 reconcile 把分組疊到實際圖層上（它負責自癒），
     再套用純顯示的排序。排序只重排「要畫哪幾列、順序如何」，
     preset.layers 與 layout.groups 一個 byte 都不會動。 */
  function buildRows() {
    var rec = VFXLayoutSchema.reconcile(state.preset.layers, state.layout);
    var rows = rec.rows.map(function (r) {
      if (r.kind === "group") {
        return { kind: "group", id: r.id, name: r.name, layerIds: r.layerIds.slice() };
      }
      return { kind: "layer", id: r.id, groupId: null };
    });
    return M.sortRows(rows, state.sortMode);
  }

  /* 面板上實際畫出來的列：群組展開成成員，子物件縮排在父物件底下，收合的群組與父物件不展開。
     畫面、Shift 範圍選取、刪除後的焦點都照這一份，順序才不會各說各話。 */
  function layerTree() { return H.treeRows(state.preset, buildRows(), state.collapsed); }

  /* 目前「畫面上看得到的列」。Shift 範圍選取必須以這個為準——選到看不見的東西是最經典的多選 bug。 */
  function visibleKeys() { return H.visibleKeys(layerTree()); }

  /* ---------------- 選取 ---------------- */

  function isSelected(key) { return state.selectedKeys.indexOf(key) >= 0; }

  function setSelection(keys, active) {
    state.selectedKeys = keys.slice();
    state.activeKey = active !== undefined ? active : (keys.length ? keys[keys.length - 1] : null);
    /* 舊程式（Inspector、addLayer…）還在讀 selectedLayerId，保持同步 */
    state.selectedLayerId = keyKind(state.activeKey) === "layer" ? keyId(state.activeKey) : null;
  }

  function handleRowMouseDown(key, e) {
    var next = M.applyClick(
      { selected: state.selectedKeys, active: state.activeKey, anchor: state.anchorKey },
      visibleKeys(), key,
      { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    setSelection(next.selected, next.active);
    state.anchorKey = next.anchor;
    markGizmoDirty();
    renderLayerList();
    renderInspector();
  }

  /* ---------------- 畫面 ---------------- */

  function renderLayerList() {
    if (state.inBackground) return;           // 面板顯示的是焦點視窗那一份
    var host = $("layer-list");
    host.textContent = "";
    /* 有任何父子關係時，每一列都留一格收合鈕的位置，同一層的勾選框才對得齊；
       沒有的 preset 維持原本的樣子。 */
    var treeMode = state.preset.layers.some(function (l) { return !!H.parentIdOf(l); });
    layerTree().forEach(function (r) {
      if (r.kind === "group") { host.appendChild(groupRow(r)); return; }
      var layer = layerById(r.id);
      if (layer) host.appendChild(layerRow(layer, r, treeMode));
    });

    updateLayerPanelStatus();
  }

  function updateLayerPanelStatus() {
    var el = $("layer-status");
    if (!el) return;
    var nSel = state.selectedKeys.length;
    el.textContent = nSel > 1 ? ("已選取 " + nSel + " 項") : "";
  }

  function groupRow(r) {
    var div = document.createElement("div");
    var key = keyOf("group", r.id);
    div.className = "layer-row group-row" + (isSelected(key) ? " sel" : "") +
      (state.activeKey === key ? " active" : "");
    div.dataset.key = key;

    var tw = document.createElement("button");
    tw.className = "twisty";
    tw.type = "button";
    tw.textContent = state.collapsed[r.id] ? "\u25B6" : "\u25BC";
    tw.title = state.collapsed[r.id] ? "展開" : "收合";
    tw.onmousedown = function (e) { e.stopPropagation(); };
    tw.onclick = function (e) {
      e.stopPropagation();
      state.collapsed[r.id] = !state.collapsed[r.id];
      saveCollapsed();
      renderLayerList();
    };

    var cb = document.createElement("input");
    cb.type = "checkbox";
    /* 群組的勾選狀態＝底下所有圖層的聯集。全開才勾，全關才不勾，混合狀態用 indeterminate。 */
    var members = r.layerIds.map(layerById).filter(Boolean);
    var on = members.filter(function (l) { return l.enabled !== false; }).length;
    cb.checked = members.length > 0 && on === members.length;
    cb.indeterminate = on > 0 && on < members.length;
    cb.title = "整組啟用／停用";
    cb.onmousedown = function (e) { e.stopPropagation(); };
    cb.onclick = function (e) {
      e.stopPropagation();
      var turnOn = cb.checked;
      edit(turnOn ? '啟用群組' : '停用群組', function () {
        members.forEach(function (l) { l.enabled = turnOn; });
      });
      selectGroupById(r.id);          // 與圖層列一致：改了勾就選到它
      onPresetChanged();
      renderLayerList();
    };

    var name = document.createElement("span");
    name.className = "gname";
    name.textContent = r.name;
    name.title = "雙擊重新命名";
    name.ondblclick = function (e) {
      e.stopPropagation();
      beginInlineRename(name, r);
    };

    var count = document.createElement("span");
    count.className = "type";
    count.textContent = r.layerIds.length + " 層";

    div.appendChild(tw); div.appendChild(cb); div.appendChild(name); div.appendChild(count);
    wireRow(div, key);
    return div;
  }

  /* row：H.treeRows 的一列（depth、hasChildren、collapsed、parentElsewhere、parentOff） */
  function layerRow(layer, row, treeMode) {
    var div = document.createElement("div");
    var key = keyOf("layer", layer.id);
    div.className = "layer-row" + (row.groupId ? " child" : "") + (row.parentOff ? " parent-off" : "") +
      (isSelected(key) ? " sel" : "") + (state.activeKey === key ? " active" : "");
    div.dataset.key = key;
    /* 縮排用 CSS 變數算 padding：整列仍然都是拖放的落點 */
    div.style.setProperty("--depth", String(row.depth || 0));
    /* dropModeFor 要知道這一列底下有沒有展開的子物件 */
    div._treeRow = row;

    var tw = null;
    if (row.hasChildren) {
      tw = document.createElement("button");
      tw.className = "twisty";
      tw.type = "button";
      tw.textContent = row.collapsed ? "\u25B6" : "\u25BC";
      tw.title = row.collapsed ? "展開子物件" : "收合子物件";
      tw.onmousedown = function (e) { e.stopPropagation(); };
      tw.onclick = function (e) {
        e.stopPropagation();
        var ck = H.collapsedKeyOf(layer.id);
        if (state.collapsed[ck]) delete state.collapsed[ck]; else state.collapsed[ck] = true;
        saveCollapsed();
        renderLayerList();
      };
    } else if (treeMode) {
      tw = document.createElement("span");
      tw.className = "twisty twisty-blank";
    }

    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = layer.enabled !== false;
    /* mousedown 也要擋：否則按住勾選框拖動會變成拖曳圖層 */
    cb.onmousedown = function (e) { e.stopPropagation(); };
    cb.onclick = function (e) {
      e.stopPropagation();
      var on = cb.checked;
      edit(on ? '啟用圖層' : '停用圖層', function () { layer.enabled = on; });
      /* 改了誰的勾選，焦點就跟到誰身上：接著多半要調它的參數，
         而且 Inspector 與 Preview 的框也會一起跟過去。 */
      selectLayerById(layer.id);
      onPresetChanged();
    };

    var name = document.createElement("span");
    var waterNames = { halo: '外層光暈', 'rear-ribbons': '後方飄帶', 'rear-sheets': '後方水片', body: '水柱本體', 'front-sheets': '前方水片', 'white-crests': '白色浪尖', 'front-ribbons': '前方飄帶', base: '底部旋流水環', bloom: '浪尖泛光', dust: '底部煙塵', spray: '藍色水花粒子' };
    name.textContent = (layer.effect === 'waterTornado' || (state.preset.id === 'field-water-tornado' && waterNames[layer.id])) ? (waterNames[layer.water ? layer.water.part : layer.id] || layer.id) + ' · ' + layer.id : layer.id;

    if (row.parentElsewhere) {
      /* 父物件在別的群組：列留在自己的位置，但要看得出它掛在誰底下 */
      name.textContent += " \u2191" + row.parentElsewhere;
      name.title = "父物件是 " + row.parentElsewhere + "（在別的群組）";
    }
    if (row.parentOff) div.title = "上層的父物件停用中：這一層也不會出現";

    var type = document.createElement("span");
    type.className = "type";
    type.textContent = layer.type;

    if (tw) div.appendChild(tw);
    div.appendChild(cb); div.appendChild(name); div.appendChild(type);
    wireRow(div, key);
    return div;
  }

  /* ---------------- 拖曳 ----------------
     拖曳改的是 AUTHORING ORDER（preset.layers 的順序）與分組歸屬，
     絕不碰 zIndex。畫面長什麼樣由 zIndex 決定，拖完必須一模一樣。 */

  function wireRow(div, key) {
    div.onmousedown = function (e) {
      if (e.button !== 0) return;
      handleRowMouseDown(key, e);
    };
    /* 名稱排序時不開放拖曳：畫面順序與 authoring order 不一致，
       拖到「B 的下面」會落在完全不同的位置，那是最容易失去信任的互動。 */
    div.draggable = state.sortMode === "creation";
    div.ondragstart = function (e) {
      if (state.sortMode !== "creation") { e.preventDefault(); return; }
      /* 拖曳整個選取集合；拖到沒被選的列上則只拖那一列 */
      state.dragKeys = isSelected(key) ? state.selectedKeys.slice() : [key];
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", key); } catch (err) { }
      div.classList.add("dragging");
    };
    div.ondragend = function () {
      state.dragKeys = null;
      clearDropMarks();
      renderLayerList();
    };
    div.ondragover = function (e) {
      if (!state.dragKeys) return;
      clearDropMarks();
      var mode = dropModeFor(div, key, e);
      /* 放不下的位置不 preventDefault：游標顯示禁止，也不畫任何指示 */
      if (!mode) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      div.classList.add(mode === "into" ? "drop-into" :
        (mode === "before" ? "drop-before" : "drop-after"));
    };
    div.ondragleave = function () { div.classList.remove("drop-into", "drop-before", "drop-after"); };
    div.ondrop = function (e) {
      if (!state.dragKeys) return;
      e.preventDefault();
      e.stopPropagation();
      var mode = dropModeFor(div, key, e);
      if (mode) performDrop(key, mode);
      state.dragKeys = null;
      clearDropMarks();
    };
  }

  function clearDropMarks() {
    var rows = $("layer-list").querySelectorAll(".layer-row");
    [].forEach.call(rows, function (r) {
      r.classList.remove("drop-into", "drop-before", "drop-after", "dragging");
    });
  }

  /* 落點：
       群組列  上緣＝排在群組前、下緣＝排在群組後、中段＝丟進群組（圖層回到根層級）
       圖層列  上緣＝排在它前面、下緣＝排在它後面（兩者都是成為它的兄弟）、中段＝成為它的子物件

     展開中的父物件，下緣緊貼著它的第一個子物件：線畫在那裡看起來是「插在父子之間」，
     所以那一段也當成「成為子物件」，不做成排到整棵子樹後面。
     中段不允許 into 時（例如拖的是群組）改成依落點就近取前／後——但展開中的父物件下半部
     沒有誠實的畫法，直接不給放。
     指示線是操作契約不是裝飾：顯示 into 卻做成 before 等於騙使用者。所以判斷一律交給
     H.dropProblem——H.applyDrop 真的搬之前用的是同一支（它再往下用 layer-model 的
     dropModeAllowed 判斷群組能不能放進去）。放不下就回傳 null。 */
  function dropModeFor(div, key, e) {
    var r = div.getBoundingClientRect();
    var y = e.clientY - r.top;
    var moving = state.dragKeys || [];
    var row = div._treeRow;
    var openParent = keyKind(key) === "layer" && row && row.hasChildren && !row.collapsed;
    var mode = y < r.height * 0.28 ? "before" : (y > r.height * 0.72 ? "after" : "into");
    if (mode === "after" && openParent) mode = "into";
    if (mode === "into" && H.dropProblem(state.preset, state.layout, moving, key, "into")) {
      if (openParent && y >= r.height / 2) return null;
      mode = y < r.height / 2 ? "before" : "after";
    }
    return H.dropProblem(state.preset, state.layout, moving, key, mode) ? null : mode;
  }

  function performDrop(targetKey, mode) {
    edit('調整順序', function () { performDropInner(targetKey, mode); });
  }

  function performDropInner(targetKey, mode) {
    ensureLayout();
    var result = H.applyDrop(state.preset, state.layout, state.dragKeys.slice(), targetKey, mode);
    if (!result.ok) {
      if (result.error) showSaveError('無法放在這裡', [result.error]);
      return;
    }
    markLayoutDirty();
    /* 只換了順序或分組時刻意**不呼叫** onPresetChanged()：那只改 layout，preset 一個 byte
       都沒動，重建 runtime 等於白白丟掉目前的粒子狀態、重抓貼圖、製造 GC 壓力，
       而且畫面會突然重播。換了父物件才是真的改到 VFX 資料，那時才重建預覽。 */
    if (result.parentChanged) {
      announceHierarchyNotes(result.notes);
      markGizmoDirty();
      onPresetChanged();
      renderInspector();
    }
    renderLayerList();
  }


  /* 拖空的群組留著沒有意義，而且會在列表尾巴堆積 */
  function dropEmptyGroups() { M.dropEmptyGroups(state.layout); }

  /* ---------------- Copy / Paste ----------------
     Editor 內部剪貼簿，不碰 OS clipboard——那需要權限提示，而這裡只需要
     在同一個 Editor 內複製圖層。

     多視窗（2026-09-17）：剪貼簿全部視窗共用，A 視窗複製、B 視窗貼上。複製當下備好兩份內容：
       items     貼回同一份特效用：副本的父物件、子發射器目標就在旁邊
       portable  貼到另一份特效用（pane-model.js 的 portableClipboard）：父物件沒一起複製就卸下成
                 根層級、子發射器目標沒一起複製就拿掉、群組攤成圖層
     在複製當下算好，之後原本那一份再怎麼改都不影響剪貼簿。「是不是同一份」看的是編輯狀態
     物件本身：另存新檔或重新開啟之後就是新的一份，走 portable 也不會錯。 */

  function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

  function uniqueIdFrom(base, taken) { return M.uniqueIdFrom(base, taken); }

  function copySelection() {
    if (!state.selectedKeys.length) return;
    /* 選到父物件就連子孫一起，跟群組帶著成員一樣：面板上縮排在它底下的就是它的一部分 */
    var clip = M.copySelection(state.preset, state.layout,
      H.withDescendants(state.preset, state.layout, state.selectedKeys));
    if (clip) {
      clip.doc = ctxDoc;
      clip.from = state.preset.id;
      clip.portable = VFXPaneModel.portableClipboard(state.preset, state.layout, state.selectedKeys);
    }
    state.clipboard = clip;
    updateClipboardStatus();
  }


  function pasteClipboard() {
    if (!state.clipboard || !state.clipboard.items.length) return;
    edit('貼上圖層', pasteClipboardInner);
  }

  function pasteClipboardInner() {
    ensureLayout();
    var clip = state.clipboard;
    var foreign = clip.doc !== ctxDoc;
    /* 以目前 active 當插入錨點，貼在它後面，而不是丟到整個列表最下面。
       貼到另一份特效時沿用原本的圖層 id（撞名才加序號），插入點照那一份的根群組找 */
    var newKeys = foreign
      ? M.pasteClipboard(state.preset, state.layout, clip.portable,
        VFXPaneModel.foreignPasteAnchor(state.preset, state.layout, state.activeKey), { keepIds: true })
      : M.pasteClipboard(state.preset, state.layout, clip, state.activeKey);
    setSelection(newKeys, newKeys[newKeys.length - 1]);
    state.anchorKey = state.activeKey;
    markLayoutDirty();
    onPresetChanged();
    renderLayerList();
    renderInspector();
    if (foreign) announcePasteNotes(clip);
  }

  /* 從另一份特效貼過來時說一聲是從哪裡來的；沒辦法完全照原樣的地方（父物件卸下、
     子發射器拿掉、斜切近似）滑鼠移上去看每一層的原因。與父子層級的提示同一個位置與樣式。 */
  function announcePasteNotes(clip) {
    var lines = VFXPaneModel.describeNotes(clip.portable.notes);
    var head = '已從 ' + clip.from + ' 貼上 ' + clip.portable.items.length + ' 層';
    setSaveStatus(lines.length
      ? head + '；' + (lines.length === 1 ? lines[0] : lines.length + ' 項沒辦法完全照原樣（滑鼠移上來看）')
      : head, 'note', lines.join('\n'));
  }

  function updateClipboardStatus() {
    var el = $("clipboard-status");
    if (!el) return;
    var c = state.clipboard;
    /* 多個視窗時標出是從哪一份複製的：切到別的視窗貼上之前看得出剪貼簿裡是什麼 */
    el.textContent = c ? ("剪貼簿：" + c.items.length + " 項" +
      (panes.length > 1 ? "（" + c.from + "）" : "")) : "";
  }

  /* ---------------- 群組操作 ---------------- */

  function ensureLayout() {
    if (!state.layout) state.layout = VFXLayoutSchema.emptyLayout(state.preset.id);
    if (!Array.isArray(state.layout.groups)) state.layout.groups = [];
    /* order 缺席時用目前 reconcile 出來的樣子補齊。舊的 layout 檔沒有這個欄位，
       補上之後拖曳才有東西可改。 */
    if (!Array.isArray(state.layout.order)) {
      var rec = VFXLayoutSchema.reconcile(state.preset.layers, state.layout);
      state.layout.order = VFXLayoutSchema.orderFromRows(rec.rows);
    }
  }

  function groupSelection() {
    edit('組成群組', groupSelectionInner);
  }

  function groupSelectionInner() {
    var ids = state.selectedKeys.filter(function (k) { return keyKind(k) === "layer"; })
      .map(keyId);
    if (!ids.length) return;
    ensureLayout();
    var gid = M.groupLayers(state.layout, ids, "新群組");
    if (!gid) return;
    setSelection([keyOf("group", gid)], keyOf("group", gid));
    state.anchorKey = state.activeKey;
    markLayoutDirty();
    renderLayerList();
    renderInspector();
  }

  function ungroupSelection() {
    edit('解散群組', ungroupSelectionInner);
  }

  function ungroupSelectionInner() {
    var gids = state.selectedKeys.filter(function (k) { return keyKind(k) === "group"; }).map(keyId);
    if (!gids.length || !state.layout) return;
    M.ungroup(state.layout, gids);
    setSelection([], null);
    markLayoutDirty();
    renderLayerList();
    renderInspector();
  }

  /* ---------------- layout 的載入與存檔 ---------------- */

  function layoutUrl(id) { return "/vfx/layouts/" + id + ".json"; }

  /* 載入分組。任何問題都退回「沒有分組」的 deterministic 狀態，
     但**一定要說出來**——安靜地變成空白會讓人以為所有群組被刪了。
     退回時不覆寫壞掉的檔案：那份檔案是使用者的資料，要留著給人修。 */
  function loadLayout(presetId) {
    return fetch(layoutUrl(presetId)).then(function (r) {
      if (r.status === 404) return { layout: VFXLayoutSchema.emptyLayout(presetId) };
      if (!r.ok) throw new Error("layout HTTP " + r.status);
      return r.json().then(function (raw) { return { raw: raw }; });
    }).then(function (res) {
      if (res.layout) return res;
      var raw = res.raw;
      /* 與 Preset 的 sourcePresetId 守門同一個安全原則：內容宣稱自己屬於
         哪一份 preset，就只能套用在那一份上。id 剛好重疊時會產生錯誤分組。 */
      if (!raw || raw.presetId !== presetId) {
        return {
          layout: VFXLayoutSchema.emptyLayout(presetId),
          error: "分組檔宣稱屬於 " + (raw && raw.presetId) + "，與目前的 " +
            presetId + " 不符，已忽略（檔案未被覆寫）"
        };
      }
      var check = VFXLayoutSchema.validateLayout(raw);
      if (!check.ok) {
        return {
          layout: VFXLayoutSchema.emptyLayout(presetId),
          error: "分組檔不合法，已忽略（檔案未被覆寫）：\n- " + check.errors.join("\n- ")
        };
      }
      return { layout: raw };
    }).catch(function (e) {
      return {
        layout: VFXLayoutSchema.emptyLayout(presetId),
        error: "分組檔讀取失敗，已忽略：" + (e && e.message || e)
      };
    });
  }

  /* 每次改動 layout 就 +1。存檔成功時只有「revision 沒變」才敢清 dirty——
     否則使用者在 request 飛在半空中時改的東西會被當成已存檔，重整後靜默消失。 */
  /* 分組有沒有改過，一律以內容比對為準，不用黏著的旗標。

     用旗標的話，「存檔 → 改分組 → Undo 回存檔時的狀態」仍會顯示未存檔，
     而使用者眼前的內容其實和 repo 一模一樣。revision 仍然保留——
     那是給非同步存檔判斷「這次回應能不能替現在的內容背書」用的，
     與「內容有沒有變」是兩件事。 */
  function markLayoutDirty() {
    state.layoutRevision = (state.layoutRevision || 0) + 1;
    refreshDirty();
  }

  function currentLayoutText() {
    if (!state.layout) return null;
    try { return VFXLayoutSchema.serialiseLayout(state.layout); }
    catch (e) { return null; }
  }

  function layoutDirty() {
    if (state.savedLayoutText === undefined) return false;   // 還沒載完
    return currentLayoutText() !== state.savedLayoutText;
  }

  function saveLayout() {
    ensureLayout();
    state.layout.presetId = state.preset.id;
    dropEmptyGroups();
    /* 單一根群組（VFX_AGENT_WORKFLOW §9.11）：一個群組都沒有就把全部圖層收成
       以 preset id 命名的根群組，與 preset-kit 的 writeRootGroupLayout 同一個形狀。
       2026-09-14 使用者回報：另存新檔出來的特效沒有群組（當時是「載入 Preset」沒帶分組）。
       這一道是保險：不管分組是從哪一條路弄丟的，存出去的都不會是散的。 */
    if (!state.layout.groups.length && state.preset.layers.length) {
      state.layout.groups = [{
        id: state.preset.id, name: state.preset.id,
        layerIds: state.preset.layers.map(function (l) { return l.id; })
      }];
      state.layout.order = [keyOf('group', state.preset.id)];
      state.layoutRevision = (state.layoutRevision || 0) + 1;
      renderLayerList();
    }
    var check = VFXLayoutSchema.validateLayout(state.layout);
    if (!check.ok) return Promise.reject(new Error("分組資料不合法：\n- " + check.errors.join("\n- ")));
    /* 送出當下的版本號。使用者不會被擋著不能編輯——只是這次存檔不能
       替後來的改動背書。 */
    var sentAt = state.layoutRevision || 0;
    return fetch(layoutUrl(state.preset.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: VFXLayoutSchema.serialiseLayout(state.layout)
    }).then(bindPane(function (r) {
      return r.json().then(bindPane(function (body) {
        if (!r.ok || !body.ok) throw new Error(body.error || ("HTTP " + r.status));
        /* 只有在送出之後沒有再改過時，才把基準線推到這次存的內容上。
           中途又改了的話，那些改動仍然算未存檔。 */
        if ((state.layoutRevision || 0) === sentAt) {
          state.savedLayoutText = VFXLayoutSchema.serialiseLayout(state.layout);
        }
        refreshDirty();
        return body;
      }));
    }));
  }

  /* ---------------- 收合狀態（只存 localStorage） ---------------- */

  function collapsedKey() { return "vfx-editor.collapsed." + (state.preset ? state.preset.id : ""); }

  function saveCollapsed() {
    try { window.localStorage.setItem(collapsedKey(), JSON.stringify(state.collapsed)); } catch (e) { }
  }

  function loadCollapsed() {
    state.collapsed = {};
    try {
      var raw = window.localStorage.getItem(collapsedKey());
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === "object") state.collapsed = o;
      }
    } catch (e) { }
  }

  /* ---------------- 鍵盤 ----------------
     只在 Layer 操作語境生效。焦點在任何可輸入的欄位裡時一律不攔截，
     否則在 JSON 參數框裡按 Ctrl+C 會變成複製圖層。 */

  function isTextEntry(el) { return M.isTextEntry(el); }

  /* 搜尋／篩選欄位。它們打的字不是 authoring 資料，Ctrl+Z 留給瀏覽器。
     用 type=search 判斷而不是列 id：新增搜尋框時不必回來改這裡。 */
  function isSearchInput(el) {
    return !!(el && el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'search');
  }

  function doUndo() {
    var history = state.history;
    if (!history || !history.canUndo()) return;
    history.undo();
  }
  function doRedo() {
    var history = state.history;
    if (!history || !history.canRedo()) return;
    history.redo();
  }

  /* 焦點是否落在某個曲線編輯器裡。用 closest 而不是逐一問每個元件，
     這樣即使元件已經被換掉，判斷仍然只看目前的 DOM。 */
  function inCurveEditor(el) {
    return !!(el && el.closest && el.closest('.curve'));
  }

  /* Ctrl／Cmd ＋ 這些字母交給編輯器吃掉，不讓瀏覽器接手。
     's' 由上面的存檔分支自己處理，所以不在這一串裡。 */
  var BROWSER_SHORTCUT_KEYS = 'opfgdu';

  function onKeyDown(e) {
    /* 已經按過關閉：伺服器沒了，任何快捷鍵都只會得到一個失敗的請求。 */
    if (quitting) return;
    /* Escape 仍然排第一：拖曳中不論焦點在哪都要取消得掉，而且它不會誤刪東西。
       沒有拖曳時 cancelDrag() 回 false，所以擺在 state.preset 的守門之前也安全。 */
    if (e.key === 'Escape' && cancelDrag()) { e.preventDefault(); return; }

    /* Ctrl+S 排在其餘所有守門之前，連 state.preset 都還沒判斷。

       第一件事是 preventDefault：不擋的話瀏覽器會跳出「另存新檔」，把整個
       編輯器頁面存成 .html——那個對話框還會吃掉焦點。所以只要在這一頁按了
       Ctrl+S，就一律由我們接手，即使當下沒有東西可存。

       第二件事是先讓輸入框收尾。數值欄位是 change（失焦或 Enter）才寫回
       preset 的，在欄位裡打完數字直接按 Ctrl+S 的話，序列化會取到打字之前的
       舊值——存進去的內容和畫面上看到的不一樣，而且完全沒有跡象。
       blur() 會同步觸發那一格的 change 與 wireFieldTransaction 的 editCommit，
       所以走到 savePreset 時資料與歷史都已經是最新的。 */
    if ((e.ctrlKey || e.metaKey) && (e.key || '').toLowerCase() === 's' && !e.altKey) {
      e.preventDefault();
      var active = document.activeElement;
      if (active && isTextEntry(active) && typeof active.blur === 'function') active.blur();
      if (state.preset) savePreset();
      return;
    }
    /* 其餘會打斷編輯的瀏覽器快捷鍵一律吃掉。這是編輯器，不是文件檢視器：
       Ctrl+P 跳列印、Ctrl+O 開系統的檔案對話框、Ctrl+F 叫出瀏覽器的尋找列並
       偷走焦點、Ctrl+D 加書籤、Ctrl+U 開原始碼——每一個都會把人踢出正在做的事，
       而且沒有一個在這裡有意義。

       刻意**不**擋的三類，各有理由：
         Ctrl+C／V／X／A／Z／Y  編輯器自己要用，或文字欄位需要
         Ctrl+R／F5            重整有時候就是想要的；未存檔的保護改用
                               beforeunload，那條連「直接關分頁」也一起顧到
         Ctrl+W／T／N、F11…    瀏覽器層級的，preventDefault 根本攔不到。
                               列進來只會給人「已經擋住了」的錯覺，更糟。 */
    if ((e.ctrlKey || e.metaKey) && !e.altKey &&
        BROWSER_SHORTCUT_KEYS.indexOf((e.key || '').toLowerCase()) >= 0) {
      e.preventDefault();
      return;
    }
    if (e.key === 'F3') { e.preventDefault(); return; }   // 尋找下一個

    if (!state.preset) return;

    /* Undo／Redo 排在文字輸入的守門**之前**：這是編輯器，不是文字編輯器，
       在 Inspector 的數值欄位按 Ctrl+Z 應該回上一步編輯，而不是還原那一格的字。

       唯一的例外是搜尋框（type=search）：Asset Browser 與素材選擇器的搜尋字串
       不是 authoring 資料，在那裡按 Ctrl+Z 卻回滾整份 preset 會非常嚇人，
       所以那裡交還給瀏覽器原生行為。 */
    if ((e.ctrlKey || e.metaKey) && !isSearchInput(document.activeElement)) {
      var uk = (e.key || '').toLowerCase();
      if (uk === 'z' && !e.shiftKey) { doUndo(); e.preventDefault(); return; }
      if (uk === 'y' || (uk === 'z' && e.shiftKey)) { doRedo(); e.preventDefault(); return; }
    }
    if (!$('picker').hidden) return;                      // Picker 開著時鍵盤歸它
    if (!$('preset-browser').hidden) return;              // 瀏覽特效開著時也是
    if (!$('spine-ref').hidden) return;                   // Spine 參考面板也是（它有滑桿吃方向鍵）
    /* 焦點在任何可輸入的欄位裡就完全不攔截：在 JSON 參數框或搜尋框按 Delete
       要刪字元，不是刪圖層；按 Ctrl+C 要複製文字，不是複製圖層。 */
    if (isTextEntry(document.activeElement)) return;
    /* 焦點在曲線編輯器裡時，Delete 屬於曲線的控制點。
       曲線元件自己會 stopPropagation，這裡是第二道防線：即使事件因為
       某個路徑繞過了它，也不能把整個圖層刪掉——刪錯的代價差太多。 */
    if (inCurveEditor(document.activeElement)) return;

    /* 方向鍵移動選取的圖層（見 nudgeSelection）。Alt＋方向鍵是瀏覽器的上一頁／下一頁、
       Ctrl＋方向鍵留給以後，都不攔；拖曳框或平移鏡頭到一半時也不動。 */
    var dir = NUDGE_KEYS[e.key];
    if (dir) {
      if (e.ctrlKey || e.metaKey || e.altKey || gizmo.drag || state.pan) return;
      var step = e.shiftKey ? NUDGE_SHIFT_STEP : 1;
      if (nudgeSelection(dir[0] * step, dir[1] * step)) e.preventDefault();
      return;
    }

    var k = (e.key || '').toLowerCase();
    if (k === 'delete') {
      if (!state.selectedKeys.length) return;
      deleteSelection();
      e.preventDefault();
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    if (k === 'c') { copySelection(); e.preventDefault(); return; }
    if (k === 'v') { pasteClipboard(); e.preventDefault(); }
  }


  /* ---------------- Inspector ---------------- */

  function makeField(label, control) {
    var wrap = document.createElement('div');
    wrap.className = 'field';
    var l = document.createElement('label');
    l.textContent = label;
    wrap.appendChild(l);
    wrap.appendChild(control);
    return wrap;
  }

  /* 輸入框的交易邊界：focus 開始、blur 收尾。

     不這樣做的話，打「1.25」會變成 1、1.（無效）、1.2、1.25 四筆歷史，
     Ctrl+Z 要按四次才回得到原值。核取方塊與下拉選單沒有「輸入到一半」的
     狀態，change 當下就是完整的一步。

     值最後沒變就不會留下任何一步——那是 history.commit() 自己判斷的。 */
  function wireFieldTransaction(control, label) {
    var inputs = control.tagName === 'INPUT' || control.tagName === 'SELECT' ||
      control.tagName === 'TEXTAREA' ? [control] : control.querySelectorAll('input, select, textarea');
    Array.prototype.forEach.call(inputs, function (el) {
      var type = String(el.type || '').toLowerCase();
      if (el.tagName === 'SELECT' || type === 'checkbox' || type === 'color') {
        /* 一次點擊就是完整的一步，沒有中間狀態 */
        el.addEventListener('change', function () { editCommit(); });
        el.addEventListener('mousedown', function () { editBegin('修改 ' + label); });
        el.addEventListener('keydown', function () { editBegin('修改 ' + label); });
        return;
      }
      el.addEventListener('focus', function () { editBegin('修改 ' + label); });
      /* 收尾點放在 change，不放在 keydown。

         change 才是「值真的寫回 preset」的那一刻：
           oninput 欄位（數字、向量、角度）打字時就寫回去了，change 只是收尾；
           onchange 欄位（json、角度區間、assetId）要等到 change 才寫。

         原本 Enter 是在 keydown 收尾的，對後者早了一步——瀏覽器的順序是
         keydown 先、change 後，所以 commit 當下 preset 還沒變，history 判定
         「前後沒有差別」而把整筆交易丟掉；緊接著 change 才把值寫進去，於是
         那次修改完全不在歷史裡。症狀不只是「按 Ctrl+Z 沒反應」：之後的 undo
         會跳過它、直接回到更早的狀態，那個值永遠回不去。
         2026-09-11 實測 startScale：Enter 之後 dirty 亮著、undo 卻是
         「沒有可復原的動作」。

         Enter 仍然當場收尾——瀏覽器會在 Enter 時派送 change，語意不變。 */
      el.addEventListener('change', function () {
        editCommit();
        /* 按了 Enter 常常還會繼續改同一格，所以還在焦點裡就接著開下一筆，
           不然 Enter 之後的修改會沒有交易可以歸屬。 */
        if (document.activeElement === el) editBegin('修改 ' + label);
      });
      el.addEventListener('blur', function () { editCommit(); });
    });
  }

  /* 換算後的小數尾巴（0.5235987755982988 → 30）不該出現在輸入框裡 */
  function round4(v) { return Math.round(v * 10000) / 10000; }
  /* 米數是給人讀的參考值，一位小數就夠——30.4 米比 30.4128 米好讀。 */
  function round1(v) { return Math.round(v * 10) / 10; }

  var INVALID = {};

  function angleRangeToText(v) {
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) {
      return '[' + v.map(function (x) { return round4(VFXCurveModel.radToDeg(x)); }).join(', ') + ']';
    }
    return String(round4(VFXCurveModel.radToDeg(v)));
  }

  /* 空字串＝這個欄位不存在。格式錯誤回傳 INVALID，讓呼叫端把輸入框標紅，
     而不是靜靜吃掉——寫錯了卻沒有反應是最難查的那種。 */
  function angleRangeFromText(text) {
    var t = String(text).trim();
    if (!t) return undefined;
    var parsed;
    try { parsed = JSON.parse(t); } catch (e) { return INVALID; }
    if (typeof parsed === 'number' && isFinite(parsed)) return VFXCurveModel.degToRad(parsed);
    if (Array.isArray(parsed) && parsed.length === 2 &&
        parsed.every(function (x) { return typeof x === 'number' && isFinite(x); })) {
      return parsed.map(VFXCurveModel.degToRad);
    }
    return INVALID;
  }

  /* ---------------- Preset 區塊 ----------------

     圖層以外的 Preset 級欄位，目前只有 loop。

     它原本在工具列，就擠在 ▶ ⏸ ⟲ 旁邊——那個位置讀起來像播放控制，於是
     「我想重複看這顆爆點」會被改到出貨資料上：loop 決定的是**遊戲裡**這個特效
     會不會自己重複（光環會、爆點不會，152 份 preset 各有各的答案）。
     移進 Inspector 之後它與其他會寫進 json 的欄位並排，語意才一致；
     工具列原本那一格換成純預覽的「預覽循環」。 */
  function renderPresetSection(host) {
    if (!state.preset) return;
    var title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = 'Preset';
    host.appendChild(title);

    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!state.preset.loop;
    chk.title = '遊戲裡這個特效會不會自己重複播放。' +
      '只是想在編輯時反覆看，請用工具列的「預覽循環」。';
    chk.onchange = function () {
      state.preset.loop = chk.checked;
      onPresetChanged();
    };
    wireFieldTransaction(chk, 'loop');
    host.appendChild(makeField('loop', chk));
  }

  /* ---------------- 群組區塊 ----------------

     群組在資料上並不存在：preset 沒有父子結構，一次群組變形當場就攤到每個子圖層
     的 base transform 上（見 gizmo-model.js 的「群組變形」段落）。所以群組沒有
     「自己的」scale 與 rotation 可以顯示出來。

     於是這裡的欄位分成兩種，而且在標籤上就分得出來：

       絕對值（中心 x/y、寬、高）
         由目前的子圖層即時算出來（groupBounds），永遠是真的。輸入絕對值，
         換算成一次群組變形套下去。
       相對值（縮放 ×、旋轉 Δ°）
         群組沒有基準可以比對。硬記一個「原始大小」進 layout 的話，只要有人
         單獨改過其中一層，那個數字就開始說謊——而且不會有任何跡象。
         所以這兩格是「再套用多少」，套完歸回 1 與 0。

     「不知道具體縮放了多少」問的其實是「現在這東西多大」。那是寬與高，
     所以底下直接標出米數，與預覽格線同一把尺（1 米 = 10px）。 */
  function renderGroupSection(host, group) {
    var members = group.layerIds.map(layerById).filter(Boolean);
    var title = document.createElement('div');
    title.className = 'group-title keep-case';   // 群組名是使用者取的，不要被 uppercase 改寫
    title.textContent = '群組「' + group.name + '」（' + members.length + ' 層）';
    host.appendChild(title);

    var b = members.length ? G.groupBounds(members, sizeOf, spaceOf) : null;
    if (!b) {
      var hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = '這個群組量不出框（成員都沒有可用的尺寸）。\n' +
        '選取單一圖層仍然可以編輯它的參數。';
      host.appendChild(hint);
      return;
    }

    groupField(host, '中心 x', round4(b.pivot.x), function (v) {
      applyGroupDelta('移動群組', { dx: v - b.pivot.x, dy: 0 });
    });
    groupField(host, '中心 y', round4(b.pivot.y), function (v) {
      applyGroupDelta('移動群組', { dx: 0, dy: v - b.pivot.y });
    });
    groupField(host, '寬（px）', round4(b.w), function (v) {
      if (!(v > 0) || !(b.w > 0)) return;
      applyGroupDelta('縮放群組', { sx: v / b.w, sy: 1 });
    }, '整個群組的外框寬度');
    groupField(host, '高（px）', round4(b.h), function (v) {
      if (!(v > 0) || !(b.h > 0)) return;
      applyGroupDelta('縮放群組', { sx: 1, sy: v / b.h });
    }, '整個群組的外框高度');
    groupField(host, '縮放 ×', 1, function (v) {
      if (!(v > 0) || v === 1) return;
      applyGroupDelta('縮放群組', { sx: v, sy: v });
    }, '再等比乘上這個倍率。群組沒有「原始大小」可以比對，所以套用後歸 1');
    groupField(host, '旋轉 Δ°', 0, function (v) {
      if (!v) return;
      applyGroupDelta('旋轉群組', { rot: VFXCurveModel.degToRad(v) });
    }, '再轉這麼多度（子圖層各有各的角度，群組沒有單一角度可顯示）。套用後歸 0');

    var note = document.createElement('div');
    note.className = 'hint';
    note.textContent =
      round1(b.w / VFXViewModel.PX_PER_METRE) + ' × ' +
      round1(b.h / VFXViewModel.PX_PER_METRE) + ' 米' +
      '（預覽格線 1 大格 = ' + VFXViewModel.METRES_PER_CELL + ' 米）';
    host.appendChild(note);
  }

  /* 用 change（失焦或 Enter）而不是 input：套用一次群組變形會重算每個子圖層
     並重繪 Inspector，逐字觸發的話打「1.25」會連做三次全群組縮放。 */
  function groupField(host, label, value, commit, title) {
    var el = document.createElement('input');
    el.type = 'number';
    el.step = '0.01';
    el.value = value;
    if (title) el.title = title;
    el.onchange = function () {
      var v = Number(el.value);
      if (!isFinite(v)) { el.value = value; return; }
      commit(v);
    };
    host.appendChild(makeField(label, el));
  }

  /* 走的是與拖曳完全相同的那條路（snapshot → applyGroupTransform →
     writeGroupTransform）。自己另外寫一套「用數字縮放」的話，粒子的
     startScale／speed／spawn／gravity 這些只有群組變形才會動到的欄位
     一定會漏掉，於是用拖的和用打的結果不一樣。 */
  function applyGroupDelta(label, delta) {
    var t = gizmoTarget();
    if (!t || t.kind !== 'group' || !t.bounds) return;
    edit(label, function () {
      writeGroupDelta(t.layers, G.groupSnapshot(t.layers), t.bounds.pivot, delta);
    });
    markGizmoDirty();
    onPresetChanged();
    renderInspector();                 // 欄位要顯示變形後的新數值
  }

  /* ---------------- 多選的顯示與寫入 ----------------

     每一格欄位都要回答兩件事：「顯示什麼」與「改了寫到哪幾層」。
     寫到哪幾層永遠是 inspectorTargets() 的全部；顯示什麼分兩種——各層相同就顯示
     那個值，不同就留空並標上「多個值」（理由見 multi-edit-model.js 開頭）。 */

  var MIXED_TEXT = '多個值';
  var MIXED_TITLE = '選取的圖層這一欄數值不同。輸入新值會套用到全部；保持空白就不會改到任何一層。';

  function markMixed(el, mixed) {
    el.classList.toggle('mixed', !!mixed);
    if (mixed) {
      if (!el.hasAttribute('data-base-placeholder')) {
        el.setAttribute('data-base-placeholder', el.placeholder || '');
        el.setAttribute('data-base-title', el.title || '');
      }
      el.placeholder = MIXED_TEXT;
      el.title = MIXED_TITLE;
    } else if (el.hasAttribute('data-base-placeholder')) {
      el.placeholder = el.getAttribute('data-base-placeholder');
      el.title = el.getAttribute('data-base-title');
      el.removeAttribute('data-base-placeholder');
      el.removeAttribute('data-base-title');
    }
  }

  /* commonValue 的結果放進輸入框。沒有這個欄位（undefined）顯示空白，與單選時相同。 */
  function showCommon(input, shown, format) {
    input.value = shown.mixed || shown.value === undefined
      ? '' : (format ? format(shown.value) : shown.value);
    markMixed(input, shown.mixed);
  }

  function toDegrees(radians) { return round4(VFXCurveModel.radToDeg(radians)); }

  /* vec2 某一軸的讀法。缺省值與 Core 的 layerDefaults 一致：沒寫 scale 的圖層是 1 不是 0，
     否則「全部 scale.x 都是 1」會因為其中一層沒寫而被判成多個值。 */
  function vecAxisReader(key, axis) {
    var fallback = VEC_DEFAULTS[key] || { x: 0, y: 0 };
    return function (l) {
      return (l[key] && l[key][axis] !== undefined) ? l[key][axis] : fallback[axis];
    };
  }

  /* 逐字寫回的數值欄位（oninput）：多選時把一格「多個值」清空，意思是「我不改了」，
     不是「全部刪掉」或「全部歸零」。所以聚焦當下若是混合值，就先記下每一層的原值，
     清空時照原樣放回去。單選時永遠不是混合值，這條路不會觸發，行為與原本相同。

     回傳的函式放在 oninput 的開頭：回 true 代表已經還原，這次輸入不必再寫。 */
  function clearRestorer(input, targets, key, isMixed) {
    var saved = null;
    input.addEventListener('focus', function () {
      saved = isMixed() ? MX.captureField(targets, key) : null;
    });
    return function () {
      if (input.value !== '' || !saved) return false;
      MX.restoreField(targets, key, saved);
      onPresetChanged();
      return true;
    };
  }

  /* 水龍捲是程序生成圖層：沒有序列圖集、平鋪尺寸或 procedural effect 可調 */
  var WATER_TORNADO_HIDDEN_FIELDS = ['sheet', 'size', 'scrollSpeed', 'effect'];

  function fieldsOf(layer, list) {
    /* 空物件：Core 會把 assetId、blendMode、anchor、zIndex、sheet 當成不支援的欄位擋下，
       顯示出來只會讓人填了之後存不了檔。清單以 Core 為準，不另抄一份。 */
    if (layer.type === 'empty') {
      return list.filter(function (f) { return VFXCore.EMPTY_LAYER_FIELDS.indexOf(f.key) >= 0; });
    }
    if (layer.effect !== 'waterTornado') return list;
    return list.filter(function (f) { return WATER_TORNADO_HIDDEN_FIELDS.indexOf(f.key) < 0; });
  }

  /* 要顯示哪些欄位。單選就是該型別的完整清單；多選時取交集，另外拿掉兩格：
       id       每一層必須不同，批次寫同一個值只會撞名
       assetId  混有水龍捲時——那種圖層沒有素材可換 */
  function inspectorFields(targets) {
    var multi = targets.length > 1;
    var common = MX.sharedFields(targets.map(function (l) { return fieldsOf(l, COMMON_FIELDS); }));
    var typed = MX.sharedFields(targets.map(function (l) { return fieldsOf(l, TYPE_FIELDS[l.type] || []); }));
    if (multi) {
      var hasWater = targets.some(function (l) { return l.effect === 'waterTornado'; });
      common = common.filter(function (f) {
        return f.key !== 'id' && !(f.kind === 'asset' && hasWater);
      });
    }
    var types = [];
    targets.forEach(function (l) { if (types.indexOf(l.type) < 0) types.push(l.type); });
    var title = { kind: 'title', label: types.join('／') + (types.length > 1 ? ' 共通' : ' 專屬') };
    return common.concat(multi && !typed.length ? [] : [title], typed);
  }

  /* 「父物件」下拉。選項是掛得上去的圖層（排除自己與自己的子孫、會超過深度上限的），
     照面板的樹狀順序、依深度縮排，看得出誰在誰底下。
     選了就換算數值讓畫面不動（H.attach）；多選時每一層都掛到同一個父物件——這是欄位寫入的語意，
     父子一起被選時會一起變成兄弟。擋下時講原因，下拉重畫回原本的值。 */
  function parentSelect(targets) {
    var select = document.createElement('select');
    var ids = targets.map(function (l) { return l.id; });
    var current = MX.commonValue(targets, function (l) { return H.parentIdOf(l); });
    var eligible = H.eligibleParents(state.preset, ids);
    if (current.mixed) {
      var mixedOption = document.createElement('option');
      mixedOption.value = '';
      mixedOption.textContent = '（' + MIXED_TEXT + '）';
      mixedOption.disabled = true;
      mixedOption.selected = true;
      select.appendChild(mixedOption);
    }
    var none = document.createElement('option');
    none.value = '';
    none.textContent = '（無，根層級）';
    select.appendChild(none);
    H.treeRows(state.preset, buildRows(), {}).forEach(function (r) {
      if (r.kind !== 'layer') return;
      if (eligible.indexOf(r.id) < 0 && current.value !== r.id) return;
      var l = layerById(r.id);
      var o = document.createElement('option');
      o.value = r.id;
      o.textContent = new Array(r.depth + 1).join('\u00a0\u00a0\u00a0') + r.id + '（' + l.type + '）';
      select.appendChild(o);
    });
    if (!current.mixed) select.value = current.value || '';
    select.onchange = function () {
      var result = H.attach(state.preset, ids, select.value || null);
      if (!result.ok) {
        showSaveError('無法設定父物件', [result.error]);
        renderInspector();
        return;
      }
      announceHierarchyNotes(result.notes);
      markGizmoDirty();
      onPresetChanged();
      renderLayerList();
      renderInspector();
    };
    return select;
  }

  /* 掛上／卸下之後沒辦法完全保持原樣的地方，寫在頂端狀態列（與「已改用檔名」同一個位置與樣式），
     滑鼠移上去看每一層的原因。完全保持原樣時不出聲——面板上的縮排就是結果。 */
  function announceHierarchyNotes(notes) {
    var lines = H.describeNotes(notes);
    if (!lines.length) return;
    setSaveStatus(lines.length === 1 ? lines[0] : '父子層級：' + lines.length + ' 項沒辦法完全保持原樣',
      'note', lines.join('\n'));
  }

  /* 多選的標題：幾層、什麼型別；滑鼠停在標題上會列出全部 id。 */
  function renderMultiHeader(host, targets) {
    var counts = {};
    var types = [];
    targets.forEach(function (l) {
      if (!counts[l.type]) { counts[l.type] = 0; types.push(l.type); }
      counts[l.type]++;
    });
    var title = document.createElement('div');
    title.className = 'group-title keep-case';
    title.textContent = '多選：' + targets.length + ' 個圖層（' + (types.length === 1
      ? types[0] : types.map(function (t) { return t + ' ' + counts[t]; }).join('、')) + '）';
    title.title = targets.map(function (l) { return l.id; }).join('\n');
    host.appendChild(title);
    var hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '改任何一欄都會套用到全部選取的圖層，Ctrl+Z 一次全部復原。\n' +
      '顯示「多個值」的欄位＝各層不同，不去動它就不會被改到。';
    host.appendChild(hint);
  }

  function renderInspector() {
    if (state.inBackground) return;           // Inspector 顯示的是焦點視窗那一份
    var host = $('inspector');
    /* 舊的曲線元件在 window 上掛了 mousemove／mouseup，不收掉會越積越多，
       而且已被移除的 canvas 仍會在每次滑鼠移動時做命中測試。 */
    destroyCurveEditors();
    host.innerHTML = '';
    /* Preset 級欄位不隨選取變動，所以永遠在最上面——包括沒選任何圖層的時候。 */
    renderPresetSection(host);
    var targets = inspectorTargets();
    if (!targets.length) {
      var g = activeGroup();
      if (g) { renderGroupSection(host, g); return; }
      var hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = '未選取圖層';
      host.appendChild(hint);
      return;
    }
    if (targets.length > 1) renderMultiHeader(host, targets);
    /* lead 只拿來讀「單選時才會出現」的東西（id 欄位、水龍捲的來源標示）；
       欄位的寫入一律是 targets 的全部。 */
    var lead = targets[0];

    inspectorFields(targets).forEach(function (f) {
      if (f.kind === 'title') {
        var t = document.createElement('div');
        t.className = 'group-title';
        t.textContent = f.label;
        host.appendChild(t);
        return;
      }
      var control;
      if (f.kind === 'asset' && lead.effect === 'waterTornado') {
        control = document.createElement('div'); control.className = 'asset-field';
        var source = document.createElement('input'); source.type = 'text'; source.readOnly = true;
        source.value = 'waterTornado/' + lead.water.part; source.title = '內建程序組件識別，不是素材路徑';
        source.setAttribute('data-generated-source', lead.water.part);
        var badge = document.createElement('span'); badge.textContent = '程序生成'; badge.style.whiteSpace = 'nowrap'; badge.style.alignSelf = 'center';
        control.appendChild(source); control.appendChild(badge);
      } else if (f.kind === 'parent') {
        control = parentSelect(targets);
      } else if (f.kind === 'bool') {
        control = document.createElement('input');
        control.type = 'checkbox';
        /* 每個布林欄位的預設值不同：enabled 沒寫就是開，alignToVelocity 沒寫就是關。
           一律用「!== false」會讓沒設定的 alignToVelocity 顯示成已勾選。 */
        var boolDefault = f.default !== false;
        var flag = MX.commonValue(targets, function (l) {
          return l[f.key] === undefined ? boolDefault : l[f.key] !== false;
        });
        control.checked = !flag.mixed && flag.value;
        /* 各層不同：顯示半勾。點一下就把全部設成同一個值。 */
        control.indeterminate = flag.mixed;
        if (flag.mixed) control.title = '選取的圖層有的開、有的關。點一下會把全部設成同一個值。';
        control.onchange = function () { MX.writeAll(targets, f.key, control.checked); onPresetChanged(); };
      } else if (f.kind === 'select') {
        control = document.createElement('select');
        var choice = MX.commonValue(targets, function (l) { return l[f.key] || f.options()[0]; });
        if (choice.mixed) {
          /* 佔位選項：選不回來，只是讓下拉顯示「多個值」而不是冒充第一個選項 */
          var mixedOption = document.createElement('option');
          mixedOption.value = '';
          mixedOption.textContent = '（' + MIXED_TEXT + '）';
          mixedOption.disabled = true;
          mixedOption.selected = true;
          control.appendChild(mixedOption);
        }
        f.options().forEach(function (v) {
          var o = document.createElement('option');
          o.value = v; o.textContent = v;
          control.appendChild(o);
        });
        if (!choice.mixed) control.value = choice.value;
        control.onchange = function () { MX.writeAll(targets, f.key, control.value); onPresetChanged(); };
      } else if (f.kind === 'color') {
        /* 色票沒有「空白」可以顯示：混合時先放第一層的顏色，旁邊明寫「多個值」；
           改了顏色之後全部一致，說明也跟著收掉。 */
        var colour = MX.commonValue(targets, function (l) {
          return String(l[f.key] || '#ffffff').toLowerCase();
        });
        var swatch = document.createElement('input');
        swatch.type = 'color';
        swatch.value = colour.mixed ? (lead[f.key] || '#ffffff') : colour.value;
        var colourNote = null;
        swatch.oninput = function () {
          MX.writeAll(targets, f.key, swatch.value);
          if (colourNote) colourNote.hidden = true;
          onPresetChanged();
        };
        control = swatch;
        if (colour.mixed) {
          control = document.createElement('div');
          control.className = 'mixed-color';
          control.title = MIXED_TITLE;
          colourNote = document.createElement('span');
          colourNote.className = 'mixed-note';
          colourNote.textContent = MIXED_TEXT;
          control.appendChild(swatch);
          control.appendChild(colourNote);
        }
      } else if (f.kind === 'vec2') {
        control = document.createElement('div');
        control.style.display = 'flex';
        control.style.gap = '4px';
        // 缺省值必須與 Core 的 layerDefaults 一致：顯示 0 會讓人只改一軸就把另一軸歸零，
        // 例如 scale 變成 {x:2,y:0} → 預覽整個消失
        var fallback = VEC_DEFAULTS[f.key] || { x: 0, y: 0 };
        ['x', 'y'].forEach(function (axis) {
          var input = document.createElement('input');
          input.type = 'number';
          input.step = '0.01';
          /* 給 Gizmo 拖曳時定位用。整個 Inspector 重繪會把曲線元件也換掉，
             拖曳期間只更新這幾格就好。 */
          input.setAttribute('data-tf', f.key + '.' + axis);
          /* 一軸一格：多選時只改 X，各層的 Y 保持各自的值 */
          var readAxis = vecAxisReader(f.key, axis);
          showCommon(input, MX.commonValue(targets, readAxis));
          var restoreAxis = clearRestorer(input, targets, f.key, function () {
            return MX.commonValue(targets, readAxis).mixed;
          });
          input.oninput = function () {
            if (restoreAxis()) return;
            var v = Number(input.value);
            targets.forEach(function (l) {
              if (!l[f.key]) l[f.key] = { x: fallback.x, y: fallback.y };
              l[f.key][axis] = v;
            });
            onPresetChanged();
          };
          control.appendChild(input);
        });
      } else if (f.kind === 'json') {
        control = document.createElement('input');
        control.type = 'text';
        var jsonShown = MX.commonValue(targets, function (l) { return l[f.key]; });
        control.value = jsonShown.mixed || jsonShown.value === undefined
          ? '' : JSON.stringify(jsonShown.value);
        markMixed(control, jsonShown.mixed);
        /* onchange 欄位沒有逐字的中間狀態，不必記原值：「多個值」留空送出就是不改；
           送出過一個值之後它就是共同值了，之後留空才是移除欄位。 */
        var jsonMixed = jsonShown.mixed;
        control.onchange = function () {
          var raw = control.value.trim();
          if (!raw) {
            if (jsonMixed) return;
            MX.writeAll(targets, f.key, undefined); onPresetChanged(); return;
          }
          var parsed;
          try {
            parsed = JSON.parse(raw);
            control.classList.remove('err');
          } catch (e) {
            control.classList.add('err');
            return;                              // JSON 壞掉就不套用，不 silent 吃掉
          }
          MX.writeAll(targets, f.key, parsed);
          jsonMixed = false;
          markMixed(control, false);
          onPresetChanged();
        };
      } else if (f.kind === 'asset') {
        /* 文字框留著（看得到目前是哪一個 assetId，也能貼上），但正常流程
           不該需要手打 package/path/file.png。 */
        control = document.createElement('div');
        control.className = 'asset-field';
        var textIn = document.createElement('input');
        textIn.type = 'text';
        var assetShown = MX.commonValue(targets, function (l) { return l[f.key] || ''; });
        textIn.value = assetShown.mixed ? '' : assetShown.value;
        textIn.title = assetShown.mixed ? '' : assetShown.value;
        textIn.placeholder = '按「選擇素材」';
        markMixed(textIn, assetShown.mixed);
        var assetMixed = assetShown.mixed;         // 同 json：留空送出＝不改
        textIn.onchange = function () {
          if (assetMixed && !textIn.value) return;
          MX.writeAll(targets, f.key, textIn.value);
          assetMixed = false;
          markMixed(textIn, false);
          textIn.title = textIn.value;
          onPresetChanged();
        };
        var pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        pickBtn.className = 'pick-btn';
        pickBtn.textContent = '選擇素材';
        pickBtn.onclick = function () { openPicker(targets, f.key); };
        control.appendChild(textIn);
        control.appendChild(pickBtn);
      } else if (f.kind === 'text') {
        /* 目前只有 id 是文字欄位，而 id 只在單選時出現（見 inspectorFields），
           所以這裡的 lead 就是那唯一的一層。 */
        control = document.createElement('input');
        control.type = 'text';
        control.value = lead[f.key] || '';
        control.onchange = function () {
          var old = lead[f.key];
          if (f.key === 'id') {
            /* 改 id 必須連 layout 裡的參照一起改，否則那一層會從群組裡
               「消失」變成 root——實測過，Orb A 會從 4 層掉到 3 層。 */
            var next = String(control.value);
            if (!next || next === old) { control.value = old; return; }
            if (M.layerById(state.preset, next)) {
              showSaveError('圖層 id 重複', [next + ' 已經有人用了']);
              control.value = old;
              return;
            }
            ensureLayout();
            M.renameLayer(state.preset, state.layout, old, next);
            if (state.collapsed[H.collapsedKeyOf(old)]) {
              delete state.collapsed[H.collapsedKeyOf(old)];
              state.collapsed[H.collapsedKeyOf(next)] = true;
              saveCollapsed();
            }
            var oldKey = keyOf('layer', old), newKey = keyOf('layer', next);
            state.selectedKeys = state.selectedKeys.map(function (k) {
              return k === oldKey ? newKey : k;
            });
            if (state.activeKey === oldKey) state.activeKey = newKey;
            if (state.anchorKey === oldKey) state.anchorKey = newKey;
            state.selectedLayerId = next;
            markLayoutDirty();
            onPresetChanged(); renderLayerList(); renderInspector();
            return;
          }
          MX.writeAll(targets, f.key, control.value);
          onPresetChanged(); renderLayerList();
        };
      } else if (f.kind === 'angle') {
        control = document.createElement('input');
        control.type = 'number';
        control.step = String(f.step);
        control.setAttribute('data-tf', f.key);
        var readAngle = function (l) { return l[f.key]; };
        showCommon(control, MX.commonValue(targets, readAngle), toDegrees);
        var restoreAngle = clearRestorer(control, targets, f.key, function () {
          return MX.commonValue(targets, readAngle).mixed;
        });
        control.oninput = function () {
          if (restoreAngle()) return;
          MX.writeAll(targets, f.key, control.value === ''
            ? undefined : VFXCurveModel.degToRad(Number(control.value)));
          onPresetChanged();
        };
      } else if (f.kind === 'angleRange') {
        control = document.createElement('input');
        control.type = 'text';
        control.placeholder = '30 或 [0, 360]';
        var rangeShown = MX.commonValue(targets, function (l) { return l[f.key]; });
        control.value = rangeShown.mixed ? '' : angleRangeToText(rangeShown.value);
        markMixed(control, rangeShown.mixed);
        var rangeMixed = rangeShown.mixed;         // 同 json：留空送出＝不改
        control.onchange = function () {
          var next = angleRangeFromText(control.value);
          if (next === INVALID) { control.classList.add('err'); return; }
          control.classList.remove('err');
          if (next === undefined && rangeMixed) return;
          MX.writeAll(targets, f.key, next);
          rangeMixed = false;
          markMixed(control, false);
          onPresetChanged();
        };
      } else {
        control = document.createElement('input');
        control.type = 'number';
        control.step = String(f.step);
        if (f.min !== undefined) control.min = String(f.min);
        if (f.max !== undefined) control.max = String(f.max);
        var readNumber = function (l) { return l[f.key]; };
        showCommon(control, MX.commonValue(targets, readNumber));
        var restoreNumber = clearRestorer(control, targets, f.key, function () {
          return MX.commonValue(targets, readNumber).mixed;
        });
        control.oninput = function () {
          if (restoreNumber()) return;
          MX.writeAll(targets, f.key, control.value === '' ? undefined : Number(control.value));
          onPresetChanged();
        };
      }
      wireFieldTransaction(control, f.label);
      host.appendChild(makeField(f.label, control));
    });

    /* 下面兩段是水龍捲專屬。多選時要「全部選到的圖層都有」才顯示，寫入同樣是全部。 */
    if (targets.every(function (l) {
      return (l.type === 'sprite' || l.effect === 'waterTornado') && l.radiusProfile;
    })) {
      var title = document.createElement('div');
      title.className = 'group-title'; title.textContent = '水柱半徑輪廓'; host.appendChild(title);
      [['centerScale', '中央半徑倍率', 1], ['topRatio', '上端／中央半徑比例', 2],
        ['bottomRatio', '下端／中央半徑比例', 2]].forEach(function (f) {
        var input = document.createElement('input');
        input.type = 'number'; input.min = '0.1'; input.max = '8'; input.step = '0.1';
        input.setAttribute('data-radius-profile', f[0]);
        var readProfile = function (l) {
          return l.radiusProfile[f[0]] === undefined ? f[2] : l.radiusProfile[f[0]];
        };
        showCommon(input, MX.commonValue(targets, readProfile));
        var restoreProfile = clearRestorer(input, targets, 'radiusProfile', function () {
          return MX.commonValue(targets, readProfile).mixed;
        });
        input.oninput = function () {
          if (restoreProfile()) return;
          var value = Number(input.value);
          if (!input.value || !Number.isFinite(value) || value < 0.1 || value > 8) return;
          targets.forEach(function (l) { l.radiusProfile[f[0]] = value; }); onPresetChanged();
        };
        wireFieldTransaction(input, f[1]); host.appendChild(makeField(f[1], input));
      });
      var hint = document.createElement('div'); hint.className = 'hint';
      hint.textContent = '比例 2 表示該端半徑是中央的兩倍。只調整特效輪廓，傷害範圍仍由技能表決定。';
      host.appendChild(hint);
    }

    if (targets.every(function (l) { return l.effect === 'waterTornado'; })) {
      var parts = [];
      targets.forEach(function (l) { if (parts.indexOf(l.water.part) < 0) parts.push(l.water.part); });
      [['speed', '氣流速度倍率'], ['density', '粒子數量倍率']].forEach(function (field) {
        if (field[0] === 'density' && parts.some(function (p) { return ['dust', 'spray'].indexOf(p) < 0; })) return;
        var input = document.createElement('input'); input.type = 'number'; input.min = 0; input.max = 4; input.step = .1;
        var readWater = function (l) { return l.water[field[0]] === undefined ? 1 : l.water[field[0]]; };
        showCommon(input, MX.commonValue(targets, readWater));
        input.setAttribute('data-water-param', field[0]);
        var restoreWater = clearRestorer(input, targets, 'water', function () {
          return MX.commonValue(targets, readWater).mixed;
        });
        input.oninput = function () {
          if (restoreWater()) return;
          var v = Number(input.value);
          if (input.value && Number.isFinite(v) && v >= 0 && v <= 4) {
            targets.forEach(function (l) { l.water[field[0]] = v; }); onPresetChanged();
          }
        };
        wireFieldTransaction(input, field[1]); host.appendChild(makeField(field[1], input));
      });
      var note = document.createElement('div'); note.className = 'hint'; note.textContent = '即時計算圖層：' + parts.join('、') + '。可分別調整色彩、透明度、位置、縮放與氣流速度；沒有序列圖集。'; host.appendChild(note);
    }
    renderOverLife(host, targets);
    /* Canvas 要量得到自己的寬高才畫得對，而元素剛 append 時版面還沒定案。
       等下一幀再統一重繪一次——這比依賴 ResizeObserver 可靠，
       它在某些嵌入式瀏覽器裡根本不會觸發。 */
    requestAnimationFrame(function () {
      liveEditors.forEach(function (c) { c.redraw(); });
    });
  }

  /* ---------------- Over-Life 區塊 ----------------

     Inspector 很窄，七張圖同時展開會變成幾千像素的長條。所以分成三個
     可收合群組，預設只開 Alpha——多數調整從它開始。
     收合狀態存在 state 而不是 localStorage：它跟著「目前在編哪一層」，
     不是使用者的長期偏好。 */

  var overLifeOpen = { alpha: true, color: false, scale: false, rotation: false, offset: false };
  var liveEditors = [];                      // 目前掛在畫面上的曲線元件，換層時要收掉
  /* 'sections' 分區收合（省空間）／'compare' 全部攤開對照（共用時間軸）。
     存在 state 而不是 localStorage：它是當下的工作方式，不是長期偏好。 */
  var overLifeMode = 'sections';

  /* 把時間游標同步到所有圖上。這是「對照」的核心：滑鼠停在 42% 的位置，
     每一張圖都畫上同一條線並顯示自己在那個時間的值，一眼就能讀出
     「這一刻透明度 0.8、縮放 1.5、轉了 90 度」。 */
  function broadcastCursor(t) {
    liveEditors.forEach(function (c) { c.setCursor(t); });
  }

  function destroyCurveEditors() {
    liveEditors.forEach(function (c) { c.destroy(); });
    liveEditors = [];
  }

  function curveSection(host, key, title, build) {
    var wrap = document.createElement('div');
    wrap.className = 'ol-section';
    var head = document.createElement('button');
    head.type = 'button';
    head.className = 'ol-head';
    /* 對照模式一律攤開：那個模式的重點就是同時看到全部，
       留一個能把它收起來的按鈕只會讓人不小心破壞對照。 */
    var open = overLifeMode === 'compare' || overLifeOpen[key];
    head.textContent = (overLifeMode === 'compare' ? '' : (open ? '▾ ' : '▸ ')) + title;
    head.disabled = overLifeMode === 'compare';
    head.onclick = function () { overLifeOpen[key] = !overLifeOpen[key]; renderInspector(); };
    wrap.appendChild(head);
    if (open) {
      var body = document.createElement('div');
      body.className = 'ol-body';
      build(body);
      wrap.appendChild(body);
    }
    host.appendChild(wrap);
  }

  /* 一張圖 ＋ 它的兩顆按鈕。curve-editor 只管畫與拖，
     「寫回哪個欄位」「什麼時候算改過」留在這裡。 */
  function curveBlock(host, targets, field, policy, label, opts) {
    /* 歷史標籤要看得懂。label 是圖上的軸標（X／Y／Z／XY），
       透明度那一格沒有軸，所以另外給名字。 */
    var what = (opts && opts.name) || (label ? label + ' 軸' : '') || '曲線';
    var row = document.createElement('div');
    row.className = 'ol-row';
    if (label) {
      var tag = document.createElement('span');
      tag.className = 'ol-axis';
      tag.textContent = label;
      row.appendChild(tag);
    }
    /* 多選時各層這條曲線完全相同才畫得出來一起改；不同就走說明列 */
    var shared = MX.commonValue(targets, function (l) { return l[field]; });
    if (shared.mixed) { mixedCurveRow(host, row, targets, field, what); return; }
    var editor = VFXCurveEditor.create({
      curve: shared.value,
      policy: policy,
      height: opts && opts.height,
      /* onLive 在拖曳途中一直呼叫：只更新預覽，不重畫 Inspector
         （重畫會把正在拖的 canvas 換掉，拖曳就斷了）。 */
      /* 曲線的一次操作＝一筆歷史。onBegin 在 pointerdown／按下 Delete 時觸發，
         onChange 是收尾點；中間的 onLive 只更新畫面。 */
      onBegin: function (action) { editBegin(action + what); },
      onLive: function (curve) { writeCurve(targets, field, curve); previewSoon(); },
      onChange: function (curve) { writeCurve(targets, field, curve); onPresetChanged(); editCommit(); },
      onCursor: broadcastCursor
    });
    liveEditors.push(editor);
    row.appendChild(editor.el);

    var tools = document.createElement('div');
    tools.className = 'ol-tools';
    var reset = document.createElement('button');
    reset.type = 'button'; reset.textContent = 'Reset';
    reset.title = '回到單一常數點';
    reset.onclick = function () {
      edit('重設 ' + what, function () { editor.reset(); });
      renderInspector();
    };
    var off = document.createElement('button');
    off.type = 'button';
    off.textContent = shared.value === undefined ? '啟用' : '停用';
    off.title = '停用＝移除這條曲線，該屬性整段生命週期維持基礎值';
    off.onclick = function () {
      var on = targets[0][field] === undefined;
      edit((on ? '啟用 ' : '停用 ') + what, function () {
        if (on) editor.reset(); else editor.clear();
      });
      renderInspector();
    };
    tools.appendChild(reset); tools.appendChild(off);
    row.appendChild(tools);
    host.appendChild(row);
  }

  /* 顏色曲線用另一個元件（色帶＋色標），但外框、歷史、停用按鈕與數值曲線共用。
     沒有把兩者合進 curveBlock：分支條件會從「哪個欄位」變成「哪一種曲線」，
     而兩邊的 policy、readout、鍵盤行為其實沒有共同點。 */
  function gradientBlock(host, targets, field, opts) {
    var what = (opts && opts.name) || '顏色';
    var row = document.createElement('div');
    row.className = 'ol-row';
    var shared = MX.commonValue(targets, function (l) { return l[field]; });
    if (shared.mixed) { mixedCurveRow(host, row, targets, field, what); return; }
    var editor = VFXGradientEditor.create({
      curve: shared.value,
      onBegin: function (action) { editBegin(action + what); },
      onLive: function (curve) { writeCurve(targets, field, curve); previewSoon(); },
      onChange: function (curve) { writeCurve(targets, field, curve); onPresetChanged(); editCommit(); },
      onCursor: broadcastCursor
    });
    liveEditors.push(editor);
    row.appendChild(editor.el);

    var tools = document.createElement('div');
    tools.className = 'ol-tools';
    var reset = document.createElement('button');
    reset.type = 'button'; reset.textContent = 'Reset';
    reset.title = '回到白 → 白（相乘語意下等於沒有變化）';
    reset.onclick = function () {
      edit('重設 ' + what, function () { editor.reset(); });
      renderInspector();
    };
    var off = document.createElement('button');
    off.type = 'button';
    off.textContent = shared.value === undefined ? '啟用' : '停用';
    off.title = '停用＝移除這條曲線，整段生命維持圖層的 tint';
    off.onclick = function () {
      var on = targets[0][field] === undefined;
      edit((on ? '啟用 ' : '停用 ') + what, function () {
        if (on) editor.reset(); else editor.clear();
      });
      renderInspector();
    };
    tools.appendChild(reset); tools.appendChild(off);
    row.appendChild(tools);
    host.appendChild(row);
  }

  /* undefined 代表「沒有這條曲線」，要 delete 而不是寫 undefined 進去——
     JSON.stringify 會把 undefined 的鍵丟掉，但 canonical 比對與未知欄位
     檢查是看實際的鍵，留著會讓兩邊看到的東西不一樣。 */
  function writeCurve(targets, field, curve) {
    MX.writeAll(targets, field, curve);
  }

  /* 選取的圖層這條曲線各不相同。不挑一層畫出來——拖一下就會把那一層的形狀蓋到
     其他每一層上，而畫面完全不會預告這件事（例如環繞軌跡：每一顆的相位不同，
     統一之後會疊在同一個位置）。改成明講「各層不同」；要統一就按按鈕，
     以哪一層為準直接寫在按鈕上。 */
  function mixedCurveRow(host, row, targets, field, what) {
    var ref = referenceLayer(targets);
    var box = document.createElement('div');
    box.className = 'ol-mixed';
    box.textContent = '各層的「' + what + '」曲線不同，這裡不顯示任何一層的曲線。';
    row.appendChild(box);

    var tools = document.createElement('div');
    tools.className = 'ol-tools';
    if (ref[field] !== undefined) {
      var unify = document.createElement('button');
      unify.type = 'button';
      unify.textContent = '以「' + ref.id + '」為準';
      unify.title = '把「' + ref.id + '」的這條曲線複製到全部 ' + targets.length + ' 層';
      unify.onclick = function () {
        edit('統一 ' + what, function () { writeCurve(targets, field, ref[field]); onPresetChanged(); });
        renderInspector();
      };
      tools.appendChild(unify);
    }
    var off = document.createElement('button');
    off.type = 'button';
    off.textContent = '全部停用';
    off.title = '移除全部 ' + targets.length + ' 層的這條曲線，整段生命維持基礎值';
    off.onclick = function () {
      edit('停用 ' + what, function () { writeCurve(targets, field, undefined); onPresetChanged(); });
      renderInspector();
    };
    tools.appendChild(off);
    row.appendChild(tools);
    host.appendChild(row);
  }

  function renderOverLife(host, targets) {
    var title = document.createElement('div');
    title.className = 'group-title ol-title';
    title.textContent = 'OVER-LIFE 曲線';

    /* 分區／對照切換。分區省空間，對照則把所有曲線攤在同一條時間軸上，
       滑鼠移到任何一張圖，每張圖都會畫上同一條時間線並顯示自己在那一刻的值。
       調整互相牽動的屬性（縮到最大時透明度剩多少）非得這樣看不可。 */
    var modes = document.createElement('div');
    modes.className = 'ol-modes';
    [['sections', '分區'], ['compare', '對照']].forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = m[1];
      b.className = overLifeMode === m[0] ? 'on' : '';
      b.onclick = function () { overLifeMode = m[0]; renderInspector(); };
      modes.appendChild(b);
    });
    title.appendChild(modes);
    host.appendChild(title);

    if (overLifeMode === 'compare') {
      var tip = document.createElement('div');
      tip.className = 'ol-hint';
      tip.textContent = '滑鼠移到任一張圖上，所有曲線會顯示同一個時間點的數值。';
      host.appendChild(tip);
    }

    /* 分軸（sprite／procedural／empty）與粒子的曲線欄位不同。混著選的時候那幾段只顯示說明——
       畫出一張只有一部分圖層吃得到的圖，拖了之後另一部分沒反應。 */
    var perAxis = MX.allOrNone(targets, supportsPerAxisScale);
    var mixedTypesHint = '選取的圖層混有 particle 與 sprite／procedural／empty，這一段兩邊的欄位不同。' +
      '要調這一段請分開選取。';

    /* 標題原本是 Opacity。改成 Alpha（2026-09-17 使用者要求）：與上方的 alpha 欄位同一個名字，
       一眼看得出這條曲線乘的就是它（透明度） */
    curveSection(host, 'alpha', 'Alpha', function (body) {
      curveBlock(body, targets, 'alphaOverLife', CURVE_POLICY.alpha, null, { name: '透明度' });
      hintLine(body, 'alphaOverLife 是乘在 alpha 上的係數，可以大於 1（過曝）。');
    });

    curveSection(host, 'color', 'Color', function (body) {
      gradientBlock(body, targets, 'tintOverLife');
      hintLine(body, 'tintOverLife 是**乘在 tint 上**的顏色，不是取代它——' +
        '所以 tint 留白（#ffffff）時，色帶上是什麼顏色就播什麼顏色。');
      hintLine(body, '點色帶空白處新增色標（顏色取當下漸層值，新增當下畫面不變），' +
        '拖色標改時間，選中後用色票改顏色，Delete 刪除。');
    });

    curveSection(host, 'scale', 'Scale', function (body) {
      if (perAxis === null) { hintLine(body, mixedTypesHint); return; }
      if (!perAxis) {
        curveBlock(body, targets, 'scaleOverLife', CURVE_POLICY.scale, 'XY');
        hintLine(body, 'particle 的兩軸永遠等比，沒有分軸縮放。');
        return;
      }
      var linked = MX.commonValue(targets, function (l) {
        return !(l.scaleXOverLife !== undefined || l.scaleYOverLife !== undefined);
      });
      var link = document.createElement('label');
      link.className = 'ol-link';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !linked.mixed && linked.value;
      cb.indeterminate = linked.mixed;
      cb.onchange = function () {
        edit(cb.checked ? '連動 X/Y' : '解除 X/Y 連動',
          function () { setScaleLink(targets, cb.checked); });
        renderInspector();
      };
      link.appendChild(cb);
      link.appendChild(document.createTextNode(' Link X/Y'));
      body.appendChild(link);

      if (linked.mixed) {
        hintLine(body, '選取的圖層有的 X/Y 連動、有的分開。先用上面的 Link X/Y 統一，再一起調曲線。');
      } else if (linked.value) {
        curveBlock(body, targets, 'scaleOverLife', CURVE_POLICY.scale, 'XY');
      } else {
        curveBlock(body, targets, 'scaleXOverLife', CURVE_POLICY.scale, 'X');
        curveBlock(body, targets, 'scaleYOverLife', CURVE_POLICY.scale, 'Y');
      }
    });

    curveSection(host, 'rotation', 'Rotation', function (body) {
      curveBlock(body, targets, 'rotationOverLife', CURVE_POLICY.rotation, 'Z', { height: 170 });
      if (perAxis === null) {
        hintLine(body, 'X／Y 翻轉只有 sprite、procedural 與 empty 有；選取中混有 particle，要調 X／Y 請分開選取。');
        return;
      }
      if (!perAxis) {
        hintLine(body, '以度顯示、以弧度儲存。particle 只有平面旋轉。');
        return;
      }
      curveBlock(body, targets, 'rotationXOverLife', CURVE_POLICY.rotation, 'X', { height: 170 });
      curveBlock(body, targets, 'rotationYOverLife', CURVE_POLICY.rotation, 'Y', { height: 170 });
      hintLine(body,
        'Z＝平面旋轉。X／Y 是正交投影的翻轉：繞 X 轉會壓縮高度、繞 Y 轉會壓縮寬度，' +
        '180° 時變成鏡像（翻到背面）。沒有透視，背面看到的仍是同一張圖。');
      hintLine(body, '以度顯示、以弧度儲存。');
    });

    curveSection(host, 'offset', 'Offset', function (body) {
      if (perAxis === null) { hintLine(body, mixedTypesHint); return; }
      if (!perAxis) {
        hintLine(body,
          '位移曲線只有 sprite、procedural 與 empty 支援。粒子的位置是由 speed／gravity／' +
          'spawn 那一整套運動算出來的，沒有一個「圖層位置」可以加——要讓粒子飄或偏，' +
          '用的是那幾個欄位。');
        return;
      }
      curveBlock(body, targets, 'offsetXOverLife', CURVE_POLICY.offset, 'X', { height: 170 });
      curveBlock(body, targets, 'offsetYOverLife', CURVE_POLICY.offset, 'Y', { height: 170 });
      hintLine(body,
        '**加**在 position 上的位移，不是乘（position 常常是 0，乘多少都還是 0）。' +
        '單位 px，與遊戲同比例：60px ＝ 6 米 ＝ 預覽格線的一大格。');
      hintLine(body,
        '位移落在特效自己的座標系，會跟著特效一起旋轉縮放——' +
        '所以「往上飄」在轉了 90 度的特效上仍然是相對它自己的上方。');
    });
  }

  function hintLine(host, text) {
    var d = document.createElement('div');
    d.className = 'ol-hint';
    d.textContent = text;
    host.appendChild(d);
  }

  /* Link 開↔關的資料轉換。關鍵是不能在切換的當下改變畫面：
     解除連動時把目前的等比曲線複製到兩軸，接回去時把 X 的曲線收回等比欄位。
     使用者只是想「分開調」，不是想讓特效在按下核取方塊的瞬間變樣。 */
  function setScaleLink(layers, linked) {
    if (linked) {
      /* 收回等比：以 X 為準（畫面上 X 在上面，是使用者主要在調的那一條）。
         Y 與 X 不同時會遺失 Y——這是解除連動的必然代價，所以先問。
         多選時只問一次：任何一層會遺失 Y 就問，不是每一層跳一次對話框。 */
      var lossy = layers.filter(function (layer) {
        return JSON.stringify(layer.scaleXOverLife) !== JSON.stringify(layer.scaleYOverLife);
      });
      var question = layers.length === 1
        ? 'X 與 Y 目前不同，接回等比會以 X 為準並捨棄 Y。要繼續嗎？'
        : '其中 ' + lossy.length + ' 層的 X 與 Y 不同，接回等比會以 X 為準並捨棄 Y。要繼續嗎？';
      if (lossy.length && !window.confirm(question)) return;
      layers.forEach(function (layer) {
        if (layer.scaleXOverLife !== undefined) layer.scaleOverLife = layer.scaleXOverLife;
        delete layer.scaleXOverLife;
        delete layer.scaleYOverLife;
      });
    } else {
      layers.forEach(function (layer) {
        /* 已經分開的不要蓋掉：多選時 Link 狀態可能混著，這裡是最後一道防線 */
        if (layer.scaleXOverLife !== undefined || layer.scaleYOverLife !== undefined) return;
        var base = layer.scaleOverLife;
        if (base !== undefined) {
          layer.scaleXOverLife = JSON.parse(JSON.stringify(base));
          layer.scaleYOverLife = JSON.parse(JSON.stringify(base));
        } else {
          /* 沒有等比曲線可複製時，兩軸都給常數 1：那與「沒有曲線」等價，
             畫面同樣不變，但使用者拿到兩個可以直接拖的點。 */
          layer.scaleXOverLife = 1;
          layer.scaleYOverLife = 1;
        }
      });
    }
    onPresetChanged();
  }

  /* ---------------- 預覽（使用 VFX Core） ---------------- */

  function onPresetChanged() {
    /* 不管合不合法都要更新 dirty：改壞了也是「改過了」，
       這時候把它顯示成乾淨反而最危險。 */
    refreshDirty();
    markGizmoDirty();                          // Inspector 改數值 → 框跟著移動
    /* 還沒有任何圖層（新視窗的空白特效，或圖層刪光了）：沒有東西可以播，
       與其拿 Core 的「layers 不得為空」嚇人，不如說下一步能做什麼。存檔仍然會擋。 */
    if (state.preset && !state.preset.layers.length) {
      setValidation('hint', '還沒有任何圖層：用上方的搜尋框或「瀏覽特效」載入一份特效，' +
        '或按左邊的「＋ 新增」開始做。（沒有圖層的特效存不了檔）');
      if (state.runtime && !state.staleDoc) { state.runtime.stopAll(); state.handle = null; }
      return;
    }
    var result = VFXCore.validatePreset(state.preset);
    if (!result.ok) {
      setValidation('hint err', '✗ ' + result.errors.length + ' 個問題：\n- ' + result.errors.join('\n- '));
      return;                                    // 不合法就不重建預覽，也不 silent fallback
    }
    setValidation('hint ok', '✓ Preset 合法（schemaVersion ' + state.preset.schemaVersion + '）');
    rebuildPreview();
  }

  /* 右側「驗證」面板。每個視窗各記一份，切換焦點時換成那個視窗自己的（見 renderPanels）。 */
  function setValidation(cls, text) {
    state.validation = { cls: cls, text: text };
    if (state.inBackground) return;
    var box = $('validation');
    if (!box) return;
    box.className = cls;
    box.textContent = text;
  }

  /* 改任何參數都要重建預覽（註冊過的 preset 是凍結深拷貝，不能就地改）。
     重建會重播，所以先把播放頭記下來再帶回去——否則調一條 50% 位置的曲線時，
     畫面永遠停在第 0 秒，等於看不到自己改的那一段。 */
  function rebuildPreview() {
    /* staleDoc：這個視窗已經換成別份特效，回呼晚到的那一份不能把自己註冊進預覽 */
    if (!state.runtime || state.staleDoc) return;
    var resumeAt = state.handle === null || state.handle === undefined
      ? 0 : (state.runtime.timeOf(state.handle) || 0);
    state.runtime.stopAll();
    try {
      state.runtime.registerPreset(state.preset);
    } catch (e) {
      setValidation('hint err', String(e.message || e));
      return;
    }
    playPreview(resumeAt);
    /* 暫停中也要畫得出來：play() 只建立狀態，畫面上的物件要等第一次 update 才生出來，
       而 ticker 暫停時不呼叫 update——少了這一步，暫停中改任何參數，預覽就整個消失
       （2026-09-16 使用者回報）。update(0) 不前進時間，只把播放頭這一格畫出來；
       播放中不必補，下一幀的 update 自然會畫。 */
    if (!state.playing) state.runtime.update(0);
  }

  var PREVIEW_SEED = 12345;                      // 固定 seed：編輯時每次重播畫面一致

  function playPreview(startTime, nextVariation) {
    if(nextVariation && state.preset.deformation)state.deformationSeed=(state.deformationSeed||PREVIEW_SEED)+977;
    state.handle = state.runtime.play(state.preset.id, {
      position: { x: 0, y: 0 },
      seed: state.deformationSeed || PREVIEW_SEED,
      startTime: startTime || 0
    });
  }

  /* 預覽循環：這一輪播完就從頭再來，調參數時不必一直去按 ⟲。

     判斷用 timeOf 回傳 null——那代表 Core 已經把這個 effect 收掉了，而 Core
     要等拖尾粒子也散完才收（見 vfx-core 的 particlesLeft），所以重播不會把
     尾巴切斷。用 preset.duration 自己算時間就會切到。

     這是**檢視偏好**，與 preset.loop 沒有關係：loop 為 true 的特效根本不會結束，
     timeOf 永遠不是 null，這條路自然不會被觸發，兩邊不會打架。 */
  function tickPreviewLoop() {
    if (!state.previewLoop || !state.runtime) return;
    if (state.handle === null || state.handle === undefined) return;
    if (state.runtime.timeOf(state.handle) !== null) return;
    playPreview(0, true);
  }

  var PREVIEW_LOOP_KEY = 'vfx-editor.previewLoop';
  /* 新開的視窗要不要預覽循環：沿用上一次在工具列勾的值 */
  var previewLoopDefault = true;

  /* 預覽循環是每個視窗各自的：勾選框作用在多選的全部視窗（沒有多選就是焦點視窗）。 */
  function setPreviewLoop(on) {
    selectedPanes.forEach(function (p) { p.previewLoop = !!on; });
    previewLoopDefault = !!on;
    syncPreviewLoop();
    writePref('previewLoop', on ? '1' : '0');
  }

  function loadPreviewLoopPreference() {
    var saved = readPref('previewLoop', PREVIEW_LOOP_KEY);
    /* 沒存過就是開著：一次性的特效播完就消失，預設關閉的話新開一份 preset
       只會看到一瞬間的畫面，然後對著空白背景調參數。 */
    previewLoopDefault = saved === undefined ? true : saved === '1';
  }

  /* 多選的視窗循環設定不一致時打一個「－」（indeterminate），點下去全部設成同一個值。 */
  function syncPreviewLoop() {
    var chk = $('chk-preview-loop');
    if (!chk) return;
    var s = VFXPaneModel.playbackState(selectedPanes);
    chk.checked = s.loop;
    chk.indeterminate = s.loopMixed;
  }

  /* 拖曳曲線時每次 mousemove 都要更新預覽，但一幀之內做兩次沒有意義
     （畫面只畫一次），所以用 rAF 合併。註冊素材走的是 resolver 的雜湊查表，
     貼圖由後端依 URL 快取，重建不會重新載圖。旗標與回呼都跟著發出的那個視窗。 */
  function previewSoon() {
    if (state.previewPending) return;
    state.previewPending = true;
    requestAnimationFrame(bindPane(function () {
      state.previewPending = false;
      refreshDirty();
      var result = VFXCore.validatePreset(state.preset);
      if (!result.ok) return;                    // 中途不合法就先不重建，放開滑鼠時會報錯
      rebuildPreview();
    }));
  }

  /* ⟲ Restart：從頭播，多選的視窗一起（並排比對兩份特效的節奏時，同一刻從 0 開始）。
     rebuildPreview 會接著目前的播放頭重建——調參數時畫面才不會跳回開頭；Restart 要的剛好相反，
     所以先把播放頭拿掉。2026-09-02 加入續播之後這顆一直只是原地重建，
     做多視窗同步重播時才發現（2026-09-17）。 */
  function restart() {
    selectedPanes.forEach(function (p) {
      withPane(p, function () {
        if (!state.runtime) return;
        state.runtime.stopAll();
        state.handle = null;
        onPresetChanged();
      });
    });
  }

  /* ---------------- 播放／暫停 ----------------

     一顆按鈕的兩個狀態，不是兩個動作。兩顆並排時，「現在是在播還是停著」
     只能靠猜哪一顆被按下去；一顆按鈕的標籤直接就是答案（顯示的是**按下去
     會發生什麼**：正在播就顯示「暫停」）。

     作用在多選的全部視窗（沒有多選就是焦點視窗）。多選裡有的在播、有的停著時，
     只要有一個在播就顯示「暫停」：按一下先讓大家一起停，再按一下一起播。 */
  function setPlaying(on) {
    selectedPanes.forEach(function (p) { p.playing = !!on; });
    syncPlayPause();
    renderPaneHeads();
  }

  function syncPlayPause() {
    var btn = $('btn-playpause');
    if (!btn) return;
    var playing = VFXPaneModel.playbackState(selectedPanes).playing;
    btn.textContent = playing ? '⏸ 暫停' : '▶ 播放';
    btn.classList.toggle('paused', !playing);
    btn.title = (playing ? '暫停預覽' : '繼續播放預覽') +
      (selectedPanes.length > 1 ? '（選取的 ' + selectedPanes.length + ' 個視窗一起）' : '');
  }

  /* ---------------- 關閉編輯器 ----------------

     連伺服器一起停。這顆按鈕存在的理由不是省一次點擊：伺服器的 console 視窗
     會不見（關掉它時 node 不一定跟著死），行程卻還活著佔著埠，而啟動器掃到
     既有伺服器就會沿用——於是使用者永遠等不到那個「要他關掉」的視窗，
     只能自己去 netstat 找 PID。有一條從頁面就停得掉的路，這個死結才拆得開。 */

  var quitting = false;
  /* 自己主動離開這一頁（切換 preset、關閉編輯器）時要關掉 beforeunload：
     那兩條路自己已經問過一次，再讓瀏覽器跳一次就是連問兩遍。 */
  var leavingOnPurpose = false;

  function quitEditor() {
    if (quitting) return;
    var dirty = dirtyPanes();
    var msg = dirty.length
      ? (panes.length > 1 ? dirty.map(paneLabel).join('、') + ' ' : '') +
        '目前的修改尚未存檔，關閉之後就沒了。仍要關閉編輯器與伺服器嗎？'
      : '關閉編輯器並停止伺服器？其他開著的編輯器分頁也會失去連線。';
    if (!window.confirm(msg)) return;
    quitting = true;
    leavingOnPurpose = true;
    setSaveStatus('關閉中…', '');
    /* Content-Type 是防護的一部分，不是格式需求：跨來源要送 application/json
       會被迫先 preflight，而伺服器不回任何 CORS 標頭。見 checkWriteOrigin。 */
    fetch('/__shutdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (r) {
      return r.json().catch(function () { return { ok: r.ok }; });
    }).then(function (data) {
      if (data && data.ok === false) {
        quitting = false;
        setSaveStatus('關閉失敗', 'err');
        showSaveError('無法關閉伺服器', [data.error || '伺服器拒絕了這個請求']);
        return;
      }
      finishQuit();
    }).catch(function () {
      /* 連線斷掉＝伺服器真的收攤了（回應與行程結束是同一瞬間的事）。
         這條路不算失敗。 */
      finishQuit();
    });
  }

  function finishQuit() {
    /* 畫面停下來：蓋一張說明之後還讓 Pixi 繼續跑，只是白燒 CPU。 */
    panes.forEach(function (p) {
      p.playing = false;
      if (p.app && p.app.ticker) p.app.ticker.stop();
    });

    /* window.close() 只關得掉「由腳本開啟的」視窗，而編輯器是啟動器用
       start "" <url> 開的一般分頁，所以這一行多半會被瀏覽器擋下。擋下來也
       沒關係——真正要讓人知道的是「伺服器停了、這一頁可以關了」，
       所以蓋一張全螢幕說明，而不是留一個看起來還正常、實際上每個請求都會
       失敗的編輯器讓人繼續操作。 */
    var veil = document.createElement('div');
    veil.id = 'quit-veil';
    var box = document.createElement('div');
    box.className = 'quit-box';
    [['h', '編輯器已關閉'],
     ['p', '伺服器已經停止，這個分頁可以直接關掉。'],
     ['p', '要重新開始：執行 啟動VFX編輯器.bat']].forEach(function (row) {
      var el = document.createElement(row[0] === 'h' ? 'strong' : 'div');
      el.textContent = row[1];
      box.appendChild(el);
    });
    veil.appendChild(box);
    document.body.appendChild(veil);
    window.close();
  }

  /* 預覽背景一律畫在 Pixi 內部，畫布本身保持不透明。
     為什麼不能用「透明畫布 ＋ CSS 背景」：加法混合（add）在透明畫布上會把
     alpha 也一起相加，而黑底素材的 RGB 是 0、alpha 是 1，結果就是
     「顏色沒加上去、透明度卻加滿」→ 合成到頁面上變成一塊不透明黑方塊。
     畫布不透明時目標 alpha 已經是 1，就不會有這個假象。 */
  /* 背景色是全部視窗共用的檢視偏好：同一片背景前並排比對才公平。 */
  function setBackground(value) {
    panes.forEach(function (p) {
      withPane(p, function () {
        if (!state.app) return;
        var checker = value === 'checker';
        state.checker.visible = checker;
        state.bgSolid.visible = !checker;
        if (!checker) state.bgSolid.tint = parseInt(value.slice(1), 16);
      });
    });
  }

  /* ---------------- 背景色列 ----------------
     特效在遊戲裡不會永遠站在同一種背景前。同一顆雷球放在夜空、洞窟土牆、
     雪地上，可讀性差很多——尤其這套素材大量使用加法混合，在淺色背景上
     幾乎會整個消失。所以背景切換必須就在預覽區旁邊，一下就能點過一輪。 */

  var BG_PRESETS = [
    { value: '#101014', label: '預設深色' },
    { value: '#000000', label: '純黑' },
    { value: '#16233a', label: '夜空藍' },
    { value: '#2a211b', label: '洞窟土色' },
    { value: '#1b2a1e', label: '森林綠' },
    { value: '#5a5a62', label: '中灰' },
    { value: '#9aa3ad', label: '雪地灰藍' },
    { value: '#e8e8e8', label: '淺色' },
    { value: 'checker', label: '棋盤格（看透明度）' }
  ];

  var BG_STORAGE_KEY = 'vfx-editor.background';

  /* 棋盤格沒有單一顏色可以填，色票用一張小的 CSS 漸層拼出同樣的圖案 */
  var CHECKER_SWATCH_CSS =
    'repeating-conic-gradient(#2a2a32 0% 25%, #1b1b21 0% 50%) 50% / 10px 10px';

  function applyBackground(value, opts) {
    state.background = value;
    setBackground(value);
    var picker = $('bg-picker');
    if (picker && value !== 'checker') picker.value = value;
    var cur = $('bg-current');
    if (cur) cur.textContent = value === 'checker' ? '棋盤格' : value;
    /* 選中標記走 DOM class，不重建整列——重建會讓 <input type="color">
       在使用者還開著取色器時被抽掉。 */
    var host = $('bg-swatches');
    if (host) {
      [].forEach.call(host.children, function (b) {
        b.classList.toggle('sel', b.dataset.value === value);
      });
    }
    if (!opts || opts.remember !== false) {
      /* 背景是每個人自己的檢視偏好，不屬於 Preset：寫進 preset 只會讓
         「換個背景看看」變成一筆 git diff。存 cookie 的理由見 readPrefs。 */
      writePref('background', value);
    }
  }

  function buildBackgroundBar() {
    var host = $('bg-swatches');
    if (!host) return;
    host.textContent = '';
    BG_PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'bg-swatch';
      b.type = 'button';
      b.dataset.value = p.value;
      b.title = p.label;
      if (p.value === 'checker') b.style.background = CHECKER_SWATCH_CSS;
      else b.style.background = p.value;
      b.onclick = function () { applyBackground(p.value); };
      host.appendChild(b);
    });

    var picker = $('bg-picker');
    if (picker) {
      /* input 而不是 change：拖曳取色器時預覽就跟著變，才看得出臨界點 */
      picker.oninput = function () { applyBackground(picker.value); };
    }

    var saved = readPref('background', BG_STORAGE_KEY);
    var valid = saved === 'checker' || (typeof saved === 'string' && /^#[0-9a-f]{6}$/i.test(saved));
    applyBackground(valid ? saved : BG_PRESETS[0].value, { remember: false });
  }

  /* 棋盤格背景：用小張貼圖平鋪，同樣走 Pixi，維持畫布不透明 */
  function makeCheckerTexture() {
    var size = 24;
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#1b1b21'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#2a2a32';
    ctx.fillRect(0, 0, size / 2, size / 2);
    ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
    return PIXI.Texture.from(cv);
  }

  /* ---------------- 存讀檔 ---------------- */

  /* 目前編輯內容的 canonical 文字。dirty 判斷與存檔送出的都是這一份，
     兩邊用同一個函式，才不會出現「顯示已存檔但送出的是別的東西」。 */
  function currentPresetText() {
    try {
      return VFXCore.serialisePreset(state.preset);
    } catch (e) {
      return null;                            // 序列化不出來就當作 dirty
    }
  }

  function isDirty() {
    /* 新視窗的空白特效在加入第一層之前不算修改：什麼都沒做就關掉它，不必問 */
    if (state.isNew && !state.preset.layers.length) return false;
    if (layoutDirty()) return true;
    if (state.savedText === null) return true;
    return currentPresetText() !== state.savedText;
  }

  /* 有未存檔修改的視窗（關閉編輯器、重新整理時要問） */
  function dirtyPanes() {
    return panes.filter(function (p) { return withPane(p, isDirty); });
  }

  function refreshDirty() {
    var dirty = isDirty();
    /* 一旦又動過，上一次的「已存檔」就不再成立，讓它繼續掛在旁邊會變成
       「已存檔」與「未存檔」同時亮著。失敗訊息則留著——那是還沒解決的問題。 */
    var st = state.saveStatus;
    if (dirty && st && st.cls === 'ok') setSaveStatus('', '');
    state.dirtyFlag = dirty;                  // 視窗標籤上的 ●
    renderPaneHeads();
    if (state.inBackground) return;
    var el = $('dirty-flag');
    if (!el) return;
    el.textContent = dirty ? '● 未存檔' : '';
    el.className = dirty ? 'dirty on' : 'dirty';
  }

  /* title：滑鼠移上去看的完整說明。每一則都重設——換成下一則時，上一則的說明不能還掛著。
     每個視窗各記一份，切換焦點時工具列換成那個視窗自己的（見 renderPanels）。 */
  function setSaveStatus(text, cls, title) {
    state.saveStatus = { text: text, cls: cls || '', title: title || '' };
    if (state.inBackground) return;
    var el = $('save-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'save-status' + (cls ? ' ' + cls : '');
    el.title = title || '';
  }

  /* 存檔（回寫與下載）共用的擋門條件。
     驗證必須在送出前做：存出去的檔案下次載入會被 Core 拒絕的話，Save/Load 就不一致了。
     伺服器端會再驗一次——這裡擋是為了讓人當場看到原因，不是為了取代伺服器的驗證。 */
  function presetSaveProblems() {
    var check = VFXCore.validatePreset(state.preset);
    if (!check.ok) return { title: 'preset 不合法', list: check.errors };
    var missing = state.preset.layers
      .filter(function (l) { return l.assetId && !state.resolver.has(l.assetId); })
      .map(function (l) { return l.id + ' → ' + l.assetId; });
    if (missing.length) return { title: '引用了不存在的 assetId', list: missing };
    /* 檔名規則用的是伺服器同一份 policy，這樣「Editor 說可以存、伺服器回 400」
       這種契約分歧就不會發生。 */
    var idProblem = VFXPresetIdPolicy.presetIdProblem(state.preset.id);
    if (idProblem) return { title: '無法作為檔名', list: [idProblem] };
    return null;
  }

  /* 存檔目標與載入來源必須是同一個 id，否則就是在改別人的檔案。 */
  function saveTargetProblem() {
    if (state.sourcePresetId === null) return null;      // 匯入的內容以自己的 id 為準
    if (state.preset.id === state.sourcePresetId) return null;
    return 'preset.id（' + state.preset.id + '）與載入來源（' + state.sourcePresetId +
      '）不一致。存下去會覆寫 ' + state.preset.id + '.json，而不是你打開的那一份。' +
      '請先修正檔案內的 preset.id。';
  }

  /* 存檔失敗的原因寫兩個地方，理由不同：
       #validation   右側「驗證」面板，是這一份 preset 目前的驗證結果，會留著。
       #save-error   工具列下方的橫幅，是「你剛剛按的那一下失敗了」的當場回饋。
     只寫前者的話，Inspector 一長就被捲到畫面外，使用者只看得到「存檔失敗」
     四個字而看不到任何原因——這正是這個函式被拆成兩處的原因。 */
  function showSaveError(title, list) {
    var text = title + (list && list.length ? '：\n- ' + list.join('\n- ') : '');
    setValidation('hint err', text);          // 右側驗證面板（$('validation')）留下紀錄
    var banner = $('save-error');
    var body = $('save-error-text');
    if (banner && body) {
      /* 橫幅是「剛才那一下失敗了」的當場回饋，背景視窗的也要講（存檔回應晚到時焦點
         可能已經換走）——標出是哪個視窗，免得看起來像是眼前這一份出錯 */
      body.textContent = (state.inBackground && panes.length > 1 ? paneLabel(ctx) + '：' : '') + text;
      banner.hidden = false;
      banner.scrollTop = 0;                   // 上一則捲到一半時，新的一則要從頭看
    }
  }

  /* 橫幅只反映「最近一次存檔」。下一次按下去之前先收掉，
     不然成功之後還掛著上一次的紅字，會讓人以為又失敗了。 */
  function clearSaveError() {
    var banner = $('save-error');
    if (banner) banner.hidden = true;
  }

  /* Save：把目前的 Preset 回寫到 repo 的 vfx/presets/<preset.id>.json。
     目的地由 preset.id 決定而不是由「開場的 ?preset= 」決定，
     之後要做 Save As 時只要能改 preset.id 就成立，不必動這條路徑。 */
  /* 回傳一個 Promise，resolve true 代表真的寫進去了。呼叫端多半不理它
     （按鈕與 Ctrl+S 都只要看畫面上的狀態），但「另存新檔」必須知道成敗——
     失敗時它得把已經改掉的 preset.id 捲回去，否則使用者會停在一個
     指向不存在檔案的編輯器上，下一次按存檔就真的寫出那個檔。 */
  function savePreset() {
    if (state.saving) return Promise.resolve(false);   // 連按兩下不該送出兩次 PUT
    /* 新視窗的空白特效還沒有名字（new-effect 是暫時的）：第一次存檔要問名字，
       與另存新檔走同一條路——撞名檢查、根群組改名都在那裡 */
    if (state.isNew) { saveAsPreset(); return Promise.resolve(false); }
    clearSaveError();                         // 這一次的結果從乾淨的畫面開始講
    var targetProblem = saveTargetProblem();
    if (targetProblem) {
      showSaveError('無法存檔', [targetProblem]);
      setSaveStatus('存檔失敗', 'err');
      return Promise.resolve(false);
    }
    var problems = presetSaveProblems();
    if (problems) {
      showSaveError('無法存檔，' + problems.title, problems.list);
      setSaveStatus('存檔失敗', 'err');
      return Promise.resolve(false);
    }
    var text = currentPresetText();
    if (text === null) {
      showSaveError('無法存檔，序列化失敗', []);
      setSaveStatus('存檔失敗', 'err');
      return Promise.resolve(false);
    }

    state.saving = true;
    syncSaveButton();
    setSaveStatus('存檔中…', '');
    var ok = false;
    return fetch(presetUrl(state.preset.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: text
    }).then(bindPane(function (r) {
      return r.json().catch(function () {
        throw new Error('伺服器回應不是 JSON（HTTP ' + r.status + '）');
      }).then(bindPane(function (body) {
        if (!r.ok || !body.ok) {
          /* 一行一個原因，項目符號留給 showSaveError 加。這裡先加一次、
             那邊再加一次的話，problems 會變成「- - 某某」。 */
          var lines = [body.error || ('HTTP ' + r.status)]
            .concat(body.problems || []);
          var err = new Error(lines.join('\n'));
          /* 伺服器說了檔案有沒有落地，就照它說的講。這個旗標只有素材同步失敗
             那一條會是 true；連線層的錯誤（伺服器沒回應）拿不到 body，
             留在 undefined，下面當成「未寫入」——那也是事實。 */
          err.written = body.written === true;
          throw err;
        }
        return body;
      }));
    })).then(bindPane(function (body) {
      /* 成功：只更新「已存檔基準」。不重新載入、不動 selection、不動 preset.id。 */
      ok = true;
      state.savedText = text;
      setSaveStatus('已存檔 · ' + body.bytes + ' bytes', 'ok');
      /* 分組另存一個檔。它失敗不影響 Preset 已經存好這件事——
         layout 是可有可無的附加資料，見 layout-schema.js 的自癒設計。 */
      /* 留下這個 Promise：「另存新檔」成功後會用新名字重新開啟，得等分組真的寫完，
         否則重開時讀到的是還沒寫進去的分組檔，新特效就沒有群組。 */
      state.layoutSave = saveLayout().then(function () { return true; }, bindPane(function (e) {
        setSaveStatus('Preset 已存檔，但分組沒存成功', 'err');
        showSaveError('分組儲存失敗（Preset 本身已存好）', [String(e && e.message || e)]);
        return false;
      }));
      setValidation('hint ok', '✓ 已寫入 vfx/presets/' + body.presetId + '.json');
      refreshDirty();
    })).catch(bindPane(function (e) {
      /* 失敗：Editor 狀態原封不動，dirty 維持 true，錯誤照伺服器講的原因顯示。
         標題不能寫死。以前一律說「repo 檔案未變動」，但素材同步失敗那條路
         檔案其實已經寫進去了，兩句話直接互相打臉，看到的人會以為要重做一次。
         dirty 兩種情況都維持 true：再按一次存檔＝重寫同樣的 bytes 並重試同步，
         這正是使用者該做的事。 */
      setSaveStatus('存檔失敗', 'err');
      showSaveError(e && e.written
        ? '存檔失敗（preset 已寫入 repo，但後續步驟沒完成，請修正後再按一次儲存）'
        : '存檔失敗（repo 檔案未變動）',
        String(e && e.message || e).split('\n'));
      refreshDirty();
    })).then(bindPane(function () {
      state.saving = false;
      syncSaveButton();
      return ok;
    }));
  }

  /* 存檔中停用「儲存到 repo」。按鈕只有一顆，顯示的是焦點視窗的狀態。 */
  function syncSaveButton() {
    if (state.inBackground) return;
    var btn = $('btn-save');
    if (btn) btn.disabled = !!state.saving;
  }

  /* ---------------- 另存新檔 ----------------

     開一份舊的特效改一改，存成新的一份，原本那份一個 byte 都不動。

     實作上就是「把 preset.id 換成新的，再走一次一般存檔」——存檔目的地本來
     就是由 preset.id 決定的（見 savePreset 的說明），所以不需要第二條寫入路徑。
     sourcePresetId 也要跟著換，否則 saveTargetProblem 會認為「id 與載入來源不一致」
     而把存檔擋下來；那道守門正是為了防止手動改 id 之後誤覆蓋別人的檔案，
     這裡是唯一有權明確地把它改掉的地方。

     兩件事必須做對，否則「不會改到舊特效」就只是口號：

       撞名一律拒絕，而且在存之前重新抓一次清單。手上這份是開啟當下抓的，
       另一個分頁、另一位 AI 在這段期間新增的檔案不在裡面——那正是會被
       悄悄蓋掉的情況。清單抓不到就不存，寧可失敗也不要賭。

       失敗要能回捲。preset.id 是在送出前就改掉的，存檔失敗卻不還原的話，
       使用者會停在一個指向不存在檔案的編輯器上，而下一次按存檔就真的
       把那個檔寫出來了——結果是「另存失敗」卻多了一份半成品。 */

  /* 正在問名字時為 true：Windows 視窗可能被別的視窗蓋住，再按一次不能疊出第二個 */
  var saveAsAsking = false;

  /* 另存新檔的名字用 Windows 的存檔視窗問（2026-09-14 使用者要求：跟「載入 Preset」一樣）。
     視窗由本機的編輯器伺服器開（tools/vfx/save-as-dialog.cjs），不用瀏覽器的存檔視窗 API：
     那個 API 在使用者選到既有檔案時，交回檔案之前就先把它清空，而且拿不到路徑。
     伺服器開的視窗只回傳路徑、不碰檔案；選到既有檔案或不對的資料夾，伺服器會說明原因並重開。
     伺服器太舊（還沒有這條路由）、不是 Windows、或視窗開不起來時，退回輸入框。
     回傳 Promise：null＝取消；{ id }；{ problem }（連續選到不能用的名字，伺服器放棄了）。 */
  function askSaveAsName(current) {
    var suggested = current ? current + '-copy' : '';
    setSaveStatus('等待存檔視窗…', '',
      '另存新檔的 Windows 視窗已經開啟；沒看到的話，可能被其他視窗蓋住了，看一下工作列。');
    return fetch(SAVE_AS_DIALOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggested: suggested })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (r.ok && body.canceled) return null;
        if (r.ok && body.id) return { id: body.id };
        if (r.ok && body.problem) return { problem: body.problem };
        if (r.status === 409) return { problem: body.error || '已經開著一個另存新檔的視窗' };
        /* 舊伺服器對不認得的 POST 一律回 405 */
        if (r.status === 405) throw new Error('編輯器伺服器是舊版，重新啟動伺服器之後才有 Windows 存檔視窗');
        throw new Error(body.error || ('HTTP ' + r.status));
      });
    }).then(function (answer) {
      setSaveStatus('', '');
      return answer;
    }, function (e) {
      setSaveStatus('', '');
      var input = window.prompt(
        '（' + String(e && e.message || e) + '，改用輸入框）\n\n' +
        '另存成新的 Preset。\n新的 id（小寫英數與連字號，會寫成 vfx/presets/<id>.json）：',
        suggested);
      return input === null ? null : { id: input };
    });
  }

  function saveAsPreset() {
    if (state.saving || saveAsAsking || !state.preset) return;
    clearSaveError();

    /* 空白特效的暫時名字不拿來當建議名稱的底：new-effect-copy 沒有意義 */
    var current = state.isNew ? '' : (state.sourcePresetId || state.preset.id || '');
    saveAsAsking = true;
    /* 問名字的視窗可能開很久，這段時間焦點可能換到別的視窗：之後的每一步都綁在按下另存的那一份上 */
    askSaveAsName(current).then(bindPane(function (answer) {
      saveAsAsking = false;
      if (!answer) return;                              // 使用者取消
      if (answer.problem) {
        showSaveError('無法另存新檔', [answer.problem]);
        setSaveStatus('另存失敗', 'err');
        return;
      }

      var newId = String(answer.id).trim().toLowerCase();
      var idProblem = VFXPresetIdPolicy.presetIdProblem(newId);
      if (idProblem) {
        showSaveError('無法另存新檔', [idProblem]);
        setSaveStatus('另存失敗', 'err');
        return;
      }
      if (newId === current) {
        showSaveError('無法另存新檔',
          ['「' + newId + '」就是目前開著的這一份。另存新檔要換一個名字，' +
           '要覆寫原本那份請直接按「儲存到 repo」。']);
        setSaveStatus('另存失敗', 'err');
        return;
      }

      setSaveStatus('檢查名稱…', '');
      return fetch(PRESET_LIST_URL).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(bindPane(function (data) {
        var ids = (data && data.presets) || [];
        if (ids.indexOf(newId) >= 0) {
          showSaveError('無法另存新檔',
            ['已經有一份叫「' + newId + '」的 Preset。另存新檔不會覆寫既有檔案，' +
             '請換一個名字。']);
          setSaveStatus('另存失敗', 'err');
          return;
        }
        return commitSaveAs(newId);
      })).catch(bindPane(function (e) {
        /* 清單抓不到就不存：沒有那份清單就無法保證不會蓋到別人的檔案，
           而「不會改到舊特效」正是這個功能存在的理由。 */
        showSaveError('無法另存新檔（拿不到現有的 Preset 清單，無法確認會不會覆寫）',
          [String(e && e.message || e)]);
        setSaveStatus('另存失敗', 'err');
      }));
    }));
  }

  /* 根群組的 id 與名稱要跟著換成新的 preset id（VFX_AGENT_WORKFLOW §9.11）。
     不換的話，另存出來的檔案一落地就違反規則：presetId 是新的、群組卻還叫舊名，
     LAYOUT-4 會紅——而且是編輯器自己造成的。

     只在「剛好一個群組」時動它，那是根群組的形狀；使用者自己分了好幾組時
     不要亂猜要改哪一個。回傳還原用的快照。 */
  function renameRootGroup(newId) {
    var groups = state.layout && state.layout.groups;
    if (!groups || groups.length !== 1) return null;
    var g = groups[0];
    var before = { id: g.id, name: g.name, order: (state.layout.order || []).slice() };
    var oldKey = keyOf('group', g.id);
    g.id = newId;
    /* 名稱只有在「本來就等於舊 id」時才換：那代表它是自動取的。
       使用者手動取過名字就留著，那是他想看到的標籤。 */
    if (before.name === before.id) g.name = newId;
    if (Array.isArray(state.layout.order)) {
      state.layout.order = state.layout.order.map(function (k) {
        return k === oldKey ? keyOf('group', newId) : k;
      });
    }
    return before;
  }

  function commitSaveAs(newId) {
    var prev = {
      id: state.preset.id,
      source: state.sourcePresetId,
      savedText: state.savedText,
      savedLayoutText: state.savedLayoutText,
      layoutPresetId: state.layout ? state.layout.presetId : null,
      isNew: state.isNew
    };
    state.preset.id = newId;
    state.sourcePresetId = newId;
    state.isNew = false;                   // 有名字了；否則 savePreset 又會轉回來問名字
    /* 預覽也要換成新名字：Core 裡註冊的還是舊 id。不先註冊的話，這一輪播完、預覽循環
       用新 id 重播時 Core 會回「未註冊的 preset」，每一幀都丟錯，畫面就停了
       （2026-09-17 使用者回報）。存檔請求還在路上的這段時間也會碰到，所以送出之前就註冊。 */
    try {
      if (state.runtime) state.runtime.registerPreset(state.preset);
    } catch (e) { /* 不合法的話 savePreset 會擋下並說明原因 */ }
    var prevGroup = renameRootGroup(newId);
    /* 基準線先歸零：新檔案還不存在，這份內容當然算未存檔。
       成功的話 savePreset 會把它設成剛寫出去的文字。 */
    state.savedText = null;

    return savePreset().then(bindPane(function (ok) {
      if (!ok) {
        state.preset.id = prev.id;
        state.sourcePresetId = prev.source;
        state.savedText = prev.savedText;
        state.savedLayoutText = prev.savedLayoutText;
        state.isNew = prev.isNew;
        if (state.layout) {
          state.layout.presetId = prev.layoutPresetId;
          if (prevGroup) {
            state.layout.groups[0].id = prevGroup.id;
            state.layout.groups[0].name = prevGroup.name;
            state.layout.order = prevGroup.order;
          }
        }
        renderLayerList();
        onPresetChanged();
        return false;
      }
      /* 選單的篩選字串存在 sessionStorage，重新整理也會留著——換成新名字，
         否則一打開選單還是用舊名字在篩（2026-09-17 使用者要求）。 */
      rememberComboQuery(newId);
      /* 清單多了一份：重抓之後網址與下拉的「目前這份」才對得上新名字 */
      fillPresetPicker();
      return Promise.resolve(state.layoutSave).then(bindPane(function (layoutOk) {
        if (layoutOk === false) {
          /* 分組沒存成功：不重新開啟——重開會把還沒存進去的分組丟掉，錯誤原因也會
             跟著消失。留在原地（預覽已經用新名字註冊過，照常播放），讓使用者看得到
             原因、再按一次存檔。 */
          renderLayerList();
          return true;
        }
        /* 另存完就用新名字重新開啟這個視窗（2026-09-17 使用者要求）：從磁碟上剛寫好的那一份
           建一份全新的編輯狀態，復原紀錄、分組、Core 裡註冊的名字都不會留下舊的。
           以前是整頁重載成 ?preset=<新名字>；多視窗之後重載會把其他視窗一起關掉，所以改成就地重開。
           內容與剛才一模一樣，沿用 runtime，貼圖不必重載。 */
        return openPresetInPane(ctx, newId, {
          keepRuntime: true,
          status: '已另存為 ' + newId + '（原本那份未更動）'
        });
      }));
    }));
  }

  /* 下載一份複本。回寫上線之後這條路仍然留著：要把 Preset 交給別人、
     或想在不碰 repo 的情況下留個備份時還是需要它。 */
  function downloadPreset() {
    var problems = presetSaveProblems();
    if (problems) return showSaveError('無法下載，' + problems.title, problems.list);
    var text = currentPresetText();
    if (text === null) return showSaveError('無法下載，序列化失敗', []);
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.preset.id + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* 檔名優先於檔案內的 id（2026-09-14 使用者回報）。
     在檔案總管把 x-copy.json 改名成 x-blue.json 之後，JSON 裡的 "id" 還是 x-copy。
     以前編輯器照檔案內的 id 顯示與存檔：畫面上仍是 x-copy，一按存檔就另外寫出一份
     x-copy.json，改好名的那份反而沒更新。檔名才是使用者看得到、實際在操作的名字，
     所以以它為準。不能當 id 的檔名（例如「x - 複製.json」）就維持原本的 id 並說明。
     回傳 { fileId, renamedFrom, problem }；renamedFrom 有值代表 preset.id 已經換成檔名。 */
  function adoptFileName(preset, fileName) {
    var fileId = String(fileName || '').replace(/\.json$/i, '');
    var out = { fileId: fileId, renamedFrom: null, problem: null };
    if (!fileId || fileId === preset.id) return out;
    out.problem = VFXPresetIdPolicy.presetIdProblem(fileId);
    if (out.problem) return out;
    out.renamedFrom = preset.id;
    preset.id = fileId;
    return out;
  }

  function announceNaming(naming) {
    if (naming.renamedFrom) {
      /* 不用 ok 樣式：改了名字本來就是未存檔，refreshDirty 會把 ok 當成過期的「已存檔」清掉
         （分組非同步載完就會呼叫它，提示一閃即逝——NAME-6）。 */
      setSaveStatus('已改用檔名：' + state.preset.id, 'note',
        '檔案內的 id 是「' + naming.renamedFrom + '」，檔名是「' + state.preset.id +
        '」。已改用檔名，存檔會寫到 ' + state.preset.id + '.json，舊名字的檔案不會被動到。');
      return;
    }
    if (naming.problem) {
      showSaveError('檔名不能當成特效名稱', [
        '「' + naming.fileId + '」：' + naming.problem,
        '仍沿用檔案內的 id「' + state.preset.id + '」，存檔會寫到 ' + state.preset.id + '.json。' +
        '要換名字，請把檔名改成小寫英數與連字號，或用「另存新檔」。'
      ]);
    }
  }

  function hasGroups(layout) {
    return !!(layout && layout.groups && layout.groups.length);
  }

  /* 名稱、網址、下拉的「目前這份」都跟著畫面上的特效走（2026-09-14 使用者回報：
     載入 Preset 之後下拉還寫著上一份的名字，預覽卻已經是別的特效）。
     網址只在 repo 裡真的有這份檔案時才改：沒有的話，重新整理會開不起來。 */
  function syncPresetIdentity() {
    if (!state.inBackground) {
      var id = state.preset ? state.preset.id : '';
      combo.currentId = id;
      $('preset-search').value = comboDisplayText();
    }
    /* 網址記住每個視窗開的特效（格式見 pane-model.js 的 searchFor）。
       清單還沒到的時候分不出誰在 repo 裡，先不動網址——開場的網址本來就是對的。 */
    if (!combo.rows.length) return;
    var ids = panes.map(function (p) {
      var d = p.doc;
      var pid = d.preset && !d.isNew ? d.preset.id : null;
      var inRepo = !!pid && combo.rows.some(function (r) { return r.id === pid; });
      return inRepo ? pid : null;
    });
    try {
      window.history.replaceState(null, '',
        VFXPaneModel.searchFor(ids, panes.indexOf(focusedPane)) || window.location.pathname);
    } catch (e) { /* 不支援就算了，只影響重新整理後開到哪一份 */ }
  }

  /* 分組跟著載，否則一存檔群組就沒了。先找這個名字的分組檔；找不到而且是改過名的，
     就拿舊名字那一份來改名——檔案總管改名不會連 vfx/layouts 裡的分組檔一起改。
     非同步回來時使用者可能已經開始編輯：只有 preset 還是同一份、分組也還是空的才套用。 */
  function adoptLayoutFor(preset, renamedFrom) {
    loadLayout(preset.id).then(bindPane(function (res) {
      if (state.preset !== preset) return null;
      if (hasGroups(res.layout)) return { layout: res.layout, saved: true };
      if (!renamedFrom) return null;
      return loadLayout(renamedFrom).then(function (old) {
        return hasGroups(old.layout) ? { layout: old.layout, saved: false } : null;
      });
    })).then(bindPane(function (found) {
      if (!found || state.preset !== preset || hasGroups(state.layout)) return;
      state.layout = found.layout;
      if (!found.saved) {
        state.layout.presetId = preset.id;
        renameRootGroup(preset.id);          // 根群組的 id／名稱跟著換成新名字
      }
      state.layoutRevision = (state.layoutRevision || 0) + 1;
      /* 這個名字底下本來就有的分組檔＝repo 裡的內容；從舊名字搬過來的還沒存。 */
      state.savedLayoutText = found.saved ? VFXLayoutSchema.serialiseLayout(state.layout) : null;
      loadCollapsed();
      renderLayerList();
      refreshDirty();
    }));
  }

  function loadPresetFromFile(file) {
    var reader = new FileReader();
    /* 讀檔是非同步的：結果開進按下「載入 Preset」時的那個視窗 */
    reader.onload = bindPane(function () {
      try {
        var parsed = JSON.parse(String(reader.result));
        var result = VFXCore.validatePreset(parsed);
        if (!result.ok) {
          setValidation('hint err', '載入失敗：\n- ' + result.errors.join('\n- '));
          return;
        }
        var naming = adoptFileName(parsed, file && file.name);
        var holder = paneHolding(parsed.id);
        if (holder && holder !== ctx) {
          showSaveError('無法載入', ['「' + parsed.id + '」已經開在' + paneLabel(holder) +
            '。同一份特效只能開在一個視窗，否則兩邊存檔會互相覆寫。']);
          return;
        }
        /* 全新的編輯狀態（beginDoc）：上一份的 Undo、選取、分組都不適用於這一份 */
        var retire = beginDoc(parsed);
        state.layout = VFXLayoutSchema.emptyLayout(parsed.id);
        state.savedLayoutText = null;        // 匯入的內容還沒進 repo
        /* 從本機檔案匯入的內容還沒進 repo，一律當成未存檔。
           匯入等於「這份就是它自己宣告的那個 preset」，所以來源 id 交給它自己，
           存檔會寫到 <preset.id>.json——這也是把外部改好的 preset 收回 repo 的路。 */
        state.savedText = null;
        state.sourcePresetId = null;
        setSaveStatus('', '');
        finishDoc(retire);                   // preset.loop 由 renderInspector 一起帶出來
        syncPresetIdentity();
        adoptLayoutFor(parsed, naming.renamedFrom);
        announceNaming(naming);
      } catch (e) {
        setValidation('hint err', 'JSON 解析失敗：' + e.message);
      }
    });
    reader.readAsText(file);
  }

  /* 用「已存在的 id」決定編號，不要用陣列長度——刪掉中間的圖層後
     再新增同型別就會撞名，選取與存檔都會壞掉。 */
  function uniqueLayerId(type) {
    var used = {};
    state.preset.layers.forEach(function (l) { used[l.id] = true; });
    var n = state.preset.layers.length + 1;
    while (used[type + '-' + n]) n++;
    return type + '-' + n;
  }

  function addLayer(type) {
    edit('新增圖層', function () { addLayerInner(type); });
  }

  function addLayerInner(type, assetId) {
    /* 空物件不畫東西，沒有素材欄位（Core 會把 assetId 當成不支援的欄位擋下） */
    var base = type === 'empty'
      ? { id: uniqueLayerId(type), type: type }
      : { id: uniqueLayerId(type), type: type, assetId: assetId || '' };
    if (type === 'particle') {
      base.emission = { mode: 'burst', count: 16 };
      base.lifetime = [0.4, 0.8];
      base.speed = [40, 90];
      base.spread = 90;
      base.startScale = 0.3;
    } else if (type === 'procedural') {
      base.effect = 'uvScroll';
      base.size = { x: 256, y: 256 };
      base.scrollSpeed = { x: 0, y: -0.2 };
    }
    state.preset.layers.push(base);
    ensureLayout();
    /* 單一根群組（VFX_AGENT_WORKFLOW §9.11）：新圖層要進那個群組，不是掉到
       根層級。掉到根層級的話存檔之後 LAYOUT-3 會紅，而且是編輯器自己造成的
       違規——規則擋得住 preset-kit 產生的檔案，卻擋不住從編輯器加出來的層。

       只有在「剛好一個群組、而且它收著其餘全部圖層」時才這樣做：那是根群組
       的形狀。使用者自己分了好幾組時不要亂猜要放哪一組，維持原本的根層級。 */
    var groups = state.layout.groups || [];
    var rootGroup = null;
    if (groups.length === 1) {
      var held = groups[0].layerIds;
      var others = state.preset.layers.filter(function (l) { return l.id !== base.id; });
      if (others.every(function (l) { return held.indexOf(l.id) >= 0; })) rootGroup = groups[0];
    }
    if (rootGroup) rootGroup.layerIds.push(base.id);
    else if (Array.isArray(state.layout.order)) state.layout.order.push(keyOf('layer', base.id));
    setSelection([keyOf("layer", base.id)], keyOf("layer", base.id));
    state.anchorKey = state.activeKey;
    renderLayerList(); renderInspector(); onPresetChanged();
  }

  /* 刪除整個選取集合。選到群組時連同它的成員一起刪——列表上看到的就是
     一個物件，只刪掉標題列卻留下散落的子圖層會很難理解。 */
  function deleteSelection() {
    if (!state.selectedKeys.length) return;
    edit('刪除圖層', deleteSelectionInner);
  }

  function deleteSelectionInner() {
    /* 先算出「刪完之後焦點該落在哪」：整個清空會讓人失去位置感，連按兩次
       Delete 還得重新找位置。取被刪範圍在可見列表中的前一列。 */
    var vis = visibleKeys();
    /* 選到父物件就連子孫一起刪（跟群組連成員一起刪同一個道理），不留下指向不存在圖層的 parent */
    var keys = H.withDescendants(state.preset, state.layout, state.selectedKeys);
    var doomed = {};
    keys.forEach(function (k) { doomed[k] = true; });
    var firstAt = vis.length;
    vis.forEach(function (k, i) { if (doomed[k] && i < firstAt) firstAt = i; });
    var survivor = null;
    for (var i = firstAt - 1; i >= 0 && !survivor; i--) { if (!doomed[vis[i]]) survivor = vis[i]; }
    for (var j = firstAt; j < vis.length && !survivor; j++) { if (!doomed[vis[j]]) survivor = vis[j]; }

    M.deleteSelection(state.preset, state.layout, keys);
    if(state.preset.deformation){
      state.preset.deformation.layers=state.preset.deformation.layers.filter(function(id){
        return state.preset.layers.some(function(layer){return layer.id===id;});
      });
      if(!state.preset.deformation.layers.length)delete state.preset.deformation;
    }

    /* survivor 有可能自己就是被刪群組的成員，確認它還在才選它 */
    var alive = survivor && (M.keyKind(survivor) === 'group'
      ? !!M.groupById(state.layout, M.keyId(survivor))
      : !!M.layerById(state.preset, M.keyId(survivor)));
    if (alive) { setSelection([survivor], survivor); state.anchorKey = survivor; }
    else { setSelection([], null); state.anchorKey = null; }
    markLayoutDirty();
    renderLayerList(); renderInspector(); onPresetChanged();
  }


  /* ---------------- 視窗 ----------------

     預覽區可以切成最多四個視窗（2026-09-17 使用者要求），每個視窗各開一份特效：
     各有自己的 Pixi 畫布、預覽 runtime、鏡頭、播放狀態與一份編輯狀態（newDoc）。
     Layers、Inspector、工具列只有一組，顯示焦點視窗的內容；誰是焦點、哪些被多選，
     規則在 pane-model.js。

     為什麼一個視窗一張畫布（各一個 PIXI.Application），而不是一張大畫布切四塊：
     座標換算、格線、gizmo、鏡頭全都是「一張畫布＝一個預覽」寫的，各一張就能原封不動地重用。
     貼圖由 Pixi 的 Assets 全域共用，backend 的參照計數本來就放在模組層級
     （多個 backend 共用同一張貼圖是設計過的情況，見 vfx-pixi-backend.js 的 textureRefs）。 */

  function newPane() {
    return {
      id: 0,
      doc: newDoc(),
      el: null,                 // 這一格（.pane）
      host: null,               // 畫布的容器
      head: null,               // 左上角的標籤：編號、特效名稱、未存檔、暫停、關閉鈕
      app: null,
      stageRoot: null,          // 鏡頭：平移到畫布中心並縮放，特效掛在它底下
      effectRoot: null,         // 目前這組預覽 runtime 的掛載點（換一份特效就換一個）
      bgSolid: null,
      checker: null,
      syncCanvasSize: null,
      resizeObserver: null,
      backend: null,
      runtime: null,
      handle: null,
      playing: true,
      /* 預覽循環＝播完自動重播，只影響編輯時的畫面。
         preset.loop 是出貨資料（決定遊戲裡這個特效會不會自己重複），
         兩者共用一個勾選框的話，想重看一次爆點就會把它改成永不結束。 */
      previewLoop: previewLoopDefault,
      /* ---- 檢視狀態（「怎麼看」，不是 Preset 內容）----
         和背景色同一類，所以一樣不進 preset、不進 Undo 歷史。
         zoom 刻意不記進 localStorage：留著 320% 隔天再打開，第一眼會以為
         素材被誰改大了；格線開關則是穩定的偏好，記得住比較省事。 */
      zoom: 1,
      /* 鏡頭平移量（畫布像素）。與 zoom 一樣是檢視狀態，不進 preset、不進歷史，
         也刻意不記進 localStorage——隔天打開發現特效不在畫面中央會以為它壞了。 */
      panX: 0,
      panY: 0,
      pan: null,
      gizmo: {
        overlay: null,          // PIXI.Container，掛在 stageRoot 之後
        gfx: null,              // PIXI.Graphics
        dirty: true,
        drag: null              // { mode, handle, snapshot, startPoint, pivot, ... }
      },
      grid: { gfx: null, last: null },
      previewPending: false,
      saveStatus: { text: '', cls: '', title: '' },
      validation: { cls: 'hint', text: '' },
      dirtyFlag: false,         // 上一次 refreshDirty 的結果，標籤上的 ● 看它（不必每次重新序列化）
      loadToken: 0,             // 每開一份特效 +1；回應回來時對不上＝已經換成別份，作廢
      closed: false
    };
  }

  var paneSeq = 0;
  var addingPane = false;

  function paneById(id) {
    for (var i = 0; i < panes.length; i++) { if (panes[i].id === id) return panes[i]; }
    return null;
  }

  /* 建一個視窗：DOM、Pixi 畫布、背景、格線、鏡頭、框的覆蓋層，內容是空白特效。
     回傳 Promise<pane>；要開哪一份由呼叫端接著 openPresetInPane。 */
  function createPane() {
    var pane = newPane();
    pane.id = ++paneSeq;
    var el = document.createElement('div');
    el.className = 'pane';
    var host = document.createElement('div');
    host.className = 'pane-canvas';
    el.appendChild(host);
    el.appendChild(buildPaneHead(pane));
    /* 捕獲階段：焦點要在畫布自己的 pointerdown（選取、拖曳）之前換好，
       那些處理拿到的 state 才是這個視窗的 */
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.pane-close')) return;
      finishNudge();                       // 方向鍵按住移動到一半就去點畫面：先把那一段收成一步
      /* 在預覽上按下去＝接下來在預覽區工作：輸入框交出焦點。畫布的 pointerdown 會 preventDefault
         （拖曳時不選到文字），瀏覽器因此不會自己把焦點移走——之前點過的 Inspector 欄位一直留著焦點，
         接著按方向鍵改到的是那一格的數值（2026-09-18：alpha 被加過 1，整份特效不合法、預覽停住），
         Delete、Ctrl+C 也一樣進了輸入框。 */
      commitTextEntry();
      var before = focusedPane;
      activatePane(pane, { ctrl: e.ctrlKey || e.metaKey });
      focusClickEvent = focusedPane !== before ? e : null;
    }, true);
    pane.el = el;
    pane.host = host;
    $('preview-host').appendChild(el);
    panes.push(pane);
    layoutPanes();

    var app = new PIXI.Application();
    return app.init({
      background: '#101014',
      backgroundAlpha: 1,          // 不透明：加法混合才不會在透明畫布上疊出黑方塊
      antialias: true,
      // DPR 設上限：高 DPR 裝置上畫布像素成本會平方成長，預覽不值得付這個代價
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      resizeTo: host
    }).then(function () {
      withPane(pane, function () {
        setupPaneStage(pane, app, host);
        openBlankDoc();
      });
      return pane;
    }, function (e) {
      pane.closed = true;
      panes.splice(panes.indexOf(pane), 1);
      el.remove();
      layoutPanes();
      throw e;
    });
  }

  /* 一個視窗的舞台。在 withPane(pane) 裡執行，state.app、grid.gfx 都是這個視窗的。 */
  function setupPaneStage(pane, app, host) {
    state.app = app;
    host.appendChild(app.canvas);
    /* 背景一律畫在 Pixi 內（純色與棋盤格各一張），不倚賴 renderer.background，
       畫布保持不透明，加法混合才不會疊出黑方塊。 */
    var bgSolid = new PIXI.TilingSprite({
      texture: PIXI.Texture.WHITE, width: 8192, height: 8192
    });
    bgSolid.position.set(-4096, -4096);
    bgSolid.tint = 0x101014;
    app.stage.addChild(bgSolid);
    state.bgSolid = bgSolid;

    var checker = new PIXI.TilingSprite({
      texture: makeCheckerTexture(), width: 8192, height: 8192
    });
    checker.position.set(-4096, -4096);
    checker.visible = false;
    app.stage.addChild(checker);
    state.checker = checker;
    /* 格線夾在背景與特效之間：畫在特效上面的話，一條條線會橫過火焰，
       看起來像素材裂了。順序就是唯一的保證，所以在這裡就位。 */
    grid.gfx = new PIXI.Graphics();
    app.stage.addChild(grid.gfx);
    var root = new PIXI.Container();
    app.stage.addChild(root);
    state.stageRoot = root;
    recentreStage();
    /* resize 事件可能在別的視窗的回合裡發生（Pixi 的 resizeTo 掛在 window 上）：
       綁回這個視窗，否則會去重算焦點視窗的鏡頭中心 */
    app.renderer.on('resize', function () { withPane(pane, recentreStage); });

    /* 畫布尺寸必須跟著「這個元素」，不是跟著視窗。
       Pixi 的 resizeTo 只掛在 window 的 resize 上，量的是啟動當下的 host 尺寸；
       但這一欄會在「視窗沒變、版面自己重算」時改變寬度（整頁捲軸出現、
       頂端工具列換行、側欄收縮、新增或關閉視窗），那時畫布就停在舊尺寸。
       CSS 的 overflow:hidden 已經保證它畫不出欄位外，但畫布本身仍然是錯的，
       預覽會被裁掉一塊。

       兩條路都走，因為它們各自會在不同情況下失效：
         ResizeObserver — 真實瀏覽器裡反應最即時，但實測在某些嵌入式
                          瀏覽器面板裡完全不觸發（連初次觀察都沒有）。
         ticker 檢查    — 每幀兩次整數比較，rAF 有在跑就一定會校正。
       兩者都呼叫同一個函式，不會互相打架。 */
    state.syncCanvasSize = function () {
      var w = Math.max(1, Math.floor(host.clientWidth));
      var h = Math.max(1, Math.floor(host.clientHeight));
      if (w === app.renderer.width && h === app.renderer.height) return false;
      app.renderer.resize(w, h);
      recentreStage();
      return true;
    };
    state.syncCanvasSize();
    if (typeof ResizeObserver === 'function') {
      pane.resizeObserver = new ResizeObserver(function () {
        withPane(pane, function () { state.syncCanvasSize(); });
      });
      pane.resizeObserver.observe(host);
    }

    app.ticker.add(function (ticker) {
      withPane(pane, function () { tickPane(ticker); });
    });
    wireGizmo();
    wirePreviewView(pane);
    if (state.background) setBackground(state.background);
  }

  /* 每個視窗每一幀（在 withPane(pane) 裡）。 */
  function tickPane(ticker) {
    /* 在 playing 判斷之前：暫停時改變視窗大小，畫布一樣要跟上 */
    state.syncCanvasSize();
    drawGrid();                          // 兩者都只在條件變了才真的重畫
    drawGizmo();
    if (!state.playing || !state.runtime) return;
    state.runtime.update(Math.min(ticker.deltaMS, 100) / 1000);
    tickPreviewLoop();                   // 播完就重來（純預覽，不碰 preset.loop）
    /* 工具列不再顯示 effects／particles／pooled／dropped 的計數（2026-09-16 使用者要求：
       那一串把「關閉編輯器」擠到第二行）。要看數字時，主控台打 __vfxEditor.runtime.stats()。 */
    var errs = state.backend.takeErrors();
    if (errs.length) {
      $('preview-msg').className = 'hint err';
      $('preview-msg').textContent = (panes.length > 1 ? paneLabel(ctx) + '：' : '') +
        '貼圖載入失敗：' + errs[0].url;
    }
  }

  /* 換一份特效就換一組預覽 runtime＋backend，舊的連同它載過的貼圖一起收掉：
     同一個視窗開過幾十份特效，貼圖也不會越積越多（以前一份特效一次整頁重載，自然會清掉）。
     每組各掛一個容器——backend 收攤時會清空整個容器，不能和新的共用。
     回傳「收掉舊的那一組」的函式，要等新的畫出第一格再呼叫（見 finishDoc）。 */
  function installRuntime() {
    var oldRuntime = state.runtime, oldRoot = state.effectRoot;
    var root = new PIXI.Container();
    state.stageRoot.addChild(root);
    state.effectRoot = root;
    state.backend = VFXPixiBackend.createBackend({ PIXI: PIXI, container: root });
    state.runtime = VFXCore.createRuntime({
      backend: state.backend,
      resolver: state.resolver
    });
    state.handle = null;
    return function () {
      if (oldRuntime) oldRuntime.destroy();
      if (oldRoot) {
        if (oldRoot.parent) oldRoot.parent.removeChild(oldRoot);
        oldRoot.destroy({ children: true });
      }
    };
  }

  /* 在 withPane(pane) 裡把視窗換成一份全新的編輯狀態（newDoc），preset 就是傳進來的這一份。
     keepRuntime：內容與原本相同（另存新檔之後重開），沿用預覽 runtime，貼圖不必重載。
     回傳交給 finishDoc 的「收掉舊 runtime」函式（沿用時是 null）。 */
  function beginDoc(preset, keepRuntime) {
    var retire = keepRuntime ? null : installRuntime();
    ctx.doc = newDoc();
    ctxDoc = ctx.doc;
    gizmo.drag = null;                   // 拖到一半的框屬於上一份
    state.preset = preset;
    var first = preset.layers[0] ? keyOf('layer', preset.layers[0].id) : null;
    setSelection(first ? [first] : [], first);
    state.anchorKey = first;
    initHistory();                       // 上一份的 Undo 不適用於這一份
    return retire;
  }

  /* 新的一份裝好之後：鏡頭歸零（另存新檔後重開同一份時不動）、面板整組重畫、預覽重建，
     最後才收掉舊的 runtime——新的先畫出第一格，兩份用到同一張貼圖時參照計數才不會
     先歸零而被卸載重載。 */
  function finishDoc(retire, keepCamera) {
    if (!keepCamera) resetCamera();
    markGizmoDirty();
    renderPanels();
    onPresetChanged();
    if (retire) {
      if (state.handle !== null && state.handle !== undefined) state.runtime.update(0);
      retire();
    }
  }

  /* 新視窗的空白特效。暫時的名字避開 repo 裡已有的與其他視窗開著的；第一次存檔會問名字。 */
  function openBlankDoc() {
    ctx.loadToken++;                     // 還在路上的載入作廢
    var taken = combo.rows.map(function (r) { return r.id; });
    panes.forEach(function (p) { if (p.doc.preset) taken.push(p.doc.preset.id); });
    var id = VFXPaneModel.blankPresetId(taken);
    var retire = beginDoc(VFXPaneModel.blankPreset(id));
    state.isNew = true;
    state.layout = VFXLayoutSchema.emptyLayout(id);
    state.savedLayoutText = VFXLayoutSchema.serialiseLayout(state.layout);
    setSaveStatus('', '');
    finishDoc(retire);
    syncPresetIdentity();
  }

  /* 把 repo 裡的一份特效開進視窗。回傳 Promise<boolean>（true＝開好了）。
     opts.keepRuntime  另存新檔之後重開同一份內容：沿用預覽 runtime 與鏡頭
     opts.status       開好之後狀態列顯示的一行（例如「已另存為 xxx」） */
  function openPresetInPane(pane, id, opts) {
    var o = opts || {};
    var token = ++pane.loadToken;
    withPane(pane, function () { setSaveStatus('載入 ' + id + '…', ''); });
    return Promise.all([
      fetchJson(presetUrl(id)),
      /* 分組是 Editor 專用的附加資料，載不到就當作沒有分組——
         它絕不能擋住 Preset 本身的編輯。 */
      loadLayout(id)
    ]).then(function (res) {
      /* 等回應的這段時間視窗被關掉、或又換成別份了：這次的結果作廢 */
      if (pane.closed || token !== pane.loadToken) return false;
      return withPane(pane, function () {
        var retire = beginDoc(res[0], o.keepRuntime);
        /* 剛載入的內容就是 repo 上的內容 → 基準線，dirty = false。
           用 canonical 文字而不是原始 bytes：檔案若還沒 canonical 化，
           每次一開啟就會顯示未存檔，那個提示很快就會被無視。 */
        state.savedText = VFXCore.serialisePreset(state.preset);
        /* 檔名優先於檔案內的 id（見 adoptFileName）。基準線是換名字之前、磁碟上的內容，
           所以換了之後會顯示未存檔，存一次就對齊。以前這裡直接「停用存檔」，
           在檔案總管改過名的特效就只能卡在那裡。 */
        var naming = adoptFileName(state.preset, id + '.json');
        state.sourcePresetId = id;
        state.layout = res[1].layout;
        state.layoutRevision = 0;
        /* 分組的「已存檔基準」。載不到分組檔時基準就是空分組，
           所以一份沒有分組的 preset 打開來不會顯示未存檔。 */
        state.savedLayoutText = VFXLayoutSchema.serialiseLayout(res[1].layout);
        loadCollapsed();
        setSaveStatus(o.status || '', o.status ? 'ok' : '');
        finishDoc(retire, o.keepRuntime);
        if (res[1].error) {
          /* 明確告訴使用者「分組沒載進來」，而不是讓他以為群組被刪光了 */
          setSaveStatus('分組載入失敗', 'err');
          showSaveError('分組未套用', [res[1].error]);
        }
        if (naming.renamedFrom) {
          announceNaming(naming);
          adoptLayoutFor(state.preset, naming.renamedFrom);
        }
        syncPresetIdentity();
        return true;
      });
    }, function (e) {
      if (pane.closed || token !== pane.loadToken) return false;
      withPane(pane, function () {
        setSaveStatus('載入失敗', 'err');
        showSaveError('無法開啟「' + id + '」', [String(e && e.message || e)]);
      });
      return false;
    });
  }

  /* 面板與工具列換成焦點視窗的內容：焦點換人，或焦點視窗換了一份特效時。 */
  function renderPanels() {
    if (!ctx || state.inBackground) return;
    renderLayerList();
    renderInspector();
    refreshHistoryButtons();
    refreshDirty();
    var st = state.saveStatus;
    setSaveStatus(st.text, st.cls, st.title);
    var v = state.validation;
    setValidation(v.cls, v.text);
    syncSaveButton();
    syncPlayPause();
    syncPreviewLoop();
    updateViewReadout();
    syncPresetIdentity();
    renderPaneHeads();
  }

  /* 點擊視窗：焦點與多選照 pane-model 的規則換（opts.ctrl＝Ctrl+點擊）。 */
  function activatePane(pane, opts) {
    var next = VFXPaneModel.clickPane({
      focused: focusedPane ? focusedPane.id : null,
      selected: selectedPanes.map(function (p) { return p.id; })
    }, pane.id, opts || {});
    selectedPanes = next.selected.map(paneById).filter(Boolean);
    focusPane(paneById(next.focused));
    syncPlayPause();
    syncPreviewLoop();
    renderPaneHeads();
  }

  /* 輸入框還開著交易（數值打到一半）就先收尾：blur 會同步觸發 change 與 editCommit，
     那一步記進目前這個視窗自己的歷史（與 Ctrl+S 同一招，見 onKeyDown）。 */
  function commitTextEntry() {
    var active = document.activeElement;
    if (active && active !== document.body && isTextEntry(active) && typeof active.blur === 'function') {
      active.blur();
    }
  }

  function focusPane(pane) {
    if (!pane || pane === focusedPane) return;
    finishNudge();                         // 方向鍵按住移動的那一段記在原本的視窗
    commitTextEntry();                     // 這時 ctx 還是原本的視窗
    var prev = focusedPane;
    if (prev && prev.saveStatus.transient) prev.saveStatus = { text: '', cls: '', title: '' };
    focusedPane = pane;
    ctx = pane;
    ctxDoc = pane.doc;
    if (prev && !prev.closed) withPane(prev, markGizmoDirty);   // 舊的收起框
    markGizmoDirty();
    renderPanels();
  }

  /* 左上角的標籤。只有一個視窗時整條藏起來（CSS），畫面與以前一樣。 */
  function buildPaneHead(pane) {
    var head = document.createElement('div');
    head.className = 'pane-head';
    var no = document.createElement('span');
    no.className = 'pane-no';
    var name = document.createElement('span');
    name.className = 'pane-name';
    var flags = document.createElement('span');
    flags.className = 'pane-flags';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'pane-close';
    close.textContent = '✕';
    close.title = '關閉這個視窗';
    close.onclick = function (e) { e.stopPropagation(); closePane(pane); };
    head.appendChild(no);
    head.appendChild(name);
    head.appendChild(flags);
    head.appendChild(close);
    pane.head = head;
    return head;
  }

  /* 拖曳時每一幀都會走到這裡（refreshDirty）：值沒變就不寫 DOM */
  function renderPaneHead(pane) {
    if (!pane.head) return;
    var d = pane.doc;
    var parts = pane.head.children;
    setText(parts[0], String(panes.indexOf(pane) + 1));
    setText(parts[1], !d.preset ? '' : (d.isNew ? '未命名特效' : d.preset.id));
    parts[1].title = d.isNew ? '還沒存檔的新特效（名字是暫時的，第一次存檔會問）' : '';
    setText(parts[2], (pane.dirtyFlag ? '●' : '') + (pane.playing ? '' : '⏸'));
    parts[2].title = [pane.dirtyFlag ? '未存檔' : '', pane.playing ? '' : '暫停中'].filter(Boolean).join('、');
    pane.el.classList.toggle('focused', pane === focusedPane);
    pane.el.classList.toggle('selected', selectedPanes.indexOf(pane) >= 0);
  }

  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

  function renderPaneHeads() { panes.forEach(renderPaneHead); }

  /* 視窗的排列（pane-model 的 gridLayout）與「新增視窗」能不能按。 */
  function layoutPanes() {
    var host = $('preview-host');
    var g = VFXPaneModel.gridLayout(panes.length);
    host.style.gridTemplateColumns = 'repeat(' + g.cols + ', minmax(0, 1fr))';
    host.style.gridTemplateRows = 'repeat(' + g.rows + ', minmax(0, 1fr))';
    host.classList.toggle('multi', panes.length > 1);
    panes.forEach(function (p, i) { p.el.style.gridColumn = g.spans[i] > 1 ? 'span ' + g.spans[i] : ''; });
    var add = $('btn-add-pane');
    if (add) {
      add.disabled = addingPane || panes.length >= VFXPaneModel.MAX_PANES;
      add.title = panes.length >= VFXPaneModel.MAX_PANES
        ? '最多 ' + VFXPaneModel.MAX_PANES + ' 個視窗'
        : '把預覽區再分出一個視窗（最多 ' + VFXPaneModel.MAX_PANES + ' 個），可以同時開另一份特效';
    }
    renderPaneHeads();
  }

  /* 「新增視窗」：預覽區再切出一格，新的一格是空白特效並取得焦點。 */
  function addPane() {
    if (addingPane || panes.length >= VFXPaneModel.MAX_PANES) return;
    addingPane = true;
    layoutPanes();
    createPane().then(function (pane) {
      addingPane = false;
      activatePane(pane, {});
      layoutPanes();
    }, function (e) {
      addingPane = false;
      layoutPanes();
      showSaveError('無法新增視窗', [String(e && e.message || e)]);
    });
  }

  /* 關閉視窗。未存檔先問；最後一個關不掉（預覽區不能是空的）。 */
  function closePane(pane) {
    if (panes.length <= 1 || pane.closed) return;
    finishNudge();
    if (withPane(pane, isDirty) && !window.confirm(paneLabel(pane) + '（' + pane.doc.preset.id +
        '）的修改尚未存檔，關閉之後就沒了。要關閉嗎？')) {
      return;
    }
    if (pane === focusedPane) commitTextEntry();
    var next = VFXPaneModel.afterClose({
      focused: focusedPane.id,
      selected: selectedPanes.map(function (p) { return p.id; })
    }, pane.id, panes.map(function (p) { return p.id; }));
    pane.closed = true;
    pane.loadToken++;
    panes.splice(panes.indexOf(pane), 1);
    selectedPanes = next.selected.map(paneById).filter(Boolean);
    focusPane(paneById(next.focused));

    withPane(pane, function () {
      gizmo.drag = null;
      if (state.runtime) state.runtime.destroy();
    });
    if (pane.resizeObserver) pane.resizeObserver.disconnect();
    var checkerTexture = pane.checker && pane.checker.texture;
    /* 畫布與它的 WebGL context 一起收掉（Pixi 會 loseContext）：瀏覽器同時能開的 context 有上限，
       開開關關不能越積越多。只收子物件，不動共用的貼圖（Texture.WHITE、Assets 載的素材）。 */
    pane.app.destroy({ removeView: true }, { children: true });
    if (checkerTexture) checkerTexture.destroy(true);
    pane.el.remove();
    layoutPanes();
    syncPlayPause();
    syncPreviewLoop();
    syncPresetIdentity();
  }

  /* ---------------- 啟動 ---------------- */

  function collectVocab() {
    buildBackgroundMap();
    var usage = {}, shape = {}, element = {}, tag = {}, background = {};
    state.semantics.records.forEach(function (r) {
      if (r.kind !== 'vfx') return;
      shape[r.shape] = 1; element[r.element] = 1;
      (r.usage || []).forEach(function (u) { usage[u] = 1; });
      (r.tags || []).forEach(function (t) { tag[t] = 1; });
      /* 從實際資料收集而不是寫死四個值：列出來的每一個選項都保證選得到東西。
         寫死的話，哪天素材庫裡某一類整個消失，下拉上仍會留一個永遠 0 筆的選項。 */
      var bg = state.backgroundById[r.assetId];
      if (bg) background[bg] = 1;
    });
    state.vocab = {
      usage: Object.keys(usage).sort(), shape: Object.keys(shape).sort(),
      element: Object.keys(element).sort(), tag: Object.keys(tag).sort(),
      background: Object.keys(background).sort()
    };
    ['pf-'].forEach(function (p) {
      fillSelect($(p + 'usage'), state.vocab.usage, 'usage');
      fillSelect($(p + 'shape'), state.vocab.shape, 'shape');
      fillSelect($(p + 'element'), state.vocab.element, 'element');
      fillSelect($(p + 'tag'), state.vocab.tag, 'tag');
      fillSelect($(p + 'background'), state.vocab.background, 'background');
    });
  }

  /* 頁面靠 <script> 全域載入這些模組，任何一個沒載進來，錯誤都會在很後面
     才以 "X is not defined" 的形式炸出來，訊息完全指不到真正的原因。
     所以在動任何東西之前先點名一次，缺了就講清楚是哪一個、以及最可能的成因。 */
  function checkModules() {
    var need = [
      ['PIXI', 'js/vendor/pixi.min.js'],
      ['VFXCore', 'js/vfx-core.js'],
      ['VFXPixiBackend', 'js/vfx-pixi-backend.js'],
      ['VFXPresetIdPolicy', 'tools/vfx/editor/preset-id-policy.js'],
      ['VFXViewModel', 'tools/vfx/editor/view-model.js'],
      ['VFXLayoutSchema', 'tools/vfx/editor/layout-schema.js'],
      ['VFXLayerModel', 'tools/vfx/editor/layer-model.js'],
      ['VFXHierarchyModel', 'tools/vfx/editor/hierarchy-model.js'],
      ['VFXPaneModel', 'tools/vfx/editor/pane-model.js'],
      ['VFXMultiEditModel', 'tools/vfx/editor/multi-edit-model.js'],
      ['VFXCurveModel', 'tools/vfx/editor/curve-model.js'],
      ['VFXCurveEditor', 'tools/vfx/editor/curve-editor.js'],
      ['VFXGradientModel', 'tools/vfx/editor/gradient-model.js'],
      ['VFXGradientEditor', 'tools/vfx/editor/gradient-editor.js'],
      ['VFXGizmoModel', 'tools/vfx/editor/gizmo-model.js'],
      ['VFXHistory', 'tools/vfx/editor/history.js'],
      ['VFXSemanticVocab', 'tools/vfx/vfx-semantic-vocab.cjs'],
      ['SpineRef', 'tools/vfx/editor/spine-ref.js'],
      ['VFXWaterTornado', 'js/vfx-water-tornado.js']
    ];
    var missing = need.filter(function (m) {
      return typeof window[m[0]] === 'undefined';
    });
    if (!missing.length) return null;
    return [
      '這幾個模組沒有載入：' + missing.map(function (m) { return m[1]; }).join('、'),
      '最常見的原因是連到了一個舊的 editor-server 行程——它啟動時還沒有開放這些檔案，',
      '所以會回 403。把那個伺服器視窗關掉、重新執行「啟動VFX編輯器.bat」即可。'
    ].join('\n');
  }

  function boot() {
    var moduleError = checkModules();
    if (moduleError) {
      document.getElementById('preview-msg').className = 'hint err';
      document.getElementById('preview-msg').textContent = '啟動失敗\n' + moduleError;
      return;
    }
    var query = presetsFromQuery();
    Promise.all([
      fetchJson(ASSET_INDEX_URL),
      fetchJson(ASSET_SEMANTICS_URL)
    ]).then(function (res) {
      state.index = res[0];
      state.semantics = res[1];
      // Editor 端的 resolver：assetId → 本機資產伺服器 URL。
      // Runtime 之後換成打包後的 URL，Core 不需要任何改動。
      state.resolver = VFXCore.createIndexResolver(
        state.index, '/asset-library/' + state.index.libraryId);
      buildAssetSizeMap();
      loadPreviewLoopPreference();
      wireViewControls();
      /* 背景色要在建視窗之前決定：每個視窗建好舞台時照 state.background 套用 */
      buildBackgroundBar();
      fillSelect($('new-layer-type'), VFXCore.LAYER_TYPES, '型別');
      $('new-layer-type').value = 'sprite';

      // 除錯用把手：Editor 是開發工具，讓瀏覽器主控台與人工 QA 能查看實際場景。
      // state 的每個視窗欄位指向焦點視窗；全部視窗在 __vfxEditorPanes。
      window.__vfxEditor = state;
      window.__vfxEditorPanes = panes;
      /* 存檔／dirty 這條路只有在真的瀏覽器裡才跑得起來（fetch ＋ DOM），
         把入口露出來，QA 與端對端驗證才能斷言結果而不是用看的。 */
      window.__vfxEditorApi = {
        isDirty: isDirty,
        savePreset: savePreset,
        currentPresetText: currentPresetText
      };

      /* 網址上的特效一個視窗一個，照順序開。第一個先開好並取得焦點，
         其餘的一個接一個建——同時建四個 WebGL context 沒有好處，還會讓失敗的原因難追。 */
      return createPane().then(function (first) {
        activatePane(first, {});
        /* 網址沒帶 preset＝空場景：第一個視窗就留著空白特效 */
        return query.ids.length ? openPresetInPane(first, query.ids[0]) : true;
      }).then(function () {
        return query.ids.slice(1).reduce(function (chain, id) {
          return chain.then(function () {
            return createPane().then(function (pane) { return openPresetInPane(pane, id); });
          });
        }, Promise.resolve());
      }).then(function () {
        if (panes[query.focus]) activatePane(panes[query.focus], {});
      });
    }).then(function () {
      /* 順序有意義：先把圖層樹與 Inspector 畫出來，再處理素材瀏覽器。
         左邊那一組要用到素材詞彙表，一旦它出問題，至少不會連圖層分組
         一起消失——那會讓人以為群組被刪掉了，實際上只是沒渲染。 */
      collectVocab();
      wirePicker();
      fillPresetPicker();
    }).catch(function (e) {
      document.getElementById('preview-msg').className = 'hint err';
      document.getElementById('preview-msg').textContent =
        '啟動失敗：' + (e && e.message || e) +
        '\n請確認是用 node tools/vfx/editor-server.cjs 啟動，而不是直接開檔案。';
    });

    $('btn-undo').onclick = doUndo;
    $('btn-redo').onclick = doRedo;
    /* 播放／暫停、Restart、預覽循環作用在多選的全部視窗（沒有多選就是焦點視窗） */
    $('btn-playpause').onclick = function () {
      setPlaying(!VFXPaneModel.playbackState(selectedPanes).playing);
    };
    syncPlayPause();
    $('btn-quit').onclick = quitEditor;
    $('btn-restart').onclick = restart;
    /* 預覽循環是檢視偏好，不進歷史也不進 preset——與播放／暫停同一類。
       preset.loop 改由 Inspector 的「Preset」區塊編輯（見 renderPresetSection）。 */
    $('chk-preview-loop').onchange = function () {
      setPreviewLoop($('chk-preview-loop').checked);
    };
    /* 背景控制項已從左上角工具列移到預覽區正上方（見 buildBackgroundBar）。
       兩處都留的話，兩個控制項的顯示狀態會分家。 */
    $('btn-copy-preset').onclick = copyPresetName;
    $('btn-save').onclick = savePreset;
    $('btn-save-as').onclick = saveAsPreset;
    $('btn-download').onclick = downloadPreset;
    /* 橫幅擋在工具列下面，讀完要收得掉。收掉的只是橫幅，
       右側「驗證」面板仍然留著同一段文字，回頭要查還找得到。 */
    if ($('save-error-close')) $('save-error-close').onclick = clearSaveError;
    $('btn-browse').onclick = openPresetBrowser;
    $('btn-load').onclick = function () { $('file-load').click(); };
    $('file-load').onchange = function (e) {
      if (e.target.files[0]) loadPresetFromFile(e.target.files[0]);
    };
    $('btn-add-pane').onclick = addPane;
    $('btn-add-layer').onclick = function () { addLayer($('new-layer-type').value); };
    $('btn-add-asset').onclick = openPickerForNewLayer;
    $('btn-group').onclick = groupSelection;
    $('btn-ungroup').onclick = ungroupSelection;
    $('sel-sort').onchange = function () {
      /* 只換顯示順序。preset 與 layout 一個 byte 都不會動，所以不呼叫 onPresetChanged。 */
      state.sortMode = $('sel-sort').value;
      renderLayerList();
    };
    document.addEventListener('keydown', onKeyDown);
    /* 方向鍵放開時把按住的那一段收成一步歷史；按住時切到別的程式（收不到 keyup）也要收 */
    document.addEventListener('keyup', function (e) { if (NUDGE_KEYS[e.key]) finishNudge(); });
    window.addEventListener('blur', finishNudge);
    /* 拖曳與平移的後半段接在 window 上（滑鼠拖出畫布也要跟得上），整頁接一次：
       它們作用在焦點視窗，而拖曳一定是在焦點視窗按下去的。 */
    window.addEventListener('pointermove', onPreviewPointerMove);
    window.addEventListener('pointerup', onPreviewPointerUp);
    /* 未存檔時攔一下重整與關分頁。切換 preset 那條路自己有 confirm，但
       F5、Ctrl+R、按上一頁、直接關分頁都沒有——那幾條一樣會把改到一半的
       東西丟掉，而且不會有任何提示。這也是「不去擋 Ctrl+R」的前提：
       擋快捷鍵只擋得住一種按法，這一條把所有離開路徑一起顧到。
       任何一個視窗有未存檔的修改都算。 */
    window.addEventListener('beforeunload', function (e) {
      if (leavingOnPurpose || !dirtyPanes().length) return;
      e.preventDefault();
      e.returnValue = '';          // 舊版瀏覽器要這個才會跳
    });
    $('btn-del-layer').onclick = deleteSelection;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
