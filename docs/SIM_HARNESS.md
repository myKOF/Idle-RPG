# AI 玩家模擬器（原生內核 headless）

## 這是什麼

用**遊戲本體的程式碼**跑 AI 玩家掛機模擬。所有數值——傷害、掉落、經驗、成本、機率、
日誌文字——都由遊戲自己算；harness 只負責推進時間、在決策點問策略、把指令送進遊戲。

harness 內沒有任何遊戲公式或常數。這不是靠自律，是靠結構（見「隔離」一節）。

---

## 怎麼跑

```bash
node --max-semi-space-size=64 scripts/run_sim.js --hours=100 --seed=20260730
```

| 腳本 | 用途 |
| :--- | :--- |
| `scripts/run_sim.js` | 主模擬，輸出存檔／快照 CSV／原生事件／執行摘要 |
| `scripts/bench_sim.js` | 純效能量測（無策略） |
| `scripts/verify_equivalence.js` | 決定論 + 改造等價性 + 種子敏感度 |
| `scripts/test_policy_isolation.js` | 策略層隔離反證（每項都必須失敗） |
| `scripts/cross_check.js` | 真瀏覽器 ↔ headless 逐檢查點比對 |
| `scripts/verify_trace.js` | 真人錄製 ↔ 軌跡重播逐檢查點比對（見「真人基準線」） |
| `scripts/compare_runs.js` | 兩場模擬的曲線對照（真人 vs AI） |
| `scripts/proxy_guard_ab.js` | Proxy 守門方案的行為中性 A/B 判定 |

策略檔（資料，非程式）：

| 檔案 | 用途 |
| :--- | :--- |
| `scripts/sim/policy.default.json` | 從零開始的掛機策略。看成長曲線用這份 |
| `scripts/sim/policy.lategame.json` | 以 GM 墊出已轉生角色，專門驗證天賦／神鑄／高塔會不會動。**不能拿來談成長曲線** |

`--max-semi-space-size=64` 是 GC 調參，實測比預設快約 1.4 倍，不影響結果。

輸出在 `sim_out/`（已 gitignore）：

- `save_final.json` — 可直接匯入遊戲續玩
- `snapshots.csv` + `snapshots.meta.json` — 圖表資料與**每一欄的來源標註**
- `native_events.jsonl` — 遊戲原生 blog/flog/loot/notice 事件（非 harness 自組）
- `run_summary.json` — 效能實測、指令統計、事件計數、狀態雜湊

---

## 架構

```
run_sim.js（驅動）
   │  推進時間 → engine.step(n)          每步 dt = TICK_MS/1000 = 0.1s，不放大
   │  觀測     → engine.view()           = 原生 buildView()
   │  決策     → policy.decide(深拷貝)    隔離 context，見下
   │  送指令   → engine.cmd(name, args)  = 原生 runCommand()
   ▼
sim/engine.js（宿主）
   │  把 js/worker/sim.worker.js 原封不動載進 vm context
   │  它自己 importScripts 那 20 支模擬層檔案，載入順序與線上完全一致
   ▼
遊戲本體
```

### 只替換「瀏覽器環境」，不替換遊戲

| 替換項 | 為什麼 |
| :--- | :--- |
| `Math.random` → 種子化 PRNG | 沒有決定論，任何比對都做不下去。單一注入點，公式檔案一行不改 |
| `Date` / `performance` → 虛擬時鐘 | **關鍵**：`js/item.js:263` 的寶石商店與 `js/forge.js:486` 的熔煉完成都讀真實時鐘。縮時上千倍時真實時鐘幾乎沒走，這兩個系統會整場靜止 |
| `postMessage` / `importScripts` / `setTimeout` | Worker 環境替身 |

### 時間推進的正確性

