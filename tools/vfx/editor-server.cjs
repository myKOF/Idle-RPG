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

   用法：
     node tools/vfx/editor-server.cjs            預設埠 28361 起往上找
     node tools/vfx/editor-server.cjs --port 8080
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const libraryRoot = require('./vfx-library-root.cjs');

const REPO_ROOT = libraryRoot.REPO_ROOT;
const ASSET_PREFIX = '/asset-library/';
/* Editor 只需要這幾個目錄；其餘 repo 內容一律不對外 */
const REPO_ALLOWLIST = ['/tools/vfx/editor/', '/js/', '/vfx/'];
const PORT_BASE = 28361;
const PORT_TRIES = 10;

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

function serveFile(res, filePath) {
  fs.stat(filePath, function (err, stat) {
    if (err || !stat.isFile()) return send(res, 404, 'Not found: ' + filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function start(assetRoots, port) {
  const server = http.createServer(function (req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(url.parse(req.url).pathname);
    } catch (e) {
      return send(res, 400, 'Bad URL');
    }
    if (pathname === '/') pathname = '/tools/vfx/editor/index.html';

    if (pathname.indexOf(ASSET_PREFIX) === 0) {
      const rest = pathname.slice(ASSET_PREFIX.length);
      const slash = rest.indexOf('/');
      if (slash < 0) return send(res, 400, '缺少 libraryId');
      const libraryId = rest.slice(0, slash);
      const relative = rest.slice(slash + 1);
      const root = assetRoots[libraryId];
      if (!root) return send(res, 404, '未設定的 libraryId：' + libraryId);
      const target = safeJoin(root, relative);
      if (!target) return send(res, 403, '路徑不合法');
      return serveFile(res, target);
    }

    /* 只服務 Editor 真正需要的目錄。整個 repo 都開出去的話，
       .git、.claude 與各種規則文件都會被這台本機伺服器讀得到。 */
    if (!REPO_ALLOWLIST.some(function (prefix) { return pathname.indexOf(prefix) === 0; })) {
      return send(res, 403, '不在允許的目錄內：' + pathname);
    }
    if (pathname.split('/').some(function (seg) { return seg.charAt(0) === '.'; })) {
      return send(res, 403, '不提供以 . 開頭的檔案或目錄');
    }
    const target = safeJoin(REPO_ROOT, pathname);
    if (!target) return send(res, 403, '路徑不合法');
    serveFile(res, target);
  });

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
else module.exports = { start: start, safeJoin: safeJoin, ASSET_PREFIX: ASSET_PREFIX };
