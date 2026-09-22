# FIREGOD-VFX-20260922

已修正火神降臨星環發射誤帶burst-fire與ground-orbit-ring-fire，使爆炸依40米飛行線放大並疊白。

- 發射僅讀既有表定projectile；命中回呼才派送hit，包含貫穿沿途每個敵人與致死目標，未命中不播放。沒有寫死新Preset來源。
- 火焰纏身繼續由sgFireGodBody狀態派送，未改Status、Excel、素材、數值、星環數量或節拍。
- 高塔無座標時原waitForEnd會在早期tick被started狀態略過；本技能加targetOnly限於無座標，確保抵達才結算主目標。野外貫穿不變。
- 修改：js/skills2.js、index.html、js/bridge.js、js/worker/sim.worker.js、tests/firegod-vfx.test.cjs、docs/AI_TASKS.md、本報告。
- 唯讀檢查：js/vfx-runtime.js角色派送與方向縮放、proj-firehunt-ring/burst-fire/orb-firehunt素材、Skills2/Status CSV、原飛行物命中排程。
- 驗證：node --test tests/firegod-vfx.test.cjs tests/skills2-vfx-schema.test.cjs（9/9）；node tools/build_check.cjs（397檔通過）；git diff --check。最後targetOnly小修正由專項測試載入並驗證。
- 未瀏覽器實戰截圖驗證；无新增素材、無素材庫修改。無未完成實作，可合併；未合併／推送。Commit為包含此報告的提交。
