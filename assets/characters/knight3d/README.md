# 白銀騎士：盔甲與全身動作重塑（Revision 4）

任務 `KNIGHT-ARMOR-POWER-REV4-20261024`。使用者要求改善前版木偶感，盡量貼近既有騎士的帥氣銀甲與動作，保留頭盔，加大跨步、沉身及全身轉動，交付六組遊戲大小的原圖對照。本目錄是製作候選，未替換遊戲主角。前版銀盔候選可由遊戲 `0dbabd48`／素材庫 `605a76d` 回溯。

## 本輪造型

- 收腰胸甲重塑為胸腹相接的板甲，增加中央脊線、鎖骨邊與側折線；下接弧形腹甲、腰圈及三層曲面胯甲。
- 肩甲改為兩層向外掃出的曲面覆板、前緣與脊線；跟隨上臂，避免胸口轉動時肩球浮在手臂上方。護臂、肘甲側翼、膝甲與脛甲依人體收放，前面保留金屬折面，接縫以深色內襯收窄。
- 保留貼合頭形的銀色sallet頭盔與頰甲，移除其遮住的眼睛／耳朵／頭皮幾何；不是用隱藏細節增加面數。劍、盾牌及刀光的決策維持：單手長劍，無盾、無刀光。
- 原圖的淺灰銀甲與深色內襯為配色依據；採中等粗糙度銀色金屬、克制邊緣反光及方向光。所有幾何、色盤、骨架與動畫均自製，沒有引入第三方模型、貼圖或動畫。

## 結構與效能

`knight_batch1.blend`沿用穩定檔名，內容已為Revision 4；包含16骨骼、六Action、原始骨骼綁定與預覽攝影棚。`knight_batch1.glb`僅含角色及六動畫，排除攝影棚／燈／相機。`manifest.json`記錄版本、面數、動作與手腳目標誤差。

**11,238三角面、5,597製作多邊形、5,937製作頂點、12,954匯出頂點**；法線／UV邊界會分裂匯出頂點。1網格／primitive／材質，16骨骼、每頂點1權重，兩張36×4內嵌色盤；GLB **840,392 bytes（約821 KiB）**。相較銀盔版增加1,574三角面，維持12k製作檢查上限；不是已通過戰鬥GPU-FPS驗收，也不把單primitive當成包含所有引擎pass的draw-call數。

## 六組動作

| 動作 | 幀數／fps | 內容 |
| --- | --- | --- |
| idle | 30／30 | 寬腳、屈膝、胸口前壓、低重心持劍，空手護胸 |
| walk | 15／30 | 前傾跑動，較長步幅、髖胸反向及手臂配重 |
| attack1 | 15／30 | 蓄力、踏步、快速轉髖帶胸揮斬、沉身隨勢、回守 |
| attack2 | 15／30 | 舉劍並整體轉過背面、交替步伐、轉身斜斬後回守 |
| cast | 15／30 | 配合原圖轉身、高舉停留、低位收招，空手順前臂銜接 |
| die | 30／30 | 先失衡屈膝，後段才倒地；手臂隨肩下落、劍轉平 |

待機製作骨盆高度從1.25降至1.02，腳踝間距由約1.05加大至1.46；第一擊最低骨盆約0.85。這些是製作座標，只描述相對表演，不是遊戲移速或戰鬥位移。兩骨IK目標全數可達，最大手腕／腳踝誤差<0.000001。整圈轉身使用完整腳掌朝向，避免方向向量的最短旋轉使鞋底翻斜；胸口前向檢查先去除編輯骨的初始朝向，避免直接取骨骼Euler-Z在轉身中誤判。

動畫保留原始0.5／1秒週期，非循環GIF末幀另停300ms、死亡750ms供檢視。GLB第一至末取樣鍵跨度為`(frames-1)/fps`，包含最後取樣顯示時長才是表中週期。尚未套用遊戲攻擊／施法的first跳幀與事件時序；沒有改模擬、命中或傷害。

