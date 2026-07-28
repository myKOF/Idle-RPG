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
- js/bridge.js、js/storage.js、js/main.js、index.html（Claude）
- js/ui.js（P3 起 Codex 專屬，目前尚未開放修改）

進行中的大型工程：

~~Web Worker 架構遷移~~ **✅ P0～P5 已完成（2026-07-28）**。

Worker 是模擬與存檔的唯一權威，主執行緒不再持有 `G`，舊單執行緒路徑已移除。
遷移期的計劃書 `docs/WORKER_MIGRATION_PLAN.md` 已刪除——關鍵設計決策與效能基準
已移入 `docs/WORKER_PROTOCOL.md` 第 9、10 節。

長期文件：`docs/WORKER_PROTOCOL.md` + `js/worker/protocol.js`（v7，唯一資料來源）。
**動到 Worker、bridge、面板投影或指令之前必須先讀。**

驗收記錄：`docs/P3_FULL_REGRESSION_REPORT.md`、`docs/P4_BACKPACK_VIRTUAL_SCROLL_REPORT.md`、
`docs/P4_WORKER_AUTO_RESTART_REPORT.md`、`docs/P5_FINAL_ACCEPTANCE_REPORT.md`。

目前階段：

Web Worker 遷移全部完成，無進行中的大型工程。

P5 之後的檔案所有權慣例（沿用即可，非硬性）：
- `js/worker/*`、`js/bridge.js`、`js/storage.js`、`js/main.js`、`js/worker/protocol.js`：Claude
- `js/ui.js`：Codex
- 協議變更一律由 Claude 改 `protocol.js` 並同步 `docs/WORKER_PROTOCOL.md`、遞增版本號

`npm test` 現況 491 項／456 通過／**35 失敗**。這 35 條是遷移前就存在的既有落差
（測試斷言過時、CSV 與測試不同步等），與 Worker 無關，見 `docs/TEST_FAILURE_TRIAGE.md`。
往後的驗收標準仍是「不得新增失敗」，並以結尾的 `ℹ fail N` 為準。

---

# 2. Claude Code 任務

## 2.0 多分頁互斥（Web Worker 重構收尾）

狀態：等待測試

任務名稱：多分頁同時開啟時互相覆蓋存檔

問題：全專案沒有任何多分頁防護。開兩個分頁就是兩顆 Worker 各自模擬、各自每 15 秒
把整份狀態寫進同一個 `auto_current`，後寫的整份蓋掉先寫的。實測兩個分頁跑 50 秒後
分別是 Lv.3／金 3,445／第 1 關與 Lv.4／金 4,935／第 7 關，關掉一個再重載另一個，
那幾十秒的進度就沒了。

決策（使用者選定）：擋下後開的分頁，並提供「在此分頁接管」。

交付內容：

- `js/tablock.js`（新增）：`navigator.locks` 具名獨佔鎖為唯一權威，
  `BroadcastChannel` 只負責通知讓位。拿不到鎖的分頁**完全不初始化遊戲**
- `js/worker/protocol.js`：協議升 v8，新增 `app.handoff`（落地 + 停模擬），85 → 86 條
- `js/worker/sim.worker.js`：`app.handoff` 實作
- `js/bridge.js`：`handoff()`——等 `persist` 真的落地完成才放手；開機改由 TabLock 觸發
- `js/main.js`：`initUI` 改由 TabLock 觸發
- `index.html`：載入 `js/tablock.js`（早於 bridge 與 main）
- `docs/WORKER_PROTOCOL.md`：v8 版本列與關鍵設計決策第 7 條
- `tests/tab-lock.test.cjs`（新增，10 項）

允許修改：`js/tablock.js`、`js/bridge.js`、`js/main.js`、`js/worker/`、`index.html`、`docs/`、`tests/`

禁止修改：`js/ui.js`（Codex 持有）

實測結果（localhost:8330，指向 claude 工作副本）：

- 單分頁正常開機；第二分頁被擋下且 `WorkerBridge.status().started === false`（沒有第二顆 Worker）
- 接管來回三次，金幣單調遞增 1606 → 2004 → 2572 → 3350 → 5460 → 5605 → 5750，無回檔
- 持有者分頁直接關閉（模擬當掉）→ 鎖由瀏覽器自動釋出，其他分頁接管成功
- `errors` / `persistErrors` 全程 0，兩個分頁 console 皆無錯誤
- 渲染實測：解除 `uiRenderingSuspended` 閘門後 `#r-gold` 顯示 5.46K，與 view 的 5460 一致
- `npm test`：487 tests / 487 pass / 0 fail（基準線 477／477／0，未新增失敗）

已知限制：

- 遮罩底下的遊戲按鈕仍在 DOM 中可被鍵盤 focus（視覺上完全被蓋住）
- 若持有者分頁被瀏覽器凍結（bfcache）而收不到讓位廣播，接管會在 10 秒後
  顯示「另一個分頁沒有回應」，需玩家自行關閉該分頁

建議 Antigravity 驗證：多分頁接管、關閉持有者分頁、存檔資料夾模式下的接管、
高塔挑戰進行中接管、離線結算與接管的交互

---

## 2.1 Web Worker 遷移 P1／P2（歷史記錄）

狀態：

等待測試（P1、P2 已交付，待 Antigravity 驗證）

任務名稱：

Web Worker 遷移 P2：存檔搬遷（P1 Worker 骨架已完成）

