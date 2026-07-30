# 任務提示詞：模擬器收斂成一套 + 試跑驗證 + 儀表板改造

指派對象：Antigravity（Integration & QA Engineer）
規格提供：Claude（Architecture Engineer）
共通規範見 AI_RULES.md、AGENTS.md、prompts/antigravity.md

---

## 0. 交付方式

**請開新對話執行。**

**不需要 merge。** 三條 AI 支線與 develop 已經全部合併同步，你的工作副本就是最新的。

**動工前先跑衝突預檢**：確認沒有其他副本／分支同時在動 `monte_carlo_app.html`
與 `scripts/`。有的話先問，不要直接改。

先讀 `docs/SIM_HARNESS.md`——那是模擬器架構與已驗證事實的單一來源。

---

## 1. 現況：合併之後，同一件事有兩套

你和 Claude 各自做了一套 headless 模擬器，合併後兩套都在樹上：

| 功能 | 你的版本 | Claude 的版本 |
| :--- | :--- | :--- |
| 模擬器主體 | `scripts/run_real_ai_player.js` | `scripts/run_sim.js` + `scripts/sim/` |
| 守門反證 | `scripts/test_guard_counterproof.js` | `scripts/test_policy_isolation.js` |
| 交叉驗證 | `scripts/cross_validate.js` | `scripts/cross_check.js` |

**兩套並存是必須解決的問題**，不是風格差異。日後任何人看到一張圖或一份數據，
都得先問「這是哪一套跑的」——而那正是這整件事最初出問題的原因。

先講清楚：你那份 `run_real_ai_player.js` 已經和最初那版完全不同了。
它載入 `sim.worker.js`、固定 dt=0.1、種子化 RNG、`shimDrainEvents()` 零筆即 abort、
有不變量斷言——這些方向都對，而且是獨立收斂到和 Claude 幾乎一樣的設計。
以下的取捨是基於**實測差異**，不是基於誰寫的。

---

## 2. 取捨依據（都是量出來的，不是主張）

### 2.1 虛擬時鐘：你的版本沒有，這會凍結兩個系統

`scripts/run_real_ai_player.js:75` 是 `Date: Date`——用真實時鐘。

模擬層有兩處直接讀真實時鐘決定遊戲行為：

- `js/item.js:263` 寶石商店以 `Date.now() - hourStart` 判斷 8 小時輪替
- `js/worker/sim.worker.js` 的 `simStep()` 內 `forgeTick(Date.now())`，熔煉完成時間比對 `startedAt`

縮時上千倍時真實時鐘幾乎沒走，這兩個系統會整場靜止。實測（seed=99，20 遊戲小時）：

| | 寶石商店重新鋪貨次數 | 最終等級 |
| :--- | ---: | ---: |
| 虛擬時鐘 | **3** | Lv.20 |
| 真實時鐘 | **1**（只有開場那次） | Lv.19 |

20 小時少 2 次輪替，100 小時就少 12 次。玩家實際會經歷 12 輪新商品，模擬跑出來的是同一間店開到底。

### 2.2 Proxy 守門：你用的是會改變遊戲行為的那一版

`scripts/run_real_ai_player.js` 的 Proxy 守門沒有 WeakMap 快取，
也就是 `docs/PROXY_GUARD_OPTIMIZATION.md` 裡稱為「原實作」的那一版。

`scripts/proxy_guard_ab.js` 實測（seed=4242，20 遊戲分鐘）：

| 變體 | G 雜湊 | 結果 |
| :--- | :--- | :--- |
| 不裝守門 | `e265152d…` | Lv.7 stage 2 gold 98,695 |
| naive（每次 get 新建 Proxy） | `71e4e49d…` | Lv.6 stage 2 gold 91,448 ❌ |
| cached（WeakMap） | `e265152d…` | 與基準相同 ✅ |

原因是物件識別比對：`js/battlefield.js:186` 的 `bfLiveList(...).indexOf(locked)`
配上 `js/combat.js:665` 跨 tick 持有的 `_lockTarget`，每次 `get` 新建 Proxy 會讓比對必定失敗，
鎖定目標每一 tick 都被判定為不在場。

**20 分鐘就少 7% 金幣、少一級。用它跑出來的數據無效。**

Claude 那套不在熱路徑放 Proxy，改用能力隔離：策略跑在沒有 `G`、沒有 `FIELD`、
沒有 `require`、沒有 `process` 的獨立 context，只拿得到 `buildView()` 的深拷貝。
拿不到參照的東西不需要被監控，而且 Proxy 本來就包不住 module-level 的 `FIELD`（`js/combat.js:5`）。

### 2.3 交叉驗證：你那支比對的是同一條路徑

`scripts/cross_validate.js:140-141`：

```js
const pathA = runSimInstance(42, 600, 30);
const pathB = runSimInstance(42, 600, 30);
```

兩次呼叫參數完全相同，而且都在同一個 Node 行程、同一份程式碼裡。
**那是決定論檢查，不是交叉驗證**——瀏覽器從頭到尾沒有進場，
所以它證明不了「harness 跑的和玩家玩的是同一個遊戲」。

