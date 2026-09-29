# VFX-STALE-GUARD-20260929

## 完成內容

Claude合併後預檢無衝突，補齊前兩輪快取：遊戲Core=20260929-shape-refresh、Pixi backend=20260929-wave-mesh；遊戲與編輯器Runtime均1.0.148，DATA_VERSION=20260929-chain-shape-refresh。

編輯器載入時固定取得程式內容雜湊版本，之後不會偷偷換成新版token。每15秒及取得焦點時检查版本；程式更新／後端過期時出現重啟提示，保留文件和Undo，不自動刷新。提示提供全部視窗的Preset及layout JSON備份下載。

所有Preset、layout PUT及重新命名均需目前程式版本與載入時的檔案內容雜湊。伺服器在同步寫入前比較主檔和配對檔，舊分頁沒帶條件也回409，不允許用舊內容覆蓋。另存既有檔案在明確確認後讀取目標基準，真正寫入前仍重比；新檔建立競爭、改名來源／目標競爭同樣拒絕。存檔失敗不清掉編輯内容；已寫入但素材同步失敗時更新磁碟基準供重試。

## 修改及檢查範圍

修改：index.html、js/vfx-runtime.js（僅資料版本）、tools/vfx/editor/index.html、editor.js、save-guard.js；tools/vfx/editor-server.cjs、editor-guard.cjs；tests/vfx-editor-guard.test.cjs、vfx-editor-save／rename／layers測試與helpers/vfx-write-headers.cjs；docs/AI_TASKS.md及本文件。

檢查但未改：AI_RULES.md、docs/AI_WORKFLOW.md、js/vfx-core.js、js/vfx-pixi-backend.js、Preset／layout與素材庫狀態、test_server_manager.cjs。使用者同期修改的CSV、Excel、data／formula／skills2不納入本次。沒有新增或修改正式素材，素材庫無變更。

## 驗證

- node --test tests/vfx-core.test.cjs tests/vfx-deformation.test.cjs tests/vfx-pixi-sheet.test.cjs tests/vfx-editor-code-controls.test.cjs tests/vfx-editor-guard.test.cjs：183項全過（其後另加備份內容測試，guard單檔7項全過）。
- node --test --test-reporter=tap "tests/vfx-editor*.test.cjs"：405項，401通過、3項既有失敗、1略過。既有失敗為CAP-2粒子scale假設、HISTORY-42素材增大導致記憶體門檻、金色雷鏈Preset canonical欄位排序；這些Core／素材與相關斷言本次未更動。其後增加的備份內容測試另驗通過。
- npm run build：398檔通過；git diff --check通過。
- 真實瀏覽器：載入金色雷鏈，把12次／秒改成13（僅測試分頁未存檔）；更新editor.js後出現重啟提示。Ctrl+S顯示「版本已過期」「repo檔案未變動」，13及未存檔標記仍在。磁碟Preset保持原樣，最後Undo並關閉測試分頁。Console未見錯誤。
- 備份內容VM測試檢查多分頁Preset與layout及未存值；In-app browser下載事件等待逾時，沒有宣稱實機下載檔案已驗收。實機提示／拒絕存檔畫面位於 C:/Users/user/.codex/visualizations/2026/09/24/01a0d26b-351c-7622-a122-bc699c805f4e/vfx-stale-guard.png。

## 使用及限制

第一次套用必須先保留舊分頁未存工作（既有「下載複本」可下載Preset），再重新啟動VFX編輯器伺服器及重開編輯器；已在記憶體中執行的舊伺服器無法憑磁碟更新自動獲得新防護。新版後，過期分頁存檔將由伺服器硬性拒絕。

備份為含documents陣列的JSON包，保留每份preset與layout；不是自動合併，也不會自動覆蓋任何檔案。外部程式若恰在最後檢查與檔案替換之間寫檔，仍有本機檔案系統條件寫入的極短競爭窗；本伺服器收到的HTTP寫入以同步比對／落檔序列化，已測兩分頁競爭只一個成功。

任務完成，可審查合併；未自行合併或推送。提交編號見本文件首次提交。遊戲中完整低速飛行視覺效果未在本輪重新驗收。
