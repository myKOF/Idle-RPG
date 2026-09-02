'use strict';
/* ============================================================
   editor-server.cjs — VFX Editor 的本機開發伺服器（VFX 專用）

   Editor 需要兩種檔案，但它們不在同一個地方：
     1. 專案內的檔案（Editor 頁面、js/vfx-core.js、vfx/*.json）→ 由 repo root 提供
     2. 素材本身 → 在本機 Asset Library Root（每台電腦不同，且在 repo 之外）

   本檔把第 2 類掛到 /asset-library/<libraryId>/… 這個 URL 前綴底下。
   這就是 VFX_ASSET_SCHEMA §6 說的「Asset Library Root → URL」那一步：
   Preset 只存 assetId，Editor 端的 resolver 把它變成這個伺服器的 URL，
   Runtime 之後換成打包後的 URL 即可，Core 完全不需要知道差別。

   除了讀檔，本檔還提供唯一一個寫入 API：

       PUT /vfx/presets/<presetId>.json

   讓 Editor 把編輯中的 Preset 直接存回 repo，而不是只能下載到 Downloads
   再手動搬檔。寫入面刻意做成「固定目錄 ＋ 白名單 id」而不是「呼叫端給路徑」：
   目的地目錄是模組常數，呼叫端唯一能決定的是一段 [a-z0-9-] 的 id，
   所以「寫到哪裡」不是輸入的函數，路徑穿越沒有可以下手的地方。

   已知且接受的限制：符號連結檢查是 TOCTOU-racy。
   findLinkOnPath() 檢查完之後，落檔仍然是用路徑呼叫 openSync/renameSync，
   中間有一段窗口可以把 vfx/presets 換成 junction。要真正關掉這個窗口需要
   openat / O_NOFOLLOW 這類「對著已開啟的目錄 handle 操作」的介面，
   Node 的 fs 在 Windows 上沒有可攜的等價物。
   接受它的理由是威脅模型：能贏這場競態的人必須已經能在這台機器上、
   以同一個使用者身分執行程式碼——而那種人本來就能直接改任何檔案，
   不需要來搶一台只聽 127.0.0.1 的開發伺服器。
   對「遠端」或「瀏覽器裡的其他分頁」這兩種真正要防的來源，這條路走不通。
   實作上仍在 rename 前重新檢查一次，把窗口縮到最小。

   用法：
     node tools/vfx/editor-server.cjs            預設埠 28361 起往上找
     node tools/vfx/editor-server.cjs --port 8080
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const libraryRoot = require('./vfx-library-root.cjs');
/* Preset 的驗證與序列化只有一套，就是 Core 的那一套。
   伺服器端不另外實作 schema 檢查，否則「Editor 存得進去、Runtime 載不起來」
   的分歧遲早會出現。 */
const VFXCore = require('../../js/vfx-core.js');
/* 「這個 id 能不能當檔名」只有一份定義，Editor 端載入的是同一個檔，
   否則遲早會變成 Editor 顯示可以存、伺服器回 400。 */
const presetIdPolicy = require('./editor/preset-id-policy.js');
/* Layer 分組是 Editor 專用的 authoring metadata，不進 Preset／Runtime。
   驗證與序列化同樣只有一份，Editor 頁面載入的是同一個檔。 */
const layoutSchema = require('./editor/layout-schema.js');

const REPO_ROOT = libraryRoot.REPO_ROOT;
const ASSET_PREFIX = '/asset-library/';
/* Editor 只需要這幾個目錄；其餘 repo 內容一律不對外。
   最後一筆是**單一檔案**而不是目錄：Asset Picker 要顯示 blendMode／tintable，
   那兩個是由事實層推導出來的，規則只有一份在 vfx-semantic-vocab.cjs。
   為了不讓 Editor 抄第二份，開放這一個檔；其餘 tools/vfx 的建置工具仍不對外。 */
const REPO_ALLOWLIST = ['/tools/vfx/editor/', '/tools/vfx/vfx-semantic-vocab.cjs',
  '/js/', '/vfx/'];
const PORT_BASE = 28361;
const PORT_TRIES = 10;
/* 啟動器用來確認「這個埠上的是不是本副本的 Editor」，見下方路由處的說明 */
const WHOAMI_PATH = '/__whoami';
const WHOAMI_MARK = 'idle-rpg-vfx-editor';

