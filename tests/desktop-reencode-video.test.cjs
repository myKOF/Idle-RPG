'use strict';
/* 打包時重新編碼序章影片（tools/desktop/reencode_video.cjs）。
   守的是：輸出和原檔對得上（幀數、時長、解析度、幀率——序章的字幕與動畫依時間對齊）、
   維持 H.264＋faststart、硬連結先 unlink 再 rename、打包預設會壓（--keep-video 才出原檔）。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../tools/desktop/reencode_video.cjs');

const root = path.resolve(__dirname, '..');
const tool = fs.readFileSync(path.join(root, 'tools', 'desktop', 'reencode_video.cjs'), 'utf8');

test('輸出對照：幀數、幀率、解析度不同或時長差超過一幀就判定不符', () => {
  const a = { frames: 3432, fps: '30/1', width: 1920, height: 1080, duration: 114.4 };
  assert.deepEqual(V.mismatch(a, Object.assign({}, a)), []);
  assert.deepEqual(V.mismatch(a, Object.assign({}, a, { duration: 114.42 })), [], '一幀以內的容器時長差可以接受');
  assert.match(V.mismatch(a, Object.assign({}, a, { frames: 3431 })).join(), /幀數/);
  assert.match(V.mismatch(a, Object.assign({}, a, { fps: '25/1' })).join(), /幀率/);
  assert.match(V.mismatch(a, Object.assign({}, a, { width: 1280 })).join(), /解析度/);
  assert.match(V.mismatch(a, Object.assign({}, a, { duration: 114.5 })).join(), /時長/);
});

test('編碼參數：維持 H.264 High／yuv420p、faststart、每 2 秒關鍵幀、不帶音軌；有音軌的影片不處理', () => {
  for (const s of ["'-c:v', 'libx264'", "'-profile:v', 'high'", "'-pix_fmt', 'yuv420p'", "'-movflags', '+faststart'", "'-g', '60'", "'-an'"]) {
    assert.ok(tool.includes(s), '缺少 ' + s);
  }
  assert.match(tool, /if \(a\.hasAudio\) \{\s*entry\.kept/);
  assert.match(V.RULES_VERSION, new RegExp('crf' + V.CRF));
});

test('硬連結安全與打包預設：先 unlink 再 rename；--keep-video 才不壓；工具不出貨', () => {
  const unlink = tool.indexOf('fs.unlinkSync(file)'), rename = tool.indexOf('fs.renameSync(tmp, file)');
  assert.ok(unlink > 0 && unlink < rename);
  assert.doesNotMatch(tool, /fs\.writeFileSync\(file/);
  const build = fs.readFileSync(path.join(root, 'tools', 'desktop', 'build_desktop.cjs'), 'utf8');
  assert.match(build, /if \(!stageOnly && process\.argv\.indexOf\('--keep-video'\) < 0\) \{\s*var vid = reencodeVideos\(\);/);
  assert.equal(require('../tools/desktop/ship-rules.cjs').classify('tools/desktop/reencode_video.cjs').ship, false);
});
