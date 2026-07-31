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

無。P0～P5 遷移期的鎖定條件都是「P5 完成」，已全部依其自身條件解除（見第 5 節）。

下方第 5 節與 AGENTS.md 的所有權慣例只用來降低同時修改的機率，
**不是承接任務的門檻**——使用者指派給誰就由誰做完整件事（`AI_RULES.md` 第 3.1 節）。

進行中的大型工程：

~~Web Worker 架構遷移~~ **✅ P0～P5 已完成（2026-07-28）**。

Worker 是模擬與存檔的唯一權威，主執行緒不再持有 `G`，舊單執行緒路徑已移除。
遷移期的計劃書 `docs/WORKER_MIGRATION_PLAN.md` 已刪除——關鍵設計決策與效能基準
已移入 `docs/WORKER_PROTOCOL.md` 第 9、10 節。

長期文件：`docs/WORKER_PROTOCOL.md` + `js/worker/protocol.js`（v9，唯一資料來源）。
**動到 Worker、bridge、面板投影或指令之前必須先讀。**

驗收記錄：`docs/P3_FULL_REGRESSION_REPORT.md`、`docs/P4_BACKPACK_VIRTUAL_SCROLL_REPORT.md`、
`docs/P4_WORKER_AUTO_RESTART_REPORT.md`、`docs/P5_FINAL_ACCEPTANCE_REPORT.md`。

目前階段：

Web Worker 遷移全部完成，無進行中的大型工程。

P5 之後的檔案所有權慣例（沿用即可，非硬性）：
- `js/worker/*`、`js/bridge.js`、`js/storage.js`、`js/main.js`、`js/worker/protocol.js`：Claude
- `js/ui.js`：Codex
- 協議變更一律由 Claude 改 `protocol.js` 並同步 `docs/WORKER_PROTOCOL.md`、遞增版本號

`npm test` 現況 **642 項／642 通過／0 失敗**（2026-07-30）。
先前記錄的 35 條既有失敗（`docs/TEST_FAILURE_TRIAGE.md`）已全部清掉。

驗收標準仍是「不得新增失敗」，並以結尾的 `ℹ fail N` 為準——
⚠️ 不要用 `grep -c '^✖'`，node test runner 會在結尾的失敗摘要區把每筆再列一次，
得到的是兩倍數字。

---

# 2. Claude Code 任務

## 2.-6 apply_params 場景倍率錨點修正（2026-07-31）

狀態：已完成，等待使用者合併

任務內容：修正 `tools/apply_params.cjs` 對神界場景倍率的跨行錨點搜尋，避免同名 key 同時出現在 `CHAOS_FIELD_DROP_ZONES` 與 `ZONES` 時被誤判為 2 次匹配；補上套用工具回歸測試。

允許修改：`docs/AI_TASKS.md`、`tools/apply_params.cjs`、`tests/apply-params.test.cjs`。

禁止修改：其餘檔案。

驗收方式：`node tools/apply_params.cjs` 顯示 554 一致、0 變更、0 錨點問題；`npm test` 672/672、`npm run build` 192 檔全數通過。

後續接手者：Codex 完成後由使用者合併至整合分支。

---

## 2.-5 草原前 100 關敵人數量調整（2026-07-31）

狀態：已完成，等待使用者合併

任務內容：依 `config/Excel/game_parameters.xlsx` 新增的五列參數，讓草原第 1～100 關每 20 關套用一組小怪出怪數量權重；草原第 100 關之後恢復一般小怪數量。草原前 100 關菁英固定出現 1 隻；BOSS 規則維持原狀。

允許修改：`docs/AI_TASKS.md`、`config/CSV/game_parameters.csv`、`js/data.js`、`js/formula.js`、`js/combat.js`、`tools/apply_params.cjs`、`tests/multi-enemy.test.cjs`。

禁止修改：其餘檔案（`config/Excel/game_parameters.xlsx` 保留使用者既有修改）。

前置依賴：參數表五列已由使用者合併至最新版本。

