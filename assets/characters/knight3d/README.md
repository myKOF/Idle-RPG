# 白銀騎士：銀盔與六動作對照（Revision 3）

任務 KNIGHT-HELMET-SIX-COMPARE-20261024（承接 KNIGHT-3D-REV2-20261023）。此目錄是待使用者審查的角色製作包，尚未接入遊戲、沒有替換 `images/sprites/knight`。第一版可由遊戲 Commit 436a6357／素材庫 2c432f8 回溯。

使用者指定：盡量復刻既有圖集的人物造型及全身動作，偏寫實、成人修長、美型；移除盾牌及刀光。原圖為主要參考，不以自創裝飾取代原造型。修正版重新查看原圖八方向及完整攻擊幀，先改回成人頭部輪廓，依最新要求再加貼合頭形的銀色sallet頭盔、窄眼縫與收尖頰甲；約7.5頭身、長腿收腰銀甲、深色腰帶及關節；保留甲片厚度、曲面、倒角與手部，不再硬壓在3,000三角面。低重心較開站姿、前傾跑步及兩種揮砍的沉身／步伐／髖胸轉動一併重作。盾牌幾何完全刪除。

## 模型與檔案

- `knight_batch1.blend`：檔名沿用穩定來源路徑，內容已為修正版；可編輯模型、16骨骼、六個 Action、預覽攝影棚。開啟後選 KNIGHT_RIG，在 Action Editor 選動作；NLA軌預設靜音，避免動作疊加。
- `knight_batch1.glb`：只含角色，排除攝影棚、燈光、攝影機；六個具名骨架動畫、兩張36×4材質色盤內嵌。
- `manifest.json`：revision=3、helmet=fitted silver sallet、shield=false、統計與六組動作的幀率／幀數。

實際統計：**9,664 三角面、4,998 Blender 多邊形、5,055 製作頂點**；匯出後因法線／UV分裂為9,556頂點。**1網格、1 primitive、1材質、16骨骼、每頂點1個骨骼權重**；GLB **653,996 bytes（約639 KiB）**。12,000三角面的製作檢查只避免非預期膨脹，並非已通過遊戲效能驗收；單primitive也不代表最終引擎包含陰影等pass時只有1 draw call。

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

本地素材庫位置由既有vfx-library-root解析；候選的四份資產及八個工具保存於codex-authored/knight3d同相對路徑，sync-library逐檔核對SHA256。未改正式角色匯出器、出貨索引、玩法、解鎖或玩家存檔。blend1／pycache不是交付物；預覽與驗證報告保存在本聊天visualizations/knight3d-helmet。

**仍待驗收**：人物造型與原圖的接近程度、動作表演細節、八方向及實際戰鬥投影／命中時序／GPU-FPS。此版本僅為修正候選，不宣稱已完成逐幀復刻或獲使用者核准。若最終使用預渲染圖集，製作模型的面數不會成為瀏覽器的即時蒙皮負擔；圖集容量、載入與實際播放成本仍須另驗。


## 六組原圖／銀盔版遊戲大小對照

本輪只加頭盔，`silver_knight_motion.py`保持前輪修正內容。頭盔替代短髮，新增266三角面；不加盾牌／刀光。

在上述build之後，改用透明渲染與新對照工具（不需先跑舊package_previews）：

```powershell
& '<Blender>' --background --factory-startup --python tools/knight3d/render_batch.py -- --model assets/characters/knight3d/knight_batch1.blend --preview '<預覽目錄>' --sprite-preview
python tools/knight3d/package_game_compare.py --preview '<預覽目錄>' --reference images/sprites/knight --battle-height 600
```

輸出`knight_revision3_helmet_six_game_compare.gif`：640×688、150幀／6秒，六組每組左原圖、右銀盔3D；原圖保留盾牌／刀光及既有陰影，3D未製作這些特效。方向SE，所有動作使用同一固定比例與腳底校正；不為每幀或每動作調整身高／位置。來源原始128格、trim及anchor由knight.json重建。以原圖SE idle第一幀alpha>245的頭到腳範圍50px，對齊Blender頭／腳骨實際投影高度286.1236px；只校正一次，不取圖集像素當模型貼圖。

大小取自遊戲manifest 1.4 × 配置鏡頭100/125=0.8，故原圖素材倍率1.12，站姿頭腳約56 CSS px（透視前）；對兩欄施加遊戲中心、上緣0.82的透視公式。採600 CSS px高一般戰鬥面板、瀏覽器／圖片100%檢視。全螢幕會額外×1.3；面板高度與實際縮放不同時，透視後像素會略不同。這是按現有遊戲公式重建的尺寸對照，尚未把3D接入實際遊戲。

完整原始15幀依各動作fps播放，方便看起手及收招；未套遊戲attack1／attack2／cast跳過前幀的事件時序。非循環動作末幀另停300ms、死亡750ms。附PNG靜態版及明標2x放大版，不能把放大版當遊戲大小。`game-comparison-validation.json`保存校正、配置、GIF讀回及限制；`sprite-projection.json`保存相機／錨點。舊package_previews的game_size為近似舊攝影棚縮圖，最新精確倍率對照以新工具為準。
