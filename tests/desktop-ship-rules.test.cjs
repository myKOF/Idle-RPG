'use strict';
/* 桌面版出貨清單（tools/desktop/ship-rules.cjs）。
   白名單漏一個檔，玩家拿到的版本就會缺東西，而且開發時完全看不出來（開發是整個專案目錄在跑）。
   這裡擋三件事：
   1. index.html 直接引用的本機檔案全部出貨（2026-11-17 打包版漏了 tools/startup-diagnostics.js）
   2. 執行期程式碼裡寫死的資源路徑全部出貨
   3. 逐檔排除的大檔沒有被執行期程式碼引用（有人開始用它時要擋下來） */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const { execFileSync } = require('child_process');
const Rules = require('../tools/desktop/ship-rules.cjs');

const ROOT = path.resolve(__dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 1 << 28 })
  .toString('utf8').split('\0').filter(Boolean);
const trackedSet = new Set(tracked);
const shipped = new Set(tracked.filter((p) => Rules.classify(p).ship));
const introDataPath = 'js/intro-data.js';

function replayTimeline(source) {
  return vm.runInNewContext(source + '\nINTRO_REPLAY_TIMELINE;');
}

function runtimeSources() {
  return tracked.filter((p) => /^js\/.*\.js$/.test(p) || /^css\/.*\.css$/.test(p) || p === 'index.html')
    .map((p) => ({ path: p, text: fs.readFileSync(path.join(ROOT, p), 'utf8') }));
}

test('index.html 的 src／href 本機檔案全部在出貨清單裡', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const missing = [];
  const re = /\b(?:src|href)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1];
    if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(url)) continue;
    const rel = url.split(/[?#]/)[0].replace(/^\.\//, '');
    if (!rel || !trackedSet.has(rel)) continue;   // 不在 git 裡的（例如被忽略的檔）不歸出貨清單管
    if (!shipped.has(rel)) missing.push(rel);
  }
  assert.deepStrictEqual(missing, []);
});

test('執行期程式碼寫死的資源路徑全部在出貨清單裡', () => {
  const missing = new Set();
  const re = /['"`]((?:images|audio|assets|vfx|fonts|js|css|opening_animation)\/[^'"`?#\s]+\.[a-z0-9]{2,5})(?=[?#'"`])/gi;
  for (const src of runtimeSources()) {
    // 序章另有本機 GM 專用時間軸，正式版只讀重播設定。
    const content = src.path === introDataPath ? JSON.stringify(replayTimeline(src.text)) : src.text;
    let m;
    while ((m = re.exec(content))) {
      const rel = m[1];
      if (rel.includes('${') || rel.includes('*')) continue;
      if (trackedSet.has(rel) && !shipped.has(rel)) missing.add(rel + '（' + src.path + '）');
    }
  }
  assert.deepStrictEqual([...missing], []);
});

test('逐檔排除的檔案沒有被執行期程式碼引用', () => {
  const sources = runtimeSources();
  const used = [];
  for (const ex of Rules.EXCLUDE_FILES) {
    const base = path.basename(ex.path);
    const hit = sources.find((s) => s.text.includes(base));
    if (hit) used.push(ex.path + ' 被 ' + hit.path + ' 引用');
  }
  assert.deepStrictEqual(used, []);
});

test('逐檔排除的條目都還存在於 git（過期條目要清掉）', () => {
  const stale = Rules.EXCLUDE_FILES.map((e) => e.path).filter((p) => !trackedSet.has(p));
  assert.deepStrictEqual(stale, []);
});

test('授權檔一律出貨，原始檔與開發目錄不出貨', () => {
  assert.strictEqual(Rules.classify('fonts/start-menu/OFL-Cinzel.txt').ship, true);
  assert.strictEqual(Rules.classify('js/vendor/three/LICENSE').ship, true);
  assert.strictEqual(Rules.classify('images/models/npc3d/MAKEHUMAN_LICENSE.txt').ship, true);
  assert.strictEqual(Rules.classify('js/vendor/three/README.md').ship, false);
  assert.strictEqual(Rules.classify('assets/characters/knight3d/knight_batch1.glb').ship, false);
  assert.strictEqual(Rules.classify('config/Excel/Gems.xlsx').ship, false);
  assert.strictEqual(Rules.classify('tools/vfx/editor-server.cjs').ship, false);
  assert.strictEqual(Rules.classify('tests/desktop-ship-rules.test.cjs').ship, false);
  assert.strictEqual(Rules.classify('config/param-patches/.gitignore').ship, false);
  assert.strictEqual(Rules.classify('js/main.js').ship, true);
});

test('序章實際播放的影片與音效有出貨', () => {
  const intro = replayTimeline(fs.readFileSync(path.join(ROOT, introDataPath), 'utf8'));
  const refs = [intro.video, intro.captions, intro.audio.sfx].map((ref) => ref.split('?')[0]);
  assert.ok(refs.includes('opening_animation/shots-01-05-replay.mp4'));
  assert.ok(refs.includes('opening_animation/旁白.md'));
  assert.ok(refs.includes('opening_animation/shots-01-05-replay-sfx.mp3'));
  assert.ok(shipped.has('audio/zones/desert-ascendant.mp3'));
  assert.strictEqual(Rules.classify('opening_animation/shot-01-03.mp4').ship, false);
  assert.strictEqual(Rules.classify('opening_animation/shot-01-03-sfx.mp3').ship, false);
  assert.strictEqual(Rules.classify('opening_animation/review/draft.mp4').ship, false);
  for (const r of refs) assert.ok(shipped.has(r), r + ' 沒有出貨');
});

test('舊序章素材只供本機 GM 預覽，桌面版不出貨', () => {
  const sources = runtimeSources();
  const previewReaders = sources.filter((src) => src.path !== introDataPath && /\bINTRO_TIMELINES\b/.test(src.text));
  assert.deepStrictEqual(previewReaders.map((src) => src.path), ['js/gm.js']);
  const context = {
    location: new URL('app://game/'),
    document: { readyState: 'complete' },
    window: {},
    module: { exports: {} }
  };
  vm.runInNewContext(previewReaders[0].text, context);
  assert.strictEqual(context.module.exports.runClientCommand('intro list'), null);

  for (const dir of ['prologue', 'prologue-v2', 'prologue-audio', 'storybook']) {
    const files = tracked.filter((p) => p.startsWith('opening_animation/' + dir + '/'));
    assert.ok(files.length > 0, dir + ' 仍供本機預覽');
    assert.ok(files.every((p) => !shipped.has(p)), dir + ' 不出貨');
  }
});
