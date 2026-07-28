# AI_RULES.md

# Idle-RPG AI 開發共通規範

本文件為 Idle-RPG 專案所有 AI Agent 的最高層共通規範。

所有 AI（Claude、Codex、Antigravity）開始工作前，都必須先閱讀並遵守本文件。

若本文件與其他 Agent 文件發生衝突，以本文件為準。

# 第一原則

所有流程、分工與協議，均以提升整體開發效率為最高目標。

不得為了遵守流程而降低開發效率。

當流程成本高於其帶來的效益時，應主動提出更簡單且安全的替代方案，經使用者同意後調整工作方式。

---

# 1. AI 啟動流程

所有 AI 開始工作時，依序閱讀：

1. AI_RULES.md
2. AGENTS.md
3. docs/AI_WORKFLOW.md
4. docs/AI_TASKS.md
5. 自己的 Agent 文件
   - CLAUDE.md
   - codex.md
   - antigravity.md

不得跳過共通規範。

---

# 2. 使用者角色

本專案的使用者主要為：

- 遊戲企劃
- 遊戲製作人

使用者負責描述：

- 想完成的功能
- 遊戲規則
- 玩家體驗
- 操作流程
- UI 表現
- 已知問題
- 預期結果
- 功能優先級

使用者不需要判斷：

- 應由哪個 AI 處理
- 是否涉及核心架構
- 是否需要拆分任務
- 是否需要資料遷移
- 是否影響存檔
- 是否修改多個模組
- 是否需要 Code Review
- 是否需要 Regression Test
- 應修改哪些檔案

以上皆由 AI 自行判斷。

---

# 3. AI 基本責任

收到任務後，每個 AI 必須先完成：

1. 理解需求
2. 分析影響範圍
3. 判斷是否需要拆分任務
4. 判斷是否需要更新 AI_TASKS

## 3.1 使用者指派優先於檔案歸屬

**使用者指派給誰，就由誰做完整件事。**

各文件中的檔案所有權與角色分工（AGENTS.md、docs/AI_TASKS.md 第 5 節等）是基本原則，
用來降低衝突，**不是承接任務的門檻**。收到任務的 AI 不得因為「這支檔案慣例上屬於別人」
而只做一半、要求改派，或自行產生其他 AI 的提示詞。

理由：

- 使用者不需要知道一個功能牽涉哪些檔案、那些檔案又歸誰，那是 AI 的技術判斷。
- 為了遵守歸屬而把一個小功能拆給多個協作者，協調、提示詞傳遞與合併的成本
  高於直接完成——這與第一原則（不得為了遵守流程而降低開發效率）直接牴觸。

### 唯一的例外

若評估**由自己修改有實質風險**，可以說明風險並詢問使用者是否改由他人處理。
「實質風險」指：

- 另一個 AI 正在同時修改同一支檔案（真實衝突，非慣例問題）
- 需要自己不具備的執行環境或權限
- 修改範圍會破壞尚未完成的他人工作

詢問時必須一併說明：風險是什麼、建議由誰處理、以及自己仍可承接的部分。
**不得只回覆「這不是我的工作」，也不得在沒有實質風險時提出改派。**

未經使用者指示，不得主動產生其他 AI 的提示詞。

以下技術性限制不受本節影響，任何指派都必須遵守：

- 模擬層不得改為 ESM 或加 `export`
- 共載檔（util／data／formula）不得寫入狀態
- 協議變更一律改 `js/worker/protocol.js` 並同步文件與版本號
- 不得自行合併或推送 `develop`

這些是架構約束，違反會直接破壞既有測試或存檔相容性。

---

# 4. 專案工作區

正式 Worktree：

main

Claude

Codex

Antigravity

不得直接於錯誤工作區修改程式。

---

# 5. Git 原則

允許：

- git status
- git diff
- git add
- git commit

禁止：

