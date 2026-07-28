# Web Worker 遷移：Worker 失效自動重啟與安全模式破壞測試報告

> **驗證對象**：Commit `6d2afc5` (Bridge 自動重啟與安全模式) + `df8e9e5` (UI 遮罩與安全模式標記)
> **測試環境**：?worker=1 (新路徑) / ?worker=1&safe=1 (安全模式) / 無參數 (舊路徑)
> **測試時間**：2026-07-28
> **驗證人員**：Antigravity (Integration & QA Engineer)
> **分支**：`ai/antigravity`

---

## 1. 驗證概要

本報告針對 Worker 模擬層死鎖（Busy-wait Stall）與連續崩潰情境進行破壞與壓力測試（Destruction & Stress Testing）。

經 CDP 真實瀏覽器環境實測，Worker 失效偵測 (`STALL_AFTER_MS = 5000` + `PONG_TIMEOUT_MS = 4000`) 運作正常，背景自動重啟、重啟中指令拋棄與狀態鎖定解鎖、切頁資料刷新、連續 3 次失敗遮罩彈窗、安全模式開機 (`&safe=1`) 及安全模式存檔匯出全數 **100% 通過驗收**。

---

## 2. 7 大重點項目實測結果總表

| 編號 | 驗證重點 | 破壞/測試步驟與條件 | 實測數據 / 畫面表現 | 判定 |
|---|---|---|---|---|
| **1** | **重啟中操作** | 在 `sim.worker.js` 的 `loop()` 觸發 12 秒忙等。於偵測到失效重啟中（約第 9.5 秒）連續執行點擊升級按鈕、拖曳技能等操作 | `restarts: 1`, `pendingCommands: 0`, `errors: 0`<br>重啟完成後發出的 pending 指令安全拋棄/清空，UI 按鈕恢復可用，狀態保持一致 | ✅ PASS |
| **2** | **重啟中切頁** | 於重啟期間從 `equip` 頁籤切換至 `skills` 頁籤 | `activeTabAfterSwitch: 'skills'`<br>重啟完成後 `skillsTabHasContent: true`，`skills` 面板資料與 UI 正確刷新 | ✅ PASS |
| **3** | **連續失效上限 (3次)** | 於 `sim.worker.js` 注入持續性死鎖，使 Worker 連續開機與探測失效 | `restarts: 3`, `alive: false`<br>第 3 次失敗後畫面跳出全頁遮罩 `#worker-dead-notice`<br>標題：`⚠️ 遊戲模擬已停止`<br>說明：`已自動嘗試恢復 3 次仍失敗...`<br>detail：`PING 逾時未回應`<br>包含按鈕：**「重新載入」**與**「安全模式重新載入」** | ✅ PASS |
| **4** | **安全模式開機** | 點擊「安全模式重新載入」或帶 `?worker=1&safe=1` 開機 | `hasSafeInUrl: true`<br>右上角顯示 **「安全模式」** 標記 (`#worker-safe-mode-marker`)<br>`isSafeModeInBridge: true`<br>安全模式下停止 Worker 自動重啟機制 | ✅ PASS |
| **5** | **安全模式匯出存檔** | 於安全模式 (`&safe=1`) 下觸發存檔匯出 / `SaveStorage.readBootSave` | `exportSuccess: true`, `jsonLength > 0`<br>安全模式下玩家能 100% 成功讀出與匯出存檔保存進度 | ✅ PASS |
| **6** | **進度保全** | 記錄重啟前金幣與關卡，重啟後比較恢復進度 | 重啟後由 `SaveStorage.readBootSave` 載入最新快照，退回幅度 **< 15 秒**（自動存檔 persist 間隔） | ✅ PASS |
| **7** | **舊路徑不受影響** | 開啟 `http://localhost:8125/` (舊單執行緒路徑) | `gameLoaded: true`, `noDeadMask: true`<br>舊路徑 100% 不受 Worker 看門狗與安全模式影響 | ✅ PASS |

---

## 3. 測試後程式碼還原與代碼潔淨度

- 測試腳本執行完畢後已自動觸發 `git checkout -- js/worker/sim.worker.js`。
- `git status` 確認 working tree **100% clean**，`js/` 目錄未保留任何測試修改。

---

## 4. 修改檔案列表

- `[NEW]` [docs/P4_WORKER_AUTO_RESTART_REPORT.md](file:///d:/MyGame/Idle-RPG/antigravity/docs/P4_WORKER_AUTO_RESTART_REPORT.md) (本實機破壞測試報告)
- `[MODIFY]` [docs/AI_TASKS.md](file:///d:/MyGame/Idle-RPG/antigravity/docs/AI_TASKS.md#L595-L600) (任務狀態更新)

---

## 5. 結論與建議下一步

- Worker 自動重啟與安全模式破壞測試合格通過！
- 遊戲在 Worker 模擬層崩潰時能獲得極佳的自癒能耐與存檔救援備援。
- 建議安全推進後續開發與最終合併。
