# VFX_AGENT_WORKFLOW.md

# VFX 多 Agent 協作規範

本文件定義 **VFX 工程專用** 的多 Agent 協作流程。

本文件**不是全域 Agent 規則**。

只有當目前任務明確屬於 VFX 工程（第 1 節）時才啟用；
其他任務完全維持專案原本的工作方式。

---

# 0. 文件位階與影響範圍

## 0.1 位階

```
AI_RULES.md            ← 最高層共通規範，任何情況都必須遵守
    │
    ├── AGENTS.md / docs/AI_WORKFLOW.md / docs/AI_TASKS.md   ← 專案既有流程
    │
    └── docs/vfx/VFX_AGENT_WORKFLOW.md（本文件）             ← 僅 VFX 任務啟用
```

本文件與 `AI_RULES.md` 衝突時，一律以 `AI_RULES.md` 為準。

`AI_RULES.md` 中的技術性限制（模擬層不得改 ESM、共載檔不得寫入狀態、
協議變更一律改 `js/worker/protocol.js`、不得自行合併或推送 `develop`）
在 VFX 任務中同樣有效，本文件不提供任何豁免。

## 0.2 本文件不修改的東西

本文件**不修改**下列文件的任何既有規定：

- `CLAUDE.md`
- `AI_RULES.md`
- `AGENTS.md`
- `GIT_WORKFLOW.md`
- `docs/AI_WORKFLOW.md`
- `docs/AI_TASKS.md`

## 0.3 與 CLAUDE.md 的角色差異

`CLAUDE.md` 定義 Claude 的專案角色為 **Architecture Engineer**，
實作可視情況交由 Codex。

在 **VFX 任務內**，Claude 的角色調整為 **Lead Engineer**：架構與實作皆由 Claude 負責，
Codex 只做 Review（第 3 節）。

此調整**僅在 VFX 任務範圍內生效**，離開 VFX 任務即自動失效，
不改寫 `CLAUDE.md`，也不影響任何非 VFX 任務的分派方式。

---

# 1. 適用範圍

## 1.1 適用（啟用本工作流）

- VFX Editor
- VFX Runtime
- VFX Renderer
- Particle System
- VFX Sprite
- Animated Sprite / Flipbook
- Beam
- Trail
- Ground Ring / Shockwave
- Glow
- Distortion
- VFX Shader
- VFX Mask
- UV Scroll
- VFX Preset
- VFX JSON / Schema
- VFX Asset loading
- VFX Preview
- VFX Timeline
- VFX performance optimization

## 1.2 不適用（維持原有流程）

- Gameplay
- 戰鬥數值
- 角色系統
- 怪物 AI
- 關卡
- 掉落
- 存檔
- 一般 UI
- 經濟系統
- 非 VFX Bug
- 其他既有遊戲功能

## 1.3 判斷範例

| 需求 | 判定 | 流程 |
|---|---|---|
| 火龍捲增加 Distortion | VFX | 啟用本工作流 |
| 火龍捲傷害從 500 改成 600 | Gameplay | 不啟用，依既有流程 |
| 新增 Beam 圖層與對應 Schema 欄位 | VFX | 啟用，且建議 Codex Review |
| 技能特效顏色由橘改為藍白 | VFX（低風險） | 啟用，Claude 可單獨完成 |
| 技能施放間隔調整 | Gameplay | 不啟用 |
| 特效在手機瀏覽器掉幀 | VFX（效能） | 啟用，建議 Codex Review |
| 背包虛擬捲動卡頓 | 一般 UI | 不啟用 |

## 1.4 混合任務（同時含 Gameplay 與 VFX）

**只有 VFX 部分可以使用本工作流。**

處理原則：

1. Claude 先把需求切成「Gameplay 子任務」與「VFX 子任務」，並在回報中寫明切分結果。
2. Gameplay 子任務依專案既有流程處理（`AGENTS.md`、`docs/AI_WORKFLOW.md`）。
3. VFX 子任務才適用本文件的角色分工、Review 次數限制與 Worktree 規則。
4. **不得**因為任務中含有 VFX 成分，就把整包需求（含數值、規則、存檔）
   一併塞進本工作流，或據此呼叫 Codex／Antigravity 檢查非 VFX 的部分。
