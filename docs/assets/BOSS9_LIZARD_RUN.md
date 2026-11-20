# 新 BOSS9 蜥蜴人奔跑修正

任務 `BOSS9-LIZARD-RUN-20261120`，狀態 Review。使用者提供新的 `BOSS9.glb`，要求修正頭身側偏及手指隨腳動作，先交 GIF。這是新蜥蜴人，不沿用已撤銷的飛龍。

## 來源及範圍

使用者桌面原檔 SHA256 為 `1f3f5daad3100305fd51c5fd070cf53a2d5a6b3c59394be3db94500ce68ffa0d`。此原檔已帶有 73 骨與 `dog_walk` 約 0.666667 秒循環，模型約 18,530 個匯入頂點、10,423 面，包含 UV／法線拆點。依這次明確指示修改，不新增外部素材。

保留原有低身、雙後腿交替奔跑、軀幹俯角與起伏、手臂和尾巴動態。暫代材質保持，未改模型形狀、面、法線、UV、骨架 rest、蒙皮權重或兩張 PNG；原始二進位資料完整保留在新 GLB 中。桌面原檔不覆寫，沒有接入遊戲或修改 NPC／玩法／其他模型。

## 問題與修正

原自動分類的骨骼名稱與實際解剖位置不一致。`spine_05` 才是上背，`spine_16` 位於頭部；名稱為 `chest` 的骨位於正面視圖右側的手掌，下面的 `frontLwr.L`／`frontUpr.R` 等是手指，而不是腳。名稱為 `head` 的骨也是該手掌的一支手指。不能依名稱把它們當成頭或胸來修。

原上身有約 8～13 度持續側傾，朝向也隨原根骨偏轉。由 `spine_02` 腰部校正上身：保留原俯角，以雙後腳腳掌至腳趾的平均水平方向設定朝向，去除側傾。頭部由實際頭骨 `spine_16` 穩定朝整體前進軸正前方，保留原俯角，避免隨每一步腳尖外展而左右轉頭。後腿、骨盆、根部及尾鏈動作保持原曲線。

手指問題來自錯誤套用前腳／頭頸動畫：部分指節原本有接近腳部抬落的巨大旋轉。前肢頂點沒有綁到後腿，沒有證據需要切開網格。將該手掌下 12 個指節恢復模型原有的自然彎曲關係，隨手掌整體擺動，解除錯套的腳部動作。保留原手臂／手掌的輕微起伏，不重綁整隻模型。

使用 Blender 匯入、調整及儲存可編輯來源；在 Blender 內將修正後骨骼轉換回原 GLB 節點基準，只替換 14 骨的 42 個動畫通道。其餘 177 個通道保持原時間與輸出資料，原 GLB 的幾何、貼圖、材質、蒙皮、骨架與節點資料全部不變。新增修正通道密集取樣以避免原每 24 FPS 較急的腳掌轉折在補間時帶偏頭身；輸出動作命名為 `Walk`。

此工作是非人形骨骼動畫修正，採用專案的 Blender 流程；不涉及 MakeHuman 人形建模或點陣繪圖。

## 保存與重建

素材庫位置由 `node tools/vfx/vfx-library-root.cjs` 解析。獨立包為 `codex-authored/boss9-lizard-run-20261120`：

- `source/BOSS9.glb`、`original.blend`、`inspection.json`：原檔、原生匯入及骨架／權重盤點。
- `exports/boss9_lizard.blend`、`boss9_lizard.glb`、`build.json`、`validation.json`：修正版與來源／驗證報告。
- `source/tools/`、本文件：此版本製作、檢核、預覽、擷取、GIF 及保存工具。
- `preview/Run.gif`、`Front.gif`：實際 GLB 的側面及正面；900×600、30 FPS，將原循環連播三次，總長 2 秒。
- `qa/`：兩視角擷取紀錄、全部 20 個時點聯絡圖、GIF 編碼及必要製作日誌；`manifest.json` 核對來源、工具與成品 SHA。

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/inspect.py -- INPUT.glb SOURCE_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/prepare.py -- INPUT.glb OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/verify.py -- INPUT.glb OUTPUT_DIR/boss9_lizard.glb OUTPUT_DIR/boss9_lizard.blend OUTPUT_DIR/validation.json
node tools/boss9-lizard/capture.cjs REVIEW_DIR/side
node tools/boss9-lizard/capture.cjs REVIEW_DIR/front --azimuth 0
python tools/boss9-lizard/encode.py REVIEW_DIR
node tools/boss9-lizard/export.cjs --stage REVIEW_DIR
node tools/boss9-lizard/export.cjs
```

擷取器使用專案 `launchHeadless` 看門狗及 finally 關閉；`--original`、`--quick`、`--top`、`--bones` 供製作時檢查，正式 GIF 由修正版完整 20 個時點生成。

## 驗證與交接

原生 Blend 及重新匯入的實際 GLB 各檢查 161 個時點，涵蓋 120 FPS 網格與錯開相位的補間位置。後腿／骨盆／根部矩陣及純後腿影響頂點相對原檔最大差均為 0。實際 GLB 軀幹與雙腳方向差不超過 0.0264 度，側傾小於 0.00053 度；頭部對正前方軸的誤差小於 0.00005 度，循環頂點差小於 0.000002 模型單位。

原前肢頂點對後腿的錯誤權重為 0。修正後指定純指骨影響頂點在手掌座標內的最大誤差小於 0.0000005，指定指部及腳部三角形穿插為 0，最近頂點距離約 0.1674 模型單位。檢核不代表所有甲片、肩髖、兩手及整個模型的所有接觸均已排除；本輪針對使用者指出的頭身朝向與指部錯套動畫。

兩視角各 20 張正式擷取，頁面例外／警告均為 0，模型完整入鏡，擷取 SHA 與最終 GLB 一致。兩張 GIF 均重開逐張解碼，確認 60 張、2 秒循環，聯絡圖目視審閱通過。必要檢查包括 Python AST、Node CJS／ESM 語法、`npm.cmd run build`、素材包 SHA、Git 差異與孤兒瀏覽器清理。

只修改本輪工具、文件及任務段落，其他聊天的 NPC／Task 表與 data 修改保留。雙倉庫提交記於 AI_TASKS；尚未接入、合併或推送，下一步由使用者審閱 GIF。
