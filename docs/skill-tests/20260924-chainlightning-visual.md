# CHAIN-VISUAL-20260924：連鎖閃電彈射畫面恢復

- Owner：Codex；Done。Commit 為本文件所在提交；交由使用者整合，未合併／推送。
- 根因：Skills2 第 1 階攻擊／子彈欄空白，只剩施法與命中特效；表格事件不回退舊畫法，因此沒有彈射電弧。不能單憑回報發生時間歸因於鏡頭投影。
- Excel `Skills2!AI142` 補回既有 `bolt-chain-travel-bluewhite`，同步 CSV 與 JS。既有 Preset 外觀、素材、傷害、彈射數量與間隔均未修改。
- 起手及後續彈射事件的 `travelMs` 帶入原本浮字使用的抵達時間；Runtime 只於終點抵達時播放命中電光，不在起飛時讓起點與終點同時爆光。沿用既有移動端點追蹤及投影座標。
- 修改檔案：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`js/vfx-runtime.js`、`js/bridge.js`、`js/worker/sim.worker.js`、`index.html`、`tests/skill2-lightning.test.cjs`、`tests/vfx-runtime.test.cjs`、`docs/vfx/VFX_PRESET_USAGE_OUTSIDE_TABLES.md`、`docs/AI_TASKS.md` 及本文件。
- 唯讀檢查：`js/battle-renderer.js`、`js/vfx-core.js`、`js/vfx-pixi-backend.js`、雷鏈 Preset 與圖集、配置匯入工具、投影／透視及雷系測試。工作區既有 `vfx/presets/beam-light.json` 修改未觸碰、未納入提交。

## 驗證

- 使用 Excel 原生 API 僅改一格，正常模式儲存、重開兩次逐格驗證；與 HEAD 比對所有工作表值／樣式，僅 AI142 改值，無樣式變更，資料驗證與凍結窗格保留。
- `node tools/xlsx_to_csv.cjs`（指定 Skills2 的來源、工作表及 CSV 路徑）；`node tools/config_tables.cjs --apply Skills2 --write`；再次 `node tools/config_tables.cjs --apply Skills2` 顯示語意變更 0。
- `node --test --test-name-pattern='CHAIN|SCREEN|PERSP' tests/skill2-lightning.test.cjs tests/vfx-runtime.test.cjs tests/vfx-runtime-screen-space.test.cjs tests/battle-perspective.test.cjs`：18/18 通過。包含真技能事件的 0／300／600／900ms 彈射與 183／483／783／1083ms 抵達、投影後端點、移動目標、終點命中與回收。
- `node --test tests/skill2-lightning.test.cjs tests/skill2-chainlightning-thunder-legendary.test.cjs tests/vfx-runtime.test.cjs tests/vfx-runtime-screen-space.test.cjs tests/battle-perspective.test.cjs tests/vfx-preset-usage.test.cjs`：200 項，196 通過。四項失敗以 HEAD 的程式、配置及測試唯讀替換重跑確認相同：殞石術落地／燃燒、FIELD 分層、CATALOG-3 layout、STARFALL-TAIL。沒有新增失敗。
- `node tools/build_check.cjs`：402 檔通過；`git diff --check` 通過。
- 隔離 Edge 瀏覽器 context 載入本工作區遊戲，以三個固定目標及正式表格 Preset 經遊戲 Runtime／Pixi／場景透視播放，逐段取樣檢視。傾角比例 0.5、FOV 上緣比例 0.82；可見不同段的電弧前進，Console 零錯誤／警告。這是受控畫面驗證，未做全超神與大量敵人長時間實戰。

## 交接

- 預檢發現首頁與 Claude 的 Core 快取更新同檔不同列；使用者授權無合併衝突即可繼續，合併乾跑成功。本次沒有修改 Core 快取列。
- 無新增或修改素材，素材庫不需提交。無未完成實作；可合併。建議整合後以使用者原存檔確認連鎖閃電在密集戰鬥中的辨識度。
