# AI_TASKS.md

本文件記錄 Idle-RPG 專案目前的 AI 任務分配。

每次開始新任務前，先更新本文件。

任務完成並合併後，可以將該任務移到「已完成任務」。

# 使用方式

使用者只需要提供：

- 想完成的功能
- 遊戲規則
- 預期結果
- 已知問題
- 優先級

收到任務的 AI 負責補充：

- 任務分類
- 技術影響
- 負責 AI
- 修改範圍
- 前置依賴
- 測試要求
- Review 與驗證流程



---

# 1. 全域狀態

目前整合分支：

develop

主整合工作區：

D:\MyGame\Idle-RPG\main

目前是否允許合併：

否

目前是否有衝突：

無

目前鎖定中的核心檔案：

- js/worker/*（Claude）
- js/bridge.js（Claude）
- js/ui.js（P3 起 Codex 專屬，目前尚未開放修改）

進行中的大型工程：

Web Worker 架構遷移。計劃書 `docs/WORKER_MIGRATION_PLAN.md`（暫時文件，P5 完成後刪除）。
協議 `docs/WORKER_PROTOCOL.md` + `js/worker/protocol.js`（v1 已凍結，唯一資料來源）。
三方開工前必須先讀這兩份文件。

目前階段：

P1 Worker 骨架（P0 協議凍結已完成）

---

# 2. Claude Code 任務

狀態：

進行中

任務名稱：

Web Worker 遷移 P1：Worker 骨架

任務內容：

- 建立 `js/worker/sim.worker.js`，以 `importScripts` 載入 17 支模擬層檔案（不改寫模擬層）
- 建立 `js/worker/shim.js`：`blog` / `flog` / `nflog` / `window.recordLoot*` 改為事件佇列，隨 tick 合批送出
- 建立 `js/bridge.js`：主執行緒側 send / on，含指令 id 配對與 ack 處理
- 主迴圈搬進 Worker，保留 `_lastTickAt` 經過時間補償與背景休眠語意
- 以 `?worker=1` feature flag 與舊單執行緒路徑並存，舊路徑維持可用

工作區：

D:\MyGame\Idle-RPG\claude

分支：

ai/claude

允許修改：

- js/worker/sim.worker.js（新增）
- js/worker/shim.js（新增）
- js/bridge.js（新增）
- js/worker/protocol.js（協議唯一維護者）
- docs/WORKER_PROTOCOL.md
- docs/WORKER_MIGRATION_PLAN.md

禁止修改：

- js/ui.js（P3 起專屬 Codex；需要改動一律以 Code Review 意見交付）
- tests/worker-*.test.cjs（Codex 所有）
- 其他 AI 正在處理的檔案
- 任務範圍外檔案
- develop 分支

前置依賴：

P0 協議凍結（已完成）

測試要求：

- `npm test` **不得新增失敗案例**。開工前基準線：417 pass / 95 fail（既有問題，與遷移無關）
- Worker 空跑不得出現 Console 錯誤

完成後交給：

Antigravity 驗證 `?worker=1` 空跑；Codex 依協議撰寫協議測試

---

# 3. Codex 任務

狀態：

進行中

任務名稱：

Web Worker 遷移 P1：協議測試

任務內容：

- 先讀 `docs/WORKER_MIGRATION_PLAN.md` 與 `docs/WORKER_PROTOCOL.md`
- 新增 `tests/worker-protocol.test.cjs`：驗證 `js/worker/protocol.js` 的指令表完整性
  （指令名稱格式、args 型別合法、`validateCommand` 對缺參數／型別錯誤／未知指令的行為、
  `PANEL_KEYS` 與模擬層實際使用的 `UI.dirty` 鍵完全一致）
- 新增 `tests/worker-shim.test.cjs`：驗證日誌 shim 會把 `blog` / `flog` 推入事件佇列而非呼叫 DOM
- 對協議有疑義一律寫入 `docs/WORKER_MIGRATION_PLAN.md` 第 9 節「待決事項」，
  不得自行修改 `js/worker/protocol.js`

工作區：

D:\MyGame\Idle-RPG\codex

分支：

ai/codex

允許修改：

- tests/worker-protocol.test.cjs（新增）
- tests/worker-shim.test.cjs（新增）
- docs/WORKER_MIGRATION_PLAN.md 第 9 節「待決事項」（僅追加）

禁止修改：

- js/worker/*（Claude 所有）
- js/bridge.js（Claude 所有）
- js/ui.js（P3 才開放）
- js/ 模擬層任何檔案
- 其他 AI 正在處理的檔案
- 任務範圍外檔案
- develop 分支

前置依賴：

Claude 完成 P0 協議凍結（已完成，可立即開工）；`shim.js` 測試需等 Claude 產出檔案

測試要求：

`npm test` 不得新增失敗案例。開工前基準線：417 pass / 95 fail（既有問題，與遷移無關，不要順手修）

完成後交給：

Claude Review

## 3.1 Codex 後續任務（P1 交付後接續，與 Web Worker 遷移分開）

狀態：

排隊中

任務名稱：

既有測試失敗清理（95 fail / 32 檔）

任務內容：

此批失敗在 Web Worker 遷移開工前就存在，**不得併入遷移的 commit**，必須獨立成 commit。
分兩步交付，第一步完成後停下來等 Claude 裁決，不要直接進第二步。

**第一步：診斷（唯讀，不改任何檔案）**

逐一分類 95 個失敗，產出報告 `docs/TEST_FAILURE_TRIAGE.md`，每筆標註：

- A 類：測試斷言已過時，原始碼是對的 → 改 `tests/`
- B 類：原始碼有問題，測試是對的 → 改 `js/`（**遷移期間鎖定，不得動**）
- C 類：環境／編碼問題 → 個案處理

Claude 已完成的預先分類，可直接沿用：

- **C 類根因（已確認）**：`css/style.css` 不是 UTF-8（2248 個無效位元組，應為 Big5/ANSI），
  但 `index.html` 宣告 `charset=UTF-8`。CSS 規則本身正常，亂碼只在中文註解，
  但比對中文字串的測試必定失敗。影響 6 支失敗檔案：
  `attribute-tooltip`、`combat-log`、`forge-duration`、`godforged-border-effect`、
  `player-shield-bar`（另 `rarity-colors` 為整檔失敗）。
  修法：把 `css/style.css` 轉成 UTF-8（不加 BOM），保留原內容不動。
- 其餘 26 支為數值／邏輯落差（如 `4 !== 0`、`3 !== 4`、公式近似值不符），需逐一判定 A 或 B。

**第二步：修復（需 Claude 核可後才開始）**

- 只做 A 類與 C 類（只動 `tests/` 與 `css/style.css`）。
- B 類**一律不動**，列清單交 Claude 裁決；要改 `js/` 必須排在遷移的階段間隙並走檔案鎖定流程。
- 不得刪除測試或放寬斷言來讓測試通過（`AI_WORKFLOW.md` 第 4 節第 6、7 條）。
  若某個測試確實應該報廢，寫進報告說明理由，由 Claude 決定，不要自行刪。

允許修改：

- 第一步：無（唯讀），僅新增 `docs/TEST_FAILURE_TRIAGE.md`
- 第二步（核可後）：A 類涉及的 `tests/*.test.cjs`、`css/style.css`

禁止修改：

- `js/` 底下任何檔案（含 `js/worker/*`、`js/ui.js`）
- `tests/worker-*.test.cjs`（本人 P1 任務所有，不要混進來）
- 其他 AI 正在處理的檔案
- develop 分支

前置依賴：

P1 協議測試交付後開始

測試要求：

每修一批就跑 `npm test`，記錄失敗數變化；失敗數只能下降，不得上升

完成後交給：

Claude 裁決 B 類清單

---

# 4. Antigravity 任務

狀態：

進行中 (P0 基準線已完成，等待 Claude 交付 P1)


任務名稱：

Web Worker 遷移 P0/P1：效能基準線與空跑驗證

任務內容：

- 先讀 `docs/WORKER_MIGRATION_PLAN.md` 與 `docs/WORKER_PROTOCOL.md`
- 建立**現版（單執行緒）基準線**，作為 P4 效能收斂的對照：
  - 主執行緒 FPS 與長任務（long task）分佈
  - 一鍵分解大量背包裝備時的畫面凍結時長
  - 開檔含離線結算的耗時
  - 切換各頁籤的渲染耗時
  - 記憶體佔用
- 存檔基準線：記錄現版存檔內容與離線收益結果，供 P2 相容性比對
- Claude 交付 P1 後，驗證 `?worker=1` 空跑：Console 無錯誤、舊路徑（不帶參數）不受影響
- 產出測試報告與可重現步驟

工作區：

D:\MyGame\Idle-RPG\antigravity

分支：

ai/antigravity

允許修改：

原則上只做驗證，不修改程式碼。測試報告請放在自己的分支。

禁止修改：

- js/ 任何檔案（含 js/worker/*、js/ui.js）
- 核心遊戲架構、存檔格式、戰鬥公式、數值平衡
- 其他 AI 正在處理的檔案
- develop 分支

前置依賴：

基準線可立即開始；空跑驗證需等 Claude 交付 P1

測試要求：

基準線數據需可重現，記錄瀏覽器版本、硬體、存檔規模（背包件數）

完成後交給：

Claude（效能數據作為 P4 依據）

---

# 5. 檔案鎖定

同一時間，同一個正式檔案只能由一個 AI 修改。

目前鎖定檔案：

檔案：js/worker/*（含 protocol.js、sim.worker.js、shim.js）
負責 AI：Claude
任務：Web Worker 遷移 P0–P5
鎖定時間：2026-07-27
解除條件：P5 完成

檔案：js/bridge.js
負責 AI：Claude
任務：Web Worker 遷移 P1
鎖定時間：2026-07-27
解除條件：P1 合併後

檔案：js/ui.js
負責 AI：Codex（P3 起）
任務：Web Worker 遷移 P3 UI 去狀態化
鎖定時間：P3 開始時生效
解除條件：P5 完成。Claude 全程不得直接修改，僅能以 Code Review 意見交付

檔案：tests/worker-*.test.cjs
負責 AI：Codex
任務：Web Worker 遷移 P1
鎖定時間：2026-07-27
解除條件：P1 合併後

記錄格式：

檔案：

負責 AI：

任務：

鎖定時間：

解除條件：

---

# 6. 等待處理

目前等待 Review：

無

目前等待修正：

無

目前等待測試：

無

目前等待合併：

無

---

# 7. 已完成任務

目前無已完成任務。

完成後可使用以下格式記錄：

任務名稱：

負責 AI：

完成內容：

修改檔案：

Commit：

測試結果：

合併狀態：

---

# 8. 新任務範本

使用者需求：

期望結果：

已知問題：

優先級：

---

以下由 AI 填寫：

任務狀態：

任務分類：

建議負責 AI：

任務內容：

技術影響：

允許修改：

禁止修改：

前置依賴：

測試要求：

完成條件：

需要 Claude Review：

需要 Antigravity 驗證：

完成後交給：

---

# 9. 狀態名稱

任務狀態統一使用：

待命

規劃中

進行中

等待 Review

等待修正

等待測試

等待合併

已完成

暫停

阻塞