5. 若切分本身不明確，先向使用者確認再開始。

---

# 2. 目前的 VFX 程式範圍（現況記錄）

啟用本工作流前，先確認實際受影響的檔案。目前專案的 VFX 相關資產：

| 路徑 | 內容 |
|---|---|
| `js/vfx.js` | DOM／CSS 技能特效層（高塔仍走這條） |
| `js/battle-renderer.js` | PixiJS 即時戰鬥渲染器（Canvas／WebGL 側） |
| `js/vfx-core.js` | VFX Core：Preset 的純運算層（不碰 DOM、不認得遊戲概念） |
| `js/vfx-pixi-backend.js` | Core 的 Pixi 繪圖後端 |
| `js/vfx-runtime.js` | Runtime Adapter：VFX 事件 → 角色 → 擺哪裡（2026-09-03） |
| `js/vendor/pixi.min.js` | PixiJS 函式庫 |
| `vfx/presets/`、`vfx/layouts/` | 151 份 Preset 與各自的單一根群組 layout |
| `vfx/asset-index.json`、`vfx/asset-semantics.json`、`vfx/shipped-assets.json` | 素材索引、語意層、出貨清單 |
| `images/vfx/assets/` | 匯出的正式素材（85 個） |
| `images/vfx/`、`images/sprites/` | 既有 VFX 貼圖與序列幀圖集 |
| `tools/vfx/editor/`、`tools/vfx/editor-server.cjs` | VFX Editor 與它的本機伺服器 |
| `tools/vfx/authoring/` | Preset 製作工具（目錄、工具箱、各家族製作腳本；不進 Runtime） |
| `tests/*vfx*.test.cjs` | VFX 相關自動測試 |
| `docs/ANTIGRAVITY_VFX_UI_TEST_CASES.md` | 既有 VFX UI 測試案例 |

**VFX Editor 已建立**（`啟動VFX編輯器.bat`），Runtime Adapter 也已接上遊戲。
設計與進度見 `VFX_RUNTIME_ADAPTER.md`。

此表為現況記錄，不是清單式的授權範圍；實際修改前一律依 `AI_RULES.md` 第 3.2 節
以目前程式碼重新分析影響範圍。

---

# 3. Agent 角色

## 3.1 Claude Code — Lead Engineer

負責：

- VFX 整體架構
- 任務拆分
- 主要實作
- 最終技術決策
- 整合
- 測試
- 判斷其他 Agent 的建議是否採用

Claude 是 VFX 工程唯一的實作者與決策者。
Codex 與 Antigravity 的產出都是**建議**，採用與否由 Claude 判斷並說明理由。

## 3.2 Codex — Independent Code / Architecture Reviewer

負責：

- Code Review
- Architecture Review
- WebGL Performance Review
- Shader / Rendering Review
- Memory / Object Allocation Review
- Mobile / Browser Compatibility Review
- Regression Risk Review

**預設：Codex 只 Review，不修改 Claude worktree。**

## 3.3 Antigravity — VFX UI / Browser / UX QA

**定位：Optional Manual QA Agent（選用，且一律由使用者人工執行）。**

負責：

- VFX Editor 操作流程
- Inspector usability
- Preview correctness
- Browser behavior
- UI / UX
- Save / Load 操作驗證
- 視覺化編輯流程檢查

**預設：Antigravity 不直接修改 Claude worktree。**

### 3.3.1 不得由 CLI 自動呼叫

**Claude 不得嘗試透過 CLI 自動呼叫 Antigravity 執行 VFX QA。**