驗收方式：新增分段權重與階段／場景選擇測試；`npm test` 671/671、`npm run build` 191 檔全數通過；`node tools/apply_params.cjs` 顯示本次新增參數 0 變更，僅保留既有 15 個場景錨點問題。

後續接手者：Codex 完成後由使用者合併至整合分支。

---

## 2.-4 技能融合系統改造（2026-07-30）

狀態：已完成，等待驗證（細節見 PATCH.md「技能融合系統改造（2026-07-30）」）

任務分類：技能系統／融合演算法全面改造（使用者指派給 Claude 整件完成，含慣例上屬於 Codex 的
`js/ui.js`／`index.html` 介面調整）。需求來源：`神力之巔_記事錄.xlsx` 第二頁「技能融合」。

需求（Excel 方案十點）：
1. 一個技能只能投入一個融合技（佔用制）；被融合技能不可裝備、圖標標示；刪除融合技才釋放。
2. 移除 4／8 級里程碑解鎖，效果從 Lv.1 全附加。
3. 所有技能（含融合技、被動技、潛力技）等級上限 10；轉生後上限 +5（=15）。
4. 融合技剛產生為未學習（Lv.0），升至 Lv.1 才算學會、才可裝備。
5. 技能點改由「技能熟練度」提供：打怪／道具給技能經驗，滿級升 1 級給 1 點，0~1000 級，
   經驗需求走參數表（先沿用玩家經驗公式 30×L³+40）。
6. 融合花費金幣＋新道具「魔法卷軸」；卷軸取得比照附魔精華（拆解＋高塔）、數量為其 1/10。
7. 融合演算法改造：物理/魔法/雙屬性 45/45/10（依素材數量權重調整）；攻擊力＝素材滿級平均
   切 75/100/125/150 四檔（20/30/30/20）；同屬性每多 1 個素材該屬性傷害 +25%（折入權重與總值）；
   buff/debuff 數量常態分佈取 1~N、數值由「一半~上限」均分 4 檔隨機；屬性組合 C(n,k) 多重集
   全枚舉（物理算一種屬性、佔 2 份）；特效正常取一個素材的特效包、5% 機率融合兩個（最多 2）；
   素材數值一律以素材「最高等級」計算（未學習但已解鎖即可融合）。
8. 融合結果只存種子（seed），由素材現行定義＋種子確定性重算；原生技能改數值後直接重算生效。
9. 潛力技能不能融合（維持既有結構性排除＋UI 防呆）。
10. 融合技等級成長設計：所有隨機結果值為滿級（10 級）值，Lv.1 為其 60% 線性成長至滿級 100%。

修改範圍：`js/skills.js`（融合演算法／佔用／熟練度／castSkill both 與 buffList）、`js/formula.js`
（上限／熟練度經驗／融合參數）、`js/data.js`（轉生對照表）、`js/player.js`（newGameState／gainXp）、
`js/save.js`（遷移／離線熟練度）、`js/combat.js`、`js/tower.js`、`js/factory.js`（熟練度經驗與卷軸）、
`js/worker/protocol.js`＋`js/worker/sim.worker.js`（協議 v13：magicScroll／mastery 投影）、
`js/ui.js`＋`index.html`＋`css/style.css`（佔用標示／熟練度條／卷軸資源／融合面板）、
`js/gm_exec.js`（scroll／skillxp／masterylv）、`js/stats.js`、`config/CSV+Excel`（game_parameters）、
`tools/apply_params.cjs`（新錨點）、`game_formula.md`、`LV_upgrade_system.md`、`GM_command.md`、
`PATCH.md`、`ONE_TIME_MIGRATIONS.md`、`docs/WORKER_PROTOCOL.md`、新測試 `tests/skill-fusion-rework.test.cjs`。

前置依賴：`git pull` 已最新（451c083）；`check-conflicts.ps1` 通過（antigravity 僅動模擬腳本，
與目標檔案零重疊；codex／develop 乾淨）。

存檔遷移（冪等、欄位存在性判斷）：舊 `skillPointBudget` → `skillMastery.level`（扣除基礎 2 點、
保底已花費、夾 0~1000）並刪除舊欄位；全技能等級夾回新上限（等級推導制自動退點）；舊融合記錄補
`seed`＋`algo:2` 以新演算法重算（凍結欄位 componentLevels/mutation/maxLv 保留但不再參與重算）；
裝載欄清出被佔用素材。

