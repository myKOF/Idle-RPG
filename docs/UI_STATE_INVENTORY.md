# UI 狀態相依清單（P3 前置）

> 盤點基準：`js/ui.js` 6425 行、Worker 協議 v3（`WORKER_PROTOCOL_VERSION = 3`，81 條指令）。
> 本文件只描述現況與 P3 邊界，不修改協議或程式碼。行號皆指目前的 `js/ui.js`。

## 1. 盤點口徑與摘要

- 靜態掃描找到 `G.*` 明寫參照 183 次、52 種路徑；「約 226 處」的差額主要是先取別名後再讀，例如 `var p = G.player`、`var f = G.factory`、`var nf = G.newForge`。下表已把別名後的欄位一併展開。
- 另列出不是 `G.*`、但同樣屬於 Worker 權威狀態的 `FIELD`、`TOWER`、`GT`、`RUN_STATS`、`forgeState()`、`gemShop()`、`newForgeState()`。
- v3 有 `fn` 且目前確實由 UI 呼叫的模擬層函式共 56 個、63 個顯式呼叫點；`fleeTower` 另以 callback 形式綁定 1 處。
- `INTERNAL_ONLY` 五個函式全部仍被 UI 呼叫，共 8 個位置。
- `UI.*` 的選取、彈窗、篩選、暫存素材與 DOM cache 視為主執行緒本地狀態；只有它們最後直接改到 `G`／Worker 物件時才列入 B。

### PANEL_KEY 對照

| 頁籤／區域 | PANEL_KEY | 備註 |
|---|---|---|
| 頂欄、側欄屬性、共用資源 | `header` | 高頻純量優先取 `tick.view`，完整 stats／資源提示取 `header` panel |
| 野外戰鬥、場景與關卡 | `battle` | `FIELD`、戰鬥實體、buff、敵群也必須包含在 battle panel／tick view，不可再讀主執行緒模擬物件 |
| 裝備套與裝備欄 | `equip` | |
| 背包與裝備詳情 | `inv` | 詳情同時依賴 `equip`、`gems`、`header` 的資源資訊 |
| 熔爐 | `newforge` | 零件庫／附魔統計另依賴 `factory` |
| 神鑄 | `forge` | 素材清單另依賴 `inv`、`gems` |
| 高塔 | `tower` | 戰鬥中另依賴 `battle` |
| 寶石 | `gems` | 商店購買能力另依賴 `header` 的金幣 |
| 技能 | `skills` | 裝載中的戰鬥呈現另依賴 `battle` |
| 天賦 | `talents` | 點數與屬性變化另依賴 `header` |
| 設定／存檔 | 無獨立 key | 遊戲摘要取 `header`／完整 snapshot；資料夾與檔案清單是主執行緒 I/O 狀態 |
| 統計／PiP／頁籤標題 | 無獨立 key | 戰況取 `battle`＋`header`；統計目前另讀 `RUN_STATS`，見缺指令項 |

## 2. 共用、頂欄與設定

### A. 讀狀態

| 行號 | 目前讀取與行為 | PANEL_KEY／來源 |
|---|---|---|
| 422 | 讀 `G.tower.active` 決定戰鬥日誌分類是否轉為 BOSS | `battle`／`tower` |
| 766、791、794 | 讀 `G.newForge.tabSeen`、`noticeShown` 控制頁籤發光與改版公告 | `newforge`（徽章可投影到 `header`） |
| 852–855 | 設定頁存檔摘要讀 `G.runId`、`savedAt`、`player.level`、`stage.current/zone` | full snapshot 或 `header`＋`battle` |
| 885–925 | `p = G.player`；讀 gold、scrap、essence、dust、ancientEssence、soulOrigin、demonSeed、books、level，並經 `gemCount()`／`totalGemsAll()` 讀寶石庫存 | `header` |
| 927–943 | 讀 `p.shownRes` 決定資源是否永久顯示 | `header` |
| 947–949 | 讀 `G.settings.compareEq`、`G.factory.autoEquip` 同步開關 | `header`／`factory` |
| 950–1001 | 讀等級、經驗、轉生、角色 stats 與 DPS；`getStats()`、`getViewStats()`、`currentDps()` 都是 Worker 派生狀態 | `header`；不可在主執行緒重算 |
| 1031–1036 | 讀 `G.equipView`、`G.equipActive` 顯示裝備套預覽提示 | `equip`／`header` |
| 1079、1122 | 讀 `G.tower.active` 選擇野外或高塔戰鬥實體 | `battle`／`tower` |
| 3055–3090 | 測試服承傷面板讀 `G.player`、FIELD 玩家、檢視套 stats、buff 與減傷派生值 | `header`／`battle` |
| 4448–4479、4530–4539 | PiP 與頁籤標題讀等級、金幣、階段、高塔狀態、FIELD／TOWER 實體、stats、DPS | `header`＋`battle`＋`tower` |
| 6201 | 重新開局提示讀 `G.runId` | full snapshot／`header` |

