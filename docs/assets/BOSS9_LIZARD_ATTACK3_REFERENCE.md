# BOSS9 第三招：依新參考重製交叉連爪

任務 `BOSS9-ATTACK3-REFERENCE-20261125`。使用者要求依新的GIF重新製作第三招，仍先以GIF驗收。保留目前模型、暫代材質、骨架與蒙皮，以及已確認的Walk、Idle、Attack1與Attack2；這個獨立包供動作預覽，尚未接入實戰。

## 動作與參考

參考為使用者提供的 `Gemini_Generated_Gif_uosp17uosp17uosp.gif`，640×360、30幀、3秒；SHA256為 `8b0cb23f9111faf0e8e3f62f9ffbe42e65ad2ec8b2843895991d1b633586d964`。僅分析姿態、時間與軌跡，沒有匯入其圖像像素或刀光作為素材。

沿用前定完整1.5秒，將參考時間按比例壓縮。右爪在約0.35秒抬至最高，0.35–0.55秒往另一側斜掃；左爪於第一擊末段已開始抬起，約0.90秒到頂，0.90–1.10秒反向斜掃，1.50秒回到原站姿。兩擊之間持續移轉重心，右爪回收和左爪抬起相互銜接，不先回Idle再重播另一隻手。

本版不再直接鏡射第一招。`motion.json`保存依參考建立的手爪目標、掌面／指尖方向、張指程度及軀幹關鍵姿態；以保形三次曲線讓舉爪連續、釋放加速。掌背、指尖與整條手臂沿軌跡漸進翻轉。肩胛、上臂、前臂分別求解，保持物理骨長；腰胸反向扭轉、重心起伏，尾巴帶延遲反作用後回穩。

頭部使用已確認第一招的正面姿態補償軀幹轉動，掃過臉前時頸部小幅後收，保持頸骨長度與頭眼朝向。口部有呼應發力的張合。腳踝、腳掌與腳趾整組鎖定原姿，再解算大腿／小腿，避免固定腳趾卻扭曲整個腳面。左右手指各用其自身骨鏈與掌面解算，保持自然爪曲。

## 檔案與重建

素材庫位置由 `tools/vfx/vfx-library-root.cjs`解析；新包為 `codex-authored/boss9-lizard-attack3-ref-20261125`，舊第三招包保持。

- `source/inputs.json`：記錄已確認第二招包內來源GLB／Blend的素材庫相對路徑及SHA，不重複保存同一份大型輸入。GLB SHA256為 `b00d2fd34dcd205368a449208dbb5de573a9a4d266a2060d426177a9baea5da8`；輸出的可編輯Blend本身包含模型與五個Action。重建須同時具備既有第二招包。
- `exports/boss9_attack3.blend`／`.glb`：新增本版第三招，240Hz、361姿態，原生24FPS、36格。GLB保留原二進位前綴與前四動畫，Blend保留原四個Action。
- `preview/BOSS9_Attack3.gif`／`_Slow.gif`：正常1.5秒與四倍慢放6秒，乾淨正面預覽。
- `preview/BOSS9_Attack3_Side.gif`／`_Path.gif`：側面與實際蒙皮爪群路徑。路徑線是檢查標記，不是遊戲特效。
- `source/tools/`、本文件與`qa/`：製作、幾何檢核、渲染與編碼工具，及必要驗證結果。截圖直接在記憶體串流編碼，沒有產生數百個PNG影格。

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack3-ref/author.py -- SOURCE/boss9_attack2.glb SOURCE/boss9_attack2.blend OUTPUT/exports
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack3-ref/verify.py -- SOURCE/boss9_attack2.glb OUTPUT/exports/boss9_attack3.glb OUTPUT/exports/boss9_attack3.blend OUTPUT/exports/validation.json
node tools/boss9-lizard/attack3-ref/capture.cjs front --python PYTHON_EXECUTABLE
node tools/boss9-lizard/attack3-ref/capture.cjs side --azimuth 70 --python PYTHON_EXECUTABLE
node tools/boss9-lizard/attack3-ref/capture.cjs path --guide --python PYTHON_EXECUTABLE
node tools/boss9-lizard/attack3-ref/export.cjs --stage
```

`--draft`只供快速姿態檢查；正式交付使用完整240Hz輸出與補間檢查。`capture.cjs front --serve`可啟動可播放、暫停、重播與拖曳時間軸的預覽。

## 驗證界線

原生及GLB各721個時點檢查骨長、縮放、接地、腳面外形、首末接縫、頭部朝向、指鏈伸展、兩次斜掃方向及八組手／腳／頭三角形交疊；另核對原四Action、原GLB前綴與網格／材質／蒙皮資料。實際蒙皮軌跡與製作目標的偏差只用來檢查解算及匯出，不代表從2D參考取得了3D動捕真值。

三視角各150張截圖核對完整入鏡及播放控制，所有GIF逐幀解碼驗時長。指定區域三角形檢查不代表全模型任意接觸都已排除；遊戲動畫混合、世界碰撞、傷害與特效仍未接入。視覺動作待使用者看GIF驗收，數值結果記錄於本任務的`docs/AI_TASKS.md`。
