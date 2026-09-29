# CHAIN-TRAIN-20260929

Owner：Codex；Done。

固定18米金色電弧沿用落雷主弧造型，採本體平移及UV／網格同步裁切。起飛從來源逐步露出，命中後尾部繼續收入落點；在下一段開始時前段仍可存在。固定縮放避免沿飛行進度拉伸。測試明確驗證轉折後前段10米＋後段8米。

首段366ms改244ms（速度+50%），同一鏈依首段距離建立速度，後續以距離／同一速度計算飛行時間，使跨段尾流總長一致。命中、追加傷害與飛行共用事件travelMs；lineLength=bfMeterPx(18)經既有Worker白名單傳送，無新增協議欄位。命中回呼立即選下一名存活敵人，沒有新增彈射等待；仍保留表定彈射次數、範圍與不重複目標。

使用者追加截圖：第6階雷幻身繼承 aura-lightning-relay，原Runtime在lightning-chain-hit特例追加ground／field，因此即使飛行本體已重做，命中處仍有舊地面電團。移除該特例，命中事件與其他技能一致只播hit，飛行事件不播地面層；hit-lightning短促受擊保留。未改共用素材及其他技能配置。

## 修改與唯讀檢查

修改：js/skills2.js（只提交連鎖飛行邏輯）、js/vfx-runtime.js、js/vfx-core.js、js/vfx-pixi-backend.js；index.html、js/bridge.js、js/worker/sim.worker.js、tools/vfx/editor/index.html快取；tests/skill2-lightning.test.cjs、tests/vfx-runtime.test.cjs、tests/vfx-pixi-sheet.test.cjs；AI_TASKS及本報告。

唯讀：battlefield、battle-renderer投影／事件接線、worker/shim與protocol、Skills2配置、原落雷／雷鏈／hit-lightning／aura-lightning-relay Preset、雷鏈製作腳本。保留使用者未提交的Skills2表與JS資料列、NPC Excel、beam-light、magic_03刪除及shipped-assets。

Core新增可選clipX變形座標範圍，僅用於變形網格。Pixi保存原UV，邊界頂點與UV一起裁切，內部texel尺寸不變，取消裁切恢復原網格；沒有額外遮罩或RenderTexture。

## 驗證

`node --test tests/vfx-core.test.cjs tests/vfx-pixi-sheet.test.cjs tests/skill2-lightning.test.cjs tests/skill2-chainlightning-thunder-legendary.test.cjs tests/vfx-runtime.test.cjs tests/lightning-vfx-lifecycle.test.cjs tests/vfx-preset-usage.test.cjs`

348項，344通過，4項與上一輪相同的既有失敗：殞石落地、FIELD、CATALOG-3、STARFALL-TAIL；連鎖及新增UV裁切／重用測試全通過。包括傷害抵達前不觸發、致死後接續、投影下18米固定尺寸、頭尾裁切、10＋8米轉折重疊、全部回收及不再疊播地面電團。

`npm run build`：402檔通過。`git diff --check`通過。

Edge隔離頁使用正式Runtime／Core／Pixi／Preset，檢視出射與轉折畫面：未拉伸，兩段同時存在，金色主弧與分岔保留；尾流結束activeEffects=0，pageerror=[]。非整場高階多鏈效能壓力測試。

## 交付

無新增或修改素材，素材庫無本任務變更，不建空Commit。遊戲Commit見本紀錄所在提交。實際模擬命中仍受既有Tick精度限制；0秒指同一命中回呼立即發下一段，沒有額外等待。無未完成實作；可供整合，未合併／推送。重新載入頁面套用快取，建議實戰確認多目標轉折觀感。
