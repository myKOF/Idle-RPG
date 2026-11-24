'use strict';
/* ============ 真人遊玩記錄（主行程端，純 Node，可直接測試）============

   目的：把「你自己實際怎麼玩」持續記到硬碟，拿來跟縮時模擬的策略逐段對照、改策略。
   遊戲端是 js/play-log.js；設計與檔案格式見 docs/PLAY_LOG.md。

   ---- 只在內測模式啟用 ----
   main.cjs 只有在 --internal（且非打包版）時才建立本模組；其他情況 playlog:status
   回 enabled:false，遊戲端就整個不啟動。正式版與 demo 打包版因此不會留下任何記錄。

   ---- 和 js/recorder.js 的差別 ----
   recorder 是「完全重播」用的：要固定亂數、擋存檔、手動匯出。這裡是「觀察」：
   照常存檔、照常亂數，一邊玩一邊落地，不追求重現同一場。

   ---- 檔案 ----
   <dir>/play_YYYY-MM-DD.jsonl      一行一筆（操作／日誌／狀態取樣），依本機日期分檔
   <dir>/saves/<時間>_lv<等級>.json  定期存檔副本（gzip，與桌面存檔同格式；scripts/run_sim.js --save 可直接讀）

   ---- 遊戲頁面是不受信任的一端 ----
   檔名一律由這裡產生，頁面只能送內容；每批大小、每行大小、存檔大小都有上限。 */

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var MAX_BATCH_LINES = 5000;
var MAX_LINE_BYTES = 64 * 1024;          // 單行上限：超過就換成一筆截斷說明，不靜默丟掉
var MAX_SAVE_BYTES = 64 * 1024 * 1024;   // 與 save-files.cjs 同一個防呆上限
var KEEP_SAVES = 200;                    // 存檔副本最多留幾份（超過刪最舊的）

function pad(n) { return (n < 10 ? '0' : '') + n; }
function localDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function localStamp(d) {
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function create(dir, opts) {
  opts = opts || {};
  var now = opts.now || function () { return new Date(); };
  var keepSaves = opts.keepSaves || KEEP_SAVES;
  var savesDir = path.join(dir, 'saves');
  var stats = { lines: 0, dropped: 0, saves: 0, lastError: null };

  function fail(where, e) {
    stats.lastError = where + ': ' + (e && e.message || String(e));
    if (opts.log) opts.log('[playlog] ' + stats.lastError);
  }

  /* lines：字串陣列，每個字串是一筆 JSON。內容不重新解析（成本高、也不是這裡的責任），
     只擋型別與大小；換行字元會破壞 jsonl，一律拒收該行。 */
  function append(lines) {
    if (!Array.isArray(lines)) throw new Error('playlog: lines 必須是陣列');
    if (lines.length > MAX_BATCH_LINES) throw new Error('playlog: 單批超過 ' + MAX_BATCH_LINES + ' 行');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i];
      if (typeof s !== 'string' || /[\r\n]/.test(s)) { stats.dropped++; continue; }
      if (Buffer.byteLength(s, 'utf8') > MAX_LINE_BYTES) {
        stats.dropped++;
        s = JSON.stringify({ k: 'truncated', bytes: Buffer.byteLength(s, 'utf8'), head: s.slice(0, 200) });
      }
      out.push(s);
    }
    if (!out.length) return 0;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'play_' + localDate(now()) + '.jsonl'), out.join('\n') + '\n');
      stats.lines += out.length;
    } catch (e) { fail('append', e); throw e; }
    return out.length;
  }

  /* 存檔副本：檔名由這裡決定（時間＋等級），頁面給的等級只取整數。 */
  function writeSave(json, meta) {
    if (typeof json !== 'string' || !json.length) throw new Error('playlog: 存檔內容必須是字串');
    if (Buffer.byteLength(json, 'utf8') > MAX_SAVE_BYTES) throw new Error('playlog: 存檔過大');
    var lv = meta && Number.isFinite(Number(meta.level)) ? Math.max(0, Math.floor(Number(meta.level))) : 0;
    var name = localStamp(now()) + '_lv' + lv + '.json';
    try {
      fs.mkdirSync(savesDir, { recursive: true });
      var tmp = path.join(savesDir, name + '.tmp');
      fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(json, 'utf8')));
      fs.renameSync(tmp, path.join(savesDir, name));
      stats.saves++;
      prune();
    } catch (e) { fail('writeSave', e); throw e; }
    return name;
  }

  function prune() {
    var files = fs.readdirSync(savesDir).filter(function (n) { return /\.json$/.test(n); }).sort();
    for (var i = 0; i < files.length - keepSaves; i++) {
      try { fs.unlinkSync(path.join(savesDir, files[i])); } catch (e) { fail('prune', e); }
    }
  }

  return {
    dir: dir,
    append: append,
    writeSave: writeSave,
    status: function () {
      return { enabled: true, dir: dir, lines: stats.lines, dropped: stats.dropped, saves: stats.saves, lastError: stats.lastError };
    }
  };
}

module.exports = { create: create, MAX_BATCH_LINES: MAX_BATCH_LINES, MAX_LINE_BYTES: MAX_LINE_BYTES, KEEP_SAVES: KEEP_SAVES };
