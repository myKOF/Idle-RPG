# 野外地形障礙（2026-10-22）

## 規則（使用者定調）

- 野外戰場的大型擺件，**底座寬 ≥ 12 米（120 單位）** 才算障礙；小東西不算。門檻是 `data.js` 的 `BF_OBSTACLE_MIN_M`（米，預設 12）。
- 佔地是**橢圓**，以擺件的腳點為圓心。
- 擋什麼：**走路**（我方追擊、空場推進、敵人逼近與遊走、擊退、推擠）與**近戰普攻**（雙方；遠程敵人不受影響）。
- 不擋什麼：技能、投射物、範圍判定、飄字與特效。
- 封魔塔（魔王祭壇）沒有野外地形，不啟用。

## 檔案

| 檔案 | 職責 |
| :--- | :--- |
| `js/battle-terrain.js` | 擺件目錄 `CATALOG`、底座表 `FOOT`、區塊擺放純函式 `layoutChunk`、障礙查詢 `shapesNear`／`segmentBlocked`／`pushOut`。不依賴 PIXI、document、G。模擬 Worker 與主執行緒都載入 |
| `js/battlefield.js` | 接線：`bfTerrainSync`（每 tick 同步場景與門檻）、`bfWallBlocksMelee`／`bfPlayerCanReach`（擋近戰）、`bfTickPlayer`／`bfTickApproach`（推出障礙） |
| `js/battle-decor.js` | `buildChunk` 只負責把 `layoutChunk` 的清單變成精靈；`?obstacles=1` 把佔地橢圓畫成紅色 |
| `tests/battle-terrain.test.cjs` | TERRAIN-1～9 |

## 為什麼擺件位置放在獨立純函式

擺件原本是顯示層現場擺的，模擬層看不到。要讓「看到的岩石」就是「擋路的岩石」，位置只能由一份純函式產生，
兩邊各自呼叫、結果逐位相同（TERRAIN-3 比對顯示層精靈與清單）。種子是（區塊座標, 地圖, 階段帶），不進存檔。

## 常見調整

- **改門檻**：`data.js` 的 `BF_OBSTACLE_MIN_M`（目前不在 Excel 參數表裡，與同區的 `BF_MELEE_RANGE` 等一樣是程式預設）。
- **某種擺件擋不擋／佔地多大**：`battle-terrain.js` 的 `FOOT`。`span`＝底座寬 ÷ 圖框寬（樹冠、尖塔頂比底座寬，所以比例小）；
  `d`＝橢圓縱深 ÷ 橫寬；`legs`＝有空隙的擺件（石拱、根門）用兩條腿；`ground: true`＝地面坑洞，永遠能走。沒列的種類一律不擋。
- **新增或改了擺件表（`KITS`／`LANDMARKS`）**：`battle-terrain.js` 的 `CATALOG` 是它們前四欄（種類、權重、寬、高）的抄本，要一起改；TERRAIN-1 會比對。
- **新增地圖**：`CATALOG` 加一組（沒有的地圖會退回荒漠的組）。

## 檢查

```bash
node --test tests/battle-terrain.test.cjs tests/battle-decor.test.cjs
```

實機看佔地：網址加 `?obstacles=1`，紅色橢圓就是會擋路的範圍。`?decor=0` 只關畫面，障礙仍然存在（模擬層與顯示設定無關）。

## 已知限制

- 沿邊滑開是簡單的推出＋繞行，不是尋路。凹形地形（兩個障礙擠在一起形成口袋）不處理。
- 被拉扯（漩渦）、衝鋒這類由 `elite.js` 直接改座標的位移不檢查障礙；敵人在下一個 tick 被推出，我方則在下一次移動時被推出。
- 新障礙在換階段帶時憑空出現，剛好站在裡面的單位會被一次推出（最遠約一個半寬）。
