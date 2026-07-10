# PATCH.md

## 本次變更摘要：本機 GM 指令集

### 新增檔案
- `GM_command.md`：詳細記錄本機限制、鍵盤操作、貨幣／材料／寶石／附魔書／裝備／零件／等級／商店／存檔指令與範例。
- `js/gm.js`：獨立的 GM 指令解析與執行模組。
- `tests/gm-command.test.cjs`：驗證外部環境封鎖與本機 Enter/Escape 行為。

### 安全與 UI
- 只接受 `localhost`、`127.0.0.1`、`::1`；外部環境不建立輸入框、不註冊鍵盤事件，執行時再次檢查 hostname。
- 本機按 Enter 開啟左下角輸入框；指令執行後保留輸入文字，可重複按 Enter 執行；空白 Enter 或 Escape 關閉。
- 裝備 GM 發放直接加入背包，不觸發一般背包滿載自動分解。

### index.html / js/main.js / css/style.css
- 載入 GM 模組並於遊戲初始化後啟用本機 GM；新增左下角輸入框、狀態文字與錯誤樣式。

## 本次變更摘要：寶石商店等級與機率改造

### js/data.js / js/formula.js
- 新增商店 Lv.1～20 的刷出數量機率表與寶石階級機率表。
- 更新 1～10 階寶石購買價格：5,000～8,000,000,000 金幣。
- 新增商店升級費用公式：`10000 + 商店等級^3 × 4000000`，Lv.20 為滿級。

### js/item.js / js/player.js / js/save.js
- 商店狀態新增 `level`，舊存檔缺少時自動補為 Lv.1。
- 升級成功扣款、提升等級並立即依新等級重刷商品；金幣不足或已滿級時不變更狀態。

### index.html / js/ui.js / css/style.css
- 商店右上新增等級與升級按鈕。
- 商品格改為十欄排列並縮小 icon、文字與按鈕，提升單排可見數量。

## 本次變更摘要：顯示高階寶石與調整寶石庫存圖示

### js/ui.js
- 一般寶石總表與轉換庫存區由 1～5 階擴充為顯示 1～10 階，修正 6 級以上神鑄寶石不會顯示的問題。
- 庫存寶石項目改用方形 icon 結構：左上顯示數量、中央顯示 icon、底部顯示等級；完整名稱保留於 tooltip。
- 寶石融合素材池同步使用相同的方形 icon 結構。

### js/item.js / index.html
- 寶石拆解支援選取 6～10 階寶石，並補上對應等級選項。

### css/style.css
- 一般寶石轉換庫存與融合素材池改為 48×48 方形格，約比神鑄背包格縮小 30%。

## 本次變更摘要：固定元素攻擊的元素抗性減傷

### js/formula.js
- 抽出 `elementalResistanceMultiplier`，明確規定 `elemAtk` 只套用對應元素抗性（上限 75%），不重複套用魔法抗性。
- 新增元素抗性回歸測試，確認 50% 火焰抗性會將火焰附傷減半。

## 本次變更摘要：神鑄背包區補上金色外框

### index.html
- 神鑄分頁的背包容器加上 `id="forge-inv-box"`。

### css/style.css
- 金色外框樣式選擇器由 `#inv-section-box` 擴為 `#inv-section-box, #forge-inv-box`，
  神鑄背包區與裝備分頁背包區外觀一致（金色 1px 邊框、深色底、內距 12px）。

---

## 歷史變更摘要：將高塔 BOSS 戰日誌與一般戰鬥日誌分離

### index.html
- 在 `#battle-log` 下方新增一個獨立的 `#boss-log` 容器，專門用來存放高塔 BOSS 戰日誌。

### js/ui.js
- `blog`：當日誌分類為 `boss` 時，改寫入 `#boss-log` 容器，其他分類維持寫入 `#battle-log`，藉此將 BOSS 戰日誌與一般戰鬥日誌完全隔開，避免被高頻率的一般戰鬥日誌洗掉。
- `miniSnapshot`：若當前顯示的是高塔 BOSS 戰日誌，迷你監控視窗的日誌來源將自動切換為 `#boss-log`。
- 日誌篩選器事件監聽：當選擇「高塔BOSS戰」時，隱藏 `#battle-log` 並顯示 `#boss-log`；選擇其他類別時則隱藏 `#boss-log`、顯示 `#battle-log` 並套用對應的篩選樣式。

---

## 歷史變更摘要：修正 BOSS 魔塵掉落率改依「樓層」計算