依 `docs/vfx/ANTIGRAVITY_CLI_CAPABILITIES.md`（2026-08-31 實測，Antigravity IDE 1.107.0）：
CLI 沒有 headless、沒有結果輸出（stdout／輸出檔／JSON）、沒有唯讀旗標，
CLI 層也沒有 browser automation，判定為「不適合 CLI 自動整合」。
在無法取回結果、也無法保證不寫檔的前提下，包裝自動呼叫工具只會製造「已整合」的錯覺。

因此 Antigravity QA 一律由使用者在 Antigravity IDE 內人工執行。

### 3.3.2 重新評估自動整合的條件

只有當 Antigravity 同時提供下列**可靠**能力時，才重新評估自動整合：

- headless（non-interactive）執行
- result output（stdout／輸出檔／JSON，結論可程式化取回）
- read-only（可強制不修改工作區，等同 Codex 的 `--sandbox read-only`）
- browser automation API

在此之前不得建立 Antigravity 自動呼叫工具。

## 3.4 呼叫時機

本文件只定義「什麼情況建議呼叫哪個 Agent」，
**實際是否呼叫由使用者決定**（`CLAUDE.md` 第 10 節）。

Claude 不得因為本文件存在就自動呼叫 Codex 或 Antigravity；
應在回報中說明「建議進行哪一項 Review／QA、原因為何」，由使用者裁決。

---

# 4. 標準 VFX 工作流程

## 4.1 完整流程

```
User
 ↓
Claude Code
 ↓
分析 / 設計 / 實作
 ↓
本地測試
 ↓
Codex Review
 ↓
Claude 判斷 Review 結果
 ↓
必要時修正
 ↓
Antigravity UI / Browser QA（選用，且為人工執行：
   Claude 出 QA 指示書 → 使用者在 IDE 執行 → 結果交回 Claude）
 ↓
Claude 最終整合與驗證
 ↓
回報 User
```

**不是所有 VFX 修改都必須跑完整流程。**

## 4.2 Claude 可單獨完成

- 小型數值調整
- 已有 Preset 微調
- 顏色修改
- 單純參數調整
- 明確且低風險的小 Bug

## 4.3 建議 Codex Review

- 新 VFX Layer
- Renderer 修改
- Particle Engine 修改
- Shader 系統
- JSON Schema 修改
- Runtime 架構修改
- 效能敏感修改
- 大型重構

## 4.4 建議 Antigravity QA

**Antigravity QA 不是每個 VFX Feature 的必要步驟。**
只有 UI / UX / Browser interaction 值得額外驗證時才使用。

以下情況建議進行：

- VFX Editor UI
- Inspector
- Preview 操作
- Timeline
- Asset Browser
- Preset Browser
- Save / Load UI
- Browser interaction
- UX / usability

### 4.4.1 交付方式：QA 指示書

Antigravity 不由 CLI 自動呼叫（第 3.3.1 節），
因此 Claude 在上述情況下的交付物是一份**QA 指示書**，至少包含：

| 欄位 | 內容 |
|---|---|
| Feature | 這次要驗證的 VFX 功能 |
| Test Goal | 這次 QA 要證明什麼 |
| Preconditions | 前置狀態、測試資料、開啟方式 |
| Test Steps | 可照做的操作步驟，逐步編號 |
| Expected Result | 每一步的預期結果 |
| Edge Cases | 必須額外測試的邊界情況 |
| Visual / UX checks | 視覺表現與操作手感的主觀檢查項 |

執行與回收：

```
Claude 產生 QA 指示書
 ↓
使用者自行在 Antigravity IDE 執行
 ↓
Antigravity 的結果交回 Claude
 ↓
Claude 負責最終判斷與整合
```

QA 結果屬於建議（第 3.1 節），採用與否由 Claude 判斷並說明理由。

## 4.5 Material Gap（素材不足時的長期規則）

適用於所有 VFX 工作：選材、設計、Preset、Editor、Runtime、改善既有效果。

**禁止為了「完成任務」而勉強使用不適合的素材。**
判定為素材問題時，必須主動提出 Material Gap，而不是硬做或無止境調參數。

### 4.5.1 必須提出的情況（任一即可）