### B. 寫狀態

| 行號 | 目前寫入 | v3 指令／處理 |
|---|---|---|
| 767 | `G.newForge.tabSeen = true` | `newforge.markTabSeen` |
| 928、939 | 建立並寫入 `G.player.shownRes[id]`，渲染本身會改存檔 | **缺指令**。建議 Worker 在資源首次大於 0 時更新，或新增白名單指令；UI 只讀結果 |
| 4824 | `G.newForge.noticeShown = true` | `newforge.markNoticeShown` |
| 6084 | `G.settings.compareEq = checked` | `settings.set {key:'compareEq', value}` |
| 6089 | `G.factory.autoEquip = checked` | `factory.setAutoEquip` |

### C. 模擬層變更呼叫

| 行號 | 目前呼叫 | v3 指令 |
|---|---|---|
| 4868 | `reincarnate()` | `player.reincarnate` |
| 4877、5580、5595、5598 | `switchZone(zoneKey)` | `stage.switchZone` |
| 6137–6150 | 先選資料夾，再以 `createManualSaveToFolderV2()` 建立手動存檔 | 資料夾授權留主執行緒；遊戲狀態序列化改送 `save.toFolder`。不可在 UI 讀鏡像 `G` 產生存檔 |
| 6162、6190 | `openSaveFolder()` 選擇／重掃資料夾 | 主執行緒 I/O，非 Worker 指令 |
| 6202 | `restartGame()` | `save.restart` |
| 6219 | `loadSaveRecord(id)` 讀檔並換狀態 | 主執行緒取 raw save 後送 `MSG_IN.LOAD`，不是 command |
| 6228 | `deleteSaveRecord(id)` | 主執行緒 I/O，非 Worker 指令 |

## 3. 戰鬥與關卡

### A. 讀狀態

| 行號 | 目前讀取與行為 | PANEL_KEY |
|---|---|---|
| 1144–1194 | 讀 `GT`、敵我 effects／dots／buffs 產生狀態列與提示 | `battle` |
| 1198–1238 | 讀玩家實體 MP、skillCds，以及 `G.player.loadout`、技能／潛力等級 | `battle`＋`skills` |
| 1241–1331 | 讀 `G.stage.zone/current/best/autoAdvance` 與 `G.zoneProgress[*].best` 畫場景列及關卡控制 | `battle` |
| 1351–1359 | 讀 `G.player.loadout`、`player.skills` 推算護盾技能 cap | `battle`；應由 Worker 提供已正規化值 |
| 1425–1509 | 讀 `FIELD.player`、敵群、reviveCd、HP／MP／shield／狀態與 `G.tower.active` | `battle` |
| 3019 | `uiTick()` 讀 `G.tower.active` 決定是否刷新高塔戰鬥畫面 | `tower`＋`battle` |
| 3889–3992 | 敵人提示讀 `G.tower.active`、`G.stage.current`、FIELD／TOWER 敵人與掉落派生資料 | `battle`／`tower` |
| 4681–4760 | 長按關卡讀 `G.stage.current/best` 做主執行緒預覽 | `battle`；只能當樂觀預覽，送出時以 Worker ack 為準 |
| 5591 | 位面切換讀 `G.stage.zone` | `battle` |

### B. 寫狀態

| 行號 | 目前寫入 | v3 指令／處理 |
|---|---|---|
| 1372–1384 | `playerShieldMax()` 在 render 中改 `entity.shield/shieldMax/shieldMaxVersion` | **不可由 UI 寫 mirror**。這是 Worker 內部正規化，不應新增玩家指令；battle snapshot 應直接給可渲染值（`shieldSkillBase`/`shieldSkillPct` 已於 2026-07-31 護盾語意修正時移除） |
| 1452、1503–1507 | 只改 DOM 與 UI cache；無權威狀態寫入 | 主執行緒保留 |
| 2826、2952、2957 | 圖片載入失敗時改 `BOSS_LIST[*].imgFailed`／`TOWER.boss.imgFailed` | 改用 UI-local 圖片失敗 cache；不送指令、不寫 Worker mirror／共載資料表 |
| 5617 | `G.stage.autoAdvance = checked` | `stage.setAutoAdvance` |
| 5837 | 手動挑戰前直接清 `TOWER.auto`、`TOWER.autoNextCd` | 應由 `tower.start` 在 Worker 原子取消等待中的連挑；UI 不得直接寫 |

