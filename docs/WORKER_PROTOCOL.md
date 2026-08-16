# Worker 協議 v22

> 協議版本：`WORKER_PROTOCOL_VERSION = 22`　最後更新：2026-08-17
> **單一資料來源是 `js/worker/protocol.js`。** 本文件是說明；兩者衝突時以程式碼為準。
>
> 遷移（P0～P5）已於 2026-07-28 完成，Worker 是模擬與存檔的唯一權威，舊單執行緒路徑已移除。
> 修改協議請由 Claude 統一改 `protocol.js`、同步本文件、遞增版本號，並在第 8 節記下**為什麼**改——
> 那張表的價值在於理由，不在於流水帳。

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
| `visibility` | `{ hidden, at }` | 分頁顯示狀態變更。v9 起隱藏**不改變模擬行為**，只用來在切走時落地一次 `shutdown` |
| `saveResult` | `{ token, ok, error }` | 回報 `persist` 的落地結果，`token` 來自 `persist` |
| `ping` | `{ t }` | 存活探測 |

### Worker → 主執行緒

| type | payload | 說明 |
|---|---|---|
| `booted` | `{ snapshot, offlineSummary, notices, protocolVersion }` | 開機完成。`protocolVersion` 不符時主執行緒必須報錯而非硬跑 |
| `tick` | `{ view, dirty, events, catchup }` | 高頻。`view` 為小量純量、`dirty` 為髒面板鍵陣列、`events` 為一般合批事件、`catchup` 為目前欠帳秒數（見 6.1） |
| `visual` | `{ events }` | 技能施放飄字與重要 VFX；同一個模擬步驟內合併後低延遲送出，不等待下一個一般 tick |
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

`tick.view` 裡有**兩個時鐘**，用途不同，不可互換：

| 欄位 | 語意 | 戰鬥暫停時 |
| :--- | :--- | :--- |
| `gt` | 遊戲時鐘（`js/util.js` 的 `GT`），衡量「打了多久」，給玩家看 | **停住** |
| `simT` | 模擬時鐘（`js/worker/sim.worker.js` 的 `SIM_T`，v14 新增），衡量「模擬跑了多久」 | 照走 |

暫停期間 `simStep` 仍在跑 `factoryTick` / `newForgeTick` / `forgeTick`，狀態有在動，
但 `gt` 完全不動。所以任何想用時間軸把兩次執行對齊的東西——真人軌跡重播
（`scripts/sim/trace.js`）、瀏覽器↔headless 交叉驗證（`scripts/cross_check.js`）——
**一律用 `simT`**。用 `gt` 會在暫停那一段整批錯開，而且分岔點會落在暫停之後好幾秒，
看起來像別的原因。
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

完整清單見 `js/worker/protocol.js` 的 `COMMANDS`，v22 起共 **92 條**
（v1 凍結時 67 條，v3 補 14 條、v4 再補 4 條、v8 補 1 條、v16 補 1 條、v18 補 1 條、v19 補 2 條）。

⚠️ **指令名請以 `protocol.js` 為準，不要憑印象寫。** `WorkerBridge.send()` 會在送出前用
`validateCommand` 擋掉未知名稱，所以寫錯的名字根本送不出去。實際踩過：驗收報告引用了
`item.salvageAllUnlocked`、`gem.buy`、`skill.equip`、`forge.setSlot` 等 9 個不存在的名稱
（真實名稱是 `item.salvageBulk`、`gem.shopBuy`、`skill.equipLoadout`、`forge.placeItem`），
導致整份報告的證據欄失去支撐。要確認實際送出什麼，攔 `WorkerBridge.send` 最可靠。

`fn` 欄位是 Worker 內要呼叫的既有函式名。`fn: null` 共 **23 條**，表示沒有可直接呼叫的
既有函式，由 `sim.worker.js` 的 `COMMAND_IMPL` 實作，分三類：

- **原子操作**：`item.equip` / `item.unequip` / `item.salvage` / `item.salvageBulk` 等。
  這些在舊 UI 裡除了呼叫模擬層函式，還包含「從背包移除、替換下來的裝備退回背包」等
  狀態轉移，只呼叫既有函式會複製出第二件物品。
