# AI_WORKFLOW.md

本文件定義 Idle-RPG 專案中多 AI 的 Git、Worktree、分支、提交、審查與合併流程。

程式架構與開發規則請參考：

AI_RULES.md

AI 角色分工請參考：

AGENTS.md

目前任務分配請參考：

docs/AI_TASKS.md

---

# 1. 工作區與分支

主整合工作區：

D:\MyGame\Idle-RPG\main

分支：

develop

用途：

- 合併各 AI 的修改
- 執行最終測試
- 處理衝突
- 推送遠端
- 建立正式版本

---

Claude Code 工作區：

D:\MyGame\Idle-RPG\claude

分支：

ai/claude

---

Codex 工作區：

D:\MyGame\Idle-RPG\codex

分支：

ai/codex

---

Antigravity 工作區：

D:\MyGame\Idle-RPG\antigravity

分支：

ai/antigravity

---

# 2. 基本原則

所有 AI 必須遵守：

- 只能在自己的 Worktree 工作
- 只能在自己的分支修改
- 不得直接修改 develop
- 不得自行合併 develop
- 不得自行推送 develop
- 不得修改其他 AI 正在處理的檔案
- 不得覆蓋來源不明的修改

主工作區只用於：

- 合併
- 測試
- 衝突處理
- 正式提交
- 推送遠端

---

# 3. 開始任務前

每個 AI 開始工作前必須執行：

git status

git branch --show-current

並確認：

- 目前位於正確 Worktree
- 目前位於自己的分支
- 沒有來源不明的修改
- 已讀取 AI_RULES.md
- 已讀取 AGENTS.md
- 已讀取 docs/AI_TASKS.md
- 本次允許修改範圍明確

如果工作區或分支錯誤，禁止開始修改。

---

# 4. 任務分配

使用者不需要事先正確選擇 AI，也不需要知道任務牽涉哪些檔案。

**使用者指派給誰就由誰做完整件事**——包含慣例上屬於其他 AI 的檔案。
規則與唯一的例外（存在實質風險時可詢問是否改派）見 `AI_RULES.md` 第 3.1 節。

正式修改程式前，必須先記錄在 docs/AI_TASKS.md。

純討論、需求釐清、架構分析或 Code Review，可以先不建立正式任務；一旦確定要修改檔案，就必須更新任務記錄。

至少必須寫明：

- 負責 AI
- 任務名稱
- 任務內容
- 允許修改的檔案
- 禁止修改的檔案
- 測試要求
- 前置依賴
- 後續接手者

同一時間，同一個正式檔案只能由一個**進行中的任務**修改。

如果兩個 AI 都需要修改同一檔案，必須改成依序處理。

這條防的是「同時進行」造成的真實衝突，不是宣告長期所有權。
沒有進行中任務佔用的檔案，任何被指派的 AI 都可以直接修改（`AI_RULES.md` 第 3.1 節）。

## 4.1 任務依賴與並行執行

任務是否可以開始，應以「前置依賴是否完成」判斷，不以 P0、P1、P2 等階段編號判斷。

AI 完成目前任務後：

- 如果下一項任務的所有前置依賴均已完成，可以立即繼續執行，不必等待其他無關任務。
- 如果下一項任務仍依賴其他 AI 的成果，必須停止並等待，不得自行假設結果、繞過依賴或擴大工作範圍。
- 如果無法判斷依賴是否已滿足，必須先回報使用者確認。
- 等待期間，可以承接另一項「依賴已滿足且修改範圍不衝突」的任務。

docs/AI_TASKS.md 中的每項正式任務應至少標示：

- 任務編號
- 負責 AI
- 前置依賴
- 可交付成果
- 允許修改範圍
- 目前狀態

建議狀態：

- Ready：依賴已滿足，可以開始
- In Progress：正在執行
- Blocked：依賴尚未完成
- Review：等待審查
- Done：已符合完成定義

多個任務符合以下條件時，可以並行執行：

- 前置依賴均已滿足
- 修改檔案不重疊
- 不會同時變更同一套介面、資料格式或共用契約
- 各任務的輸入與輸出已明確定義

P0、P1、P2 僅用於表示優先級或階段，不代表前一階段的所有任務都必須完成後，下一階段才能開始。

---


# 5. 修改流程

標準修改流程：

1. 確認任務內容
2. 確認允許修改範圍
3. 分析現有架構
4. 說明預計修改方式
5. 進行修改
6. 執行 Build 或測試
7. 檢查 Git Diff
8. 建立 Commit
9. 回報結果
10. 等待 Review 或合併

禁止在任務進行中自行擴大範圍。

---

# 6. Commit 規則

每個 Commit 只處理一個明確目的。

Commit 格式：

類型: 簡短描述

允許類型：

feat:

fix:

refactor:

test:

docs:

chore:

範例：

feat: add skill fusion system

fix: prevent duplicate combat timer

test: add formula calculation tests

docs: update AI workflow

禁止使用過於模糊的訊息，例如：

update

changes

fix stuff

修改

完成

---

# 7. Commit 前檢查

建立 Commit 前必須執行：

git status

git diff --stat

git diff

git diff --check

確認：

- 沒有任務外修改
- 沒有意外刪除
- 沒有 node_modules
- 沒有 tmp
- 沒有測試產物
- 沒有除錯輸出
- 文件已同步
- Build 或測試已完成

---

# 8. Code Review 流程

建議流程：

實作者完成 Commit
→ Claude Code Review
→ 實作者修正
→ Claude 再次確認
→ Antigravity 實際驗證
→ 使用者合併