- 步長固定 `0.1s`，與線上 `TICK_MS` 相同。**放大 dt 換速度＝換一個遊戲**，不做。
- 每 2 步（模擬時間 5Hz）跑一次 `loop()` 的 `updateShownRes` / `maintainGemShop` /
  `checkForgeUnlockNotice`。這三支不在 `simStep` 內，但會刷新寶石商店與解鎖熔爐，
  只呼叫 `simStep` 會讓這兩個系統整場不動。

---

## 隔離：策略層碰不到遊戲狀態

策略跑在一個**沒有 `G`、沒有 `FIELD`、沒有 `require`、沒有 `process`** 的獨立 vm context，
只拿得到 `buildView()` 的深拷貝，只能回傳「指令名 + 參數」。

這是**能力剝奪**，不是執行期偵測。拿不到參照的東西不需要被監控。

`scripts/test_policy_isolation.js` 逐項反證（12 項全部必須失敗），並附對照組確認策略仍能正常決策。
`Math.random` 與 `Date.now` 在策略 context 內被改成呼叫即拋錯——策略有隨機性或讀真實時間，決定論就沒了。

### 為什麼不用 Proxy 包住 G

1. 包不住。戰鬥狀態在 `js/combat.js:5` 的 module-level `FIELD`，不在 `G` 裡。
2. 成本壓在每次屬性存取上，而要防的事只發生在決策的那一瞬間。
3. **會改變遊戲行為。** `js/battlefield.js:186` 的 `bfLiveList(...).indexOf(locked)` 與
   `js/combat.js:665` 跨 tick 持有的 `_lockTarget` 都依賴物件識別比對，
   每次 `get` 新建 Proxy 會讓比對必定失敗。

第 3 點不是推論，`scripts/proxy_guard_ab.js` 實測過（見下）。

---

## 已驗證的事實

| 檢查 | 結果 |
| :--- | :--- |
| 決定論（同 seed 兩次 → G 雜湊相同） | ✅ |
| 種子敏感度（不同 seed → 雜湊不同） | ✅ |
| `updateShownRes` early-skip 改造前後等價 | ✅ 雜湊相同 |
| 策略層隔離反證 12 項 | ✅ 全部擋住 |
| **真瀏覽器 ↔ headless 交叉驗證** | ✅ **275 個檢查點全部一致** |
| 既有測試 664 支 / `npm run build` | ✅ 全綠 |

### 交叉驗證（最有力的一道）

seed=779，真 `index.html` + 真 Worker + 真 IndexedDB，跑 55 遊戲秒，每 0.2 秒一個檢查點，
`buildView()` 全部 24 個欄位逐欄比對：**275 個共同檢查點完全一致**。

harness 只要在任何地方偷算過一次，這裡就會分岔。

**做法**（Antigravity 要重跑時照這個順序）：

1. `preview_start` 起本機伺服器（`.claude/launch.json` 已有多組 port）
2. 瀏覽器開 `http://127.0.0.1:<port>/index.html?seed=779`
   ⚠️ 用 `127.0.0.1` 而不是 `localhost`——不同 hostname 是不同 origin，
   才不會去讀（或覆寫）既有存檔
3. 在頁面上掛收集器：
   `window.__x={rows:[]}; WorkerBridge.on('tick',m=>m.view&&__x.rows.push(m.view))`
4. 讓它跑 1 分鐘以上，把 `JSON.stringify(__x.rows)` 存成檔案
5. `node scripts/cross_check.js <那個檔案> 779`

**測試模式的差異（必須連同結果一起說明）**

帶 `?seed=N` 且 hostname 為本機時，Worker 會進入決定論測試模式
（`js/worker/sim.worker.js` 檔頭 `installTestSeed`），與正式遊玩有三處差異：

1. `Math.random` 換成種子化 mulberry32
2. 每個計時器週期固定走一整步，不補欠帳、不走殘步
3. 維護區塊（`updateShownRes`/`maintainGemShop`/`checkForgeUnlockNotice`）改以**步數**計時
4. 一律以全新角色開機，不讀存檔、不落地存檔

