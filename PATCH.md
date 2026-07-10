# PATCH.md

## 本次變更摘要：神鑄系統（Divine Forge）

### 新增檔案
- `js/forge.js`：神鑄邏輯層。六芒星槽位放入/取回、魔塵放置、成功率計算、鑄造判定
  （成功消耗 6 件產出下一品質；失敗隨機消耗 2 件、其餘退回背包；素材上的鑲嵌寶石一律先取回）。

### js/data.js
- `RARITIES` 新增第 9 階 `godforged`「神鑄創世」（`#f5c542`、mult 10.2 = 創世 × 1.5、salv 45）；
  `RARITY_PREFIX` 補「神鑄創世的」。
- 新增神鑄常數：`GODFORGED_IDX`、`FORGE_BASE_RATE`（傳說 55%｜神話 40%｜創世 25%）、
  `FORGE_GOLD_COST`（500 萬｜200 萬｜1 億）、`FORGE_DUST_RATE`（+5%/個）、魔塵掉落常數（野外 150 級+ 0.1%；BOSS 2% + 0.2%/級、上限 15%）。
- 新增 `GODFORGE_POOL`：12 種神鑄創世專屬特效（龍血/神力/神速/屠神/貪婪/神壁/天罰/破滅/聖佑/不朽/萬象汲取/神怒）。

### js/formula.js
- 新增 `towerChallengeCost`（100000 + BOSS等級 × 200000）、`bossDustRate`、`godforgePassiveValue`、`forgeSuccessRateFor`。
- `computeStats`：聚合裝備上的 `godPassives`（屬性型入聚合桶、觸發型入 passives）。
- `resolveHit`：掛入【破滅】（暴擊翻倍）、【聖佑】（受傷減免，上限 50%）、【不朽】（致命攻擊保命，60 秒一次）。
- `itemScore`：每條神鑄特效 ×1.15。

### js/item.js
- `makeEquipment`：品質為神鑄創世時必骰 2 條不重複專屬特效。
- `itemDetailHTML`：新增 `.it-godpassive` 專屬特效顯示區塊。

### js/factory.js
- 品質合成 / 混合合成大成功的品質上限鎖定在創世（`GODFORGED_IDX - 1`），神鑄創世僅能由神鑄系統產出。
- 名稱前綴剝除 regex 補「神鑄創世的」。

### js/combat.js
- `playerAtkCfg` 掛【神怒】與【破滅】；`playerDefCfg` 掛【聖佑】【不朽】。
- `doPlayerAttack` 掛【天罰】（250% 物攻真傷）與【萬象汲取】（生命/法力雙回復）。
- `rollFieldDrops`：敵人等級 ≥150 掉落魔塵 0.1%（150 以下不掉）。

### js/tower.js
- `startTowerFight`：挑戰前扣金幣（不足則阻擋並提示）。
- `endTowerFight`：勝利依 `bossDustRate(BOSS等級)` 掉落魔塵並列入獎勵。

### js/player.js
- `newGameState`：新增 `player.dust`、`forge` 狀態（slots/dust/autoDust/result/log）；篩選規則陣列擴至 9 格。

### js/save.js
- `migrateSave`：fixSockets / fixName 迴圈納入神鑄槽位；fixName regex 補「神鑄創世的」（置首防截半）。

### index.html
- 頂欄資源列新增 💫 魔塵；頁籤列新增「🔯 神鑄」；新增 `#tab-forge` 區塊（法陣/紀錄/按鈕/自動魔塵/背包）；
  載入 `js/forge.js`；玩法指南更新為品質 9 階並補神鑄說明。

### js/ui.js
- 新增 `renderForge`（槽位/魔塵符位/中央產物/成功率/紀錄/背包灰階過濾）與 `UI.dirty.forge` 驅動。
- 事件委派：法陣槽位點擊取回、魔塵符位點擊放置/取下、神鑄背包點擊放入；綁定鑄造/全卸下/自動魔塵。
- `itemCellHTML` 支援 extraClass 與 `eff-godforged`；`findItemById` 涵蓋神鑄槽位。
- `renderHeader` 顯示魔塵；高塔樓層列表與懸停提示顯示挑戰費用與魔塵掉落率。

### css/style.css
- 新增神鑄版面（`#forge-stage` 以 Hexagram.png 為底、百分比定位槽位/魔塵符位/中央產物/浮動紀錄/黃色按鈕）、
  `.eff-godforged` 耀金流光邊框、`.it-godpassive` 專屬特效金框樣式。

### 使用者調整（第五輪）
- 野外魔塵掉落率改為**成長制**：150 級 0.1%，敵人每高 1 級 +0.1%，上限 5%
  （新公式 `fieldDustRate` → formula.js §5；149 級以下仍不掉落）。
- 高塔 BOSS 魔塵掉落率上限 15% → **30%**（`DUST_BOSS_CAP`，約第 27 層起封頂）。

### 使用者調整（第四輪）
- 鑄造成功產物的等級由「六件素材平均」改為「**六件素材中的最高等級**」（js/forge.js doForge）。
- 魔塵符位由計數制改為**六格獨立**（`G.forge.dustSlots` 布林陣列）：點哪個角尖就在該位置放入/取下，
  不再從第 1 格順序填入；自動使用魔塵仍由第 1 格起補滿；舊存檔的計數值自動轉換為前 n 格點亮。

### 使用者調整（第三輪）
- 神話裝備鑄造費用 200 萬 → **2000 萬**（data.js `FORGE_GOLD_COST`）。
- 高塔挑戰費用改為 **100000 + 樓層 × 200000**（formula.js `towerChallengeCost`；魔塵掉落率仍依 BOSS 等級）。
- 神鑄頁籤移至「技能」之後；**角色 1000 級開放**（`FORGE_UNLOCK_LEVEL`），未達標前頁籤隱藏
  （index.html 預設 `display:none`、renderHeader 依 `forgeUnlocked()` 切換）；
  達標時彈出「神鑄系統已開啟！」確認彈窗（可直接前往神鑄分頁），
  以 `G.forge.unlockNotified` 旗標保證僅提示一次（涵蓋升級當下與讀檔已達標兩種情況）。

### 對抗式審查後的修復（第二輪）
- **裝備複製漏洞**（js/ui.js）：撤銷 `findItemById` 對神鑄槽位的搜尋擴充——`detailAction('equip')`
  只以 `indexOf` 防護背包，殘留的 `UI.sel` 原可將法陣內裝備再次穿上造成雙重引用；
  另在神鑄背包點擊放入成功後清除同 id 的選取狀態。
- **退回銷毀風險**（js/forge.js）：新增 `forgeReturnItem`，法陣取回/全卸下/失敗退回一律保證放回背包
  （滿載時允許暫時超出容量），不再走 `addToInventory` 的滿載自動分解路徑（傳說品質原可能被銷毀）。
- **高塔統計負值**（js/tower.js）：【不朽】觸發使血量回升時，`bossDmgDealt` 統計以 `Math.max(0, …)` 防倒扣。
- **神鑄特效接入技能**（js/skills.js）：【神怒】對技能傷害同步生效、【破滅】對技能暴擊同樣適用；
  【天罰】【萬象汲取】依特效描述「攻擊時」維持僅普攻觸發。
