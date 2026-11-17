'use strict';
/* ============ 桌面版存檔檔案（主行程端，純 Node，可直接測試）============
   計畫見 docs/steam/STEAM_RELEASE_PLAN.md 任務 C。

   存檔放在 userData/saves/（%APPDATA%/idle-rpg/saves），Steam Auto-Cloud 同步的就是這個資料夾的 *.json。
   遊戲端透過 window.ApexHost.saves 呼叫（electron/preload.cjs），js/desktop-save-dir.js 把它包成
   與 File System Access 相同的目錄把手，所以 js/save.js 既有的資料夾存檔流程原封不動沿用。

   ---- 寫入一律原子化 ----
   先寫同目錄的暫存檔、fsync、再 rename 蓋過正式檔。斷電或當機時，正式檔要嘛是舊的完整版，
   要嘛是新的完整版，不會出現寫一半的檔案。暫存檔不是 .json，Steam Cloud 不會同步它。

   ---- 上一版備份 ----
   覆蓋前把舊檔複製成 <檔名>.bak（同樣不是 .json，不進雲端、不進遊戲清單）。
   原子寫入防的是「寫一半」，備份防的是「寫進去的內容本身是壞的」——
   例如某次版本的存檔程式有 bug，玩家還能從 .bak 救回上一份。

   ---- 檔名白名單 ----
   遊戲頁面是不受信任的一端：只接受單層、英數與 ._- 組成、以 .json 結尾的檔名，
   拒絕任何路徑分隔與 ..，確保頁面最多只能碰 saves 資料夾裡的 .json。 */

var fs = require('fs');
var path = require('path');

var NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.json$/;
var MAX_BYTES = 64 * 1024 * 1024;   // 單檔上限：後期存檔 gzip 後約數百 KB，64 MB 只是防呆

function validName(name) {
  return typeof name === 'string' && NAME_RE.test(name) && name.indexOf('..') < 0;
}

function checkName(name) {
  if (!validName(name)) throw new Error('不合法的存檔檔名：' + String(name).slice(0, 80));
  return name;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* 型別用 isView／標籤判斷而非 instanceof：IPC 送來的 typed array 可能屬於別的 realm */
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  throw new Error('存檔內容格式不支援');
}

/* 目錄內的 .json 存檔：[{ name, size, mtimeMs }]（暫存檔、備份檔不列出） */
function list(dir) {
  ensureDir(dir);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(function (e) { return e.isFile() && validName(e.name); })
    .map(function (e) {
      var st = fs.statSync(path.join(dir, e.name));
      return { name: e.name, size: st.size, mtimeMs: st.mtimeMs };
    });
}

/* 讀檔：{ data: Buffer, size, mtimeMs }；不存在回 null */
function read(dir, name) {
  var file = path.join(dir, checkName(name));
  var st;
  try { st = fs.statSync(file); } catch (e) { return null; }
  if (!st.isFile()) return null;
  return { data: fs.readFileSync(file), size: st.size, mtimeMs: st.mtimeMs };
}

/* Windows 上目標檔若正被防毒軟體或 Steam 同步打開，rename 會短暫失敗；退避重試幾次 */
var RETRY_CODES = { EPERM: true, EBUSY: true, EACCES: true };
function renameWithRetry(from, to, attempt) {
  attempt = attempt || 0;
  return fs.promises.rename(from, to).catch(function (e) {
    if (!RETRY_CODES[e.code] || attempt >= 6) throw e;
    return new Promise(function (r) { setTimeout(r, 40 * (attempt + 1)); })
      .then(function () { return renameWithRetry(from, to, attempt + 1); });
  });
}

var _seq = 0;
var _chains = {};   // 完整路徑 -> 最後一筆寫入的 Promise

/* 同一個檔案的寫入依抵達順序排隊：定時自動存檔與關窗存檔可能同時寫同一個檔，
   若各自 rename，先開始卻後完成的舊內容會蓋掉新內容。 */
function write(dir, name, data) {
  var key = path.join(dir, String(name));
  var prev = _chains[key] || Promise.resolve();
  var next = prev.catch(function () {}).then(function () { return writeNow(dir, name, data); });
  _chains[key] = next;
  next.catch(function () {}).then(function () { if (_chains[key] === next) delete _chains[key]; });
  return next;
}

/* 原子寫入：暫存檔 → fsync → 備份舊檔 → rename。回傳 Promise<{ size, mtimeMs }> */
function writeNow(dir, name, data) {
  return Promise.resolve().then(function () {
    checkName(name);
    var buf = toBuffer(data);
    if (buf.length > MAX_BYTES) throw new Error('存檔過大：' + buf.length + ' bytes');
    ensureDir(dir);
    var file = path.join(dir, name);
    var tmp = file + '.tmp-' + process.pid + '-' + Date.now() + (++_seq);
    var handle = null;
    return fs.promises.open(tmp, 'w').then(function (h) {
      handle = h;
      return handle.writeFile(buf);
    }).then(function () {
      return handle.sync();
    }).then(function () {
      return handle.close().then(function () { handle = null; });
    }).then(function () {
      return fs.promises.copyFile(file, file + '.bak').catch(function () { /* 沒有舊檔或備份失敗都不擋正式寫入 */ });
    }).then(function () {
      return renameWithRetry(tmp, file);
    }).then(function () {
      return fs.promises.stat(file);
    }).then(function (st) {
      return { size: st.size, mtimeMs: st.mtimeMs };
    }).catch(function (e) {
      var closing = handle ? handle.close().catch(function () {}) : Promise.resolve();
      return closing.then(function () { return fs.promises.unlink(tmp).catch(function () {}); }).then(function () { throw e; });
    });
  });
}

/* 刪除：不存在也算成功（與 File System Access 的 removeEntry 不同，這裡不需要區分） */
function remove(dir, name) {
  var file = path.join(dir, checkName(name));
  try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return true;
}

/* 開機清掉上次中斷留下的暫存檔（只動 *.json.tmp-*，不碰其他檔案） */
function cleanupTemp(dir) {
  ensureDir(dir);
  var removed = 0;
  fs.readdirSync(dir).forEach(function (n) {
    if (/\.json\.tmp-\d+-\d+$/.test(n)) {   // 格式：<檔名>.json.tmp-<pid>-<時間戳與序號>
      try { fs.unlinkSync(path.join(dir, n)); removed++; } catch (e) {}
    }
  });
  return removed;
}

module.exports = {
  validName: validName,
  list: list,
  read: read,
  write: write,
  remove: remove,
  cleanupTemp: cleanupTemp,
  MAX_BYTES: MAX_BYTES
};