### C. 模擬層變更呼叫

| 行號 | 目前呼叫 | v3 指令 |
|---|---|---|
| 4720、4736 | `stageGo(delta)` | `stage.go` |
| 5616 | `stageGoMax()` | `stage.goMax` |
| 5607 | `toggleCombatPaused()` | `combat.togglePaused` |
| 5838 | `startTowerFight(floor)` | `tower.start` |
| 5846 | `startTowerAuto(floor,count)` | `tower.startAuto` |
| 6023 | `fleeTower` callback | `tower.flee` |
| 6299–6300 | 優先 `confirmTowerResult()`，fallback 才是 `finishTowerFight()` | `tower.finish` **語意不等價**：現行 `confirmTowerResult()` 會在連挑時啟動下一場；v3 的 `fn:'finishTowerFight'` 只離塔。需 Claude 決定擴充 `tower.finish` 語意或補確認指令 |
| 6304 | `stopTowerAutoFromResult()` | `tower.stopAuto` |

## 4. 裝備、背包與詳情

### A. 讀狀態

| 行號 | 目前讀取與行為 | PANEL_KEY |
|---|---|---|
| 1676–1699 | 讀檢視中 equipment 與各 item 欄位畫裝備欄 | `equip` |
| 1703–1746 | 讀 `equipmentSets`、`equipActive`、`equipView`、`equipSetNames` 與解鎖狀態 | `equip` |
| 1773–1837 | 讀 `player.invUpgrades`、`inventory`、容量與篩選欄位 | `inv` |
| 1842–1852 | `findItemById()` 直接掃 `G.inventory` 與檢視中 equipment | `inv`＋`equip`；P3 應以 panel item 資料／本地 index 查找，不掃 mirror 權威物件 |
| 1855–1957 | 詳情讀 upgrade cost、gold、scrap、寶石庫存、fusedGems、books、essence、enchants、sockets | `inv`＋`equip`＋`gems`＋`header` |
| 2052–2140 | 動作前讀 inventory、檢視中 equipment、容量、synthBuffer、鎖定／品質／等級／太古數 | `inv`＋`equip`＋`factory` |
| 3791–3804 | 裝備 tooltip 讀檢視中 equipment 做比較 | `equip` |
| 4929 | 換裝後讀 `G.equipActive` 產生目前套裝名稱日誌 | `equip` |
| 5859–5867、5893 | 拆解設定面板與事件處理讀 `G.player`／`salvageSettings` | `factory` |
| 5934–5982 | 擴充／排序讀 gold、invUpgrades、`_invSortIdx` 與 inventory | `inv`＋`header` |

### B. 寫狀態

| 行號 | 目前寫入 | v3 指令／處理 |
|---|---|---|
| 1737、1742 | 建立／寫 `G.equipSetNames[idx]` | `player.renameEquipSet` |
| 1900 | `ensureSockets(it)` 在 render 詳情時可能建立／擴充 `it.sockets` | 不可在 UI render 改物件。Worker migrate／panel builder 先正規化；不是玩家指令 |
| 2054–2058 | inventory splice、`equipItem()`、舊裝備解鎖與退包 | `item.equip`（v3 `fn:null` 原子操作） |
| 2064–2069 | `panelEq[slot]=null` 後 `addToInventory(it)` | `item.unequip`（v3 `fn:null` 原子操作） |
| 2072–2077 | inventory splice 後 `doSalvage(it)` | `item.salvage`（v3 `fn:null` 原子操作） |
| 2081–2087 | inventory splice、`it.locked=false`、push 至 `synthBuffer` | **缺指令**（目前受 `SYNTHESIS_ENABLED` 關閉保護）。若功能仍保留，需原子 `item.toSynth`；若正式移除，應由 Claude 裁決 |
| 2113 | `it.locked = !it.locked` | `item.setLock` |
| 2124–2140 | 篩選 targets、逐件 salvage、最後替換 `G.inventory` | `item.salvageBulk`；必須保留分解前存檔語意 |
| 5150–5159 | splice／push 後寫回 `G.player.loadout` | `skill.reorderLoadout` |
| 5894–5897 | 建立並寫 `player.salvageSettings` 三欄 | `factory.setSalvageSettings` |
| 5944–5945 | 扣 gold、增加 invUpgrades | `player.buyInvUpgrade` |
| 5958、5966 | 改 `_invSortIdx` 並就地 sort inventory | `player.setInvSort`；Worker 實作須同時保存 mode 並重排，不能只寫 index |