**第 2、3 點不是可有可無的**。正式路徑每輪最後會走一個不足 0.1 秒的殘步，
長度取決於真實計時器抖動——連同一個瀏覽器跑兩次都不會一樣，比對在結構上就做不到。
維護區塊照真實時間跑也有同樣問題：`maintainGemShop` 首次會呼叫 `rollGemShop()` 消耗亂數，
它落在第 2 步還是第 3 步會讓整條亂數序列岔開。

所以這道驗證證明的是「headless ≡ 測試模式的瀏覽器」，兩者與正式遊玩的差距就是上面那幾項。

### Proxy 守門 A/B（20 遊戲分鐘，seed=4242）

| 變體 | G 雜湊 | 結果 |
| :--- | :--- | :--- |
| 不裝守門 | `e265152d…` | Lv.7 stage 2 gold 98,695 |
| naive（每次 get 新建 Proxy） | `71e4e49d…` | Lv.6 stage 2 gold 91,448 ❌ **改變了遊戲** |
| cached（WeakMap 快取） | `e265152d…` | 與基準相同 ✅ |

naive 版本 20 分鐘內就少了 7% 金幣、少一級。**用它跑出來的數據無效。**
效能上 naive 只慢 1.2 倍且未見累積衰減——「數百層 Proxy 疊加導致指數級衰減」未獲實測支持。

---

## 效能

實測（Windows / Node，`--max-semi-space-size=64`）：

| 項目 | 數值 |
| :--- | :--- |
| 吞吐 | 約 10,000～12,000 步/秒 |
| 縮時倍率 | 約 1,000～1,200x |
| 10 遊戲小時 | 34.5 s |
| **100 遊戲小時** | **約 5.7 分鐘** |

倍率是**量測值**，每次 `run_sim.js` 都會把實測寫進 `run_summary.json`，不是設定值。

已做的優化（全部經雜湊驗證等價）：

1. `js/worker/sim.worker.js` 的 `updateShownRes` 加上 early-skip——旗標設了就不再重算。
   改造前它（含 `totalGemsAll`）佔 headless 總 CPU 的 **39%**，只為決定頂欄圖示要不要顯示。
   瀏覽器端每秒也跑 5 次，玩家機器同樣受益。
2. `Math` 用自有屬性複本而非 `Object.create(Math)`，避免每次 `Math.floor` 走原型鏈。
3. GC 調參。

再往下要更快，只能優化遊戲引擎本身的熱路徑（`talentState` / `forgeState` / `skillDef`
等每擊重複查找，以及 `battlefield` 的每擊陣列配置）。profile 已經平坦，
最大單項 `fieldTick` 只佔 9%，沒有便宜的大獎了。

---

## 遊戲改版時要不要同步給模擬器？

**預設：不用。** 數值、公式、常數、機率、掉落表、失敗訊息全部是從遊戲讀的，
改了模擬器隔天自動跟上。連寶石種類都是 `{"path": "panels.gems.gems"}` 取出來的，
新增第 39 種寶石不需要改任何清單。

但有三件事改了會讓模擬**靜靜失真**——不是壞掉，是安靜地測不到。
所以不靠「記得同步」，改成三個會自己叫的哨兵：

| 會失真的情況 | 哨兵 | 在哪裡看 |
| :--- | :--- | :--- |
| `loop()` 新增第四支維護函式，headless 沒跟上 | `tests/sim-harness-sync.test.cjs` | `npm test` 直接紅燈 |
| 面板欄位改名，策略的 `$path` 指到舊路徑 | 路徑解析失敗計數 | `run_summary.json` 的 `badStatePaths`，跑完也會印在終端 |
| 新增玩家指令，策略沒有對應規則 | 指令覆蓋率 | `run_summary.json` 的 `untestedCommands` |

第三項不一定是問題（有些指令本來就不該由 AI 用），但它是「策略還沒覆蓋什麼」的客觀清單——
遊戲新增系統時，新指令會自動出現在那裡，等於待辦清單自己長出來。

