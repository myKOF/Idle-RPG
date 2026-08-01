# 一次性遷移與外部存檔特別處理

> **狀態：全部已於 2026-07-28 移除。本文件保留為紀錄與規範，目前沒有生效中的一次性遷移。**
>
> 移除原因：Web Worker 大重構結束、內測通過後會更新至外部並**刪檔重來**，
> 因此不再需要相容任何既有存檔。`js/save.js` 的 12 個帶旗標遷移區塊與
> `js/player.js` 的 7 個完成旗標已一併刪除，相關測試檔亦已移除。
>
> ⚠️ **刪除時刻意保留的東西**（不要一起清掉）：
> - **結構相容處理**：`hadEquipmentSets`（單套裝備轉三套）、`hadZone`、
>   `hadSalvageSlots`、`hadSkillPointBudget` 等補缺欄位的處理。這些不是一次性遷移，
>   是讓舊格式讀得進來的必要轉換。
> - **無旗標的冪等正規化**：融合技 `fx` 快照清理、融合寶石世代制（`leaves` 欄位）、
>   輸送帶上限裁切、已淘汰零件回收。對新存檔本來就是 no-op，留著沒有成本。
> - **裝備數值來源換算**（2026-08-01 裝備數值存檔改造，`normalizeItemValueSources` →
>   `js/formula.js` §6，由 `migrateSave` 的 `fixLoadedItem` 逐件呼叫）：把舊存檔的凍結
>   數值反推成可重算的來源值——詞條 `affixes[].val` → `roll`（強度值）、傳奇特效
>   `passive.val` 直接移除（由 key + 稀有度推導）、神鑄特效 `godPassives[].val` → `roll`、
>   附魔 `enchants[].val` → `gemLv`（附魔當下的寶石等級）。
>   來源欄位已存在就是 no-op，故為冪等正規化而非一次性遷移，不設完成旗標。
>   **⚠️ 有時序要求**：換算用的是「現行參數推出的基準值」，所以這段程式必須在
>   **下一次調整詞條／特效／附魔數值之前上線**。若先調參數再讓玩家載入舊存檔，
>   反推會用新基準值算，結果是把舊數值原封不動保留下來——正好是這次改造要消滅的狀態，
>   而且不會有任何錯誤訊息。細節與飄移實測見 `game_formula.md` §6.4~6.6。
>   相關測試：`tests/affix-roll-storage.test.cjs`（含八個裝備容器的掃描覆蓋）、
>   `tests/effect-value-storage.test.cjs`（傳奇／神鑄特效與附魔）。
>   ⚠️ 尚未改造、仍是凍結數值的同類項目：**融合寶石** `fusedGems[].stats[].val`
>   （數值由整條融合樹的隨機遞迴決定，要回溯需存融合樹或改存「相當於幾顆 5 階寶石」
>   的倍率；`gemAttrDmgBaseV1` 一次性遷移就是為它而存在）、**自動機組零件**
>   `factory.parts[].val`（其實是 `perTier × tier` 的定值，可直接推導，最容易改）。
> - **2026-07-30 技能融合改造的結構相容處理**（`migrateSave`，冪等、無旗標）：
>   技能等級夾回新上限（10／轉生後 15，等級推導制自動退點＋`_skillCapClampNotice`）、
>   舊 `skillPointBudget` → `skillMastery.level`（扣基礎 2 點、保底已花費；欄位移除，
>   `hadSkillMastery`/`hadSkillPointBudget` 於 mergeDefaults 前判斷）、
>   舊融合記錄補 `seed`＋`algo:2`（補上後結果固定，重複讀檔不變）並清可重建的 fx 快照、
>   被融合佔用素材自裝載欄卸下。狀態：已實作（tests/skill-fusion-rework.test.cjs 遷移兩案）。
> - **開機公告的傳輸管線**（`sim.worker.js` 的 BOOTED notices）：目前只剩
>   `_skillPointRepairNotice` 有產生者，但管線保留，日後要加公告不必重接。
>
> 日後若要再加一次性遷移，請依下方原則登錄，並在**狀態欄以程式碼為準**填寫——
> 本表曾把從未實作的 `gemAttrDmgBaseV1` 記成「已實作」長達九天，
> 只憑 PLAN.md 的 `[DONE]` 就填了狀態。