測試要求／結果：新增 `tests/skill-fusion-rework.test.cjs`（20 項：種子確定性／物魔權重／四檔攻擊力
／屬性組合枚舉 23 例／同屬性折算／buff 取數與 4 檔／效果融合／佔用閘門／未學習融合技／上限 10+5
／熟練度／卷軸換算／遷移兩案）；既有 7 檔測試依新規則修正（里程碑全附加／buff 清單化／協議 v13
／點數制）；`npm test` 664／664、`npm run build` 178 檔零錯誤；參數表 round-trip（apply_params
將變更 0；15 個場景錨點重複為既有問題，已另立背景任務）。

待 Antigravity 驗證重點：見交付回報「建議驗證項目」（實機融合流程／佔用標示／熟練度條／卷軸
掉落與花費／舊檔遷移／both 傷害／效果融合 5%）。

## 2.-3 屬性及技能效果五項改造（2026-07-30）

狀態：已完成，等待驗證

任務分類：戰鬥核心／屬性派生改造（使用者指派給 Claude，含慣例上屬於 Codex 的 `js/ui.js` 一行圖示對照）。

需求（使用者原文五點）：取消生命回復／吸血的溢出轉護盾（技能效果除外）、吸血／吸魔改由生命回復／
法力恢復決定且不擋上限、韌性上限 80% 並兼含控場時間與被爆擊機率、敵人對玩家爆擊（8／6／4%、
爆傷 300%，需參數化）、技能降防改為穿透且穿透不擋上限並改用 `a×(穿透%×b)^c` 曲線（超過 100% 轉增傷）。

修改範圍：`js/formula.js`（核心公式）、`js/data.js`（`STAT_CAPS` 與面板 tips）、`js/combat.js`、
`js/skills.js`、`js/legendary.js`、`js/potential.js`、`js/ui.js`（buff 圖示）、
`config/CSV+Excel` 的 `game_parameters` 與 `Skills`、`tools/apply_params.cjs`、`tools/config_tables.cjs`、
`game_formula.md`、`PATCH.md`。細節見 PATCH.md「屬性及技能效果五項改造（2026-07-30）」。

前置依賴：已先 fast-forward 合併 `develop`（含 `ai/codex` 的混沌裝備兩筆），在合併後基礎上施工。
衝突預檢：`js/*` 與 codex 變更區塊不重疊；參數表以合併後的 CSV 重生 xlsx，順帶把 codex 只改 CSV
未同步 xlsx 的 9 列補回 xlsx（原本下次套用參數會被吃掉）。

測試要求／結果：新增 `tests/attr-skill-rework-2026-07-30.test.cjs`（20 項）；`npm test` 642／642、
`npm run build` 177 檔零錯誤；參數表 round-trip（`config_tables --apply` 語意變更 0、
`apply_params` 將變更 0）。

待 Antigravity 驗證重點：見 PATCH.md 條目與交付回報的「建議驗證項目」（穿透曲線實機值、
敵人爆擊頻率與韌性折減、吸血回復量、破甲擊改穿透後的 DPS 與施放頻率、護盾不再由吸血成長）。

## 2.-2 技能提示退化成風味文字（回報：技能的正確 tips 消失）

狀態：已完成，等待驗證

本次由 Claude 直接修改 `js/ui.js`。**使用者指派給誰就由誰改，優先於檔案歸屬慣例**——
第 1 節的所有權清單是基本原則，不是分工的門檻；為了遵守它把一個小功能拆成多個協作者，
成本高於收益。

現象：技能卡與技能面板都只顯示一行風味文字（例：強力斬顯示「蓄力揮出沉重的一擊。」），
傷害數值、成長與附加效果全部消失；「下一級」顯示的字串與本級完全相同。

