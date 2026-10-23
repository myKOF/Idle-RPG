# 白銀騎士：原圖參考修正版（Revision 2）

任務 KNIGHT-3D-REV2-20261023。此目錄是待使用者審查的角色製作包，尚未接入遊戲、沒有替換 `images/sprites/knight`。第一版可由遊戲 Commit 436a6357／素材庫 2c432f8 回溯。

使用者指定：盡量復刻既有圖集的人物造型及全身動作，偏寫實、成人修長、美型；移除盾牌及刀光。原圖為主要參考，不以自創裝飾取代原造型。修正版重新查看原圖八方向及完整攻擊幀，改回露出頭部的輪廓、約7.5頭身、長腿收腰銀甲、深色腰帶及關節；保留甲片厚度、曲面、倒角與手部，不再硬壓在3,000三角面。低重心較開站姿、前傾跑步及兩種揮砍的沉身／步伐／髖胸轉動一併重作。盾牌幾何完全刪除。

## 模型與檔案

- `knight_batch1.blend`：檔名沿用穩定來源路徑，內容已為修正版；可編輯模型、16骨骼、六個 Action、預覽攝影棚。開啟後選 KNIGHT_RIG，在 Action Editor 選動作；NLA軌預設靜音，避免動作疊加。
- `knight_batch1.glb`：只含角色，排除攝影棚、燈光、攝影機；六個具名骨架動畫、兩張36×4材質色盤內嵌。
- `manifest.json`：revision=2、shield=false、統計與六組動作的幀率／幀數。

實際統計：**9,398 三角面、4,851 Blender 多邊形、4,901 製作頂點**；匯出後因法線／UV分裂為9,398頂點。**1網格、1 primitive、1材質、16骨骼、每頂點1個骨骼權重**；GLB **644,184 bytes（約629 KiB）**。12,000三角面的製作檢查只避免非預期膨脹，並非已通過遊戲效能驗收；單primitive也不代表最終引擎包含陰影等pass時只有1 draw call。

| 動作 | 幀數／fps | 預覽週期內的動作長度 | 內容 |
| --- | --- | --- | --- |
| idle | 30 / 30 | 1秒循環 | 低重心持劍、呼吸，左手空手、拳面朝前護胸 |
| walk | 15 / 30 | 0.5秒循環 | 前傾原地跑動、髖胸反向及擺臂 |
| attack1 | 15 / 30 | 0.5秒 | 舉劍、踏步、沉身轉體橫斬、收招 |
| attack2 | 15 / 30 | 0.5秒 | 過頂起手、跨步斜劈、前傾收招 |
| cast | 15 / 30 | 0.5秒 | 蹬伸／舉劍／空手配合，無法術VFX |
| die | 30 / 30 | 1秒 | 失重倒地、手臂落地、劍身轉平 |

GLB第一至末取樣鍵的跨度為 `(frames-1)/fps`；表中的長度包含最後一個取樣的顯示時長。非循環GIF另在末幀停留300ms（攻擊／施法）或750ms（死亡）以便檢視，不寫入模型。attack3可沿用cast、rise可倒播die。本批尚未接正式遊戲的命中／釋放時序與移動速度。

## 製作與驗證

在專案根目錄執行，把 `<Blender>` 替換成安裝的blender.exe，`<預覽目錄>` 用專案外絕對路徑：

```powershell
& '<Blender>' --background --factory-startup --python tools/knight3d/build_knight.py -- --output assets/characters/knight3d --preview '<預覽目錄>' --render none
& '<Blender>' --background --factory-startup --python tools/knight3d/render_batch.py -- --model assets/characters/knight3d/knight_batch1.blend --preview '<預覽目錄>'
python tools/knight3d/package_previews.py --preview '<預覽目錄>' --reference images/sprites/knight
python tools/knight3d/validate_asset.py assets/characters/knight3d/knight_batch1.glb
node tools/knight3d/sync-library.cjs --apply
node tools/knight3d/sync-library.cjs --check
```

幾何在 `silver_knight_geometry.py`，全身姿勢在 `silver_knight_motion.py`；由build_knight統一建立、合併、綁定及輸出。姿勢以持續速度的Hermite插值、髖胸獨立完整旋轉矩陣、手腳雙骨目標、空手配重、接地停留及四元數同半球處理；依2026-10-24回饋，左手改為胸口局部座標下的護胸目標、左肘向下收放、拳面朝前並與前臂銜接，避免胸口只有位置變動卻未轉腰、每關鍵幀停住或跨符號翻轉。

`render_batch.py --validate-only` 重開模型，檢查六Action、骨架、內嵌材質、120個完整姿勢的有限矩陣及實際變形頂點最低高度；並驗攻擊有髖部／胸口旋轉、骨盆位移及步伐；待機及兩攻擊另驗左拳不朝下、與胸口前向dot>0.8、與前臂dot>0.7。結構量測不能代替人物造型與動作的原圖相似度審查。`validate_asset.py` 直接讀GLB二進位核對網格、材質、三角、時間、權重、索引與所有動畫通道。

Blender 5.2.3 LTS建立並重開；Cycles可用時使用CUDA，否則CPU。預覽含六組GIF、六格大圖、約70～80像素人物高度的小圖、24視角環繞與兩種攻擊的原圖並排。原圖欄保留原有盾牌與刀光以供參考，右欄3D沒有這些；並排顯示相近時間，不能當作每個關節都已精確一致。

## 來源、保存與限制

`images/sprites/knight`六份既有圖集與knight.json只作造型、姿勢與節奏參考；未擷取圖集像素用作新模型的貼圖或模型資產。所有幾何、色盤、骨架、動作、攝影棚均程序原創，沒有匯入第三方模型、貼圖、動畫。參考圖只出現在專案外的對照預覽。

本地素材庫位置由既有vfx-library-root解析；候選的四份資產及七個工具保存於codex-authored/knight3d同相對路徑，sync-library逐檔核對SHA256。未改正式角色匯出器、出貨索引、玩法、解鎖或玩家存檔。blend1／pycache不是交付物；預覽與驗證報告保存在本聊天visualizations/knight3d-handfix。

**仍待驗收**：人物造型與原圖的接近程度、動作表演細節、八方向及實際戰鬥投影／命中時序／GPU-FPS。此版本僅為修正候選，不宣稱已完成逐幀復刻或獲使用者核准。若最終使用預渲染圖集，製作模型的面數不會成為瀏覽器的即時蒙皮負擔；圖集容量、載入與實際播放成本仍須另驗。
