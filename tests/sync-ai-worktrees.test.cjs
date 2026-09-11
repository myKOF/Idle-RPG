'use strict';
/* sync_ai_worktrees.ps1 的結構性不變式。

   這支腳本會 push，出錯的代價比一般工具高，但它是 PowerShell 而且每一步都
   要打網路，沒辦法用單元測試跑。所以這裡釘的是「一眼看不出來、但錯了會很痛」
   的幾條寫法，其餘行為由實際執行驗證。 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const PS1 = fs.readFileSync(path.join(REPO, 'tools', 'sync_ai_worktrees.ps1'), 'utf8');

function functionBody(name) {
  const start = PS1.indexOf('function ' + name);
  assert.ok(start >= 0, '找不到函式 ' + name);
  const next = PS1.indexOf('\nfunction ', start + 1);
  return PS1.slice(start, next < 0 ? PS1.length : next);
}

/* PowerShell 會把函式內所有落在管線上的東西一起當成回傳值。原生指令的 stdout
   若不導走，`return $LASTEXITCODE` 實際回傳的是「輸出行 ＋ 結束碼」的陣列，
   而呼叫端的 `-ne 0` 對陣列是「篩出不等於 0 的元素」，非空即為真——
   成功會被判成失敗。

   2026-09-11 實際踩到：素材庫已是最新時 pull --rebase 把「Already up to date.」
   印在 stdout，同步每次都回報素材庫失敗，而且連帶跳過後面的 push。 */
test('Invoke-GitSoft 不得讓 git 的 stdout 落在回傳值上', function () {
  const body = functionBody('Invoke-GitSoft');
  assert.ok(/&\s*git\b[^\n]*\|\s*Out-Host/.test(body),
    'Invoke-GitSoft 內呼叫 git 時必須把 stdout 導去 Out-Host，否則回傳值會變成陣列');
  assert.ok(/return \$LASTEXITCODE/.test(body), '必須回傳結束碼本身');
});

/* Get-GitTextSoft 要的正是 stdout，所以它反過來必須留著；但它會呼叫
   「本來就可能失敗」的 git 指令（例如沒有 upstream 時的 rev-parse），
   在 $ErrorActionPreference = 'Stop' 之下重導 stderr 會變成終止性錯誤。 */
test('Get-GitTextSoft 呼叫期間必須把 ErrorActionPreference 降成 Continue 再還原', function () {
  const body = functionBody('Get-GitTextSoft');
  assert.ok(/\$ErrorActionPreference = 'Continue'/.test(body), '呼叫前要降級');
  assert.ok(/finally\s*\{[\s\S]*\$ErrorActionPreference = \$previous/.test(body),
    '必須用 finally 還原，否則中途 return 會把設定留在 Continue');
});

/* 素材庫是使用者持續丟新圖的地方，「有未提交變更」是常態。若它的失敗會中斷
   整個同步，等於加一張圖就不能同步程式碼。 */
test('素材庫同步排在程式碼之前，且失敗不中斷程式碼同步', function () {
  const callAsset = PS1.indexOf('Sync-AssetLibrary -Repository');
  const discover = PS1.indexOf("Write-Step '探索必要的 Worktree'");
  assert.ok(callAsset >= 0 && discover >= 0, '兩個步驟都要存在');
  assert.ok(callAsset < discover,
    '素材庫要排在最前面：程式碼那段任何一步失敗都會整個中止，擺在後面就永遠輪不到');

  const body = functionBody('Sync-AssetLibrary');
  assert.ok(!/\bthrow\b/.test(body), 'Sync-AssetLibrary 不得用 throw，否則會中斷程式碼同步');
  ['synced', 'skipped', 'failed'].forEach(function (s) {
    assert.ok(new RegExp("return '" + s + "'").test(body), '必須能回報 ' + s);
  });

  /* 失敗只影響最終結束碼，而且要等程式碼同步跑完才反映 */
  const finish = PS1.indexOf("Write-Step '同步完成'");
  const verdict = PS1.indexOf("$assetLibraryResult -eq 'failed'");
  assert.ok(verdict > finish, '素材庫的失敗必須在「同步完成」之後才反映到結束碼');
});

/* 素材庫的位置只存在於本機設定，絕不進入 Git（見 vfx-library-root.cjs 檔頭）。
   在腳本裡照抄一次解析順序就是第二套系統，兩邊遲早分家，
   而分家的症狀是同步到錯的資料夾——不會有人立刻發現。 */
test('素材庫路徑與分支都不得寫死', function () {
  const body = functionBody('Get-AssetLibraryRoot') + functionBody('Sync-AssetLibrary');
  assert.ok(/vfx-library-root\.cjs/.test(body), '必須呼叫共用模組解析 Root');
  assert.ok(!/Effects-Materials/.test(body), '不得寫死素材庫路徑');
  assert.ok(!/'master'|"master"/.test(body), '不得寫死分支名，要問 git');
  assert.ok(/branch', '--show-current/.test(body) && /@\{upstream\}/.test(body),
    '分支與 upstream 都要問 git');
});

/* develop 是整合分支，三個 AI 分支在流程最後又被 fast-forward 回 develop，
   所以每一個分支都含有 merge commit。rebase 不帶 --rebase-merges 會把它們
   壓平，於是得把各 AI 分支的原始 commit 一筆筆重放到新基底——衝突憑空冒出來，
   而且改寫的是已經整合好、可能已推送的歷史。

   2026-09-11 實測：develop 領先遠端 9 筆、落後 0 筆（根本沒有分歧），
   pull --rebase 仍然開始重放 7 筆並在第 2 筆卡在 js/bridge.js。 */
test('同步前的對齊用 merge --ff-only，不得用 pull --rebase', function () {
  const start = PS1.indexOf('if ($SyncRemoteFirst)');
  assert.ok(start >= 0, '找不到 SyncRemoteFirst 區塊');
  const block = PS1.slice(start, PS1.indexOf("Write-Step \"更新遠端", start));

  assert.ok(/'merge', '--ff-only', "\$Remote\/\$branch"/.test(block),
    '對齊步驟要用 merge --ff-only');
  assert.ok(!/'pull', '--rebase'/.test(block),
    'rebase 會壓平 merge commit 並改寫已整合的歷史，不得用在這些分支上');
  /* fetch 必須排在前面，否則 ff-only 比對的是過期的遠端追蹤參照 */
  assert.ok(block.indexOf("'fetch'") < block.indexOf("'--ff-only'"),
    'fetch 要排在對齊之前');
});
