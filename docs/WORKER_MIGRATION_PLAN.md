# Web Worker 架構遷移：三方協作計劃（暫時文件）

> **本文件為暫時文件**，僅在 Web Worker 遷移期間有效，完成 P5 後刪除。
> 適用對象：Claude Code、Codex、Antigravity。
> 本文件不取代 `docs/AI_WORKFLOW.md`；Git 安全規則、Commit 規則、回報格式一律以 `AI_WORKFLOW.md` 為準。

---

## 0. 目標

把遊戲模擬（狀態、戰鬥、成長、存檔計算）搬進 Web Worker 獨立執行緒，主執行緒只保留 DOM、事件、渲染與瀏覽器 I/O。

**達成後的收益**

- 主執行緒不再被模擬阻塞：批次分解、千次鑄造、離線結算不再凍結畫面。
- 遊戲狀態 `G` 只存在於 Worker，成為唯一權威來源；UI 無法直接改狀態。
- 計時不再與渲染、GC 搶同一條執行緒。

**不是收益（請勿誤解）**

- Worker **不能**豁免瀏覽器背景分頁節流。Chrome 對背景分頁的 worker timer 一樣節流。
- 因此 `main.js` 既有的「經過時間補償（`_lastTickAt`）＋隱藏 60 秒後轉離線結算」機制**必須完整保留**，不得因為進了 Worker 就移除。

---

## 1. 現況掃描（實測，本計劃的依據）

| 項目 | 實測結果 |
|---|---|
| 載入方式 | `index.html` 依序載入 21 支傳統 `<script>`，全域變數共享（`G`、`GT`），無 ESM |
| 模擬層規模 | 17 支檔案，約 13,000 行 |
| 模擬層碰 DOM | 極少：`document.` 僅 4 處（util 1、combat 1、save 2） |
| 模擬層碰 UI | `blog/flog` 約 88 處；`window.recordLoot*` 11 處（皆在 combat.js）；`window.` 存在性檢查 73 處 |
| 存檔層 | `save.js` 內 `localStorage` 53 處，另有 `indexedDB` 與 File System Access |
| UI 讀狀態 | `ui.js` 使用 `G` 共 226 處，其中**寫入僅 16 處** |
| UI→模擬呼叫 | 216 個函式 / 1073 個呼叫點，其中**會變更狀態的 60 個**（含間接改物件、標記 `UI.dirty`、呼叫 `markStatsDirty` 者） |
| UI 直接改物件 | `ui.js` 另有 7 處直接改遊戲物件屬性（`it.locked`、`f.autoDust`、`f.autoForge` 等） |
| 測試 | 116 支 `tests/*.test.cjs`／512 個案例，以 `vm.createContext` + `context.window = context` 直接載入 js 原始檔 |
| ⚠️ 測試基準線 | **開工前即有 95 個案例失敗（散在 32 支檔案）**，417 通過。與本次遷移無關，屬既有狀態 |

**兩個決定性結論**

1. 模擬層幾乎不碰 DOM → 用 `importScripts()` 原封不動載入 Worker 即可，**不需要改寫成 ESM**。
2. 指令介面規模有限（凍結後為 67 條指令） → 協議可一次凍結，這是三方並行的前提。

---

## 2. 目標架構

```
主執行緒 (index.html)                      Worker (js/worker/sim.worker.js)
├─ ui.js          DOM / 事件 / 渲染         ├─ importScripts(util, data, formula, stats,
├─ gm.js          指令輸入                  │   item, skills, talents, player, special_rules,
├─ bridge.js      ★新增 send/on             │   combat, legendary, potential, tower, factory,
├─ storage.js     ★新增 localStorage /      │   newforge, forge, save)
│                 IndexedDB / 資料夾存檔    ├─ shim.js  ★blog/flog/recordLoot* → 事件佇列
└─ (共載) util/data/formula（唯讀）         └─ loop.js  ★唯一 setInterval(gameTick)
        ↑                    ↓
   snapshot / event      command
        └──── postMessage(structured clone) ────┘
```

- `G` 只存在於 Worker。主執行緒的 `G` 退化為「上一次 snapshot 的唯讀鏡像」。
- `util.js` / `data.js` / `formula.js` 這類純函式與設定表在**兩邊都載入**，讓 `ui.js` 既有的 `fmt`、`esc`、`clamp`、設定表查詢維持同步呼叫，大幅縮小改動面。

---

## 3. 關鍵設計決策（不得擅自變更）

1. **不使用 SharedArrayBuffer。** SAB 需要 COOP/COEP 跨源隔離標頭，而 `.claude/serve.ps1` 為簡易靜態伺服器、部署環境亦未必可設。一律使用 `postMessage` structured clone。
2. **模擬層維持傳統全域腳本寫法。** 禁止把 `js/*.js` 模擬層改為 ESM 或 `export`。一旦改成 ESM，116 支既有測試會全數失效。此為硬規則。
3. **存檔 I/O 留在主執行緒。** Worker 無 `localStorage`，`showDirectoryPicker` 亦僅主執行緒可用。
   - Worker 負責：`newGameState` / `migrateSave` / `applyOfflineProgress` / 序列化
   - 主執行緒負責：實際讀寫 localStorage、IndexedDB、存檔資料夾
   - **存檔格式不得改變**，必須向後相容既有存檔。
