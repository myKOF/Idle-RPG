'use strict';
/* AI_TASKS.md 的區段層級合併驅動程式。

   這支驅動程式最危險的失敗不是「合不起來」——那只是回到現況，人來處理；
   而是「合起來了但少了一段，而且沒有人發現」。所以測試的重點放在
   「內容有沒有全部保住」與「該衝突的有沒有真的衝突」，而不是輸出長什麼樣。

   一律用真的 git merge 跑，不直接呼叫驅動程式：要驗的是「git 在合併時
   會不會照我們期望的方式使用它」，繞過 git 就等於沒驗到 .gitattributes、
   merge driver 註冊與參數傳遞這三件事。 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DRIVER = path.join(REPO, 'tools', 'merge-ai-tasks.cjs');
const TARGET = 'docs/AI_TASKS.md';

function git(cwd, args) {
  return execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/* 合併會失敗（有衝突），所以需要一個不丟例外的版本 */
function gitAllowFail(cwd, args) {
  try {
    return { status: 0, out: git(cwd, args) };
  } catch (e) {
    return { status: e.status === undefined ? 1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-tasks-merge-'));
  git(dir, ['init', '--quiet', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  /* 行尾由沙箱自己決定，不受使用者全域 core.autocrlf 影響：
     這幾條測的是合併語意，不是行尾。行尾另有專門的案例。 */
  git(dir, ['config', 'core.autocrlf', 'false']);
  /* 驅動程式的路徑寫成絕對路徑：沙箱不是本 repo，相對路徑找不到檔案。
     正式用法是相對路徑（見 .gitattributes 的說明），差別只在這裡。 */
  git(dir, ['config', 'merge.ai-tasks.name', 'test']);
  git(dir, ['config', 'merge.ai-tasks.driver',
    'node "' + DRIVER.replace(/\\/g, '/') + '" %O %A %B %L %P']);
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitattributes'), TARGET + ' merge=ai-tasks\n');
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 盡力而為 */ }
}

function write(dir, text) {
  fs.writeFileSync(path.join(dir, TARGET), text);
}

function read(dir) {
  return fs.readFileSync(path.join(dir, TARGET), 'utf8');
}

function commitAll(dir, message) {
  git(dir, ['add', '-A']);
  /* 某一側「沒有改動」也是合法情境（例如只有對方刪除區段），
     允許空提交才做得出那個分支結構。 */
  git(dir, ['commit', '--quiet', '--allow-empty', '-m', message]);
}

/* base → 分出 side 分支寫 theirs，回到 main 寫 ours，然後合併 side。
   回傳合併的結束狀態與合併後的檔案內容。 */
function threeWay(dir, base, ours, theirs) {
  write(dir, base);
  commitAll(dir, 'base');
  git(dir, ['checkout', '--quiet', '-b', 'side']);
  write(dir, theirs);
  commitAll(dir, 'theirs');
  git(dir, ['checkout', '--quiet', 'main']);
  write(dir, ours);
  commitAll(dir, 'ours');
  const r = gitAllowFail(dir, ['merge', '--no-edit', 'side']);
  return { status: r.status, text: read(dir), log: r.out };
}

const HEAD = '# AI_TASKS.md\n';
const A = '## Codex｜甲（2026-09-01）\n- 甲的內容\n';
const B = '## Claude｜乙（2026-09-02）\n- 乙的內容\n';
const C = '## Codex｜丙（2026-09-03）\n- 丙的內容\n';

function sectionsOf(text) {
  return text.split('\n').filter(function (l) { return l.startsWith('## '); });
}

test('兩邊各自在檔尾新增不同區段 → 自動合併，兩段都在', function () {
  const dir = makeSandbox();
  try {
    const r = threeWay(dir, HEAD + '\n' + A, HEAD + '\n' + A + '\n' + B, HEAD + '\n' + A + '\n' + C);
    assert.equal(r.status, 0, '應該乾淨合併，實際輸出：\n' + r.log);
    assert.ok(!/<<<<<<</.test(r.text), '不該留下衝突標記');
    assert.deepEqual(sectionsOf(r.text).sort(),
      [A, B, C].map(function (s) { return s.split('\n')[0]; }).sort(),
      '三個區段都必須在');
    /* 逐行檢查零遺失——這才是這支驅動程式真正要保證的事 */
    const lines = new Set(r.text.split('\n'));
    [A, B, C, HEAD].forEach(function (block) {
      block.split('\n').filter(function (l) { return l.trim(); }).forEach(function (l) {
        assert.ok(lines.has(l), '遺失了這一行：' + l);
      });
    });
  } finally { cleanup(dir); }
});

test('只有一邊修改既有區段 → 收下那一邊的修改', function () {
  const dir = makeSandbox();
  try {
    const changed = '## Codex｜甲（2026-09-01）\n- 甲的內容（對方改過）\n';
    const r = threeWay(dir, HEAD + '\n' + A + '\n' + B,
      HEAD + '\n' + A + '\n' + B + '\n' + C, HEAD + '\n' + changed + '\n' + B);
    assert.equal(r.status, 0, '應該乾淨合併，實際輸出：\n' + r.log);
    assert.ok(r.text.indexOf('- 甲的內容（對方改過）') >= 0, '必須收下對方對甲區的修改');
    assert.ok(r.text.indexOf('## Codex｜丙') >= 0, '我方新增的丙區必須保留');
  } finally { cleanup(dir); }
});

test('同一區兩邊都改成不一樣 → 交回 git 標記衝突，不自作主張', function () {
  const dir = makeSandbox();
  try {
    const mine = '## Codex｜甲（2026-09-01）\n- 我方版本\n';
    const yours = '## Codex｜甲（2026-09-01）\n- 對方版本\n';
    const r = threeWay(dir, HEAD + '\n' + A, HEAD + '\n' + mine, HEAD + '\n' + yours);
    assert.notEqual(r.status, 0, '同一區兩邊都改，必須是衝突');
    assert.ok(/<<<<<<</.test(r.text), '必須留下 git 的衝突標記讓人處理');
    assert.ok(r.text.indexOf('- 我方版本') >= 0 && r.text.indexOf('- 對方版本') >= 0,
      '衝突標記內必須同時保有兩邊的內容');
  } finally { cleanup(dir); }
});

test('一邊刪除區段、另一邊沒動 → 刪除；另一邊改過 → 衝突', function () {
  const dir1 = makeSandbox();
  try {
    const r = threeWay(dir1, HEAD + '\n' + A + '\n' + B, HEAD + '\n' + A + '\n' + B, HEAD + '\n' + A);
    assert.equal(r.status, 0, '對方刪除、我方沒動，應該乾淨合併');
    assert.ok(r.text.indexOf('## Claude｜乙') < 0, '沒有人反對的刪除要生效');
  } finally { cleanup(dir1); }

  const dir2 = makeSandbox();
  try {
    const edited = '## Claude｜乙（2026-09-02）\n- 乙的內容（我方改過）\n';
    const r = threeWay(dir2, HEAD + '\n' + A + '\n' + B, HEAD + '\n' + A + '\n' + edited, HEAD + '\n' + A);
    assert.notEqual(r.status, 0, '一邊刪除、一邊修改是真衝突，不能安靜地選一個');
  } finally { cleanup(dir2); }
});

test('標題重複時退回 git 預設行為，不硬猜', function () {
  const dir = makeSandbox();
  try {
    const dup = HEAD + '\n' + A + '\n' + A;          // 同一個標題出現兩次
    const r = threeWay(dir, dup, dup + '\n' + B, dup + '\n' + C);
    assert.notEqual(r.status, 0, '無法以標題辨識區段時必須交回 git，而不是自己決定');
    assert.ok(/<<<<<<</.test(r.text) || r.text.indexOf('丙') < 0,
      '要嘛標記衝突，要嘛不動——不可以宣稱合併成功卻少東西');
  } finally { cleanup(dir); }
});

test('實際的 AI_TASKS.md 能被解析，且每個區段標題唯一', function () {
  const driver = require('../tools/merge-ai-tasks.cjs');
  const text = fs.readFileSync(path.join(REPO, TARGET), 'utf8');
  const parsed = driver.parse(text);
  assert.ok(parsed.sections.length > 50, '應該解析出大量區段，實際 ' + parsed.sections.length);
  const keys = new Set();
  const dup = [];
  parsed.sections.forEach(function (s) {
    if (keys.has(s.key)) dup.push(s.key);
    keys.add(s.key);
  });
  /* 標題重複本身不算錯（驅動程式會退回 git 預設行為），但會讓自動合併
     整份失效，所以要讓人知道。 */
  assert.deepEqual(dup, [], '標題重複會使自動合併對整個檔案失效：\n  ' + dup.join('\n  '));
});

test('.gitattributes 有掛上驅動程式，且同步腳本會註冊它', function () {
  const attrs = fs.readFileSync(path.join(REPO, '.gitattributes'), 'utf8');
  assert.ok(new RegExp('^' + TARGET.replace('/', '\\/') + '\\s+merge=ai-tasks', 'm').test(attrs),
    '.gitattributes 必須把 AI_TASKS.md 指向 ai-tasks 驅動程式');

  /* .gitattributes 只說「用哪個驅動程式」，真正的指令必須在本機 git config。
     少了註冊這一步，整套設定是靜默無效的——git 會安靜地退回預設合併。 */
  const ps1 = fs.readFileSync(path.join(REPO, 'tools', 'sync_ai_worktrees.ps1'), 'utf8');
  assert.ok(/merge\.ai-tasks\.driver/.test(ps1), '同步腳本必須註冊 merge.ai-tasks.driver');
  assert.ok(/merge-ai-tasks\.cjs %O %A %B %L %P/.test(ps1), '註冊的指令必須傳齊 git 的五個參數');
  assert.ok(/Register-AiTasksMergeDriver -Repository/.test(ps1), '註冊必須真的被呼叫，不能只有定義');
});

/* 兩側行尾不同時，若拿整行當 key 就會對不上，同一個區段會被當成
   「兩邊各自新增」而在輸出裡出現兩次——自動合併最不該發生的錯，
   而且沒有衝突標記可以提醒任何人。 */
test('兩側行尾不同也不會產生重複區段', function () {
  const dir = makeSandbox();
  try {
    const crlf = function (t) { return t.replace(/\n/g, '\r\n'); };
    /* 我方修改共用的甲區、對方原封不動只新增丙區（且整份是 CRLF）。
       正確：甲區認得出是同一區，收下我方的修改，乾淨合併三區。
       key 沒有正規化的話，甲區會被當成兩個不同的區段，
       走到「對方刪除、我方修改」而誤報衝突——結果分岔得很明顯。 */
    const mineA = '## Codex｜甲（2026-09-01）\n- 甲的內容（我方改過）\n';
    const r = threeWay(dir, HEAD + '\n' + A,
      HEAD + '\n' + mineA + '\n' + B, crlf(HEAD + '\n' + A + '\n' + C));
    assert.equal(r.status, 0, '行尾不同不該造成衝突，實際輸出：\n' + r.log);
    const heads = sectionsOf(r.text).map(function (l) { return l.replace(/\r$/, ''); });
    assert.equal(new Set(heads).size, heads.length, '不得有重複的區段標題：' + heads.join(' / '));
    assert.equal(heads.length, 3, '三個區段，一個不多一個不少');
    assert.ok(r.text.indexOf('- 甲的內容（我方改過）') >= 0, '我方對甲區的修改必須保留');
  } finally { cleanup(dir); }
});
