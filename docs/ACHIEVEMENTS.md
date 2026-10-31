# 成就系統

2026-10-31 新增。入口：Esc 遊戲菜單 →「成就」（與設置同級，開著時遊戲維持暫停，返回回到菜單）。沒有獎勵機制，達成即永久保留。

## 資料流

```
config/Excel/Achievement.xlsx      ← 唯一來源（Excel 維護；AI 一律用 tools/excel-update-sheets.ps1 寫入）
   │  套用參數.bat（config_tables --sync → CSV；--apply --write）
   ▼
config/CSV/Achievement.csv
   ▼
js/achievement_data.js             ← 自動產生的 ACHIEVEMENTS，勿手改（兩端共載）
   │
   ├─ js/achievements.js           Worker 端：判定、累計統計、achv 面板投影（sim.worker.js importScripts）
   └─ js/ui-achievements.js        主執行緒：成就頁、解鎖提示（讀 achv 面板快照，不碰 G）
```

表格欄位：編號／名稱／圖示（`images/achievements/<圖示>.png`）／達成條件（顯示文字）／目標類型／目標參數／目標數量。
顯示文字（名稱、達成條件）來自配置表儲存格，不走 String 表；頁面上的固定文字（按鈕、篩選、進度）是 String 2227～2236。

## 目標類型（判定函式 `achProgress`）

| 類型 | 參數 | 進度 |
|---|---|---|
| equipFull | 最低品質編號 | 目前套中達標的部位數（目標 13；神鑄神話以神話計） |
| level | — | 歷史最高等級（轉生過＝已達轉生等級） |
| enhanceLevel | — | 擁有裝備（三套穿戴＋背包）中最高強化 |
| ancientEquipped / socketEquipped | — | 身上太古詞條數／鑲嵌寶石數 |
| rerollCount / upgradeCount | — | `G.factory.stats.rerolled` / `upgraded` |
| gemLevel / gemAllTypes / gemDivine | — | 最高寶石階／各開放種類是否都有 10 階／神級寶石數 |
| godEquip / dualLegend | — | 擁有神鑄品質裝備／同時帶兩個傳奇特效的裝備數 |
| ancientCast / imprintCount / divineConsumed | — | 累計統計：太古精鑄成功、神聖刻印成功（無效果不計）、裝備神鑄消耗件數 |
| forgePartsMax | — | 熔爐零件達最高階的種類數 |
| goldTotal | — | 累計獲得金幣（擊殺、熔爐分解、離線收益、任務獎勵） |
| runewordActive / runewordDistinct / runewordTier | —／—／最低階 | 身上不同符文真言數／其中達階的數量 |
| runeMade | 符文 id | 做出過（合成）該符文，或目前持有 |
| reincarnation / towerFloor / monsterPower | — | 轉生次數／封魔塔最高層／100＋威能威脅% |
| skillUlt | `群組ID:超神ID` | 選中該超神時的等級（需 10 級） |

判定每 1 遊戲秒掃一次未達成項（`achTick`），達成即寫入 `G.achv.got[編號]`（時間戳）並送 `notice/achievementUnlocked` 事件；
條件之後消失（拆裝備、換技能、轉生）也不會撤銷。累計統計存 `G.achv.st`（gold／ancientCast／imprint／divineConsumed／runeMade／maxLevel）。

## 新增成就

1. 在 Excel 最後新增一列（編號接續、圖示填 `ach_NNN`、目標類型／參數／數量）；類型必須是上表之一，否則套用會中止並指出格位。
2. `images/achievements/ach_NNN.png` 放 128×128 圖；沒有圖時頁面只是空白框，不會壞。
3. 新的判定類型：在 `achProgress` 加 case，並把類型名加進 `tools/config_tables.cjs` 的 `ACH_TYPES`。
4. 圖示重畫後把 `js/ui-achievements.js` 的 `ACH_ICON_VER` +1。

## 已知設定備註

- 表上第 52、103、114、115 列原文的技能名有重複或舊名（飛刀-暴雨梨花重複、水流彈-深淵葬界、真空斬-天穹崩裂／森羅萬象實為暴風屏障的超神），已依 Skills2 表改正。
- Skills2 的「泥沼術」三個超神（惡疫魔沼／深淵火獄／黃泉沼）尚無對應成就列；要加就在 Excel 新增三列 `skillUlt`，參數 `mire:plagueMire`、`mire:abyssInferno`、`mire:netherMire`。
- 兩個成就名稱相同（風刃的「天穹崩裂」與暴風屏障的「天穹崩裂」，技能表本身就同名），以達成條件文字區分。