P2 交付內容：

- `js/storage.js`（新增）：主執行緒唯一落地端。接收 Worker 給的 json 與 meta，
  底層重用 save.js 既有的 `idbSetAutoV2` / `writeRawToFolder` / `writeAutoMetaV2` /
  `saveFolderMetaV2`，**存檔格式與檔名規則完全不變**
- `js/worker/sim.worker.js`：新增 `installStorageGuards()`，載入後就地換掉
  `saveGame` / `syncSaveFolder` / `manualSave` / `createManualSaveToFolderV2` /
  `restartGame` / `loadGame` / `loadLatestFolderSave`，讓模擬層照常呼叫、落地端換人。
  **未修改 save.js**（那 17 支是既有測試的受測對象）
- `js/worker/shim.js`：localStorage 由記憶體替身改為**會拋錯的陷阱**，漏網路徑大聲失敗
- `js/worker/protocol.js`：協議升 v2（`load` 訊息、`restart` 落地種類、
  `persist` 帶 `meta`、`boot` 帶 `maxRunId`、`save.*` 三條改 `fn:null`）
- `js/bridge.js`：接上真實存檔讀寫；補送初始 visibility 狀態
- `js/main.js`：worker 模式下關閉舊迴圈並設 `_saveSuppressed`，讓出存檔權

⚠️ 行為變更：`?worker=1` 現在以**玩家真實存檔**開機，且 Worker 是存檔權威。
P3 之前 UI 尚未接上 Worker，所以此模式下**畫面不會更新（等同凍結）**，屬預期中的中間狀態。
要正常玩遊戲請拿掉網址參數走舊路徑。

實測結果（localhost:8125）：

- 以真實存檔開機：等級 6、金幣 21130，migrate 與離線結算正常，0 錯誤
- 自動存檔實際落地 IndexedDB，Worker 與落地內容一致（15 秒差值符合節奏）
- **跨路徑相容**：Worker 寫的存檔，舊路徑重開後正確讀入（金幣 18154、背包 13 件、runId 1）
- `save.manual` 未連接資料夾時**誠實回報失敗**（persistErrors +1，訊息「尚未選擇本地存檔資料夾」），
  不會假裝成功
- 執行中讀檔：帶標記值的存檔送進去後狀態確實被替換
- `SHIM_DIAG.storage` 全程為空 → Worker 內沒有任何一次 localStorage 呼叫
- `npm test`：473 tests / 426 pass / 47 fail，失敗清單與基準線**逐條相同**

P1 交付內容：

- `js/worker/sim.worker.js`：主迴圈與 G 的所在地，importScripts 載入 17 支模擬層（未改動任何一支）
- `js/worker/shim.js`：window / document / UI.dirty / blog / flog / recordLoot* 替身，並統計相依次數
- `js/bridge.js`：主執行緒橋接，指令 Promise 配對、面板索取、分頁狀態轉發
- `index.html`：僅新增 protocol.js 與 bridge.js 兩個 script 標籤（見下方範圍調整）

範圍調整（需知悉）：

原計劃把 `index.html` 排在 P5，但 feature flag 必須在 P1 就能接線，
故 Claude 於 P1 提前接手該檔（僅加 2 個 script 標籤，未動其他內容）。
`index.html` 自即日起由 Claude 持有至 P5，其他 AI 不得修改。

實測結果（localhost:8125）：

- `?worker=1`：Worker 開機、模擬推進（10 秒推進到 stage 2~3）、tick 5Hz、persist 往返正常、0 錯誤
- 不帶參數：舊單執行緒路徑完全不受影響，Console 無錯誤
- `npm test`：失敗清單與基準線**完全相同**（47 fail，未新增任何失敗）

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
- index.html（僅 feature flag 接線；P1 起由 Claude 持有至 P5）
- docs/WORKER_PROTOCOL.md

禁止修改：

- js/ui.js（P3 起專屬 Codex；需要改動一律以 Code Review 意見交付）
- tests/worker-*.test.cjs（Codex 所有）
- 其他 AI 正在處理的檔案
- 任務範圍外檔案
- develop 分支

前置依賴：

P0 協議凍結（已完成）

測試要求：

- `npm test` **不得新增失敗案例**。開工前基準線：426 pass / 47 fail（既有問題，與遷移無關）
- Worker 空跑不得出現 Console 錯誤

完成後交給：

Antigravity 驗證 `?worker=1` 空跑；Codex 依協議撰寫協議測試

---

# 3. Codex 任務

狀態：

進行中（P1 協議測試已交付並合併；下列為 P2 期間任務）

## 3.4 Codex P0：uiTick 移除主執行緒模擬層屬性計算

狀態：

等待 Review（實作與驗收完成）

任務名稱：

修正 `ui.js` 呼叫 `getStats()`／`talentLevel()` 打斷 `uiTick`，恢復戰鬥飄字與面板即時渲染

任務內容：

- 敵人傷害飄字合併上限只讀協議 v8 的 `battle.stats.comboHits`／`battle.stats.aspd`
- Worker float 事件與待處理飄字路徑都把 battle snapshot 傳入 `floatText`
- `renderMpSkill` 缺少 stats 時安全返回，不在主執行緒重算屬性
- 天賦與潛能渲染缺少 snapshot 時使用安全預設值，不呼叫會讀取 `G` 的模擬層後備
- 全檔確認 `ui.js` 不含 `getStats(`／`computeStats(` 呼叫

