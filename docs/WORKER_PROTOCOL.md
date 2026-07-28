# Worker 協議 v5（已凍結）

> 凍結日期：2026-07-27　凍結者：Claude Code　協議版本：`WORKER_PROTOCOL_VERSION = 5`
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
| `boot` | `{ save, now, maxRunId, safeMode? }` | 開機。`save` 由主執行緒讀出且**未經 migrate**，可為 `null`（新遊戲）。`maxRunId` 供重新開局編號。`safeMode`（v6 新增）為 `true` 時跳過離線結算 |
| `load` | `{ save }` | **v2 新增**。執行中讀檔：替換整份狀態，不需要 reload |
| `cmd` | `{ id, name, args }` | 執行指令。`id` 由主執行緒遞增，用於配對 `ack` |
| `panel` | `{ name, params? }` | 索取面板資料，`name` 必須是 `PANEL_KEYS` 之一。`params` 由各面板自行定義（v5 新增），目前只有 `inv` 使用 |
| `visibility` | `{ hidden, pip, at }` | 分頁顯示狀態變更。`pip`（v7 新增）為迷你監控視窗是否開著，開著時 Worker 不休眠也不落地 `shutdown` |
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

### `inv` 面板（v5 起為投影）

背包預設**只回傳格子需要的欄位**，不含 `affixes` / `sockets` / `passive`：

```
panel { name:'inv', params:{ detailIds?: [id, ...], full?: true } }
  → { items: [{ id, rarity, slot, level, upgrade, synthesized, locked,
                name, weaponType, enchant, enchants, kind, ancientCount }],
      details: { <id>: <完整裝備> } | null,
      count, cap, settings, equipment, viewEquipment }
```

`params.full = true` 一次回全部裝備的完整資料，給**關鍵字搜尋**用——它要比對詞條、
傳奇特效、太古詞條，正是投影裁掉的那些。關鍵字篩選只在內網／本機出現
（`ui.js` 的 `isInternalServer()`），正式環境玩家看不到該輸入框，這條路徑不會落到玩家身上。
實測 800 件時 full 模式為 468 KB、主執行緒分派 10.5 ms，因此**只在搜尋時使用**。

⚠️ 不要為了搜尋把詞條加回投影：實測加回 `affixes` 後裁切效益從 56% 掉到 17%。

實測後期存檔 800 件：完整資料 305 KB，投影後 **133 KB（少 56%）**。
保留 `affixes` 只能少 17%——詞條就是主體，所以它必須排除。

詳情面板與格子 tooltip 需要完整資料，改用 `detailIds` 按需索取（單次上限 200 件）。
建議 UI 一次索取「目前可見範圍 + 選取項」，避免每次 hover 都往返。
| `full` | 罕見 | 開檔、讀檔、GM 指令、重開遊戲 |

**髒區來源沿用既有機制**：模擬層現有 158 處 `UI.dirty.*` 標記與 `markStatsDirty()` 直接就是髒區訊號，Worker 端只需在每個 tick 結尾收集並清空，不需要新設一套。`PANEL_KEYS` 因此與 `UI.dirty` 的鍵名完全一致，**不得新增別名**。

---

## 4. 指令規則

### 4.1 物件識別（v3 修正）

`postMessage` 是 structured clone，傳過去的是複本，改複本不會影響 Worker 內的真實狀態，所以對象一律用識別字串表達。

但 **v1 說的「一律傳 item.id」是錯的**——識別方式因物件而異：

| 物件 | 識別方式 | 說明 |
|---|---|---|
| 裝備、零件 | 實例 `id`（`uid()`） | 有唯一實例 |
| 融合寶石 | 實例 `id` | `socketFusedGem(it, fusedId)` |
| **一般寶石** | `type` + `level` | **沒有 id**，是計數。`socketGem(it, type)`、`dismantleGem(type, lv)` |
| 技能、天賦、附魔書 | 定義鍵（definition key） | 不是實例 id |
| 熔爐 | 數字 `id` | `nf.nextId++` 產生，型別是 `int` 不是 `str` |
| 寶石融合素材 | `{ kind:'plain', type, lv }` 或 `{ kind:'fused', id }` | `fuseGemsV2(ref1, ref2)` |

**解析改為逐指令白名單**：指令的 `resolve` 欄位列出哪些參數要由 id 解析成物件。
v1 用「參數名叫 `itemId` 就自動解析」的慣例會出事——`forgePlaceItem(id)` 收的是字串 id，
自動解析會把物件傳進去。

**同 id 歧義一律拒絕**：存檔會同時序列化 `G.equipment` 與 active 的 `G.equipmentSets`，
同一件裝備可能有兩份同 id 的複本。Worker 的 `resolveItem` 命中多個不同物件時直接回錯，
不猜——猜錯會複製或吃掉玩家的裝備。