- git push --force
- git reset --hard
- git clean
- 未經允許直接 Merge 至 develop
- 未經允許直接 Push develop

所有修改應維持 Commit 歷史清楚。

---

# 6. Commit 原則

每個 Commit 僅包含一個明確目的，避免混合多項不相關的修改。

## Commit 類型

使用以下英文前綴：

- feat:
- fix:
- refactor:
- docs:
- test:
- chore:

## Commit 說明

除通用技術術語外，Commit 說明一律使用繁體中文。

例如：

```
feat: 新增工人升級系統
fix: 修正離線收益重複計算
refactor: 重構 Worker 狀態同步流程
docs: 更新 Git 工作流程
test: 新增 Web Worker 壓力測試
chore: 更新開發工具設定
```

保留英文的常用術語包含但不限於：

- Worker
- Web Worker
- API
- UI
- DOM
- JSON
- CSV
- Timer
- Tick
- Thread
- Snapshot
- Event
- Command
- Context
- Token

## Commit 前至少確認

- `git status`
- `git diff`
- `git diff --stat`
- `git diff --check`

---

# 7. 架構原則

所有 AI 必須：

- 優先理解現有架構
- 優先沿用既有架構
- 優先重用既有模組
- 保持單一權威資料來源（Single Source of Truth）
- 保持模組職責清楚
- 保持程式可維護性

不得：

- 建立第二套相同功能
- 建立第二份權威資料
- 任意繞過既有流程
- 為了方便而破壞架構一致性

---

# 8. 修改原則

所有修改皆應：

- 與需求相符
- 保持最小必要修改
- 避免影響無關功能
- 保持可驗證
- 保持容易 Review

若發現更好的設計：

不得直接大幅重構。

應先回報：

- 問題
- 原因
- 建議方案
- 可能影響

---

# 9. Coding Style

遵循專案既有 Coding Style。

包含：

- 命名方式
- 目錄結構
- API 設計
- Component 設計
- Folder 結構

不得自行建立另一套 Coding Style。

---

# 10. 任務管理

所有正式程式修改開始前：

應確認：

docs/AI_TASKS.md

正式修改程式前：

應建立或更新任務。

純討論：

- 架構分析
- Code Review
- 功能討論
- 問題分析

可先不建立正式任務。

---

# 11. Build 原則

完成修改後至少確認：

- Build 成功
- Console 無新增 Error
- Console 無新增與本次修改相關的 Warning
- 功能符合需求

若無法完成 Build：

必須明確回報。

---

# 12. 回報原則

完成工作後至少回報：

1. 完成內容
2. 修改檔案
3. 修改原因
4. 驗證方式
5. 驗證結果
6. 已知限制
7. 已知風險
8. 建議下一步

不得只回覆：

- 已完成
- Done
- Fixed

---

# 13. 問題詢問原則

需要詢問使用者時：

優先詢問：

- 遊戲規則
- 玩家體驗
- 功能需求
- UI 表現
- 儲存需求
- 優先級
- 邊界情況

避免直接詢問：

- 技術架構
- 資料結構
- 設計模式
- 類別設計
- Dependency Injection
- EventBus
- ECS
- ScriptableObject 架構

AI 應自行完成技術分析。

---

# 14. 文件一致性

本文件為所有共通規則唯一來源。

其他文件：

- AGENTS.md
- CLAUDE.md
- codex.md
- antigravity.md
- AI_WORKFLOW.md
- AI_TASKS.md

不得重複定義本文件已有規則。

若需修改共通規範：

僅修改 AI_RULES.md。

其他文件僅保留各自專屬規則。

---

# 15. 核心原則

所有 AI 必須遵守以下原則：

- 使用者決定遊戲如何運作。
- AI 決定技術如何實作。
- AI 主動分析，而非要求使用者完成技術判斷。
- AI 主動評估風險，而非等待使用者發現。
- AI 維持架構一致性，而非追求最快完成。
- AI 應以長期可維護性為優先。