- **存檔三條**（`save.manual` / `save.toFolder` / `save.restart`）：原本宣告直接呼叫
  `manualSave` / `createManualSaveToFolderV2` / `restartGame` 是錯的——那些會碰
  localStorage、IndexedDB、File System Access 與 `location.reload`，Worker 一律不能碰。
  改為「產生 payload → 發 persist」。
- **純狀態寫入**：`item.setLock`、`settings.set`、`stage.setAutoAdvance`、
  `newforge.markTabSeen` 等，舊 UI 是直接改 `G` 的欄位。

> ✅ P5 已完成：`ui.js` 不再讀寫 `G` / `FIELD` / `TOWER` / `forgeState()`，
> 也不再直接呼叫任何協議表裡有指令的模擬層函式。主執行緒的重複 `G` 已移除，
> `index.html` 不再載入 `special_rules` / `legendary` / `factory` / `newforge` /
> `forge` / `gm_exec`——那六支只在 Worker 內執行。

### 4.5 不開放為指令的函式

`INTERNAL_ONLY`：`addToInventory`、`rollGemShop`、`shopHourlyReset`、`forgeLog`、`newForgeReturnUnroutable`。

這些是模擬層內部流程，不得為它們開指令通道。P3 已移除 `ui.js` 的所有呼叫點；
其中 `rollGemShop` / `shopHourlyReset` 改由 Worker 每 tick 自行維護（見 `maintainGemShop`）——
原本由 UI 呼叫等於「有沒有打開寶石頁」決定商店會不會刷新。

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

### 分頁隱藏 / 離線結算（v9 改）

**遊戲規則：分頁在背景＝仍在線上掛機，只有整個遊戲被關掉才算離線。**
所以隱藏分頁一律維持即時模擬，`applyOfflineProgress` **只在 `boot` 時執行**。

`visibility` 訊息剩下的唯一作用是「切走時落地一次 `shutdown`」，讓分頁後來被瀏覽器丟棄時至少有個新的存檔點。

⚠️ **切回前景時不得重設 `_lastTickAt`。** 那段正是玩家掛機的時間，重設等於直接丟掉。

---

## 6. 背景節流與補償

Web Worker **不能**豁免瀏覽器背景分頁節流；Chrome 對背景分頁的 worker timer 一樣會降頻。節流只會降低取樣頻率，不會讓時間消失——**補償機制負責把時間補回來**。

v9 的補償方式：經過時間一律進 `_catchupDebt`（不截斷），每次 `loop` 花至多 `CATCHUP_BUDGET_MS`(30ms) 的 CPU 補進度，補不完的留到下一次。用 CPU 預算而不是固定秒數，是因為每步成本隨裝置與存檔大小差很多：固定秒數在慢機器上會卡住 Worker、在快機器上又補得沒必要地慢。另有 `MAX_CATCHUP_STEPS`(2000) 當保險絲，避免計時來源被替換成不前進的假時鐘時（既有測試就是如此）跑成一次超長的同步工作。

欠帳上限 `MAX_CATCHUP_DEBT_SEC` 取 `OFFLINE_MAX_HOURS`(24h)，與離線收益同上限——背景掛機不該比關掉遊戲更優待。

### 6.1 節流一律以真實時間為基準（v9.1）

送 tick、自動存檔、資料夾同步的節流**必須用 `Date.now()` 判斷，不得累加「這次 loop 模擬掉的遊戲秒數」**。兩者平常相等（一次 loop 就是一步 `TICK_MS`），但補欠帳時一次 loop 會模擬掉數十秒遊戲時間，門檻立刻被跨過：自動存檔會變成每個 loop 一次、資料夾同步約 1.3 秒一次，各放大約 150 與 450 倍。每一次都是「整份存檔序列化 → 跨執行緒複製 → 主執行緒 gzip 與 IndexedDB／檔案寫入」，主執行緒因此被塞滿，指令要等十秒才有反應。