根因：`ui.js` 的 `skillViewDescription` 回傳 `def.flavor || def.desc`，並註明
「不要呼叫 describeSkill，該模擬層查詢會再回讀主執行緒 `G.player.fusions`」。
那個顧慮只對**融合技**成立——`skillDef(id)` 僅在靜態 `SKILLS` 表查不到時才讀 G
（`js/skills.js:1573`），而主執行緒的 `G` 是 `null`，所以當時確實會拋 TypeError。
結果是為了一種技能，讓**所有技能**的說明都退化。與 `itemDetailHTML` 是同一類問題。

已完成（Claude，模擬層）：

- `skillDef(id, fusions)`：融合技記錄可由呼叫端傳入，省略才回頭讀 G（保留後備，
  模擬層既有呼叫點與既有測試不受影響）
- `describeSkill(id, lv, skipFusionDetail, fusions)`：透傳
- `tests/skill-description-pure.test.cjs`（新增 4 項，含一條標 todo 的 ui.js 接線檢查）

實機驗證（localhost:8330）：主執行緒呼叫 `describeSkill('powerSlash', 1)` 回傳
「造成 360% 物攻 的物理傷害。⭐ Lv.4 解鎖／強化附加效果」，Lv.2 為 440%，未拋錯；
`panelData('skills')` 確認含 `fusions` 欄位。

已完成（`js/ui.js`）：`skillViewDescription` 改呼叫
`describeSkill(id, level, skipFusionDetail, fusions)`，兩個呼叫端（技能面板與 tooltip）
都傳入 `skillsSnapshot.fusions`；融合技的「（融合自：…）」附註改為疊加在完整說明之後。
`describeSkill` 回傳的是 HTML，呼叫端不得再 `esc`。

`tests/ui-worker-g-dependency.test.cjs` 的已審核名單新增 `describeSkill`，
並註明它唯一的 G 路徑已由 `fusions` 參數與 `typeof G` 守衛處理。
那支測試是審核閘門，新增交集必須附證據，不得只改數字。

實測（localhost:8330，技能面板與樹狀 tooltip 皆檢查渲染後的 DOM）：

| 位置 | 修復前 | 修復後 |
|---|---|---|
| 說明 | 蓄力揮出沉重的一擊。 | 造成 360% 物攻 的物理傷害。⭐ Lv.4 解鎖／強化附加效果 |
| 下一級 | 蓄力揮出沉重的一擊。 | 造成 440% 物攻 的物理傷害。⭐ Lv.4 解鎖／強化附加效果 |
| 風味（斜體） | 蓄力揮出沉重的一擊。 | 不變（本來就該在這行） |

Console 無錯誤。`npm test` 509 項全通過。

建議 Antigravity 驗證：融合技的說明與「（融合自：…）」附註、潛力技能說明、
高等級技能的附加效果段落、以及各技能的「下一級」是否確實顯示差異。

---

## 2.-1 背景掛機、404 噪音、itemDetailHTML 純函式化

狀態：等待測試

### 背景分頁改為在線掛機（`118764e`，協議 v9）

遊戲規則（使用者定案）：**分頁在背景＝仍在線上掛機，只有整個遊戲被關掉才算離線。**

移除 `BG_SUSPEND_AFTER_MS` 與 `backgroundSuspended()`；`onVisibility` 只剩「切走時落地
一次」，切回前景不再重設 `_lastTickAt`；`applyOfflineProgress` 只在 `boot` 執行。
降頻補償改為「欠帳 `_catchupDebt` + 每次 loop 花 30ms CPU 分次補完」，上限取
`OFFLINE_MAX_HOURS`。協議移除 `visibility.pip`（休眠沒了就沒有接收端）。

移除舊機制的理由（三項，見 `docs/WORKER_PROTOCOL.md` 第 8 節 v9 列）：離線收益是另一套
固定費率模型；休眠門檻與離線結算門檻的基準不同，背景 60～120 秒收益是 0；與掛機遊戲直覺相反。

量測：模擬 1 小時遊戲時間＝新手 1.5 秒、後期存檔（Lv.260／背包 800）2.4 秒 CPU。
實測（localhost:8330）：隱藏 5.9 分鐘，遊戲時間推進率 100.0%、tick 4.08/秒、0 錯誤。

