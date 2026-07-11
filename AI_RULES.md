# Superpowers 工作流規範 (Superpowers Workflow Instructions)
在執行所有程式開發任務時，請務必遵循以下工作流：
1. **腦力激盪 (Brainstorming)**：在撰寫程式碼之前，先簡要列出設計方案與架構規劃。
2. **微型任務拆解 (Bite-sized Tasks)**：將複雜的需求拆解為更小、可操作的步驟（每個步驟約 2-5 分鐘）。
3. **測試驅動開發 (TDD)**：在實作核心邏輯之前，先編寫單元測試或驗證步驟。
4. **自我審查 (Self-Audit)**：在完成任務之前，依照需求對程式碼進行最終檢查。
5. **透明度 (Transparency)**：在完成每一個微型任務後，主動回報進度。

## [核心運作與計畫協議]
- **最高效力**：此協議為最高優先級。Agent 禁止因對話長度遺忘本規則。
- **[ALWAYS] 繁體中文**：所有回覆、程式碼注釋、報錯分析必須一律使用「繁體中文」，但AI自身作業時的思考過程不在此限。
- **計畫先行 (PLAN.md)**：在開始任何大型功能開發前，必須先在根目錄建立或更新 PLAN.md。
- **靜默執行**：採「思考並立即調用工具」模式，PLAN.md建立完畢立即執行，除非特殊情況，否則禁止輸出純文字詢問或等待用戶確認。
- **存檔遷移與一次性特別處理**：凡是調整算法、重置技能、修正既有數值，且舊存檔仍可能保留舊錯誤或舊格式時，若要主動處理既有存檔，必須先在根目錄 `ONE_TIME_MIGRATIONS.md` 登錄該遷移的唯一標記、觸發時機、處理範圍、保留資料、冪等條件、測試方式與日後清理步驟。實作時必須使用一次性標記，並以 `ONE-TIME MIGRATION` 註解標明；不得讓新存檔重複執行，也不得把一次性相容代碼混入永久遊戲規則。遷移完成且確認不再需要後，須依文件清理代碼並更新遷移紀錄。

## [實體擴展與繼承協議 (Entity Extension)]
- **嚴禁重造輪子 (Inheritance First)**：新增任何實體前，必須先讀取現有同類實體的 Base Class 與 Config 強制繼承。
- **通用四要素檢核**：1. 文本對齊 (UTF-8 字典檔)；2. 圖示與外觀註冊；3. 互動組件 (Selection Box/碰撞體)；4. 註冊表更新。
- **對照檢查**：開發完畢後，必須與「現有舊實體」並列比對。

## [架構解耦與防污染搬移協議 (Architecture & Anti-Pollution Protocol)]
- **職責絕對分離 (Strict Separation)**：嚴禁在邏輯層 (Systems) 中直接操作渲染物件 (Phaser Sprites/UI)。
- **事件驅動通訊 (Event-Driven)**：跨系統互動必須透過全域事件總線 (EventBus/EventEmitter) 解耦，嚴防循環依賴。
- **無損搬移三步曲 (Safe Migration)**：並行建置 -> 路由切換 -> 安全銷毀。**嚴禁「先刪除舊代碼再重寫」**。
- **依賴爆炸檢查 (Dependency Grep)**：修改核心 API 或移動檔案前，強制全域檢索同步更新依賴。
- **狀態防篡改 (State Encapsulation)**：全域遊戲狀態必須嚴格封裝，統一透過 Action 或 Setter 變更。

## [代碼收斂與自動化驗證]
- **代碼洗滌**：任務結束前，刪除未引用變數與除錯 Log。
- **唯一指定測試框架 (Playwright Only)**：所有自動化測試、E2E 驗證與 UI 互動檢測，**強制且唯一指定使用 Playwright**。嚴禁 Agent 擅自安裝或使用 Cypress, Selenium, Puppeteer 等工具。
- **按需自測**：預設不進行自測（參見動態模式協議）。若觸發自測，腳本必須強制執行 `await browser.close();` 關閉網頁實體，並以 `finally { process.exit(); }` 徹底了結進程。
- **增量覆蓋 (Patch-Update)**：避免全檔覆寫，使用 `utils/diff.cjs` 進行 Git Patch 格式的增量更新，並提供 `PATCH.md` 記錄變更摘要。
- **公式文件更新**：調整遊戲中系統計算的所有參數、公式、任何數值，都必須同步更新到根目錄下的game_formula.md。

