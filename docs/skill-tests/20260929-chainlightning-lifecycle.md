# CHAIN-LIFECYCLE-20260929

連鎖閃電畫面延後，但原先在施放當下已把全鏈傷害結算。弱怪先死亡後，端點消失，留下晚到的命中電光與地板光環；前次配置修正並未處理這個實戰時序。

## 完成內容

- 沿用既有抵達佇列，在 183、483、783、1083 ms 等抵達點逐段結算。雷鳴追加傷害、擴散與過載跟隨命中；飛行事件不預播命中。
- 抵達前檢查玩家、目標生命與目前敵人清單，取消死亡、換場／離場目標。
- Renderer 不再為雷鏈額外加位置緩衝；只檢查彈射終點，保留由剛死亡來源往存活終點的彈射。
- Runtime 取消已死亡目標的待播與播放中特效，包含配置的地板光環。未更動 Preset、圖集、技能配置數值或新增特效來源。
- 更新頁面與 Worker 快取。

## 修改檔案

`js/skills2.js`、`js/vfx-runtime.js`、`js/battle-renderer.js`、`js/bridge.js`、`js/worker/sim.worker.js`、`index.html`；四份測試：`skill2-lightning`、`skill2-chainlightning-thunder-legendary`、`vfx-runtime`、`lightning-vfx-lifecycle`；`docs/AI_TASKS.md` 與本報告。

檢查未修改：`js/vfx-core.js`、`js/vfx-pixi-backend.js`、`js/gm_exec.js`、`vfx/presets/bolt-chain-travel-bluewhite.json`、Skills2 配置、投影／透視測試。

## 驗證

- `node --test --test-reporter=tap tests/skill2-lightning.test.cjs tests/skill2-chainlightning-thunder-legendary.test.cjs tests/vfx-runtime.test.cjs`：168 項，164 通過；4 項既有失敗（殞石結算、FIELD、CATALOG-3、STARFALL-TAIL）。
- `node --test --test-reporter=tap tests/lightning-vfx-lifecycle.test.cjs tests/battle-perspective.test.cjs tests/battle-ground-projection.test.cjs tests/vfx-projectile-perspective.test.cjs tests/vfx-pixi-sheet.test.cjs`：40 項，39 通過；既有 PROJ-9 測試 fixture 缺少 projectBillboardTransform。
- `node --test --test-reporter=tap tests/skill2-ice.test.cjs tests/skill2-ult-evolution.test.cjs tests/skill2-system.test.cjs`：142 項，96 通過，46 項既有失敗。
- 以上失敗皆透過唯讀載入原 HEAD `ad3ee70e` 的程式／原測試重跑比對，失敗名稱完全相同；沒有放寬傷害數值斷言。
- `npm run build`：402 檔通過。`git diff --check` 通過。
- Edge／Playwright 新建隔離瀏覽器，從正式頁面與 WorkerBridge GM 指令裝備七階滿級雷鏈，未選超神。8 隻高血怪：收到 lightning-chain / lightning-chain-hit 事件，含 70 則兩端彈射事件（包含 renderer 延後重入記錄），正式 chain-travel 圖集實際更新 frame 0～11，長度／角度依端點改變。截圖僅輔助，動態數據來自真實 backend。
- 8 隻弱怪：有電弧動畫；全滅後 entities=0、pending=0、grounds=0，fx/zone/air/billboard 的 activeEffects / activeParticles 全為 0。兩次實戰 pageerror 皆空。

## 風險與交接

- 本次修正正常雷鏈抵達時序。未選超神的使用者情境已測；超神數值回歸有跑，但未逐一進行超神實機視覺驗收。
- 密集怪群及七階多鏈本來會同時產生多道特效；不改表定條數或使用者 Preset 外觀。
- 全專案測試不是全綠，以上 51 項原有失敗不屬本次修復範圍。
- 無本任務未完成項目。提交編號以交付訊息為準；建議整合後重新載入頁面套用新 Worker 快取，使用現有角色確認體感。未合併或推送其他分支。
