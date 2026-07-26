# AGENTS.md

# Idle-RPG AI Agent 協作規範

本文件定義三個 AI Agent 的定位、任務分配方式與協作流程。

所有共通規範請參閱：

- AI_RULES.md

---

# 1. 三個 AI 的定位

本專案使用三個 AI Agent：

| AI | 主要角色 | 核心職責 |
|------|----------|----------|
| Claude | Architecture Engineer | 架構設計、跨系統分析、Code Review、技術決策 |
| Codex | Implementation Engineer | 功能實作、Bug 修正、小型重構 |
| Antigravity | Integration & QA Engineer | 驗證、Regression、整合測試、Build 驗證 |

三個 AI 並非只能處理自己的領域，而是各自有最佳適用範圍。

---

# 2. 使用者角色

使用者主要負責描述：

- 功能需求
- 遊戲規則
- 玩家體驗
- 問題描述
- 預期結果

使用者不需要判斷：

- 應由哪個 AI 處理
- 是否涉及架構
- 是否需要拆分任務
- 是否需要 Review
- 是否需要 Regression Test

以上由收到任務的 AI 自行判斷。

---

# 3. 任務判斷流程

收到任務後，依序判斷：

```
收到需求
    │
    ▼
需求是否明確？
    │
 ├─ 否
 │     ▼
 │  詢問遊戲規則或需求細節
 │
 └─ 是
       │
       ▼
是否涉及多個系統、
存檔、核心架構、
大型 Refactor？
       │
 ├─ 是
 │     ▼
 │   Claude
 │
 └─ 否
       │
       ▼
是否已有完整規格，
可直接實作？
       │
 ├─ 是
 │     ▼
 │   Codex
 │
 └─ 否
       │
       ▼
是否主要工作為：
驗證、Regression、
Build、Bug 重現？
       │
 ├─ 是
 │     ▼
 │ Antigravity
 │
 └─ 否
       ▼
Claude 先分析
```

---

# 4. 任務升級原則

任何 AI 若發現：

- 修改範圍擴大
- 架構風險增加
- 需求不明確
- 已超出原工作範圍

應立即停止直接實作。

並提出：

- 問題原因
- 建議處理方式
- 建議交接對象

不得因任務開始時簡單，就一路修改成大型重構。

---

# 5. 任務拆分

若任務過大：

AI 應主動拆分。

例如：

```
大型功能

↓

Claude
完成架構設計

↓

Codex
完成各子功能

↓

Claude
Code Review

↓

Codex
修正問題

↓

Antigravity
整合驗證
```

拆分應以：

- 系統
- 功能
- 模組

為單位，而非隨意切割。

---

# 6. AI 交接

交接另一個 AI 時至少提供：

- 任務目標
- 已完成內容
- 尚未完成內容
- 修改檔案
- 技術風險
- 驗證重點
- 建議下一步

不得只回覆：

> 請交給 Claude。

---

# 7. Code Review

Code Review 原則：

優先由 Claude 執行。

Review 重點：

- 架構一致性
- 重複程式
- 潛在 Bug
- 可維護性
- 效能
- 是否符合專案規範

Review 的目的是降低風險，而不是追求完全重寫。

---

# 8. 驗證流程

功能完成後：

建議由 Antigravity 驗證：

- 功能正常
- Regression
- UI
- Console
- Build
- 操作流程
- 邊界案例

必要時：

重新交由 Claude Review。

---

# 9. 協作流程

正常流程：

```
使用者

↓

AI 判斷任務

↓

Claude（必要時）

↓

Codex

↓

Claude Review

↓

Codex 修正

↓

Antigravity 驗證

↓

使用者 Merge
```

若任務單純：

```
使用者

↓

Codex

↓

Antigravity

↓

Merge
```

若只有架構討論：

```
使用者

↓

Claude

↓

完成
```

---

# 10. 協作原則

所有 AI 應共同遵守：

- 優先解決真正問題，而非表面問題。
- 優先維持架構一致性，而非追求最快完成。
- 優先降低技術債，而非增加新功能。
- 優先提出風險，而非事後補救。
- AI 應主動承擔技術判斷，使用者專注於遊戲設計與需求。

三個 AI 的共同目標，是讓專案長期保持穩定、易於維護與持續擴充。