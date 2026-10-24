# 白銀騎士：靜態造型候選 R5

任務 `KNIGHT-LOOKDEV-STATIC-R5-20261024`。使用者要求先修造型與手肩、確認後才繼續動作。本輪以原圖idle八方向重新檢視胸肩、腰胯、四肢及甲片層次，保留銀盔，只交付真實Blender模型的放大靜態對照。

**本輪沒有修改六組動作。** 上層`knight_batch1.blend`／`.glb`／`manifest.json`仍是R4候選；`silver_knight_geometry.py`及`silver_knight_motion.py`也保持原樣。R5在獨立`lookdev-r5/`，不得把上層舊檔誤認為這輪造型。

## R5檔案與範圍

- `lookdev-r5/knight_lookdev.blend`：可編輯靜態模型，17骨骼（16根基礎骨＋獨立weapon.R握劍骨），沒有Action；保留建模用綁定與攝影棚。
- `lookdev-r5/knight_lookdev.glb`：供檢視的已變形靜態網格；沒有skin或animation，避免一般glTF檢視器把沒有動畫的骨架重設為原始姿勢。不是可直接替換遊戲六動作的成品。
- `lookdev-r5/manifest.json`：revision=5、staticGlb=true、clips為空、數量及造型狀態。

R5共**8,830三角面、4,238製作多邊形、4,645製作頂點**，單網格／primitive／材質，兩張36×4自製內嵌色盤；靜態GLB **284,832 bytes**。目前尚未做實機戰鬥FPS驗收，不能把此靜態匯出成本當作未來有動畫角色的成本。

## 造型與靜態展示姿勢

肩甲降低、縮窄為貼合鎖骨斜度的上片及外臂小覆片，沒有把整個肩甲撐到頭盔旁。胸甲重塑為有胸腹起伏的弧面、收腰下腹甲，布料／腰帶與銀甲分層；腰胯改較平、收尖的雙片覆甲，避免圓形插槽與一串等寬白色橫條。四肢甲片跟隨粗細變化，肘後用小範圍布料連接，保留原有腿部站姿與足甲基礎。頭盔保留，靜態展示時縮短外露頸部距離。

舊版手部問題不只是位置：它把持劍的刀身朝向當成手骨方向，令手腕為了舉劍而折轉。R5讓兩手腕順著前臂，獨立weapon.R再把劍放進拳心；刀身軸與手腕軸近乎垂直。上臂自然向下，空手放在腰側，不再把兩臂擠成胸前X形。這只是本次造型審查的靜態展示姿勢，未製作新的待機或攻擊動畫。

銀甲採較克制的反光，胸甲使用較深的磨亮銀色；深色布衣與棕色腰帶提供材質層次。所有幾何、材質色盤及姿勢均自製；原圖只作參考及對照，不取圖集像素當模型貼圖。

## 重製／渲染／靜態對照

在遊戲專案根目錄執行，`<Blender>`換成blender.exe，`<預覽目錄>`採專案外絕對路徑：

```powershell
& '<Blender>' --background --factory-startup --python tools/knight3d/build_knight.py -- --lookdev --output assets/characters/knight3d/lookdev-r5 --preview '<預覽目錄>' --render none
& '<Blender>' --background --factory-startup --python tools/knight3d/render_lookdev.py -- --model assets/characters/knight3d/lookdev-r5/knight_lookdev.blend --preview '<預覽目錄>'
python tools/knight3d/package_lookdev.py --preview '<預覽目錄>'
node tools/knight3d/sync-library.cjs --apply
node tools/knight3d/sync-library.cjs --check
```

`--lookdev`必須用獨立輸出資料夾；工具會拒絕含舊knight_batch1.blend的目錄，以免覆蓋動畫包。造型在silver_knight_lookdev.py，既有幾何先提供保留的頭盔／手足／劍基礎，再替換胸肩腰胯及四肢甲片。render_lookdev重開實際成品，只渲染四張靜態視角，沒有動畫播放。

預覽保存在本聊天visualizations/knight3d-lookdev-r5：

- `knight_r5_original_static_compare.png`：1100×760，每欄左原圖SE idle第1幀、右真實Blender渲染；兩邊頭到腳統一放大至500px，沒有分別拉伸胸肩或四肢。
- `knight_r5_upperbody_compare.png`：胸肩／手臂／腰胯近看。
- `knight_r5_static_views.png`：正／側／背面，固定模型比例，完整顯示頭盔與腳。

原圖是原始像素放大，未補畫不存在的細節，保留舊盾牌；新版沒有盾牌／刀光。靜態對照用低透明接地陰影協助閱讀，僅在預覽合成，不寫入模型或遊戲特效。此輪是**放大造型審查**，不是遊戲1:1大小預覽；不以視覺放大宣稱已整合遊戲。

## 驗證、保存與限制

Blender重開檢查17骨骼、零Action、有限矩陣與最低變形頂點；兩手腕軸與前臂dot>0.999，上臂往下dot>0.6，劍軸與手腕軸近乎垂直，握點可達。package_lookdev直接讀GLB，核對單mesh／primitive／material、<12k三角、零skin／animation及圖片無邊界裁切；檢查舊動畫兩個二進位檔與Git逐位元一致、原metadata語意及動作／幾何來源不變。

另在臨時目錄重跑預設R4匯出：六動畫、位置／UV／權重／骨索引資料完全相同，有向三角集合相同；Blender非決定性三角排列與兩個法線浮點有微小差異（最大8.72e-5），未用整個GLB位元一致誤報回歸。原交付檔未改。驗證報告static-validation／static-package-validation／default-export-regression保存在預覽目錄。

舊R4包與新R5包及工具共18檔同步保存於素材庫codex-authored/knight3d同相對路徑，逐檔SHA核對；新候選與原包可各自回溯。預覽／日誌不入兩庫，blend1／pycache不交付。使用者指定Blender三維造型，非RPG Mote點陣繪製；未引入第三方模型／貼圖／動畫。

**待驗收**：胸肩、腰胯、四肢的造型接近度與層次仍由使用者檢視；結構量測不代表美術已核准，也未宣稱消除所有甲片互穿。造型確認前不繼續調動作。尚未替換正式角色、重綁六動作、調整八向／命中或實測戰鬥效能。舊R4製作與六動作說明可由遊戲Commit 7b6c431／素材庫bd1394e的README回溯。
