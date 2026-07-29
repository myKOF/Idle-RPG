# Git Workflow

> 本文件定義 Idle-RPG 專案的 Git Branch、Worktree 與協作流程。
>
> 所有開發者（人員或 AI）皆應遵循本規範。

---

# Repository Structure

## Remote (GitHub)

```
origin/main
```

玩家正式版本。

僅於正式發布時更新。

---

```
origin/develop
```

開發主線。

所有功能整合完成後同步至此。

---

```
origin/ai/*
```

AI 專屬工作分支。

例如：

```
origin/ai/claude
origin/ai/codex
origin/ai/antigravity
```

---

# Local Worktree Structure

```
Idle-RPG
├── develop
├── production
├── claude
├── codex
└── antigravity
```

Worktree 對應：

| Folder | Branch |
|---------|--------|
| develop | develop |
| production | main |
| claude | ai/claude |
| codex | ai/codex |
| antigravity | ai/antigravity |

---

# Branch Responsibilities

## main

正式發布版本。

原則：

- 永遠保持可發布狀態
- 不直接開發
- 僅接受 develop 合併

---

## develop

整合開發版本。

所有功能最終皆須合併至 develop。

完成整體測試後，再發布至 main。

---

## ai/*

AI 專屬工作分支。

例如：

```
ai/claude
ai/codex
ai/antigravity
```

每個 AI 僅修改自己的 Branch。

不得直接修改其他 AI Branch。

---

# Daily Workflow

開始工作前：

```
git pull
```

保持目前 Worktree 最新。

工作完成後：

```
git add
git commit
git push
```

保持 Commit 小且清楚。

---

# Development Flow

```
AI Branch

        │

        │ Commit

        ▼

develop

        │

        │ Integration Test

        ▼

main

        │

        │ Release

        ▼

origin/main
```

---

# Release Flow

```
AI 完成工作

↓

Merge 至 develop

↓

整體測試

↓

Merge 至 main

↓

Push origin/main

↓

玩家更新
```

---

# Worktree Rules

每個 Worktree 永遠固定。

```
develop
production
claude
codex
antigravity
```

不得：

```
git checkout develop
git switch develop

git checkout main
git switch main
```

切換至已被其他 Worktree 使用的 Branch。

需要切換工作時：

直接切換到對應 Worktree。

---

# Commit Rules

Commit 保持小且單一目的。

標題格式：

```
[提交者] 類型: 說明
```

提交者為 `[Claude]`、`[Codex]`、`[Antigravity]` 三者之一，AI 的所有 commit 一律加上
（包含 merge、docs、chore）；使用者本人直接提交時不受此限。

原因與篩選方式見 AI_RULES.md 第 6 節——本專案所有 commit 的 git author 都是同一個帳號，
沒有前綴就分不出某次改動出自哪個 AI。

類型：

```
feat:
fix:
refactor:
docs:
test:
chore:
```

例如：

```
[Claude] feat: 新增工人升級系統

[Codex] fix: 修正生產佇列錯誤

[Antigravity] test: 新增 Worker 壓力測試

[Claude] refactor: 重構 Worker 狀態同步流程

[Codex] docs: 更新 AI 工作流程
```

說明一律使用繁體中文（保留的英文術語清單見 AI_RULES.md 第 6 節）。

---

# Merge Rules

AI Branch

↓

develop

↓

main

禁止：

```
AI Branch

↓

main
```

所有功能皆須先經過 develop。

---

# Pull Rules

每日開始工作：

所有 Worktree：

```
develop
production
claude
codex
antigravity
```

皆應執行：

```
git pull
```

保持同步。

---

# Push Rules

AI Branch：

```
git push
```

同步：

```
origin/ai/*
```

---

develop：

```
git push
```

同步：

```
origin/develop
```

---

production：

正式發布時：

```
git push
```

同步：

```
origin/main
```

---

# Emergency Rules

禁止：

- Force Push 至 main
- Rebase main
- Reset main
- 在 production Worktree 開發
- 未測試直接 Merge 至 main
- 修改其他 AI Worktree
- 刪除其他 AI Branch

如正式版發生問題：

建立 Hotfix Branch 修正。

修正完成：

```
Hotfix

↓

main

↓

develop
```

保持兩個 Branch 一致。

---

# Best Practices

- 每個 Commit 僅處理一件事情。
- 每次 Push 前確認功能可正常運作。
- 保持 develop 可正常 Build。
- 保持 main 永遠可發布。
- AI 僅於自己的 Worktree 工作。
- Worktree 只負責固定 Branch，不互相 Checkout。
- 所有新功能皆先進 develop，再發布至 main。