### C. 模擬層變更呼叫

| 行號 | 目前呼叫 | v3 指令 |
|---|---|---|
| 2056 | `equipItem()`（外加 UI 自己搬 inventory） | `item.equip`；不得直接映射單一 fn |
| 2075 | `doSalvage(it)` | `item.salvage`；不得直接映射單一 fn |
| 2092 | `manualUpgrade(it)` | `item.upgrade` |
| 2103 | `rerollSingleAffix(it,affixKey)` | `item.rerollAffix` |
| 2132、2136 | `manualSave('before_bulk_salvage')`＋逐件 `doSalvage()` | `item.salvageBulk` 的 Worker 原子實作 |
| 4921 | `setEquipView(index)` | `player.setEquipView` |
| 4928 | `switchToEquipSet(index)` | `player.switchEquipSet` |
| 5741 | `socketGem(item,type)` | `gem.socket` |
| 5752 | `unsocketGem(item,index)` | `gem.unsocket` |
| 5799 | `socketFusedGem(item,fusedId)` | `gem.socketFused` |
| 5813 | `manualEnchant(item,bookKey)` | `item.enchant` |
| 5827 | `removeEnchantAt(item,index)` | `item.removeEnchant` |

## 5. 熔爐（newforge）與 factory

### A. 讀狀態

| 行號 | 目前讀取與行為 | PANEL_KEY |
|---|---|---|
| 154–167 | `newForgeState()`／`G.newForge` 讀所有熔爐已安裝零件做日誌統計 | `newforge` |
| 2149–2159 | 讀 `G.factory.stats.enchanted`、books、essence | `factory`＋`header` |
| 2183–2185 | 讀 `G.factory.autoEquip` | `factory` |
| 2195–2304 | 讀 furnace qualities、belt、parts、partSlots、enabled、queue，以及 `G.player.gold`、`G.factory.parts` | `newforge`＋`factory`＋`header` |
| 2308–2365 | 讀 `G.newForge.queue/furnaces/stats` 與每座 furnace queue | `newforge` |
| 2376–2433 | 事件先以 `findNewForgeFurnace()` 取得權威 furnace 物件 | `newforge` panel 中的 snapshot；P3 不得把 snapshot 物件傳回 |

### B. 寫狀態

| 行號 | 目前寫入 | v3 指令／處理 |
|---|---|---|
| 2380 | `fu.qualities[rarity] = checked` | `newforge.setQuality` |
| 2384 | `fu.enabled = checked` | `newforge.setEnabled` |

### C. 模擬層變更呼叫

| 行號 | 目前呼叫 | v3 指令 |
|---|---|---|
| 2395 | `newForgeInstallPart(furnaceId,partKey)` | `newforge.installPart` |
| 2403 | `addNewForgeFurnace()` | `newforge.addFurnace` |
| 2410 | `removeNewForgeFurnace(furnaceId)` | `newforge.removeFurnace` |
| 2422 | `unlockNewForgePartSlot(furnaceId)` | `newforge.unlockPartSlot` |
| 2433 | `newForgeUninstallPart(furnaceId,slotIndex)` | `newforge.uninstallPart` |

## 6. 神鑄（forge）

### A. 讀狀態

| 行號 | 目前讀取與行為 | PANEL_KEY |
|---|---|---|
| 2463–2467 | `forgeState().crafting` 決定素材頁 | `forge` |
| 2473–2536 | 讀寶石庫存、inventory、`forgeState().autoFill` 組自動放入選單 | `forge`＋`gems`＋`inv` |
| 2591–2632 | 讀 crafting 的 startedAt、duration 與剩餘素材 | `forge` |
| 2635–2753 | 讀 slots、dustSlots、result、log、autoDust、autoForge、player.dust、busy、autoFill | `forge`＋`header` |
| 2760–2790 | 讀寶石庫存或 inventory／容量畫神鑄素材清單 | `gems` 或 `inv` |
| 5186 | hover 時直接讀 `forgeState().slots[index]` | 改讀 `forge` panel 的 slot snapshot |