> 2026-07-29 事故：兩個分頁整夜掛機，早上任何操作都要等十秒，其中一個還跳出「離線 6 小時」——分頁從未關閉。成因就是上述放大，watchdog 收不到訊息把正在補進度的 Worker 判死並重啟，重啟丟掉欠帳、改用固定費率的離線收益結算。

配套三項：

| 項目 | 規則 |
|---|---|
| `tick.catchup` | Worker 回報目前欠帳（秒，未滿 `CATCHUP_REPORT_MIN_SEC` 回報 0）。主執行緒據此放寬存活監測門檻——正在補進度的 Worker 是忙，不是死 |
| `G.savedAt` | 語意是「模擬已推進到的時刻」，寫入時往回扣掉 `_catchupDebt`。照實寫成寫入時刻，會讓未模擬完的那段被下次開機的離線結算誤認為已結算而蒸發 |
| 落地端合併 | `auto` / `folder` 為「最新覆蓋前一份」的寫入，同種類在飛行中只保留最新一筆待寫；被合併掉的請求仍須收到**取代它那次寫入的真實結果**（見 `js/storage.js`） |

> 舊版是「單次最多補 10 秒，更長轉離線結算」。那個 10 秒上限是**主執行緒才需要的限制**（在那裡補 10 秒以上會凍畫面），搬進 Worker 後理由不再成立。實測（Node/V8）模擬 1 小時遊戲時間：新手存檔 1.5 秒、後期存檔（Lv.260、背包 800 件）2.4 秒 CPU，而且完全不佔主執行緒。

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
| :--- | :--- | :--- |
| 22 | 2026-08-17 | **火狩 VFX 速度同步**：環形 `area` 新增可選 `spinRate`（弧度／秒），由 `js/skills2.js` 傳遞模擬層實際角速度，`js/battle-renderer.js` 依此繪製；缺少欄位的舊事件仍以 `spin` 方向退回預設速度。<br>理由：先前模擬層已將火狩降速至 0.455 圈／秒，但事件只傳方向，Canvas 固定每秒 1 圈，導致玩家看到的旋轉速度沒有變。 |
| 21 | 2026-08-16 | **新版技能一鍵滿級與重置**：新增指令 `skill2.max`／`skill2.delete`，90 → **92**。 |
| 20 | 2026-08-15 | **技能視覺事件低延遲傳遞**：新增 Worker → 主執行緒 `visual` 訊息。技能施放飄字與重要 `vfx` 事件由 `shim` 在同一模擬步驟內先合併，再由 Worker 一次送出；一般日誌、掉落、資源與面板事件仍隨 `tick` 合批。<br>理由：技能 CD／ready queue 已在 Worker 內獨立運作，但原本視覺事件要等 5Hz 的一般 tick，造成最多約 0.2 秒的畫面延遲；新增專用通道只降低顯示延遲，不改變遊戲時間、傷害或技能施放規則。 |
| 19 | 2026-08-13 | **新版主動技能系統（技能改造第一批）**：新增指令 `skill2.learn` / `skill2.downgrade`（`fn: skills2Learn / skills2Downgrade`，js/skills2.js；args `{group, tier}`，tier 限 0~6），88 → **90**。`skills` 面板快照新增 `skills2` 欄位＝`{ tierMax, levels: {群組id: [各階等級]} }`。<br>6 群組 × 7 階；同群組在前端顯示為同一個技能。定義表 `SKILLS2` 在共載檔 `js/skills2.js`（唯一來源 `config/Excel/Skills2.xlsx` ↔ `config/CSV/Skills2.csv`，經 config_tables.cjs 回寫），所以名稱、各階說明模板、費用公式**不進協議**——兩端讀同一張表，面板只投影會變動的各階等級。裝載沿用 `skill.equipLoadout` / `skill.unequipLoadout`（id 帶 `'sg:'` 前綴，比照 `'potential:'` 的並行前例），施放沿用 pickAndCastSkill 的統一迴圈與冷卻表（`pEnt.skillCds['sg:<群組id>']`）。舊技能系統完全不動——與新系統並行供調教，之後另案刪除。 |
| 18 | 2026-08-05 | **主線任務系統**：`PANEL_KEYS` 新增 `task`（任務總覽投影，僅回傳每筆任務的 `{idx, prog, claimed, current, ready}` 動態欄位）；`TICK_VIEW_KEYS` 新增 `taskIdx` / `taskProg` / `taskReady`（戰鬥區上方任務快捷列的三個純量）；新增指令 `task.claim`（`fn: taskClaim`，js/tasks.js），87 → **88**。<br>任務定義表 `TASKS` 在共載檔 `js/data.js`（唯一來源 `config/CSV/Task.csv`，經套用參數.bat 回寫），所以名稱、目標數量、獎勵文字**不進協議**——兩端讀同一張表，tick 只送會變動的三個純量，面板只送進度與領取狀態。任務進度邏輯與領獎（js/tasks.js）只在 Worker 端載入；主執行緒不載 tasks.js，比照 factory / newforge。<br>累計型進度（強化/附魔）重用 `G.factory.stats` 既有統計；洗煉與寶石合成兩個新計數 `rerolled` / `gemComposed` 加進同一個 stats 物件，由 item.js 對應成功點遞增——不另設第二套統計家。 |
| 17 | 2026-08-04 | **戰鬥特效酷炫化**：`vfx` 事件新增四個**可選**欄位——`elem`（元素鍵，顯示層據此挑元素化畫法與受擊特效）、`cat`（技能分類，另有 `basic`＝普攻、`enemy`＝敵方動作）、`variant`（特效變體字串；顯示層不認得就退回原型預設畫法，所以加變體不用動協議）、`delayMs`（整則特效的基礎延遲，追加劍氣／天罰用）。`fxKind` 新增 `curse`（敵身詛咒）、`chain`（連鎖雷鏈，`targets` 順序即彈跳路徑）、`impact`（純受擊反饋）。<br>發送端擴充：普攻與天罰改由 `combat.js` 直接組 `vfx` 事件（劍氣投射＋神雷），普攻浮字開始帶 `delayMs`（與劍氣飛行同一個數，比照技能的 travelMs 同步規則）；雷霆過載與連鎖餘波由 `potential.js` 送 `chain` 事件。<br>理由：舊版七原型只有「顏色」一個維度，火球和暗影箭除了色碼沒有差別，普攻更是完全沒有畫面。畫法仍全部在主執行緒 `js/vfx.js`——模擬層只多描述「是什麼屬性、哪種變體」，不碰任何 DOM 字眼。<br>指令表未變動（仍 87 條） |
| 16 | 2026-08-04 | **熔爐零件升級**：新增 `newforge.upgradePart`，由 Worker 執行零件升級與金幣扣除；指令表 86 → 87 條。 |
| 15 | 2026-08-02 | **詞條規則外送**：`equip` 面板新增 `affixRules`＝`{詞條鍵: {slots, minR}}`，取自 `AFFIX_POOL`，是靜態遊戲規則。<br>加它的理由：任何「想洗出某條詞條」的一方原本都得自己抄一份可用部位清單，抄錯不會有徵兆。實測踩過——AI 策略手寫的清單裡放了 `weapon`（命中率根本不能出現在武器上）與 `bracers`（遊戲的鍵是 `wrist`），375 次洗煉一條都沒洗出來，而且沒有任何錯誤訊息。規則的唯一來源是 `AFFIX_POOL`，讀它就不會有第二份會過期的副本。<br>指令表未變動（仍 86 條） |
| 14 | 2026-08-01 | **真人軌跡重播**：`TICK_VIEW_KEYS` 新增 `simT`（模擬時鐘，`js/worker/sim.worker.js` 的 `SIM_T`）。與既有 `gt` 的唯一差別是戰鬥暫停時 `gt` 停住、`simT` 照走。<br>加這個欄位的理由是既有的 `gt` 當不了對齊軸：暫停期間 `simStep` 仍在跑 `factoryTick`/`newForgeTick`/`forgeTick`，狀態有在動而 `gt` 沒記錄到，於是重播與交叉驗證在暫停那一段整批錯開（實測：暫停在 `gt=51.8`，`verify_trace` 到 `gt=55.2` 才 FAIL，分岔點看起來像別的原因）。<br>同時修正 `requestPersist`：決定論測試模式（`?seed=N`）下不再執行**非自願**的落地（`auto`/`folder`/`shutdown`），`manual`/`manualFolder`/`restart` 照常。先前 `onVisibility` 的 `SHUTDOWN` 沒有被擋，測試模式切一次分頁就會用種子化亂數跑出來的狀態蓋掉玩家的 `auto_current`——與 `installTestSeed` 檔頭宣稱的「不落地存檔」不符。<br>指令表未變動（仍 86 條） |
| 13 | 2026-07-30 | **技能融合系統改造**：`TICK_VIEW_KEYS` 新增 `magicScroll`（魔法卷軸，融合材料）；`skills` 面板快照新增 `mastery`（技能熟練度 `{level, xp, xpMax, maxLevel}`）、`scrolls`（卷軸持有量）、`fusionCosts`（每素材金幣/卷軸費用），`points/budget` 改為熟練度制即時計算（`availableSkillPoints()`/`totalSkillPoints()`，不再讀已移除的 `skillPointBudget` 欄位）。融合記錄改 `{components, seed}` 種子重算制——記錄仍原樣隨面板傳主執行緒，兩端共用 `buildFusionRuntimeDef` 重建，故無新訊息型別；指令表未變動（仍 86 條） |
| 10 | 2026-07-29 | 事件新增 `vfx`：技能／增益特效。`{ fxKind, glyph, color, targets, cells, dur, count }`，隨 tick 合批，與 `float` 走同一條路。<br>新版戰鬥規格要求「所有技能或 buff 都要有簡易特效」。特效必須由**模擬層決定何時發生**——只有那一側知道技能真的施放了、打到誰、範圍蓋住哪幾格；但特效**怎麼畫**完全屬於主執行緒，所以事件只描述語意（原型／顏色／目標／格子），一個 DOM 字眼都不帶。<br>`targets` 沿用 `float` 的圖層 id 定址（`mv-float-N`／`tb-float`），理由與 `float` 相同：structured clone 過來的實體複本永遠比不出識別。<br>`cells` 是棋盤格座標，給領域與天降類特效定位；非區域類為 `null`。<br>指令表未變動 |
| 9 | 2026-07-28 | **背景休眠機制移除**：分頁在背景＝仍在線上掛機，只有整個遊戲被關掉才算離線（使用者定案的遊戲規則）。`visibility` 移除 `pip` 欄位；指令表未變動（仍 86 條）。<br>舊版隱藏逾 60 秒就停止推進、回前景改用離線收益補。問題有三：①離線收益是**另一套固定費率模型**（每 20 秒殺一隻 `best−10` 的菁英怪，與玩家實際 DPS 及所在關卡無關），拿它替代即時模擬等於在背景換一套玩法；②休眠門檻用 `_hiddenAt` 起算、離線結算的 60 秒下限卻用 `savedAt` 起算，兩個基準不同，背景約 60～120 秒這段兩邊都不給，收益是 0；③與掛機遊戲的直覺相反。<br>`pip` 一併移除：它存在的唯一理由是「PiP 觀戰中要豁免休眠」，休眠沒了就沒有接收端，留著就是死欄位。PiP 功能本身不受影響（狀態仍在 `ui.js` 的 `MINI`）。<br>降頻補償改為「欠帳 + CPU 預算分次補完」，見第 6 節 |
| 8 | 2026-07-28 | 新增指令 `app.handoff`：把進度落地成 `shutdown` 並停止模擬迴圈。指令表 85 → **86**。<br>多分頁互斥（`js/tablock.js`）用。Worker 是「模擬與存檔的唯一權威」，但那個唯一只在單一分頁內成立——開兩個分頁就是兩顆 Worker 各自每 15 秒把整份狀態寫進同一個 `auto_current`，後寫的整份蓋掉先寫的。實測兩個分頁跑 50 秒後分別是 Lv.3／第 1 關與 Lv.4／第 7 關。<br>交接時必須**先落地、後放手**：接管方是拿到鎖之後才讀存檔的，順序反了就是 e85ff42 那個競態的重演（舊資料在新分頁讀完之後才寫進去）。主執行緒自己是落地端，所以由 `WorkerBridge.handoff()` 等 `persist` 寫入回報完成才釋出鎖。<br>停迴圈不是效能考量，是保險：只要落地與 reload 之間任何一步出錯，一顆不再持有鎖卻還在存檔的 Worker 就是這套鎖要防的問題本身。<br>沒有新增訊息型別；`4a10998` 那個 v8（battle 面板補 stats）已於 `dbc54d1` revert，版號在此重新使用 |
| 7 | 2026-07-28 | `visibility` 新增 `pip`：迷你監控視窗（PiP）開著時豁免背景休眠，也不落地 `shutdown`。<br>P5 把主執行緒的模擬迴圈整個移除時，`main.js` 的 `miniMonitorActive()` 一併消失，這條語意就斷了——玩家開 PiP 正是為了邊做別的事邊看戰鬥，分頁雖然隱藏但畫面確實在被觀看。<br>PiP 狀態在 `ui.js` 的 `MINI`，Worker 看不到，由 Bridge 隨 `visibility` 轉發；PiP 只能在分頁可見時開啟，所以後續的 `visibilitychange` 必然帶對狀態。Bridge 另在 watchdog 輪詢變化補送，但隱藏分頁的計時器會被瀏覽器降頻，那條路徑只當保險。<br>指令表未變動（仍 85 條） |
| 6 | 2026-07-27 | `boot` 新增 `safeMode`：為 `true` 時跳過離線結算。<br>搭配 Bridge 的失效自動重啟（連續 3 次為上限）。離線結算是開機流程裡最會爆的一段——要讀存檔時間戳、重跑一段模擬、再結算獎勵，任何一環碰到異常資料都會拋錯，而拋錯就等於開不了機。安全模式讓玩家至少進得去、匯得出存檔。<br>指令表未變動（仍 85 條） |
| 1 | 2026-07-27 | 初版凍結：6 種入向訊息、8 種出向訊息、11 個面板鍵、67 條指令 |
| 2 | 2026-07-27 | P2 存檔搬遷：新增 `load` 訊息與 `restart` 落地種類；`persist` payload 加 `meta`；`boot` 加 `maxRunId`；`save.*` 三條改為 `fn:null` 並由 Worker 端實作（原宣告會呼叫碰 I/O 的函式，與設計衝突） |
| 5.1 | 2026-07-27 | 補齊 P3 剩餘三個面板所需的投影：`header` 加 `viewStats`／`dps`／`settings`／`autoEquip`／`equipView`／`equipActive`；`equip` 加 `settings`／`stats`／`viewStats`；`inv` 加 `settings`／`equipment`／`viewEquipment` 與 `params.full`（dev 關鍵字搜尋用）。<br>寶石商店的首次鋪貨與 8 小時定時重置移入 Worker tick——原本由 UI 呼叫 `rollGemShop`／`shopHourlyReset`（兩者都在 `INTERNAL_ONLY` 名單），等於「有沒有打開寶石頁」決定商店會不會刷新 |
| 5 | 2026-07-27 | P4 背包裁切：`panel` 訊息新增 `params`；`inv` 改為欄位投影 + `detailIds` 按需索取明細。實測後期存檔 305 KB → 133 KB（少 56%），主執行緒分派 3.2 ms → 2.5 ms。趁 Codex 尚未轉換背包頁時定案，避免他們照舊結構寫完再改一次 |
| 4 | 2026-07-27 | 收斂 Codex `UI_STATE_INVENTORY.md` 盤點的 10 項缺口。<br>新增 `gem.composeAll`、`gem.dismantleAll`（現行 UI 是最多 2500／999 次的同步迴圈，逐次跨執行緒不可行）、`tower.confirmResult`（含連挑續場，語意大於 `finish`）、`stats.reset`（`RUN_STATS`／`LOOT_STATS` 都在 Worker 內）。<br>`tower.start` 改 `fn:null`：手動挑戰同時代表取消等待中的連挑，兩步必須同一原子操作。<br>四項「渲染函式在改狀態」改為搬回 Worker 而非開指令：資源顯示旗標、鑲孔補齊、神鑄開放公告已完成；**護盾正規化經查證不需要搬**——模擬層的 `refreshShieldMaxAfterGain` 已在每一條護盾寫入路徑維護該欄位，`ui.js` 的 `playerShieldMax` 是冗餘，其「版本號遷移」分支永遠不會執行（戰鬥實體是純執行期物件，存檔不含實體）。改為請 Codex 縮成純讀取。<br>`item.toSynth` 不新增：功能被 `SYNTHESIS_ENABLED = false` 關閉。<br>指令總數 81 → **85** |
| 3.1 | 2026-07-27 | 新增 `PERSIST_KINDS.MANUAL_FOLDER`。P2 把 `manualSave` 與 `createManualSaveToFolderV2` 併成同一條資料夾路徑，導致未連接資料夾時「一鍵分解前的保護存檔」靜靜失敗——多數玩家沒接資料夾，那份保護存檔等於不存在。現在 `save.manual` 寫瀏覽器存檔記錄（空間不足才退回資料夾），`save.toFolder` 沒接資料夾就明確失敗 |
| 3 | 2026-07-27 | P3 前置：收斂 Codex 審查提出的指令形狀缺口，逐條比對過實際函式簽章後修正。<br>①**物件識別**：一般寶石改傳 `type`+`level`（沒有 id）、融合寶石用 `fusedId`、熔爐 id 改 `int`、零件改 `partKey`。<br>②**簽章對齊**：`rerollSingleAffix` 改 `affixKey`、`forgePlaceItem` 不解析成物件、`forgePlaceGem` 改 `type`+`level`、`forgeToggleDust` 補 `index`、`convertGems` 改 `slots`+`targetType`、`fuseGemsV2` 改 `ref` 結構。<br>③**補 14 條遺漏指令**（見上）。<br>④**解析改逐指令白名單** `resolve`，同 id 歧義一律拒絕。<br>⑤**參數約束** `limit`（enum/min/max）與**拒絕多餘參數**。<br>⑥ `item.equip`/`unequip`/`salvage` 改為 `fn:null` 原子操作（只呼叫既有函式會複製出第二件物品）。<br>⑦ 補齊 `dirty` metadata（分解鑲寶石裝備會髒 `header`/`gems` 等） |

