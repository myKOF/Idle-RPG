'use strict';
/* ============ 桌面版存檔資料夾：File System Access 目錄把手的替身（主執行緒）============
   計畫見 docs/steam/STEAM_RELEASE_PLAN.md 任務 C。

   ---- 為什麼是「替身」而不是另寫一套存檔 ----
   js/save.js 的資料夾存檔（自動存檔檔、手動存檔、清單、刪除、開機挑最新）全部建立在
   File System Access 的目錄把手 `_saveDir` 上，取得把手的唯一入口是 idbGetDir()。
   桌面版只要在那裡交出一個行為相同的把手，整套流程就原封不動沿用——不會有第二套存檔邏輯，
   存檔格式、檔名、gzip 壓縮、開機挑最新的規則全部與網頁版相同。

   底層走 window.ApexHost.saves（electron/preload.cjs → electron/save-files.cjs），
   檔案落在 userData/saves/，也就是 Steam Auto-Cloud 同步的資料夾。

   只實作 save.js 用得到的部分：
     目錄：kind、name、getFileHandle(name, {create})、removeEntry(name)、values()／entries()／keys()、
           requestPermission()／queryPermission()（恆為 granted：資料夾固定、不需授權）、isSameEntry()
     檔案：kind、name、getFile()（真正的 File 物件）、createWritable() → write()／close()／abort()

   網頁版沒有 ApexHost，DesktopSaveDir 為 null，save.js 照舊走瀏覽器的資料夾授權流程。 */

var DesktopSaveDir = (function () {
  var host = (typeof window !== 'undefined' && window.ApexHost && window.ApexHost.saves) ? window.ApexHost.saves : null;
  if (!host) return null;

  /* 錯誤物件帶 File System Access 的錯誤名稱（save.js 只看 name）。
     內部防呆的訊息用 new Error 寫（開發診斷，不給玩家看）；
     玩家可能看到的「找不到存檔」走 String 表。 */
  function named(name, err) { err.name = name; return err; }
  function notFound() {
    return named('NotFoundError', new Error(typeof STR === 'function' ? STR(1992) : 'NotFoundError'));
  }

  /* 寫入資料轉成位元組：save.js 寫的是 gzip 的 ArrayBuffer，也可能退回純字串。
     型別一律用標籤與 ArrayBuffer.isView 判斷，不用 instanceof：資料可能來自別的 realm
     （例如 Response 產生的 ArrayBuffer），instanceof 會誤判成「不支援」。 */
  function tagOf(x) { return Object.prototype.toString.call(x); }
  function chunkBytes(data) {
    if (data && typeof data === 'object' && data.type === 'write' && 'data' in data) data = data.data;
    if (typeof data === 'string') return Promise.resolve(new TextEncoder().encode(data));
    if (tagOf(data) === '[object ArrayBuffer]') return Promise.resolve(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) return Promise.resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (data && typeof data.arrayBuffer === 'function') return data.arrayBuffer().then(function (b) { return new Uint8Array(b); });   // Blob／File
    return Promise.reject(named('TypeMismatchError', new Error('不支援的寫入內容')));
  }

  function concat(parts) {
    var total = 0;
    parts.forEach(function (p) { total += p.byteLength; });
    var out = new Uint8Array(total);
    var off = 0;
    parts.forEach(function (p) { out.set(p, off); off += p.byteLength; });
    return out;
  }

  function Writable(name) {
    var parts = [];
    var pending = Promise.resolve();
    var closed = false;
    return {
      write: function (data) {
        if (closed) return Promise.reject(named('InvalidStateError', new Error('寫入已結束')));
        pending = pending.then(function () { return chunkBytes(data); }).then(function (b) { parts.push(b); });
        return pending;
      },
      close: function () {
        if (closed) return Promise.reject(named('InvalidStateError', new Error('寫入已結束')));
        closed = true;
        // 整份內容一次交給主行程做原子寫入：close 之前磁碟上的舊檔完全不受影響
        return pending.then(function () { return host.write(name, concat(parts)); }).then(function () {});
      },
      abort: function () {
        closed = true;
        parts = [];
        return Promise.resolve();
      }
    };
  }

  function FileHandle(name) {
    return {
      kind: 'file',
      name: name,
      getFile: function () {
        return host.read(name).then(function (res) {
          if (!res) throw notFound();
          return new File([res.data], name, { type: 'application/json', lastModified: Math.round(Number(res.mtimeMs) || Date.now()) });
        });
      },
      createWritable: function () { return Promise.resolve(Writable(name)); },
      isSameEntry: function (other) { return Promise.resolve(!!other && other.kind === 'file' && other.name === name); },
      queryPermission: function () { return Promise.resolve('granted'); },
      requestPermission: function () { return Promise.resolve('granted'); }
    };
  }

  function listEntries() {
    return host.list().then(function (rows) {
      return (rows || []).map(function (r) { return r.name; });
    });
  }

  var dir = {
    kind: 'directory',
    name: 'saves',
    isDesktop: true,
    getFileHandle: function (name, opts) {
      var create = !!(opts && opts.create);
      if (create) return Promise.resolve(FileHandle(name));
      return listEntries().then(function (names) {
        if (names.indexOf(name) < 0) throw notFound();
        return FileHandle(name);
      });
    },
    getDirectoryHandle: function () {
      return Promise.reject(named('NotAllowedError', new Error('桌面版存檔資料夾沒有子資料夾')));
    },
    removeEntry: function (name) {
      return host.remove(name).then(function () {});
    },
    values: function () {
      var names = null, i = 0;
      return {
        next: function () {
          var ready = names ? Promise.resolve() : listEntries().then(function (n) { names = n; });
          return ready.then(function () {
            if (i >= names.length) return { done: true, value: undefined };
            return { done: false, value: FileHandle(names[i++]) };
          });
        },
        [Symbol.asyncIterator]: function () { return this; }
      };
    },
    entries: function () {
      var it = dir.values();
      return {
        next: function () { return it.next().then(function (r) { return r.done ? r : { done: false, value: [r.value.name, r.value] }; }); },
        [Symbol.asyncIterator]: function () { return this; }
      };
    },
    keys: function () {
      var it = dir.values();
      return {
        next: function () { return it.next().then(function (r) { return r.done ? r : { done: false, value: r.value.name }; }); },
        [Symbol.asyncIterator]: function () { return this; }
      };
    },
    isSameEntry: function (other) { return Promise.resolve(other === dir); },
    queryPermission: function () { return Promise.resolve('granted'); },
    requestPermission: function () { return Promise.resolve('granted'); }
  };
  dir[Symbol.asyncIterator] = dir.entries;
  return dir;
})();