---
## 使用原則

- 一次性遷移只能處理舊存檔資料，不可改變新存檔的正常遊戲流程。
- 每個遷移都必須有唯一標記，例如 `fusionBuffDebuffV2`。
- 遷移完成後必須寫入標記，重複讀檔不得再次修改同一份資料。
- 遷移區塊請在程式中加上 `ONE-TIME MIGRATION` 註解，方便日後搜尋與刪除。
- 刪除遷移程式時，不能連同仍在使用的永久性存檔相容處理一併刪除。

## 目前登錄與規劃中的遷移

### `gemAttrDmgBaseV1`：六屬性傷害寶石數值下修（base 0.5→0.2）融合寶石快照縮放

**狀態：已實作（2026-07-28）。**

> ⚠️ 本項曾被錯記為「已實作（2026-07-19）」，`PLAN.md:428` 也標了 `[DONE]`，
> 但 `js/save.js` 與 `js/player.js` 從未有過對應程式碼——
> `git log -S "gemAttrDmgBaseV1"` 在整個歷史的 `js/` 目錄下命中 0 次。
> 期間 `data.js` 的 `base` 已下修為 0.2，所以那段期間產生的屬性傷害融合寶石
> 快照停在舊值（現行標準的 2.5 倍），而且會透過後續融合一路傳遞。
> 2026-07-28 補上實作，`tests/gem-attr-dmg-base.test.cjs` 六條全過。
>
> **教訓：本表的「狀態」欄要以程式碼為準，不能只憑 PLAN 的 `[DONE]` 填寫。**

**目的**：六大「對屬性敵人傷害」寶石（尖晶石／海藍寶石／天河石／橄欖石／黃水晶／黑碧璽）每級數值由 `base=0.5` 下修為 `base=0.2`（Lv1 0.2%、每級 +0.2% 至 Lv5 1.0%、Lv6 起前一級 ×2）。鑲嵌與庫存的一般寶石以 `gemStatValue(type, level)` 動態計算，改 `base` 即自動套用；但**融合寶石**的 `stats[].val` 是融合當下的固定值快照，需一次性縮放才會套用新值。

**執行時機**：

- 在 `migrateSave(data)` 的三套裝備遷移之後、`normalDmgAffixScale` 系列之前執行。
- 以 `data.gemAttrDmgBaseV1` 作為一次性完成標記（於 `mergeDefaults` 前捕捉 `hadGemAttrDmgBaseV1`，避免 merge 補預設 true 使遷移被跳過）；新帳號由 `newGameState` 預先標記完成。

**處理範圍**：

- 對象＝`GEM_TYPES` 中 `linear && stat 以 dmgVs 開頭` 的六種寶石；縮放係數 = 0.2 ÷ 0.5 = **0.4**（線性曲線下，縮放 base 等價於整體 ×0.4，與階級無關）。
- 掃描：融合寶石庫存 `data.player.fusedGems`，以及所有容器中鑲嵌於插槽的融合寶石 `it.sockets[].fused`——三套裝備、背包、輸送帶、合成暫存、新熔爐佇列與熔爐帶、神鑄槽。每個融合寶石 `stats[]` 中屬於這六種的 `val` 乘 0.4（四捨五入至小數 2 位）。

**保留資料／冪等條件**：只縮放這六種寶石 stat 的 `val`，其他屬性（雙屬性融合寶石的另一個 stat）、等級、融合次數、leaves 完全保留；標記寫入後重複讀檔不再縮放。

**測試方式**：`tests/gem-attr-dmg-base.test.cjs` 驗證 `gemStatValue` 新數值（Lv1~10）、融合寶石快照縮放、雙屬性只縮放對應 stat、鑲嵌插槽內融合寶石一併處理、重複讀檔冪等、新帳號不觸發。

