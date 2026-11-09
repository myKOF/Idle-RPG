# 遺物系統（2026-11-09）

遺物是**永久生效、不需裝備**的被動效果，全部由寶箱開出（寶箱另外實作）。每件遺物 10 級，
同名遺物重複取得會累積件數，件數足夠時在遺物頁按「升級」。

## 資料流

```
config/Excel/Relics.xlsx（使用者編輯）
  → 套用參數.bat：xlsx → config/CSV/Relics.csv → tools/config_tables.cjs（SCHEMAS.Relics）
  → js/relic_data.js 的 RELICS（兩端共載）
```

一列＝一件遺物的一個等級。欄位：編號、名稱、分類、效果鍵、等級、升級數量、數值強度、效果說明。
欄位說明寫在 Relics.xlsx 的「欄位說明」頁。效果說明可寫 `{v}` 代入數值強度。

## 程式

| 檔案 | 內容 |
|---|---|
| `js/relic.js` | 兩端共載。`relicValue(效果鍵)` 是**唯一**的讀值入口；`relicGrant`／`relicUpgrade`（Worker）；晨鐘計時；寶箱介面 |
| `js/ui-relic.js` | 遺物頁（主執行緒），只讀 header 面板 |
| `css/relic.css` | 遺物頁樣式 |
| `images/ui/enamel-nav/relics.png` | 頁籤圖示（以 runes.png 的金框程序化繪製，可直接換成正式美術） |

- 存檔：`G.player.relics = { 編號: { lv, n } }`、`G.player.relicReturnUntil`（晨鐘到期毫秒）。舊存檔由 mergeDefaults 補空。
- 主執行緒沒有 `G`，`relicStore()` 改讀 header 面板的 `player.relics`，所以強化碎片、洗煉精華、背包上限／費用、商人售價、封魔塔限時在介面上顯示的數字與 Worker 扣款同一支函式。
- 協議 v77：新增 `relic.upgrade({relicId})`。
- GM：`relic 編號|all [數量]`、`relic max`、`relic reset`（見 GM_command.md）。

## 寶箱介面（給寶箱實作者）

```js
relicGrant(id, n)               // 給 n 件；未解鎖時自動解鎖 Lv.1。回傳給了幾件
relicRandomId()                 // 等機率抽一件遺物的編號
relicChestSpeedMult()           // 幸運寶箱：寶箱累積速度倍率（1＝原速）
relicChestRelicChanceMult()     // 幸運符：開出遺物機率倍率（與原機率相乘）
relicChestDoubleChance()        // 雙開戒：雙份獎勵機率（%）
```

## 效果接線一覽

| # | 遺物 | 效果鍵 | 接線位置 |
|---|---|---|---|
| 1 | 長夜沙漏 | offlineHours | save.js 離線上限 |
| 2 | 夜班熔爐 | offlineXp | save.js 離線經驗另乘 |
| 3 | 夢境捕手 | offlineEquipDrop | save.js 離線裝備掉落率另乘（寶石、材料不受影響） |
| 4 | 晨鐘 | returnBuffMinutes | save.js 離線結算時開始計時；formula.js computeStats 經驗與掉寶 +10%（直接加在最終值） |
| 5 | 星圖殘頁 | offlineTowerReward | save.js → tower.js `grantTowerBossRewards`（已通關最高層、非首通） |
| 6～9, 11 | 熔爐拆解 | salvage* | factory.js doSalvage（碎片、寶石機率、經驗與熔爐零件相加；精華、金幣另乘） |
| 10 | 蓄能瓶 | synthBuffer | formula.js synthBufCap |
| 12, 13 | 背包 | inventoryMax／inventoryExpandDiscount | formula.js inventoryExpandMax／inventoryExpandCost |
| 14～18 | 神祕商人 | merchant* | item.js 供應器與 merchantItemPrice；tower.js 邀請券掉落 |
| 19～22 | 寶石／符文 | *ComposeSave／runeDismantleBonus／runeEraseKeep | item.js composeGems；runeword.js |
| 23, 24 | 洗煉／強化 | rerollEssenceDiscount／upgradeScrapDiscount | formula.js rerollCost／upgradeCost |
| 25 | 強化槌 | upgradeDouble | factory.js tryUpgrade（成功時再 +1，不另扣費） |
| 26 | 精煉神石 | forgeDustRefund | forge.js doForge（只限消耗神性之石的模式） |
| 27 | 神賜之戒 | imprintLegendary | forge.js forgeApplyImprint（傳奇特效權重另乘） |
| 28 | 急行令 | towerAutoSpeed | sim.worker.js simStep 額外推進塔戰；ui.js 連續挑戰結算倒數縮短 |
| 29 | 封魔令 | towerBossTime | data.js towerTimeLimitWithTalents |
| 30～32 | 寶箱 | chest* | 寶箱系統另外實作 |

新增效果：在 `js/relic.js` 的 `RELIC_EFFECT_KEYS` 與 `tools/config_tables.cjs` 的同名清單加鍵、在讀取點呼叫 `relicValue`，
`tests/relics.test.cjs` 會檢查兩份清單一致、每個鍵都有遺物也都有讀取點。

## 已知限制

- 急行令不加速登場轉場（黑圈 2.4 秒與主執行緒動畫綁定），只加速戰鬥與場間倒數。
- 符文合成成功的日誌仍寫「消耗 3 顆」，刻工鑿觸發時實際少扣一顆。
- 頁籤圖示是程序化繪製的暫用圖。