✅ 使用者已在真實瀏覽器驗證（2026-07-28）：背景掛機 15 分鐘正常，離線流程亦正常。
先前擔心的「內嵌瀏覽器未必觸發 Chrome intensive throttling」已排除。

附帶佐證：查洗煉問題時在同一個長時間隱藏的分頁量到，主執行緒的 `uiTick` 被降頻到
約每分鐘一次（`renderBattle` 3.5 秒內 0 次），但同一時間 Worker 的遊戲時間仍是 100%。
**降頻確實存在，欠帳補償確實把時間補回來了**——這正是這套設計要處理的情況。

### 參數自動重載退避（`e1e3bd9`）

`params_version.txt` 被 `.gitignore` 排除，只有跑過「套用參數.bat」的副本才有
（codex／antigravity／production 三個副本目前都沒有），固定 2 秒輪詢會讓 console
每 2 秒被記一筆 404。改為讀不到時退避成 30 秒探測並提示一次，檔案出現後自動恢復。

### `itemDetailHTML` 純函式化（`ba11ca9`）

該函式是裝備詳情的完整實作卻**零呼叫者**——因為它讀 `G`，主執行緒用不了；`ui.js` 因此
另寫了簡化版 `uiItemDetailHTML`，兩套分歧後產生數值顯示錯誤（掉寶率未換算，20% 的詞條
顯示 20%、實際生效 10%）。改為餘額由 `opts.gold`／`opts.essence` 傳入，並移除渲染路徑裡的
`ensureSockets` 副作用。

後續交給 Codex：把 `ui.js` 的 4 處呼叫改回 `itemDetailHTML` 並刪除 `uiItemDetailHTML`
（`tests/item-detail-html.test.cjs` 有一條 todo 標記此事）。提示詞已備妥，**待使用者指示才發出**。

---

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

## 3.5 Codex：敵方傷害飄字可讀性修正

狀態：

等待 Review（第二版實作與驗收完成）

任務名稱：

恢復單一敵人的標準傷害字號，並提高多敵場景的最小可讀字號

任務內容：

- 單一敵人時，普通傷害使用 18px、爆擊／技能使用 22px
- 多敵場景仍可縮小飄字，但普通傷害不得低於 14px、爆擊／技能不得低於 18px
- 更新既有飄字 CSS 回歸測試，鎖定單敵與多敵的字號

允許修改：

