# Worker 協議 v2（已凍結）

> 凍結日期：2026-07-27　凍結者：Claude Code　協議版本：`WORKER_PROTOCOL_VERSION = 2`
> **單一資料來源是 `js/worker/protocol.js`。** 本文件是說明；兩者衝突時以程式碼為準。
> 修改協議必須經 `docs/WORKER_MIGRATION_PLAN.md` 第 7 節流程，由 Claude 統一改 `protocol.js` 並同步本文件、遞增版本號。

---

## 1. 職責邊界

| | 主執行緒 | Worker |
|---|---|---|
| 遊戲狀態 `G` | ❌ 只有唯讀鏡像 | ✅ 唯一權威 |
| 遊戲時間 `GT` | ❌ | ✅ |
| 主迴圈 `gameTick` | ❌ | ✅ 唯一 `setInterval` |
| DOM / 渲染 / 事件 | ✅ | ❌ |
| `localStorage` / IndexedDB / 存檔資料夾 | ✅ | ❌（Worker 無此 API） |
| 存檔序列化 / `migrateSave` / 離線結算 | ❌ | ✅ |
| 純函式與設定表（`util` / `data` / `formula`） | ✅ 共載 | ✅ 共載 |

**共載規則**：`util.js`、`data.js`、`formula.js` 兩邊都載入，讓 `ui.js` 既有的 `fmt`、`esc`、`clamp`、設定表查詢維持同步呼叫。共載檔案內**不得出現任何狀態變更**——它們必須是純函式與常數。任何人若在共載檔中寫入 `G`，等於製造雙權威來源，屬嚴重違規。

---

## 2. 訊息總表

### 主執行緒 → Worker

| type | payload | 說明 |
|---|---|---|
| `boot` | `{ save, now, maxRunId }` | 開機。`save` 由主執行緒讀出且**未經 migrate**，可為 `null`（新遊戲）。`maxRunId` 供重新開局編號 |
| `load` | `{ save }` | **v2 新增**。執行中讀檔：替換整份狀態，不需要 reload |
| `cmd` | `{ id, name, args }` | 執行指令。`id` 由主執行緒遞增，用於配對 `ack` |
| `panel` | `{ name }` | 索取面板完整資料，`name` 必須是 `PANEL_KEYS` 之一 |
| `visibility` | `{ hidden, at }` | 分頁顯示狀態變更 |
| `saveResult` | `{ token, ok, error }` | 回報 `persist` 的落地結果，`token` 來自 `persist` |
| `ping` | `{ t }` | 存活探測 |

### Worker → 主執行緒

| type | payload | 說明 |
|---|---|---|
| `booted` | `{ snapshot, offlineSummary, notices, protocolVersion }` | 開機完成。`protocolVersion` 不符時主執行緒必須報錯而非硬跑 |
| `tick` | `{ view, dirty, events }` | 高頻。`view` 為小量純量、`dirty` 為髒面板鍵陣列、`events` 為合批事件 |
| `panel` | `{ name, data }` | 面板完整資料 |
| `full` | `{ snapshot }` | 完整狀態（開檔、讀檔、GM 指令、重開遊戲後） |
| `persist` | `{ token, kind, payload: { json, meta } }` | 請主執行緒落地存檔，`kind` 見 `PERSIST_KINDS`。**v2 起附 `meta`**（由 Worker 以 `saveRecMeta()` 產生），主執行緒不得改用自己那份過期的 `G` 推算 |
| `ack` | `{ id, ok, result, error }` | 指令結果 |
| `error` | `{ where, message, stack }` | Worker 內未捕捉錯誤 |
| `pong` | `{ t }` | |

---

## 3. 快照分層（效能硬規則）

**禁止每個 tick 傳送整份 `G`。** 背包數百件裝備全量 structured clone，只會把卡頓從「計算」搬到「序列化」，等於白做。

| 層級 | 頻率 | 內容 |
|---|---|---|
| `tick.view` | 5 Hz | 只有 `TICK_VIEW_KEYS` 列出的純量：資源、等級、血魔、關卡、暫停狀態等 |
| `tick.dirty` | 5 Hz | 髒面板鍵陣列，來自模擬層既有的 `UI.dirty.*` 標記 |
| `panel` | 需要時 | 主執行緒看到 `dirty` 且該面板正在顯示時才索取 |
| `full` | 罕見 | 開檔、讀檔、GM 指令、重開遊戲 |

**髒區來源沿用既有機制**：模擬層現有 158 處 `UI.dirty.*` 標記與 `markStatsDirty()` 直接就是髒區訊號，Worker 端只需在每個 tick 結尾收集並清空，不需要新設一套。`PANEL_KEYS` 因此與 `UI.dirty` 的鍵名完全一致，**不得新增別名**。

---

## 4. 指令規則

### 4.1 不能傳物件參考

`postMessage` 是 structured clone，傳過去的是複本，改複本不會影響 Worker 內的真實狀態。因此：