### B. 寫狀態

| 行號 | 目前寫入 | v3 指令／處理 |
|---|---|---|
| 3007–3009 | `forgeState().unlockNotified = true`（神鑄開放公告旗標） | **缺指令／事件語意**。建議 Worker 在解鎖時設旗標並送一次 `notice`，UI 不寫 state |
| 5661、5664、5677 | 直接設／清 `forgeState().autoFill` | `forge.setAutoFill`；確認時需把選擇與首次填入做成單一 Worker 操作，避免半套狀態 |
| 6058 | `forgeState().autoDust = checked`，必要時立即補塵 | `forge.setAuto {key:'autoDust'}`；是否立即補塵須由 Worker 保留現行語意 |
| 6064 | `forgeState().autoForge = checked` | `forge.setAuto {key:'autoForge'}` |

### C. 模擬層變更呼叫

| 行號 | 目前呼叫 | v3 指令 |
|---|---|---|
| 5631 | `forgeRemoveItem(slotIndex)` | `forge.removeItem` |
| 5637 | `forgeToggleDust(index)` | `forge.toggleDust` |
| 5660、6036 | `forgeUnloadAll()` | `forge.unloadAll` |
| 5662 | `forgeAutoFillApply()` | 由 `forge.setAutoFill` 的 Worker 實作吸收；不應另開 INTERNAL 指令 |
| 5697 | `forgePlaceGem(type,level)` | `forge.placeGem` |
| 5706 | `forgePlaceItem(itemId)` | `forge.placeItem`（此 id 不 resolve 成物件） |
| 6029 | `doForge()` | `forge.start` |
| 6059 | `forgeAutoFillDust()` | `forge.autoFillDust`，或併入 setAuto 的原子後續 |
| 6072 | `cancelForge()` | `forge.cancel` |

## 7. 高塔

### A. 讀狀態

| 行號 | 目前讀取與行為 | PANEL_KEY |
|---|---|---|
| 2799–2863 | 讀 `G.tower.active/highest`、player.gold、`TOWER.result` 畫樓層、費用與上次結果 | `tower`＋`header` |
| 2891–2980 | 讀 `G.tower.active`、TOWER floor/boss/player/elapsed/auto/enraged/damage 與 pause | `tower`＋`battle` |
| 3822–3868 | 樓層 tooltip 讀 BOSS stats 與掉落派生資料 | `tower` panel 可直接附 tooltip view model，避免主執行緒重算 |
| 6316–6376 | 結果彈窗讀 Worker 傳入的 result／player／boss／damage | `tower` event／panel |

### B. 寫狀態

高塔直接寫入見戰鬥區的 5837；其餘倒數 timer、彈窗與按鈕狀態都是 UI-local。

### C. 模擬層變更呼叫

高塔指令呼叫集中在戰鬥區：`tower.start`、`startAuto`、`flee`、`finish`、`stopAuto`。

## 8. 天賦

### A. 讀狀態

| 行號 | 目前讀取與行為 | PANEL_KEY |
|---|---|---|
| 3155–3259 | 經 `talentLevel/unlocked/turn`、`potentialLevel/unlocked` 與定義表讀節點狀態／效果 | `talents`；這些 query 結果應在 panel snapshot |
| 3317–3362 | 讀 talent level、解鎖、cost、`G.player.reincarnationTalentPoints` 畫操作彈窗 | `talents`＋`header` |
| 3365–3392 | 讀轉生數、天賦樹各節點 level、轉生天賦點 | `talents`＋`header` |

### B. 寫狀態

無直接 `G` 寫入；`UI.selTalent` 是主執行緒選取狀態。

### C. 模擬層變更呼叫

| 行號 | 目前呼叫 | v3 指令 |
|---|---|---|
| 4905 | `talentUpgrade(id)` | `talent.upgrade` |
| 4907 | `talentMax(id)` | `talent.max` |
| 4909 | `talentDowngrade(id)` | `talent.downgrade` |
| 4911 | `talentDelete(id)` | `talent.delete` |
| 4938 | `potentialMax(id)` | `talent.potentialMax` |
| 4947 | `potentialUpgrade(id)` | `talent.potentialUpgrade` |
| 4998 | `potentialDowngrade(id)` | `talent.potentialDowngrade` |
| 5040 | `potentialDelete(id)` | `talent.potentialDelete` |

