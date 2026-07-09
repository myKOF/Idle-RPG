# PLAN.md — 開發計畫

## 當前任務：主畫面改造計劃

### 任務需求與設計方案
1. **戰鬥結算日誌改為隱藏與彈窗顯示**
   - 隱藏（移除）原有的右側 `#summary-area`。
   - 在 `#stage-bar` 內新增一個「結算日誌」按鈕 (`#btn-summary`)。
   - 在底層新增一個彈窗 `#summary-modal`，其中包含 `#battle-summary-list`，按下按鈕後開啟。
   - 彈窗採用 `.modal-overlay` 與固定定位，開關此介面時不會改變戰鬥區域 (`#battle-area`) 的位置。

2. **場景切換標籤樣式優化**
   - 移除標籤中的「最高」字樣，改成 `圖標 場景名稱 (最高等級數字)` 格式。
   - 在 CSS 中對 `.zone-btn` 設定 `white-space: nowrap;` 確保文字不換行。

3. **整個戰鬥區貼緊右側畫面邊界且維持原寬度**
   - 修改 `#game-layout` 的 padding，將 right padding 從 `16px` 改為 `0`。
   - 將 `#combat-area` 的 `flex: 0.92;` 改為固定寬度 `flex: 0 0 450px;`，使其寬度恢復成原本大小，不再拉伸變寬。
   - 這樣一來，整個戰鬥區會靠最右側對齊，而左側的 `#workspace-area` 會自動延伸，獲得更多可用空間。

### 微型任務拆解
1. [MODIFY] `index.html`：移除 `#summary-area`，在 `#stage-bar` 新增 `#btn-summary`，並在底部新增 `#summary-modal`。（已完成）
2. [MODIFY] `css/style.css`：變更 `#game-layout` 的 padding-right，並為 `.zone-btn` 新增 `white-space: nowrap;`。（已完成）
3. [MODIFY] `css/style.css`：將 `#combat-area` 設為固定寬度 `flex: 0 0 450px;` 以恢復原寬度。（進行中）
4. [MODIFY] `js/ui.js`：修改 `renderZoneBar` 中場景最高等級顯示格式；在 `initUI` 中綁定 `#btn-summary` 與 `#summary-modal` 的點擊與關閉事件。（已完成）
5. [VERIFY] 檢查主介面排版，驗證按鈕點擊彈窗、關閉功能，以及文字不換行的效果。

### 驗證方式
- 靜態代碼自我審查與手動在瀏覽器中運行驗證。
