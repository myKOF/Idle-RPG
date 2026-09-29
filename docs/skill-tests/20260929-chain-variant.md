# CHAIN-VARIANT-20260929：換色雷鏈尺寸與回收

## 原因與修正

Runtime 原先只為 `bolt-chain-travel-bluewhite` 記錄製作寬度、讀取飛行時間及加入 trackingBeams。複製後的新 ID 落回 200 單位光束基準；其原始製作寬度是 542.464，尺寸因此錯誤。飛行事件的 homingSpeed 同時開啟 loop，但副本不在回收清單，會永久循環並在重複施放時累積。

現在每份 Preset 都登記自己的製作幾何，是否追蹤由 chain 事件決定；同一路徑處理尺寸、移動目標、固定長度裁切、抵達後尾部收入及 chainId 終止。不依檔名、名稱前綴或後綴。保留原有圖集相容資訊、一般 beam 行為與編輯器播放參數。

沒有改動新紫色特效、使用者配置表、技能數值或素材，也沒有新增特效來源。

## 修改與檢查檔案

- 修改：`js/vfx-runtime.js`、`tests/vfx-runtime.test.cjs`、`index.html`、`tools/vfx/editor/index.html`、`docs/AI_TASKS.md`、本檔。
- 檢查未改：`js/skills2.js`、`js/vfx-core.js`、`vfx/presets/bolt-chain-travel-bluewhite.json`、`vfx/presets/bolt-chain-travel-bluewhite-08.json`、`vfx/presets/bolt-chain-lightning.json`。
- 遊戲與編輯器 Runtime 快取更新為 1.0.144。

## 驗證結果

- 檔案衝突預檢通過。
- `node --test --test-reporter=tap tests/vfx-runtime.test.cjs`：114 項，110 通過、4 失敗。失敗為 FIELD、CATALOG-3、CHAIN 素材與作者工具不一致、STARFALL-TAIL；以 HEAD Runtime 覆蓋讀取重跑均能重現。
- 新增兩項 CHAIN-VARIANT 測試在 HEAD Runtime 均失敗，修正後均通過。
- 正式金色 Preset 複製、改成 `-08` 名稱及紫色後，逐幀位置／縮放／角度／壽命與原本一致。
- `-08` 與任意名稱 `custom-purple-chain`：使用 542.464 製作尺寸維持 18 米、前端實際移動、追逐超過原估時仍存活、抵達後自動回收。連續 12 次施放後按鏈 ID 終止均回到零，無累積。
- 既有移動／反向目標、延遲彈射、離場來源、透視、抵達受擊與指定鏈終止測試通過。
- `npm run build`：404 檔語法／編譯檢查通過。`git diff --check` 通過。

## 交接

任務完成，可獨立整合；測試基準仍有上述四項既有失敗。未進行新的瀏覽器實機視覺驗收。重新載入遊戲取得 Runtime 1.0.144 後，已載入的新紫色 Preset 即套用修正。既有使用者未提交檔案維持原狀，不納入本次提交。未合併／推送；Commit 見本文件的首次 Git 提交。
