# BATTLE-ORBS-20260923｜戰鬥圓瓶資源列

- Owner：Codex。完成戰鬥 HUD 改造；可交由使用者合併，未合併／推送。
- 左下紅色生命圓瓶，淡藍半透明護盾獨立液面覆蓋；右下藍色法力圓瓶。瓶上無數字，沿既有 tooltip 顯示完整即時值，支援鍵盤聚焦。
- 移除 Pixi 角色腳下的資源條與數字，保留復活倒數。圓瓶由既有 Header 更新流程讀 TICK 視圖，護盾容量讀 battle panel；不修改模擬與協議。
- 戰鬥技能列讀 LOADOUT_SIZE.max（使用者已改為六格），中央上方增加金色經驗條，buff 依中央區塊高度往上排列；樣式隨戰鬥區縮放。
- 使用者明確選擇「這次只改 HUD，舊存檔之後處理」：沒有新增存檔遷移，也沒有修改技能管理頁與技能運作。已經完成舊遷移、且仍裝備第 7～10 格的存檔，超額技能可能繼續生效但不顯示在新版戰鬥列；留待後續處理。

## 修改與檢查

- 修改：`index.html`、`css/ashen-forge.css`、`js/ui.js`、`js/battle-renderer.js`、`js/bridge.js`、`js/worker/sim.worker.js`、`docs/AI_TASKS.md`、本文件。
- 測試：新增 `tests/battle-resource-orbs.test.cjs`；更新 `tests/player-shield-bar.test.cjs`、`tests/player-event-float.test.cjs`、`tests/skill-loadout.test.cjs`、`tests/loadout-cap-clamp-migration.test.cjs`。
- 一併保存使用者已修改的 `config/Excel/game_parameters.xlsx`、`config/CSV/game_parameters.csv`、`js/formula.js`：技能格上限 10 → 6，本輪未另外改寫這三份檔案。主頁與 Worker 公式快取同步。
- 唯讀檢查：`AI_RULES.md`、`AGENTS.md`、`docs/AI_WORKFLOW.md`、`prompts/codex.md`、`css/style.css`、`js/save.js`、`js/skills.js`、`js/skills2.js`、相關投影／tooltip／UI 效能測試與本地伺服器工具。
- 無素材新增或修改，素材庫無需提交。

## 驗證

```powershell
node --test tests/battle-resource-orbs.test.cjs tests/battle-skill-hover.test.cjs tests/player-shield-bar.test.cjs tests/player-event-float.test.cjs tests/skill-loadout.test.cjs tests/loadout-cap-clamp-migration.test.cjs tests/battle-ground-projection.test.cjs tests/ui-performance.test.cjs tests/resource-tooltip.test.cjs
node tools/apply_params.cjs
node tools/build_check.cjs
git diff --check
```

- 68/68 測試通過；包括部分／空液面、護盾超過最大生命仍按護盾容量下降、快照不改寫、tooltip 更新順序與六格配置。
- apply_params：554 個參數一致、將變更 0、錨點問題 0；未更改參數接線。
- build：400 檔通過；diff check 通過。
- 瀏覽器實戰：1600×900 與 1024×768，六格技能、紅藍瓶、護盾消耗、經驗與 buff 位置；法力 tooltip 保持開啟時從 136/166 更新到 54/166，與圓瓶資料一致。無角色腳下舊條。
- 一般 Python HTTP server 在多資源載入時兩次出現 importScripts NetworkError，Worker 自動恢復。提高測試伺服器連線佇列容量後於 8337 重新載入，Worker／Canvas 正常、無新增 Console error 或 warning。
- 原 `?canvas=0`／WebGL 不可用的 DOM 後備畫面與高塔維持原設計。本輪未改存檔，也未執行長時間戰鬥壓測。

## 交付

- 遊戲 Commit：本文件所在提交（可用 `git log -1 -- docs/skill-tests/20260923-battle-orbs.md` 查詢）。
- 本次 HUD 無未完成項目；舊存檔超額技能依使用者要求延後。
- 建議下一步：使用者於正式存檔確認圓瓶尺寸／護盾辨識度，之後另行處理六格存檔遷移。