允許修改：

- `js/ui.js`
- `docs/AI_TASKS.md`
- 與本問題直接相關的 `tests/*.test.cjs`（如需補回歸測試）

禁止修改：

- `js/worker/*`（協議層由 Claude 維護）
- 任務範圍外檔案
- `develop` 分支

前置依賴：

協議 v8（已於開工前 merge `origin/develop`，`battle` 面板已含 `stats`）

測試要求：

- `npm test` 不得新增失敗
- 使用 `docs/fixtures/save_midgame.json` 實機戰鬥至少 60 秒，Console 0 error／0 warning
- 敵人傷害飄字可見且連擊會合併；戰鬥中切裝備頁立即渲染
- 完整展開天賦頁（含潛能節點）不得拋錯
- 記錄 Console 截圖與 `WorkerBridge.status()` 的 `errors`／`restarts`／`pendingCommands`

驗收結果：

- 定向測試 34/34 通過；`npm.cmd test` 471/471 通過
- Lv.514／10 轉實機：天賦 1～10 轉共 80 個節點完整展開，技能頁 10 個潛能節點全部可見
- 連擊數 1.9 的第 20 層高塔戰鬥完整跑滿 60 秒，敵方傷害飄字持續可見
- 戰鬥中切換裝備頁 361ms 完成，背包計數 56/100、DOM 已渲染 25 個可視格
- Browser Console 程式化擷取：0 error、0 warning
- 驗收工具限制：IAB 的隔離執行環境無法存取頁面主世界的 `WorkerBridge`，
  因此未直接取得 `WorkerBridge.status()` 三項值；未觀察到 Worker restart 訊息，
  UI pending 狀態亦已清除，不以此推定結果取代實測值

完成後交給：

Claude Review

任務名稱：

既有測試失敗修復（A 類與 C 類）

已完成：

- `tests/worker-protocol.test.cjs`、`tests/worker-shim.test.cjs`（commit 67938fe）
- `docs/TEST_FAILURE_TRIAGE.md` 診斷報告（commit 48b4ca9），分類 A 32／B 14／C 1
- 協議審查：22 條待決事項（commit fcb3a6a），品質高，已由 Claude 接手裁決

任務內容（Claude 裁決結果）：

**核可：A 類與 C 類，即刻可動手。B 類 14 條一律不動。**

分兩批 commit，不得混在一起：

批次一 — 純測試斷言過時（低風險，直接改測試）：
`#1 attribute-tooltip`、`#3 boss-tooltip`、`#4 combat-log`、`#8 enchant-slot`、
`#9 enemy-type-damage`、`#26 loot-event-accounting`、`#27 multi-enemy`、
`#30 player-shield-bar`、`#31 rarity-colors`，以及 `#2 boss-display-state`（C 類，換行字元）。

批次二 — 數值爭議。**使用者已裁決（2026-07-27），可以動手了。**

### 權威順序（使用者裁決）

```
1. config/CSV/game_parameters.csv          ← 最高
2. 程式碼寫死值（公式／常數）
3. 公式文檔說明（game_formula.md / PLAN.md / PATCH.md）  ← 最低
```

- 有 CSV 就以 CSV 為準
- 沒有 CSV 就以程式碼為準
- 代碼未讀 CSV → 補進參數套用流程
- 文檔沒寫或寫錯 → 修正文檔

### Claude 執行裁決後的實況（已查證，可直接用）

跑過 `node tools/apply_params.cjs`（試跑）：

```
對應參數總數：496（一致 492、將變更 0、錨點問題 4）
（無數值變更：CSV 與程式目前一致）
```

意思是——**程式碼已經完全符合 CSV，這批爭議一行 `js/` 都不用改。**
你的對照表裡「CSV 現值」就是程式現值，測試才是落後的那一方。

所以批次二的工作簡化成兩件事：

**一、把測試斷言改成 CSV 值**（`#5 #6 #7 combo-hits`、`#10 #11 essence-salvage`、
`#12 field-equipment-drop-table`、`#13 field-gem-drop-table`、`#14 forge-duration`、
`#22 gem-shop`、`#24 god-might` 等）。

改的時候**不要直接抄程式碼的數字**，要抄 CSV 的值並在測試註解標出 CSV 行號——
這樣下次 CSV 改動時，測試失敗才會指向正確的原因。

**二、修正與 CSV 衝突的文檔**（權威順序最低的那一層）。
你對照表裡標了「`game_formula.md` 仍支持測試值」的項目，例如附魔精華拆解基礎率
（`game_formula.md:617-619`）、連擊係數（`PLAN.md:872`、`PATCH.md:791`），
這些都要改成 CSV 現值。`PATCH.md` 與 `PLAN.md` 屬歷史紀錄性質，
若不宜直接改寫，就在該段補一行「⚠️ 已由 CSV 第 N 行取代，現值為 X」。

### ⚠️ 裁決的適用邊界（重要）

這個裁決是給**數值爭議**用的：「同一個數值，CSV／程式／文檔說法不同」。

**不適用於「功能缺失或行為錯誤」。** 你 B 類清單裡這幾項不是數值問題：

