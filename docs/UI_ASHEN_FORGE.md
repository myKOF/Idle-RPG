# 鍛鐵 UI 交接（UI-20260907）

工作目錄：D:\MyGames\Idle-RPG\codex。分支：ai/codex。使用者參考圖：200火花.png。

## 實作

獨立 css/ashen-forge.css 在原有樣式後載入，以灰黑石材、灰鐵雕飾、淺灰標題銘牌與暗紅按鈕重製介面。保留 DOM 操作識別與 Worker 資料流程。

邊框使用真正透明 PNG，25% 九宮格切片保留完整角飾，直邊採 round 等比例平鋪，避免將短雕飾拉成細長尖刺。主框 72px、外擴 12px，另留面板間距及內容內距；裝飾層不攔截滑鼠。灰鐵面減少細碎刮痕與高反差噪點。

所有容器捲動條統一為 #777c7e，軌道 #141719；覆蓋原本局部棕色樣式。

ui-scale.js 保留均勻縮放，依視窗增加設計畫布的高度或寬度，消除固定 1920×900 畫布造成的上下黑帶。resize 與 fullscreenchange 都重新計算。較窄裝置仍延續三欄整體縮小，並非手機專用排版。

角色展示為靜態美術圖，裝備欄仍反映實際穿戴，但盔甲插畫不隨換裝改變。分解設定向上展開，避免在背包底部被裁切。

## 素材

使用內建 imagegen 生成；既有石材與鑄鐵底紋沿用專案素材。以下為生成方向摘要，非逐字 prompt：

- images/ui/ashen-forge/clean-iron-frame.png：1254×1254 RGBA；透明中央與外側、灰黑鍛鐵、清晰銀色倒角、完整四角雕飾、寬而平直的低噪點邊條，避免中段裝飾造成平鋪接縫。
- images/ui/ashen-forge/armored-knight.png：1086×1448；正面全身暗金屬騎士、精雕盔甲、象牙色布料、深色教堂背景，作為裝備展示底圖。
- images/ui/ashen-forge/title-plaque.png：1774×887；無文字淺灰舊石銘牌，供標題區裁切使用。

最終框來源為 Codex generated_images 中 exec-7891ae9b-6d70-4d33-bb39-3e5c63e9cb99.png。中央透明度已確認為 0；早期噪點較多的框不再引用、不納入交付。

## 驗證（2026-09-08）

- npm run build：324 檔語法／編譯通過。
- node --test tests/ui-fixed-canvas.test.cjs tests/equipment-detail-layout.test.cjs tests/equipment-slot-selection.test.cjs tests/equipment-selection-border.test.cjs tests/inventory-visible-rows.test.cjs tests/init-ui-smoke.test.cjs：31/31 通過。
- 獨立 Edge／Playwright 測試使用新瀏覽器資料，不操作使用者存檔。裝備詳情、tooltip、熔爐、寶石、技能、高塔、設定與分解設定可顯示；1536×864、1280×720、960×720 無頁面水平溢出，主要分頁按鈕可點擊。
- 瀏覽器 pageerror、console warning/error、HTTP 失敗均為 0。
- 16 個可捲動容器的 scrollbar-color 均為 rgb(119,124,126) rgb(20,23,25)。
- 原生 Fullscreen API 啟動後 fullscreenElement 存在，ui-shell 邊界為 [0,0,1920,1080]，完整填滿視窗。Headless 視窗會被既有 F11 偵測視為瀏覽器全螢幕，因此此項直接呼叫 Fullscreen API 驗證縮放事件；不宣稱涵蓋實體 F11 鍵。
- 驗證圖與報告放在忽略的 tmp/ui-*.png、tmp/ui-qa-report.json；未執行全專案測試套件。

預覽：http://127.0.0.1:8347。此為本機測試伺服器，不是正式部署。尚未合併 develop。

## 戰鬥區與其餘界面簡約化（2026-10-04）

使用者決定整體走簡約路線（曾試過把左側做成濃重鍛鐵風，已撤回）。
左側各分頁在 `ashen-forge.css` 內原本就是扁平卡片；新增 `css/ashen-forge-flat.css`（載入順序在 `ashen-forge.css` 之後），
把同一套語彙套到其餘還停在鍛鐵風的地方：頂列、全域按鈕與輸入欄位、戰鬥區（地圖頁籤、關卡列、畫面框、技能列、資源球、經驗條、日誌）、
各種彈窗與提示框、戰況資訊抽屜、通用卡片（`.panel`、`.log`、`.shop-card` 等）。

- 語彙定義在檔頭 `--afl-*` 變數：卡片 #121418、清單 #111317、線 1px #2a2d34／#3a3d44；選取為金（#2a2218／#7a6440／#f0cf86），主按鈕 #a8322c，警示為深底紅邊紅字。
- 不碰：左右面板共用的荊棘角飾與標題銘牌、戰鬥畫布內容、品質色／元素色／狀態色。
- 左側分頁內較具體的扁平規則（帶 id 的選擇器）權重較高，不受通用規則影響。
- 要還原：拿掉 `index.html` 中這支 CSS 的 link。

## 戰鬥區下方整合底座（2026-10-04）

新增 `css/battle-hud.css`（載入順序在 `ashen-forge-flat.css` 之後）。這一區刻意走「有質感」路線，不跟隨其餘界面的簡約風格。

- `#battle-action-dock` 擴成貼底、滿寬的一整塊金屬石板（石紋＋拉絲紋＋格紋＋上緣青銅飾條），不再與球、技能列之間留空隙。
- 血球／魔球坐在底座兩端並凸出上緣：青銅圈（多層 box-shadow 環）＋頂端寶石＋玻璃反光。
- 經驗條橫跨底座上緣：十等分刻度、中線加深、兩端圓釘、玻璃反光；填色為金色漸層。
- 技能列嵌在底座中央的凹槽，槽位換成青銅框；就緒（綠）、主動型被動（紫）、鎖定、空槽各有對應邊色。增益列貼在底座上緣之上、與技能列同寬。
- 尺寸以 `--hud-orb`（球直徑，隨戰鬥容器寬度 `cqw` 縮放）為基準，石板高度、技能列寬度由它推出。
- 只用 CSS；DOM 結構與 id 不變（`#battle-action-dock` → xp → buff → skill 的順序有測試釘住），`style.css`／`ashen-forge.css` 的舊規則不動。
- 要還原：拿掉 `index.html` 中這支 CSS 的 link（會回到 flat 版的單薄樣子）。

另：戰鬥區頁籤與關卡列的圖示改為 `js/ui.js` 內的 `UI_ICON_PATHS` 雙色線稿（見 `uiIcon`／`zoneIconHtml`），樣式在 `ashen-forge-flat.css`。
