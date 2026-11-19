'use strict';
/* ============ 打包時重新編碼影片（序章） ============
   node tools/desktop/reencode_video.cjs <暫存區根目錄> <快取資料夾> <報告 JSON>
   由 tools/desktop/build_desktop.cjs 呼叫；只改暫存區那一份，專案裡的原檔（Codex 的序章流程產出）不動。需要 ffmpeg。

   ---- 為什麼 ----
   序章 opening_animation/shots-01-05-replay.mp4 是 1080p30、7 Mbps 的 H.264（96 MB），是包體第二大的單檔。
   以 x264 CRF 重新編碼：維持 H.264（所有顯示卡都有硬體解碼，低階機也播得順；AV1 更小但不少電腦只能軟解）、
   維持解析度、幀率與總幀數（js/intro-player.js 的字幕與動畫依時間對齊），只換位元率。
   畫質用 VMAF 對照原檔（見下方 CRF 的註解）。

   ---- 規則 ----
   - 暫存區所有 .mp4；重壓後沒有小 10% 的保留原檔。
   - 輸出：H.264 High、yuv420p、每 2 秒一個關鍵幀（跳轉比較快）、moov 放檔頭（faststart，邊載邊播）、不帶音軌
     （序章的聲音是另外的 mp3；原檔也沒有音軌——有音軌的影片一律保留原檔，不在這裡處理）。
   - 驗證：輸出的幀數與時長要和原檔相同，不同就保留原檔並在報告標出。

   ---- 暫存區是原始碼的硬連結 ----
   寫暫存檔 → unlink 原路徑 → rename。 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var childProcess = require('child_process');

/* 2026-11-19 試壓（x264 slow，對照原檔的 VMAF）：CRF 20 → 77 MB／95.1、CRF 22 → 60 MB／93.6、CRF 24 → 46 MB／91.8。
   抽最暗的兩幀與差異最大的一幀局部放大 2 倍比對，CRF 24 與原檔看不出差別（暗部沒有色階斷層），採用 24。 */
var CRF = 24;
var RULES_VERSION = 'v1-x264-slow-crf' + CRF + '-g60-faststart';
var FFMPEG = process.env.FFMPEG || 'ffmpeg';
var FFPROBE = process.env.FFPROBE || 'ffprobe';

function probe(file) {
  var r = childProcess.spawnSync(FFPROBE, ['-v', 'error', '-count_packets', '-show_entries',
    'stream=codec_type,nb_read_packets,r_frame_rate,width,height:format=duration', '-of', 'json', file], { windowsHide: true });
  if (r.status !== 0) throw new Error('ffprobe 失敗：' + file + '\n' + r.stderr);
  var j = JSON.parse(r.stdout.toString());
  var v = (j.streams || []).filter(function (s) { return s.codec_type === 'video'; })[0];
  return {
    hasAudio: (j.streams || []).some(function (s) { return s.codec_type === 'audio'; }),
    frames: v ? Number(v.nb_read_packets) : 0,
    fps: v ? v.r_frame_rate : '',
    width: v ? v.width : 0,
    height: v ? v.height : 0,
    duration: Number(j.format && j.format.duration) || 0
  };
}

function encode(src, out) {
  var r = childProcess.spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(CRF), '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-g', '60', '-movflags', '+faststart', out], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.error || r.status !== 0) throw new Error('ffmpeg 失敗（' + (r.error ? r.error.message : '結束碼 ' + r.status) + '）：' + src);
}

/* 輸出要和原檔對得上：幀數相同、時長差不到一幀、解析度與幀率相同。回傳不符的原因清單。 */
function mismatch(a, b) {
  var bad = [];
  if (a.frames !== b.frames) bad.push('幀數 ' + a.frames + ' → ' + b.frames);
  if (a.fps !== b.fps) bad.push('幀率 ' + a.fps + ' → ' + b.fps);
  if (a.width !== b.width || a.height !== b.height) bad.push('解析度');
  var frame = 1 / (Number(a.fps.split('/')[0]) / Number(a.fps.split('/')[1] || 1) || 30);
  if (Math.abs(a.duration - b.duration) > frame + 1e-6) bad.push('時長 ' + a.duration + ' → ' + b.duration);
  return bad;
}

function listMp4(dir) {
  var out = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
      var p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.mp4$/i.test(e.name)) out.push(p);
    });
  })(dir);
  return out;
}

function run(stage, cacheDir, reportFile) {
  fs.mkdirSync(cacheDir, { recursive: true });
  var report = { rules: RULES_VERSION, files: [], beforeBytes: 0, afterBytes: 0 };
  listMp4(stage).forEach(function (file) {
    var rel = path.relative(stage, file).replace(/\\/g, '/');
    var src = fs.readFileSync(file);
    var entry = { file: rel, before: src.length, after: src.length };
    var key = crypto.createHash('sha1').update(RULES_VERSION).update(src).digest('hex');
    var cached = path.join(cacheDir, key + '.mp4');
    var a = probe(file);
    if (a.hasAudio) {
      entry.kept = '有音軌（不在這裡處理）';
    } else {
      if (!fs.existsSync(cached)) {
        var tmpOut = cached + '.tmp.mp4';
        encode(file, tmpOut);
        var bad = mismatch(a, probe(tmpOut));
        if (bad.length) { fs.unlinkSync(tmpOut); entry.kept = '輸出對不上：' + bad.join('、'); }
        else fs.renameSync(tmpOut, cached);
      } else entry.cacheHit = true;
      if (!entry.kept) {
        var size = fs.statSync(cached).size;
        if (src.length - size < src.length * 0.10) entry.kept = '省不到 10%';
        else {
          var tmp = file + '.reencode-tmp';
          fs.copyFileSync(cached, tmp);
          fs.unlinkSync(file);          // 斷開硬連結（不動原始檔）
          fs.renameSync(tmp, file);
          entry.after = size;
          entry.frames = a.frames;
        }
      }
    }
    report.beforeBytes += entry.before;
    report.afterBytes += entry.after;
    report.files.push(entry);
  });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log('影片重新編碼：' + report.files.length + ' 個，' + (report.beforeBytes / 1048576).toFixed(1) + ' → ' +
    (report.afterBytes / 1048576).toFixed(1) + ' MB' + report.files.filter(function (f) { return f.kept; }).map(function (f) { return '\n  保留 ' + f.file + '：' + f.kept; }).join(''));
  return report;
}

module.exports = { mismatch: mismatch, CRF: CRF, RULES_VERSION: RULES_VERSION };

if (require.main === module) {
  try { run(path.resolve(process.argv[2]), path.resolve(process.argv[3]), path.resolve(process.argv[4])); }
  catch (e) { console.error(e && e.message || e); process.exit(1); }
}