前兩項都做過反證測試，確認**真的會叫**：
故意從 `MAINTENANCE_FNS` 拿掉一支 → 測試紅燈並指出差異；
故意把 `panels.tower.tower.highest` 打成 `highestFloor` → `badStatePaths` 抓到。

---

## 指令成效怎麼讀

`run_summary.json` 的 `commands` 分成四類，**不要只看「送出」**：

| 欄位 | 意思 |
| :--- | :--- |
| `effective` | 真的做到了 |
| `noEffect` | 沒做到，`reasons` 是**遊戲自己給的原話**（如「技能點不足」「金幣不足（需要 5.02K）」） |
| `unknown` | 指令無回傳值（如 `js/tower.js:95` 的 `startTowerAuto`），要看原生日誌才知道結果 |
| `error` | 協議層就被擋下（指令名或參數不合法） |

⚠️ 模擬層的回傳慣例與直覺相反：**`null` 是成功、字串是失敗原因**
（`js/skills.js:2129` 成功時 `return null`，失敗時 `return '技能點不足'`）。
天真地判斷 truthy 會把 1200 次失敗全部算成成功——這個坑踩過一次。

---

## 真人基準線：錄一場真人的，拿去跟 AI 的相減

### 為什麼需要這個

「AI 跑起來跟真人有落差」在這條管線出現之前是一句沒辦法追下去的話——只有 AI 那條
曲線有數字，真人那條沒有。要調策略、要判斷 `player_strategy.md` 哪一段翻譯失真，
都得先有真人那條線。

### 三個步驟

**1. 錄**　起伺服器（`啟動數值模擬器.bat` 或直接跑 `node tools/sim_server.cjs`，
它本來就有靜態託管），以決定論模式開遊戲，正常玩：

```
http://127.0.0.1:28342/index.html?seed=777&record=1
```

必須走 `http://127.0.0.1`，不能用 `file://`——錄製器與決定論模式都只認本機 hostname。

右下角會出現「● 錄製中」的徽章，顯示已錄到幾道指令、幾筆樣本。玩完按「匯出軌跡」
下載 JSON。可選 `&rowEvery=N` 調整樣本密度（預設每 10 則 tick 一筆）。

錄到的東西有三樣：起始存檔、指令軌跡（含**執行當下**的 `simT`）、實測 view 樣本。

**2. 驗**　證明軌跡是完整的——漏一道指令不會有任何錯誤訊息：

```bash
node scripts/verify_trace.js human_trace_seed777_....json
```

它用同一份存檔、同一個 seed 重播軌跡，再與錄製當下的實測樣本逐檢查點比對。
PASS 同時證明了三件事：軌跡沒漏指令、時間戳精確到步、headless 忠實於瀏覽器。
做這一步建議用 `&rowEvery=1` 錄一段短的（幾分鐘），檢查點最密。

**3. 比**　把真人那一場跑成標準輸出，再與 AI 的相減：

```bash
node scripts/run_sim.js --trace=human_trace_seed777_....json --out=sim_out_human
node scripts/run_sim.js --policy=scripts/sim/policy.moderate.json --seed=777 --hours=3 --out=sim_out_ai
node scripts/compare_runs.js sim_out_human sim_out_ai
```

`--trace` 走的是同一支 `run_sim.js`、同一組快照欄位、同一份 `run_summary.json` 格式，
所以兩邊的輸出天生可以相減。這也是軌跡重播刻意不另寫回放腳本的原因——第二套報表
遲早會跟第一套長歪，而長歪的那一刻沒有人會發現。

### 精確的時間戳是怎麼拿到的

指令是非同步的，主執行緒自己蓋的時間戳一定是糊的，而糊掉的軌跡重播出來會是另一場
（亂數序列錯開一步，之後每一次掉落都不同）。

