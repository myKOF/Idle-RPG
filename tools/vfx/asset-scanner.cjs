'use strict';
/* ============================================================
   asset-scanner.cjs — VFX Asset Scanner v1（事實層）

   掃描 Asset Library Root，產生可移植的 asset-index.json。

   v1 只產生「客觀事實」：檔案事實 ＋ 像素量測。
   不做語意判斷（不猜 fire／smoke／spark／recommendedUsage），
   那些欄位屬於後續的 AI 標註階段。

   用法：
     node tools/vfx/asset-scanner.cjs                    掃描並寫入 vfx/asset-index.json
     node tools/vfx/asset-scanner.cjs --check            只比對，不寫入（不同則 exit 1）
     node tools/vfx/asset-scanner.cjs --root <path>      指定素材庫（覆蓋本機設定）
     node tools/vfx/asset-scanner.cjs --library <id>     指定 libraryId
     node tools/vfx/asset-scanner.cjs --out <path>       指定輸出位置
     node tools/vfx/asset-scanner.cjs --quiet            不印進度

   Exit code：
     0 成功（--check 時代表與現有 index 相同）
     1 索引內容與現有檔案不同（僅 --check）
     2 前置條件失敗（找不到 Root、assetId 衝突、可移植性檢查失敗）
   ============================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const imageFacts = require('./vfx-image-facts.cjs');
const libraryRoot = require('./vfx-library-root.cjs');

const SCANNER_VERSION = '1.0.0';
const SCHEMA_VERSION = 1;
const DEFAULT_OUT_REL = 'vfx/asset-index.json';

/* 永遠排除的目錄名稱。素材庫本身可能是 Git repo（本專案的素材庫就是），
   不排除的話 .git 底下上千個檔案會灌爆索引。 */
const ALWAYS_EXCLUDED_DIRS = new Set(['.git']);
/* 以底線開頭的目錄一律不掃進索引。這是 VFX_ASSET_LIBRARY_DESIGN §8.5 的
   `_inbox` 慣例能成立的前提，同時也讓「存在但不可使用」的區域有地方放：
     _inbox/        還沒分類的新素材
     _restricted/   商標／不適用內容，保留可追溯但絕不可進遊戲
     _excluded/     人工判定不收的素材
     _thumbnails/   套件附的預覽縮圖，不是素材本身
   這些目錄裡的檔案不會有 assetId，因此 Preset 引用不到、export 也帶不走。 */
function isExcludedDir(name) {
  return ALWAYS_EXCLUDED_DIRS.has(name) || name.charAt(0) === '_';
}

/* 支援的素材格式。要新增格式只需擴充這張表，不必改流程。 */
const SUPPORTED_FORMATS = {
  '.png': { format: 'png', facts: function (buf) { return imageFacts.pngFacts(buf); } },
  '.svg': { format: 'svg', facts: function (buf) { return imageFacts.svgFacts(buf); } }
};

const EXIT = { OK: 0, DIFFERENT: 1, PRECONDITION: 2 };

/* ---------------- assetId ----------------
   規則：<package>/<package 內的相對路徑>，全部小寫並 slug 化。
   - 不含絕對路徑、不含掃描順序、換電腦一致、重跑一致
   - 保留副檔名：同目錄下 foo.png 與 foo.svg 不會相撞
   - 產生後檢查重複，撞到就直接失敗，不靜默改名 */
function slugSegment(segment) {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function makeAssetId(relativePath) {
  return relativePath.split('/').map(slugSegment).filter(Boolean).join('/');
}

/* package：相對路徑的第一段目錄。從目錄結構推導，不硬編任何套件名稱，
   未來新增 OtherVendor/ 或 MyOwnVFX/ 不需要改程式。 */
function derivePackage(relativePath) {
  const parts = relativePath.split('/');
  return parts.length > 1 ? parts[0] : '_root';
}

/* ---------------- 掃描 ---------------- */

function walk(dir, root, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  // 依名稱排序，讓遍歷順序與檔案系統回傳順序無關（決定性的一環）
  entries.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isExcludedDir(entry.name)) continue;
      walk(full, root, out);
    } else if (entry.isFile()) {
      out.push({
        absolutePath: full,
        relativePath: path.relative(root, full).split(path.sep).join('/')
      });
    }
  }
}