## 重製與驗證

在專案根目錄執行，`<Blender>`是blender.exe，`<預覽目錄>`採專案外的絕對路徑：

```powershell
& '<Blender>' --background --factory-startup --python tools/knight3d/build_knight.py -- --output assets/characters/knight3d --preview '<預覽目錄>' --render none
& '<Blender>' --background --factory-startup --python tools/knight3d/render_batch.py -- --model assets/characters/knight3d/knight_batch1.blend --preview '<預覽目錄>' --sprite-preview
python tools/knight3d/package_game_compare.py --preview '<預覽目錄>' --reference images/sprites/knight --battle-height 600
python tools/knight3d/validate_asset.py assets/characters/knight3d/knight_batch1.glb
node tools/knight3d/sync-library.cjs --apply
node tools/knight3d/sync-library.cjs --check
```

`render_batch.py --validate-only`不渲染，重開成品驗120個完整姿勢、內嵌材質、地面與有限矩陣、兩攻擊全身位移、左拳前向與腕部銜接；失敗時會指出最低頂點及所屬骨骼。`--render-clips cast`可僅重出指定動作，但仍驗全部姿勢。`--design-views`另存四面攝影棚靜態視圖，應用不同預覽目錄，避免覆蓋透明動作圖。`validate_asset.py`直接讀GLB檢查索引、權重、三角、16joints、材質／內嵌貼圖、時間與六段各48通道。

## 同遊戲尺寸對照

`knight_revision4_armor_power_six_game_compare.gif`為640×688、150幀／6秒，每格左原圖、右新銀甲；另有原尺寸PNG與明標2x PNG。原圖SE是胸肩較正面的視角，3D透明預覽相機相應調整為接近正面；不是把方向名稱當成固定的世界相機方位。四面放大造型檢視另外交付，不能當作遊戲大小。

原圖128格、trim及錨點由knight.json還原，素材scale1.4 × 一般鏡頭100/125=0.8，總倍率1.12；SE idle第一幀不透明頭腳50素材px，透視前為56 CSS px。新模型只用idle頭／腳實際投影高度校正一次，六動作全程固定比例與腳點，不對每幀／動作重新縮放。兩欄套用遊戲上緣0.82透視公式，假設600 CSS px高普通戰鬥面板與100%瀏覽器／圖片縮放；全螢幕會額外×1.3，面板高度不同有輕微透視差。這是依遊戲公式重建的尺寸預覽，並非實機3D整合畫面。

原圖欄保留舊盾／刀光及烘焙陰影；新模型沒有盾／刀光。新版對照另依每姿勢腳點投影加淡接地橢圓陰影，僅為預覽輔助，不寫入GLB、貼圖或遊戲特效。原圖完整15幀按來源fps播放，未省略起手；`game-comparison-validation.json`保存倍率／校正／GIF讀回，`sprite-projection.json`保存相機及投影，`validation.json`保存逐姿勢量測／接地點，`glb-validation.json`保存二進位檢查。

## 保存與待驗收

素材庫由既有vfx-library-root解析，候選四資產及八工具共12檔保存於`codex-authored/knight3d`相同相對路徑，SHA逐檔核對。預覽、參考放大、日誌與驗證報告留本聊天visualizations/knight3d-rev4；blend1及pycache不交付。

六份既有knight圖集只供造型／動作參考與專案外對照，未取像素當新角色貼圖。採用使用者指定的Blender製作可綁骨骼3D，非點陣作圖，沒有改用RPG Mote。正式sprites、遊戲JS／CSS／配置、解鎖與存檔均未改。

**待驗收**：盔甲造型、原圖相似度、動作自然度及角色氣勢仍由使用者檢視；數值檢查不代表美術核准。尚未整合八方向正式輸出、戰鬥事件／GPU-FPS，也未宣稱消除所有甲片互穿。若選用預渲染精靈，模型面數不成為瀏覽器即時蒙皮成本，但圖集容量與載入／播放效能另驗。