1. 現有素材沒有適合的類型
2. 有類似素材，但品質／形狀／解析度／Alpha／可染色性／可平鋪性不足
3. 勉強使用會明顯降低 VFX 品質
4. 只能靠大量複雜 Shader 或程式技巧，才能補救「用對素材就很簡單」的問題
5. 做得出「能看」的結果，但與目標仍有明顯品質差距
6. **使用者看過實機後表示不夠理想／不夠真實／不夠有質感／不符預期**

第 6 點觸發時，必須依序重新診斷，不得永遠只調參數：

```
Visual Problem → Layer / Parameter 診斷 → Shader 診斷 → Material 診斷
```

### 4.5.2 格式（不得只說「素材不足」）

至少包含：Missing Asset Type、Intended Usage、Required 或 Recommended、
Desired Visual Characteristics、Technical Requirements、Current Substitute、
Quality Impact；知道的話再加 Suggested Search Keywords，
讓使用者知道該去素材網站找什麼。

### 4.5.3 Required 與 Recommended 必須分開

- **Required**：沒有這類素材，核心效果無法合理完成
- **Recommended**：現在能完成，但補素材能顯著提高品質

不得因為「存在更漂亮的素材」就持續要求補素材。

### 4.5.4 反向濫用同樣禁止

若問題可由 particle behavior、shader、mask、UV 動畫、圖層組合、混合模式、
顏色、縮放、旋轉、時序合理解決，就用現有素材解決。
只有當「補素材」相較「繼續堆程式技巧」能明顯改善品質、複雜度或效能時才提出。

### 4.5.5 不得自行取得第三方素材

可以指出缺口、建議種類與規格、提供搜尋關鍵字；
但除非使用者明確要求，**不得自行下載、加入或替換**第三方素材。
授權狀態不明的素材不得進入 Asset Library。

### 4.5.6 納入素材充分性驗收

素材搜尋不只要回答「有哪些素材可用」，還要回答「現有素材是否足以完成這個 VFX」。
每次選材驗收都必須輸出下列其一，不是 SUFFICIENT 就必須附 Material Gap：

`SUFFICIENT` ／ `SUFFICIENT_WITH_LIMITATIONS` ／ `INSUFFICIENT`

工具：`node tools/vfx/semantic-query.cjs --coverage <spec.json>`

## 4.6 分級判斷責任

分級由 Claude 判斷，並在回報中寫出判斷結果與理由。

判斷標準以**影響範圍**為主，不是以修改行數為主：

- 只動單一特效的常數 → 4.2
- 動到多個特效共用的繪製路徑、生命週期或資源載入 → 4.3
- 使用者需要用滑鼠操作才能驗證的行為 → 4.4

判斷不確定時，往嚴格的一級靠。

---

# 5. Review 次數限制

## 5.1 上限

| 項目 | 預設上限 | 條件性追加 |
|---|---|---|
| Codex Review | 1 次 | 發現 CRITICAL 問題時，Claude 修正後最多再 1 次 |
| Antigravity QA | 1 次 | 無 |

即單一 VFX Feature 的 Codex Review 上限為 **2 次**，Antigravity QA 上限為 **1 次**。

## 5.2 問題分級

追加 Review 只在 CRITICAL 成立時觸發，因此分級必須明確：

**CRITICAL**（可追加 1 次 Review）

- 功能不正確或直接破圖
- Crash、WebGL context lost、載入失敗
- 記憶體洩漏、未釋放的 texture／Graphics
- 明顯掉幀或每幀配置造成的 GC 尖峰
- 破壞既有特效或既有測試（Regression）
- 破壞存檔、協議或 Schema 相容性

**MAJOR**（不追加 Review；由 Claude 直接修正或記錄）

- 架構不理想但可運作
- 重複程式、命名不一致
- 邊界情況處理不足但不影響主流程

**MINOR**（不追加 Review）

- 風格、註解、可讀性建議

## 5.3 停止條件

出現下列任一情況，**立即停止自動修正並回報使用者**：

