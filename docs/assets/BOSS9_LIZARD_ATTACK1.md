# BOSS9 第一招爪擊

目前任務 `BOSS9-LIZARD-ATTACK1-R4-20261123`。使用者要求保留起手爪尖朝上，揮下時指尖朝前方敵人略向下掃過，最後不能變成指尖朝下插地。本輪保留 R3 紅線弧形路徑、1 秒抬爪至揮下及連續抬爪，修正手腕與前臂帶動的爪尖朝向。只修改此招與 GIF，未接入遊戲；沿用已核准非人形模型，在 Blender 4.5.9 製作骨架動作。

## 動作與來源

原參考 GIF 共 30 張、3 秒，目前時間與軌跡以使用者後續文字及紅線圖為準。0–0.12 秒壓身，0.12–0.74 秒連續抬右爪，0.74–1.12 秒沿外側下劃再向右弧掃，抬爪至揮下正好 1 秒。1.12–1.23 秒收勢，1.23–1.8 秒回復蹲姿，成品 `Attack1` 全長 1.8 秒。參考只有單一視角，深度、關節與回復依模型重建。

沿用跨姿勢的 C1 單調 Hermite 抬爪曲線，中途保留速度。揮擊重拉為帶外弓的四分之一橢圓：上段近似垂直沿左側落下，中央向右轉彎，末段近似水平掃出；肩膀、胸腰轉身延後，配合右爪在外側的弧線。直接控制爪群中心並抵銷手腕旋轉造成的位移，深度先伸到頭前避開穿插。驗證取實際蒙皮幾何與最終攝影機投影，以弧線偏離首尾直線的距離、前半段下降比例及末段水平移動判斷，取代上一版的直線條件。

R4 保持抬爪頂點原姿勢，於下揮開始後轉腕，0.86–1.23 秒讓主要長指的實際指根至尖端方向朝模型前方、略向下約 15 度，收勢後才回到待機手形。角度由蒙皮指根／指尖幾何推導，不使用骨骼名稱或猜測某軸角度作為證據。手腕轉動時同步補償手掌位置，以保持 R3 爪群中心弧線；末段重心少量跟進，避免手臂到極限而讓爪端彈回。檢查末段指尖離地，並額外輸出側面 GIF 供確認向前伸爪的形態。

蓄勢與下掃同步控制骨盆、腰胸俯仰／扭轉／側傾、頸頭及下顎。鎖骨隨伸手轉動，肩肘腕以保持骨段長度的 IK 連動；肘彎方向連續傳遞，收勢平滑回復。左手在蓄勢階段支撐，左後腳持續固定地面，右後腳於揮擊時前踏。尾部延遲反向擺動，參與平衡。所有預覽為實際 GLB 蒙皮，不以修改參考 GIF 或繪製假角色取代骨架動作。

基底為已核准包 `codex-authored/boss9-lizard-legs-20261120/exports/boss9_lizard.glb`，SHA256 `23319786f8663d55bbde4ee7ae48bd2259e7a493114994cb9407dd2d731dbf5d`。完整保留其原二進位、節點／rest／73骨、網格、權重、兩張貼圖、暫代材質與 `Walk` 動作；只追加 `Attack1` 通道。Blend 保持原生 24 FPS 及 Walk 曲線，Attack1 以 240 Hz 取樣 433 個姿勢。來源 GIF 只分析動態，未複製其像素、背景、爪痕或粒子；本輪未製作戰鬥特效。

## 保存與重建

素材庫由 `tools/vfx/vfx-library-root.cjs` 解析。本輪獨立包為 `codex-authored/boss9-lizard-attack1-r4-20261123`。R1／R2／R3 舊包保留，工具目前輸出指向 R4。

- `source/boss9_lizard.glb`、`boss9_lizard.blend`：已核准基底；`reference.json`：參考雜湊與時序資料，沒有參考圖片。
- `source/tools/` 及本文件：本輪七個製作／驗證／預覽／擷取／編碼／封裝工具。
- `exports/boss9_attack1.blend`：可編輯雙動作來源；`boss9_attack1.glb`：保留 Walk、新增 Attack1；`build.json`、`validation.json`：製作與檢核明細。
- `preview/Attack1.gif`：正面；`Attack1_Path.gif`：正面加實際軌跡；`Attack1_Side.gif`：側面；`Attack1_Top.gif`：俯視。各 900×600、90 張、50 FPS、1.8 秒，循環預覽。
- 軌跡版橘線取自最終 GLB 在揮擊階段的實際蒙皮爪端，箭頭取最後一段切線；亮點跟隨實際爪端。這是檢視用路徑標記，不是遊戲爪痕特效，也沒有把目標曲線貼在預覽上代替動作。
- `qa/`：四份實際擷取、聯絡圖、GIF 解碼資料與最後通過的必要製作紀錄；`manifest.json`：全部必要檔案 SHA。

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack1.py -- SOURCE.glb SOURCE.blend OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack1_verify.py -- SOURCE.glb OUTPUT_DIR/boss9_attack1.glb OUTPUT_DIR/boss9_attack1.blend OUTPUT_DIR/validation.json
node tools/boss9-lizard/attack1_capture.cjs REVIEW_DIR/front --azimuth 0
node tools/boss9-lizard/attack1_capture.cjs REVIEW_DIR/path --azimuth 0 --guide
node tools/boss9-lizard/attack1_capture.cjs REVIEW_DIR/side --azimuth 75
node tools/boss9-lizard/attack1_capture.cjs REVIEW_DIR/top --top
python tools/boss9-lizard/attack1_encode.py REVIEW_DIR
node tools/boss9-lizard/attack1_export.cjs --stage REVIEW_DIR
node tools/boss9-lizard/attack1_export.cjs
```

## 驗證與限制

逐位比較來源 GLB 的整段原二進位、Walk JSON、原 accessors／bufferViews 及網格、蒙皮、貼圖、材質與節點。檢查新增動畫通道的有限值、時間範圍、四元數及首尾。原生 Blend 與重匯入 GLB 各取 865 個時點，包含 240 Hz 與錯相補間；比較兩者實際蒙皮頂點，檢查骨長、四肢關節段長、連續性、支撐接地、雙腳／雙手／手腳／手頭的指定區域三角形穿插及全身連動。量測實際爪端的抬爪中段最低速度、弧線偏差、前半段下降／右移比例、末五分之一水平位移／高度差及後半段右移；確認抬爪至揮下為 1 秒。另量測整體邊長伸長分布，保留實測值，未把局部自動蒙皮拉伸宣稱為完全消除。

指尖朝向另以三根主要長指的實際蒙皮指根與末端區域獨立量測：起手頂點須向上，0.86–1.23 秒朝前方的單位向量分量須大於 0.90，傾角介於向下 30 度至向上 5 度，0.98–1.23 秒尖端區域須保持離地。Three.js 擷取亦從同一成品的實際頂點重驗朝向，側面與正面使用相同姿勢／成品 SHA。

正面、軌跡正面、側面、俯視各擷取 90 張，確認最終 GLB SHA、1.8 秒時間、無頁面錯誤／警告及完整入鏡。正面下掃 20 張的實際爪端投影須呈現明顯彎弧，前半段下降為主、末段水平向右掃出。每個 GIF 逐張重開解碼並目視聯絡圖；另驗 Python／Node 語法、Build、雙庫 SHA 與 Git 差異。未全面排除全部肩髖、甲片及自身接觸，也未驗遊戲端速度、命中時點或動作切換；那些屬於後續接入。待使用者看 GIF 決定是否採用，原移動成品與桌面參考保持。
