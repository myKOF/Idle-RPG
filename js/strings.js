'use strict';
/* ============ 顯示文字讀取（String 表）============
   資料：js/strings_data.js（STRING_DATA，自動產生；來源 config/Excel/String.xlsx）。
   規範：AI_RULES.md 第 8.10 節——所有顯示給玩家的文字都寫在 String 表，程式用編號取字。

   用法：
     STR(1912)                          → "任務總覽"
     STR(1919, prog, def.count)         → 位置參數：表格裡的 {0}、{1}…依序代入
     STR(1920, { name: n, reward: r })  → 具名參數：表格裡的 {name}、{reward}
   代入的值原樣放進字串，**不做 HTML 跳脫**；放進 innerHTML 前，使用者可控的值照舊先 esc()。
   缺少的參數保留原樣的 {N}（讓錯誤看得見，而不是悄悄變成空字串）；null／undefined 代入空字串。

   語言：zh-TW（預設）、zh-CN、en。簡體／英文欄是空的就退回繁體中文。
   語言來源依序為網址 ?lang=、localStorage 的 ir_lang；Worker 由 bridge.js 以網址參數 lang= 傳入。
   切換語言要重新整理（Strings.setLang 會存起來，下次載入生效）。

   HTML 靜態文字：元素加 data-str="編號" 取代文字、data-str-html="編號" 取代 innerHTML、
   data-str-attr="屬性:編號;屬性:編號" 取代屬性（tooltip、title、aria-label…）。
   本檔載入時會對整份文件套用一次；之後動態產生的元素呼叫 Strings.applyDom(root)。

   本檔必須能在三種環境載入且行為一致（主執行緒 <script>／Worker importScripts／Node vm 測試），
   因此只用 ES5 語法、只掛全域；DOM 部分用 typeof 守衛。 */
var Strings = (function () {
  var LANGS = ['zh-TW', 'zh-CN', 'en'];
  var COLUMN = { 'zh-TW': 0, 'zh-CN': 1, 'en': 2 };
  var lang = 'zh-TW';
  var warned = {};

  function table() { return typeof STRING_DATA !== 'undefined' ? STRING_DATA : null; }

  function normalizeLang(v) {
    v = String(v || '').toLowerCase();
    if (v === 'zh-tw' || v === 'zh' || v === 'tw') return 'zh-TW';
    if (v === 'zh-cn' || v === 'cn' || v === 'zh-hans') return 'zh-CN';
    if (v === 'en' || v === 'en-us') return 'en';
    return '';
  }

  function detectLang() {
    var found = '';
    try {
      var loc = typeof location !== 'undefined' ? location : (typeof self !== 'undefined' ? self.location : null);
      var m = loc && /[?&]lang=([^&#]+)/.exec(loc.search || '');
      if (m) found = normalizeLang(decodeURIComponent(m[1]));
    } catch (e) { /* 沒有 location（Node 測試） */ }
    if (!found) {
      try { if (typeof localStorage !== 'undefined') found = normalizeLang(localStorage.getItem('ir_lang')); } catch (e) { /* 私密視窗等 */ }
    }
    return found || 'zh-TW';
  }

  function warnOnce(key, message) {
    if (warned[key]) return;
    warned[key] = true;
    if (typeof console !== 'undefined' && console.warn) console.warn('[Strings] ' + message);
  }

  /* 取出原始樣板（未代入參數）。找不到編號回傳 null。 */
  function raw(id) {
    var t = table();
    var row = t && t[id];
    if (!row) return null;
    var v = row[COLUMN[lang]];
    return v ? v : row[0];
  }

  /* 樣板編譯成「文字／替代字符」片段並快取（戰鬥日誌、飄字每秒會呼叫很多次） */
  var compiled = {};
  function compile(template) {
    var parts = [], re = /\{([A-Za-z0-9_]+)\}/g, last = 0, m;
    while ((m = re.exec(template))) {
      if (m.index > last) parts.push(template.slice(last, m.index));
      parts.push({ k: m[1], n: /^\d+$/.test(m[1]) ? +m[1] : -1, raw: m[0] });
      last = m.index + m[0].length;
    }
    if (last < template.length) parts.push(template.slice(last));
    return parts;
  }

  /* STR(id, p0, p1, …) 或 STR(id, { name: value })。陣列視為位置參數。 */
  function get(id, first) {
    var template = raw(id);
    if (template === null) {
      warnOnce('missing:' + id, '找不到編號 ' + id + (table() ? '' : '（strings_data.js 尚未載入）'));
      return '[#' + id + ']';
    }
    if (arguments.length < 2 || template.indexOf('{') < 0) return template;
    var parts = compiled[lang + ':' + id] || (compiled[lang + ':' + id] = compile(template));
    var named = (arguments.length === 2 && first !== null && typeof first === 'object') ? first : null;
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (typeof p === 'string') { out += p; continue; }
      var v = named ? named[p.k] : (p.n >= 0 ? arguments[p.n + 1] : undefined);
      out += v === undefined ? p.raw : (v === null ? '' : String(v));
    }
    return out;
  }

  function has(id) { return raw(id) !== null; }
  function getLang() { return lang; }
  function setLang(code) {
    var n = normalizeLang(code);
    if (!n) return false;
    lang = n;
    compiled = {};
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('ir_lang', n); } catch (e) { /* 存不了就只在這次有效 */ }
    return true;
  }

  function applyDom(root) {
    if (typeof document === 'undefined') return 0;
    root = root || document;
    var n = 0, i, el, nodes;
    nodes = root.querySelectorAll('[data-str]');
    for (i = 0; i < nodes.length; i++) { el = nodes[i]; el.textContent = get(el.getAttribute('data-str')); n++; }
    nodes = root.querySelectorAll('[data-str-html]');
    for (i = 0; i < nodes.length; i++) { el = nodes[i]; el.innerHTML = get(el.getAttribute('data-str-html')); n++; }
    nodes = root.querySelectorAll('[data-str-attr]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      var pairs = el.getAttribute('data-str-attr').split(';');
      for (var k = 0; k < pairs.length; k++) {
        var cut = pairs[k].lastIndexOf(':');
        if (cut <= 0) continue;
        el.setAttribute(pairs[k].slice(0, cut).trim(), get(pairs[k].slice(cut + 1).trim()));
        n++;
      }
    }
    return n;
  }

  lang = detectLang();

  var api = { get: get, has: has, raw: raw, getLang: getLang, setLang: setLang, applyDom: applyDom, LANGS: LANGS };
  /* 靜態 HTML 的 data-str：本檔排在 strings_data.js 之後、其餘腳本之前載入，文件主體此時已解析完。 */
  if (typeof document !== 'undefined' && document.body) applyDom(document);
  return api;
})();

function STR() { return Strings.get.apply(null, arguments); }

if (typeof module !== 'undefined' && module.exports) module.exports = { Strings: Strings, STR: STR };