### 4.1.1 參數約束

型別檢查擋不住列舉值與範圍，所以指令可宣告 `limit`：

- `enum`：`settings.set.key` 只允許 `compareEq`、`forge.setAuto.key` 只允許 `autoDust`/`autoForge`。
  任意 key/value 等於開一個能寫進任何狀態的後門。
- `min` / `max`：例如 `tower.start.floor >= 1`。

**多餘參數一律拒絕**（v3）。放行未宣告的欄位，會讓「主執行緒與 Worker 版本不一致」靜靜通過：
指令看起來成功了，但多送的那個參數根本沒被讀取。

### 4.2 指令是非同步的

送出 `cmd` 到收到 `ack` 至少隔一個 tick。UI 必須：

- 對高頻操作（連點升級、批次分解）做按鈕鎖定或樂觀更新，避免重複送出。
- **不得**在送出指令後立刻讀鏡像 `G` 並假設已生效。

### 4.3 失敗處理

指令失敗回 `ack{ ok:false, error }`。`error` 是給開發者看的字串，玩家提示一律走 `events` 的 `log` / `notice`，不要在主執行緒另寫一套錯誤文案。

### 4.4 指令清單

完整清單見 `js/worker/protocol.js` 的 `COMMANDS`，v3 起共 **81 條**：
`stage`(4)、`combat`(2)、`item`(9)、`gem`(12)、`player`(6)、`skill`(9)、`talent`(8)、
`tower`(5)、`forge`(10)、`newforge`(9)、`factory`(2)、`settings`(1)、`save`(3)、`gm`(1)。

（v1 為 67 條，v3 補上
`item.unequip`、`item.upgrade`、`stage.goMax`、`player.setEquipView`、`talent.max`、
`talent.potentialMax/Downgrade/Delete`、`tower.startAuto/flee/stopAuto`、
`forge.setAutoFill`、`newforge.setQuality/setEnabled` 等 14 條 v1 遺漏的操作。）

`fn` 欄位是 Worker 內要呼叫的既有函式名。`fn: null` 共 **23 條**，分三類：

> **實作進度**：19 條已於 P3 前置全部實作在 `sim.worker.js` 的 `COMMAND_IMPL`，
> 加上存檔三條與 `gm.exec`（待 `js/gm.js` 拆分）。UI 端接線是 P3 的工作。
>
> ✅ 已完成：`getItemAncientCount` 已於 `1ae85ed` 收斂至 `js/item.js`，
> `sim.worker.js` 的守衛後備已刪除，全專案僅此一份實作。

- **19 條**邏輯還寫在 `ui.js`，P3 搬進 Worker（下表，另加 v3 新增的
  `item.unequip`、`forge.setAutoFill`、`newforge.setQuality`、`newforge.setEnabled`，
  以及改為原子操作的 `item.equip`、`item.salvage`）
- **3 條存檔指令**（`save.manual` / `save.toFolder` / `save.restart`）v2 起改為 `fn: null`，
  由 Worker 的 `COMMAND_IMPL` 實作成「產生 payload → 發 persist」。原本宣告直接呼叫
  `manualSave` / `createManualSaveToFolderV2` / `restartGame` 是錯的——那些函式會碰
  localStorage、IndexedDB、File System Access 與 `location.reload`，Worker 一律不能碰