**日後清理**：所有外部存檔皆完成遷移後，移除 `js/save.js` 的 `gemAttrDmgBaseV1` 區塊與 `js/player.js` 旗標，保留本紀錄註明已下線。

### `talentTreesV2RespecV4`：天賦升級消耗再調整（基礎改轉數+9）第四次重置退點

**狀態：已實作（2026-07-19）。**

**目的**：天賦升級消耗基礎由「轉數+2」調整為「轉數+9」（Lv.51 起每級加倍規則不變）。已依前一版成本配點的外部玩家需重新配置，故再次重置天賦並依**前一版成本**（Lv.1～50 每級 轉數+2、Lv.51 起每級 (轉數+2)×2）退還天賦點。

**執行時機**：

- 在 `migrateSave(data)` 的 `talentTreesV2RespecV3` 區塊之後、依新天賦樹補齊等級之前執行。
- 以 `data.talentTreesV2RespecV4` 作為一次性完成標記；新帳號由 `newGameState` 預先標記完成。

**處理範圍**：

- 依 `talentList()` 逐節點以 `min(L,50)×(轉數+2) + max(0,L−50)×(轉數+2)×2` 累計退點後，`levels` 與 `potentialLevels` 全數清空；退點加入 `data.player.reincarnationTalentPoints`。
- 有退點時設定 `data._talentRespecNotice`（戰鬥日誌公告）；「已 1 轉且曾升級任一天賦」時另設 `data._talentRespecConfirm`，由 `main.js` 彈出與前次相同的一次性二次確認窗「天賦系統已重新改造，請重新配置！」。
- 跳版舊檔（V1～V4 旗標皆缺）：前面的遷移先清空天賦，V4 看到空天賦 → 不重複退點、不重複彈窗。

**保留資料／冪等條件**：同前三次；標記寫入後重複讀檔不再退點。

**測試方式**：`tests/talent-respec-migration.test.cjs` 驗證前一版成本退點（含 51 級以上加倍段）、彈窗條件、冪等、跳版舊檔不重複退點、新帳號不觸發。

**日後清理**：與 `talentTreesV2RespecV1`～`V3` 一同下線（四塊 `ONE-TIME MIGRATION` 區塊、`js/player.js` 四個旗標、`js/main.js` 公告與確認窗區塊）。

### `talentTreesV2RespecV3`：天賦升級消耗再調整（基礎改轉數+2）第三次重置退點

**狀態：已實作（2026-07-19）。**

**目的**：天賦升級消耗基礎由「轉數+1」調整為「轉數+2」（Lv.51 起每級加倍規則不變）。已依前一版成本配點的外部玩家需重新配置，故再次重置天賦並依**前一版成本**（Lv.1～50 每級 轉數+1、Lv.51 起每級 (轉數+1)×2）退還天賦點。

**執行時機**：

- 在 `migrateSave(data)` 的 `talentTreesV2RespecV2` 區塊之後、依新天賦樹補齊等級之前執行。
- 以 `data.talentTreesV2RespecV3` 作為一次性完成標記；新帳號由 `newGameState` 預先標記完成。

**處理範圍**：

- 依 `talentList()` 逐節點以 `min(L,50)×(轉數+1) + max(0,L−50)×(轉數+1)×2` 累計退點後，`levels` 與 `potentialLevels` 全數清空；退點加入 `data.player.reincarnationTalentPoints`。
- 有退點時設定 `data._talentRespecNotice`（戰鬥日誌公告）；「已 1 轉且曾升級任一天賦」時另設 `data._talentRespecConfirm`，由 `main.js` 彈出與前次相同的一次性二次確認窗「天賦系統已重新改造，請重新配置！」。
- 跳版舊檔（V1/V2/V3 旗標皆缺）：前面的遷移先清空天賦，V3 看到空天賦 → 不重複退點、不重複彈窗。