## 9. 技能

### A. 讀狀態

| 行號 | 目前讀取與行為 | PANEL_KEY |
|---|---|---|
| 3400–3475 | 讀 `G.player.loadout`，別名 `p.level/loadout/fusions`，以及技能／潛力等級、點數、解鎖狀態 | `skills` |
| 3534–3627 | 讀技能／潛力 level、max、解鎖、loadout、player.gold 與可用點數 | `skills`＋`header` |
| 3631–3690 | tooltip 讀相同技能／天賦派生狀態 | `skills`／`talents` |
| 4046–4069 | 融合預覽讀選定技能的等級 | `skills`；選定 id 留 UI-local |

### B. 寫狀態

| 行號 | 目前寫入 | v3 指令／處理 |
|---|---|---|
| 5150–5159 | 拖放直接重排 `G.player.loadout` | `skill.reorderLoadout` |

### C. 模擬層變更呼叫

| 行號 | 目前呼叫 | v3 指令 |
|---|---|---|
| 4938 | `maxUpgradeSkill(id)` | `skill.maxUpgrade` |
| 4947 | `learnOrUpgradeSkill(id)` | `skill.learn` |
| 4954 | `equipSkillToLoadout(id)` | `skill.equipLoadout` |
| 4961 | `unequipSkillFromLoadout(id)` | `skill.unequipLoadout` |
| 4998 | `downgradeSkill(id)` | `skill.downgrade` |
| 5038 | `deleteFusion(id)` | `skill.deleteFusion` |
| 5042 | `deleteSkill(id)` | `skill.delete` |
| 5236 | `fuseSkills(ids)` | `skill.fuse` |

## 10. 寶石與商店

### A. 讀狀態

| 行號 | 目前讀取與行為 | PANEL_KEY |
|---|---|---|
| 4076–4147 | 經 `gemCount()` 讀各 type／level 計數，畫表格與合成預覽 | `gems` |
| 4150–4230 | 讀 gemCount，扣除 UI-local convertSlots 後畫可放入數 | `gems` |
| 4233–4255 | 讀一般寶石數與 `G.player.fusedGems` 畫拆解預覽 | `gems` |
| 4281–4353 | 讀一般／融合寶石、融合相容性與成功率 | `gems` |
| 4362–4416 | 經 `gemShop()` 讀商店 items/level/refreshCount，並讀 player.gold | `gems`＋`header` |

### B. 寫狀態

`UI.convertSlots`、`UI.gemFuseSlots`、排序與訊息陣列均為提交前的 UI-local 草稿，不是 `G`；可以留主執行緒。實際扣庫存只允許在 command 中發生。

### C. 模擬層變更呼叫

| 行號 | 目前呼叫 | v3 指令 |
|---|---|---|
| 5253 | `composeGems(type,level)` | `gem.compose` |
| 5263 | while 最多 2500 次 `composeGems()` 做「全部合成」 | **缺批次指令**。逐 ack 送 2500 次不可接受；建議 `gem.composeAll` 或讓 `gem.compose` 有 Worker-side all 語意 |
| 5312 | `convertGems(slots,target)` | `gem.convert` |
| 5343 | `dismantleGem(type,level)` | `gem.dismantle` |
| 5357–5359 | while 最多 999 次 `dismantleGem()` 做「全部拆解」 | **缺批次指令**。建議 Worker-side `gem.dismantleAll` |
| 5380 | `dismantleFusedGem(fusedId)` | `gem.dismantleFused` |
| 5398 | `fuseGemsV2(ref1,ref2)` | `gem.fuse` |
| 5425 | `buyAllShopGems()` | `gem.shopBuyAll` |
| 5431 | `refreshGemShop()` | `gem.shopRefresh` |
| 5439 | `upgradeGemShop()` | `gem.shopUpgrade` |
| 5789 | `buyShopGem(index)` | `gem.shopBuy` |

## 11. 統計面板

### A. 讀狀態

| 行號 | 目前讀取與行為 | PANEL_KEY／來源 |
|---|---|---|
| 6270 | 清除統計時讀 `G.stage.current` 當新基準 | `battle` |
| 6387–6412 | `statsBasicHtml/statsSourceHtml/statsLootHtml/generateSummaryHtml` 直接讀模擬統計狀態 | 無獨立 PANEL_KEY；P3 需由 full snapshot、事件聚合或新增正式 panel 決定 |

### B／C. 寫入與變更呼叫

