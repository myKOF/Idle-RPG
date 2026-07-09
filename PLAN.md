# PLAN.md — 開發計畫

## 當前任務：主畫面改造計劃（第三階段）

### 任務需求與設計方案
1. **按鈕下移對齊**
   - 藉由給 `.equip-layout` 右側欄容器設置 `display: flex; flex-direction: column;`。
   - 使 `#detail-pane` 設置 `flex: 1; min-height: 0;`。
   - 這使得右側欄高度自動與左側裝備區（`#equip-grid`）等高，且 `#equip-action-bar` 固定位於右側欄最底部，底邊與左側 `#equip-grid` 完美貼齊。

2. **裝備詳情高度拉伸與外框隱顯**
   - `#detail-pane` 移除固定的 `420px` 高度限制，使用 `flex: 1` 填充。
   - 預設邊框設為透明，背景與陰影均為透明（未選取裝備時不顯示外框）。
   - 在 `js/ui.js` 中動態切換 `#detail-pane` 的 `.has-detail` 類。當加載裝備詳情時加上該類，渲染金色外框與暗色磨砂背景。

3. **背包區域整體下移**
   - 將 `.equip-top-layout` 的 `margin-bottom` 從 `12px` 調高至 `30px`，將下方背包推移，避開按鈕重疊。
   - 背包維持剛好 3 列展示。

### 微型任務拆解
1. [MODIFY] `css/style.css`：修改 `#detail-pane` 樣式為自適應 Flex，移出外框樣式到 `.has-detail`；調整 `.equip-top-layout` 底部外邊距；添加對 `.equip-layout > div:nth-child(2)` 的 Flex 定義。
2. [MODIFY] `js/ui.js`：在 `renderDetail()` 中選中裝備時 `pane.classList.add('has-detail')`，否則 `pane.classList.remove('has-detail')`。
3. [VERIFY] 手動在瀏覽器中運行驗證。
