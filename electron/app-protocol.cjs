'use strict';
/* ============ app:// 協議：把遊戲目錄當成網站伺服（純函式，Node 測試可直接載入）============
   ---- 為什麼不用 file:// ----
   遊戲大量使用 fetch()、new Worker()、importScripts()、import() 與 importmap，
   Chromium 在 file:// 下會擋掉這些（Worker／module 需要同源、fetch 不能讀 file）。
   改成自訂的標準協議 app://game/ 之後，頁面的行為與 http 伺服完全相同，
   而且 origin 固定為 app://game —— IndexedDB／localStorage 的作用域不會因為
   安裝路徑改變而換一份（file:// 的 origin 是 null，換資料夾就會遺失存檔）。

   ---- 為什麼主機名是 game ----
   isInternalServer()／isGMHost()（js/ui.js、js/gm.js、js/gm_exec.js）以 localhost、
   127.0.0.1、file: 判定開放 GM 與內測工具。主機名 game 不在名單內，
   正式版因此天然關閉這些工具，不必在遊戲程式裡新增第三種判定。

   ---- 內測模式：app://localhost ----
   反過來用同一條規則：主機名換成 localhost，GM 與內測工具就照網頁內測服的方式開放，
   遊戲程式一行都不用改（啟動桌面版(內測).bat → --internal，只限從原始碼執行，見 main.cjs）。
   一次只伺服一個主機名：正式模式拒絕 app://localhost，內測模式拒絕 app://game。

   本檔只做路徑與標頭的計算；讀檔與串流在 electron/main.cjs。 */

var path = require('path');

var SCHEME = 'app';
var HOST = 'game';
var INTERNAL_HOST = 'localhost';
var ORIGIN = SCHEME + '://' + HOST;

function originFor(host) { return SCHEME + '://' + (host || HOST); }

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  // Worker 的 importScripts 與 ES module 都要求嚴格的 JavaScript MIME
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.atlas': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.ktx2': 'image/ktx2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.skel': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/* 打包時 .png 會被換成 WebP 內容、檔名不變（tools/desktop/webp_images.py：程式、配置表、Preset 裡的
   路徑全都寫 .png，改檔名牽動太大）。這類檔案要回報 image/webp，所以 .png 先看檔頭再決定。
   head：檔案前 12 個位元組。回傳要覆寫的 MIME，或 null（照副檔名）。 */
function needsSniff(filePath) {
  return path.extname(filePath).toLowerCase() === '.png';
}
function sniffImageMime(head) {
  if (!head || head.length < 12) return null;
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/* 請求網址 → 磁碟上的絕對路徑。不合法一律回 null（呼叫端回 404）：
   - 不是 app://<host>（host 預設 game；內測模式傳 INTERNAL_HOST）
   - 解碼失敗、含 NUL
   - 正規化後跑出根目錄（../ 或 %2e%2e 穿越、磁碟代號、UNC）
   - 任何一段以 . 開頭（.git、.env、.claude 之類的開發檔案）
   query 與 hash 一律忽略：index.html 的 ?v= 只是快取版本號。 */
function resolveRequestPath(rootDir, requestUrl, host) {
  var u;
  try { u = new URL(requestUrl); } catch (e) { return null; }
  if (u.protocol !== SCHEME + ':' || u.hostname !== (host || HOST)) return null;
  var rel;
  try { rel = decodeURIComponent(u.pathname); } catch (e) { return null; }
  if (rel.indexOf('\0') >= 0) return null;
  rel = rel.replace(/\\/g, '/');
  if (rel === '' || rel === '/') rel = '/index.html';
  var segments = rel.split('/').filter(function (s) { return s.length > 0; });
  for (var i = 0; i < segments.length; i++) {
    if (segments[i] === '..' || segments[i].charAt(0) === '.') return null;
    if (/^[a-zA-Z]:$/.test(segments[i])) return null;
  }
  if (!segments.length) return null;
  var root = path.resolve(rootDir);
  var full = path.resolve(root, segments.join(path.sep));
  var rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (full.indexOf(rootWithSep) !== 0) return null;
  return full;
}

/* Range 標頭 → { start, end }（含 end）。影片（開場動畫、迷你視窗）需要 206 才能拖曳與串流。
   無標頭回 null（整檔 200）；格式錯或超出範圍回 false（呼叫端回 416）。
   只支援單一區段，多區段請求退回整檔。 */
function parseRange(header, size) {
  if (!header) return null;
  var m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  if (m[1] === '' && m[2] === '') return false;
  var start, end;
  if (m[1] === '') {
    var suffix = Number(m[2]);
    if (!(suffix > 0)) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!(start >= 0) || start >= size || end < start) return false;
  return { start: start, end: end };
}

module.exports = {
  SCHEME: SCHEME,
  HOST: HOST,
  INTERNAL_HOST: INTERNAL_HOST,
  ORIGIN: ORIGIN,
  originFor: originFor,
  mimeFor: mimeFor,
  needsSniff: needsSniff,
  sniffImageMime: sniffImageMime,
  resolveRequestPath: resolveRequestPath,
  parseRange: parseRange
};
