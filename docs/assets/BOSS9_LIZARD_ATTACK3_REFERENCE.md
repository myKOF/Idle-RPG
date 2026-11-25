# BOSS9 第三招：肩肘與手掌協調回位（v6）

任務 `BOSS9-ATTACK3-RETURN-20261126`，承接使用者認可節奏的v5。保留紅箭頭後甩方向、第一擊半程接手及1.5秒時長，修正肩膀先回正而前臂／手掌稍後才轉回、腕部明顯扭折的問題。使用者於2026-11-26核准v6作為第三招定稿並要求commit；`approval.json`記錄版本及核准GLB雜湊，尚未接入實戰。模型、暫代材質、骨架、蒙皮及Walk／Idle／Attack1／Attack2保持。

## 動作與參考

GIF僅作兩擊順序、銜接及節奏參考：`Gemini_Generated_Gif_uosp17uosp17uosp.gif`，640×360、30幀、3秒，SHA256為 `8b0cb23f9111faf0e8e3f62f9ffbe42e65ad2ec8b2843895991d1b633586d964`。實際手臂與手指姿態來源是核准檔內的 `BOSS9_Attack1`，沒有取用退回版第三招或參考影像像素。

完整1.5秒，先畫面左側、再畫面右側（骨架內分別是R、L）。第一擊0.35秒高舉、0.35–0.55秒揮下；另一手於0.33秒開始準備，0.45秒（第一擊下揮一半）已離開原掌位，0.64–0.81秒第二擊，1.50秒回穩。第二手主要抬起區間由v4的0.44–0.78秒縮至0.415–0.64秒；下揮由0.20秒縮至0.17秒。`retarget.json`存來源時間對應；`recovery.json`控制揮完後的收回、後甩及小幅軀幹側傾，不替換核准下揮手勢。

先用只含前四動作的乾淨GLB／Blend取代目前製作檔，移除舊第三招；再從核准攻擊1重新取樣。第一擊保留其肩肘、手腕、指節及實際蒙皮路徑；第二擊鏡射該路徑，按另一側骨長求解。左右手掌結構不同，因此以實際蒙皮掌面法線對齊來源，反向補償指節，使指尖方向仍跟隨原攻擊1。翻掌沿來源動畫漸進發生，沒有固定旋轉90度的手寫關鍵幀。

軀幹在兩擊間交接發力，順方向最多5度側傾、2度轉體及0.8度俯仰，分散到腰胸骨鏈，尾巴延遲反向平衡；頭部保持前視，腳掌與腳趾整組固定後求解腿部。第一手0.67秒收回、0.86秒後甩；第二手0.96秒收回、1.12秒後甩。後甩時重新指定肩肘解算方向及手掌朝向，手肘向外且低於肩膀、前臂與手指延續斜下方向。兩手保持懸空連續收回後甩，最後才返回Idle，骨長與尺度不變。第二手提前抬起時暫向外繞開頭部尖角，最高點前接回原路徑；肩肘使用漸進的向外彎曲方向，避免提早抬手時解算方向接近平行而快速翻轉。

v6在下揮結束後漸進協調前臂的軸向旋轉，使前臂跟隨手掌，不把全部轉角集中在腕部；手掌與指節的世界姿勢、實際爪群位置保持。到達各手後甩位置後，肩鎖骨、上臂、前臂、腕、掌與全部指節改以同一段平滑進度在局部骨架空間回到Idle，隨身體整體移動。沒有肩膀先完成而手掌仍沿另一條全域曲線的分段回位。末段只在爪尖需要接地修正時將整條手臂小幅抬起，保持骨長。`recovery.json`的後部鍵點仍提供進入後甩的切線；後甩以後的位置來自FK回位，不再以舊空間曲線控制。

## 檔案與重建

素材庫位置由 `tools/vfx/vfx-library-root.cjs`解析；目前製作包為 `codex-authored/boss9-lizard-attack3-ref-20261125`。退回版手寫曲線`motion.json`與舊預覽已刪除；定稿採v6檔名，提交前移除v3／v4／v5的18個候選預覽，只保留核准版及必要製作／驗證資料。