---

## 9. 關鍵設計決策（不得擅自變更）

由 `docs/WORKER_MIGRATION_PLAN.md` 移入。那份是遷移期的暫時文件，P5 完成後已刪除，
但這幾條是長期約束，改動前請先確認理由仍然成立。

1. **不使用 SharedArrayBuffer。** SAB 需要 COOP/COEP 跨源隔離標頭，而 `.claude/serve.ps1`
   是簡易靜態伺服器、部署環境亦未必可設。一律使用 `postMessage` structured clone。
2. **模擬層維持傳統全域腳本寫法。** 禁止把模擬層改為 ESM 或 `export`——一旦改成 ESM，
   既有測試會全數失效，而那些測試正是模擬層行為的唯一保障。此為硬規則。
3. **存檔 I/O 留在主執行緒。** Worker 沒有 `localStorage`，`showDirectoryPicker` 也只有
   主執行緒可用。Worker 負責 `newGameState` / `migrateSave` / `applyOfflineProgress` /
   序列化；主執行緒負責實際讀寫 localStorage、IndexedDB、存檔資料夾。
   **存檔格式不得改變**，必須向後相容既有存檔。
4. **日誌與掉落統計事件化。** Worker 內的 `blog` / `flog` / `window.recordLoot*` 推入事件佇列，
   隨 tick 合批回主執行緒渲染。技能施放飄字與重要 VFX 可走 `visual` 專用訊息，
   但同一個模擬步驟仍必須合併，禁止每則事件一次 `postMessage`。