**保留資料／冪等條件**：同前兩次；標記寫入後重複讀檔不再退點。

**測試方式**：`tests/talent-respec-migration.test.cjs` 驗證前一版成本退點（含 51 級以上加倍段）、彈窗條件、冪等、跳版舊檔不重複退點、新帳號不觸發。

**日後清理**：與 `talentTreesV2RespecV1`／`V2` 一同下線（三塊 `ONE-TIME MIGRATION` 區塊、`js/player.js` 三個旗標、`js/main.js` 公告與確認窗區塊）。

### `talentTreesV2RespecV2`：天賦升級消耗改制（Lv.51 起加倍）第二次重置退點

**狀態：已實作（2026-07-19）。**

**目的**：天賦升級消耗改制——Lv.1～50 每級 = 轉數+1、Lv.51～100 每級加倍 = (轉數+1)×2。已依前一版成本（每級 轉數+1 固定值）配點的外部玩家需重新配置，故再次重置天賦並依**前一版成本**退還天賦點。

**執行時機**：

- 在 `migrateSave(data)` 的 `talentTreesV2RespecV1` 區塊之後、依新天賦樹補齊等級之前執行。
- 以 `data.talentTreesV2RespecV2` 作為一次性完成標記；新帳號由 `newGameState` 預先標記完成。

**處理範圍**：

- 依 `talentList()` 逐節點以 `等級 × (轉數 + 1)` 累計退點後，`levels` 與 `potentialLevels` 全數清空；退點加入 `data.player.reincarnationTalentPoints`。
- 有退點時設定 `data._talentRespecNotice`（戰鬥日誌公告）；「已 1 轉且曾升級任一天賦」（退點 > 0 且 `reincarnations ≥ 1`）時另設 `data._talentRespecConfirm`，由 `main.js` 彈出與 V1 相同的一次性二次確認窗「天賦系統已重新改造，請重新配置！」。
- 跳版舊檔（V1/V2 旗標皆缺）：V1 先清空天賦並退舊制點數，V2 此時看到空天賦 → 不重複退點、不重複彈窗。

**保留資料／冪等條件**：同 `talentTreesV2RespecV1`；標記寫入後重複讀檔不再退點。

**測試方式**：`tests/talent-respec-migration.test.cjs` 驗證前一版成本退點、彈窗條件、冪等、跳版舊檔不重複退點、新帳號不觸發。

**日後清理**：與 `talentTreesV2RespecV1` 一同下線（兩塊 `ONE-TIME MIGRATION` 區塊、`js/player.js` 兩個旗標、`js/main.js` 公告與確認窗區塊）。

### `talentTreesV2RespecV1`：天賦系統 V2（1～10 轉）改版重置退點

**狀態：已實作（2026-07-19）。**

**目的**：天賦系統依《天賦V2.xlsx》全面改版——天賦樹由 1～5 轉重排並擴充為 1～10 轉、升級成本由「目標等級」改為「該天賦轉數 + 1（固定值/級）」。舊配置的節點 id 與成本結構皆無法對應新制，故將舊存檔的天賦全數重置，並依**舊制成本**退還天賦點。

**執行時機**：

- 在 `migrateSave(data)` 的天賦欄位健檢之後、依新天賦樹補齊等級之前執行。
- 以 `data.talentTreesV2RespecV1` 作為一次性完成標記；新帳號由 `newGameState` 預先標記完成。

**處理範圍**：

- 逐一讀取 `data.player.talents.levels`（含已不存在的舊節點 id），每個節點依舊制成本 `L × (L + 1) / 2` 累計退點後，`levels` 與 `potentialLevels` 全數清空。
- 退還點數加入 `data.player.reincarnationTalentPoints`；有退點時設定 `data._talentRespecNotice`，載入後由 `main.js` 以戰鬥日誌公告一次。
- **一次性改版二次確認窗**：外部玩家「已 1 轉**且**曾升級任一天賦」（退點 > 0 且 `reincarnations ≥ 1`）時另設 `data._talentRespecConfirm`，載入後由 `main.js` 以共用確認窗（`showConfirmDialog`）彈出「天賦系統已重新改造，請重新配置！」，顯示後即刪除旗標；0 轉或未點過天賦的存檔不彈窗。