- 已用完 Review 次數，問題仍未解決
- Codex 與 Antigravity 的建議互相衝突，且 Claude 無法單方面判定
- 修正需要擴大到 VFX 範圍以外（Gameplay、存檔、協議）
- 修正需要變更需求本身

回報時必須說明：目前狀態、剩餘問題、已嘗試的方案、建議的下一步。

## 5.4 禁止事項

- 無限 Review
- Agent 互相反覆討論
- 無限制的自動修正循環
- 為了「讓 Review 通過」而擴大修改範圍
- 把同一份程式換個說法重複送審以繞過次數上限

## 5.5 CRITICAL 修正的限縮驗證（`--mode fix-verification`）

`tools/vfx/review-with-codex.cjs` 提供兩種模式：

| 模式 | 用途 | 輸出 |
|---|---|---|
| `full`（預設） | 一般 Codex Review，主動找問題 | CRITICAL / MAJOR / MINOR / RECOMMENDATIONS |
| `fix-verification` | 5.1 表格中「CRITICAL 修正後的追加驗證」 | 各項 PASS / FAIL 與 FINAL |

```
node tools/vfx/review-with-codex.cjs "<scope>" --mode fix-verification --brief <說明檔>
```

`--brief` 說明本次要驗證哪些 CRITICAL、修正位置、對應測試，以及必須維持的
invariant。內容每次不同，由呼叫端提供；工具只負責把它包進固定的限縮框架。

限縮模式**只判定已知的 CRITICAL 修好了沒有**，明確禁止 Codex 找新的
MAJOR／MINOR、review 未列在說明檔中的子系統、或提出架構重寫。
範圍一旦放寬，就等於偷跑一輪完整 Review。

兩種模式共用同一支工具，因此唯讀保護完全相同：Codex 一律以
`--sandbox read-only` 執行，工具在前後各取一次工作樹快照
（分支、HEAD、`git status`、`git diff` 雜湊、未追蹤檔內容雜湊）並比對，
不一致即以 exit code 3 判定唯讀違規。不得為了限縮驗證另建一套 review 機制。

**本節不改變 5.1 的次數規則**：一般 Codex Review 仍為預設 1 次，
只有 CRITICAL 修正才需要再次驗證，且仍受 5.1 的上限約束。
限縮驗證不是「第三輪 Review」，也不得用來取得額外的完整 Review 次數。

---

# 6. Worktree 安全規則

本專案使用 Git worktree，Claude、Codex、Antigravity 各自可能具有獨立 worktree
（`GIT_WORKFLOW.md`）：

| Folder | Branch |
|---|---|
| `claude` | `ai/claude` |
| `codex` | `ai/codex` |
| `antigravity` | `ai/antigravity` |
| `develop` | `develop` |
| `production` | `main` |

規則：

1. **Claude worktree 是 VFX 主開發工作區。**
2. Codex 在 Claude worktree 執行 Review 時**只能讀取，不得修改**。
3. Antigravity 在 Claude worktree 執行 QA 時**不得修改**。
4. 若未來需要 Codex 或 Antigravity 實際開發，**必須使用各自的 worktree / branch**。
5. **不允許多個 Agent 同時修改同一個 worktree。**
6. 跨 worktree 的程式修改必須透過明確的 Git 整合流程處理
   （`GIT_WORKFLOW.md`、`docs/AI_WORKFLOW.md` 第 9 節）。
7. **不得自動覆蓋其他 Agent 尚未整合的修改。**

補充（沿用既有規範，非本文件新增）：

- 修改任何既有檔案前，仍須執行 `AI_RULES.md` 第 3.2 節的衝突預檢；
  查到衝突來源必須先告知使用者並取得同意。
- 「只讀不寫」是**約定**，不是技術保證。Review 或 QA 結束後，
  Claude 應自行以 `git status` 確認工作區未被更動。
- 改動 `js/` 下的檔案時，仍須依既有慣例更新 `index.html` 的 `?v=` 快取版本號。

---

# 7. 啟用與停用

## 7.1 啟用條件

同時滿足下列兩點才啟用本工作流：

