# BOSS9 後腿直線奔跑

任務 `BOSS9-LIZARD-LEGS-20261120`，狀態 Review。使用者指出後腿仍斜走，以直前箭頭明確授權調整腿部方向。本輪改變原後腿的關節與腳掌動作，保留原循環的前後步幅和抬腳節奏、前版頭身／尾部中線、手指修正及暫代材質。

## 修改方式

兩腿各自保持在平行於整體前進軸的平面內。用三段平面 IK 調整大腿、膝、飛節到腳踝，保留原模型的關節間長度、原腳踝前後與上下時間曲線；解除原來左右斜擺、跨到另一側的動向。腳掌依實際後跟至趾端幾何方向朝前，保留原抬落的俯仰節奏，極端俯仰限制在 65 度內。

直接量測蒙皮後的腳掌中心，將左右腳步線分別維持在身體兩側約 ±0.20 模型單位，並與頭身中線平行。修正的是腿部關節、腳掌朝向與幾何軌跡，不是轉動預覽攝影機或只畫直線。身體、頭及尾部仍以實際表面中心對齊，原根部及骨盆動作保留。

模型仍為 73 骨，原 0.666667 秒 `Walk` 循環。新增後腿十骨修正後共修改 34 骨的 102 個動畫通道，其他 117 通道保持原資料。原頂點位置、面、UV、法線、材質、兩張 PNG 及 rest／節點資料保持；沿用上版已驗證的 587 個尾根頂點權重修復，不新增其他蒙皮修改。

來源是使用者提供的新蜥蜴人 `BOSS9.glb`，SHA256 `1f3f5daad3100305fd51c5fd070cf53a2d5a6b3c59394be3db94500ce68ffa0d`。新箭頭圖只用於方向判斷，不放入素材或預覽。依既有 Blender 流程製作並保存來源，未接入遊戲、修改 NPC／玩法或其他模型。

## 保存與重建

素材庫位置由 `tools/vfx/vfx-library-root.cjs` 解析。本輪獨立包為 `codex-authored/boss9-lizard-legs-20261120`：

- `source/BOSS9.glb`、`source/tools/` 及本文件：原檔與本輪七個專用製作、檢核、擷取、預覽、GIF 及保存工具。
- `exports/boss9_lizard.blend`、`boss9_lizard.glb`、`build.json`、`validation.json`：可編輯來源與成品、IK／腳步及幾何區域／權重明細、完整驗證。
- `preview/Top.gif`：俯視，金線為頭身中線、綠線是相對身體的兩腳實際前後軌跡，綠箭頭取實際後跟至趾端朝向，藍箭頭為前進方向；`Front.gif`：正面；`Run.gif`：側面。
- `qa/`：三視角擷取、聯絡圖、編碼與必要製作紀錄；`manifest.json`：來源、工具及成品 SHA。

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/legs.py -- INPUT.glb OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/legs_verify.py -- INPUT.glb OUTPUT_DIR/boss9_lizard.glb OUTPUT_DIR/boss9_lizard.blend OUTPUT_DIR/validation.json
node tools/boss9-lizard/legs_capture.cjs REVIEW_DIR/top --top --guide
node tools/boss9-lizard/legs_capture.cjs REVIEW_DIR/front --azimuth 0
node tools/boss9-lizard/legs_capture.cjs REVIEW_DIR/side
python tools/boss9-lizard/legs_encode.py REVIEW_DIR
node tools/boss9-lizard/legs_export.cjs --stage REVIEW_DIR
node tools/boss9-lizard/legs_export.cjs
```

## 驗證與限制

原生 Blend 與重新匯入的實際 GLB 各檢查 161 個時點，包含 120 FPS 與錯相補間。檢查實際腳掌中心對平行步線的誤差、實際後跟至趾端朝向、髖膝踝所在平面、關節間長度、相鄰姿勢連續性及原腳踝前後／上下曲線。來源根部與骨盆矩陣保持；頭身及尾部表面中線、手指修正與循環亦重驗。

另檢查兩腳彼此與指部對腳部的三角形穿插、最近距離、尾部及腿部邊長伸長。檢查範圍不代表整個模型所有肩髖、甲片或自身接觸均已排除；原自動蒙皮與接合區仍可能有局部伸長，實測數值保存在驗證報告及 AI_TASKS。

三視角各擷取 20 張，從 Three.js 實際蒙皮再次核對腳步線與腳掌朝向，核對最終 GLB SHA、頁面例外／警告及完整入鏡。三 GIF 各 900×600、60 張、2 秒，將原循環連播三次，逐張重開解碼與聯絡圖目視審閱。另驗 Python AST、Node CJS／ESM、Build、雙庫 SHA、Git 差異及孤兒瀏覽器清理。

舊版包與桌面原檔保留。本輪使用獨立工具，不改同步中的前版；任務紀錄插入舊奔跑任務之前，避免與 develop 尚未納入上輪對齊紀錄的檔尾差異重疊，三方試合乾淨。提交編號與實測值記於 AI_TASKS，待使用者看 GIF，未合併或推送。
