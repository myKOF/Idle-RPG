'use strict';
/* 本機啟動診斷；一般遊戲網址不安裝監聽、不讀取狀態，也不寫入任何儲存。 */
(function () {
  var local = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(location.hostname);
  if (!local || !/[?&]startupDiag=1(?:&|$)/.test(location.search)) return;

  var errors = [], pending = Object.create(null), serial = 0;
  function note(message) {
    errors.push(String(message).slice(0, 700));
    if (errors.length > 12) errors.shift();
  }
  window.addEventListener('error', function (event) {
    var target = event.target;
    note(event.message || 'Resource failed: ' + (target && (target.src || target.href) || 'unknown'));
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    note(event.reason && (event.reason.stack || event.reason.message) || event.reason);
  });
  var originalWarn = console.warn;
  console.warn = function () {
    if (String(arguments[0]).indexOf('[battle-renderer]') >= 0) {
      note(Array.prototype.map.call(arguments, function (value) {
        return value && value.message || String(value);
      }).join(' '));
    }
    return originalWarn.apply(console, arguments);
  };
  var originalFetch = window.fetch;
  window.fetch = function () {
    var id = ++serial, input = arguments[0];
    var url = new URL(input && input.url || String(input), document.baseURI);
    if (url.origin === location.origin) pending[id] = { path: url.pathname, at: Date.now() };
    var promise;
    try { promise = originalFetch.apply(this, arguments); }
    catch (error) { delete pending[id]; throw error; }
    promise.then(function () { delete pending[id]; }, function () { delete pending[id]; });
    return promise;
  };

  function readState() {
    var worker = typeof WorkerBridge !== 'undefined' ? WorkerBridge.status() : {};
    var renderer = typeof BattleRenderer !== 'undefined' ? BattleRenderer.status() : {};
    var state = typeof UI_WORKER_STATE !== 'undefined' ? UI_WORKER_STATE : {};
    var desired = typeof desiredUiPanelSubscriptions === 'function' ? desiredUiPanelSubscriptions() : {};
    var screen = document.getElementById('loading-screen');
    return {
      page: document.readyState, hidden: document.hidden,
      loading: !!screen && !screen.classList.contains('is-hidden'),
      lock: typeof TabLock !== 'undefined' ? TabLock.isHolder() : null,
      clockPaused: typeof GameClock !== 'undefined' ? GameClock.isPaused() : null,
      worker: { started: worker.started, booted: worker.booted, alive: worker.alive,
        deadReason: worker.deadReason, ticks: worker.ticks, lastError: worker.lastError },
      canvas: { ready: renderer.ready, failed: renderer.failed, sceneReady: renderer.sceneReady,
        size: renderer.size, zone: renderer.zone, scene: renderer.scene, decor: renderer.decor },
      ui: { tab: typeof UI !== 'undefined' ? UI.tab : null, view: !!state.view,
        panels: Object.keys(state.panels || {}),
        missing: Object.keys(desired).filter(function (key) { return !(state.panels && state.panels[key] != null); }),
        dirty: typeof UI !== 'undefined' ? { header: UI.dirty.header, battle: UI.dirty.battle } : null,
        error: typeof UI_TICK_DIAG !== 'undefined' ? UI_TICK_DIAG.lastErrorMsg : null },
      pendingFetch: Object.keys(pending).map(function (id) {
        return { path: pending[id].path, seconds: Math.round((Date.now() - pending[id].at) / 1000) };
      }),
      errors: errors.slice()
    };
  }
  function mount() {
    var panel = document.createElement('details');
    panel.id = 'startup-diagnostics';
    panel.open = true;
    panel.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;' +
      'width:min(620px,calc(100vw - 16px));max-height:80vh;overflow:auto;' +
      'background:#111827;color:#f3f4f6;padding:12px;border:2px solid #fbbf24;font:14px sans-serif;';
    var title = document.createElement('summary');
    title.textContent = '本機啟動診斷（點擊收合）';
    panel.appendChild(title);
    var hint = document.createElement('p');
    hint.textContent = '等待約10秒後，按「複製診斷」並貼回聊天。若無法複製，可選取下方文字。';
    panel.appendChild(hint);
    var copy = document.createElement('button');
    copy.type = 'button'; copy.textContent = '複製診斷';
    panel.appendChild(copy);
    var output = document.createElement('textarea');
    output.readOnly = true; output.rows = 16; output.setAttribute('aria-label', '啟動診斷內容');
    output.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin-top:8px;' +
      'color:#f3f4f6;background:#030712;font:12px monospace;';
    panel.appendChild(output);
    function refresh() {
      try { output.value = JSON.stringify(readState(), null, 2); }
      catch (error) { output.value = 'Diagnostic error: ' + error.message; }
    }
    copy.addEventListener('click', function () {
      refresh();
      output.focus(); output.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(output.value).then(function () {
          copy.textContent = '已複製，請貼回聊天';
        }, function () { copy.textContent = '請按 Ctrl+C 複製已選取的文字'; });
      } else copy.textContent = '請按 Ctrl+C 複製已選取的文字';
    });
    document.body.appendChild(panel);
    refresh();
    setInterval(function () { if (document.activeElement !== output) refresh(); }, 1000);
  }
  window.readStartupDiagnosticState = readState;
  // 獨立診斷頁由父頁提供操作區，遊戲 frame 只回報狀態。
  if (window.parent !== window) {
    try { if (window.parent.location.pathname === '/tools/startup-diagnostics.html') return; }
    catch (error) { /* 一般嵌入情境仍保留本頁診斷。 */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