5. **Snapshot 分層，禁止每 200 ms 傳送整份 `G`。** 詳見第 3 節。
6. **背景＝在線掛機，關掉遊戲才算離線。**（v9 改，取代原本的「保留背景休眠語意」）
   隱藏分頁維持即時模擬，`applyOfflineProgress` 只在 `boot` 執行。瀏覽器對背景計時器
   的降頻用「欠帳 + CPU 預算分次補完」吸收，時間不得截斷丟棄（見第 6 節）。
   這條是遊戲規則，不是效能取捨——要改請先問使用者。
7. **同一時間只有一個分頁能跑模擬。**（v8）「Worker 是唯一權威」只在單一分頁內成立，
   跨分頁得靠 `navigator.locks` 的具名獨佔鎖（`js/tablock.js`）補上。拿不到鎖的分頁
   **完全不初始化**——不建 Worker、不 `initUI`、不讀存檔，只顯示可接管的遮罩。
   如此「取得控制權的分頁」永遠是剛載入、還沒跑過任何東西的頁面，不必處理半初始化狀態。
   不用 `localStorage` 自製鎖：那必須配過期時間，而過期時間一旦短於分頁被瀏覽器凍結的
   時間就會誤放行；Web Locks 則在分頁當掉或被丟棄時由瀏覽器自動釋出。
   `BroadcastChannel` 只負責通知讓位，不參與判定——它沒有互斥語意。