**保留資料**：轉生次數、既有未花用天賦點、技能點與其他玩家資料完全保留；潛力技能目前鎖定中，等級理論上皆為 0，一併歸零不退技能點。

**冪等條件**：標記寫入後重複讀檔不再退點（`tests/talent-respec-migration.test.cjs` 驗證）。

**測試方式**：`tests/talent-respec-migration.test.cjs` 驗證舊節點退點（Lv.8 → 36 點、Lv.100 → 5050 點）、重複載入不重複退點、無天賦舊存檔僅標記不公告、新帳號不觸發。

**日後清理**：所有外部存檔皆完成遷移後，可移除 `js/save.js` 的 `ONE-TIME MIGRATION: talentTreesV2RespecV1` 區塊、`js/player.js` 的旗標與 `js/main.js` 的 `_talentRespecNotice` 公告與 `_talentRespecConfirm` 確認窗區塊，並保留本紀錄註明已下線。

### `normalDmgAffixScaleV1`：既有普通敵人傷害詞條降為 1/10

**狀態：已實作。**

**目的**：配合「對普通敵人傷害%」新規則（`base=0.3`、`lv=0.035`），將外部玩家既有裝備與各裝備容器中已保存的 `normalDmg` 詞條固定值同步降低為原值的 1/10。

**執行時機**：

- 在 `migrateSave(data)` 完成裝備套遷移後執行。
- 處理三套裝備、背包、舊輸送帶、合成暫存區、新熔爐佇列／在途裝備與神鑄槽位。
- 以 `data.normalDmgAffixScaleV1` 作為一次性完成標記；讀檔第二次不再縮放。

**保留資料**：只修改 `affix.key === 'normalDmg'` 的 `affix.val`，四捨五入至一位小數；菁英／BOSS 詞條、裝備等級、稀有度、強化與其它裝備資料均保留。

**測試方式**：`tests/normal-damage-affix-migration.test.cjs` 驗證多個存放位置、既有數值 `26174.1 → 2617.4`、其它敵種詞條不變，以及重複讀檔不會再次除以 10。

### `fusionBuffDebuffV2`：融合技能增益／減益規則重算

**狀態：規劃中，尚未實作。**

**目的**：配合融合規則改版，讓外部玩家既有的融合技能套用新規則，不必重新消耗素材融合。

**新規則**：

- 增益效果最多保留 2 種。
- 減益效果最多保留 2 種。
- 同一類型效果不重複保留，取實際數值較高者。
- 未涉及的技能等級、技能點、融合名稱、素材記錄與變異效果均保留。

**執行時機**：

- 在 `migrateSave(data)` 讀取存檔時執行。
- 只處理 `data.player.fusions`。
- 以 `data.fusionBuffDebuffV2` 作為一次性完成標記。
- 標記存在後不得再次重算。

**預計涉及位置**：

- `js/save.js`：讀檔時的一次性遷移入口與完成標記。
- `js/skills.js`：融合效果整理、同類型取高及增益／減益上限規則。
- `game_formula.md`：同步記錄正式融合公式，不放置遷移程式細節。

### `specialBuffTrimV1`：移除特殊技能第二增益

**狀態：已實作。**

**目的**：配合特殊技能平衡調整，移除 `timeWarp`、`blinkDodge`、`overload` 的第二個增益效果。

**正式規則**：這三個特殊技能只保留主要增益；新技能定義已在 `js/skills.js` 的 `UNLOCKS` 移除對應 `buff2`。

**既有存檔處理**：