4. **日誌與掉落統計事件化。** Worker 內 `blog` / `flog` / `window.recordLoot*` 改為推入事件佇列，隨 snapshot 合批回主執行緒渲染。禁止每則日誌一次 `postMessage`。
5. **Snapshot 分層，禁止每 200ms 傳送整份 `G`。** 背包數百件裝備全量 clone 會讓卡頓從「計算」轉移到「序列化」。
   - `tick`（5Hz）：僅頂欄資源、戰鬥狀態、進度條等小量欄位
   - `panel`：切換到背包／技能／熔爐等頁籤時才索取該面板資料
   - `full`：開檔、讀檔、GM 指令後才送整份
6. **保留背景休眠與離線結算語意。** 見第 0 節。

---

## 4. 訊息協議草案

> **已於 2026-07-27 凍結為 v1。** 正式定義在 `js/worker/protocol.js`（單一資料來源），
> 說明在 `docs/WORKER_PROTOCOL.md`。以下僅保留摘要，細節一律以 `protocol.js` 為準。
> **任何人不得自行擴充協議**，見第 7 節。

### 主執行緒 → Worker

| 型別 | 用途 | payload |
|---|---|---|
| `boot` | 開機，帶入主執行緒讀出的存檔 | `{ save \| null }` |
| `cmd` | 執行一個變更指令 | `{ id, name, args }` |
| `panel` | 索取某面板的完整資料 | `{ name }` |
| `visibility` | 分頁顯示狀態變更 | `{ hidden, at }` |
| `saveResult` | 回報主執行緒寫入結果 | `{ ok, error? }` |

### Worker → 主執行緒

| 型別 | 用途 | payload |
|---|---|---|
| `booted` | 開機完成 | `{ snapshot, offlineSummary \| null, notices[] }` |
| `tick` | 高頻小量狀態 | `{ view, events[] }` |
| `panel` | 面板資料 | `{ name, data }` |
| `full` | 完整狀態 | `{ snapshot }` |
| `persist` | 要求主執行緒寫入存檔 | `{ json, kind }` |
| `ack` | 指令完成／失敗 | `{ id, ok, error? }` |

### 指令介面（v1 凍結結果）

67 條指令，分為 `stage`(3)、`combat`(2)、`item`(7)、`gem`(12)、`player`(5)、`skill`(9)、
`talent`(4)、`tower`(2)、`forge`(9)、`newforge`(7)、`factory`(2)、`settings`(1)、`save`(3)、`gm`(1)。

三個必讀重點（細節見 `docs/WORKER_PROTOCOL.md` 第 4 節）：

1. **不能傳物件參考。** 既有吃 item 物件的函式一律改傳 `itemId`；Worker 端解析後呼叫原函式，不得另寫平行實作。
2. **`fn: null` 的 13 條指令**表示該段邏輯目前寫在 `ui.js` 裡，P3 必須搬進 Worker（含 `salvageAllUnlocked` 整段批次分解邏輯）。
3. **`INTERNAL_ONLY` 的 5 個函式**（`addToInventory`、`rollGemShop`、`shopHourlyReset`、`forgeLog`、`newForgeReturnUnroutable`）目前被 `ui.js` 直接呼叫，屬 UI 越界驅動模擬內部，P3 必須移除這些呼叫點，不得為它們開指令通道。

---

## 5. 階段與檔案所有權

**同一階段內，同一支檔案只有一個 AI 可以修改。** 未列於自己欄位的檔案一律禁止修改。

| 階段 | Claude | Codex | Antigravity |
|---|---|---|---|
| **P0 協議凍結** | `docs/WORKER_PROTOCOL.md`、`js/worker/protocol.js` | 待命：讀協議並回報疑義（不改檔） | 建立**基準線**：現版效能、存檔、離線收益的實測數據與錄影 |
| **P1 Worker 骨架** | `js/worker/sim.worker.js`、`js/worker/shim.js`、`js/bridge.js` | `tests/worker-protocol.test.cjs`、`tests/worker-shim.test.cjs`（自有新檔） | `?worker=1` 空跑驗證、Console 錯誤檢查 |
| **P2 存檔搬遷** | `js/save.js` 拆分、`js/storage.js` | `tools/`、參數表、既有測試修補（禁止碰 `js/worker/*`、`js/save.js`） | 存檔相容性驗證：舊存檔讀入、離線收益、重整、切頁 |
| **P3 UI 去狀態化** | `js/main.js`、`js/worker/*`、`js/gm.js` | **獨占 `js/ui.js`**：依協議把 16 處寫入＋32 個變更呼叫改為 `send(cmd)`，`G` 改讀 snapshot | 全頁籤互動迴歸測試、產出重現步驟 |
| **P4 效能收斂** | snapshot 分層策略、`js/worker/*` | `js/ui.js` 渲染節流配合 | 效能量測，對照 P0 基準線 |
| **P5 移除 flag** | `index.html`、移除舊單執行緒路徑 | 清理死碼（需 Claude review 後才動手） | 全流程驗收 |