---

## 10. 效能基準（改動前後請以同口徑複測）

量測方式：`?measure=1` 取訊息規模與分派耗時；`PerformanceObserver` 的 `longtask`
取主執行緒卡頓。fixture 為 `docs/fixtures/save_lategame.json`（背包 800 件、等級 9999）。

⚠️ 兩份 fixture 大小不同（317 KB → 665 KB），`persist` 的數字不可跨期對照，`panel` 與 `tick` 可比。

| 指標 | 遷移期最差 | 目前（P5 完成） |
|---|---|---|
| `panel` 最大 payload | 312,824 bytes | **143,974 bytes**（背包欄位投影，−54%） |
| `panel` 主執行緒分派 | 3.2 ms | **0.7 ms** |
| `persist` 主執行緒佔用 | 5.85 ms | **1.325 ms**（自動存檔改走 `requestIdleCallback`） |
| 切到裝備頁的 longtask | 66～88 ms，每次必現 | **0**（背包格位虛擬捲動） |
| 穩態 20 秒 longtask | — | **0 次**（>50 ms） |
| 800 件背包捲動 | — | **60.78 FPS**，平均畫格 16.45 ms |
| 開機至可操作 | — | **1,288 ms**（P5 前無同口徑基準） |

兩個踩過的坑，日後最佳化時值得先想起來：

