# BOSS9 蜥蜴人實際中線對齊

任務 `BOSS9-LIZARD-AXIS-20261120`，狀態 Review。使用者以紅線指出上一版實際頭身軸仍與腳步方向不一致。本輪取代上一版「骨骼角度一致即視為外形對齊」的驗收方式，以蒙皮後的身體和尾部位置重新校正，仍先交 GIF。

## 修正

原上半身的位移沒有隨旋轉一起校正，且用每一步腳尖外展的平均角度當作上身方向，使身體仍左右偏轉。原尾巴也向一側彎曲，連到頭部時形成使用者畫出的斜線。本輪改以整體跑步前進軸（原生 Blender 的 −Y／GLB 的 +Z）為基準，保留俯角與起伏，重排上身位置與方向，使骨盆、腰、胸背、頭部及尾部實際中線一致。

從原模型固定幾何區域取得骨盆、腰、肋部、胸背、後腦、吻端及七段尾部的表面中心。依實際蒙皮結果聯立調整軀幹平移與頭部轉角；尾部保留上下弧度與運動，修正向一側偏彎。這些檢查點是模型表面頂點中心，不是骨骼名稱或局部旋轉軸。

尾根自動蒙皮還混有後腿權重，尾巴轉正時會被拉扯。只針對尾部占優勢、位於尾根區域的 587 個頂點，以平滑過渡移除誤入的後腿影響並重新正規化。原頂點位置、面、UV、法線、材質、兩張 PNG、73 骨的 rest 及節點資料保持；GLB 原二進位資料僅對這些已列明的權重位元組修改，另追加動畫資料。

後腿、骨盆與根部的原動作保持，先前錯套腳部動畫的手指修正也保留。只替換五個軀幹／頭部控制、七尾骨及十二指骨，共 24 骨的 72 通道，其餘 147 通道沿用原資料。沒有改變原循環 0.666667 秒或製作新步態，暫代材質保持，未接入遊戲。

## 素材與重建

來源為使用者的新蜥蜴人原檔，SHA256 `1f3f5daad3100305fd51c5fd070cf53a2d5a6b3c59394be3db94500ce68ffa0d`。圈線圖只用作問題定位，不把其像素放入成品。採用既有 Blender 骨骼與蒙皮修正流程，預覽來自實際 GLB。

由 `tools/vfx/vfx-library-root.cjs` 解析素材庫，新包 `codex-authored/boss9-lizard-axis-20261120`：

- `source/BOSS9.glb`：原檔副本；`source/tools/`：本輪七個專用製作、檢核、預覽、擷取、GIF 及保存工具與本文件。
- `exports/boss9_lizard.blend`、`boss9_lizard.glb`、`build.json`、`validation.json`：可編輯來源、成品、固定表面區域、權重修改明細及驗證。
- `preview/Front.gif`：無輔助線的正面；`Top.gif`：俯視，金線為實際蒙皮中線，藍箭頭為前進方向，為可讀性放在旁邊；`Run.gif`：側面。
- `qa/`：三視角擷取、聯絡圖、編碼及必要製作紀錄；`manifest.json`：成品與專案工具 SHA。

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/align.py -- INPUT.glb OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/axis_verify.py -- INPUT.glb OUTPUT_DIR/boss9_lizard.glb OUTPUT_DIR/boss9_lizard.blend OUTPUT_DIR/validation.json
node tools/boss9-lizard/axis_capture.cjs REVIEW_DIR/front --azimuth 0
node tools/boss9-lizard/axis_capture.cjs REVIEW_DIR/top --top --guide
node tools/boss9-lizard/axis_capture.cjs REVIEW_DIR/side
python tools/boss9-lizard/axis_encode.py REVIEW_DIR
node tools/boss9-lizard/axis_export.cjs --stage REVIEW_DIR
node tools/boss9-lizard/axis_export.cjs
```

## 實測及限制

原生 Blend 與重開實際 GLB 各檢查 161 個時點，含 120 FPS 與錯相補間。各表面中心相對骨盆的最大橫向偏差小於 0.000008 模型單位；實際後腦至吻端朝向誤差小於 0.0001 度，胸背至吻端小於 0.00014 度，尾端至吻端小於 0.0003 度。這些是指定表面中心的量測，不將骨骼角度當作外形證明。

後腿／骨盆／根部矩陣及純後腿影響頂點相對原檔差均為 0。指定純手指對手掌的形狀誤差小於 0.0000006，指部與腳部三角形穿插 0，最近頂點約 0.1548 模型單位；循環頂點差小於 0.000002。尾部邊長相對原靜態網格的最差 P95 約 1.174、P99 約 1.418、單邊最大 2.236，仍有自動蒙皮及接合區的局部伸長；未宣稱整個模型所有甲片、肩髖及自身接觸均已排除。

三視角實際 GLB 各擷取 20 張，例外／警告 0、完整入鏡，並再次從 Three.js 實際蒙皮取得表面中心核對。三張 GIF 均 900×600、60 張、2 秒，原循環連播三次；逐張重開解碼及聯絡圖審閱。另執行 Python AST、Node CJS／ESM、Build、雙庫 SHA、Git 差異與孤兒瀏覽器清理。

develop 同時有同步上一版工具的工作；本輪使用獨立新檔，未修改那些工具。本任務追加在 AI_TASKS 的另一段，與對方新增在檔頭的同步紀錄三方試合乾淨。前版包保留供核對，不覆寫使用者原檔；未合併或推送。雙倉庫提交與交接記於 AI_TASKS，下一步由使用者看 GIF。
