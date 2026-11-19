# BOSS9 飛行移動 GIF 參考重作

任務：`BOSS9-FLIGHT-GIF-REFERENCE-20261120`。狀態：Review，交使用者看飛行 GIF；其他動作須等使用者同意。

使用者提供桌面 `飛龍GIF.gif` 作為動態參考，之後指出翼膜拉伸，授權自行判斷是否增加骨骼。這次只製作飛行移動，沒有重做咬擊、爪擊、噴火或死亡，也沒有接入 NPC 或遊戲戰鬥。

## 本輪結果

- 以原有 v2 的正面切左留右單尾模型為來源，保留舊版檔案。另建飛行審閱模型，從 64 骨增加至 70 骨；左右翼各增 Root／Middle／Tip 三個支撐骨。
- 先建立展翼基準形態，再沿實際翼展方向建立分段拍翼軸。骨節保持長度，翼根、翼中段與翼尖分配不同轉角，翼尖另有小幅落後扭轉。沒有用動畫縮放翼骨拉開翼膜。
- 在新的展翼表面重算連續權重，移除翼根誤受前肢 Bone_041／046 拉動的影響；每頂點最多四個權重並正規化。同步轉換原有收折姿態的自訂法線，避免展翼後明暗錯位。
- 頭頸微調維持朝前，約 8～10 度俯角，配合參考的近水平頭姿；軀幹有前傾與起伏，腿爪在下拍時收起，尾巴向後延伸並逐節擺動。尾鰭維持本次預覽固定 0.65 比例，沒有動態縮放。
- Walk 為 2 秒循環，60 FPS 製作；GIF 30 FPS 共 60 張。完整翼展預覽為 800×600；同視角對照為左右各 640×360，上方明確標示參考與自製 3D。
- 新 GLB／Blend **只含 Walk**。其他四個動作完整留在未修改的 v2 來源包；不能把它們直接視為已適配新展翼基準的成品。

這是依參考重作的審閱版，不宣稱逐像素、逐關節或翼膜外形完全相同。來源模型的翼膜摺痕、雙翼遮擋與四肢比例仍與參考有差異；拍翼轉折及回收輪廓可繼續依使用者的審閱意見調整。尚未核准其他動作或正式接入。

## 保存與重建

用 `node tools/vfx/vfx-library-root.cjs` 解析素材庫，不把本機路徑寫入設定。

新包：`codex-authored/boss9-flight-reference-20261120/`

- `exports/boss9_flight.blend`：可編輯展翼模型、70 骨與 Walk。
- `exports/boss9_flight.glb`：實際 GIF 播放使用的成品。
- `exports/flight-build.json`、`flight-validation.json`：來源、四招原始雜湊、實際蒙皮驗證與 GLB 雜湊。
- `source/flight_*`：製作、翼骨重綁、參考曲線、預覽、擷取、GIF 編碼、檢核與打包工具；與專案同名工具按 SHA 核對。
- `preview/Walk.gif`：只含自製 3D 畫面；`qa/` 為原生檢核、成品擷取、編碼報告與製作日誌；`manifest.json` 記錄所有必要檔案及依賴。

穩定依賴為已提交的 `codex-authored/boss9-dragon-v2-20261120/exports/boss9.blend`，SHA256 `c412c1704d6f9f9b9315b5b2fc48163833fff83c8e88ee98a6268f74f6f40e70`。原始模型與前兩版皆保留。

參考 GIF SHA256：`cb716c7487b1b955ae44be89cd2fb4e2cefb2ca30c024a12c56ca3dcc0e1f066`；30 張、每張 100 毫秒，觀察約 2 秒拍翼循環。僅取動態節奏與姿勢作分析，不將其畫面、背景或貼圖匯入遊戲或自製素材包。標示來源的並排對照只放本機審閱產物，沒有納入素材庫成品。

重建時以已安裝的 Blender 4.5.9 LTS 執行：

```text
blender -b --python-exit-code 1 -P tools/boss9/flight_reference.py -- V2.blend OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9/flight_verify.py -- OUTPUT_DIR/boss9_flight.blend V2.blend OUTPUT_DIR/flight-validation.json
node tools/boss9/flight_capture.cjs REVIEW_DIR/frames
node tools/boss9/flight_capture.cjs REVIEW_DIR/full --full
python tools/boss9/flight_encode.py REVIEW_DIR USER_REFERENCE_GIF
node tools/boss9/flight_export.cjs --stage REVIEW_DIR
node tools/boss9/flight_export.cjs
```

互動預覽可執行 `node tools/boss9/flight_capture.cjs REVIEW_DIR --serve`，開啟所列本機網址；加 `/?full=1` 看完整翼展。結束時停止伺服器。

## 驗證及交接

- 原生 Blend 重開，以 120 FPS 檢查 241 個時點的實際蒙皮、有限值、骨長、骨節比例、頂點與矩陣的循環接縫；保留右尾骨鏈、三張原 JPEG 內嵌資料、全部 UV 與面索引。2954 個非翼影響頂點座標保持。
- 新展翼基準上，翼部 4483 條長於 5 毫米的邊，最差時點第 95 百分位伸長比約 1.294，第 99 百分位約 1.499，單邊最大約 1.933。這是相對**新展翼基準**的檢核，不能解讀為完全沒有彈性、壓縮或自身接觸。最大骨長誤差小於 0.000001 來源單位，所有翼支撐骨比例維持 1。
- GLB 70 骨、僅 Walk 2 秒、所有動畫通道有限且四元數正規化；首尾通道差小於 0.000001，三原圖位元組與 v2 成品相同。v2 Blend 的整檔 SHA 未變，其他四招原始動畫資料雜湊記入報告。
- 以實際 GLB 各擷取近景與完整翼展 60 幀，頁面例外／警告均 0；報告帶 GLB SHA，打包時核對與原生檢核為同一版本。完整翼展逐頂點投影確認沒有裁切。
- GIF 重開逐張解碼，核對 2 秒時長與無限循環；逐階段抽幀及並排對照目視審閱。背景為程式生成雲層，沒有使用參考背景像素。
- 執行 Python AST、Node 語法檢查、`npm.cmd run build`、`node tools/boss9/flight_export.cjs` 與本項 Git 差異檢查。擷取使用既有背景瀏覽器生命週期包裝器及 finally 關閉；交付前另跑孤兒清理。

修改檔案為新增 `tools/boss9/flight_*`、本文件與 AI_TASKS 中本任務段落。唯讀檢查共通規範、Workflow、Agent、原有 BOSS9 製作與驗證、Three.js／GLTFLoader、素材根解析和背景瀏覽器工具。其他聊天的 Tower 站位、NPC／Task 表及遊戲程式修改保留，不納入本次提交。

雙倉庫提交編號記於 `docs/AI_TASKS.md` 本任務。下一步由使用者審閱 GIF；只在使用者同意後處理其他動作。素材預覽可以審閱，本輪不合併或推送 develop／main。