- `css/style.css`
- `tests/player-event-float.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：

- `js/worker/*`
- 戰鬥公式與傷害數值
- 任務範圍外檔案

測試要求：

- `tests/player-event-float.test.cjs` 通過
- `npm test` 不得新增失敗
- 實機確認單敵與多敵傷害飄字均可辨識

驗收結果：

- 定向測試 15/15 通過；`npm.cmd test` 487/487 通過
- 實機實際戰鬥 computed style：單敵普通傷害 18px、多敵普通傷害 14px
- 單敵爆擊／技能設定為 22px，多敵爆擊／技能設定為 18px
- Browser Console：0 error、0 warning
- 未修改傷害公式、戰鬥數值與 `js/worker/*`

完成後交給：

Claude Review

## 3.6 Codex：恢復敵人死亡淡出與完整傷害飄字

狀態：

等待 Review（實作與驗收完成）

任務名稱：

修正死亡敵人在 UI 被立即過濾，並讓擊殺傷害飄字完整播放

任務內容：

- 戰鬥畫面保留 Worker Snapshot 中仍處於死亡清除倒數的敵人
- 死亡敵人的視覺內容漸隱，但傷害飄字圖層維持可見
- 死亡保留時間不得短於傷害飄字動畫時間，避免最後一段淡出被 DOM 重建切掉
- 補回歸測試鎖定上述行為

允許修改：

- `js/ui.js`
- `js/data.js`（僅調整野外敵人死亡清除時間）
- `css/style.css`（僅新增敵人死亡淡出動畫）
- `tests/multi-enemy.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：

- `js/worker/*`
- 傷害公式、掉落公式、存檔格式
- 任務範圍外檔案
- `develop` 分支

前置依賴：

無

測試要求：

- 定向測試與 `npm test` 不得新增失敗
- 實機確認敵人死亡後漸隱、擊殺傷害飄字完整播放
- Browser Console 0 error／0 warning

驗收結果：

- 定向測試 18/18 通過；`npm.cmd test` 487/487 通過
- `npm.cmd run build`：152 個檔案語法／編譯檢查全數通過
- 實機死亡淡出透明度：死亡瞬間 0.95，0.5／1.0／1.5／1.9 秒後分別為
  0.71／0.47／0.23／0.10，約 2.15 秒後移除敵人卡片
- 擊殺傷害飄字未跟隨敵人本體淡出，完整播放至自身 opacity 0 後移除
- Browser Console：0 error／0 warning

完成後交給：

Claude Review

## 3.7 Codex：多 Worktree 分支整合腳本

狀態：

等待 Review（實作與驗證完成）

任務名稱：

自動推送三個 AI 分支、整合至 develop，再將 develop 同步回三個 AI 分支

任務內容：

- 自動探索 `ai/antigravity`、`ai/claude`、`ai/codex`、`develop` 所在 Worktree
- 提供專案根目錄 `sync_ai_worktrees.bat`，可直接雙擊執行完整流程
- BAT 與 PowerShell 腳本的步驟、結果及錯誤提示使用繁體中文
- 執行前確認所有 Worktree 分支正確且工作區乾淨
- 提供 `-ValidateOnly` 唯讀預檢模式
- 先 fast-forward 同步並推送三個 AI 分支
- 在 develop Worktree 依序合併三個遠端 AI 分支並推送 develop
- 將遠端 develop fast-forward 回三個 AI 分支並推送
- 任一步驟失敗立即停止，不自動 reset、abort 或覆蓋衝突

允許修改：

- `sync_ai_worktrees.bat`
- `tools/sync_ai_worktrees.ps1`
- `docs/AI_TASKS.md`

禁止修改：

- 遊戲程式、資料、公式與測試
- `develop` 分支

前置依賴：

無

測試要求：

- PowerShell Parser 語法檢查通過
- BAT 可正確找到並啟動 PowerShell 腳本，結束後保留執行結果
- Windows PowerShell 5.1 與 BAT 顯示繁體中文時不得出現亂碼
- 唯讀驗證目前 Worktree 探索結果包含四個目標分支
- 不對實際專案執行 push 或 merge
- 使用本機臨時 bare remote 完整演練 push、merge 與三分支回灌

驗收結果：

- PowerShell Parser 語法檢查通過
- BAT 以 `-ValidateOnly` 實測可正確啟動 PowerShell 腳本並回傳其結束碼
- BAT 與 PowerShell 腳本的繁體中文訊息實測顯示正常
- 實際專案 `-ValidateOnly` 找到四個目標 Worktree，並因 Claude Worktree
  的 `.claude/launch.json` 未提交而依預期安全停止
- 本機臨時 remote 完整流程通過，`develop` 與三個 AI 遠端分支最終收斂至同一 commit
- 未對實際專案執行 pull、push 或 merge

完成後交給：

使用者執行；發生衝突時交由整合者人工處理

## 3.8 Codex：裝備詳情統一使用 itemDetailHTML

狀態：

等待 Review（實作與主要驗收完成）

任務名稱：

刪除 `uiItemDetailHTML` 重複實作，三個裝備詳情呼叫點統一使用 `itemDetailHTML`

前置依賴：

- `ba11ca9 refactor: itemDetailHTML 改為純函式，供主執行緒直接呼叫`
- 開工前 `git pull --ff-only` 已完成，並以 `git merge-base --is-ancestor ba11ca9 HEAD`
  確認依賴存在

完成內容：

- `renderDetail()` 改呼叫 `itemDetailHTML(it, null, opts)`
- 裝備格 tooltip 的目前裝備與比較裝備兩張卡片改呼叫 `itemDetailHTML`
- 三個呼叫點皆由 header Snapshot 傳入 `gold`、`essence`
- 保留 `showAffixReroll`、`isEquipped` 原有語意
- 刪除 `uiItemDetailHTML` 簡化重寫
- 將原本的 todo 接線測試改成正式回歸測試，鎖定三個呼叫點、`cmp = null`
  及資源欄位

修改檔案：

- `js/ui.js`
- `tests/item-detail-html.test.cjs`
- `docs/AI_TASKS.md`

禁止修改且未修改：

- `js/item.js`、`js/formula.js`、`js/data.js`
- `js/worker/*`、`js/bridge.js`、`js/main.js`
- `index.html`、`develop` 分支

測試結果：

- `node --test tests/item-detail-html.test.cjs`：7/7 通過，todo 0
- `npm.cmd test`：504/504 通過，結尾 `ℹ fail 0`
- `npm.cmd run build`：154 個檔案全數通過
- `git diff --check`：通過

實機驗收：

- 使用 `codex` 工作副本的獨立 preview server 與
  `docs/fixtures/save_lategame.json`，未使用 develop 的 5500 服務
- 詳情實際顯示詞條池按鈕、分類色、評分、洗煉區間資料、空附魔欄及寶石數值
- 詞條池浮層：`display:block`、父層為 `BODY`、不在 `#detail-pane` 內且完整位於 viewport
- 掉寶率實例：原值 `176.5`、強化 `0`、預期／顯示 `88.25`，
  `displayedExpected:true`、`displayedRaw:false`
- fixture 不含同 key 重複詞條；以 fixture 裝備複本建立 `10 + 5` 測例，
  實際輸出一行且顯示 `15`
- 太古滿值實例：金色 `#fbbf24`、粗體及太古專屬洗煉文案皆存在
- 金幣歸零後，洗煉花費 tooltip 的金幣 span 實際帶 `#fca5a5`
- 透過正式 UI 鑲入四級紅寶石、附上火焰抗性附魔後，六項檢查全為 `true`
- 實際點擊詳情內寶石與附魔後均成功取下，面板恢復空插槽／空附魔欄
- Console：0 error、0 warning
- `WorkerBridge.status()`：`errors:0`、`persistErrors:0`、`pendingCommands:0`

已知驗收素材限制：

- fixture 原始第一件裝備是空插槽、空附魔欄，因此未先鑲嵌／附魔時，
  原提示詞六項指令的 `socketRm`、`enchantRm` 必然為 `false`
- fixture 800 件裝備中沒有同 key 重複詞條，故該項使用同一 fixture 裝備複本
  建立確定性測例
- in-app browser 的指標移動未觸發 `mouseover`；已在實際 DOM 驗證詞條與 🎲
  的 `data-tip` 內容、太古專屬文案及不足資源紅色樣式，人工滑過浮層仍建議 Review 時補看

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

## 4.1 數值模擬器收斂與儀表板改造（2026-07-30）

狀態：已完成，所有驗收全綠

任務名稱：數值模擬器收斂與儀表板改造

任務內容：
1. **模擬器收斂**：將舊的 `run_real_ai_player.js`、`cross_validate.js`、`test_guard_counterproof.js` 及相關舊文件清理，以 `run_sim.js` 與 `scripts/sim/` 為唯一收斂基準。將人類可讀動作日誌、日誌節流策略、不變量斷言與執行期 Error Dump 機制移植至 `run_sim.js`。
2. **試跑驗證**：完成 100 小時預設策略試跑與 2 小時後期策略試跑，並與真瀏覽器環境 (seed=779) 完成 108 個共同檢查點 100% 一致之交叉驗證。
3. **儀表板改造**：刪除 `monte_carlo_app.html` 中的所有自製隨機模型與自算引擎；建立「檔案載入中心」，支援一鍵 Fetch 與拖放/上傳 csv, json 落地數據；實作 GM 前置指令明細醒目標示；透過 `save_final.json` 原生存檔資料驅動紙娃娃與原生 `computeStats()` 屬性面板渲染。

---

## 4.2 歷史任務：修復背包排序按鈕失效與懸停閃爍問題

任務內容：

1. 修正 `js/worker/sim.worker.js` 中的 `player.setInvSort` 指令處理函式，補上 `G.inventory` 在 Worker 端的實體陣列排序（支援等級/太古/品質排序）。
2. 修正 `js/ui.js` 中的 `renderInventory`，在 DOM HTML 生成階段直接帶入 `.selected` 與 `.dimmed` 置灰 Class，解決鼠標掃過 Icon 索取詳情時，全 DOM 重建導至的全亮再置灰閃爍瑕疵。

驗證：

- 定向單元測試 `tests/inventory-ancient-filter-sort.test.cjs` 2/2 通過。
- `cmd /c npm test` 全量測試 503/504 通過（0 新增失敗）。

---

## 4.0 歷史任務：大重構後內測全流程驗收

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

鎖定的用途是避免**兩個進行中的任務同時改同一支檔案**，不是宣告長期所有權。
使用者指派給誰就由誰做完整件事，鎖定不構成承接任務的門檻
（`AI_RULES.md` 第 3.1 節）。

只有在「另一個 AI 正在進行的任務會動到同一支檔案」時才登記鎖定，
任務結束即解除。長期的檔案負責慣例寫在第 1 節，不在這裡。

目前鎖定檔案：

無。

> 2026-07-28：P0～P5 遷移期登記的五項鎖定（`js/worker/*`、`js/bridge.js`、
> `index.html`、`js/ui.js`、`tests/worker-*.test.cjs`）解除條件均為「P1 合併後」
> 或「P5 完成」，兩者皆已達成，依其自身條件解除。

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

## 任務：依規格表調整裝備詞條、附魔與寶石鑲孔數量

使用者需求：依提供的規格表調整各裝備品質的詞條、附魔與寶石鑲孔數量。

期望結果：現有 9 個品質的詞條數量固定化，並將附魔欄位與寶石鑲孔數量同步為表格值；混沌與神鑄混沌標註為尚未定義的新增品質，不在本任務自行補齊其他未提供的規則。

任務狀態：已完成

任務分類：一般功能／資料表調整

負責 AI：Codex

任務內容：更新 `js/data.js`、`js/formula.js`、`js/item.js`、`config/CSV/game_parameters.csv` 與公式文件，補充數值回歸測試。

技術影響：裝備生成、附魔容量、鑲孔補齊、詳情顯示與相關存檔相容行為會讀取更新後的稀有度資料。

允許修改：`js/data.js`、`js/formula.js`、`js/item.js`、`config/CSV/game_parameters.csv`、`game_formula.md`、`tests/`

禁止修改：未指定的新品質倍率／掉落／分解／神鑄規則，以及其他 AI 進行中的檔案。

前置依賴：無。

測試要求：執行新增的稀有度數量測試、相關裝備／附魔測試與完整 `npm test`、`npm run build`。

完成條件：表格中的既有 9 品質數量正確、詞條不再隨機、測試與建置通過，並回報未納入的新品質規則。

需要 Claude Review：否（本次為單一資料表調整）。

需要 Antigravity 驗證：否。

完成後交給：主整合工作區。

已知風險：完整測試並行執行時，既有 `catchup-write-throttle` 測試偶發／重現最後寫入順序失敗；單獨執行該測試通過，與本次稀有度資料調整無關。

使用者需求：

期望結果：

已知問題：

優先級：

---

以下由 AI 填寫：

任務狀態：

任務分類：

負責 AI：（使用者指派者；未指派時由收到任務的 AI 自行完成）

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
- [已完成] Codex：新增混沌裝備與神鑄混沌。範圍：`js/data.js`、掉落／離線掉落、神鑄、熔爐與 worker、`config/CSV/game_parameters.csv`、`tools/apply_params.cjs`、UI、文件與測試。需求：三個神界場景 551 級起 1% 掉落；6 件混沌以 20% 基礎成功率神鑄，每魔塵 +3%，失敗退 3 件。驗收：`npm.cmd test` 622/622、`npm.cmd run build` 通過；apply_params 仍受既有 15 個場景錨點問題阻擋 `--write`，本次新增無新錨點錯誤。
