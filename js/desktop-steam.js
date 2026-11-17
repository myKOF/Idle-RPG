'use strict';
/* ============ 桌面版 Steam 成就轉發（主執行緒）：Steam 任務 D ============
   遊戲成就的判定只在 Worker（js/achievements.js），這裡只負責把「已達成」轉給 Steam：
   - 即時：Worker 的 notice achievementUnlocked → js/ui.js 的通知處理呼叫 onUnlocked(id)
   - 開機補發：enterGame(save) 時把存檔裡 achv.got 全部送一次（離線達成、先玩後接 Steam 都會補上）
   主行程（electron/steam.cjs）會略過 Steam 上已達成的，所以重送沒有成本。

   成就編號 → Steam API 名稱：ACH_ + 三位數編號（與 electron/steam.cjs 的 apiNameFor 同一規則）。
   網頁版沒有 ApexHost.steam，DesktopSteam.enabled 為 false，所有呼叫都是空操作。 */

var DesktopSteam = (function () {
  var host = (typeof window !== 'undefined' && window.ApexHost && window.ApexHost.steam) ? window.ApexHost.steam : null;

  function apiName(id) {
    var n = Number(id);
    if (!(n > 0) || Math.floor(n) !== n) return null;
    var s = String(n);
    while (s.length < 3) s = '0' + s;
    return 'ACH_' + s;
  }

  /* 只送成就表裡真的有的編號，存檔裡的雜訊不會變成 Steam 呼叫 */
  function knownIds() {
    var map = {};
    if (typeof ACHIEVEMENTS !== 'undefined' && ACHIEVEMENTS) {
      for (var i = 0; i < ACHIEVEMENTS.length; i++) map[ACHIEVEMENTS[i].id] = true;
    }
    return map;
  }

  function send(ids) {
    if (!host) return Promise.resolve(null);
    var known = knownIds();
    var names = [];
    for (var i = 0; i < ids.length; i++) {
      if (!known[ids[i]]) continue;
      var name = apiName(ids[i]);
      if (name && names.indexOf(name) < 0) names.push(name);
    }
    if (!names.length) return Promise.resolve(null);
    return Promise.resolve().then(function () { return host.activateAchievements(names); }).catch(function (e) {
      console.warn('[steam] 成就轉發失敗（不影響遊戲）:', e && e.message);
      return null;
    });
  }

  return {
    enabled: !!host,
    apiName: apiName,
    onUnlocked: function (data) {
      var id = data && typeof data === 'object' ? data.id : data;
      return send([id]);
    },
    syncFromSave: function (save) {
      var got = save && save.achv && save.achv.got;
      if (!got || typeof got !== 'object') return Promise.resolve(null);
      var ids = Object.keys(got).filter(function (k) { return !!got[k]; }).map(Number);
      return send(ids);
    }
  };
})();