function scanLibrary(root, options) {
  const opts = options || {};
  const files = [];
  walk(root, root, files);

  const assets = [];
  const skipped = {};
  const failures = [];
  let processed = 0;

  for (const file of files) {
    const ext = path.extname(file.relativePath).toLowerCase();
    const handler = SUPPORTED_FORMATS[ext];
    if (!handler) {
      skipped[ext || '(no extension)'] = (skipped[ext || '(no extension)'] || 0) + 1;
      continue;
    }
    let buf;
    try {
      buf = fs.readFileSync(file.absolutePath);
    } catch (e) {
      failures.push({ relativePath: file.relativePath, error: '讀取失敗：' + e.message });
      continue;
    }
    let facts;
    try {
      facts = handler.facts(buf);
    } catch (e) {
      // 解析失敗不中斷整批掃描，但也不寫入半套資料
      failures.push({ relativePath: file.relativePath, error: e.message });
      continue;
    }
    assets.push({
      assetId: makeAssetId(file.relativePath),
      package: derivePackage(file.relativePath),
      relativePath: file.relativePath,
      format: handler.format,
      fileSize: buf.length,
      contentHash: 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex'),
      facts: facts
    });
    processed++;
    if (!opts.quiet && processed % 100 === 0) {
      process.stdout.write('  已處理 ' + processed + ' / ' + files.length + ' …\n');
    }
  }

  assets.sort(function (a, b) {
    return a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0;
  });

  return { assets: assets, skipped: skipped, failures: failures, fileCount: files.length };
}

/* ---------------- 檢查 ---------------- */

function assertNoDuplicateIds(assets) {
  const seen = new Map();
  const clashes = [];
  for (const asset of assets) {
    if (seen.has(asset.assetId)) {
      clashes.push(asset.assetId + '\n      ← ' + seen.get(asset.assetId) + '\n      ← ' + asset.relativePath);
    } else {
      seen.set(asset.assetId, asset.relativePath);
    }
  }
  return clashes;
}

/* 可移植性：索引內不得出現絕對路徑、磁碟機代號、反斜線或使用者名稱。
   這是把「換電腦不會失效」變成可執行檢查，而不只是文件上的約定。 */
function findNonPortableValues(node, trail, root) {
  const problems = [];
  const rootLower = root.split(path.sep).join('/').toLowerCase();
  (function visit(value, pathTrail) {
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (/^[a-z]:[\\/]/i.test(value)) problems.push(pathTrail + '：含磁碟機代號 → ' + value);
      else if (value.indexOf('\\') >= 0) problems.push(pathTrail + '：含反斜線 → ' + value);
      else if (value.startsWith('/')) problems.push(pathTrail + '：以 / 開頭的絕對路徑 → ' + value);
      else if (rootLower && lower.indexOf(rootLower) >= 0) problems.push(pathTrail + '：含素材庫絕對路徑 → ' + value);
    } else if (Array.isArray(value)) {
      value.forEach(function (v, i) { visit(v, pathTrail + '[' + i + ']'); });
    } else if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (k) { visit(value[k], pathTrail ? pathTrail + '.' + k : k); });
    }
  })(node, trail || '');
  return problems;
}

/* ---------------- 輸出 ---------------- */

function buildIndex(libraryId, scan) {
  // 刻意不含掃描時間：同樣的素材庫內容必須產生位元相同的檔案
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'vfx-asset-index',
    libraryId: libraryId,
    scanner: { name: 'asset-scanner', version: SCANNER_VERSION },
    assetCount: scan.assets.length,
    assets: scan.assets
  };
}

function serialise(index) {
  return JSON.stringify(index, null, 2) + '\n';
}