- `#15~17 gemAttrDmgBaseV1`：文檔登記過的存檔遷移，`js/player.js` 找不到實作
- `#19~21 gem-convert Shift`：`js/ui.js:5293` 未綁 Shift 事件、`adjustGemConvertPool` 行為不符
- `#32 save-folder-ui`：`rescanSaveFolderView` 的 focus handler 未實作

這些若套用「沒有 CSV 就以代碼為準」去改測試，等於用改測試的方式把缺失的功能合理化。
**一律不動，維持 B 類**，continue 等個別裁決。

不得刪除測試或放寬斷言來讓測試通過。

### 批次三 — 修復失效的參數錨點（新增，優先度高於批次二）

`apply_params` 試跑回報 4 個錨點問題：

```
✗ formula 元素-冰：錨點匹配 0 次（需剛好 1 次）
✗ formula 元素-雷：錨點匹配 0 次
✗ formula 元素-毒：錨點匹配 0 次
✗ formula 元素-光：錨點匹配 0 次
```

原因：`tools/apply_params.cjs:591-594` 的錨點還在找舊寫法
`"ek === 'ice' && chance("`，但 `js/formula.js` 已重構成具名常數表
`ELEM_PROC.iceSlowChance`（定義在 `js/formula.js:531`）。

目前四個值剛好與 CSV 一致（15／10／25／20），所以看不出問題——但**這代表
日後有人改 CSV 的元素特效機率，改動會靜靜地套不進程式碼**。這正是使用者裁決
講的「代碼未讀 CSV 則應加上」。

修法：把錨點改指向具名常數（例如 `iceSlowChance:`），改完跑
`node tools/apply_params.cjs` 確認 496 個參數全部一致、錨點問題 0 個。

允許修改：`tools/apply_params.cjs`（本項專用，獨立 commit）

工作區：

D:\MyGame\Idle-RPG\codex

分支：

ai/codex

允許修改：

- A 類與 C 類涉及的 `tests/*.test.cjs`
- 批次二涉及的 `tests/*.test.cjs`（改成 CSV 值，註解標 CSV 行號）
- `game_formula.md`、`PLAN.md`、`PATCH.md`（僅修正與 CSV 衝突的數值說明）
- `tools/apply_params.cjs`（批次三：修復失效錨點，獨立 commit）
- `css/style.css`（僅編碼轉 UTF-8，不改內容；獨立 commit — 已完成 98ecf79）
- `docs/TEST_FAILURE_TRIAGE.md`（補數值對照表）

⚠️ 仍禁止修改 `config/CSV/*` 與 `config/Excel/*`：CSV 是最高權威，
不因測試或文檔而改。要調整數值請走參數表流程由使用者決定。

禁止修改：

