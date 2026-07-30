# 任務提示詞：原生內核模擬器 試跑驗證 + 儀表板改造

指派對象：Antigravity（Integration & QA Engineer）
規格提供：Claude（Architecture Engineer）
共通規範見 AI_RULES.md、AGENTS.md、prompts/antigravity.md

---

## 0. 交付方式（先看這節）

**請開新對話執行。**

**開工前必須先 merge。** harness 是新做的，全部在 Claude 那條線上，你的分支沒有這些檔案：

```
scripts/sim/            engine.js / rng.js / hash.js / policy.js
                        policy.default.json / policy.lategame.json
scripts/run_sim.js      scripts/bench_sim.js
scripts/verify_equivalence.js
scripts/test_policy_isolation.js
scripts/cross_check.js
scripts/proxy_guard_ab.js
docs/SIM_HARNESS.md
```

另有既有檔案的改動：`js/worker/sim.worker.js`、`js/bridge.js`、`tools/build_check.cjs`、`.gitignore`。

**`ai/antigravity` 上那 26 個 commit（monte_carlo_app.html 那批）先不要併回主線。**
它們的做法已被取代，理由見第 3 節。本次任務會把那份儀表板改造成接原生資料，改造完成後再談併回。

**動工前先跑一次衝突預檢**：確認沒有其他副本／分支同時在動 `monte_carlo_app.html`
與 `scripts/`。有的話先問，不要直接改。

---

## 1. 現況：harness 已完成並通過驗證

先讀 `docs/SIM_HARNESS.md`，那是架構與已驗證事實的單一來源。摘要：

- 推進時間走遊戲自己的 `simStep()`、操作走 `runCommand()`、觀測走 `buildView()`
- `js/worker/sim.worker.js` 是**原封不動**被載進 vm 的，它自己 importScripts 那 20 支檔案
- harness 內沒有任何遊戲公式或常數；策略跑在**沒有 `G`、沒有 `FIELD`** 的隔離 context
- 只替換三樣瀏覽器環境：`Math.random`（種子化）、`Date`／`performance`（虛擬時鐘）、Worker 環境替身

已驗證（每一項都有可重跑的腳本）：

| 檢查 | 結果 |
| :--- | :--- |
| 決定論（同 seed 兩次 → G 雜湊相同） | ✅ |
| `updateShownRes` 改造前後等價 | ✅ |
| 策略層隔離反證 12 項 | ✅ 全部擋住 |
| 真瀏覽器 ↔ headless 交叉驗證 | ✅ 275 個檢查點全部一致 |
| 既有測試 664 支 + `npm run build` | ✅ 全綠 |
| 效能 | 10,000～12,000 步/秒，100 遊戲小時約 5～6 分鐘 |

**你的工作不是重做這些，是驗證它們在你手上也成立，然後把儀表板接上去。**

---

## 2. 任務 A：試跑與驗證

### A-1 先跑三支驗證（秒～分鐘級）

```
node scripts/test_policy_isolation.js
node --max-semi-space-size=64 scripts/verify_equivalence.js 1
node --max-semi-space-size=64 scripts/proxy_guard_ab.js 20
npm test
npm run build
```

五項全綠才往下走。任何一項紅燈：**停下來回報，不要自己改 harness**。

`--max-semi-space-size=64` 是 GC 調參，實測比預設快約 1.4 倍，不影響結果。

### A-2 100 小時正式試跑

```
node --max-semi-space-size=64 scripts/run_sim.js --hours=100 --seed=20260730
```

輸出在 `sim_out/`（已 gitignore，不要 commit 進版控）。

### A-3 交叉驗證重跑一次

步驟寫在 `docs/SIM_HARNESS.md` 的「交叉驗證」一節，照做。

⚠️ 兩個一定會踩到的坑：

1. **用 `127.0.0.1` 不要用 `localhost`。** 不同 hostname 是不同 origin，
   才不會去讀（或覆寫）既有存檔。用 localhost 會讀到舊存檔，比對必定全紅。
2. **網址一定要帶 `?seed=N`**，否則不會進入決定論測試模式，比對在結構上就做不到
   （正式路徑每輪會走一個不足 0.1 秒的殘步，長度取決於真實計時器抖動）。

### A-4 判讀（這節是重點）

**`run_summary.json` 的 `commands` 不能只看「送出」。** 四類分開讀：

| 欄位 | 意思 |
| :--- | :--- |
| `effective` | 真的做到了 |
| `noEffect` | 沒做到，`reasons` 是**遊戲自己給的原話** |
| `unknown` | 指令無回傳值，要看原生日誌才知道結果 |
| `error` | 協議層就被擋下 |

⚠️ 模擬層的回傳慣例與直覺相反：**`null` 是成功、字串是失敗原因**
（`js/skills.js:2129` 成功時 `return null`，失敗時 `return '技能點不足'`）。
這個坑已經踩過一次——天真判斷 truthy 會把 1200 次失敗全部報成成功。

判讀時回答這幾個問題：

- 100 小時的成長曲線合不合理？（等級、關卡、資源、戰力）
- `noEffect` 的 `reasons` 裡，哪些是**策略該調整**、哪些是**遊戲數值該檢討**？
- 有沒有哪個系統整場沒有生效？（看 `commands` 有沒有某條規則 `effective` 恆為 0）
- 快照 CSV 裡有沒有不連續、倒退、爆衝？

**成長曲線慢不等於 bug。** 目前預設策略 10 小時只到 Lv.16，可能是策略保守，
也可能是數值設計。你要做的是**指出現象並分辨這兩者**，不是自己去調數值讓它好看。

---

## 3. 任務 B：儀表板改造（monte_carlo_app.html）

