'use strict';
/* ============================================================
   fetch-runtime.cjs — 抓官方的 Spine Pixi runtime 放進 vendor/

   為什麼是「抓」而不是把檔案直接放進版控：

   Spine 的 runtime 授權綁編輯器授權——要用 runtime，你（或公司）必須持有
   Spine 編輯器的授權。把第三方 runtime 的二進位檔提交進 repo 等於把它散布
   出去，那是一個不容易收回的動作，而這個專案目前並沒有確認過授權狀態。
   所以 repo 裡只留這支腳本：要用的人自己抓，決定權留在該在的地方。

   （對照：js/vendor/pixi.min.js 是提交進 repo 的。Pixi 是 MIT，沒有這個問題。）

   ⚠️ runtime 版本必須與匯出素材的編輯器版本相符，4.1／4.2／4.3 的檔案格式
      互不相容。官方的 spine-pixi-v8 只出 4.2 與 4.3——素材若是 4.1，
      Pixi v8 上沒有官方 runtime 可用，得先用編輯器重新匯出。
      手上那批是幾版？用 spine-probe.cjs 讀出來，不要猜。

   用法：
     node tools/spine/fetch-runtime.cjs          抓 4.2 與 4.3
     node tools/spine/fetch-runtime.cjs 4.2      只抓一個
   ============================================================ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const PKG = '@esotericsoftware/spine-pixi-v8';
/* dist-tag 對應：4.3 是 latest，4.2 有自己的 v4.2-latest。
   固定寫 major 而不是完整版號，抓到的就是該系列最新的修正版。 */
const TAGS = { '4.2': 'v4.2-latest', '4.3': 'latest' };
const OUT_DIR = path.join(__dirname, 'vendor');

function fetchOne(major) {
  const tag = TAGS[major];
  if (!tag) throw new Error('不支援的版本：' + major + '（只有 ' + Object.keys(TAGS).join(' 與 ') + '）');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-'));
  try {
    /* npm 在 Windows 上是 npm.cmd，而 Node 從 CVE-2024-27980 之後不允許
       execFile 直接跑 .cmd（會得到 EINVAL）；要跑就得經過 shell。
       但 execFile + args + shell:true 的組合會被 DEP0190 警告——參數不經
       跳脫直接串接。所以改用 execSync 傳整條命令字串：同樣經過 shell，
       沒有那個組合，而參數全部來自本檔的常數（PKG 與 TAGS），沒有外部輸入。

       stderr 丟掉：npm pack 會把整份 tarball 的檔案清單當 notice 印出來，
       在這裡是純噪音，還會把真正要看的那一行沖到螢幕外。 */
    const out = execSync('npm pack ' + PKG + '@' + tag, {
      cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
    const tgz = out.trim().split(/\r?\n/).pop().trim();
    execSync('tar xzf ' + JSON.stringify(tgz), { cwd: tmp, stdio: 'ignore' });
    const src = path.join(tmp, 'package', 'dist', 'iife', 'spine-pixi-v8.min.js');
    if (!fs.existsSync(src)) throw new Error('套件裡找不到 iife 版：' + src);
    const version = JSON.parse(
      fs.readFileSync(path.join(tmp, 'package', 'package.json'), 'utf8')).version;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const dst = path.join(OUT_DIR, 'spine-pixi-v8-' + major + '.min.js');
    fs.copyFileSync(src, dst);
    console.log('  ' + PKG + '@' + version + ' → ' +
      path.relative(path.join(__dirname, '..', '..'), dst).replace(/\\/g, '/') +
      '（' + Math.round(fs.statSync(dst).size / 1024) + ' KB）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const want = process.argv.slice(2).filter(function (a) { return a[0] !== '-'; });
  const list = want.length ? want : Object.keys(TAGS);
  try {
    list.forEach(fetchOne);
    console.log('');
    console.log('好了。在 VFX Editor 按「🦴 Spine 參考」就能用。');
    console.log('⚠️ Spine runtime 的授權綁編輯器授權，請自行確認。');
  } catch (e) {
    console.error('[ERROR] ' + e.message);
    process.exit(2);
  }
}

module.exports = { fetchOne: fetchOne };
