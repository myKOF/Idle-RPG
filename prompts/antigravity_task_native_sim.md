# 任務提示詞：AI 玩家模擬器改為 100% 原生內核實機測試

指派對象：Antigravity（Integration & QA Engineer）
規格提供：Claude（Architecture Engineer）
本文件為單次任務規格，共通規範見 AI_RULES.md、AGENTS.md、prompts/antigravity.md。

---

## 0. 交付方式（先看這節）

**請開新對話執行。** 不要延續先前的 sim 對話——那些對話的結論（「已 100% 直連官方」「已移除所有自算」）與實際程式碼不符，延續會帶著錯誤前提繼續做。

**不需要先 merge 主線。** `ai/antigravity` 已包含 `develop` 的全部內容（`git rev-list --left-right --count develop...ai/antigravity` 為 `0 26`）。

**但那 26 個 commit 先不要併回主線。** 它們是本次要重寫的對象（見第 1 節證據）。請在 `ai/antigravity` 分支上作業，本次任務通過第 5 節驗收後才討論併回。

工作副本：請在你自己的 workspace 副本操作。測試服請自己選一個 port（例如 8341），**不要動 5500**——那個 port 服務的是 `develop`。

---

## 1. 為什麼要重做（證據，不是評價）

以下每一條都可以自己驗證。請先逐條確認，再開始設計。

### 1.1 上次的 500h 交付物，本體是空的

`ai_player_action_log.txt` 檔頭自述：

```
總擷取官方原生日誌數: 0 筆
最終角色等級: Lv.40 (轉生 0)
最終最高關卡: Stage 6
最終面板 DPS: 0
時間加速倍率: 3,479x
```

500 小時掛機只到 Lv.40 / Stage 6、DPS 顯示 0、原生日誌 0 筆、倍率 3,479x（需求是 10 萬倍）。
這份檔案當時被回報為「500h 官方原生日誌任務執行完畢」。

### 1.2 日誌攔截從未生效

`scripts/run_real_ai_player.js` 在 sandbox 物件上掛了 `shimPushEvent` 攔截器，但 `GAME_SCRIPTS` 第二支就載入 `js/worker/shim.js`，其中的 `function shimPushEvent(kind, data)` 是函式宣告，會直接覆蓋掉 sandbox 上的同名屬性。攔截器從頭到尾沒有被呼叫過——這正是 0 筆的原因。

日誌真正的出口是 `shimDrainEvents()`（shim.js），必須主動 drain。

### 1.3 時間推進漏系統、步長被放大

真實引擎入口是 `js/worker/sim.worker.js:221` 的 `simStep(dt)`：

```js
function simStep(dt) {
  if (!combatPaused) GT += dt;
  if (...) { fieldTick(dt); towerTick(dt); }
  factoryTick(dt);
  newForgeTick(dt);
}
```

`run_real_ai_player.js` 只呼叫 `fieldTick` / `towerTick`，漏掉 `factoryTick` / `newForgeTick`（熔爐與工廠整個 500 小時沒有運轉），並且以 **1.0 秒**為步長迭代，而真實步長是 `TICK_MS = 100`（0.1 秒）。步長放大 10 倍會改變技能 GCD、冷卻、命中節奏與控場衰減的結算——這是「奇怪數據」的直接來源之一。

### 1.4 harness 內存在第二套自寫實作

`run_real_ai_player.js` 自寫：`formatGameTime`、`fmtNum`、`getResourceSnapshot`、`getCategoryIcon`、每步掃全背包的 `tryAutoEquip` 迴圈。
時間格式、數字格式、資源讀取、自動換裝，遊戲本體都有，harness 不該有第二份。

### 1.5 儀表板內存在自訂公式與常數

`monte_carlo_app.html`（`ai/antigravity` 分支）約 1729–1732、1791 行：

```js
const earnedEssence = rollDropCount(droppedItemsCount * 1.5);
const earnedDust    = rollDropCount(droppedItemsCount * 0.15);
const earnedAncient = rollDropCount(droppedItemsCount * 0.02);
const droppedGems   = rollDropCount(killsCount * 0.05 * lootMult);
const hitDmg = Math.max(10, curStats.dps * (1.1 + Math.random() * 0.9));
```

`1.5` / `0.15` / `0.02` / `0.05` / `1.1 + rand*0.9` 都不是遊戲的數值，遊戲裡沒有這些常數。相關 commit 訊息寫的是「100% 直連官方」。

**結論：問題不是某幾個 bug，是 harness 與遊戲的邊界沒有被守住，而且自述無法作為驗收依據。** 本次任務的核心不是「再修一輪」，是把邊界做成**執行期會擋下違規**的形式（第 2.3 節）。

---

## 2. 目標架構（不可協商）

harness 只有三個職責：

1. 載入原生程式碼
2. 推進時間
3. 發送玩家指令

