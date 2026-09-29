# CHAIN-FLIGHT-20260929

使用者要求電弧本身從 A 快速飛到 B；前版將整個圖集固定拉滿 A→B，僅靠圖集內部亮部移動，觀感仍像整條連線閃現。

## 完成

- `js/vfx-runtime.js`：依事件 travelMs（正常雷鏈 183ms）將短電弧本體沿已投影的 A→B 座標連續平移，同步追蹤移動目標。電弧長度不超過路徑 35%／96 顯示單位，並同比收窄，避免短段擠成電球。
- 既有圖集第 11 格抵達右緣，依 Preset fps 與 travelMs 調整播放速度；尺寸計入圖層固定 scaleOverLife。抵達後立即回收，死亡取消沿用前版。
- 無 travelMs 的舊事件保留既有連線行為，不猜測傷害抵達時間。
- `index.html` Runtime 快取 1.0.136；`tests/vfx-runtime.test.cjs` 新增實際圖集亮部質心前進、節點平移、短段寬度／厚度、反向斜線與抵達回收測試。投影測試改驗飛行路徑而非全長連線。
- 同步 `docs/AI_TASKS.md`、本報告；不修改技能傷害、Worker、素材、Preset。素材庫無本次變更。

## 驗證

`node --test --test-reporter=tap tests/vfx-runtime.test.cjs tests/skill2-lightning.test.cjs tests/lightning-vfx-lifecycle.test.cjs`：151 項，147 通過、4 項既有失敗（殞石、FIELD、CATALOG-3、STARFALL-TAIL）。以 HEAD b2ea3167 的 Runtime 與原測試唯讀重跑：150 項、146 通過，同樣 4 項失敗。

`npm run build`：402 檔通過。`git diff --check` 通過。

Edge／Playwright 隔離存檔，正式頁面 WorkerBridge 裝備七階滿級、未選超神；高血量 8 怪驗證 backend 的同一電弧節點隨幀改變 x/y，弱怪全滅後 entities/pending 與全部四個 Runtime activeEffects 歸零；兩次 pageerror 為空。保留動態幾何測試，臨時截圖／日誌清除。

檢查未修改：`js/vfx-pixi-backend.js`、`js/vfx-core.js`、`vfx/presets/bolt-chain-travel-bluewhite.json`、正式 chain-travel 圖集及作者腳本、Skills2 抵達事件。

## 交接

無本次未完成項目。表定多鏈齊發仍可能同時有多道電弧；沒有降低條數或更改使用者素材。未逐一驗收超神視覺。可合併（交付前乾跑確認），未合併／推送；提交編號見交付訊息。整合後重新載入頁面取得新快取。