- ~~**1 條 `gm.exec`**~~ 已完成：`js/gm.js` 拆成執行層 `js/gm_exec.js`（無 DOM 相依，
  主執行緒與 Worker 共用同一份實作）與面板 `js/gm.js`。面板依 `WorkerBridge.enabled()`
  決定送指令或直接呼叫

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
| 7 | 2026-07-28 | `visibility` 新增 `pip`：迷你監控視窗（PiP）開著時豁免背景休眠，也不落地 `shutdown`。<br>P5 把主執行緒的模擬迴圈整個移除時，`main.js` 的 `miniMonitorActive()` 一併消失，這條語意就斷了——玩家開 PiP 正是為了邊做別的事邊看戰鬥，分頁雖然隱藏但畫面確實在被觀看。<br>PiP 狀態在 `ui.js` 的 `MINI`，Worker 看不到，由 Bridge 隨 `visibility` 轉發；PiP 只能在分頁可見時開啟，所以後續的 `visibilitychange` 必然帶對狀態。Bridge 另在 watchdog 輪詢變化補送，但隱藏分頁的計時器會被瀏覽器降頻，那條路徑只當保險。<br>指令表未變動（仍 85 條） |
| 6 | 2026-07-27 | `boot` 新增 `safeMode`：為 `true` 時跳過離線結算。<br>搭配 Bridge 的失效自動重啟（連續 3 次為上限）。離線結算是開機流程裡最會爆的一段——要讀存檔時間戳、重跑一段模擬、再結算獎勵，任何一環碰到異常資料都會拋錯，而拋錯就等於開不了機。安全模式讓玩家至少進得去、匯得出存檔。<br>指令表未變動（仍 85 條） |
| 1 | 2026-07-27 | 初版凍結：6 種入向訊息、8 種出向訊息、11 個面板鍵、67 條指令 |
| 2 | 2026-07-27 | P2 存檔搬遷：新增 `load` 訊息與 `restart` 落地種類；`persist` payload 加 `meta`；`boot` 加 `maxRunId`；`save.*` 三條改為 `fn:null` 並由 Worker 端實作（原宣告會呼叫碰 I/O 的函式，與設計衝突） |
| 5.1 | 2026-07-27 | 補齊 P3 剩餘三個面板所需的投影：`header` 加 `viewStats`／`dps`／`settings`／`autoEquip`／`equipView`／`equipActive`；`equip` 加 `settings`／`stats`／`viewStats`；`inv` 加 `settings`／`equipment`／`viewEquipment` 與 `params.full`（dev 關鍵字搜尋用）。<br>寶石商店的首次鋪貨與 8 小時定時重置移入 Worker tick——原本由 UI 呼叫 `rollGemShop`／`shopHourlyReset`（兩者都在 `INTERNAL_ONLY` 名單），等於「有沒有打開寶石頁」決定商店會不會刷新 |
| 5 | 2026-07-27 | P4 背包裁切：`panel` 訊息新增 `params`；`inv` 改為欄位投影 + `detailIds` 按需索取明細。實測後期存檔 305 KB → 133 KB（少 56%），主執行緒分派 3.2 ms → 2.5 ms。趁 Codex 尚未轉換背包頁時定案，避免他們照舊結構寫完再改一次 |
| 4 | 2026-07-27 | 收斂 Codex `UI_STATE_INVENTORY.md` 盤點的 10 項缺口。<br>新增 `gem.composeAll`、`gem.dismantleAll`（現行 UI 是最多 2500／999 次的同步迴圈，逐次跨執行緒不可行）、`tower.confirmResult`（含連挑續場，語意大於 `finish`）、`stats.reset`（`RUN_STATS`／`LOOT_STATS` 都在 Worker 內）。<br>`tower.start` 改 `fn:null`：手動挑戰同時代表取消等待中的連挑，兩步必須同一原子操作。<br>四項「渲染函式在改狀態」改為搬回 Worker 而非開指令：資源顯示旗標、鑲孔補齊、神鑄開放公告已完成；**護盾正規化經查證不需要搬**——模擬層的 `refreshShieldMaxAfterGain` 已在每一條護盾寫入路徑維護該欄位，`ui.js` 的 `playerShieldMax` 是冗餘，其「版本號遷移」分支永遠不會執行（戰鬥實體是純執行期物件，存檔不含實體）。改為請 Codex 縮成純讀取。<br>`item.toSynth` 不新增：功能被 `SYNTHESIS_ENABLED = false` 關閉。<br>指令總數 81 → **85** |
| 3.1 | 2026-07-27 | 新增 `PERSIST_KINDS.MANUAL_FOLDER`。P2 把 `manualSave` 與 `createManualSaveToFolderV2` 併成同一條資料夾路徑，導致未連接資料夾時「一鍵分解前的保護存檔」靜靜失敗——多數玩家沒接資料夾，那份保護存檔等於不存在。現在 `save.manual` 寫瀏覽器存檔記錄（空間不足才退回資料夾），`save.toFolder` 沒接資料夾就明確失敗 |
| 3 | 2026-07-27 | P3 前置：收斂 Codex 審查提出的指令形狀缺口，逐條比對過實際函式簽章後修正。<br>①**物件識別**：一般寶石改傳 `type`+`level`（沒有 id）、融合寶石用 `fusedId`、熔爐 id 改 `int`、零件改 `partKey`。<br>②**簽章對齊**：`rerollSingleAffix` 改 `affixKey`、`forgePlaceItem` 不解析成物件、`forgePlaceGem` 改 `type`+`level`、`forgeToggleDust` 補 `index`、`convertGems` 改 `slots`+`targetType`、`fuseGemsV2` 改 `ref` 結構。<br>③**補 14 條遺漏指令**（見上）。<br>④**解析改逐指令白名單** `resolve`，同 id 歧義一律拒絕。<br>⑤**參數約束** `limit`（enum/min/max）與**拒絕多餘參數**。<br>⑥ `item.equip`/`unequip`/`salvage` 改為 `fn:null` 原子操作（只呼叫既有函式會複製出第二件物品）。<br>⑦ 補齊 `dirty` metadata（分解鑲寶石裝備會髒 `header`/`gems` 等） |