### js/formula.js
- `bossDustRate` 參數由 BOSS 等級改為**樓層**：= min(30%, 2% + 樓層 × 0.2%)
  （第 1 層 2.2%、第 2 層 2.4%、第 140 層起封頂 30%；先前誤用 BOSS 顯示等級 Lv.7+5×樓層，導致第 1 層顯示 4.4%）。

### js/tower.js、js/ui.js、js/data.js
- 通關掉落判定與樓層懸停提示改傳入樓層；常數註解同步修正。

---

## 歷史變更摘要：寶石融合開放 5 階以上素材；明確融合寶石不可神鑄

### js/item.js
- `normalizeFuseMaterial`：plain 素材支援 `ref.lv`（5~10 階，省略視為 5 階向下相容）；
  數值取 `gemStatValue(type, lv)`；`leaves` 改以「5 階等值」計（2^(階級−5)），拆解成本換算維持一致。
- `consumeFuseMaterial` 依素材實際階級扣庫存；`fuseGemsV2` 的同種重複檢查改為「同種同階需 2 顆」。

### js/ui.js
- `renderGemFusion`：素材池列出 5~10 階全部一般寶石（含神鑄寶石，附階級色與能力值提示）；
  融合槽顯示實際階級；點擊委派 `data-gfuse-pick` 改帶階級參數。

### index.html
- 寶石融合面板標題改「5 階以上寶石均可，含神鑄寶石」；說明補「融合寶石無法用於神鑄法陣」。
- 神鑄面板說明補「融合寶石無法用於神鑄（可至寶石分頁進行融合）」
  （結構上本就不可：神鑄寶石頁僅列一般寶石庫存，融合寶石為獨立實體）。

---

## 歷史變更摘要：暫停合成節點與合成材料

### 功能調整
- 新增 `SYNTHESIS_ENABLED = false` 統一關閉合成節點執行、合成素材篩選與合成專用零件生成。
- 隱藏生產線合成節點與「合成素材」篩選選項；舊存檔中的合成篩選會轉為「保留」，既有資料不刪除。
- 野外、高塔及分解額外獎勵不再生成合成節點專用零件；其他分解零件與寶石、附魔書、附魔精華維持正常。
- 新增合成關閉回歸測試，並更新既有輸送帶測試以驗證掉落不會再進入合成暫存區。

## 本次變更摘要：神鑄系統支援寶石鑄造（6~10 階神鑄寶石）

### js/data.js
- 新增 `GEM_FORGE_MAX_LEVEL = 10`（6~10 階為神鑄寶石，僅能由神鑄法陣合成）；`GEM_NAMES` 擴充至十級。
- 新增 `FORGE_GEM_BASE_RATE`（五階 45%｜六階 35%｜七階 25%｜八階 15%｜九階 5%）與
  `FORGE_GEM_DUST_RATE = 3`（寶石鑄造每個魔塵 +3%）。

### js/formula.js
- `gemStatValue` 擴充：6 階起每高 1 階能力 ×2（例：五階紅寶石物攻 54 → 六階 108 → 十階 1728）。
- 新增 `forgeGemSuccessRateFor` 與 `forgeGemCost`（= 100 萬 +（階級 − 5）× 100 萬）。

### js/forge.js
- 新增法陣雙模式（裝備 / 寶石，不可混放）：`forgeMode`、`forgeGemFirst`、`forgePlaceGem`
  （限 5~9 階、六顆同種同階，放入時即自庫存扣除）；取回/全卸下歸還寶石庫存。
- `forgeRateInfo` 改回傳 `{ mode, base, dust, total, cost }`；`doForge` 增寶石分支：
  成功 → 同種高一階寶石 x1；失敗 → 損失 2 顆、退回 4 顆。

### js/item.js
- `totalGemsAll` 與 `socketGem`（自動取最高階）涵蓋 6~10 階。

### js/save.js
- 神鑄槽位遷移迴圈跳過寶石項目（`kind:'gem'` 無 name/sockets）。

### index.html
- 神鑄背包新增「🎒 裝備 / 💎 寶石」切頁按鈕；面板說明補寶石鑄造規則。

### js/ui.js
- `GEM_TIER_COLORS` 擴充 6~10 階配色；`renderForge` 支援寶石槽位/中央寶石產物/寶石費率行/
  寶石庫存網格（全部寶石列出，非 5~9 階灰階顯示，含能力值與持有數提示）。
- 事件委派新增 `data-forge-gem` 點擊放入；`initUI` 綁定切頁按鈕。
- 頂欄寶石總數/提示、裝備詳情鑲嵌選擇涵蓋 6~10 階。