### 為什麼要改

那份儀表板現在自己算掉落與傷害，以下是它目前的內容（`ai/antigravity` 分支）：

```js
earnedEssence = rollDropCount(droppedItemsCount * 1.5);
earnedDust    = rollDropCount(droppedItemsCount * 0.15);
earnedAncient = rollDropCount(droppedItemsCount * 0.02);
droppedGems   = rollDropCount(killsCount * 0.05 * lootMult);
hitDmg        = Math.max(10, curStats.dps * (1.1 + Math.random() * 0.9));
```

`1.5` / `0.15` / `0.02` / `0.05` / `1.1 + rand*0.9` 都不是遊戲的數值，遊戲裡沒有這些常數。
這就是你一直看到「奇怪數據」的來源。

現在有原生資料可以接，不需要再自己算。

### 要做成什麼

儀表板**只讀檔、只畫圖**：

- 資料來源：`sim_out/snapshots.csv`（每一欄都是遊戲原生的值）
- 欄位來源標註：`sim_out/snapshots.meta.json` 已經列出每一欄取自 `G` 的哪個路徑
  或 `buildView()` 的哪個 key——圖表的圖例／tooltip 要能顯示這個來源
- 事件明細：`sim_out/native_events.jsonl`（遊戲原生 blog/flog/loot/notice）
- 執行資訊：`sim_out/run_summary.json`（效能實測、指令統計、GM 前置揭露）

### 硬性規則

1. **繪圖層不得做任何計算。** 不再計算、不外插、不補值、不平滑、不推估。
   需要衍生值 → 回頭在 `scripts/run_sim.js` 的快照裡從原生函式取（例如 `getStats()`），
   而不是在 HTML 裡算。要加欄位就改 `SNAP_VIEW_KEYS` 或 `snapshot()`，並同步更新 meta。
2. **刪掉所有自算程式碼**，包含上面那五行與 `rollDropCount` 之類的自製隨機模型。
   刪掉的每一段都要列進報告的「刪除清單」（檔名:行號 + 內容）。
3. **不要保留「兩種引擎切換」。** 蒙地卡羅那套統計模型與原生內核並存，
   只會讓下一個人分不清手上這張圖是哪來的。留一套：原生。
4. 若 `run_summary.json` 的 `gmBootstrap` 非空，儀表板必須**明顯標示**
   「本次數據含 GM 建立的測試前提」，並列出每一條指令。
   墊出來的狀態不能混在成長曲線裡當成模擬結果。

---

## 4. 任務 C：策略擴充（選作，資料層）

策略是 JSON 資料，不是程式，你可以直接改 `scripts/sim/policy.default.json`。
規則格式與可用機制見該檔與 `scripts/sim/policy.js` 的註解（`expand` / `$path` / `if` / `everySec`）。

目前未涵蓋：寶石鑲嵌與轉換、裝備洗詞條、技能融合、附魔。

擴充時的規則：

- 指令名必須存在於 `js/worker/protocol.js` 的指令表
- **不要在策略裡預判**「這樣做划不划算」。送出去，讓遊戲回錯，看 `reasons`
- 每條規則要寫 `why`
- 改完重跑 A-1 的驗證，確認決定論仍然成立

---

## 5. 明確禁止

- **改 harness 的邊界**：策略隔離、虛擬時鐘、種子注入、`simStep`/`runCommand` 的呼叫方式。
  覺得有問題 → 回報 Claude，不要自己改設計（prompts/antigravity.md 第 8 節）
- 在 harness 或儀表板寫任何遊戲公式、常數、機率、掉落表
- 放大 dt、跳過 tick、抽樣估算來換取速度
- 為了讓數據好看而在策略或儀表板補特例、補保底
- commit 訊息或報告使用「100% 官方原生」「完美」「徹底」而沒有對應證據
- 把 `sim_out/` 的產出物 commit 進版控

---

## 6. 回報格式

依 `prompts/antigravity.md` 第 11 節，另外必須包含：

**(a) 驗證結果表**：A-1 五項 + A-3 交叉驗證，逐項貼出實際輸出（不是「通過」兩個字）

**(b) 100 小時試跑判讀**：依 A-4 的四個問題回答，附快照曲線與關鍵數字

**(c) 刪除清單**：儀表板改造中移除的所有自算程式碼，檔名:行號 + 內容

**(d) 資料來源對照表**：儀表板每個圖表的每個數列 → 對應的 CSV 欄位 → 對應的 `G` 路徑或 view key

**(e) 發現的遊戲本體問題**：跑出來的原生數值若本身異常，那是**遊戲的 bug，不是要在儀表板修掉的東西**。
依 `prompts/antigravity.md` 第 7 節開 Bug Report，交 Claude 分析。

**(f) 未達成項目**：明確標示，不要用敘述帶過。

---

## 7. 交叉驗證的已知限制（報告要一起寫）

決定論測試模式（`?seed=N` + 本機 hostname）與正式遊玩有四處差異：

1. `Math.random` 換成種子化 mulberry32
2. 每個計時器週期固定走一整步，不補欠帳、不走殘步
3. 維護區塊改以步數計時，而非真實時間
4. 一律以全新角色開機，不讀存檔、不落地存檔

第 2、3 點不是可有可無的：正式路徑的殘步長度取決於計時器抖動，
而維護區塊裡的 `maintainGemShop` 首次會呼叫 `rollGemShop()` 消耗亂數——
它落在第 2 步還是第 3 步會讓整條亂數序列岔開。沒有這兩項，比對在結構上做不到。

所以這道驗證證明的是「headless ≡ 測試模式的瀏覽器」。
報告不得把它寫成「與正式遊玩完全一致」。