/* ---- Preset 存檔 API 的常數（全部是常數，沒有一個來自請求） ---- */
const PRESETS_DIR_REL = 'vfx/presets';
/* 刻意不放在 vfx/presets 底下：export-assets.cjs 會把那個目錄裡每一個
   *.json 都當成正式 Preset 讀，layout 檔放進去會變成一份幽靈 preset。 */
const LAYOUTS_DIR_REL = 'vfx/layouts';
const SAVE_PREFIX = '/vfx/presets/';
const LAYOUT_PREFIX = '/vfx/layouts/';
/* 寫入目的地只能是這兩個常數之一。這個陣列存在的目的是讓「目的地不是
   輸入的函數」這件事可以被斷言，而不是靠讀程式碼相信。 */
const WRITABLE_DIRS = [PRESETS_DIR_REL, LAYOUTS_DIR_REL];
const SAVE_SUFFIX = '.json';
const MAX_SAVE_BODY_BYTES = 1024 * 1024;
/* 暫存檔名故意不以 .json 結尾：export-assets.cjs 會把 vfx/presets 底下
   所有 *.json 當成正式 Preset 讀，萬一程序被砍留下暫存檔，不能讓它變成
   一份「多出來的 Preset」。開頭的點又讓 GET 那邊的 dotfile 規則擋掉它。 */
const TEMP_PREFIX = '.vfx-save-tmp-';
const TEMP_TRIES = 32;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

/* 自己切 query／fragment，不交給任何 URL parser。
   url.parse 已被標為不建議使用，而 WHATWG 的 new URL() 更不能用在這裡：
   它會依規格把 %2e%2e 當成 double-dot segment 直接摺掉，
   /vfx/presets/%2e%2e/evil.json 會在我們看到之前就變成 /vfx/evil.json。
   路由要看的是「對方原本送了什麼」，不是「正規化後看起來像什麼」。 */
function rawPathnameOf(requestUrl) {
  let s = String(requestUrl || '/');
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  const f = s.indexOf('#');
  if (f >= 0) s = s.slice(0, f);
  return s || '/';
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload) + '\n', 'application/json; charset=utf-8');
}

/* 只允許讀取指定根目錄底下的檔案。
   兩道關卡：先做字串層的前綴檢查擋掉 ../，再用 realpath 解開符號連結／junction
   後重新檢查一次——只比對字串的話，root 裡面一條指向外部的連結就能繞過去。 */
function safeJoin(root, relative) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, '.' + path.sep + relative);
  const prefix = resolvedRoot + path.sep;
  if (target !== resolvedRoot && target.indexOf(prefix) !== 0) return null;
  let realTarget;
  try {
    realTarget = fs.realpathSync(target);
  } catch (e) {
    return target;                     // 檔案不存在：交給後續的 404，不算穿越
  }
  let realRoot;
  try { realRoot = fs.realpathSync(resolvedRoot); } catch (e) { realRoot = resolvedRoot; }
  const realPrefix = realRoot + path.sep;
  if (realTarget !== realRoot && realTarget.indexOf(realPrefix) !== 0) return null;
  return target;
}

/* Editor 自己的檔案一律 no-store，其餘（素材縮圖等）維持 no-cache。
   原因是實測過的：no-cache 只要求「重新驗證」，而本伺服器不送 ETag／
   Last-Modified，瀏覽器沒有驗證依據時仍可能直接用舊的 editor.js。
   結果是改了程式、重整、行為沒變——量到的數字對不上程式碼，很難查。
   Asset Browser 有 900 多張縮圖，那些不能一起 no-store，否則每次重整全部重抓。 */
function cacheControlFor(pathname) {
  return pathname.indexOf('/tools/vfx/editor/') === 0 ? 'no-store' : 'no-cache';
}