Claude Code Review 預設只讀，不修改檔案。

Review 應檢查：

- 邏輯錯誤
- 架構一致性
- 技能與公式正確性
- 存檔相容性
- Timer 與 Event 問題
- 效能與記憶體
- 測試是否足夠
- 是否有任務外修改

Critical 或 High 問題未修復前，不應合併。

---

# 9. 合併流程

合併只能在主工作區進行：

D:\MyGame\Idle-RPG\main

合併前必須執行：

git branch --show-current

git status

必須確認：

- 目前分支是 develop
- 工作區沒有未提交修改
- 要合併的 Agent 分支已完成 Review
- 必要測試已通過

每次只合併一個 Agent 分支。

例如：

git merge --no-ff ai/codex -m "merge: integrate Codex changes"

合併後必須立即：

1. 執行 Build
2. 執行相關測試
3. 驗證功能
4. 檢查 Console
5. 再次執行 git status

通過後才能合併下一個分支。

---

# 10. 建議合併順序

一般建議順序：

1. 共用工具
2. 核心架構
3. 技能、公式與遊戲邏輯
4. UI
5. 測試
6. 文件
7. 瀏覽器驗證

如果分支之間有依賴，應依照實際依賴順序合併。

---

# 11. 衝突處理

發生衝突時，先執行：

git status

不得：

- 直接接受全部其中一方
- 直接覆蓋整份檔案
- 未理解內容就刪除其中一側
- 為了快速合併而移除功能

處理衝突時必須：

1. 理解 develop 的修改目的
2. 理解 Agent 分支的修改目的
3. 保留雙方必要內容
4. 檢查是否產生重複系統
5. 執行完整相關測試

如果無法安全處理，可以執行：

git merge --abort

然後重新規劃。

---

# 12. 分支同步

develop 更新後，不應在 Agent 任務進行中立即同步。

只有在：

- Agent 任務已完成
- Agent 工作區乾淨
- 下一輪任務尚未開始

才適合同步 develop。

同步前必須執行：

git status

如果工作區不是乾淨狀態，禁止同步。

---

# 13. Git 自動操作權限

各 AI 可以在自己的 Worktree 與專屬分支內自行執行：

- `git status`
- `git branch --show-current`
- `git fetch origin`
- `git pull --ff-only`
- 將 `origin/develop` 合併到自己的 Agent 分支
- `git add`
- `git commit`
- 推送自己的 Agent 分支

各 AI 不得：

- 直接修改 `develop` 或 `main`
- 將自己的分支自行合併至 `develop`
- 推送 `develop` 或 `main`
- 合併其他 AI 的分支
- 使用 `git reset --hard`
- 使用 `git push --force`
- 在工作區不乾淨時同步分支
- 未處理衝突就繼續工作
- 未經授權修改其他 AI 的 Worktree

`develop` 與 `main` 的合併、衝突處理、最終測試及推送，統一由指定整合者負責。

預設整合者為 Claude Code；使用者可依當前任務指定其他整合者。

整合者執行開發任務時，必須使用自己的 Agent Worktree。

整合者執行合併任務時，必須切換至主整合 Worktree，不得直接在 Agent Worktree 操作 `develop`。

## 13.1 個別 AI 同步規則

個別 AI 同步 `develop` 前必須確認：

1. 位於自己的 Worktree。
2. 位於自己的 Agent 分支。
3. `git status` 顯示工作區乾淨。
4. 上一個任務已完成並建立 Commit。
5. 下一個任務尚未開始。
6. 沒有來源不明的修改。

標準同步方式：

```bash
git status
git branch --show-current
git fetch origin
git merge origin/develop

---

# 14. 回退原則

優先使用：

git revert <commit>

保留完整歷史。

禁止預設使用：

git reset --hard

如果合併後發現問題：

1. 停止合併其他分支
2. 記錄失敗內容
3. 找出問題 Commit
4. 使用 Revert 或新的修正 Commit
5. 重新測試

---

# 15. 推送遠端

只有主整合工作區可以推送 develop。

推送前確認：

- 工作區乾淨
- Build 通過
- 測試通過
- 沒有測試產物
- 沒有敏感資料
- Commit 訊息清楚

AI 預設不得自行推送 develop。

---

# 16. 標準協作流程

一般功能：

1. 使用者描述功能、問題或預期結果
2. 收到任務的 AI 進行任務分類與風險判斷
3. AI 拆分任務，標示負責者、前置依賴、可交付成果與可並行項目
4. 正式修改程式前，更新 docs/AI_TASKS.md
5. 依賴已滿足且修改範圍不衝突的任務可同時開始
6. AI 完成目前任務後，依照前置依賴判斷是否立即進行下一項
7. 依賴尚未完成的任務標示為 Blocked，等待相關成果
8. Claude Code Review
9. 實作者修正
10. Antigravity 實際驗證
11. 使用者在主整合工作區合併至 develop
12. 執行最終測試
13. 推送 develop

---

# 17. 完成交接

每個 AI 完成後必須回報：

1. 完成內容
2. 修改檔案
3. Commit 編號
4. Build 或測試指令
5. 測試結果
6. 已知風險
7. 後續接手者

# 18. 任務完成定義（Definition of Done）

任務只有在下列條件全部成立時才算完成：

- 功能符合需求。
- 已完成必要驗證。
- Code Review 已完成（若需要）。
- Regression Test 已完成（若需要）。
- docs/AI_TASKS.md 已更新。
- 已知風險已記錄。
- 建議下一步已提供。

未符合以上條件，不得標示為「完成」。