## [無痕測試與自動清理協議]
- **領地限制 (Sandbox)**：測試產出物統一存放於 `/tmp/`，嚴禁置於 `src/` 或根目錄。
- **Git 守門員**：執行 `git add` 前，必須清理 `.gitignore` 以外的測試遺留檔。
- **自動銷毀機制**：變數宣告必須在最外層，`finally` 區塊強制執行 `browser.close()` 與 `fs.rmSync('tmp/', ...)`。
- **無感日誌**：除錯用的 `console.log` 通過驗證後自動抹除。

## [本機測試連接埠隔離協議]
- 使用者本地常態運行的遊戲伺服器預設使用 `127.0.0.1:5500`。
- 任何 Agent、自動化瀏覽器或測試流程**禁止**啟動、導航、開啟或操作 `127.0.0.1:5500` 與 `localhost:5500`，避免共用 localStorage、觸發自動存檔或覆蓋使用者進度。
- 測試必須使用其他連接埠（例如 `127.0.0.1:5501` 以上）或獨立測試來源，並停用自動戰鬥、存檔與 `beforeunload` 存檔。
- 若無法確保測試來源與使用者遊戲完全隔離，禁止開啟遊戲頁面，僅可進行靜態檢索與程式檢查。

## [數據安全與靜默檢索協議]
- **唯讀搜尋授權 (Read-Only Search Allowed)**：
  允許使用唯讀搜尋工具進行程式碼與檔案檢索，包括：
  - `rg` (ripgrep)
  - PowerShell：`Get-ChildItem`、`Select-String`、`Get-Content`、`Test-Path`
  - Node.js (`fs`、`path`) 搜尋

- **禁止危險 Shell 操作 (Dangerous Shell Forbidden)**：
  禁止執行任何會修改專案或系統的 Shell 指令，包括但不限於：
  - `Remove-Item`
  - `Move-Item`
  - `Rename-Item`
  - `Copy-Item`
  - `Set-Content`
  - `Add-Content`
  - `Out-File`
  - `Clear-Content`
  - `git reset`
  - `git clean`
  - `git checkout --`
  - `git restore`
  - `format`
  - `del`
  - `rd`
  - 任何批量修改、批量刪除、系統層級操作。

- **搜尋範圍限制 (Search Scope)**：
  搜尋時必須自動忽略下列目錄：
  - `node_modules`
  - `.git`
  - `dist`
  - `build`
  - `coverage`
  - `tmp`
  - `temp`
  - `Library`
  - `Logs`
  - `obj`
  - `bin`

- **搜尋最佳化 (Search Optimization)**：
  - 優先搜尋必要副檔名（如 `.js`、`.ts`、`.json`、`.cjs`、`.mjs`、`.jsx`、`.tsx`）。
  - 優先搜尋與目前任務相關的資料夾。
  - 單次搜尋結果應精簡，只回傳必要內容，避免浪費 Context Token。
  - 禁止無目的全專案搜尋。

- **搜尋工具優先順序 (Search Priority)**：
  1. `rg`
  2. PowerShell (`Select-String`、`Get-ChildItem`)
  3. Node.js (`fs` + `path`)
  若上述工具因環境限制無法使用，再建立並使用 `tools/safe_search.cjs` 作為備援搜尋工具。

- **統一編碼 (UTF-8)**：
  所有檔案讀寫必須明確指定 UTF-8 編碼，禁止依賴系統預設編碼。

- **來源唯一 (Single Source of Truth, SSOT)**：
  - UI 僅能讀取 `ui.config.cjs`
  - 動畫僅能讀取 `animations.json`
  - 嚴禁硬編碼或建立重複資料來源。
