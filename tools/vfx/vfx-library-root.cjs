'use strict';
/* ============================================================
   vfx-library-root.cjs — Asset Library Root 解析（VFX 專用，共用模組）

   素材庫在不同電腦上的位置不同，因此「絕對路徑」只存在於本機設定，
   絕不進入 Git、asset-index、Preset 或任何程式碼。
   Scanner 與未來的 VFX Editor 共用本模組，設定來源只有一處。

   解析順序（先找到先用）：
     1. 呼叫端明確指定（Scanner 的 --root）
     2. 環境變數 VFX_ASSET_ROOT_<LIBRARY_ID>   例：VFX_ASSET_ROOT_EFFECTS_MATERIALS
     3. 環境變數 VFX_ASSET_LIBRARY_ROOT        （只作用於預設 library）
     4. 本機設定檔 vfx/library.local.json      （不進 Git）

   設定檔格式：
     {
       "defaultLibraryId": "effects-materials",
       "roots": { "effects-materials": "D:/MyGame/effects-materials" }
     }
   ============================================================ */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LOCAL_CONFIG_REL = 'vfx/library.local.json';
const LOCAL_CONFIG_PATH = path.join(REPO_ROOT, 'vfx', 'library.local.json');
const EXAMPLE_CONFIG_REL = 'vfx/library.local.example.json';

class LibraryRootError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'LibraryRootError';
    this.hint = hint || '';
  }
}

/* libraryId 的合法格式：小寫英數起頭，其後只允許小寫英數與連字號。
   限制成這樣才能保證 libraryId → 環境變數名稱是一對一的：
   若同時允許 `-`、`_` 與空白，a-b／a_b／a b 會映射到同一個環境變數名稱，
   多素材庫時可能解析到錯誤的 Root。 */
const LIBRARY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function assertValidLibraryId(libraryId) {
  if (typeof libraryId !== 'string' || !LIBRARY_ID_PATTERN.test(libraryId)) {
    throw new LibraryRootError(
      "libraryId '" + libraryId + "' 格式不合法。",
      '只允許小寫英數與連字號，且須以英數開頭（例：effects-materials）。');
  }
}

/* libraryId → 環境變數名稱：effects-materials → VFX_ASSET_ROOT_EFFECTS_MATERIALS */
function envVarNameFor(libraryId) {
  assertValidLibraryId(libraryId);
  return 'VFX_ASSET_ROOT_' + libraryId.replace(/-/g, '_').toUpperCase();
}

function readLocalConfig() {
  if (!fs.existsSync(LOCAL_CONFIG_PATH)) return null;
  let text;
  try {
    text = fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8');
  } catch (e) {
    throw new LibraryRootError('無法讀取本機設定 ' + LOCAL_CONFIG_REL + '：' + e.message);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new LibraryRootError(LOCAL_CONFIG_REL + ' 不是合法 JSON：' + e.message,
      '請對照 ' + EXAMPLE_CONFIG_REL + ' 修正。');
  }
}

function setupHint(libraryId) {
  let envName = 'VFX_ASSET_ROOT_<LIBRARY_ID>';
  try { if (libraryId) envName = envVarNameFor(libraryId); } catch (e) { /* 格式不合法時用通式 */ }
  return [
    '設定方式（擇一）：',
    '  1. 複製 ' + EXAMPLE_CONFIG_REL + ' 為 ' + LOCAL_CONFIG_REL + ' 並填入本機素材庫路徑',
    '  2. 設定環境變數 ' + envName,
    '  3. 執行 Scanner 時加上 --root <素材庫路徑>',
    LOCAL_CONFIG_REL + ' 不進版控，換電腦只需要重新指定 Root。'
  ].join('\n        ');
}

/* 解析出 { libraryId, root, source }；找不到或路徑無效時丟出 LibraryRootError */
function resolveLibraryRoot(options) {
  const opts = options || {};
  // 呼叫端已完整指定時，完全不碰本機設定檔：
  // 否則設定檔損毀會讓明確指定 --root --library 的執行也一起失敗。
  if (opts.root && typeof opts.libraryId === 'string') {
    assertValidLibraryId(opts.libraryId);
    return validateRoot(opts.libraryId, opts.root, '--root 參數');
  }
  const config = readLocalConfig();
  const libraryId = opts.libraryId ||
    (config && config.defaultLibraryId) ||
    (config && config.roots && Object.keys(config.roots).length === 1
      ? Object.keys(config.roots)[0]
      : null);

  if (!libraryId) {
    throw new LibraryRootError(
      '未指定 libraryId，且本機設定沒有可推定的預設值。',
      setupHint(null));
  }
  assertValidLibraryId(libraryId);

  let root = null;
  let source = null;
  if (opts.root) {
    root = opts.root;
    source = '--root 參數';
  }
  if (!root && process.env[envVarNameFor(libraryId)]) {
    root = process.env[envVarNameFor(libraryId)];
    source = '環境變數 ' + envVarNameFor(libraryId);
  }
  if (!root && process.env.VFX_ASSET_LIBRARY_ROOT &&
      (!config || !config.defaultLibraryId || config.defaultLibraryId === libraryId)) {
    root = process.env.VFX_ASSET_LIBRARY_ROOT;
    source = '環境變數 VFX_ASSET_LIBRARY_ROOT';
  }
  if (!root && config && config.roots && config.roots[libraryId]) {
    root = config.roots[libraryId];
    source = LOCAL_CONFIG_REL;
  }

  if (!root) {
    throw new LibraryRootError(
      "找不到 library '" + libraryId + "' 的 Asset Library Root。",
      setupHint(libraryId));
  }

  return validateRoot(libraryId, root, source);
}

function validateRoot(libraryId, root, source) {
  const absolute = path.resolve(root);
  if (!fs.existsSync(absolute)) {
    throw new LibraryRootError(
      "library '" + libraryId + "' 的 Root 不存在：" + absolute + '（來源：' + source + '）',
      setupHint(libraryId));
  }
  if (!fs.statSync(absolute).isDirectory()) {
    throw new LibraryRootError(
      "library '" + libraryId + "' 的 Root 不是目錄：" + absolute + '（來源：' + source + '）',
      setupHint(libraryId));
  }
  return { libraryId: libraryId, root: absolute, source: source };
}

module.exports = {
  resolveLibraryRoot: resolveLibraryRoot,
  envVarNameFor: envVarNameFor,
  assertValidLibraryId: assertValidLibraryId,
  LibraryRootError: LibraryRootError,
  REPO_ROOT: REPO_ROOT,
  LOCAL_CONFIG_PATH: LOCAL_CONFIG_PATH,
  LOCAL_CONFIG_REL: LOCAL_CONFIG_REL,
  EXAMPLE_CONFIG_REL: EXAMPLE_CONFIG_REL
};
