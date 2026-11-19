# BOSS9 飛行尾巴與四肢修正

任務 `BOSS9-FLIGHT-LIMBS-20261120`，狀態 Review。依使用者本輪回饋，僅修改飛行移動：尾長約原來 60%、尾部跟隨振翅上下律動、修正腿部穿模、雙手自然垂於胸前。其他動作仍待使用者同意，沒有接入遊戲。

## 修改結果

- 直接讀取已審閱的 70 骨飛行 Blend，保留原有翼部、軀幹、頭頸動作通道。另存新包，上一版完全保留。
- 七節尾鏈由約 6.805 米縮至 4.083 米，比例 0.60000007。尾巴網格與骨架同步沿長度縮短，截面厚度保持；遠端截面半徑比約 0.99876～1.00083。同步處理尾部法線，沒有整條等比縮細。
- 尾部從根到尖逐節延遲上下擺動，尾尖相對尾根的高度變化約 1.084 米；與翼部起伏的最佳對應約延遲 0.208 秒。固定尾鰭比例沿用上版，沒有以動畫縮放尾骨。
- 原自動蒙皮把前爪頂點混綁到後腳、左右肢間也有混用。依低處網格連通區與沿表面的距離辨識前後肢，清理交叉權重；中央腹部與胸部的連接區改由軀幹承接，避免隨雙腿分開被拉成薄片。共修正 1058 個頂點的權重，最多四權重且正規化。
- 腿部改為小幅收放，腳踝保持在腹部下方，減少原本把腳提進身體的動向。手腕依肩部位置維持胸前垂放，只作輕微前後及上下擺動；掌爪保持原有相對形狀，避免分別扭轉每節造成爪部變形。
- 仍只有 Walk 2 秒循環。提供側面完整翼展 GIF、正面手腳檢查 GIF；另外生成與使用者原 GIF 的並排比較，僅作本機私人審閱。

使用者新附的圈圖與原飛龍 GIF 都只用來觀察動作及手部姿勢，未將其像素匯入模型、貼圖、背景或素材包。三張原始 JPEG 資料保持，預覽雲層為既有自製程式背景。

## 保存位置與重建

素材庫由 `node tools/vfx/vfx-library-root.cjs` 解析。本輪新包為 `codex-authored/boss9-flight-limbs-20261120`：

- `exports/boss9_flight.blend`、`boss9_flight.glb`：修正模型及單一 Walk。
- `exports/flight-build.json`、`flight-validation.json`：來源、保留通道雜湊、尾長與蒙皮檢查。
- `source/`：`flight_refine.py/json`、`flight_refine_verify.py`、`flight_refine_export.cjs`，以及此版本的擷取、預覽、設定與 GIF 工具、本文件。
- `preview/Walk.gif`、`Front.gif`：自製 3D 成品；`qa/` 保存三視圖擷取紀錄、製作及編碼報告。`manifest.json` 核對所有成品、來源與專案工具的 SHA。

依賴為已提交的 `codex-authored/boss9-flight-reference-20261120/exports/boss9_flight.blend`，SHA256 `3d6a58fea5b337b146a6ed653ef9d2a4109c8fd793c6e99768be30395de16604`。其翼部來源、原 v2 的其他四招與前幾版成品都未覆寫。

```text
blender -b --python-exit-code 1 -P tools/boss9/flight_refine.py -- ACCEPTED.blend OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9/flight_refine_verify.py -- OUTPUT_DIR/boss9_flight.blend ACCEPTED.blend OUTPUT_DIR/flight-validation.json
node tools/boss9/flight_capture.cjs REVIEW_DIR/frames --package boss9-flight-limbs-20261120
node tools/boss9/flight_capture.cjs REVIEW_DIR/full --full --package boss9-flight-limbs-20261120
node tools/boss9/flight_capture.cjs REVIEW_DIR/front --full --azimuth 15 --package boss9-flight-limbs-20261120
python tools/boss9/flight_encode.py REVIEW_DIR USER_REFERENCE_GIF
node tools/boss9/flight_refine_export.cjs --stage REVIEW_DIR
node tools/boss9/flight_refine_export.cjs
```

## 驗證與交接

以 Blender 4.5.9 LTS 重開來源與成品，120 FPS 共 241 時點檢查實際線性蒙皮。原有翼部／軀幹／頭頸通道雜湊一致，未修改骨骼的姿態矩陣最大差約 0.00000024；尾鏈之外的骨架 rest、非尾頂點座標、面索引、UV 與三張原圖保持。原有正面切左留右單尾與 70 骨保持。

逐點檢查雙手、雙腳及兩側小腿下段共六個區域，對軀幹的保守凸包檢查未見進入；最小間距為手掌約 0.678／0.802 米、腳掌約 0.895／0.918 米、小腿下段約 0.468／0.617 米。這些是指定遠端區域的檢核，未把肩部、髖部等自然連接區當作需分離的部位。遠端手腳互相及與翼膜的三角形穿插數均為 0。

循環頂點最大差約 0.00000048 來源單位，骨長誤差小於 0.000001，翼骨與肢骨沒有動畫縮放。GLB 為 70 骨、只有 Walk，通道有限、四元數正規化、首尾連續，原三圖資料相同。三視圖各擷取 60 幀，核對頁面例外／警告、模型 SHA 與完整視圖逐頂點投影；GIF 重開逐張解碼核對 2 秒循環，另作側面及正面抽幀審閱。

必要檢查包括 Python AST、Node 語法、`npm.cmd run build`、`node tools/boss9/flight_refine_export.cjs`、Git 本項差異與孤兒瀏覽器清理。使用既有 `launchHeadless` 生命週期包裝器及 finally 關閉。

修改範圍：新增本輪 refine 製作／設定／檢核／打包工具與本文件，既有 `flight_capture.cjs` 增加版本選擇及視角、`flight_viewer.js` 支援視角參數、`flight_encode.py` 支援正面 GIF，以及 AI_TASKS 的本任務段落。唯讀檢查共通規範／Workflow／Agent、前版來源與製作工具、Three.js／GLTFLoader、素材解析與背景瀏覽器工具。其他聊天的 UI、NPC／Task 表及資料程式修改保留；同檔任務紀錄以不同段落三方試合及分段暫存處理。

本輪修正可供 GIF 審閱，仍保留上版翼膜摺痕及既有外形，不宣稱整個模型所有甲片與連接區的自身接觸均被排除。雙倉庫提交編號記於 AI_TASKS 與交付回覆；未合併／推送。下一步由使用者看 GIF，確認飛行後才處理其他招式及正式接入。