- js/worker/*、js/bridge.js、index.html（Claude 所有）
- js/save.js、js/storage.js（Claude P2 進行中）
- js/ui.js（P3 才開放）
- js/ 模擬層任何檔案、config/CSV/*（B 類與數值爭議未裁決前不得動）
- tests/worker-*.test.cjs（已交付，勿混入本批）
- 其他 AI 正在處理的檔案
- develop 分支

前置依賴：

無，可立即開工（批次二需等使用者確認數值）

測試要求：

`npm test` 不得新增失敗案例。開工前基準線：426 pass / 47 fail（既有問題，與遷移無關，不要順手修）

完成後交給：

Claude Review

## 3.0 Codex 優先任務（阻塞中，請先做這件）

狀態：

待處理（Claude 已交付協議 v3，你的協議測試因此紅燈）

任務名稱：

`tests/worker-protocol.test.cjs` 更新到協議 v3

任務內容：

你提的 22 條待決事項我逐條比對過程式碼，**全部屬實**，已收斂成協議 v3 發出
（`js/worker/protocol.js`、`docs/WORKER_PROTOCOL.md` 第 8 節有完整變更清單）。

協議形狀改了，你的 4 個測試因此失敗，需要更新斷言：

- `凍結的 Worker 指令表有 67 條且分類數量固定` → v3 為 **81 條**。
  分類：`stage`(4)、`combat`(2)、`item`(9)、`gem`(12)、`player`(6)、`skill`(9)、`talent`(8)、
  `tower`(5)、`forge`(10)、`newforge`(9)、`factory`(2)、`settings`(1)、`save`(3)、`gm`(1)
- `所有指令名稱、fn、args 與 dirty metadata 格式合法` → 新增了 `ref`、`slots` 兩種參數型別，
  以及 `resolve`（陣列）與 `limit`（enum/min/max）兩個欄位
- `validateCommand 接受合法參數與省略 optional 參數` → 行為不變，但受測指令的參數形狀變了
- `validateCommand 拒絕 required 與 optional 參數的錯誤型別` → 同上；另外 v3 起
  **多餘參數也會被拒絕**（`unexpected arg: <cmd>.<key>`），請補一個案例

建議順便補的斷言（這幾條是 v3 的重點保證，值得鎖住）：

- `fn` 非 null 的指令，其函式必須真的存在於模擬層原始碼
- `resolve` 與 `limit` 的鍵必須都存在於該指令的 `args`
- `dirty` 只能使用 `PANEL_KEYS` 內的鍵
- 一般寶石相關指令**不得**出現 `gemId` 參數（一般寶石沒有實例 id，這是 v1 的錯）

允許修改：

- `tests/worker-protocol.test.cjs`
- `tests/worker-shim.test.cjs`（若受影響）

禁止修改：

- `js/worker/protocol.js`（協議唯一維護者是 Claude；有疑義走待決事項）

前置依賴：

無，Claude 已交付

完成後交給：

Claude Review

## 3.3 Codex 主線任務：P3 UI 去狀態化（`js/ui.js` 專屬）

狀態：

等待 Claude 交付協議 v4（甲、乙兩類）後開工；下述準備工作可先做

任務名稱：

P3：把 `js/ui.js` 從「直接讀寫遊戲狀態」改成「讀快照、送指令」

前置依賴：

Claude 的協議 v4 + Worker 端配套（新增 `gem.composeAll`、`gem.dismantleAll`、
`tower.confirmResult`、`stats.reset`；`shownRes`、護盾正規化、`ensureSockets`、
`unlockNotified` 移回 Worker）。交付後本欄會更新為「可開工」。

### 你現在就可以做的準備

1. 依你自己的 `docs/UI_STATE_INVENTORY.md` 排出改造順序。建議由**依賴最少**的面板開始
   （天賦 → 技能 → 寶石 → 高塔 → 熔爐 → 神鑄 → 背包裝備 → 頂欄），
   背包與裝備留到最後，它同時牽動 `inv`/`equip`/`gems`/`header` 四個面板。
2. 先寫一層薄的 UI 側存取層（例如 `viewState()` / `panelData(key)`），
   讓渲染函式改讀它而不是 `G`。有這層之後，後續 6000 行的改造才有統一的替換目標。
3. 把你第 14 節列的單飛鎖（single-flight lock）機制先寫好：
   以 `itemId` / `furnaceId` / 節點 id 為 key 的 pending 集合，送出即鎖、ack 或 panel 到才解。
   這是 P3 最容易出錯的地方，先有機制再逐頁套用。

### 改造規則

- **`G` 在主執行緒退化為唯讀鏡像。** 任何 `G.x = ...` 或改遊戲物件屬性一律換成 `send(cmd)`。
  改完之後，`ui.js` 內不應再有對 `G`／`FIELD`／`TOWER`／`RUN_STATS`／`forgeState()` 的**寫入**。
- **不得在主執行緒重算派生值**：`getStats()`、`currentDps()`、減傷等一律取自 Worker 快照。
- **渲染函式不得有副作用**。你盤點出的 `shownRes`、護盾正規化、`ensureSockets`、
  `unlockNotified` 四處由 Claude 移回 Worker；你只要把 `ui.js` 那幾段刪掉即可。
- ~~**`getItemAncientCount`（`ui.js:1512`）請搬進 `js/item.js`**，
  並通知 Claude 刪掉 `sim.worker.js` 裡的守衛後備——目前是兩份實作。~~
  ✅ 已完成（Codex `1ae85ed` 搬入 `js/item.js:342`，Claude 同步刪除 Worker 後備）。
- **`BOSS_LIST[*].imgFailed`（`ui.js:2826`）改成 UI 本地集合**，
  不要寫入共載的設定資料表。
- **`item.toSynth` 維持原樣**：合成暫存區被 `SYNTHESIS_ENABLED = false` 關閉，
  Claude 裁決不為關閉中的功能開跨執行緒通道。該段保留在 flag 保護下即可。
- 每個面板改完就是一個 commit，不要 6000 行一次交付。

### 驗收

- `npm test` 不得新增失敗（基準線見下方測試要求）
- Antigravity 的 `docs/REGRESSION_CHECKLIST.md` 全 21 項通過
- `?worker=1` 下遊戲可正常遊玩；不帶參數的舊路徑在 P5 前仍須可用

允許修改：

- `js/ui.js`（P3 起專屬 Codex，Claude 全程不得直接修改）
- `js/item.js`（僅搬入 `getItemAncientCount`）
- `js/skills.js`（僅搬入 `mergedSkillFx`，見下）

### P3 追加搬遷項（協議 v4 裁決）

1. ~~把 `mergedSkillFx` 與 `currentShieldSkillCap` 從 `ui.js` 搬進 `js/skills.js`~~
   ✅ 已完成（commit `f24a816`）
2. ~~`playerShieldMax` 的變更狀態部分交給 Claude 放進 Worker~~
   **❌ 撤銷此項——查證後確認不需要做。**

   2026-07-27 Claude 稽核模擬層每一條寫入 `.shield` 的路徑，結論是
   **模擬層已完整維護護盾欄位**，`ui.js` 那份是冗餘不是缺口：

   | 位置 | 行為 | 維護 shieldMax |
   |---|---|---|
   | `formula.js:719` | 吸收扣除 | ✅ 721-724 |
   | `formula.js:792` | 治療溢出轉護盾 | ✅ 797（`refreshShieldMaxAfterGain`）|
   | `skills.js:574` | 消耗護盾 | ✅ 575 |
   | `skills.js:729`／`1190`／`2534` | 技能給護盾 | ✅ 730／1191／2537 |
   | `combat.js:558`／`player.js:215` | 重生／轉生歸零 | ✅ 同行設好全部欄位 |

   `playerShieldMax` 內「版本號不符就遷移」那條分支**永遠不會執行**：
   戰鬥實體是純執行期物件（存檔不含 `FIELD`／`TOWER` 實體，已實測確認），
   每次開機由 `newPlayerEntity`（`combat.js:34`）建立時就蓋上當前版本號，
   之後由 `refreshShieldMaxAfterGain` 維護。實測 60 次取樣，版本號從未過期。

   **給 Codex 的動作**：把 `playerShieldMax`（`ui.js:1670`）縮成純讀取
   （回傳 `entity.shieldMax`，不要再寫 `entity.shield` / `shieldMax` /
   `shieldMaxVersion` / `shieldSkillBase` / `shieldSkillPct`），
   並刪掉 `ui.js:1667` 那層同名的 `currentShieldSkillCap` 委派
   （它遮蔽了 `js/skills.js` 的本尊，且依賴載入順序）。

其餘三項（資源顯示旗標、鑲孔補齊、神鑄開放公告）Claude 已搬完，
你只要刪掉 `ui.js` 對應的那幾段：

- `ui.js:1237,1248`（`p.shownRes` 的建立與寫入，只保留讀取來決定顯示與否）
- `ui.js:2209`（`ensureSockets(it)` 呼叫）
- `ui.js:3316-3317`（`unlockNotified` 偵測與寫入，改為接收 `notice` 事件 `key:'forgeUnlocked'`）

禁止修改：

- `js/worker/*`、`js/bridge.js`、`js/storage.js`、`js/main.js`、`js/gm.js`、`index.html`（Claude 所有）
- 其他模擬層檔案

完成後交給：

Claude Review → Antigravity 迴歸驗證

## 3.2 Codex 平行任務（已完成）

狀態：

已完成（commit 94a6d1a）

任務名稱：

P3 前置：`ui.js` 狀態相依清單（唯讀盤點）

任務內容：

P3 你要獨占 `js/ui.js` 把它去狀態化，那是 6069 行的檔案，動手前先盤點一次，
之後才不會邊改邊發現漏網。**本任務唯讀，不改任何程式碼。**

產出 `docs/UI_STATE_INVENTORY.md`，依頁籤／面板分組，逐項列出：

| 類型 | 內容 |
|---|---|
| A. 讀狀態 | `ui.js` 讀 `G.*` 的位置（約 226 處），標註讀哪些欄位 → 對應到哪個 `PANEL_KEYS` |
| B. 寫狀態 | 直接寫 `G.*`（16 處）或直接改遊戲物件屬性（7 處，如 `it.locked`、`f.autoDust`） |
| C. 呼叫變更函式 | 呼叫模擬層會變更狀態的函式（約 60 個） |
| D. 越界呼叫 | 呼叫 `INTERNAL_ONLY` 五個函式的位置（`addToInventory`、`rollGemShop`、`shopHourlyReset`、`forgeLog`、`newForgeReturnUnroutable`） |

每筆標註：`ui.js` 行號、目前行為、**對應的協議指令**；若協議沒有對應指令，標成
`缺指令` 並簡述需要什麼參數。

⚠️ 你先前提的 22 條待決事項，Claude 正在收斂成協議 v3。本盤點的 `缺指令` 清單會
直接餵進 v3，所以**寧可多列不要漏**。與你已提的重複沒關係，重複比漏掉好。

同時請標出「非同步風險點」：哪些操作是連點型（連續升級、批次分解、長按加關卡），
P3 改成指令後會有 round-trip 延遲，需要按鈕鎖定或樂觀更新。

允許修改：

- `docs/UI_STATE_INVENTORY.md`（新增）

禁止修改：

- 所有程式碼檔案（本任務唯讀）

前置依賴：

無

完成後交給：

Claude（作為協議 v3 與 P3 規格的輸入）

## 3.1 Codex 後續任務（P1 交付後接續，與 Web Worker 遷移分開）

狀態：

排隊中

任務名稱：

既有測試失敗清理（47 fail / 32 檔）

任務內容：

此批失敗在 Web Worker 遷移開工前就存在，**不得併入遷移的 commit**，必須獨立成 commit。
分兩步交付，第一步完成後停下來等 Claude 裁決，不要直接進第二步。

**第一步：診斷（唯讀，不改任何檔案）**

逐一分類 47 個失敗，產出報告 `docs/TEST_FAILURE_TRIAGE.md`，每筆標註：

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

已完成 (大重構後內測：全流程驗收 100% 通過，全流程體驗、長時間掛機、存檔完整性、Worker 韌性、新功能與效能複測驗收完成)

任務名稱：

大重構後內測：全流程驗收（外部更新前的最後一關）

已完成：

- 新增內測全流程驗收報告 `docs/INTERNAL_TEST_REPORT.md`
- P0-P5 全量驗收、800 件裝備虛擬捲動、Worker 自動重啟/安全模式破壞測試 100% 通過

P0 效能與存檔基準線（commit 2104314）

任務內容：

⚠️ **P2 已交付，`?worker=1` 的語意已改變，以下步驟以 P2 版本為準。**

`?worker=1` 現在以**玩家真實存檔**開機，且 Worker 是模擬與存檔的權威；
舊迴圈會被關閉、`_saveSuppressed = true`。P3 之前 UI 尚未接上 Worker，
所以**畫面不會更新（等同凍結）**，這是預期中的中間狀態，不是 bug。

⚠️ **驗證前請先備份存檔**（匯出一份），因為此模式會真的寫入你的存檔。

**一、Worker 存活與存檔往返驗證**

1. 開 `?worker=1`，Console 執行 `WorkerBridge.status()`，確認：
   - `booted: true`、`errors: 0`、`persistErrors: 0`、`pendingCommands: 0`
   - `lastView` 的等級／金幣／關卡**與你原本的存檔進度相符**（代表真的讀到存檔，
     不是開了新遊戲）
   - `ticks` 隨時間增加（約 5 次／秒）
   - `persists` 每 15 秒 +1
   - `shimDiag.storage` 必須恆為空物件。**若出現任何數字請立即回報**，
     代表有存檔路徑在 Worker 內誤用 localStorage
2. **存檔往返（P2 最關鍵）**：在 `?worker=1` 掛機 1 分鐘後關掉參數重開舊路徑，
   確認舊路徑讀到的進度就是 Worker 剛才推進到的進度（金幣、等級、關卡、背包件數）。
   這證明 Worker 寫的存檔舊路徑讀得懂，存檔格式沒有被改壞
3. 反向驗證：舊路徑玩一段時間後開 `?worker=1`，確認 Worker 讀到的是舊路徑的最新進度
4. 三份不同規模存檔（新手／中期／後期）各做一次步驟 2、3，特別注意後期存檔
   （背包接近上限）的落地耗時
5. 已連接存檔資料夾的情況：確認資料夾內的 `.json` 檔案有被更新，內容可被舊路徑讀回
6. 掛機 10 分鐘：`errors` 與 `persistErrors` 是否仍為 0、記憶體是否持續攀升
7. 切到背景分頁 2 分鐘再切回，確認 `errors` 仍為 0，且離線收益**沒有重複結算**
8. **不帶參數**重開，確認舊路徑完全正常：Console 無錯誤、戰鬥推進、存檔正常、
   各頁籤可切換。這項最重要——P1/P2 若動到舊路徑就是失敗
9. 對照 P0 基準線，確認舊路徑效能沒有因為多載入 3 支 script 而變差

**四、P3 期間任務（Codex 開工後）**

P2 驗證與迴歸清單都已完成（`2b4f38b`），品質很好，尤其 800 件背包 623KB 落地
< 16ms 與資料夾模式那兩項——後者我無法自測，只能靠你。

P3 是整個遷移最容易出現行為退化的階段，Codex 會分面板逐個交付，請**每個面板交付就驗一次**，
不要等全部做完才一起驗。理由：6000 行的改造若累積到最後才發現問題，很難歸因到哪一次改動。

每次驗證：

1. 跑 `docs/REGRESSION_CHECKLIST.md` 中該面板的項目
2. 特別針對「非同步風險」加測（`docs/UI_STATE_INVENTORY.md` 第 14 節列了 18 處）：
   - **連點**：升級、購買、分解、鑄造按鈕快速連按 5 次，確認資源只扣一次、
     不會出現負值或超額
   - **雙擊不可逆操作**：寶石融合、拆解、重新開局，確認第二次點擊不會造成
     「找不到素材」的錯誤或重複消耗
   - **拖放**：技能配置在指令未回應前再次拖曳，確認順序不會錯亂
   - **切頁競態**：送出指令後立刻切換頁籤，確認回應到達時不會渲染到錯的面板
3. 回報時附上重現步驟與 `WorkerBridge.status()` 的 `pendingCommands`／`errors`

**三、P3 前置：迴歸測試清單（可與上述並行）**

P3 會把 `js/ui.js` 的狀態讀寫全部改成訊息往返，是整個遷移**最容易出現行為退化**的一段。
請先建立 `docs/REGRESSION_CHECKLIST.md`，之後 P3 交付時逐條對照。

依頁籤分組（裝備／背包、技能、天賦、熔爐、神鑄、寶石、高塔、設定），每項寫：

- 操作步驟
- 預期結果（含數值變化方向）
- 目前（舊路徑）的實際結果

特別要涵蓋的高風險互動：

- 連點型操作：連續升級技能／天賦、長按加關卡、一鍵分解、一鍵購買寶石
  （P3 改成指令後會有 round-trip 延遲，可能重複送出或吃掉點擊）
- 拖放型操作：技能配置拖曳排序、裝備拖入神鑄法陣、零件裝入熔爐
- 需要即時回饋的操作：鑲嵌／卸下寶石、附魔、洗煉詞條
- 跨面板連動：轉生後各面板是否同步、切換裝備套後屬性是否更新
- 彈窗流程：高塔結算、離線收益、改版公告

**二、P2 存檔測試素材準備（Claude 進行中，先備料）**

P2 是整個遷移風險最高的一段（存檔 I/O 從模擬層剝離）。請先備妥測試素材：

- 匯出至少 3 份不同規模的存檔：新手（背包 <10 件）、中期、後期（背包接近上限、
  多轉生、高塔進度、熔爐與神鑄運行中）
- 每份存檔記錄關鍵數值快照：金幣、碎片、精華、等級、轉生數、最高關卡、背包件數
- 記錄一次完整的離線收益結果（離線時數 + 結算後各項增量）
- 準備「存檔資料夾」模式的測試環境（已授權的資料夾 + 現有檔案清單）

這些素材 Claude 交付 P2 後會用來比對「舊路徑存檔 → 新路徑讀入 → 數值完全一致」。

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

無，兩項都可立即開始

測試要求：

- 數據需可重現，記錄瀏覽器版本、硬體、存檔規模（背包件數）
- 存檔素材請保留原始檔，不要只留數值摘要

完成後交給：

Claude（P1 驗證結果 + P2 存檔素材）

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

檔案：index.html
負責 AI：Claude
任務：Web Worker 遷移 P1 feature flag 接線、P5 移除舊路徑
鎖定時間：2026-07-27
解除條件：P5 完成

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

**Codex — worker 模式下的事件目前只處理 `notice`，其餘全部丟棄**

`handleWorkerUiEvents`（`js/ui.js:443`）只處理 `kind === 'notice'`，
以下事件送到主執行緒後被靜靜丟掉（12 秒取樣實測）：

| 事件 | 12 秒內筆數 | 影響 |
|---|---|---|
| `flog` | 142 | 熔爐日誌全空 |
| `log` | 11 | **戰鬥日誌全空**（最明顯） |
| `float` | 6 | 戰鬥飄字消失 |
| `loot` | 視掉落而定 | 掉落統計（若不改讀 `battle` panel 的 `lootStats`）|

這是 P3 尚未做到的部分、不是 bug，但 P5 移除舊路徑前必須完成，
否則玩家會看到一個沒有戰鬥日誌的遊戲。

`float` 事件的形狀已於 2026-07-27 修正為 `{ elId, text, cls, damageValue }`，
**刻意不帶 `ent`**：主執行緒原本用 `activeEnemies.indexOf(item.ent)` 做物件識別比對，
structured clone 的複本永遠不會相等，傳過去只會讓飄字被丟棄。
識別資訊已在 `elId`（`mv-float-N` 對應敵人槽位），請改以 `elId` 判斷目標是否仍存在。

**Codex — `ui.js` 存取層 Code Review（commit 8fc5a63）**

Claude 於 2026-07-27 唯讀檢查，2 項 Medium、2 項 Low、1 項建議。
八個面板都會蓋在這層上，建議在轉換更多面板前先處理兩項 Medium。

- Medium：`panelSubscriptions` 永不清除，非可見面板仍持續請求。
  實測後期存檔（800 件背包）`inv` 面板單次 payload 為 **305 KB**。
- Medium：ACK 立即釋放單飛鎖，但面板資料尚未到達；`waitPanels` 因 ACK 必定先到而形同虛設。
- Low：`applyUiSnapshot` 讀 `snapshot.panels`，但協議的 `booted`／`full` 只帶 `{ view }`，該分支永不執行。
- Low：`syncUiPendingControls` 掃全文件後逐一比對屬性。
- 建議：`panelData()` 首次回傳 null 的契約應寫進註解。

完整內容由使用者轉交。

**Codex — P3-1 天賦頁／技能頁 Code Review（commits f24a816、f6f084d、e2f8215）**

Codex 於 2026-07-27 唯讀檢查，結論為 **Changes requested**：3 項 Medium、1 項 Low。
天賦 Command 分流、一般技能／潛力 Command 分流、舊路徑分支與 `mergedSkillFx` 搬遷本身未發現阻擋問題；以下問題需修正後再進下一個面板。

- Medium：`js/worker/sim.worker.js:246-250` 的 skills Snapshot 直接回傳 `p.skillPoints`，但 `js/skills.js:1940-1943、2029-2036` 的升級流程只在扣點前重算快取，升級後沒有再同步。因此 `ui.js:4056` 會在每次單級升級後顯示多 1 點；實測 `powerSlash` 由 0→1 時，快取仍為 11、依等級推導的實值為 10。建議 Worker 建立 skills panel 時直接以 `totalSkillPoints() - spentSkillPoints()` 的權威推導值產生 `points`，或讓所有技能／潛力狀態變更在完成後統一刷新此快取，並補 Command→Panel 回歸測試。
- Medium：裝載欄的互斥鍵不一致。`ui.js:4006-4008` 的裝備／卸下使用節點鍵，`ui.js:4068-4081、5877-5896` 的拖曳排序使用 `node:skill-loadout`；所以裝備或卸下尚未 ACK 時仍可用舊 Snapshot 發出排序，尤其「先卸下再拖曳」會讓 Worker 收到已失效的 `from` 索引。建議所有會改 loadout 的 Command 同時占用共用 `node:skill-loadout` 鍵，節點按鈕可再附加自己的節點鍵。
- Medium：`ui.js:3980-3994` 在 Worker 模式遇到融合技時只顯示風味文字與素材名稱，跳過舊路徑 `describeSkill()` 提供的傷害、增益、減益、元素權重與變異等數值，技能 Modal 與 Tooltip 因此和舊路徑不等價。建議在 `js/skills.js` 提供可接受已解析融合定義的純描述函式，讓 Snapshot 的 `resolveFusionRecord()` 結果走完整描述。
- Low：`ui.js:5723-5737、6011-6027` 的融合只鎖目前素材節點，融合槽的加入／移出／清空仍可在 ACK 前操作；第一筆成功回呼會無條件清空後來的新選擇，換成不同素材也能避開原有節點鍵送出第二筆融合。建議增加共用 `node:skill-fuse` 鍵，並在 pending 期間停用融合、清空與素材槽編輯。

既有存取層 Review 的兩項 Medium（訂閱不退訂、ACK 早於 panel 即解鎖）仍存在，且會放大上述競態；建議與本批一起處理。

驗證：`npm.cmd test` 為 475 項／450 通過／25 失敗，與既有基準一致，未新增失敗。現有測試未涵蓋 Command 後 skills panel 點數、loadout 交錯操作與 Worker 融合技描述。

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