- `migrateSave(data)` 讀檔時只執行一次。
- 依融合技能的 `components` 判斷是否含上述特殊技能。
- 若既有融合快照的 `fx.buff2` 是被移除的效果，刪除該 `buff2`。
- 不重置融合技能等級、技能點、名稱、素材記錄或變異效果。
- 完成標記為 `data.specialBuffTrimV1 = true`。

**資料限制**：舊版融合存檔只保存融合後的效果快照，未保存每個素材的完整效果快照；因此本次遷移只移除能由 `components` 與 `fx.buff2` 明確辨識的效果，不猜測其它增益。

### `fusionFxDynamicV1`：融合技效果改為動態重算、移除 fx 快照

**狀態：已實作。**

**性質（例外說明）**：這是**永久性的冪等正規化**，不是傳統「日後移除」的旗標式一次性遷移，故**不寫入完成旗標**——`fx` 一旦移除即不存在，重複讀檔（含重新匯入舊備份）自然無副作用。列此登錄僅為讓維護者理解為何讀檔會刪 `fx`。

**正式規則**：融合技不再保存效果快照。`G.player.fusions[]` 只保存 `id / name / cost / cd / maxLv / components / componentLevels / mutation / flavor`；`fx` 由 `skillDef()`→`buildFusionRuntimeDef()` 依素材技能**現行定義** + 凍結的 `componentLevels` + 已存 `mutation` 即時重算（純函式 `fusionAggregateFx` 與 `fuseSkills` 共用）。因此調整素材技能定義，既有融合技自動跟著變（素材等級凍結不變）。

**既有存檔處理**：

- 於 `migrateSave(data)` 讀檔時執行，**置於 `skillDmgV2`、`specialBuffTrimV1` 兩個既有融合遷移之後**（讓旗標式一次性遷移仍先作用於舊快照）。
- 對每個 `data.player.fusions` 記錄：若同時具備 `fx`、`components`、`componentLevels` 且 `buildFusionRuntimeDef(fs)` 能成功重建，則 `delete fs.fx`。
- 素材技能已不存在而無法重建者**保留** `fx` 快照作後備（`skillDef` 對這類記錄退回快照）。

**影響**：既有融合技的效果數值會由「凍結快照」改為「以現行 SKILLS 定義重算」。若某素材技能定義自融合後曾變動，重算後數值會隨之改變（此為預期行為）。`skillDmgV2` 的等比加成因此被取代——重算即得調整後數值。

**涉及位置**：`js/skills.js`（`fusionAggregateFx` / `applyFusionMutationByKey` / `buildFusionRuntimeDef` / `resolveFusionRecord` / `skillDef` / `fuseSkills`）、`js/save.js`（讀檔正規化）、`game_formula.md` §9.3。

## 何時可以刪除

符合以下條件後，才可以移除該遷移：

1. 所有仍在使用的外部舊存檔都已至少讀取並儲存過一次。
2. 已確認正式存檔中的 `fusionBuffDebuffV2` 標記均為 `true`。
3. 已備份一份仍含舊資料的存檔，用於必要時回溯測試。
4. 新開局、舊存檔首次讀取、已遷移存檔再次讀取三種情況都驗證完成。

## 清理步驟

1. 搜尋並確認所有一次性代碼：

   ```text
   fusionBuffDebuffV2
   ONE-TIME MIGRATION
   ```

2. 移除 `js/save.js` 中只服務此遷移的判斷、重算呼叫與標記寫入。
3. 移除只為舊存檔重算而存在的輔助函式；保留正常融合時仍會使用的共用函式。
4. 若確認不再需要保存標記，再移除新存檔中的 `fusionBuffDebuffV2` 欄位；若仍需支援匯入舊備份，應暫時保留讀取相容性。
5. 更新 `PLAN.md`、`PATCH.md` 或版本紀錄，記下遷移已完成並清理。
6. 重新搜尋上述關鍵字，確認沒有殘留無用途的特別處理。

## 測試存檔時的注意事項