1. **`persist` 不要改用 transferable ArrayBuffer。** 拆解 5.9 ms 後發現組成是
   `new Blob` 2.5 ms + `idbSetAutoV2` 同步部分 2.7 ms + 反序列化約 3 ms。
   ArrayBuffer 只省得到最後一項，而且要把 bytes 還原成字串才能餵給既有儲存函式，
   光 TextDecoder 就要 3 ms 以上，等於白做。真正有效的是「自動存檔沒有時效性，
   不必卡在畫格中間」。
2. **`renderInventory` 的成本不在篩選，在強制同步版面計算。** 分段量測 4.36 ms 的組成：
   寫完 `innerHTML` 立刻碰 `scrollTop` 就佔約 2.3 ms（單獨寫 `innerHTML` 只要 0.51 ms）。
   而且那次 `scrollTop` 還原是多餘的——spacer 讓總高度前後一致，不還原也精確保持原位。

### 測試基準線的統計方式

`npm test` 在遷移開工前就有既有失敗（與遷移無關的斷言過時、CSV 與測試不同步等）。
驗收標準是**不得新增失敗**，不是全綠。

⚠️ node test runner 會在結尾的「failing tests:」摘要區把每筆失敗再列一次，
用 `grep -c '^✖'` 會得到兩倍數字。一律以結尾的 `ℹ fail N` 為準：

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
