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
| 測試 | 118 支 `tests/*.test.cjs`／473 個案例，以 `vm.createContext` + `context.window = context` 直接載入 js 原始檔 |
| ⚠️ 測試基準線 | **開工前即有 47 個案例失敗（散在 32 支檔案）**，426 通過。與本次遷移無關，屬既有狀態 |

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
| **P1 Worker 骨架** | `js/worker/sim.worker.js`、`js/worker/shim.js`、`js/bridge.js`、`index.html`（僅 feature flag 接線）| `tests/worker-protocol.test.cjs`、`tests/worker-shim.test.cjs`（自有新檔） | `?worker=1` 空跑驗證、Console 錯誤檢查 |
| **P2 存檔搬遷** | `js/storage.js`（新增）、`js/worker/*`、`js/bridge.js`、`js/main.js`（worker 模式讓出存檔權）| 既有測試失敗清理（A/C 類，禁止碰 `js/`） | 存檔相容性驗證：舊存檔讀入、離線收益、重整、切頁 |
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

`npm test` 在**遷移開工前**就已經有失敗案例（含 Codex P1 測試後的現值）：

```
473 tests / 426 pass / 47 fail（32 支檔案）
```

⚠️ **統計方式**：node test runner 會在結尾的「failing tests:」摘要區把每筆失敗再列一次，
用 `grep -c '^✖'` 會得到兩倍數字（曾誤記為 95）。請一律以結尾的 `ℹ fail N` 為準：

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

原因與本次遷移無關（測試斷言過時、CSV 參數與測試不同步等既有落差）。因此：

- **驗收標準不是「全綠」，而是「不得新增失敗案例」。**
- 每階段開始與結束都要跑一次 `npm test`，比對失敗數與失敗清單。
- 失敗數只要上升，或既有失敗清單出現新名字，該階段不得交付。

既有 47 個失敗已另開任務處理，**不併入本次遷移**（`docs/AI_TASKS.md` 第 3.1 節）。
Codex 已完成診斷分類，見 `docs/TEST_FAILURE_TRIAGE.md`（A 類 32／B 類 14／C 類 1）。

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