### css/style.css
- 新增 `.forge-inv-tabs`（切頁按鈕，作用中金色）與 `.forge-gem-cell`（寶石格、數量角標）樣式。

---

## 歷史變更摘要：提高寶石轉換九宮格單次放入上限為 100 顆

### js/formula.js
- 將 `GEM_CONVERT_STACK` 常數的值從 `10` 提高至 `100`。

### js/item.js
- 更新 `convertGems` 函數的標頭註釋，將原上限「10 顆」文字同步修改為「100 顆」。

### index.html
- 更新寶石轉換區塊的提示說明文字，將「每格上限 10 顆」修改為「每格上限 100 顆」。

### game_formula.md
- 更新寶石轉換（九宮格）設計規格文檔，將每格上限改為 **100 顆**。

---

## 歷史變更摘要：修復裝備詳情懸停提示超出框線與裁剪問題

### js/item.js
- 將屬性洗煉按鈕 (🎲) 的懸停提示，由 CSS 內置的 `.btn-tip` 改為使用 `data-tip` 屬性，搭配 `esc()` 處理 HTML 跳脫。
- 將屬性條目 (如洗煉區間) 的懸停提示，由 CSS 內置的 `.btn-tip` 改為使用 `data-tip` 屬性。
- 以上調整使它們統一透過事件委派觸發全域的 `#sk-tooltip` (Diablo 風格懸浮框)，該懸浮框採用 `position: fixed` 與視窗邊緣溢出計算，徹底解決在滾動容器中被裁切與超出框線的問題。

### js/ui.js
- 將裝備詳情下方的「強化」按鈕懸停提示改為全域 `data-tip` 屬性，保持 UI 體驗一致性。

### css/style.css
- 移除不再使用的 `.act-btn-tooltip .btn-tip` 與 `.act-btn-tooltip:hover .btn-tip` 樣式規則，進行代碼洗滌。

---

## 歷史變更摘要：神鑄系統（Divine Forge）

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
# 本次變更摘要：補充 GM 指令中文對照

- 更新 `GM_command.md`：寶石、附魔與裝備部位 key 改為逐行列出，並補上每個 key 的中文名稱。
- 保留原有指令格式、範例與 localhost 限制，僅改善文件可讀性。
# 本次變更摘要：GM 指令支援扣除金幣與材料

- `gold`、`g`、`scrap`、`essence`、`dust` 與 `mat` 支援輸入負整數扣除資源。
- 資源扣除後最低為 0，避免產生負資源。
- 寶石、附魔書、裝備與零件仍只接受正整數，負數輸入不會發放物品。
- 新增 GM 測試覆蓋正負資源數量與物品負數拒絕行為。
# 本次變更摘要：普通關卡多敵人與範圍技能

- 普通關卡依 `78% / 15% / 5% / 2%` 機率生成 1～4 隻敵人；菁英與高塔 BOSS 固定單一敵人。
- 野外戰鬥改用敵人集合管理；每名敵人的金幣、經驗與掉落獨立結算，全部擊殺後才推進階段。
- 普攻固定攻擊第一名存活敵人，該敵人死亡後才切換下一名。
- 多敵人時技能攻擊所有存活敵人，每名敵人傷害為 `技能基礎傷害 ×（1＋範圍傷害%）÷ 敵人數量`；普攻不套用範圍傷害。
- 敵方 UI 改為 2×2 響應式敵人卡片，縮小圖示、血條與狀態資訊，並為每名敵人保留獨立傷害浮字層。
- 新增 `tests/multi-enemy.test.cjs`，擴充技能測試覆蓋多目標傷害與普攻規則。
# 本次變更摘要：敵方排版依示意圖修正

- 移除多敵人卡片自身的外框與背景，不再為每隻敵人加額外框線。
- 單敵人恢復原本的大圖示、血條與狀態資訊尺寸。
- 雙敵人改為上下排列。
- 三敵人改為上方 1 隻、下方 2 隻；四敵人維持上下各 2 隻。
# 本次變更摘要：修正敵人圖像區與戰鬥狀態不同步

- 敵人圖像區改用戰鬥引擎相同的敵人集合來源。
- `FIELD.monsters` 暫時為空但 `FIELD.monster` 仍有有效目標時，不再錯誤顯示「搜尋敵人中」。
- 新增狀態同步回歸測試。
# 本次變更摘要：同步敵方 HTML 容器

- `index.html` 敵方區改用 `mv-party` 容器，與 `js/ui.js` 的多敵人渲染邏輯一致。
- 移除舊版 `mv-emoji`、`mv-hp`、`mv-name`、`mv-status` 等單敵人固定 DOM，避免舊血條殘留。