function serveFile(res, filePath, pathname) {
  fs.stat(filePath, function (err, stat) {
    if (err || !stat.isFile()) return send(res, 404, 'Not found: ' + filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cacheControlFor(pathname || '')
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ============================================================
   Preset 存檔 API
   ============================================================ */

/* presetId 一律從「未解碼」的 pathname 取。
   最上面的 GET 流程會先 decodeURIComponent，那對讀檔沒問題，對寫檔不行：
   %2e%2e 解碼後就變成真的 ..，等於把穿越字元餵給後面的檢查。
   改成看原始字串之後，% 本身就不在 PRESET_ID_RE 的字元集內，
   任何 percent-encoding 都在第一關結束，不必去推理「解碼幾次才安全」。 */
function idFromRawPath(rawPathname, prefix) {
  if (typeof rawPathname !== 'string') return null;
  if (rawPathname.indexOf(prefix) !== 0) return null;
  const rest = rawPathname.slice(prefix.length);
  if (rest.length <= SAVE_SUFFIX.length) return null;
  if (rest.slice(-SAVE_SUFFIX.length) !== SAVE_SUFFIX) return null;
  const id = rest.slice(0, rest.length - SAVE_SUFFIX.length);
  /* [a-z0-9-] 以外一律不接受，因此 / \ . : % 、絕對路徑、UNC、大小寫別名
     全部在這裡就結束，後面不需要再做第二套字串清理。 */
  if (!presetIdPolicy.isWritablePresetId(id)) return null;
  return id;
}

/* 既有呼叫端與測試用的名字保留，語意不變：只認 preset 那條前綴。 */
function presetIdFromRawPath(rawPathname) {
  return idFromRawPath(rawPathname, SAVE_PREFIX);
}

/* 從 repo root 逐段往下檢查有沒有符號連結／junction。
   目的地目錄雖然是常數，常數也可能被人換成一條指向外面的連結；
   只比字串的話，vfx/presets 變成 junction 之後寫進去的檔案會落在 repo 之外。 */
function findLinkOnPath(rootAbs, targetAbs) {
  const rel = path.relative(rootAbs, targetAbs);
  if (rel !== '' &&
      (path.isAbsolute(rel) || rel === '..' || rel.indexOf('..' + path.sep) === 0)) {
    return '路徑不在 repo 內：' + targetAbs;
  }
  /* 從 repo root 自己開始檢查，而不是從它底下的第一段開始：
     root 本身就是一條連結的話，底下每一段都「看起來」正常。 */
  const segs = rel === '' ? [] : rel.split(path.sep);
  let cur = rootAbs;
  for (let i = -1; i < segs.length; i++) {
    if (i >= 0) cur = path.join(cur, segs[i]);
    let st;
    try {
      st = fs.lstatSync(cur);
    } catch (e) {
      /* 只有「真的不存在」才放行給呼叫端處理。EACCES、EIO 這類是「查不到」，
         把查不到當成安全是最典型的 fail-open。 */
      if (e.code === 'ENOENT') return null;
      return '無法檢查路徑（' + e.code + '）：' + cur;
    }
    if (st.isSymbolicLink()) return '路徑上有符號連結／junction：' + cur;
  }
  return null;
}

/* 實際落檔。把 canonical text 寫成 <dirRel>/<id>.json。
   dirRel 只能是 WRITABLE_DIRS 裡的模組常數——由路由挑，不是由請求挑，
   下面第一行就把這件事斷言掉。檔名同樣是白名單 id，
   所以「寫到哪裡」依然不是輸入的函數。 */
function writeJsonFile(ctx, dirRel, fileId, text) {
  if (WRITABLE_DIRS.indexOf(dirRel) < 0) {
    return { status: 500, error: '不是允許的寫入目錄：' + dirRel };
  }
  const presetId = fileId;
  const repoRootAbs = path.resolve(ctx.repoRoot);
  const presetsDirAbs = path.join(repoRootAbs, dirRel.split('/').join(path.sep));
  const hooks = ctx.hooks || {};

  const linkProblem = findLinkOnPath(repoRootAbs, presetsDirAbs);
  if (linkProblem) return { status: 403, error: dirRel + ' 目錄不可用：' + linkProblem };

  let dirStat;
  try { dirStat = fs.lstatSync(presetsDirAbs); } catch (e) {
    return { status: 500, error: '找不到目錄：' + presetsDirAbs };
  }
  if (!dirStat.isDirectory()) {
    return { status: 403, error: '目標不是目錄：' + presetsDirAbs };
  }

  const targetAbs = path.join(presetsDirAbs, presetId + SAVE_SUFFIX);
  /* 縱深防禦：presetId 已經過白名單，這行理論上不可能失敗，
     但「理論上不可能」是最不該省略檢查的地方。 */
  if (path.dirname(targetAbs) !== presetsDirAbs) {
    return { status: 403, error: '目標檔逃出指定目錄：' + targetAbs };
  }

  let existing = null;
  try {
    existing = fs.lstatSync(targetAbs);
  } catch (e) {
    /* 同上：只有 ENOENT 才算「還沒有這個檔」 */
    if (e.code !== 'ENOENT') {
      return { status: 500, error: '無法檢查目標檔（' + e.code + '），未寫入：' + targetAbs };
    }
    existing = null;
  }
  if (existing) {
    /* 目標是連結時絕不覆寫。這裡不用「反正 rename 不跟隨連結」自我安慰：
       連結出現在這個位置本身就代表有人動過手腳，該讓人看見而不是默默取代掉。 */
    if (existing.isSymbolicLink()) {
      return { status: 403, error: '目標是符號連結，拒絕覆寫：' + targetAbs };
    }
    if (!existing.isFile()) {
      return { status: 403, error: '目標不是一般檔案，拒絕覆寫：' + targetAbs };
    }
  }

  const buf = Buffer.from(text, 'utf8');
  let tempAbs = null;
  let fd = null;
  try {
    for (let n = 0; n < TEMP_TRIES; n++) {
      const candidate = path.join(presetsDirAbs,
        TEMP_PREFIX + presetId + '-' + process.pid + '-' + n);
      try {
        /* 'wx' = 獨佔建立。撞到既有檔案就換下一個名字，永遠不覆寫不認識的檔。 */
        fd = fs.openSync(candidate, 'wx');
        tempAbs = candidate;
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
    if (fd === null) return { status: 500, error: '找不到可用的暫存檔名，未寫入任何檔案' };

    /* writeSync 允許短寫（回傳的 bytes 少於要求），磁碟寫滿時尤其會發生。
       不看回傳值就 rename 的話，會把一份被截斷的 JSON 蓋到好好的 preset 上，
       而且還回報成功——這正是「失敗的存檔毀掉原檔」最容易發生的地方。 */
    let written = 0;
    while (written < buf.length) {
      const n = fs.writeSync(fd, buf, written, buf.length - written, written);
      if (!(n > 0)) throw new Error('寫入停滯：只寫了 ' + written + '/' + buf.length + ' bytes');
      written += n;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    /* 關檔後再量一次實際大小。上面的迴圈保證「呼叫端認為寫了幾 bytes」，
       這一行保證「檔案系統上真的有幾 bytes」，兩者都對了才敢 rename。 */
    const actual = fs.statSync(tempAbs).size;
    if (actual !== buf.length) {
      throw new Error('暫存檔大小不符：' + actual + ' / 應為 ' + buf.length);
    }

    if (hooks.beforeRename) hooks.beforeRename(tempAbs, targetAbs);
    /* rename 之前把連結檢查再跑一次。這不能消除 TOCTOU（Node 沒有可攜的
       openat/O_NOFOLLOW），但可以把「檢查通過之後才被換成 junction」的窗口
       縮到最小；殘留的競態見檔頭說明，已知且接受。 */
    const lateProblem = findLinkOnPath(repoRootAbs, presetsDirAbs);
    if (lateProblem) throw new Error('落檔前重新檢查失敗：' + lateProblem);

    fs.renameSync(tempAbs, targetAbs);
    tempAbs = null;                      // 已改名，finally 不該再刪
    return { status: 200, bytes: buf.length };
  } catch (e) {
    return { status: 500, error: '寫入失敗，原檔未變動：' + (e && e.message || e) };
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e2) { } }
    if (tempAbs) { try { fs.unlinkSync(tempAbs); } catch (e2) { } }
  }
}

/* parse → validate → canonical serialise → write。
   任何一步失敗都直接回傳，磁碟上的原檔一個 byte 都不會動。 */
function savePresetText(ctx, presetId, bodyText) {
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (e) {
    return { status: 400, error: 'JSON 解析失敗：' + (e && e.message || e) };
  }

  const check = VFXCore.validatePreset(parsed);
  if (!check.ok) {
    return { status: 400, error: 'Preset 不合法，未寫入', problems: check.errors };
  }
  /* 檔名與 preset.id 必須一致：Editor 是用 ?preset=<id> 依檔名載入的，
     兩者一旦分家，存進去的檔案下次就載不回同一份東西。 */
  if (parsed.id !== presetId) {
    return {
      status: 400,
      error: 'preset.id（' + parsed.id + '）與檔名（' + presetId + '）不一致，未寫入'
    };
  }

  let text;
  try {
    text = VFXCore.serialisePreset(parsed);
  } catch (e) {
    return { status: 500, error: '序列化失敗，未寫入：' + (e && e.message || e) };
  }

  const written = writeJsonFile(ctx, PRESETS_DIR_REL, presetId, text);
  if (written.status !== 200) return written;
  return { status: 200, presetId: presetId, bytes: written.bytes };
}

/* layout 檔的存檔管線，與 preset 同形：
   parse → validate → canonical serialise → 落檔。
   驗證用的是 Editor 端載入的同一份 layout-schema.js。 */
function saveLayoutText(ctx, presetId, bodyText) {
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (e) {
    return { status: 400, error: 'JSON 解析失敗：' + (e && e.message || e) };
  }
  const check = layoutSchema.validateLayout(parsed);
  if (!check.ok) {
    return { status: 400, error: 'layout 不合法，未寫入', problems: check.errors };
  }
  if (parsed.presetId !== presetId) {
    return {
      status: 400,
      error: 'layout.presetId（' + parsed.presetId + '）與檔名（' + presetId + '）不一致，未寫入'
    };
  }
  let text;
  try {
    text = layoutSchema.serialiseLayout(parsed);
  } catch (e) {
    return { status: 500, error: '序列化失敗，未寫入：' + (e && e.message || e) };
  }
  const written = writeJsonFile(ctx, LAYOUTS_DIR_REL, presetId, text);
  if (written.status !== 200) return written;
  return { status: 200, presetId: presetId, bytes: written.bytes };
}

/* ---- 寫入面的來源檢查 ---- */

function isLoopbackAddress(addr) {
  if (!addr) return false;
  const a = String(addr).replace(/^::ffff:/, '');
  return a === '::1' || /^127\.\d+\.\d+\.\d+$/.test(a);
}

function hostOnly(value) {
  let h = String(value || '');
  if (h.charAt(0) === '[') {                       // [::1]:28361
    const end = h.indexOf(']');
    return end < 0 ? '' : h.slice(1, end).toLowerCase();
  }
  const colon = h.indexOf(':');
  if (colon >= 0) h = h.slice(0, colon);
  return h.toLowerCase();
}

function isLoopbackHost(value) {
  const h = hostOnly(value);
  return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/* 伺服器只 listen 127.0.0.1，但「只有本機連得到」不等於「只有本機的人指使」：
   使用者瀏覽器上任何一個分頁都能對 localhost 發請求，DNS rebinding 還能讓
   evil.com 解析到 127.0.0.1。所以寫入面另外要求：
     - 連線本身來自 loopback
     - Host 是 loopback 名稱（擋掉 rebinding：那時 Host 會是 evil.com）
     - 有 Origin 的話必須也是 loopback
     - Content-Type 必須是 application/json（跨來源時會被迫先送 preflight，
       而本伺服器不回任何 CORS 標頭，preflight 直接失敗）
   四道都是常數比對，沒有一道依賴對請求內容的「清理」。 */
function checkWriteOrigin(req) {
  if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
    return '寫入 API 只接受本機連線';
  }
  if (!isLoopbackHost(req.headers.host)) {
    return '寫入 API 只接受 loopback Host，收到：' + (req.headers.host || '(無)');
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== '') {
    /* 'null' 也要擋。它是 sandboxed iframe、data: 與 file: 頁面送出的 Origin，
       也就是「有來源，而且不是本機 Editor」，不是「沒有來源」。 */
    let originHost;
    try { originHost = new URL(origin).hostname; } catch (e) {
      return '寫入 API 拒絕無法解析的 Origin：' + origin;
    }
    if (!isLoopbackHost(originHost)) return '寫入 API 拒絕跨來源 Origin：' + origin;
  }
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    return 'Content-Type 必須是 application/json，收到：' + (type || '(無)');
  }
  return null;
}

function handleSaveRequest(ctx, req, res, presetId, kind) {
  const originProblem = checkWriteOrigin(req);
  if (originProblem) return sendJson(res, 403, { ok: false, error: originProblem });

  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', function (chunk) {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_SAVE_BODY_BYTES) {
      aborted = true;
      chunks.length = 0;                       // 已經確定不寫了，先把記憶體放掉
      sendJson(res, 413, {
        ok: false,
        error: 'Preset 內容超過上限 ' + MAX_SAVE_BODY_BYTES + ' bytes，未寫入'
      });
      /* 用 resume() 把剩下的 body 丟掉而不是 destroy()：
         直接砍連線的話，剛寫出去的 413 有機會還沒送到對方就一起沒了，
         Editor 就只會看到「連線中斷」而不是真正的原因。
         resume 不會再累積任何 bytes，記憶體仍然有界。 */
      req.resume();
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', function () { aborted = true; });
  req.on('end', function () {
    if (aborted) return;
    let result;
    try {
      const body = Buffer.concat(chunks).toString('utf8');
      result = kind === 'layout'
        ? saveLayoutText(ctx, presetId, body)
        : savePresetText(ctx, presetId, body);
    } catch (e) {
      result = { status: 500, error: '存檔時發生未預期錯誤：' + (e && e.message || e) };
    }
    if (result.status === 200) {
      return sendJson(res, 200, { ok: true, presetId: result.presetId, bytes: result.bytes });
    }
    sendJson(res, result.status,
      { ok: false, error: result.error, problems: result.problems || [] });
  });
}

/* ============================================================
   伺服器
   ============================================================ */

function createServer(ctx) {
  return http.createServer(function (req, res) {
    const rawPathname = rawPathnameOf(req.url);

    /* 寫入路由必須在 decodeURIComponent 之前分支，理由見 presetIdFromRawPath。 */
    if (req.method === 'PUT') {
      /* 兩條寫入路由，各自綁死一個目的地常數。
         id 一律取自未解碼的 pathname，理由見 presetIdFromRawPath。 */
      const presetId = idFromRawPath(rawPathname, SAVE_PREFIX);
      if (presetId) return handleSaveRequest(ctx, req, res, presetId, 'preset');
      const layoutId = idFromRawPath(rawPathname, LAYOUT_PREFIX);
      if (layoutId) return handleSaveRequest(ctx, req, res, layoutId, 'layout');
      return sendJson(res, 400, {
        ok: false,
        error: '只接受 PUT ' + SAVE_PREFIX + ' 或 ' + LAYOUT_PREFIX +
          ' 底下的 <id>' + SAVE_SUFFIX + '，id 僅限小寫英數與連字號'
      });
    }
    if (req.method !== 'GET') {
      return send(res, 405, '不支援的方法：' + req.method);
    }

    let pathname;
    try {
      pathname = decodeURIComponent(rawPathname);
    } catch (e) {
      return send(res, 400, 'Bad URL');
    }

    /* 身分端點：回報「我是哪一份工作副本的 VFX Editor」。
       五份 worktree（claude／codex／antigravity／develop／production）跑的是
       同一支伺服器與同一個連接埠範圍，只問「這個埠有沒有人回應」的話，
       從 claude 按下啟動卻開到 develop 的 Editor，改了半天才發現改錯副本。
       啟動器用這個端點確認身分，所以必須含 repo 路徑，不能只回專案名稱。 */
    if (pathname === WHOAMI_PATH) {
      return send(res, 200, WHOAMI_MARK + ' ' + path.resolve(ctx.repoRoot) + '\n');
    }

    if (pathname === '/') pathname = '/tools/vfx/editor/index.html';

    if (pathname.indexOf(ASSET_PREFIX) === 0) {
      const rest = pathname.slice(ASSET_PREFIX.length);
      const slash = rest.indexOf('/');
      if (slash < 0) return send(res, 400, '缺少 libraryId');
      const libraryId = rest.slice(0, slash);
      const relative = rest.slice(slash + 1);
      const root = ctx.assetRoots[libraryId];
      if (!root) return send(res, 404, '未設定的 libraryId：' + libraryId);
      const target = safeJoin(root, relative);
      if (!target) return send(res, 403, '路徑不合法');
      return serveFile(res, target, pathname);
    }

    /* 只服務 Editor 真正需要的目錄。整個 repo 都開出去的話，
       .git、.claude 與各種規則文件都會被這台本機伺服器讀得到。 */
    if (!REPO_ALLOWLIST.some(function (prefix) { return pathname.indexOf(prefix) === 0; })) {
      return send(res, 403, '不在允許的目錄內：' + pathname);
    }
    if (pathname.split('/').some(function (seg) { return seg.charAt(0) === '.'; })) {
      return send(res, 403, '不提供以 . 開頭的檔案或目錄');
    }
    const target = safeJoin(ctx.repoRoot, pathname);
    if (!target) return send(res, 403, '路徑不合法');
    serveFile(res, target, pathname);
  });
}

function start(assetRoots, port) {
  /* 正式啟動時 repoRoot 一律是常數 REPO_ROOT，沒有任何參數能改。 */
  const server = createServer({ repoRoot: REPO_ROOT, assetRoots: assetRoots });

  server.on('error', function (err) {
    if (err.code === 'EADDRINUSE' && port - PORT_BASE < PORT_TRIES - 1) {
      return start(assetRoots, port + 1);
    }
    console.error('[ERROR] 伺服器啟動失敗：' + err.message);
    process.exit(2);
  });

  // 只聽 loopback：這是本機開發工具，沒有理由讓區網上的機器讀到整個 repo
  server.listen(port, '127.0.0.1', function () {
    console.log('VFX Editor 伺服器已啟動');
    console.log('  http://localhost:' + port + '/tools/vfx/editor/index.html');
    Object.keys(assetRoots).forEach(function (id) {
      console.log('  素材庫 ' + id + ' → ' + ASSET_PREFIX + id + '/  (' + assetRoots[id] + ')');
    });
    console.log('  存檔 API：PUT ' + SAVE_PREFIX + '<presetId>' + SAVE_SUFFIX +
      ' → ' + path.join(REPO_ROOT, PRESETS_DIR_REL));
    console.log('  身分     ：' + WHOAMI_PATH + ' → ' + WHOAMI_MARK + ' ' + REPO_ROOT);
    console.log('  Ctrl+C 結束');
  });
  return server;
}

function main() {
  const argv = process.argv.slice(2);
  let port = PORT_BASE;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') port = Number(argv[++i]);
    else { console.error('[ERROR] 未知參數：' + argv[i]); process.exit(2); }
  }

  const indexPath = path.join(REPO_ROOT, 'vfx', 'asset-index.json');
  if (!fs.existsSync(indexPath)) {
    console.error('[ERROR] 找不到 vfx/asset-index.json，請先執行 tools/vfx/asset-scanner.cjs');
    process.exit(2);
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  let resolved;
  try {
    resolved = libraryRoot.resolveLibraryRoot({ libraryId: index.libraryId });
  } catch (e) {
    console.error('\n[ERROR] ' + e.message);
    if (e.hint) console.error('        ' + e.hint);
    process.exit(2);
  }
  const assetRoots = {};
  assetRoots[resolved.libraryId] = resolved.root;
  start(assetRoots, port);
}

if (require.main === module) main();
else module.exports = {
  start: start,
  safeJoin: safeJoin,
  ASSET_PREFIX: ASSET_PREFIX,
  SAVE_PREFIX: SAVE_PREFIX,
  TEMP_PREFIX: TEMP_PREFIX,
  presetIdFromRawPath: presetIdFromRawPath,
  /* 測試專用縫隙：唯一能換掉 repoRoot、唯一能注入失敗 hook 的入口。
     正式路徑（main → start）不經過這裡，也沒有任何 CLI 參數能到達。 */
  LAYOUT_PREFIX: LAYOUT_PREFIX,
  __testOnly: {
    createServer: createServer,
    savePresetText: savePresetText,
    saveLayoutText: saveLayoutText,
    idFromRawPath: idFromRawPath,
    WRITABLE_DIRS: WRITABLE_DIRS
  }
};