| 行號 | 目前行為 | v3 指令／處理 |
|---|---|---|
| 6269–6272 | 直接清 `RUN_STATS.skills/maxStage` 並呼叫 `resetLootStats()` | **缺指令**。需要 Worker-side `stats.reset`，或由 Claude 明確裁決統計為主執行緒事件投影、完全不屬 `G` |

## 12. INTERNAL_ONLY 越界清單

這五個函式不可開成 command；P3 應由其所屬正式指令／Worker 內部流程吸收。

| INTERNAL_ONLY | ui.js 行號 | 目前行為 | 應由哪個正式流程吸收 |
|---|---|---|---|
| `addToInventory` | 2057 | equip 替換下來的舊裝備退包 | `item.equip` 原子操作 |
| `addToInventory` | 2068 | unequip 裝備退包 | `item.unequip` 原子操作 |
| `newForgeReturnUnroutable` | 2381 | 品質取消勾選後，專屬佇列退回總佇列 | `newforge.setQuality` |
| `newForgeReturnUnroutable` | 2385 | 停用熔爐後，專屬佇列退回總佇列 | `newforge.setEnabled` |
| `shopHourlyReset` | 4365 | render 商店時做週期重置 | Worker tick／商店 panel builder 內部流程 |
| `rollGemShop` | 4367 | 首次 render 時免費鋪貨 | Worker 初始化／商店 panel builder 內部流程 |
| `shopHourlyReset` | 4410 | 倒數更新時再次檢查重置 | Worker tick 內部流程 |
| `forgeLog` | 6031 | `doForge()` 錯誤時由 UI 再寫 forge log | `forge.start` 的 event／ack；玩家文案走 Worker events |

## 13. 其他惰性查詢與鏡像風險

| 行號 | 風險 | P3 處理 |
|---|---|---|
| 154 | `newForgeState()` 可能惰性建立 `G.newForge` | 主執行緒只讀 `newforge` panel，不呼叫 |
| 2464、2535、2594、2638、3007–3008、5186、5659、5677、6057、6063 | `forgeState()` 可能惰性建立 forge 子狀態，且部分位置取得物件後直接寫 | 全部改讀 `forge` panel；變更走 v3 command |
| 4366、4409、4411、4416、5433、5441 | `gemShop()` 可能惰性建立商店狀態 | 全部改讀 `gems` panel；變更走商店 command |
| 1217、3403、3437、3544、3640、4054、4067 | `skillLevel()` 直接查 Worker 技能狀態 | `skills` panel 直接帶 level map |
| 3422、3577 | `availableSkillPoints()` 直接查 Worker 技能狀態 | `skills` panel 帶 available points |
| 1900 | `ensureSockets()` 名為 helper 但會寫 item | Worker 端正規化後才建立 panel |
| 2826 | inline `onerror` 寫共享 `BOSS_LIST[*].imgFailed` | 改成 UI-local 圖片失敗集合，避免修改共載資料表 |

## 14. 非同步風險點