決定論本身要驗，但已經有 `scripts/verify_equivalence.js` 在做。

`scripts/cross_check.js` 比對的是**真瀏覽器**（真 `index.html`、真 Worker、真 IndexedDB）
與 headless，已通過：275 個檢查點的 `buildView()` 全部 24 欄逐欄一致。

---

## 3. 任務 A：收斂成一套

**基準是 `scripts/run_sim.js` + `scripts/sim/`**（已通過瀏覽器交叉驗證的那套）。

### A-1 刪除

```
scripts/run_real_ai_player.js
scripts/cross_validate.js
scripts/test_guard_counterproof.js
docs/PROXY_GUARD_OPTIMIZATION.md   （方案已被實測否決，見 2.2；保留只會誤導）
```

刪除前先做 A-2。

### A-2 移植：你那邊獨有而有價值的東西，不要跟著刪掉

**這一步是你的判斷，不是照單全收 Claude 的版本。** 請自己讀過兩邊，挑出你那份
有、而 `run_sim.js` 沒有的東西，移植過去。Claude 看到的候選（不代表全部）：

- 人類可讀的 TXT 履歷輸出（目前只有 `native_events.jsonl`，機器讀友善但人不好看）
- 戰鬥日誌節流策略（`scripts/run_real_ai_player.js:207` 附近）
- 你寫的不變量斷言中，`scripts/run_sim.js` 沒涵蓋到的項目

移植時的規則：不得夾帶任何遊戲公式或常數；日誌一律取自 `shimDrainEvents()`，
不得自己組訊息、自己排時間戳格式。

移植完成後跑一次 `scripts/verify_equivalence.js`，確認決定論仍然成立。

---

## 4. 任務 B：試跑與驗證

### B-1 先跑驗證（秒～分鐘級），五項全綠才往下走

```
node scripts/test_policy_isolation.js
node --max-semi-space-size=64 scripts/verify_equivalence.js 1
node --max-semi-space-size=64 scripts/proxy_guard_ab.js 20
npm test
npm run build
```

任何一項紅燈：**停下來回報，不要自己改 harness**。

`--max-semi-space-size=64` 是 GC 調參，實測比預設快約 1.4 倍，不影響結果。

### B-2 100 小時正式試跑

```
node --max-semi-space-size=64 scripts/run_sim.js --hours=100 --seed=20260730
```

約 5～6 分鐘。輸出在 `sim_out/`（已 gitignore，不要 commit）。

另外用 `scripts/sim/policy.lategame.json` 跑一次短的，驗證天賦／神鑄／高塔會動：

```
node --max-semi-space-size=64 scripts/run_sim.js --hours=2 --policy=scripts/sim/policy.lategame.json --out=sim_out_late
```

⚠️ 這份用 GM 墊出已轉生角色（`run_summary.json` 的 `gmBootstrap` 會揭露）。
它只能證明「系統會動」，**不能拿來談成長曲線**。

### B-3 交叉驗證重跑

步驟見 `docs/SIM_HARNESS.md`。兩個一定會踩到的坑：

1. **用 `127.0.0.1` 不要用 `localhost`。** 不同 hostname 是不同 origin，
   才不會讀到（或覆寫）既有存檔。用 localhost 會讀到舊存檔，比對必定全紅。
2. **網址一定要帶 `?seed=N`**，否則不進決定論測試模式，比對在結構上做不到。

### B-4 判讀（重點）

**`run_summary.json` 的 `commands` 不能只看「送出」。** 四類分開讀：

| 欄位 | 意思 |
| :--- | :--- |
| `effective` | 真的做到了 |
| `noEffect` | 沒做到，`reasons` 是**遊戲自己給的原話** |
| `unknown` | 指令無回傳值，要看原生日誌才知道 |
| `error` | 協議層就被擋下 |

⚠️ 模擬層的回傳慣例與直覺相反：**`null` 是成功、字串是失敗原因**
（`js/skills.js:2129` 成功時 `return null`，失敗時 `return '技能點不足'`）。
這個坑已經踩過一次——天真判斷 truthy 會把 1200 次失敗全部報成成功。

要回答的問題：

- 100 小時的成長曲線合不合理？（等級、關卡、資源、戰力）
- `noEffect` 的 `reasons` 裡，哪些是**策略該調整**、哪些是**遊戲數值該檢討**？
- 有沒有哪個系統整場沒生效？（某條規則 `effective` 恆為 0）
- 快照 CSV 有沒有不連續、倒退、爆衝？

**成長曲線慢不等於 bug。** 預設策略 10 小時只到 Lv.16，可能是策略保守，也可能是數值設計。
你要做的是指出現象並分辨這兩者，不是自己調數值讓它好看。

---

## 5. 任務 C：儀表板改造（monte_carlo_app.html）

### 為什麼要改

儀表板目前自己算掉落與傷害：

```js
earnedEssence = rollDropCount(droppedItemsCount * 1.5);   // 1732 行
droppedGems   = rollDropCount(killsCount * 0.05 * lootMult); // 1735 行
hitDmg        = Math.max(10, curStats.dps * (1.1 + Math.random() * 0.9)); // 1794 行
```

