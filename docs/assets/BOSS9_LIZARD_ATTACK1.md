# BOSS9 第一招爪擊

任務 `BOSS9-LIZARD-ATTACK1-20261123`。使用者已核准後腿直線奔跑版本，要求參考 `BOSS9_Attack1.gif` 盡量復刻第一個攻擊。本輪只製作此招與 GIF，未接入遊戲。沿用非人形模型，在 Blender 4.5.9 製作骨架動作，不需重建 MakeHuman 人體。

## 動作與來源

參考 GIF 共 30 張、3 秒。前約 0.7 秒壓低身體，0.8–2.2 秒將重量放在左手及雙腳、扭身抬高右爪，約 2.2–2.8 秒右爪向前下方斜掃，2.8–3 秒跟隨慣性收勢。本輪保留這段時序，補 0.6 秒回復起始蹲姿，成品 `Attack1` 為 3.6 秒。參考只有單一視角，深度、關節與回復依模型重建，不宣稱逐像素吻合。

蓄勢與下掃同步控制骨盆、腰胸俯仰／扭轉／側傾、頸頭及下顎。鎖骨隨伸手轉動，肩肘腕以保持骨段長度的 IK 連動；肘彎方向連續傳遞，收勢平滑回復。左手在蓄勢階段支撐，左後腳持續固定地面，右後腳於揮擊時前踏。尾部延遲反向擺動，參與平衡。所有預覽為實際 GLB 蒙皮，不以修改參考 GIF 或繪製假角色取代骨架動作。

基底為已核准包 `codex-authored/boss9-lizard-legs-20261120/exports/boss9_lizard.glb`，SHA256 `23319786f8663d55bbde4ee7ae48bd2259e7a493114994cb9407dd2d731dbf5d`。完整保留其原二進位、節點／rest／73骨、網格、權重、兩張貼圖、暫代材質與 `Walk` 動作；只追加 `Attack1` 通道。Blend 保持原生 24 FPS 及 Walk 曲線，Attack1 以 120 Hz 取樣。來源 GIF 只分析動態，未複製其像素、背景、爪痕或粒子；本輪未製作戰鬥特效。

## 保存與重建

素材庫由 `tools/vfx/vfx-library-root.cjs` 解析。本輪包為 `codex-authored/boss9-lizard-attack1-20261123`。

- `source/boss9_lizard.glb`、`boss9_lizard.blend`：已核准基底；`reference.json`：參考雜湊與時序資料，沒有參考圖片。
- `source/tools/` 及本文件：本輪七個製作／驗證／預覽／擷取／編碼／封裝工具。
- `exports/boss9_attack1.blend`：可編輯雙動作來源；`boss9_attack1.glb`：保留 Walk、新增 Attack1；`build.json`、`validation.json`：製作與檢核明細。
- `preview/Attack1.gif`：正面；`Attack1_Side.gif`：側面；`Attack1_Top.gif`：俯視。各 900×600、90 張、25 FPS、3.6 秒，循環預覽。
- `qa/`：三視角實際擷取、聯絡圖、GIF 解碼資料與最後通過的必要製作紀錄；`manifest.json`：全部必要檔案 SHA。

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack1.py -- SOURCE.glb SOURCE.blend OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack1_verify.py -- SOURCE.glb OUTPUT_DIR/boss9_attack1.glb OUTPUT_DIR/boss9_attack1.blend OUTPUT_DIR/validation.json
node tools/boss9-lizard/attack1_capture.cjs REVIEW_DIR/front --azimuth 0
node tools/boss9-lizard/attack1_capture.cjs REVIEW_DIR/side --azimuth 75
node tools/boss9-lizard/attack1_capture.cjs REVIEW_DIR/top --top
python tools/boss9-lizard/attack1_encode.py REVIEW_DIR
node tools/boss9-lizard/attack1_export.cjs --stage REVIEW_DIR
node tools/boss9-lizard/attack1_export.cjs
```

## 驗證與限制

逐位比較來源 GLB 的整段原二進位、Walk JSON、原 accessors／bufferViews 及網格、蒙皮、貼圖、材質與節點。檢查新增動畫通道的有限值、時間範圍、四元數及首尾。原生 Blend 與重匯入 GLB 各取 865 個時點，包含 120 Hz 與錯相補間；比較兩者實際蒙皮頂點，檢查骨長、四肢關節段長、連續性、支撐接地、雙腳／雙手／手腳／手頭的指定區域三角形穿插及全身連動。另量測整體邊長伸長分布，保留實測值，未把局部自動蒙皮拉伸宣稱為完全消除。

三視角各擷取 90 張，確認最終 GLB SHA、3.6 秒時間、無頁面錯誤／警告及完整入鏡。每個 GIF 逐張重開解碼並目視聯絡圖；另驗 Python／Node 語法、Build、雙庫 SHA 與 Git 差異。未全面排除全部肩髖、甲片及自身接觸，也未驗遊戲端速度、命中時點或動作切換；那些屬於後續接入。待使用者看 GIF 決定是否採用，原移動成品與桌面參考保持。
