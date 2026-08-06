# Mandatory AI Execution Rules

## 1. 啟動與衝突預檢 (Mandatory Pre-flight)
- 每次收到修改程式指令時，動手前**必須**先執行衝突預檢：
  `powershell -NoProfile -ExecutionPolicy Bypass -File .claude/check-conflicts.ps1 <檔案...>`
- 若有衝突來源，必須先告知使用者並取得同意。

## 2. 預設 Commit 規範 (Mandatory Auto-Commit)
- 使用者指示修改/修復功能時，只要未明確指示「先確認」、「暫不提交」或「不要 Commit」，**完成測試驗證後必須自動建立 Git Commit**。
- **不得**因使用者沒提醒「請 Commit」就省略 Commit。
- Commit 流程：
  1. 更新 `PATCH.md` 摘要。
  2. 執行 `git add` 與 `git commit`。
  3. Commit 標題格式必須為：`[Antigravity] <type>: <description>`（如 `[Antigravity] feat: ...`）。

## 3. DoD 完成定義與驗證 (Verification & Defense)
- 修改完成後必須執行 `node --test "tests/*.test.cjs"` 與 `node tools/build_check.cjs`。
- 回覆必須一律使用**繁體中文**。