- 既有吃 item 物件的函式（`doSalvage(it)`、`manualEnchant(it, key)`、`removeEnchantAt(it, i)`、`unsocketGem(it, i)`、`equipItem(it, slot, eq)`…）在協議中一律改為傳 **`itemId`**。
- 裝備與寶石本來就有 `id: uid()`（`js/item.js`），`ui.js` 也已有 `findItemById()`，直接沿用即可。
- Worker 端由 id 解析出物件後**呼叫原本的函式**，不得另寫一份平行實作。

### 4.2 指令是非同步的

送出 `cmd` 到收到 `ack` 至少隔一個 tick。UI 必須：

- 對高頻操作（連點升級、批次分解）做按鈕鎖定或樂觀更新，避免重複送出。
- **不得**在送出指令後立刻讀鏡像 `G` 並假設已生效。

### 4.3 失敗處理

指令失敗回 `ack{ ok:false, error }`。`error` 是給開發者看的字串，玩家提示一律走 `events` 的 `log` / `notice`，不要在主執行緒另寫一套錯誤文案。

### 4.4 指令清單

完整清單見 `js/worker/protocol.js` 的 `COMMANDS`，共 67 條，分為：
`stage`(3)、`combat`(2)、`item`(7)、`gem`(12)、`player`(5)、`skill`(9)、`talent`(4)、`tower`(2)、`forge`(9)、`newforge`(7)、`factory`(2)、`settings`(1)、`save`(3)、`gm`(1)。

`fn` 欄位是 Worker 內要呼叫的既有函式名。`fn: null` 共 **17 條**，分三類：

- **13 條**邏輯還寫在 `ui.js`，P3 搬進 Worker（下表）
- **3 條存檔指令**（`save.manual` / `save.toFolder` / `save.restart`）v2 起改為 `fn: null`，
  由 Worker 的 `COMMAND_IMPL` 實作成「產生 payload → 發 persist」。原本宣告直接呼叫
  `manualSave` / `createManualSaveToFolderV2` / `restartGame` 是錯的——那些函式會碰
  localStorage、IndexedDB、File System Access 與 `location.reload`，Worker 一律不能碰
- **1 條 `gm.exec`**，邏輯在 `gm.js`，P3 處理

P3 待搬遷的 13 條：

| 指令 | 目前位置 | 說明 |
|---|---|---|
| `item.salvageBulk` | `ui.js:2119 salvageAllUnlocked` | 整段批次分解邏輯（含分解前自動存檔）在 UI 內，必須搬進 Worker |
| `item.setLock` | `ui.js:2085, 2113` | 直接改 `it.locked` |
| `forge.setAuto` | `ui.js:6058, 6064` | 直接改 `f.autoDust` / `f.autoForge` |
| `skill.reorderLoadout` | `ui.js:5150-5159` | 直接 splice `G.player.loadout` |
| `player.renameEquipSet` | `ui.js:1737, 1742` | 直接改 `G.equipSetNames` |
| `player.buyInvUpgrade` | `ui.js:5944, 5945` | 直接扣金幣、加 `invUpgrades` |
| `player.setInvSort` | `ui.js:5958` | 直接改 `G._invSortIdx` |
| `stage.setAutoAdvance` | `ui.js:5617` | 直接改 `G.stage.autoAdvance` |
| `factory.setSalvageSettings` | `ui.js:5894-5897` | 直接改 `G.player.salvageSettings` |
| `factory.setAutoEquip` | `ui.js:6089` | 直接改 `G.factory.autoEquip` |
| `settings.set` | `ui.js:6084` | 直接改 `G.settings.compareEq` |
| `newforge.markTabSeen` / `markNoticeShown` | `ui.js:767, 4824` | 直接改 `G.newForge` 旗標 |

另有 `gm.exec`（`js/gm.js`）：GM 面板留主執行緒，指令解析與執行搬進 Worker。

### 4.5 不開放為指令的函式

`INTERNAL_ONLY`：`addToInventory`、`rollGemShop`、`shopHourlyReset`、`forgeLog`、`newForgeReturnUnroutable`。

這些是模擬層內部流程，目前被 `ui.js` 直接呼叫，屬於 UI 越界驅動模擬內部。**P3 必須移除這些呼叫點**，不得為它們開指令通道。

`LAZY_QUERIES`：`forgeState`、`gemShop`、`skillLevel`、`availableSkillPoints` 是查詢（前兩者會惰性建立子狀態），只能在 Worker 端執行，主執行緒改由 snapshot／panel 取得結果。

---

## 5. 存檔流程

存檔格式**完全不變**，向後相容既有存檔。改變的只有「誰負責寫入」。

實作分工（v2 起）：

- 主執行緒 `js/storage.js`：唯一落地端。底層重用 save.js 既有的
  `idbSetAutoV2` / `writeRawToFolder` / `writeAutoMetaV2` / `saveFolderMetaV2`，
  所以檔名規則與存檔格式完全不變。
