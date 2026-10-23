'use strict';
/* 改過的 js 檔把 index.html（以及 Worker importScripts、bridge 的 WORKER_ASSET_VERSION、VFX 編輯器頁）的 ?v= 快取版本加一（AI_RULES 8.1）。
   以 git HEAD 為基準判斷「還沒加過」，所以重複執行不會重複加；migrate.cjs 每次結束都會呼叫。 */
const fs = require('fs');
const fsx = require('./fsx.cjs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const git = (args) => { try { return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }).toString(); } catch (e) { return ''; } };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const incr = (v) => { const p = v.split('.'); p[p.length - 1] = String(Number(p[p.length - 1]) + 1); return p.join('.'); };

function changedJs() {
  return git(['diff', '--name-only', 'HEAD', '--', 'js']).split('\n').map(s => s.trim()).filter(f => /^js\/.+\.js$/.test(f) && !/^js\/(strings_data|strings)\.js$/.test(f));
}

function bumpFromGit(tag) {
  const rels = changedJs();
  if (!rels.length) return [];
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const headIndex = git(['show', 'HEAD:index.html']);
  const headWorker = git(['show', 'HEAD:js/worker/sim.worker.js']);
  const headBridge = git(['show', 'HEAD:js/bridge.js']);
  let html = read('index.html'), worker = read('js/worker/sim.worker.js'), bridge = read('js/bridge.js');
  const done = [];
  let workerTouched = false;
  for (const rel of rels) {
    const base = rel.replace(/^js\//, '');
    const e = escRe(base);
    // index.html：現行版號與 HEAD 相同才加
    const reIdx = new RegExp('(src="js/' + e + '\\?v=)([^"]+)(")');
    const cur = reIdx.exec(html), old = reIdx.exec(headIndex);
    if (cur && old && cur[2] === old[2]) {
      html = html.replace(reIdx, (m, a, v, c) => a + (/^\d+(?:\.\d+)*$/.test(v) ? incr(v) : tag) + c);
      done.push(rel);
    }
    // Worker importScripts
    const reW = new RegExp("(['\"]\\.\\./" + e + ")(\\?v=[^'\"]*)?(['\"])");
    const wCur = reW.exec(worker), wOld = reW.exec(headWorker);
    if (wCur && wOld && (wCur[2] || '') === (wOld[2] || '')) {
      worker = worker.replace(reW, (m, a, v, c) => a + '?v=' + tag + c);
      workerTouched = true;
    } else if (wCur) workerTouched = workerTouched || (wCur[2] || '') !== (wOld ? (wOld[2] || '') : '');
  }
  if (workerTouched) {
    fsx.write(path.join(ROOT, 'js/worker/sim.worker.js'), worker);
    const reV = /(var WORKER_ASSET_VERSION = ')([^']*)(')/;
    if (reV.exec(bridge)[2] === reV.exec(headBridge)[2]) {
      bridge = bridge.replace(reV, '$1' + tag + '$3');
      const reB = /(src="js\/bridge\.js\?v=)(\d+(?:\.\d+)*)(")/;
      if (reB.exec(html)[2] === reB.exec(headIndex)[2]) html = html.replace(reB, (m, a, v, c) => a + incr(v) + c);
    }
    fsx.write(path.join(ROOT, 'js/bridge.js'), bridge);
  }
  fsx.write(path.join(ROOT, 'index.html'), html);
  // VFX 編輯器頁與主頁共用腳本的版號必須一致（tests/vfx-editor-cache-versions.test.cjs CV-1）
  const edPath = path.join(ROOT, 'tools', 'vfx', 'editor', 'index.html');
  if (fs.existsSync(edPath)) {
    let ed = fs.readFileSync(edPath, 'utf8'); const before = ed;
    for (const rel of rels) {
      const e = escRe(rel.replace(/^js\//, ''));
      const m = new RegExp('src="js/' + e + '\\?v=([^"]+)"').exec(html);
      if (m) ed = ed.replace(new RegExp('(src="/js/' + e + '\\?v=)[^"]+(")'), '$1' + m[1] + '$2');
    }
    if (ed !== before) fsx.write(edPath, ed);
  }
  return done;
}

module.exports = { bumpFromGit, changedJs };
