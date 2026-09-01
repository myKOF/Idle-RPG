'use strict';
/* ============================================================
   review-with-codex.cjs — VFX 專用 Codex Reviewer 呼叫工具

   用途（僅限 VFX 工程，見 docs/vfx/VFX_AGENT_WORKFLOW.md 第 1 節）：
     以唯讀模式呼叫本機 Codex CLI，對指定的 VFX 範圍做 Code / Architecture Review，
     並在 Review 前後比對工作樹狀態，確認 Codex 確實沒有修改任何檔案。

   兩種模式共用同一套唯讀保護與 Codex 呼叫路徑，只有 Prompt 不同：
     full              完整 Review，主動找問題，輸出 CRITICAL/MAJOR/MINOR/RECOMMENDATIONS
     fix-verification  限縮驗證，只判定「已知的 CRITICAL 修好了沒有」，
                       禁止找新問題，輸出 PASS/FAIL

   用法：
     node tools/vfx/review-with-codex.cjs "<review scope>"
     node tools/vfx/review-with-codex.cjs                       → scope 預設 "current VFX changes"
     node tools/vfx/review-with-codex.cjs "<scope>" --dry-run    → 只印出 Prompt，不呼叫 Codex
     node tools/vfx/review-with-codex.cjs "<scope>" --mode fix-verification --brief <檔案>

   --brief 指向一份「本次要驗證什麼」的說明檔（原始 CRITICAL、修正位置、
   對應測試、必須維持的 invariant）。這份內容每次都不同，因此由呼叫端提供，
   工具只負責把它包進固定的限縮框架裡。

   環境變數：
     CODEX_BIN                 指定 codex 執行檔或 bin/codex.js 路徑（PATH 找不到時使用）
     CODEX_REVIEW_MODEL        指定 Review 使用的模型（預設沿用 Codex 自身設定）
     CODEX_REVIEW_TIMEOUT_MS   逾時毫秒數（預設 900000＝15 分鐘）

   Exit code：
     0 Review 完成且工作樹未被改動
     1 Codex 執行失敗
     2 前置條件失敗（規範文件不存在／找不到 Codex CLI／非 Git 工作區）
     3 唯讀違規：Review 前後工作樹狀態不一致
   ============================================================ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW_DOC_REL = 'docs/vfx/VFX_AGENT_WORKFLOW.md';
const WORKFLOW_DOC = path.join(ROOT, WORKFLOW_DOC_REL);
const DEFAULT_SCOPE = 'current VFX changes';
const MODES = ['full', 'fix-verification'];
const DEFAULT_MODE = 'full';
const MAX_DOC_CHARS = 12000;          // 規範全文超過此長度才改用重點節錄，避免 Prompt 膨脹
const DEFAULT_TIMEOUT_MS = 900000;

const EXIT = { OK: 0, CODEX_FAILED: 1, PRECONDITION: 2, READONLY_VIOLATION: 3 };

/* ---------------- 小工具 ---------------- */

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function line(ch) {
  return (ch || '=').repeat(64);
}

function fail(code, message, hint) {
  console.error('\n[ERROR] ' + message);
  if (hint) console.error('        ' + hint);
  process.exit(code);
}

/* ---------------- Git ---------------- */

function git(args, opts) {
  const allowFailure = !!(opts && opts.allowFailure);
  const r = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    // 唯讀驗證本身不得寫入 Git state：停用 optional locks，避免 status 順手刷新 .git/index
    env: Object.assign({}, process.env, { GIT_OPTIONAL_LOCKS: '0' })
  });
  if (r.error) {
    if (allowFailure) return null;
    fail(EXIT.PRECONDITION, '無法執行 git：' + r.error.message);
  }
  if (r.status !== 0) {
    if (allowFailure) return null;
    fail(EXIT.PRECONDITION,
      'git ' + args.join(' ') + ' 失敗（exit ' + r.status + '）',
      (r.stderr || '').trim());
  }
  return r.stdout;
}

/* 工作樹快照。
   只比較「Review 前後是否新增變化」，不要求工作樹乾淨——Review 前本來就可能有未提交的 VFX 工作。
   除了 status 字串，另外存 diff 雜湊與未追蹤檔內容雜湊：
   若某檔案 Review 前已是 ' M'，Codex 再改一次時 status 字串不會變，只有內容雜湊抓得到。 */