- `item.equip`／`item.salvage`（`js/ui.js:2048-2077`；`js/worker/protocol.js:87,89`）：UI 現行流程還包含「先從背包移除、替換品退回背包／從裝備欄卸下」等狀態轉移，直接把 `itemId` 解析後呼叫 `equipItem`／`doSalvage` 會複製物品，且協議沒有 `item.unequip`；建議把裝備／卸裝／分解定義成 Worker 端原子操作並補 `item.unequip`。
- `item.upgrade`（`js/ui.js:2091-2099`、`js/factory.js:450`）：手動強化會消耗資源並改裝備，但 67 條指令沒有對應項；建議新增 `item.upgrade { itemId }`，Worker 解析後呼叫 `manualUpgrade`。
- 天賦批次與潛能操作（`js/ui.js:4906-4911,4934-4940,4993-5001,5039-5041`；`js/worker/protocol.js:128-131`）：缺少 `talentMax`、`potentialMax`、`potentialDowngrade`、`potentialDelete` 對應指令；建議各補正式指令，不能只靠現有 `talent.potentialUpgrade`。
- 裝備套檢視（`js/ui.js:4919-4923`、`js/player.js:243-253`）：`setEquipView` 會改 `G.equipView` 並決定預覽屬性，但協議只有 `player.switchEquipSet`，而 `panel {name}` 也無法帶檢視套索引；建議將檢視索引移為主執行緒 UI 狀態並讓 panel query 帶 `setIndex`，或新增不換穿的 `player.setEquipView`。
- `stageGoMax`（`js/ui.js:5616`、`js/combat.js:851-853`）：目前只有 `stage.go {delta}`；主執行緒用可能落後的 snapshot 計算 `best-current` 會有競態；建議新增 Worker 端判定的 `stage.goMax`，或明文規定 `stage.go` 可接受絕對目標而非鏡像算出的 delta。
- 高塔連挑／撤退／停止連挑（`js/ui.js:5835-5847,6023,6302-6305`、`js/tower.js:95-105,435-460`）：協議只有 `tower.start`／`tower.finish`，無法表達 `startTowerAuto`、`fleeTower`、`stopTowerAutoFromResult`；建議補 `tower.startAuto {floor,count}`、`tower.flee`、`tower.stopAuto`。
- 熔爐品質與啟用設定（`js/ui.js:2373-2387`）：UI 直接改 `fu.qualities[]`／`fu.enabled` 後呼叫內部函式 `newForgeReturnUnroutable`，但協議沒有對應指令；建議新增 `newforge.setQuality {furnaceId,rarity,on}` 與 `newforge.setEnabled {furnaceId,on}`，由 Worker 內部完成退回佇列，不開放 INTERNAL_ONLY。
- 神鑄自動放入設定（`js/ui.js:5657-5681`、`js/forge.js:276-316`）：UI 直接改 `G.forge.autoFill` 並呼叫 `forgeAutoFillApply`，協議只涵蓋自動魔塵；建議新增可設定／清除 `{kind:'equip',rarity}` 或 `{kind:'gem',type,level}` 的 `forge.setAutoFill` 原子指令。
- 讀取既有存檔（`js/ui.js:6216-6224`、`js/save.js:244-265`）：讀檔會替換整份遊戲狀態，但入向協議只有初次 `boot`，沒有執行中載入存檔的語意；建議定義主執行緒讀出 payload 後交 Worker migrate/apply 的 `load` 訊息或正式指令及其 persist/ack 順序。
- `save.manual`／`save.toFolder`／`save.restart`（`js/worker/protocol.js:165-167`；`js/save.js:168-191,833-842,1538-1554`）：`fn` 指向的現有函式直接使用 localStorage、IndexedDB、File System Access、`location.reload`，Worker 不能呼叫，與「I/O 留主執行緒」衝突；建議改成 Worker 產生 payload／新局狀態並發 `persist`，由主執行緒完成 I/O 與 reload 的明確握手，不應宣告為直接呼叫既有 `fn`。
- 一般寶石識別（`js/item.js:72-102,150-179`；`js/worker/protocol.js:96,99,101,103,140`）：一般寶石是 `{type,level}` 計數，沒有 `id`，因此 `gem.socket.gemId`、`gem.dismantle.gemId`、`gem.fuse.gemId1/2`、`forge.placeGem.gemId` 無法表示實際對象；建議一般寶石統一傳 `type + level`，只有 `fusedGems[].id` 使用 `id`，融合素材另定義可辨識 plain/fused 的結構。
- 寶石指令參數形狀（`js/ui.js:5250-5267,5308-5332,5337-5413,5737-5756`；`js/worker/protocol.js:96-103`）：`gem.convert` 實際需要 `slots:[{type,lv,n}] + targetType`、`gem.fuse` 需要兩個素材 ref、`gem.dismantle` 需要 `type + lv`，且 `gem.socket.socketIndex` 現有函式會忽略並永遠選第一個空槽；建議依現行操作重定義 args 與巢狀 schema，或先擴充原函式使指定槽位語意真實成立。
- `item.rerollAffix`（`js/ui.js:2100-2110`、`js/item.js:861-896`；`js/worker/protocol.js:93`）：實際函式以 `affixKey` 字串定位，協議卻宣告 `index:int`；建議改成 `affixKey` 列舉字串，或先明確新增 index→key 轉換且檢查 snapshot 版本避免索引漂移。
- 神鑄參數（`js/ui.js:5627-5639,5693-5709`、`js/forge.js:153-243`；`js/worker/protocol.js:138-143`）：`forge.placeItem.slotIndex` 現有函式不接受、`forge.placeGem` 實際要 `type,level`、`forge.toggleDust` 實際必須要 `idx` 但協議無參數；建議讓協議與現有函式簽名一致，或明確定義 Worker adapter 的槽位行為。
- 熔爐與零件 ID（`js/player.js:30-43`、`js/item.js:903-925`、`js/newforge.js:148-245`；`js/worker/protocol.js:149-153`）：furnace `id` 是數字卻宣告 `str`，零件雖有 `id`，現行 `newForgeInstallPart` 接收 `partKey` 並自動挑同類最高階，協議的 `partId`／`slotIndex` 無法直接呼叫原函式且可能改變選料語意；建議 furnaceId 改 `int`，並在 `partId` 精準選料與 `partKey` 保留最高階規則間擇一後同步函式契約。
- itemId 搜尋範圍與歧義（`js/ui.js:1840-1847`、`js/save.js:551-575`）：UI 刻意只搜背包＋目前檢視裝備套且排除法陣槽，存檔又會同時序列化 `equipment` 與 active `equipmentSets` 的同 ID 複本；協議只說「由 id 解析」不足以保證兩端選到同一物件，建議定義 command-scoped resolver（item 指令只允許 inventory/指定 set，forge 以 slotIndex 取回），migrate 後先 canonicalize alias，0 筆或多個邏輯命中一律拒絕。
- 物件識別現況（`js/item.js:450-463,903-925`、`js/talents.js:32-43`、`js/ui.js:1931-1939`）：裝備與零件有 `id`、天賦節點有穩定 `def.id`，附魔書以 `bookKey` 計數而非物件；協議應明文區分 instance id 與 definition key，避免把「跨執行緒一律 item.id」誤套到無實例 ID 的書、天賦及一般寶石。
- 參數約束（`js/worker/protocol.js:71-73,192-224`）：`str/int/obj/any` 只能驗基本型別，無法限制 zone/slot/book/gem/setting/auto key 列舉、floor/level/rarity/index/count 範圍，也無法驗證 gem convert/fuse 巢狀結構；建議保留基本型別但為每條 command 增加 enum/range/schema（或 validator）並讓錯誤在執行函式前回 ACK。
- `settings.set`／`forge.setAuto`（`js/worker/protocol.js:146,162`、`js/ui.js:6056-6068,6083-6093`）：任意 `key:str,value:any` 或未限制的 auto key 可寫入非預期狀態，且目前實際只允許 `compareEq:boolean`、`autoDust:boolean`、`autoForge:boolean`；建議列舉白名單並綁定每個 key 的 value 型別。
- `validateCommand`（`js/worker/protocol.js:207-224`）：目前只檢查規格內欄位，拼錯或多餘 args 仍會通過，會掩蓋主執行緒／Worker 版本不一致；建議拒絕 spec 未宣告的額外欄位（若需向前相容則明確做版本協商後再放行）。
- `fn:null` 數量（`js/worker/protocol.js:78-170`、`docs/WORKER_PROTOCOL.md:4.4`）：實際共有 14 條，當中 13 條位於 `ui.js`、另 1 條是 `gm.exec` 位於 `gm.js`；`item.salvageBulk` 已列入且確實涵蓋 `js/ui.js:2119-2144` 的分解前 `manualSave`，建議文件統一寫成「13 條 UI 搬遷＋1 條 GM」，避免把總數誤讀為 13。
- dirty metadata（`js/worker/protocol.js:87-103`、`js/factory.js:142-229`、`js/item.js:350-388`）：例如 `item.setLock` 可作用於裝備卻只列 `inv`，分解鑲寶石裝備會髒 `header/gems`，鑲嵌／卸寶石也會影響 `header`；雖實際傳送以 `UI.dirty` 為準，P4 驗證用 metadata 仍會誤報，建議逐指令依所有成功分支補齊。

**已裁決：**

- 2026-07-27　既有 47 個測試失敗（原誤記為 95，係統計時把結尾摘要重複計算）→ 另開獨立任務交 Codex，**不併入本次遷移**。
  兩步交付（診斷 → 只修 A/C 類），B 類要動 `js/` 者須經 Claude 裁決並走檔案鎖定流程。
  詳見 `docs/AI_TASKS.md` 第 3.1 節。遷移期間的驗收門檻維持「不得新增失敗案例」。

---

## 10. 進度

| 階段 | 狀態 | 完成日 |
|---|---|---|
| P0 協議凍結 | ✅ 完成（v1，67 條指令） | 2026-07-27 |
| P1 Worker 骨架 | ✅ 完成（待 Antigravity 驗證） | 2026-07-27 |
| P2 存檔搬遷 | ✅ 完成（待 Antigravity 驗證） | 2026-07-27 |
| P3 UI 去狀態化 | 未開始 | |
| P4 效能收斂 | 未開始 | |
| P5 移除 flag | 未開始 | |
