# Idle-RPG 多 AI 開發規則

## 1. 工作區與分支

- 主工作區：D:\MyGame\Idle-RPG\main
- 主整合分支：develop
- Claude Code 工作區：D:\MyGame\Idle-RPG\claude
- Claude Code 分支：ai/claude
- Codex 工作區：D:\MyGame\Idle-RPG\codex
- Codex 分支：ai/codex
- Antigravity 工作區：D:\MyGame\Idle-RPG\antigravity
- Antigravity 分支：ai/antigravity

任何 AI 都不得直接在主工作區工作。

## 2. Git 安全規則

所有 AI 必須遵守：

1. 只能在自己的工作區與分支工作。
2. 禁止切換到 develop、main 或其他 AI 的分支。
3. 禁止自行合併 develop。
4. 禁止自行推送 develop。
5. 禁止執行 git push --force。
6. 禁止執行 git reset --hard。
7. 禁止執行 git clean。
8. 禁止刪除其他 AI 建立的分支。
9. 禁止修改任務範圍外的檔案。
10. 如需修改任務範圍外檔案，必須停止並回報原因。
11. 每個獨立功能必須建立獨立 commit。
12. 不得把多個無關修改放入同一個 commit。

## 3. 開始任務前

每個 AI 開始工作前必須：

1. 閱讀本文件。
2. 執行 git status。
3. 執行 git branch --show-current。
4. 確認目前分支不是 develop 或 main。
5. 檢查工作區是否已有未提交修改。
6. 確認本次允許修改與禁止修改的範圍。

如果工作區已有不明修改，必須停止，不得覆蓋。

## 4. 修改規則

1. 優先使用既有架構與工具。
2. 禁止建立重複系統。
3. 禁止在多處保存相同狀態。
4. 禁止無理由重寫整個檔案。
5. 禁止順手修改與任務無關的程式碼。
6. 不得刪除既有測試來讓測試通過。
7. 不得關閉錯誤檢查或降低測試標準來隱藏問題。
8. 新功能應盡量附帶測試。
9. 修復 bug 時應記錄重現條件與修正原因。
10. 共用設定應維持單一資料來源。

## 5. Idle-RPG 專案重點

審查或修改時應特別注意：

- 遊戲狀態是否只有單一權威來源。
- 計時器是否重複建立。
- setInterval、setTimeout 是否正確清理。
- DOM 事件監聽器是否重複註冊或未移除。
- 存檔格式是否向後相容。
- 離線收益是否可能重複領取。
- 大數值計算是否出現 Infinity、NaN 或精度問題。
- 戰鬥循環是否可能重複執行。
- 暫停、切頁、重新整理後狀態是否一致。
- UI 是否直接修改核心遊戲狀態。
- 配置表內容是否被硬編碼到程式碼。
- 自動戰鬥與手動操作是否可能互相競爭。
- 測試是否依賴不穩定的時間或執行順序。

## 6. 提交前檢查

完成任務後必須執行：

git status
git diff --stat
git diff

並確認：

- 沒有任務範圍外的修改。
- 沒有提交 node_modules、tmp、日誌或其他產物。
- 沒有留下除錯輸出。
- 沒有未處理的 TODO 或暫時方案。
- 測試結果已記錄。

## 7. Commit 規則

Commit 訊息使用以下格式：

- feat: 新增功能
- fix: 修復問題
- refactor: 重構但不改變行為
- test: 新增或修改測試
- docs: 文件修改
- chore: 工具或維護修改

範例：

feat: add offline reward calculation
fix: prevent duplicate combat timers
test: cover save migration edge cases

## 8. 完成回報格式

每次完成任務後必須回報：

### 完成內容
簡述完成了什麼。

### 修改檔案
列出所有修改檔案。

### Commit
提供 commit 編號與訊息。

### 測試
列出執行的測試指令。

### 測試結果
說明通過、失敗或未執行。

### 已知風險
列出尚未解決或需要注意的問題。

### 後續工作
說明是否需要其他 AI 審查、修正或驗證。