| 行號／操作 | 風險 | 建議 |
|---|---|---|
| 4675–4769 關卡點擊／長按 | 每 50ms 預覽，若每步都送 command 會堆積；鏡像 current/best 也可能落後 | 保留 UI 樂觀 preview，只在放開時送一個 `stage.go(delta)`；到 ack 前鎖同組按鈕。Worker 以自身 current／best clamp，失敗則以新 panel 回滾 |
| 4831–4889 轉生／晉階 | 確認彈窗可在 command pending 時再次開啟；成功後又緊接場景切換 | 送出 `player.reincarnate` 後鎖按鈕與確認操作；以 ack／full snapshot 決定成功文案與神界切換 |
| 2048–2115 裝備、卸下、單件分解、鎖定 | 詳情按鈕可連點；item 可能已在前一 command 中換位置或消失 | 以 itemId 為 key 單飛鎖；成功後等 `inv/equip` panel，失敗保持原選取 |
| 2092 裝備連續強化 | 玩家可在前一 ack 前重複送出，資源與結果顯示會錯序 | 以 itemId 為 key 鎖「強化」到 ack；不要先讀 mirror 判成功 |
| 2119–2144、5923–5929 批次分解 | 必須同時保證分解前存檔、篩選、扣物與收益原子性；雙擊會重複送 | `item.salvageBulk` 單一 command；確認後立即鎖確認鈕與背包操作，ack／panel 後解除 |
| 4905–4911、4934–4949、4994–5042 天賦／技能升降與清除 | modal 可連點，多筆 command 依序消耗點數／金幣 | 每個節點／modal 單飛鎖；max command 本身在 Worker 內完成，不展開為多次 upgrade |
| 5123–5159 loadout 拖曳排序 | ack 前再次拖曳會以舊順序送 from/to | 拖放後暫時樂觀重排 DOM，鎖 loadout 到 ack；失敗重新取 `skills` panel |
| 5235–5239 技能融合 | 素材會被消耗／歸零，雙擊風險高 | 送出後鎖融合鈕與素材槽到 ack |
| 5259–5267 全部合成 | 現行同步 while 最多 2500 次，不能逐筆跨執行緒 | 先補 Worker-side 批次語意；整批單一 ack |
| 5308–5331 寶石轉換 | UI.convertSlots 是草稿；送出後玩家仍可改槽，結果文案可能對不上 | 送出時複製 payload，鎖九宮格與目標下拉到 ack；成功才清草稿 |
| 5353–5369 全部拆解 | 現行同步 while 最多 999 次，不能逐筆跨執行緒 | 先補 Worker-side 批次語意；整批單一 ack |
| 5379–5413 融合寶石拆解／融合 | 不可逆素材操作；雙擊會第二次找不到素材 | 確認後鎖目標 fusedId／融合鈕，ack 後刷新 panel |
| 5424–5443、5787–5791 商店 | 購買／刷新／升級可連點，price 與 gold mirror 會落後 | 整個商店 mutation 區單飛，或至少按 command key 鎖；用 ack＋panel 更新 |
| 5641–5682 神鑄自動放入 | 現行「清空→寫 autoFill→填入」是多步同步流程，跨執行緒可能停在半套 | `forge.setAutoFill` 在 Worker 原子完成；送出後鎖選單與法陣 |
| 5693–5709、6028–6073 神鑄放入／鑄造／取消 | 六格連點與 start/cancel 可能交錯；forge busy mirror 落後 | 法陣 mutation command 序列化；start 後鎖素材與設定，cancel ack 後解鎖 |
| 2373–2435 熔爐品質、啟用、零件、增減爐 | checkbox／晶片可快速連點；同 furnace snapshot 可能過期 | 以 furnaceId 單飛鎖；checkbox 可樂觀顯示，失敗以 `newforge` panel 回滾 |
| 5835–5847 高塔手動／連挑 | 雙擊可能重複扣挑戰費；UI 直接清 auto 會與 Worker 狀態競態 | start/startAuto 送出即鎖樓層按鈕，Worker 原子檢查並扣費 |
| 6288–6373 高塔結果倒數 | 自動倒數與玩家按確認可能同時送 finish；連挑續場語意尤其敏感 | result token／單飛鎖；先裁決 `confirmTowerResult` 對應指令語意 |
| 6134–6223 存檔、重新開局、讀檔 | I/O 慢，重複按會交錯 persist／load／reload | 全域 save-operation lock；顯示 pending，直到 persist/saveResult 或 load/full 完成 |

## 15. v3 盤點後仍無完整對應的項目

以下只記錄疑義，不在本任務修改 `protocol.js`：

1. `ui.js:928,939`：資源首次顯示旗標 `player.shownRes` 由 render 寫入，無指令。
2. `ui.js:1372-1384`：護盾正規化在 UI render 中改戰鬥實體；應移回 Worker 內部，不是玩家指令。
3. `ui.js:1900`：`ensureSockets()` 在 UI render 中改 item；應在 Worker migrate／panel 建立前完成。
4. `ui.js:2081-2087`：合成暫存區操作受 feature flag 關閉，但若保留功能則缺原子 `item.toSynth`。
5. `ui.js:3007-3009`：神鑄解鎖公告旗標 `forgeState().unlockNotified` 由 UI 寫入，無指令／事件。
6. `ui.js:5263`：全部寶石合成缺 Worker-side 批次指令。
7. `ui.js:5357-5359`：全部寶石拆解缺 Worker-side 批次指令。
8. `ui.js:5837`：`tower.start` 必須吸收「手動挑戰取消等待中連挑」的狀態轉移。
9. `ui.js:6299-6300`：`confirmTowerResult()` 含連挑續場，v3 `tower.finish → finishTowerFight()` 語意不足。
10. `ui.js:6269-6272`：清除戰鬥／掉落統計缺 Worker command 或明確的主執行緒事件投影決策。