關鍵在 `js/worker/sim.worker.js` 的 `MSG_IN.CMD` 分支：指令成功後 Worker 會**立刻補送
一則 tick**。Worker 的 `onmessage` 是同步的，ACK 與那則 tick 之間插不進任何東西，
所以「ACK 之後收到的第一則 tick」的 `view.simT` 就是指令執行當下的模擬時鐘，精確到步。

因此錄製器不需要自己算時間——精確的時間本來就在訊息流裡。
（唯一需要協議配合的是 `simT` 這個欄位本身，見 v14；`gt` 在戰鬥暫停時會停住，
當不了對齊軸。）

| 檔案 | 角色 |
| :--- | :--- |
| `js/recorder.js` | 錄製器本體。只在本機 `?record=1` 時做事，正式遊玩是空殼 |
| `js/bridge.js` | 兩個鉤子：`send()`（操作的唯一出口）與 `start()`（起始存檔） |
| `scripts/sim/trace.js` | 把軌跡包成與 `sim/policy.js` 相同的決策來源介面 |
| `scripts/sim/viewdiff.js` | `cross_check` 與 `verify_trace` 共用的比對判定 |

### 已知限制（不要在報告裡略過）

- **協議 v14 之前錄的檔**只能退回以 `gt` 對齊，而 `gt` 在戰鬥暫停時會停住，
  那種錄製只要暫停過就重播不出來（`run_summary.json` 的 `trace.axis` 會是 `gt`，
  `verify_trace.js` 會在比對前先警告）。用目前版本重錄即可，v14 起以 `simT` 對齊，
  暫停已經不是限制——實測：暫停 2 次共 89 個 tick、`gt` 與 `simT` 差 17 秒，
  332 個檢查點仍然完全一致。
- **同一個 tick 內連送的多道指令**會共用同一個刻度（一步 0.1 秒，人手連點兩下必定同步），
  但那一種重播會在同一步依序送出、完整重現，**不是問題**。
- **錄製不會動到你的存檔**（2026-08-01 起）。決定論模式下 `requestPersist` 會擋掉所有
  非自願的落地（`auto` / `folder` / `shutdown`），只有明確按下手動存檔或重新開局才會寫。
  在此之前 `onVisibility` 的 `SHUTDOWN` 沒有被擋，錄製期間切一次分頁就會蓋掉
  `auto_current`——如果你用的是舊版本，錄製前請先備份。
- **軌跡重播每步都問一次決策**（`decideEveryGameSec` = 一步），所以 `engine.view()`
  的呼叫次數是一般策略跑的一百多倍。它會順帶呼叫 `updateShownRes()`，讓重播存檔的
  `shownRes` 旗標比瀏覽器那份早一點被點亮。`shownRes` 不在 `buildView()` 的輸出裡，
  不影響逐點比對，但會影響最終存檔雜湊。
- **真人錄製只有幾小時**，`compare_runs.js` 只比重疊區間，不外插。

---

## 尚未完成

- **成長曲線偏慢**：預設策略 10 小時只到 Lv.16。可能是策略太保守，也可能是數值設計本身，
  需要看過 100 小時的完整曲線才能判斷。這是遊戲設計問題，不是 harness 問題。
- **轉生／天賦在全新角色的 100 小時內碰不到**（門檻 Lv.1000）。要驗證那些系統請用
  `policy.lategame.json`，但它是 GM 墊出來的狀態，只能證明「系統會動」。
- **策略未涵蓋**：寶石鑲嵌與轉換、裝備洗詞條、技能融合、附魔。都能以同樣的規則形式加。
- `scripts/run_real_ai_player.js`（舊版）仍在版控中。它的日誌管線是壞的
  （sandbox 的 `shimPushEvent` 被 `js/worker/shim.js` 的同名函式宣告覆蓋），
  且缺 `factoryTick`/`newForgeTick`、步長放大 10 倍、無虛擬時鐘。應刪除，避免有人再拿它跑。
