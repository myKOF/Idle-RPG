# PLAN.md — 開發計畫

## 當前任務：神鑄系統（Divine Forge）

### 一、設計方案與架構規劃（腦力激盪）

**核心機制**：新增「神鑄」頁籤。六芒星法陣六角放入 6 件同品質裝備（限傳說/神話/創世），
消耗金幣按「鑄造」：成功獲得下一品質隨機部位裝備 1 件；失敗隨機消耗 2 件、其餘退回背包。
六個角尖可放「魔塵」（新材料）各 +5% 成功率，最多 6 個。

**新品質「神鑄創世」（第 9 階，暗金）**：
- 在 `RARITIES` 末端新增 `godforged`（index 8），`mult = 10.2`（創世 6.8 × 1.5）。
  → 詞條數值與洗煉上限（`rollAffixValue` / `getAffixLimits` 皆由 mult 推導）自動達成「1.5 倍上限」需求。
- 必帶 2 條專屬特效（`godPassives`），特效池 `GODFORGE_POOL` 共 12 條（≥10 要求），
  分兩類：純屬性型（併入 `computeStats` 聚合桶）與戰鬥觸發型（掛入 `resolveHit`/`doPlayerAttack`）。
- 僅能由「6 件創世 + 鑄造成功」產生：`rollRarity` 上限 7 不變；
  熔爐品質合成/混合合成大成功之品質上限鎖定在創世（防止繞過神鑄取得）。

**數值表**：
| 素材品質 | 基礎成功率 | 金幣消耗 | 產物 |
|---|---|---|---|
| 傳說 x6 | 55% | 500 萬 | 神話 x1 |
| 神話 x6 | 40% | 200 萬 | 創世 x1 |
| 創世 x6 | 25% | 1 億 | 神鑄創世 x1 |

**魔塵掉落**：野外敵人等級 ≥150：0.1%；<150 不掉。高塔 BOSS：min(15%, 2% + BOSS等級 × 0.2%)。

**高塔挑戰金幣消耗**：100000 + BOSS等級 × 200000（BOSS等級 = 樓層對應之 BOSS 顯示等級 `bossStatsFor(floor).level`）。

**架構解耦**：鑄造邏輯獨立於新檔 `js/forge.js`（邏輯層），渲染集中於 `ui.js` 的 `renderForge`
（透過 `UI.dirty.forge` 驅動），狀態封裝於 `G.forge`，不在邏輯層直接操作 DOM。

### 二、微型任務拆解

1. [MODIFY] `js/data.js`：RARITIES 新增第 9 階；RARITY_PREFIX 補「神鑄創世的」；
   新增 `GODFORGED_IDX`、`GODFORGE_POOL`（12 條專屬特效）、神鑄常數（成功率/金幣/魔塵掉落率）。
2. [MODIFY] `js/formula.js`：新增 `godforgePassiveValue`、`towerChallengeCost`、`forgeSuccessRate` 等公式；
   `computeStats` 聚合 `godPassives`；`resolveHit` 掛入破滅/聖佑/不朽三個觸發點。
3. [MODIFY] `js/item.js`：`makeEquipment` 於 godforged 品質時骰 2 條專屬特效；
   `itemDetailHTML` 顯示專屬特效區塊；`itemScore` 計入特效加成。
4. [MODIFY] `js/factory.js`：品質合成/混合合成之「品質+1」上限鎖定創世。
5. [MODIFY] `js/combat.js`：`doPlayerAttack` 掛入天罰/萬象汲取/神怒；`rollFieldDrops` 加魔塵掉落。
6. [MODIFY] `js/tower.js`：`startTowerFight` 加金幣消耗；`endTowerFight` 勝利加魔塵掉落。
7. [ADD] `js/forge.js`：神鑄邏輯層（放入/取出/魔塵/鑄造/全卸下/成功率計算），狀態存於 `G.forge`。
8. [MODIFY] `js/player.js`：`newGameState` 增加 `player.dust` 與 `forge` 狀態。
9. [MODIFY] `js/save.js`：`migrateSave` 對 forge.slots 內裝備套用名稱/插槽修正。
10. [MODIFY] `index.html`：新增「🔯 神鑄」頁籤與 `tab-forge` 區塊（六芒星容器/按鈕/背包）；載入 `js/forge.js`；頂欄加魔塵資源顯示。
11. [MODIFY] `js/ui.js`：`renderForge`（法陣/槽位/魔塵/成功率/紀錄/背包）、`uiTick`/`switchTab` 掛 dirty、
    事件委派處理 forge 槽位/魔塵/按鈕點擊；`renderHeader` 顯示魔塵；`renderTower` 顯示挑戰費用；
    `itemCellHTML`/`renderEquip` 支援 `eff-godforged` 特效框。
12. [MODIFY] `css/style.css`：六芒星版面（背景圖/絕對定位槽位/魔塵圓鈕/中央產物/紀錄浮層/黃色按鈕）、
    `.eff-godforged` 暗金流光邊框、`.it-godpassive` 特效文字樣式。
13. [VERIFY] 以 preview 開啟頁面檢查主控台無錯誤、神鑄頁籤渲染與互動流程正確；驗證後清理除錯輸出。

### 三、驗證要點（自我審查清單）

- 舊存檔讀取：`mergeDefaults` 自動補 `player.dust` / `G.forge`；filter.actions 自動補到 9 格。
- 神鑄創世不可再入爐（品質過濾只允許 5/6/7）。
- 失敗只消耗 2 件並退回其餘 4 件；被消耗裝備上的寶石自動取回。
- 熔爐合成無法產出神鑄創世；掉落表（欄位僅 0~7）不受影響。
- 金幣不足 / 裝備不足 / 品質不符時給出明確錯誤提示且不扣資源。