function untrackedPaths() {
  // -z：NUL 分隔且不做 quoting，含空白／非 ASCII 的檔名才不會被誤剖。
  const raw = git(['status', '--porcelain', '-z', '--untracked-files=all'], { allowFailure: true }) || '';
  const fields = raw.split('\0').filter(function (s) { return s.length > 0; });
  const out = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    const x = entry.charAt(0);
    const y = entry.charAt(1);
    if (x === 'R' || x === 'C') i++;          // 改名／複製：下一欄是來源路徑
    if (x === '?' && y === '?') out.push(entry.slice(3));
  }
  return out;
}

function snapshotWorktree() {
  const branch = (git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true }) || '(unknown)').trim();
  const head = (git(['rev-parse', 'HEAD'], { allowFailure: true }) || '(unknown)').trim();
  const statusText = git(['status', '--short', '--untracked-files=all']) || '';
  // --binary：二進位檔（PNG 貼圖、圖集）的實際內容才會進 diff，否則只會看到一行 "Binary files differ"
  const diffText = git(['diff', 'HEAD', '--binary'], { allowFailure: true }) || '';

  const untracked = [];
  for (const rel of untrackedPaths()) {
    const abs = path.join(ROOT, rel);
    let digest;
    try {
      const st = fs.statSync(abs);
      // 以 Buffer 雜湊：用 utf8 讀二進位檔會把無效位元組換成 U+FFFD，不同內容可能雜湊相同
      digest = st.isFile()
        ? crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')
        : '(dir)';
    } catch (e) {
      digest = '(missing)';
    }
    untracked.push(rel + ':' + digest);
  }

  return {
    branch: branch,
    head: head,
    statusText: statusText.replace(/\s+$/, ''),
    diffHash: sha256(diffText),
    untrackedHash: sha256(untracked.sort().join('\n'))
  };
}

function diffSnapshots(before, after) {
  const changes = [];
  if (before.branch !== after.branch) {
    changes.push('分支被切換：' + before.branch + ' → ' + after.branch);
  }
  if (before.head !== after.head) {
    changes.push('HEAD 被移動：' + before.head.slice(0, 12) + ' → ' + after.head.slice(0, 12));
  }
  if (before.statusText !== after.statusText) {
    changes.push('git status --short 內容改變（檔案被新增、刪除或狀態改變）');
  }
  if (before.diffHash !== after.diffHash) {
    changes.push('已追蹤檔案的工作區內容改變（git diff HEAD 雜湊不同）');
  }
  if (before.untrackedHash !== after.untrackedHash) {
    changes.push('未追蹤檔案的清單或內容改變');
  }
  return changes;
}

/* ---------------- 規範文件 ---------------- */

/* 規範全文不長時整份帶入；過長才節錄 Review 最需要的節次（適用範圍／角色／分級／Worktree）。
   兩種情況都會附上檔案路徑，Codex 需要其他章節可自行唯讀開啟。 */
