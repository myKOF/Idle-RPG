# PLAN.md — 開發計畫

## 當前任務：修正存檔資料夾「自匯入」重複記錄 + 清理現有複本

### 根因（對抗式複核 CONFIRMED，六分析收斂）
1. `manualSave` 觸發**兩次**無互斥的 `syncSaveFolderNow`（開頭 `saveGame()` 內 1 次 + 結尾 1 次）；第一次的 `known` 快照擷取於「新記錄 putSaveRecord 之前」，掃描階段卻讀到第二次剛寫出的新檔 → 因不在過期 known 而被當未知檔匯入，複本沿用原檔名與原 savedAt。
2. `putSaveRecord` 只以 **id** 去重、不看 fname → 同檔名複本並存、永不折疊。
3. 修剪/刪除只移除 localStorage/index，**不刪資料夾實體檔** → 孤兒檔下次同步「復活」、刪不掉。

### 設計方案（職責分離，SSOT）
- **拆開「寫出」與「掃描匯入」**：`writeAllToFolder()`（只寫出）／`importUnknownFromFolder()`（只掃描匯入，含 fname 去重）。
- 靜默同步 `syncSaveFolder()`（每次存檔後）改為**只 writeAllToFolder，不再自我掃描匯入** → 根因 1、3 的自動觸發消失。
- 掃描匯入只在使用者主動「打開存檔資料夾」`openSaveFolder` 時做一次（單次、無並發）。
- `putSaveRecord` 修剪 + `deleteSaveRecord`：若已連接資料夾，一併 `_saveDir.removeEntry(fname)`。
- 新增 `dedupeSaveIndex()`：載入時對 index 依 fname 去重（保留 savedAt 最新一筆），清掉現有複本；main.js 載入後呼叫一次。
- `writeAllToFolder` 加 in-flight 旗標，避免並發重複寫。

### 微型任務
1. save.js：`syncSaveFolderNow` 拆成 `writeAllToFolder` + `importUnknownFromFolder`（+ fname 去重 + in-flight 旗標）。
2. save.js：`syncSaveFolder` 改為只呼叫 `writeAllToFolder`。
3. save.js：`openSaveFolder` 改為呼叫 `writeAllToFolder` + `importUnknownFromFolder`。
4. save.js：`putSaveRecord` 修剪 + `deleteSaveRecord` 一併刪資料夾實體檔。
5. save.js：新增 `dedupeSaveIndex()`。
6. main.js：載入後呼叫 `dedupeSaveIndex()`。
7. 自我審查 + 文件/記憶同步。

### 驗證方式
- 依 AI_RULES.md 第 30 條「預設不進行自測」，採靜態自我審查（第 4 條）+ 邏輯推導（去並發、匯入 fname 去重、寫出不再自掃描 → 不再自匯入）。preview 為隔離環境，不觸及使用者真實存檔。

### 收斂（第 28、37 條）
- 無新增除錯 log／未引用變數；注釋一律繁體中文。