1. 任務內容落在第 1.1 節的適用範圍內。
2. Claude 在開始前於回報中**明確聲明**「本任務套用 VFX 工作流」，
   並說明適用的是全部或僅其中的 VFX 子任務。

## 7.2 停用

- 任務不屬於 VFX 工程 → 完全維持專案原本的工作方式。
- VFX 子任務完成後，後續的 Gameplay／整合／發版流程回到既有規範。

## 7.3 明確禁止

- **不得**因為本文件存在，就讓其他專案任務自動使用 Codex 或 Antigravity。
- **不得**把本文件的角色定義（Claude=Lead、Codex=Reviewer only）
  套用到非 VFX 任務。
- **不得**以本文件為由跳過 `AI_RULES.md` 的任何規定。

---

# 8. 目前階段

已建立：本規範文件、`tools/vfx/review-with-codex.cjs`、
`docs/vfx/ANTIGRAVITY_CLI_CAPABILITIES.md`。

VFX Core、Pixi Backend、Editor、Asset Library／Semantic Search、
Production Asset Export、Editor 存檔回寫皆已完成並通過人工驗收。
**自 P0-2 起，VFX 正式進入 Production 階段，開發策略改為第 9 節。**

## 8.1 Antigravity 的正式規則（非階段性狀態）

Antigravity 是 **Optional Manual QA Agent**，**不進行 CLI 自動呼叫**（第 3.3.1 節）。
需要 UI / UX / Browser QA 時，由 Claude 產生 QA 指示書（第 4.4.1 節），
使用者在 Antigravity IDE 人工執行，結果再交回 Claude 判斷與整合。

這是常態規則，不是「這個階段還沒做」。

## 8.2 未經使用者指示不得自行開始

- VFX Editor 開發
- 呼叫 Codex（工具已就緒，是否執行仍由使用者決定，第 3.4 節）
- 修改 `CLAUDE.md` 或其他既有規則文件
- 修改 VFX 以外的任何程式碼
- Commit

下一步由使用者決定。

---

# 9. VFX Production 階段

> **本節只適用於 VFX Production，不是 Idle-RPG 的全域工作流。**
> Gameplay、存檔、UI、經濟數值等工作一律沿用原有流程（第 1.2 節）。

## 9.1 開發策略：工具跟著真實需求走

Production 階段**不再以「先把 Editor 所有功能做完」為開發策略**。

```
先製作真正的 VFX，實際遇到工具痛點之後才補工具。
```

以下項目**不得預先實作**，除非真實 Production 已證明其中某項成為明確阻礙：

- Timeline
- Curve GUI
- Zoom / Pan
- Duplicate Layer
- Layer Reorder
- Undo / Redo
- Mask
- Vortex / Attractor
- Runtime Adapter

「明確阻礙」指的是在實際做特效的過程中反覆卡住並可具體描述，
不是「想像中將來會需要」。

## 9.2 標準流程（Reference-driven）

```
Reference
  ↓
Reference Breakdown
  ↓
Semantic Asset Search
  ↓
VFX Prototype
  ↓
Preview（使用者可觀看）
  ↓
User Feedback
  ↓
Refinement
  ↓
Final Preset
```

## 9.3 Reference 的使用方式

使用者可提供遊戲截圖、VFX 截圖、動畫截圖，或多張不同來源的 Reference。

**Reference 不代表逐像素複製。** 目標是拆解它的視覺語言：

silhouette、color hierarchy、brightness hierarchy、motion、particle density、
particle direction、timing、scale、layer composition、glow、trail、smoke、
ground interaction、impact/readability

再用**我們自己的** VFX Runtime、Preset Schema、`effects-materials` Asset Library、
Semantic Search 與 procedural 能力，重新建立相近的視覺語言。

多份 Reference 可以分工，例如：

| Reference | 負責 |
| --- | --- |
| A | silhouette |
| B | color |
| C | particle |
| D | ground effect |

**必須記錄每份 Reference 的用途與優先順序**，否則後續回饋無法判斷該調哪一項。