`1.5` / `0.05` / `1.1 + rand*0.9` 都不是遊戲的數值，遊戲裡沒有這些常數。
這就是「奇怪數據」的來源。現在有原生資料可以接了。

### 要做成什麼

儀表板**只讀檔、只畫圖**：

- `sim_out/snapshots.csv` — 每一欄都是遊戲原生的值
- `sim_out/snapshots.meta.json` — 已列出每一欄取自 `G` 的哪個路徑或 `buildView()` 的哪個 key，
  圖表的圖例／tooltip 要能顯示這個來源
- `sim_out/native_events.jsonl` — 遊戲原生事件
- `sim_out/run_summary.json` — 效能實測、指令統計、GM 前置揭露

### 硬性規則

1. **繪圖層不得做任何計算。** 不再計算、不外插、不補值、不平滑、不推估。
   需要衍生值 → 回頭在 `scripts/run_sim.js` 的快照裡從原生函式取（例如 `getStats()`），
   改 `SNAP_VIEW_KEYS` 或 `snapshot()` 並同步更新 meta，**不是在 HTML 裡算**。
2. **刪掉所有自算程式碼**，包含上面那幾行與 `rollDropCount` 之類的自製隨機模型。
   每一段都要列進報告的「刪除清單」（檔名:行號 + 內容）。
3. **不要保留「兩種引擎切換」。** 蒙地卡羅統計模型與原生內核並存，
   只會讓下一個人分不清手上這張圖是哪來的。留一套：原生。
4. `run_summary.json` 的 `gmBootstrap` 非空時，儀表板必須**明顯標示**
   「本次數據含 GM 建立的測試前提」並列出每一條指令。墊出來的狀態不能混進成長曲線。

---

## 6. 任務 D：策略擴充（選作，資料層）

策略是 JSON 資料不是程式，直接改 `scripts/sim/policy.default.json`。
格式與機制（`expand` / `$path` / `if` / `everySec`）見該檔與 `scripts/sim/policy.js` 註解。

目前未涵蓋：寶石鑲嵌與轉換、裝備洗詞條、技能融合、附魔。

- 指令名必須存在於 `js/worker/protocol.js` 的指令表
- **不要在策略裡預判**「這樣做划不划算」。送出去，讓遊戲回錯，看 `reasons`
- 每條規則要寫 `why`
- 改完重跑 B-1，確認決定論仍成立

---

## 7. 明確禁止

- **改 harness 的邊界**：策略隔離、虛擬時鐘、種子注入、`simStep`/`runCommand` 的呼叫方式。
  覺得有問題 → 回報 Claude，不要自己改設計（prompts/antigravity.md 第 8 節）
- 在 harness 或儀表板寫任何遊戲公式、常數、機率、掉落表
- 放大 dt、跳過 tick、抽樣估算來換取速度
- 為了讓數據好看而在策略或儀表板補特例、補保底
- commit 訊息或報告使用「100% 官方原生」「完美」「徹底」而沒有對應證據
- 把 `sim_out/` 的產出物 commit 進版控

---

## 8. 回報格式

依 `prompts/antigravity.md` 第 11 節，另外必須包含：

**(a) 收斂結果**：刪了什麼、移植了什麼、為什麼。移植的每一項要說明它解決什麼問題。

**(b) 驗證結果表**：B-1 五項 + B-3 交叉驗證，逐項貼出實際輸出（不是「通過」兩個字）。

**(c) 100 小時試跑判讀**：依 B-4 的四個問題回答，附快照曲線與關鍵數字。

**(d) 刪除清單**：儀表板改造中移除的所有自算程式碼，檔名:行號 + 內容。

**(e) 資料來源對照表**：每個圖表的每個數列 → CSV 欄位 → `G` 路徑或 view key。

**(f) 發現的遊戲本體問題**：原生數值若本身異常，那是**遊戲的 bug，不是要在儀表板修掉的東西**。
依 `prompts/antigravity.md` 第 7 節開 Bug Report，交 Claude 分析。

**(g) 未達成項目**：明確標示，不要用敘述帶過。

---

## 9. 交叉驗證的已知限制（報告要一起寫）

決定論測試模式（`?seed=N` + 本機 hostname）與正式遊玩有四處差異：

1. `Math.random` 換成種子化 mulberry32
2. 每個計時器週期固定走一整步，不補欠帳、不走殘步
3. 維護區塊改以步數計時，而非真實時間
4. 一律以全新角色開機，不讀存檔、不落地存檔

第 2、3 點不是可有可無：正式路徑每輪最後會走一個不足 0.1 秒的殘步，長度取決於計時器抖動，
連同一個瀏覽器跑兩次都不會一樣；而維護區塊裡的 `maintainGemShop` 首次會呼叫
`rollGemShop()` 消耗亂數，它落在第 2 步還是第 3 步會讓整條亂數序列岔開。
沒有這兩項，比對在結構上做不到。

所以這道驗證證明的是「headless ≡ 測試模式的瀏覽器」。
**報告不得把它寫成「與正式遊玩完全一致」。**
