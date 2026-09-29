# CHAIN-STABLE-20260929

Owner Codex；Done。

## 完成內容

- 速度改成固定世界速度約73.77米／秒（18米／0.244秒），不再以首個敵人的距離決定整條鏈速度，修正貼身首擊後慢速爬行。
- 新雷鏈事件帶area.homingSpeed，模擬與顯示共用既有projectileHomingStep攔截幾何：每次更新納入目標移動，只走速度×經過時間，真正追上才命中。travelMs只是起飛估計，不是抵達期限。雷鳴追加打擊改為實際命中後才排程，避免敵人逃離時提前受傷。
- 飛行原點取出射時副本，不隨角色移動被拖走；18米本體保留，顯示層依飛行速度裁切進出。Core支援單一實例loop，追逐超過Preset時長也不中斷；終止時回收。
- 每条鏈都有獨立chainId。無未訪問的範圍內候選、達彈射上限、玩家死亡／換場時送lightning-chain-end，立即清除該鏈各段及剩餘尾流。途中目標死亡但仍有可接續候選時保留正常彈射；候選檢查與選敵同樣使用邊緣距離，不多消耗隨機抽樣。
- 網格裁切端點增加smoothstep寬度收束，兩端聚至軸心形成尖端；中段保持原UV／本體尺寸，不改素材。
- Worker協議v39記錄chainId、終止語意與homingSpeed；renderer終止處理在位置緩衝／死亡守門前，不因空目標或背景分頁而遺漏回收。

## 檔案

修改：js/skills2.js、js/vfx-runtime.js、js/vfx-core.js、js/vfx-pixi-backend.js、js/battle-renderer.js、js/worker/protocol.js、js/worker/sim.worker.js、js/bridge.js；index.html、tools/vfx/editor/index.html；tests/skill2-lightning.test.cjs、tests/vfx-runtime.test.cjs、tests/vfx-pixi-sheet.test.cjs、tests/lightning-vfx-lifecycle.test.cjs、tests/worker-protocol.test.cjs；docs/WORKER_PROTOCOL.md、docs/AI_TASKS.md及本報告。

唯讀：js/util.js既有追蹤幾何、js/battlefield.js選敵／距離、js/worker/shim.js事件白名單、Skills2與既有雷鏈Preset。未改配置表、其他子彈、NPC行為、圖片或素材庫。

## 驗證

- `node --test --test-name-pattern='CHAIN|WARP' tests/skill2-lightning.test.cjs tests/vfx-runtime.test.cjs tests/vfx-pixi-sheet.test.cjs tests/lightning-vfx-lifecycle.test.cjs`：20/20通過。包含近距離速度不下降、逃離超過原估時不命中、逐步距離等於速度×dt、追加打擊等追上、清場立即終止、邊緣範圍、多鏈隔離、Worker透傳、尖端幾何及UV重用。
- `node --test tests/vfx-core.test.cjs tests/vfx-pixi-sheet.test.cjs tests/skill2-lightning.test.cjs tests/skill2-chainlightning-thunder-legendary.test.cjs tests/vfx-runtime.test.cjs tests/lightning-vfx-lifecycle.test.cjs tests/vfx-preset-usage.test.cjs tests/worker-protocol.test.cjs`：363項359通過，4項與前輪相同的既有失敗（殞石落地、FIELD、CATALOG-3、STARFALL-TAIL）。
- `npm run build`：402檔通過；`git diff --check`通過。
- Edge隔離頁、正式Runtime/Core/Pixi/Preset：查看起飛尖端与完整18米电弧。目標以500單位／秒逃離、電弧400單位／秒追逐，0.9秒超過事件0.244秒估時仍存活；終止訊號立即activeEffects 1→0，pageerror=[]。

## 衝突、提交與限制

Claude正在修改renderer第444行NPC停步距離及index／bridge／sim.worker快取。本次renderer改第5270行終止入口，四檔均使用對方未提交內容做三方乾跑，結果全部exit 0。Worker新增獨立chain快取鍵，兼容NPC的版本變更，未修改對方工作區。使用者先前已授權無合併衝突即可繼續。

遊戲Commit見本報告所在提交；無素材變更，素材庫無本任務提交。可整合，未合併／推送。無未完成實作。模擬仍按既有Tick更新、畫面逐幀補間；沒有世界座標的高塔保留估時退化。未執行全超神長時間效能壓測。建議重新載入後實戰確認快速移動敵人與清場畫面。