## 9.4 Reference Breakdown（動手前必做）

看到 Reference 不得直接開始堆 Layer。先回答：

- Reference 的主要視覺特徵是什麼？
- 哪些目前 Runtime 做得到？
- 哪些只能近似？
- 哪些目前做不到？
- 哪些是 **Material Gap**（素材不足，見第 4.5 節）？
- 哪些是真正的 **Core Gap**（能力不足）？

Material Gap 與 Core Gap 必須分開講。素材不足卻去改 Core，
是這條線最容易犯、也最貴的錯。

## 9.5 不得因為 Reference 用了我們沒有的技術就擴充 Core

Reference 若使用 volumetric rendering、3D mesh、GPU simulation、distortion、
flow map、depth particle、複雜 masking 等技術：

**先用現有能力做低成本近似。**

只有在真實 Production 證明現有能力無法達到可接受結果之後，
才提出 Core Enhancement，並依第 4 節的流程處理。

## 9.6 使用者的回饋是視覺語言，不是參數

使用者不是 VFX 專業美術。**不得要求使用者知道**
`emissionRate`、`alphaOverLife`、`rotationSpeed`、particle lifetime、
blend mode、velocity、curve control point 這類欄位。

使用者只需要用視覺語言回饋，例如：

> 「火太散」「旋轉不夠明顯」「核心不夠亮」「速度太快」
> 「粒子太多」「不像 Reference A」「我要更有重量感」

**把這些翻譯成具體參數修改是 Claude 的工作。**

## 9.7 兩個合理方向時先做低成本 Preview

若存在 A / B 兩個合理的視覺方向：

**不得自行選一個並花大量時間做到最終版。**

先各做一份低成本 Preview，讓使用者看過後決定方向。

## 9.8 中間產品制度：視覺工作不得只用文字證據交付

視覺型工作**不得**只以 tests、logs、JSON、benchmark 作為完成證據。

正式 VFX 應在適當節點提供使用者可直接觀看的 Editor Preview：

| Checkpoint | 內容 |
| --- | --- |
| 1 | 主體輪廓 / 基本運動 |
| 2 | Particle / Glow / Trail / Secondary Motion |
| 3 | Timing / Color / Polish |
| Final | 最終候選 |

不要求機械式的 30% / 60% / 90%。核心原則是：

```
在視覺方向還便宜、還容易修改的時候讓使用者看到，
而不是全部做完才展示。
```

Preview 的提供方式：啟動既有 Editor Server，給出
`?preset=<id>` 網址讓使用者實際觀看與操作。

## 9.9 新素材匯入與自動分類

使用者取得新素材包時，分類是 **Agent 的工作**，不是使用者的工作 ——
不得要求使用者自己判斷每張圖屬於 particle／lightning／trail／glow／noise…
哪一類。

完整規則（兩層分類模型、新分類的建立條件、新舊素材的搬動差異、`_inbox`
管線、信心度、variantGroup、重複偵測、Classification Plan 格式）
一律以 **`VFX_ASSET_LIBRARY_DESIGN.md` §8 為 SSOT**，本文件不重複。

只重申三條最容易違反的：

1. **第一輪只做 Inventory ＋ Classification Plan，不得 Move。**
2. **已被正式 Preset 引用的素材預設不搬**；真要搬必須走完整 migration。
3. **IMAGE CONTENT > FILENAME** —— 檔名可能是錯的，必須實際看素材內容。

## 9.10 Reference 與版權

第三方遊戲或網路上的 VFX 圖片**只能**作為 visual / composition / motion /
color reference。

不得：

- 擷取第三方遊戲素材
- 直接使用來源遊戲的 texture
- 嘗試逐像素重建具有高度識別性的美術
- 把 Reference 當成我們自己的 production asset

最終 VFX 必須由我們自己的 Runtime ＋ 合法 Asset Library ＋
procedural / data-driven composition 建立。

這一條與第 4.5.5 節（不得自行取得第三方素材）一致，不是新增的例外。