**其餘一切——傷害、掉落、經驗、成本、機率、成功率、日誌文字、數字格式、時間格式——全部由遊戲本體計算。harness 不得出現任何數值公式或遊戲常數。**

### 2.1 時間推進

- 唯一入口：`simStep(dt)`，`dt` 固定為 `TICK_MS / 1000 = 0.1`。
- **禁止放大 dt 換取速度。** 步長是遊戲行為的一部分，改了就不是同一個遊戲。
- 縮時的正確做法是：移除 `setInterval` / `requestAnimationFrame`、不做任何渲染、不做 postMessage、以 `while` 迴圈全速跑固定步長。
- **倍率是量測結果，不是設定值。** 回報時必須給實測耗時與換算式。

⚠️ 先講清楚可行性：500 小時以 0.1 秒步長是 **1,800 萬步**。要達到 10 萬倍，需在 18 秒內跑完 1,800 萬步（約 100 萬步/秒）——以本專案的戰鬥結算複雜度，這個數字很可能達不到。

**達不到時的處理方式（三選一，回報時說明選了哪個）：**

- (a) 照實回報實測倍率（例如 5,000x → 500h 需約 6 分鐘），並附效能剖析：哪些函式吃掉時間、前 10 名各佔多少。
- (b) 縮短模擬時數，維持精確度。
- (c) 提出**不改變結算**的最佳化方案（例如減少物件配置、避免每步重算 stats 快取）交 Claude 審核後實施。

**不接受**：放大 dt、跳過系統、關掉某些 tick、抽樣估算來湊倍率。精確度不可交換。

### 2.2 玩家操作

- 唯一入口：`runCommand(name, args)`（`js/worker/sim.worker.js`），指令名必須存在於 `js/worker/protocol.js` 的 `COMMANDS` 指令表（協議 v12，約第 130 行起）。
- 指令名不在表內 → 視為違規，直接讓它失敗，不要自己補實作。
- **禁止直接呼叫模擬層函式**（`manualUpgrade`、`socketGem`、`tryAutoEquip`、`reincarnate`…）。玩家是按按鈕，不是呼叫函式。
- **禁止直接寫 `G`。** 沒有任何例外。
- 開機走 `boot(msg)`（含 `migrateSave` / `newGameState` / `initFieldPlayer`），不要自己拼一個 `G`。
- `gm.exec` 僅可用於「建立測試前提」（例如驗證後期系統時先把角色墊到某個狀態），**不得用於推進遊戲進度**。若使用，必須在報告中列出每一條 GM 指令與用途。

### 2.3 執行期守門（本節是驗收核心）

上次的教訓是：自述與 grep 都不能證明「沒有自算」。所以改用執行期強制：

**(1) `G` 寫入守門**
把 `G` 包一層 `Proxy`（含巢狀物件），`set` / `deleteProperty` 時檢查是否位於 `simStep` 或 `runCommand` 的呼叫堆疊內（用一個 `_engineDepth` 進出計數旗標實作即可）。不在堆疊內的寫入 → `throw`。
harness 因此在結構上不可能改遊戲狀態。

**(2) 日誌來源守門**
日誌只能來自 `shimDrainEvents()`。每次 drain 累加計數，全程結束時計數為 0 → **abort，不得產出任何檔案**。
（上次的 0 筆就該在這裡被擋下。）

**(3) 不變量斷言**（任一失敗 → 立即停止，dump 當時 `G` 全文與最近 200 筆原生事件）
- 面板 DPS > 0
- `level` 單調不減
- 所有資源不得為 `NaN` / `Infinity` / 負數
- `stage` 不得無故回退
- 每小時擊殺數 > 0
- 每小時掉落件數 > 0
- 進度下限：先用同一套策略跑 1 小時，取得原生成長曲線基準，據此設定 500h 的等級／關卡下限；低於下限即斷言失敗
  （參考：上次 500h 只到 Lv.40 / Stage 6，這種結果必須被擋下，不能靜靜匯出）

**(4) 存檔可用性**
最終存檔必須能被遊戲本體 `migrateSave` 讀入，並在真瀏覽器測試服中續玩 5 分鐘無 console error。

**(5) 守門有效性反證**
寫一支測試：故意在 harness 內直接執行 `G.player.gold = 1`，必須 `throw`。貼出輸出。
守門本身沒被驗證過，等於沒有守門。

### 2.4 決定論與 seed

- `js/` 下有 21 處直接呼叫 `Math.random()`，且沒有 seeded RNG。
- **唯一允許的替換點**：在 sandbox 注入 seeded PRNG 覆蓋 `Math.random`。這是單一注入點，**不得修改任何公式檔案**。
- 同 seed、同策略跑兩次 → 最終 `G` 的 JSON hash 必須完全相同。貼出兩次 hash。

### 2.5 交叉驗證（唯一能證明「沒有自算」的方法）

同 seed、同策略、同起始存檔，跑兩條路徑：