- 重新開始測試時，若要測試「未遷移的舊存檔」，必須使用備份檔或手動移除遷移標記；不要修改正式玩家存檔。
- 測試一次性遷移時，至少確認：效果數值正確、第二個減益能保留、同類型效果取高、第二次讀檔不再重複變更。
- 不可因為測試方便而刪除整個 `migrateSave`；其中可能還包含技能點、寶石、場景與其它永久存檔相容邏輯。
### `normalDmgAffixScaleV2`：恢復先前被縮小的普通敵人傷害詞條

- `data.normalDmgAffixScaleV1` 存在且 V2 不存在時，將既有 `normalDmg` 詞條值乘回 10；未套用 V1 的存檔不縮放。
- 處理裝備套裝、背包、輸送帶、合成暫存區、新熔爐佇列與神鑄槽，完成後寫入 V2 標記避免重複。

### `normalDmgAffixScaleV3`：修復仍低於恢復後基準的普通敵人傷害詞條

- 針對沒有 V1 標記、或 V2 執行前已留下低值的既有裝備，檢查 `normalDmg` 是否低於目前非太古最低擲值。
- 只有低於該基準的值才乘回 10；已正常的非太古值與太古值不變，完成後寫入 V3 標記避免重複處理。
- 同樣涵蓋裝備套裝、背包、輸送帶、合成暫存區、新熔爐佇列與神鑄槽。

### `normalDmgAffixScaleV4`：修正成長係數誤放大造成的過高值

- 先前曾將 `normalDmg` 的基礎值與成長係數同時放大，造成高等級既有值過高；本次以目前太古詞條上限為判斷基準，超過上限的值除回 10。
- 已正常的非太古值與太古值不變，處理完成後寫入 V4 標記避免重複；涵蓋所有既有裝備容器。
### `externalGoldRecoveryV1`

- **唯一標記**：`data.externalGoldRecoveryV1`
- **觸發時機**：既有存檔首次經過 `migrateSave()`（玩家刷新／讀取存檔時）。
- **處理範圍**：只處理玩家目前持有的 `data.player.gold`；新帳號由 `newGameState()` 預先帶有 `true`，不會套用。
- **門檻與公式**：只有 `data.player.gold > 10^16` 才執行 `Math.sqrt(data.player.gold) * 10000`；金幣 `<= 10^16` 時維持原值。
- **冪等條件**：遷移完成後寫入旗標；後續刷新看到旗標即跳過，不會再次開平方。
- **保留資料**：只改動金幣數值與遷移旗標，不改動其他資源或帳號進度。
- **測試**：`tests/external-gold-migration.test.cjs` 覆蓋首次處理、重複刷新與新帳號排除。
- **日後清理**：確認所有正式帳號已完成一次載入並持久化旗標後，移除遷移程式、測試與本節紀錄。

### `equipSetPotentialLimitV1`：多套裝備與潛力技能新門檻限制相容

- **唯一標記**：`data.equipSetPotentialLimitV1`
- **觸發時機**：既有存檔首次經過 `migrateSave()`（玩家刷新／讀取存檔時）。
- **處理範圍**：
  - 玩家等級低於 `2000` 級時，強制將裝備套與檢視套重置回第 1 套 (`equipActive = 0`, `equipView = 0`)。
  - 玩家轉生次數低於 `3` 轉時，強制清空所有潛力技能等級 (`potentialLevels = {}`)。
- **新帳號排除**：新帳號由 `newGameState()` 預先標記為 `true`，不會重置。
- **冪等條件**：遷移完成後寫入旗標；後續載入看到旗標即跳過。
- **保留資料**：保留玩家已持有的多套裝備清單，僅重置當前使用與檢視指標；清空潛力技能點數時，原投入的技能點會動態退還，保留點數總量。
- **測試**：`tests/equip-set-preview-stats.test.cjs` 驗證安全限制，`tests/talents.test.cjs` 驗證潛力技能解鎖。
- **日後清理**：確認所有存檔已載入並套用後，移除 `js/save.js` 遷移旗標捕捉與重置邏輯、`js/player.js` 中的預置旗標，保留此紀錄。