- Worker `installStorageGuards()`：載入後就地換掉 `saveGame` / `syncSaveFolder` /
  `manualSave` / `createManualSaveToFolderV2` / `restartGame` / `loadGame` /
  `loadLatestFolderSave`，讓模擬層照常呼叫、落地端換人。**不修改 save.js 本身**
  （那 17 支是既有測試的受測對象）。
- Worker `shim.js`：`localStorage` 是會拋錯的陷阱。漏網路徑會大聲失敗，
  不會靜靜寫進一個不會落地的地方。`SHIM_DIAG.storage` 恆為空才算乾淨。

### 開機

```
主：讀存檔資料夾 + IndexedDB 快取 → 取較新者（不 migrate）
主 → boot { save, now, maxRunId }
Worker：migrateSave → applyOfflineProgress → 收集公告
Worker → booted { snapshot, offlineSummary, notices }
主：渲染、關閉 Loading
```

**主執行緒不得 migrate。** 遷移是 Worker 的職責；兩邊都做會讓一次性遷移跑兩次。

### 自動存檔

```
Worker（每 15 秒）：序列化 + saveRecMeta → persist { token, kind:'auto', payload:{json,meta} }
主：完整快照寫 IndexedDB，localStorage 只留小型 metadata（沿用 saveGameV2 策略）
主 → saveResult { token, ok, error }
Worker：更新 savedAt 基準；失敗則退回上一次成功值
```

### 重新開局 / 執行中讀檔

```
save.restart：Worker 先 persist 舊局 → 產生 newGameState（runId = max(maxRunId, G.runId)+1）
              → persist { kind:'restart' } → 主執行緒寫入後 location.reload()

load 訊息：  主執行緒讀出存檔 → load { save }
              → Worker 先 persist 目前進度 → 替換 G → migrate → 離線結算
              → full → 再 persist 鎖定 savedAt 基準
```

執行中讀檔不需要 reload——舊路徑靠 `location.reload()` 換狀態，Worker 架構下直接替換 `G` 即可。

**`savedAt` 只能在收到 `saveResult{ok:true}` 後更新。** 若在送出 `persist` 當下就更新，寫入失敗時會讓離線結算基準錯位，導致收益漏算或重複結算。

### 分頁隱藏 / 離線結算

`main.js` 既有語意必須完整保留：隱藏即存檔記錄基準點，隱藏逾 `BG_SUSPEND_AFTER_MS`(60s) 暫停即時模擬，回前景時以 `savedAt` 為基準跑 `applyOfflineProgress`。

`visibility` 訊息只是通知 Worker 切換模式，**判定與結算一律在 Worker 端**，主執行緒不得自行決定要不要結算，否則兩邊各判一次就會重複領取。

---

## 6. 背景節流（勿誤解）

Web Worker **不能**豁免瀏覽器背景分頁節流；Chrome 對背景分頁的 worker timer 一樣會節流。

因此 `main.js` 既有的「經過時間補償（`_lastTickAt`）＋單次最多補 10 秒＋逾時轉離線結算」機制必須原樣搬進 Worker，不得因為「已經在 Worker 了」而移除。節流只會降低取樣頻率，補償機制負責維持結果正確。

Worker 真正的收益是：主執行緒永不被模擬阻塞、批次操作不凍結畫面、計時不與渲染搶執行緒。

---

## 7. 禁止事項（違反即退回）

1. 禁止使用 `SharedArrayBuffer`／`Atomics`（需 COOP/COEP 標頭，本專案伺服器與部署環境未必可設）。
2. 禁止把模擬層 `js/*.js` 改成 ESM 或加 `export`——116 支既有測試檔（512 個案例）以 `vm.runInContext` 載入原始檔，改了會全數失效。
3. 禁止在 `protocol.js` 以外定義訊息型別或指令名稱。
4. 禁止每則日誌一次 `postMessage`，一律合批進 `tick.events`。
5. 禁止在 tick 傳送整份 `G` 或整個背包。
6. 禁止在共載檔（`util`/`data`/`formula`）寫入狀態。
7. 禁止主執行緒直接改鏡像 `G` 後就當作生效。
8. 禁止改變存檔格式。

---

## 8. 版本

| 版本 | 日期 | 變更 |
|---|---|---|
| 1 | 2026-07-27 | 初版凍結：6 種入向訊息、8 種出向訊息、11 個面板鍵、67 條指令 |
| 2 | 2026-07-27 | P2 存檔搬遷：新增 `load` 訊息與 `restart` 落地種類；`persist` payload 加 `meta`；`boot` 加 `maxRunId`；`save.*` 三條改為 `fn:null` 並由 Worker 端實作（原宣告會呼叫碰 I/O 的函式，與設計衝突）。<br>指令形狀類的缺口（寶石識別、`forge.*` 簽章、缺 `item.unequip` / `tower.flee` 等）由 Codex 於審查提出，屬 P3 範圍，將於 P3 開工前發 v3 |