- `source/inputs.json`：記錄已確認第二招包內來源GLB／Blend的素材庫相對路徑及SHA，不重複保存同一份大型輸入。GLB SHA256為 `b00d2fd34dcd205368a449208dbb5de573a9a4d266a2060d426177a9baea5da8`；輸出的可編輯Blend本身包含模型與五個Action。重建須同時具備既有第二招包。
- `exports/boss9_attack3.blend`／`.glb`：全新第三招，480Hz、721姿態，原生24FPS、36格。GLB保留原二進位前綴與前四動畫，Blend保留原四個Action。
- `exports/attack1-comparison.json`：直接從核准來源GLB重播Attack1，再與新GLB的手部表面、掌面及指尖方向比對，未拿製作快取當驗證真值。
- `preview/BOSS9_Attack3_v6.gif`／`_Slow.gif`：正常1.5秒與四倍慢放6秒。
- `preview/BOSS9_Attack3_v6_Side.gif`／`_Path.gif`：側面與實際蒙皮爪群路徑；路徑線僅供檢查。
- `source/tools/`、本文件與`qa/`：製作、幾何檢核、渲染與編碼工具，及必要驗證結果。截圖直接在記憶體串流編碼，沒有產生數百個PNG影格。

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack3-ref/author.py -- SOURCE/boss9_attack2.glb SOURCE/boss9_attack2.blend OUTPUT/exports
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack3-ref/verify.py -- SOURCE/boss9_attack2.glb OUTPUT/exports/boss9_attack3.glb OUTPUT/exports/boss9_attack3.blend OUTPUT/exports/validation.json
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack3-ref/compare_attack1.py -- SOURCE/boss9_attack2.glb OUTPUT/exports/boss9_attack3.glb OUTPUT/exports/attack1-comparison.json
node tools/boss9-lizard/attack3-ref/capture.cjs front --python PYTHON_EXECUTABLE
node tools/boss9-lizard/attack3-ref/capture.cjs side --azimuth 70 --python PYTHON_EXECUTABLE
node tools/boss9-lizard/attack3-ref/capture.cjs path --guide --python PYTHON_EXECUTABLE
node tools/boss9-lizard/attack3-ref/export.cjs --stage
```

`--draft`只供快速姿態檢查；正式預覽使用完整480Hz輸出及補間檢查。`capture.cjs front --serve`啟動可播放、暫停、重播與拖曳時間軸的預覽；必要時用`--browser-exe BROWSER_EXECUTABLE`指定受看門狗管理的瀏覽器。

## 驗證界線

先以核准Attack1驗證手勢：第一擊從抬手至下揮結束的全部製作幀，比較手爪主區的實際蒙皮表面與各指節方向；第二擊揮下的全部製作幀，比較鏡射來源的實際爪群路徑、掌面及指節。收招依本次要求改動，因此不再要求它等於Attack1的回地姿態，改獨立檢查懸空收回／後甩。揮擊期間兩側掌面及指向差須小於0.2度，第一擊主區表面與第二擊路徑差須小於0.002模型單位。再於原生及GLB各1441時點檢查骨長、縮放、接地、腳面、接縫、頭部、指鏈及十二組手腳頭／後腿三角形交疊，核對原四Action、GLB前綴與網格／材質／蒙皮資料。另從實際蒙皮量測半程時第二掌抬起、收手至後甩的高度及向後行程；以實際肩／肘／腕與指節向量確認後甩手肘向外下、前臂與爪尖延續斜下。

v6另檢查收手後前臂與手掌間的軸向扭轉，以及回位半程時肩／上臂的角度進度，避免以骨長與位置通過代替腕部姿態驗證。三視角各150張截圖核對完整入鏡及播放控制，所有GIF逐幀解碼驗時長。指定區域三角形檢查不代表全模型任意接觸都已排除；遊戲動畫混合、世界碰撞、傷害與特效仍未接入。使用者已核准動作資產，數值結果記錄於本任務的`docs/AI_TASKS.md`。
