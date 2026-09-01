'use strict';
/* ============================================================
   preset-id-policy.js — 「這個 preset id 可以拿來當檔名嗎」的唯一定義

   為什麼要獨立成一個檔：
   Core 的 validatePreset 只管 preset.id 是不是合法的識別字；能不能拿去落檔
   是另一回事（長度、Windows 裝置名）。這條規則同時被兩邊需要：
     - tools/vfx/editor-server.cjs   最終防線，一定要擋
     - tools/vfx/editor/editor.js    存檔前先擋，讓人當場看到原因
   兩邊各寫一份的話遲早會分家，變成 Editor 說可以存、伺服器回 400。
   所以只寫一份，用 dual export 讓 Node 與瀏覽器都載得到。

   注意這裡**不重複 Core 的 schema 驗證**：Core 仍然是 preset 合法性的
   單一來源，本檔只回答「檔名」這一個問題。
   ============================================================ */

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VFXPresetIdPolicy = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* 與 vfx-core.js validatePreset 的 preset.id 規則同一條 */
  var PRESET_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
  /* Windows 的裝置名不只擋 CON：CON.json 也會被解析成 CON 裝置。
     這類名字通過 PRESET_ID_RE，但落檔行為完全不是「建立一個檔案」。 */
  var WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
  var MAX_LENGTH = 64;

  /* 回傳 null 代表可以當檔名；否則回傳一句可以直接顯示給人看的原因。 */
  function presetIdProblem(id) {
    if (typeof id !== 'string' || id === '') return 'preset id 不得為空';
    if (id.length > MAX_LENGTH) return 'preset id 超過 ' + MAX_LENGTH + ' 字元';
    if (!PRESET_ID_RE.test(id)) return 'preset id 只能是小寫英數與連字號，且以英數開頭';
    if (WINDOWS_RESERVED_RE.test(id)) return 'preset id 不能是 Windows 保留裝置名：' + id;
    return null;
  }

  function isWritablePresetId(id) { return presetIdProblem(id) === null; }

  return {
    PRESET_ID_RE: PRESET_ID_RE,
    WINDOWS_RESERVED_RE: WINDOWS_RESERVED_RE,
    MAX_LENGTH: MAX_LENGTH,
    presetIdProblem: presetIdProblem,
    isWritablePresetId: isWritablePresetId
  };
});