function parseArgs(argv) {
  const args = { quiet: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quiet') args.quiet = true;
    else if (a === '--check') args.check = true;
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--library') args.libraryId = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error('未知參數：' + a);
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error('[ERROR] ' + e.message);
    process.exit(EXIT.PRECONDITION);
  }
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('用法：')[1].split('*/')[0].trim());
    process.exit(EXIT.OK);
  }

  let resolved;
  try {
    resolved = libraryRoot.resolveLibraryRoot({ root: args.root, libraryId: args.libraryId });
  } catch (e) {
    console.error('\n[ERROR] ' + e.message);
    if (e.hint) console.error('        ' + e.hint);
    process.exit(EXIT.PRECONDITION);
  }

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(libraryRoot.REPO_ROOT, DEFAULT_OUT_REL);

  if (!args.quiet) {
    console.log('VFX Asset Scanner v' + SCANNER_VERSION);
    console.log('  library : ' + resolved.libraryId + '（Root 來源：' + resolved.source + '）');
    console.log('  輸出    : ' + path.relative(libraryRoot.REPO_ROOT, outPath).split(path.sep).join('/'));
    console.log('  掃描中…');
  }

  let scan;
  try {
    scan = scanLibrary(resolved.root, { quiet: args.quiet });
  } catch (e) {
    // exit 1 只保留給 --check 的「內容不同」，其餘一律 exit 2
    console.error('\n[ERROR] 掃描素材庫失敗：' + e.message);
    console.error('        Root：' + resolved.root);
    process.exit(EXIT.PRECONDITION);
  }

  const clashes = assertNoDuplicateIds(scan.assets);
  if (clashes.length) {
    console.error('\n[ERROR] assetId 重複，索引不會產生：');
    clashes.forEach(function (c) { console.error('  - ' + c); });
    process.exit(EXIT.PRECONDITION);
  }

  // 解析失敗必須是硬錯誤：否則素材會從索引裡靜默消失，而 Scanner 仍回報成功，
  // 之後 --check 還會把這份殘缺索引當成正確答案。
  if (scan.failures.length) {
    console.error('\n[ERROR] ' + scan.failures.length + ' 個素材無法解析，索引不會產生：');
    scan.failures.slice(0, 20).forEach(function (f) {
      console.error('  - ' + f.relativePath + ' → ' + f.error);
    });
    if (scan.failures.length > 20) console.error('  …另有 ' + (scan.failures.length - 20) + ' 筆');
    console.error('  請修復或移除這些檔案後重跑；不要在索引不完整的情況下繼續。');
    process.exit(EXIT.PRECONDITION);
  }

  const index = buildIndex(resolved.libraryId, scan);
  const problems = findNonPortableValues(index, '', resolved.root);
  if (problems.length) {
    console.error('\n[ERROR] 索引含不可移植的值，拒絕寫出：');
    problems.slice(0, 20).forEach(function (p) { console.error('  - ' + p); });
    process.exit(EXIT.PRECONDITION);
  }

  const text = serialise(index);

  if (!args.quiet) {
    console.log('\n  檔案總數（不含 .git）: ' + scan.fileCount);
    console.log('  已索引素材            : ' + scan.assets.length);
    const skippedKeys = Object.keys(scan.skipped).sort();
    if (skippedKeys.length) {
      console.log('  未支援而略過          : ' +
        skippedKeys.map(function (k) { return k + '×' + scan.skipped[k]; }).join('、'));
    }
  }

  if (args.check) {
    if (!fs.existsSync(outPath)) {
      console.error('\n[ERROR] --check：找不到現有索引 ' + outPath);
      process.exit(EXIT.DIFFERENT);
    }
    const existing = fs.readFileSync(outPath, 'utf8');
    if (existing === text) {
      if (!args.quiet) console.log('\n--check：與現有索引完全相同。');
      process.exit(EXIT.OK);
    }
    console.error('\n[ERROR] --check：索引內容與現有檔案不同（' +
      existing.length + ' → ' + text.length + ' bytes）。');
    process.exit(EXIT.DIFFERENT);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text, 'utf8');
  if (!args.quiet) console.log('\n已寫入 ' + text.length + ' bytes。');
  process.exit(EXIT.OK);
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    scanLibrary: scanLibrary,
    buildIndex: buildIndex,
    serialise: serialise,
    makeAssetId: makeAssetId,
    derivePackage: derivePackage,
    slugSegment: slugSegment,
    assertNoDuplicateIds: assertNoDuplicateIds,
    findNonPortableValues: findNonPortableValues,
    ALWAYS_EXCLUDED_DIRS: ALWAYS_EXCLUDED_DIRS,
    SUPPORTED_FORMATS: SUPPORTED_FORMATS,
    SCHEMA_VERSION: SCHEMA_VERSION,
    SCANNER_VERSION: SCANNER_VERSION,
    DEFAULT_OUT_REL: DEFAULT_OUT_REL
  };
}