function loadWorkflowSpec() {
  const text = fs.readFileSync(WORKFLOW_DOC, 'utf8');
  if (text.length <= MAX_DOC_CHARS) return { text: text, condensed: false };

  const wanted = ['# 1.', '# 3.', '# 5.', '# 6.'];
  const picked = [];
  let keep = false;
  for (const l of text.split(/\r?\n/)) {
    if (/^# \d+\./.test(l)) keep = wanted.some(function (w) { return l.indexOf(w) === 0; });
    if (keep) picked.push(l);
  }
  const condensedText = picked.join('\n').slice(0, MAX_DOC_CHARS);
  if (condensedText.length < 500) return { text: text.slice(0, MAX_DOC_CHARS), condensed: true };
  return { text: condensedText, condensed: true };
}

/* ---------------- Codex CLI 解析 ----------------
   Windows 上 spawn 一個 .cmd 必須帶 shell:true，會把引號問題帶回來；
   npm 的 codex.cmd 實際只是 `node .../@openai/codex/bin/codex.js`，
   因此優先改成直接以 node 執行該 js，全程 argument array，不經過 shell。 */

function commandFromPath(p) {
  if (!p || !fs.existsSync(p)) return null;
  const ext = path.extname(p).toLowerCase();
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
    return { file: process.execPath, prefix: [p], shell: false, how: 'node ' + p };
  }
  if (ext === '.exe') {
    return { file: p, prefix: [], shell: false, how: p };
  }
  // npm shim（codex / codex.cmd / codex.bat / codex.ps1）→ 改用同層的真正進入點
  const js = path.join(path.dirname(p), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (fs.existsSync(js)) {
    return { file: process.execPath, prefix: [js], shell: false, how: 'node ' + js };
  }
  if (ext === '') {
    return { file: p, prefix: [], shell: false, how: p };            // POSIX 可執行檔／shebang 腳本
  }
  if (ext === '.cmd' || ext === '.bat') {
    return { file: p, prefix: [], shell: true, how: p + '（shell 模式）' };
  }
  return null;   // .ps1 一律不使用（規範要求不使用 PowerShell）
}

function resolveCodex() {
  const override = (process.env.CODEX_BIN || '').trim();
  if (override) {
    const c = commandFromPath(path.resolve(override));
    if (!c) fail(EXIT.PRECONDITION, 'CODEX_BIN 指定的路徑無法使用：' + override);
    return c;
  }
  const names = process.platform === 'win32'
    ? ['codex.exe', 'codex.cmd', 'codex.bat', 'codex']
    : ['codex'];
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (let i = 0; i < dirs.length; i++) {
    if (!dirs[i]) continue;
    for (let j = 0; j < names.length; j++) {
      const c = commandFromPath(path.join(dirs[i], names[j]));
      if (c) return c;
    }
  }
  return null;
}

/* ---------------- Prompt ---------------- */

/* 兩種模式共用同一份唯讀約束，不各寫一份——這段是規範的核心，
   分成兩份遲早會只改到其中一份。 */
const STRICT_RULES = [
  '# STRICT RULES (non-negotiable)',
  '- REVIEW ONLY',
  '- DO NOT MODIFY FILES',
  '- DO NOT CREATE FILES',
  '- DO NOT DELETE FILES',
  '- DO NOT RUN FORMATTING THAT MODIFIES FILES',
  '- DO NOT COMMIT',
  '- DO NOT CHANGE BRANCH',
  '- DO NOT MODIFY GIT STATE (no add / stash / checkout / reset / clean / config)',
  '',
  'You may ONLY read, analyse, review, and return suggestions.',
  'You run in a read-only sandbox, and the caller compares the worktree state before and',
  'after this run; any write is a protocol violation that fails the review.'
];

function specBlock(spec) {
  return [
    '# VFX WORKFLOW SPEC',
    '以下為 VFX 專用工作流規範（' + WORKFLOW_DOC_REL + '），Review 必須遵守。',
    spec.condensed
      ? '（為控制長度，以下為重點節錄；需要其他章節請自行唯讀開啟該檔案。）'
      : '（完整內容如下，原檔位於上述路徑。）',
    '',
    '<vfx-workflow-spec>',
    spec.text,
    '</vfx-workflow-spec>'
  ];
}

function buildPrompt(scope, spec, ctx) {
  return [
    '# ROLE',
    'You are an Independent VFX Code / Architecture Reviewer for the Idle-RPG project.',
    'You are NOT the implementer. Claude Code is the Lead Engineer and decides what to adopt.',
    ''
  ].concat(STRICT_RULES).concat(['']).concat(specBlock(spec)).concat([
    '',
    '# SCOPE OF THIS REVIEW',
    scope,
    '',
    'This tool serves VFX engineering only. If the scope above clearly falls outside the VFX',
    'scope defined in §1 of the spec (gameplay numbers, save data, general UI, economy, …),',
    'do not review it: reply that the VFX workflow does not apply, and stop.',
    '',
    '# REPOSITORY CONTEXT',
    'Repo root: ' + ROOT,
    'Branch: ' + ctx.branch + '   HEAD: ' + ctx.head.slice(0, 12),
    'Existing VFX assets: js/vfx.js (DOM/CSS 特效層), js/battle-renderer.js (PixiJS 戰鬥渲染器),',
    'js/vendor/pixi.min.js, images/vfx/, images/sprites/, tests/*vfx*.test.cjs.',
    'The VFX Editor does not exist yet.',
    '',
    'git status --short:',
    ctx.statusText || '(clean)',
    '',
    'git diff --stat HEAD:',
    ctx.diffStat || '(no tracked changes)',
    '',
    'Read whatever files you need (read-only) to judge the scope above.',
    '',
    '# EFFICIENCY (bounded single-pass review)',
    '§5.1 of the spec allows only ONE review per feature, so this is a single bounded pass:',
    '- Do NOT use web search. Everything you need is in this repository.',
    '- Read only the files relevant to the scope; do not survey the whole repository.',
    '- Do not re-read a file you have already read.',
    '- Stop investigating and write the report as soon as you can support your findings.',
    '',
    '# REVIEW CHECKLIST (minimum)',
    '## General',
    '- correctness',
    '- architecture',
    '- maintainability',
    '- regressions',
    '- unnecessary complexity',
    '- duplicated logic',
    '- error handling',
    '',
    '## VFX / Rendering',
    '- WebGL performance',
    '- draw calls',
    '- texture usage',
    '- batching',
    '- object allocation',
    '- garbage collection pressure',
    '- object pooling',
    '- particle count',
    '- CPU/GPU workload',
    '- shader cost',
    '- excessive texture sampling',
    '- memory leaks',
    '- lifecycle cleanup',
    '- browser compatibility',
    '- mobile compatibility',
    '- resize / resolution handling',
    '- devicePixelRatio risk',
    '',
    '## VFX Editor (only if the scope involves the VFX Editor)',
    '- Editor 與 Runtime 是否共用核心 renderer',
    '- 是否產生 Editor-only hardcoding',
    '- JSON / Schema 是否資料驅動',
    '- Preview 與正式遊戲結果是否可能不一致',
    '- Save / Load 的資料一致性',
    '',
    '# SEVERITY',
    'CRITICAL is defined in §5.2 of the spec above. Use that definition exactly:',
    'do not relax it and do not widen it. Architectural taste, duplication, naming and style',
    'are MAJOR or MINOR, never CRITICAL.',
    '',
    '# OUTPUT FORMAT (mandatory)',
    'Reply in 繁體中文, but keep these four section headers exactly as written, in this order,',
    'and add no other top-level sections:',
    '',
    '## CRITICAL',
    '## MAJOR',
    '## MINOR',
    '## RECOMMENDATIONS',
    '',
    'Every finding must contain all three fields, and cite file:line where applicable:',
    '- 問題：',
    '- 影響：',
    '- 建議：',
    '',
    'If a category has no findings, write exactly: None',
    ''
  ]).join('\n');
}

/* 限縮驗證模式。
   完整 Review 的職責是主動找問題；這裡刻意相反——只判定「已知的 CRITICAL
   修好了沒有」。範圍一旦放寬就等於偷跑一輪完整 Review，違反規範 §5.1 的次數限制。
   唯讀保護、Codex sandbox、工作樹前後比對全部沿用 main()，這裡只換 Prompt。 */
function buildFixVerificationPrompt(scope, spec, ctx, brief) {
  return [
    '# ROLE',
    'You are an Independent Reviewer for the Idle-RPG VFX subsystem.',
    'You are NOT the implementer. Claude Code is the Lead Engineer.',
    '',
    '# THIS IS NOT A NEW FULL REVIEW',
    '',
    'This is a BOUNDED VERIFICATION of previously identified CRITICAL fixes only.',
    '',
    'Do NOT perform a general code review.',
    'Do NOT look for new MAJOR or MINOR issues.',
    'Do NOT review subsystems that are not named in the briefing.',
    'Do NOT propose architectural rewrites.',
    'Do NOT expand the scope.',
    'Do NOT use web search.',
    '',
    'Verify ONLY:',
    '  1. The CRITICAL findings listed in the briefing below.',
    '  2. Their implemented fixes.',
    '  3. Their regression tests.',
    '  4. Whether those fixes violate any previously fixed CRITICAL safety invariant.',
    ''
  ].concat(STRICT_RULES).concat(['']).concat(specBlock(spec)).concat([
    '',
    '# SCOPE',
    scope,
    '',
    '# REPOSITORY CONTEXT',
    'Repo root: ' + ROOT,
    'Branch: ' + ctx.branch + '   HEAD: ' + ctx.head.slice(0, 12),
    '',
    'git status --short:',
    ctx.statusText || '(clean)',
    '',
    '# BRIEFING — the only material in scope',
    '',
    '<fix-briefing>',
    brief,
    '</fix-briefing>',
    '',
    '# EFFICIENCY',
    'Read only the files and line ranges named in the briefing, plus the minimum you need',
    'to confirm or refute them. Do not survey the repository. Do not re-read a file.',
    'Stop investigating and write the report as soon as you can support your verdicts.',
    '',
    '# OUTPUT FORMAT (mandatory — output ONLY this, nothing else)',
    '',
    'Reply in 繁體中文 for the reason lines, but keep the section labels and the',
    'PASS / FAIL tokens exactly as written. Emit one CRITICAL_FIX_<n> block for each',
    'CRITICAL fix in the briefing, numbered in the same order as the briefing, then the',
    'three fixed sections:',
    '',
    'CRITICAL_FIX_1:',
    'PASS / FAIL',
    'reason',
    '',
    '(… one block per CRITICAL fix in the briefing …)',
    '',
    'REGRESSION_TESTS:',
    'PASS / FAIL',
    'reason',
    '',
    'PREVIOUS_CRITICAL_INVARIANTS:',
    'PASS / FAIL',
    'reason',
    '',
    'FINAL:',
    'PASS / FAIL',
    '',
    'FINAL is PASS only if every section above is PASS.',
    'Do not report MAJOR. Do not report MINOR.',
    'Do not search for unrelated issues. Do not add any other section.',
    ''
  ]).join('\n');
}

/* ---------------- 主流程 ---------------- */

function main() {
  const argv = process.argv.slice(2);
  if (argv.indexOf('--help') >= 0 || argv.indexOf('-h') >= 0) {
    console.log([
      'VFX 專用 Codex Reviewer（僅限 VFX 工程，見 ' + WORKFLOW_DOC_REL + '）',
      '',
      '  node tools/vfx/review-with-codex.cjs "<review scope>"',
      '  node tools/vfx/review-with-codex.cjs "<review scope>" --dry-run',
      '  node tools/vfx/review-with-codex.cjs "<scope>" --mode fix-verification --brief <檔案>',
      '',
      '  --mode   ' + MODES.join(' | ') + '（預設 ' + DEFAULT_MODE + '）',
      '  --brief  fix-verification 專用：說明本次要驗證哪些 CRITICAL、修正位置、',
      '           對應測試與必須維持的 invariant',
      '',
      '  scope 省略時預設為 "' + DEFAULT_SCOPE + '"'
    ].join('\n'));
    process.exit(EXIT.OK);
  }

  /* 拼錯的參數若被靜默忽略，使用者會以為 review 的是別的範圍 → 一律報錯。
     帶值的參數必須逐個走訪，不能只用 filter：--mode 的值不以 - 開頭，
     單純過濾會把它誤當成第二個 scope。 */
  const VALUE_OPTS = ['--mode', '--brief'];
  const BOOL_FLAGS = ['--dry-run'];
  let dryRun = false;
  let mode = DEFAULT_MODE;
  let briefPath = null;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOL_FLAGS.indexOf(a) >= 0) { dryRun = true; continue; }
    if (VALUE_OPTS.indexOf(a) >= 0) {
      const v = argv[++i];
      if (v === undefined || v.indexOf('-') === 0) {
        fail(EXIT.PRECONDITION, a + ' 需要一個值', '例如：' + a + ' <值>');
      }
      if (a === '--mode') mode = v; else briefPath = v;
      continue;
    }
    if (a.indexOf('-') === 0) {
      fail(EXIT.PRECONDITION, '未知參數：' + a,
        '可用參數：' + BOOL_FLAGS.concat(VALUE_OPTS).join('、') + '、--help');
    }
    positional.push(a);
  }
  if (positional.length > 1) {
    fail(EXIT.PRECONDITION, 'scope 只能有一個，收到 ' + positional.length + ' 個：' + positional.join(' | '),
      '含空白的 scope 請用引號包起來。');
  }
  if (MODES.indexOf(mode) < 0) {
    fail(EXIT.PRECONDITION, '未知的 --mode：' + mode, '可用模式：' + MODES.join('、'));
  }
  if (mode === 'fix-verification' && !briefPath) {
    fail(EXIT.PRECONDITION, '--mode fix-verification 需要 --brief <檔案>',
      '限縮驗證必須明確指出要驗證哪些 CRITICAL，否則會退化成一輪完整 Review。');
  }
  if (mode !== 'fix-verification' && briefPath) {
    fail(EXIT.PRECONDITION, '--brief 只能搭配 --mode fix-verification 使用');
  }
  let brief = '';
  if (briefPath) {
    const briefAbs = path.resolve(ROOT, briefPath);
    try {
      brief = fs.readFileSync(briefAbs, 'utf8').trim();
    } catch (e) {
      fail(EXIT.PRECONDITION, '無法讀取 --brief 檔案：' + briefAbs, e.message);
    }
    if (!brief) fail(EXIT.PRECONDITION, '--brief 檔案是空的：' + briefAbs);
  }
  const scope = (positional[0] || '').trim() || DEFAULT_SCOPE;

  console.log(line('='));
  console.log(mode === 'fix-verification'
    ? 'VFX CRITICAL FIX VERIFICATION（限縮範圍，非完整 Review）'
    : 'VFX Codex Review');
  console.log('Mode  : ' + mode);
  console.log('Scope : ' + scope);
  console.log('Root  : ' + ROOT);
  console.log(line('='));

  // 1) 規範文件必須存在，否則不呼叫 Codex
  if (!fs.existsSync(WORKFLOW_DOC)) {
    fail(EXIT.PRECONDITION,
      '找不到 VFX 工作流規範：' + WORKFLOW_DOC_REL,
      '此工具只服務 VFX 工程，缺少規範時不呼叫 Codex。請先建立該文件。');
  }
  let spec;
  try {
    spec = loadWorkflowSpec();
  } catch (e) {
    fail(EXIT.PRECONDITION, '無法讀取 ' + WORKFLOW_DOC_REL + '：' + e.message);
  }
  console.log('[1/5] 已載入規範：' + WORKFLOW_DOC_REL +
    '（' + spec.text.length + ' 字，' + (spec.condensed ? '重點節錄' : '全文') + '）');

  // 2) Git 前置檢查與 Review 前快照
  if (!git(['rev-parse', '--git-dir'], { allowFailure: true })) {
    fail(EXIT.PRECONDITION, ROOT + ' 不是 Git 工作區，無法進行唯讀驗證。');
  }
  const before = snapshotWorktree();
  const diffStat = git(['diff', '--stat', 'HEAD'], { allowFailure: true }) || '';
  console.log('[2/5] 已記錄 Review 前工作樹狀態（branch ' + before.branch + '，' +
    (before.statusText ? before.statusText.split('\n').length + ' 筆變更' : '無變更') + '）');

  const ctx = {
    branch: before.branch,
    head: before.head,
    statusText: before.statusText,
    diffStat: diffStat.trim()
  };
  const prompt = mode === 'fix-verification'
    ? buildFixVerificationPrompt(scope, spec, ctx, brief)
    : buildPrompt(scope, spec, ctx);

  if (dryRun) {
    console.log('[3/5] --dry-run：只輸出 Prompt，不呼叫 Codex\n');
    console.log(line('-'));
    console.log(prompt);
    console.log(line('-'));
    process.exit(EXIT.OK);
  }

  // 3) 解析 Codex CLI
  const codex = resolveCodex();
  if (!codex) {
    fail(EXIT.PRECONDITION,
      '找不到 Codex CLI（PATH 中沒有 codex）。',
      '請安裝 Codex CLI，或以 CODEX_BIN 指定執行檔／bin/codex.js 路徑。');
  }
  console.log('[3/5] Codex CLI：' + codex.how);

  // 4) 唯讀模式呼叫。Prompt 走 stdin，避開 Windows 命令列長度上限與引號問題。
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-codex-review-'));
  const lastMessageFile = path.join(tmpDir, 'review.md');
  const args = codex.prefix.concat([
    'exec',
    '--color', 'never',
    '--sandbox', 'read-only',
    '--cd', ROOT,
    '--output-last-message', lastMessageFile
  ]);
  if (process.env.CODEX_REVIEW_MODEL) args.push('--model', process.env.CODEX_REVIEW_MODEL);
  args.push('-');   // 由 stdin 讀取 Prompt

  const timeout = Number(process.env.CODEX_REVIEW_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  console.log('[4/5] 呼叫 Codex（sandbox=read-only，逾時 ' + Math.round(timeout / 1000) + ' 秒）…\n');
  console.log(line('-'));

  let run;
  try {
    run = spawnSync(codex.file, args, {
      cwd: ROOT,
      input: prompt,
      encoding: 'utf8',
      stdio: ['pipe', 'inherit', 'inherit'],
      timeout: timeout,
      shell: codex.shell === true,
      windowsHide: true
    });
  } catch (e) {
    run = { error: e };
  }
  console.log(line('-'));

  let review = '';
  try {
    if (fs.existsSync(lastMessageFile)) review = fs.readFileSync(lastMessageFile, 'utf8').trim();
  } catch (e) { /* 讀不到最終回覆不影響唯讀驗證，後面會判失敗 */ }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });   // 暫存檔放系統 temp，不污染專案
  } catch (e) { /* ignore */ }

  const codexFailed = !!run.error || run.status !== 0;
  let codexError = '';
  if (run.error) {
    codexError = (run.error.code === 'ETIMEDOUT')
      ? '逾時（超過 ' + timeout + ' ms）'
      : (run.error.code === 'ENOENT'
        ? '找不到可執行檔：' + codex.how
        : run.error.message);
  } else if (run.signal) {
    codexError = '被訊號中止：' + run.signal;
  } else if (run.status !== 0) {
    codexError = 'exit code ' + run.status;
  }

  // 5) Review 後快照與比對
  const after = snapshotWorktree();
  const changes = diffSnapshots(before, after);

  if (review) {
    console.log('\n' + line('='));
    console.log('REVIEW RESULT（Codex 最終回覆）');
    console.log(line('='));
    console.log(review);
  }

  console.log('\n' + line('='));
  console.log('[5/5] 唯讀驗證');
  console.log(line('='));
  console.log('Review 前 git status --short：');
  console.log(before.statusText ? before.statusText : '  (無變更)');
  console.log('Review 後 git status --short：');
  console.log(after.statusText ? after.statusText : '  (無變更)');

  if (changes.length) {
    console.error('\n[ERROR] Codex 違反唯讀規則：Review 期間工作樹狀態被改變。');
    for (let i = 0; i < changes.length; i++) console.error('  - ' + changes[i]);
    console.error('  （依 ' + WORKFLOW_DOC_REL + ' 第 6 節第 2 點，Codex 在 Claude worktree 只能讀取。）');
    console.error('  未自動回復任何檔案；請自行檢視 git diff 後決定處理方式。');
    if (codexFailed) console.error('  另外 Codex 本身也執行失敗：' + codexError);
    process.exit(EXIT.READONLY_VIOLATION);
  }
  console.log('\n結果：一致。Codex 保持唯讀（分支、HEAD、已追蹤與未追蹤檔案內容均未改變）。');

  if (codexFailed) {
    console.error('\n[ERROR] Codex 執行失敗：' + codexError);
    process.exit(EXIT.CODEX_FAILED);
  }
  if (!review) {
    console.error('\n[ERROR] Codex 沒有輸出最終回覆，Review 視為失敗。');
    process.exit(EXIT.CODEX_FAILED);
  }
  console.log('Review 完成。');
  process.exit(EXIT.OK);
}

/* 直接執行才跑 main()；被 require 時只匯出內部函式，方便針對唯讀驗證寫測試。 */
if (require.main === module) {
  main();
} else {
  module.exports = {
    snapshotWorktree: snapshotWorktree,
    diffSnapshots: diffSnapshots,
    buildPrompt: buildPrompt,
    buildFixVerificationPrompt: buildFixVerificationPrompt,
    MODES: MODES
  };
}