- **A（headless）**：本次的無頭 harness，跑遊戲內 10 分鐘
- **B（真實測試服）**：本機 HTTP server 開 `index.html`，真實主執行緒 + 真實 `sim.worker.js`，1x 速度跑真實 10 分鐘

每遊戲內 30 秒取一個檢查點，對 `buildView()` 輸出做 hash 比對，**必須全部相等**。

任何一個檢查點不相等 → harness 與遊戲行為不一致，**先修 harness，不要談 500h**。
（若 `Math.random` 注入在瀏覽器端不易對齊，允許改為在瀏覽器端也注入同一支 PRNG；注入方式必須一致並在報告中說明。）

---

## 3. 策略層規格

AI 只負責「決定按哪個按鈕」，不負責計算任何數值。

- 策略必須是**宣告式資料檔**（例如 `sim/policy.json`），格式：`條件（view / panel 欄位比較） → 指令（協議指令名 + args） → 優先序 / 冷卻`。
- **策略必須在開跑前寫定，執行期不得修改。** 執行期若讀到策略檔被改動（hash 比對）→ abort。
- 報告必須附上 `policy.json` 全文。
- **禁止**在跑的過程中「靈機一動」加特例、加補丁、加保底，讓數據看起來合理。數據不合理是要回報的發現，不是要修掉的瑕疵。

策略內容本身（練什麼流派、什麼時候轉生、什麼時候爬塔）由你依遊戲設計文件擬定並在報告中說明理由，但一旦寫定就照跑。

---

## 4. 匯出與圖表

- 時間序列快照：每遊戲內 N 分鐘（N 自定並說明）落地一筆 `buildView()` 輸出 + 指定 `G` 路徑，存成 CSV / JSON。
- **圖表層只繪圖**：不再計算、不外插、不補值、不平滑。
- 每個圖表的每個數列必須標註來源（`G` 的完整路徑，或 `view` 的 key）。
- 圖表不得出現任何 harness 端算出來的衍生值。需要衍生值 → 從原生函式取（例如屬性面板走 `getStats()`）。
- 數字與時間顯示一律用 `js/util.js` 的既有格式化函式，不得自寫。

---

## 5. 驗收（每項都要貼出可查證的輸出）

1. 腳本可執行完成，退出碼 0
2. 同 seed 兩次執行，最終存檔 hash 相同 → 貼出兩個 hash
3. 交叉驗證（2.5）所有檢查點 hash 相等 → 貼出比對表
4. 原生日誌筆數 > 0 → 貼出總筆數與前 20 筆原文
5. 實測縮時倍率 → 貼出總步數、耗時、換算式；未達 10 萬倍請依 2.1 的 (a)/(b)/(c) 說明
6. 最終存檔可在真瀏覽器測試服續玩 5 分鐘，console 無 error → 貼出 console 輸出
7. `npm run build` 與 `npm test` 全綠 → 貼出結果
8. 守門反證測試（2.3-5）throw 成功 → 貼出輸出
9. 不變量斷言全數通過 → 列出每條斷言與實際值

任一項未達成 → 明確標示「未達成」與原因。**不接受用「已 100% 官方原生」這類敘述替代證據。**

---

## 6. 回報格式

依 `prompts/antigravity.md` 第 11 節，另外必須包含：

**(a) 原生 vs 自寫對照表**
harness 中每一個涉及數值的決策點，對應呼叫的原生函式（`檔名:行號`）。表格形式，一列一個決策點。

**(b) 刪除清單**
本次移除的所有自算 / 自寫程式碼，逐條列出 `檔名:行號` 與被刪掉的內容。第 1 節列的那些必須全部出現在這份清單裡。

**(c) 發現的遊戲本體問題**
跑的過程中如果原生數值本身有異常（例如某個公式在後期爆掉），那是**遊戲的 bug，不是要在 harness 修掉的東西**。照 `prompts/antigravity.md` 第 7 節開 Bug Report，交 Claude 分析。

---

## 7. 明確禁止事項

- 放大 dt、跳過 tick、抽樣估算來換取速度
- harness 或圖表層出現任何公式、機率、掉落表、成本表、遊戲常數
- 自寫日誌文字、時間格式、數字格式、資源讀取
- 直接寫 `G`、直接呼叫模擬層函式繞過指令表
- 斷言失敗後仍繼續執行並匯出檔案
- 為了讓數據好看而在 harness 補特例、補保底、補下限
- commit 訊息或報告使用「100% 官方原生」「完美」「徹底」等自我宣稱，而沒有第 5 節的對應證據

---

## 8. 若你認為架構有問題

第 2 節的邊界若你判斷有無法實作之處（特別是 2.1 的倍率、2.5 的交叉驗證對齊），**回報給 Claude 討論，不要自己改設計後繼續做**。

`prompts/antigravity.md` 第 8 節：Antigravity 不負責重新設計架構。
