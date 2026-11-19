'use strict';
/* 桌面關閉 Chromium 背景節流後 document.hidden 仍可能為 false。
   合併原生視窗狀態，只暫停顯示；Worker 與遊戲時鐘不在這裡暫停。 */
var GameVisibility = (function () {
  var host = typeof window !== 'undefined' && window.ApexHost && window.ApexHost.activity;
  var background = !!host, revision = 0, tickers = [];
  function isHidden() { return background || (typeof document !== 'undefined' && !!document.hidden); }
  function syncTickers() {
    tickers.forEach(function (entry) {
      if (entry.ticker._destroyed) return;
      if (isHidden()) entry.stop.call(entry.ticker);
      else if (entry.wanted) entry.start.call(entry.ticker);
    });
  }
  function update(state) {
    if (!state || typeof state.background !== 'boolean') return;
    revision++;
    if (background === state.background) return;
    background = state.background;
    syncTickers();
    document.dispatchEvent(new Event('gamevisibilitychange'));
  }
  function trackTicker(ticker) {
    if (!ticker || tickers.some(function (entry) { return entry.ticker === ticker; })) return;
    var entry = { ticker: ticker, start: ticker.start, stop: ticker.stop, wanted: !!ticker.started };
    tickers.push(entry);
    ticker.start = function () { entry.wanted = true; if (!isHidden()) entry.start.call(ticker); };
    ticker.stop = function () { entry.wanted = false; entry.stop.call(ticker); };
    if (isHidden()) entry.stop.call(ticker);
  }
  document.addEventListener('visibilitychange', syncTickers);
  if (host) {
    host.onChange(update);
    var requestedAt = revision;
    Promise.resolve(host.get()).then(function (state) {
      // 訂閱後收到的新事件優先，不能被較早的查詢回覆蓋回去。
      if (revision === requestedAt) update(state);
    }).catch(function (error) { console.warn('[visibility]', error); });
  }
  return { isHidden: isHidden, trackTicker: trackTicker };
})();
