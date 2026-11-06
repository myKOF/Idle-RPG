'use strict';
/* ============ 玩家本機偏好（設置 → 遊戲設定／音訊） ============
   只存在這台瀏覽器的 localStorage，不進存檔、不進 Worker——顯示與聲音偏好不屬於遊戲狀態。
   已經有自己儲存位置的三項不在這裡，設置頁直接轉接它們原本的開關，避免出現第二套狀態：
     戰鬥數字   ui.js setDamageNumbersEnabled（localStorage setting_damage_numbers）
     降低特效   ui.js setPerfModeEnabled（localStorage setting_perf_mode）
     自動穿裝／裝備比對   裝備頁的 #toggle-autoequip／#toggle-compare（存檔內 factory.autoEquip／settings.compareEq）
   使用者是這些模組的唯一寫入口：Sfx、UISound、BattleRenderer 只讀 GameSettings，不各自存一份。 */
var GameSettings = (function () {
  var KEY = 'idle-rpg.gameSettings.v1';
  var DEFAULTS = {
    outline: true,          // 人物輪廓邊框
    cameraLock: true,       // 鏡頭鎖定（取消後滾輪可調鏡頭距離）
    mute: false,            // 全體靜音
    musicVolume: 50,        // 0～100；開場與開始選單配樂
    sfxVolume: 50,          // 0～100；50＝原本調好的音量，100＝兩倍
    allyAttackSfx: true,    // 我方攻擊音效
    enemyAttackSfx: true    // 敵方攻擊音效
  };
  var values = {}, listeners = [];
  var key;
  for (key in DEFAULTS) values[key] = DEFAULTS[key];

  function sanitize(name, value) {
    if (typeof DEFAULTS[name] === 'boolean') return !!value;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULTS[name];
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var saved = raw ? JSON.parse(raw) : null;
      if (!saved || typeof saved !== 'object') return;
      for (var name in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(saved, name)) values[name] = sanitize(name, saved[name]);
      }
    } catch (e) { /* 讀不到就用預設值 */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch (e) { /* 無痕模式等情況：本次有效即可 */ }
  }
  load();

  function get(name) { return values[name]; }
  function set(name, value) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, name)) return;
    var next = sanitize(name, value);
    if (values[name] === next) return;
    values[name] = next;
    save();
    listeners.slice().forEach(function (fn) { try { fn(name, next); } catch (e) { /* 監聽者出錯不影響其他人 */ } });
  }
  function subscribe(fn) { if (typeof fn === 'function') listeners.push(fn); }

  /* 音效增益：0＝靜音，1＝原音量（音效音量 50%），上限 2（音效音量 100%）。 */
  function sfxGain() { return values.mute ? 0 : values.sfxVolume / 50; }

  return { get: get, set: set, subscribe: subscribe, sfxGain: sfxGain,
    defaults: function () { var copy = {}; for (var name in DEFAULTS) copy[name] = DEFAULTS[name]; return copy; } };
})();