### ui.js 衝突防制

`js/ui.js` 6069 行，是最大衝突來源。規則：

- **P3 起 `js/ui.js` 專屬 Codex。**
- Claude 若需要改 `ui.js`，一律以 Code Review 意見交給 Codex 執行，不得自行動手。
- Antigravity 全程不得修改 `ui.js`。

### Feature flag

P1 起以 `?worker=1` 切換新舊路徑，舊單執行緒路徑在 P5 前保持可用。任何階段若新路徑失敗，移除 query 參數即可回到舊路徑。

---

## 5.5 測試基準線（重要）

`npm test` 在**遷移開工前**就已經有失敗案例：

```
417 pass / 95 fail（32 支檔案）
```

原因與本次遷移無關（多數是斷言 `ui.js` 原始碼片段、數值公式已調整等既有落差）。因此：

- **驗收標準不是「全綠」，而是「不得新增失敗案例」。**
- 每階段開始與結束都要跑一次 `npm test`，比對失敗數與失敗清單。
- 失敗數只要上升，或既有失敗清單出現新名字，該階段不得交付。
- 重跑基準線：`npm test`，統計方式見本節數字。

既有 95 個失敗應另開任務處理，**不併入本次遷移**（見第 9 節待決事項）。

---

## 6. 合流節奏

1. 階段開始：三方各自對自己的分支執行 `git pull --ff-only`（與 develop 同步）。
2. 各自在 `ai/claude` / `ai/codex` / `ai/antigravity` 開發，每個獨立功能一個 commit。
3. 階段結束：三方依 `AI_WORKFLOW.md` 第 8 節格式回報。
4. **由使用者合併 develop。** 三個 AI 皆不得自行合併或推送 develop。
5. 合併順序固定：Claude（架構）→ Codex（UI／測試）→ Antigravity（通常僅測試報告）。
6. 合併完成後三方再同步一次，才進入下一階段。

**階段內不跨階段搶跑。** 例如 P1 期間 Codex 不得先動 `ui.js`。

---

## 7. 阻塞與例外處理

- Codex 或 Antigravity 對協議有疑義 → **不得自行擴充或修改協議**。寫入本文件第 9 節「待決事項」，由 Claude 裁決後更新 `protocol.js`。
- Antigravity 發現 bug → 只產出重現步驟、Console 輸出、影響範圍，指派給該檔案的所有者修正，不自行修改核心檔案。
- 任一方需要修改不屬於自己的檔案 → 停止並回報原因（`AI_WORKFLOW.md` 第 2 節第 10 條）。
- 測試不得刪除或放寬以求通過（`AI_WORKFLOW.md` 第 4 節第 6、7 條）。

---

## 8. 風險

| 風險 | 說明 | 對策 |
|---|---|---|
| 序列化成本取代計算成本 | snapshot 過大時，卡頓只是從計算搬到 postMessage | P4 依 P0 基準線量測；snapshot 分層 |
| 指令延遲 | 點擊到畫面更新多一次 round-trip（約 1 tick） | 高頻操作（連點升級、批次分解）採主執行緒樂觀更新或按鈕鎖定 |
| 存檔相容性 | P2 為最高風險階段 | 舊存檔實測由 Antigravity 專責；存檔格式不得變更 |
| 既有測試全滅 | 若有人把模擬層改成 ESM | 硬規則：模擬層維持全域腳本寫法 |
| 重複結算離線收益 | 背景休眠與 Worker 生命週期互動 | 保留 `savedAt` 基準機制，切頁與開檔路徑各自實測 |

---

## 9. 待決事項

（三方在此追加，由 Claude 裁決；裁決後移除該條並更新協議）

- **既有 95 個測試失敗如何處理？** 開工前即存在，與遷移無關。建議另開任務、指派 Codex 分批修復，
  不併入本次遷移，以免與 Worker 改動混在同一批 diff 裡難以歸因。待使用者決定。

---

## 10. 進度

| 階段 | 狀態 | 完成日 |
|---|---|---|
| P0 協議凍結 | ✅ 完成（v1，67 條指令） | 2026-07-27 |
| P1 Worker 骨架 | 未開始 | |
| P2 存檔搬遷 | 未開始 | |
| P3 UI 去狀態化 | 未開始 | |
| P4 效能收斂 | 未開始 | |
| P5 移除 flag | 未開始 | |
