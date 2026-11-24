# BOSS9 第三招：右爪接左爪連續斜揮

任務 `BOSS9-ATTACK3-20261124`。使用者已驗收前兩招，第三招以核准Attack1的右爪高舉、斜掃與漸進翻掌為基礎，再銜接相反側的左爪斜掃，完整1.5秒。先交GIF；純動作預覽，沒有接入遊戲、傷害、特效或音效。

## 時間軸

右側從0秒啟動，在約0.411–0.550秒斜揮；左側準備於0.620秒開始，約1.031–1.170秒以相反手臂斜揮，1.5秒回Idle。右擊收招與左擊準備自然重疊，兩次有效斜掃分開，沒有中間播放一次靜止待機。

雙後腳固定，root沒有水平位移。胸背、肩胛、肘腕、指節與尾部隨兩側發力；頭部以完整姿態穩定朝前，包含側傾補償。依使用者27628bc3圖修正：鎖定踝／腳掌／腳趾整組世界姿態，再解算大腿與小腿，保留腳面外形；左側高舉按其實際指鏈張直指節，保留輕微自然爪曲，不沿用右側手指的相對轉角硬套。保留核准模型的73骨、網格、權重、暫代材質，以及Walk／Idle／Attack1／Attack2。

## 來源與製作

來源為已核准第二招素材庫提交 `60aa2bb6c1e48bdb81bdb04b9ee9e016cdc48f40`，其GLB SHA256 `b00d2fd34dcd205368a449208dbb5de573a9a4d266a2060d426177a9baea5da8`。包內保留相同的 `source/boss9_attack2.glb`與`.blend`。動畫參考直接取該檔內已核准 `BOSS9_Attack1`，不引用新的外部動作或圖片像素。

第一招的實際骨架與蒙皮爪群以480Hz採樣，右擊保留其路徑與掌形，左擊鏡射動向並按左側骨長、原掌形與指鏈重新解算。不能直接負縮放整個模型或交換骨骼名稱；左右骨架與掌面並非完全對稱。`exports/reference-samples.json`保存帶GLB／Blend雜湊的採樣，僅為重建快取，獨立驗證仍從原GLB重新取樣。頭部保持第一招核准高舉時的正面朝向，臉部、下顎與冠刺使用同一個未鏡射的頭部模板；爪回收接近面部時，頸部沿原長度小幅抬起後收，頭眼仍朝前。

重心位移沿用第一招的hips控制平移；root→hips是重心控制連結，其頭距可變，不視為肢體拉長。其餘實體父子鏈與全部縮放維持；後腿以固定足端解算接回，頭頸保持前視。兩個發力段以原生世界旋轉的相對增量連動，手臂解算追蹤實際爪群，不以變形或拉長手臂補距離。左擊時依較短的右側承重鏈平順下沉最多0.085模型單位，讓右爪能確實撐地；右擊身體不受此修正影響。

## 檔案與重建

素材庫由 `tools/vfx/vfx-library-root.cjs`解析，穩定包路徑 `codex-authored/boss9-lizard-attack3-20261124`。

- `exports/boss9_attack3.blend`／`.glb`：保留前四動畫，新增第三招；721姿態、480Hz，原生場景24FPS、36格。
- `preview/BOSS9_Attack3.gif`、`_Side.gif`、`_Path.gif`：正面、側面及實際爪群軌跡，75張×20ms＝1.5秒。
- `preview/BOSS9_Attack3_Slow.gif`：完整4倍慢放，150張×40ms＝6秒。路徑細線是檢視標記，不是遊戲VFX。
- `preview/BOSS9_Attack3_Right.png`／`_Left.png`：右側0.41秒、左側1.03秒高舉對照。
- `source/tools/`、本文件與 `qa/`：製作／驗證／預覽來源，三視圖擷取數據、聯絡圖、編碼與必要日誌。影格在記憶體內串流編碼，沒有新增450張PNG暫存。

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack3/author.py -- SOURCE/boss9_attack2.glb SOURCE/boss9_attack2.blend OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack3/verify.py -- SOURCE/boss9_attack2.glb OUTPUT_DIR/boss9_attack3.glb OUTPUT_DIR/boss9_attack3.blend OUTPUT_DIR/validation.json
node tools/boss9-lizard/attack3/capture.cjs front --azimuth 0 --python PYTHON_EXECUTABLE
node tools/boss9-lizard/attack3/capture.cjs side --azimuth 75 --python PYTHON_EXECUTABLE
node tools/boss9-lizard/attack3/capture.cjs path --azimuth 0 --guide --python PYTHON_EXECUTABLE
node tools/boss9-lizard/attack3/export.cjs --stage
```

捕捉工具直接把畫面串流至encode.py，產生包內成品與QA。`capture.cjs front --serve`提供可播放、暫停、重播、拖時間軸的預覽網址。author的 `--probe`只作姿態診斷，不輸出Blend／GLB；正式完整驗證不能以此取代。

## 驗證與限制

原GLB二進位前綴及四個動畫逐值保持；原生四動作另核對曲線雜湊。Blend／GLB各1441時點含錯相補間，檢查骨鏈／尺度、固定腳掌／接地、零水平root、原Idle與首末接縫、頂點等價、兩側抬爪順序／斜掃方向／掌面朝上、支撐爪與頭部前視及側傾。另對腳面實際蒙皮頂點比對核准Idle外形，並量測高舉指鏈伸展率，避免只有足端骨固定但腳面仍被踝骨拉扯。路徑以原GLB獨立重採第一招作比較，檢查手／腳／頭八組指定三角形穿插。

三視圖450張核對完整入鏡、實際播放／暫停／重播及正反拖曳，四GIF逐幀解碼並核對SHA。原自動蒙皮的局部拉伸及未涵蓋甲片接觸仍可能存在，指定區域檢查不代表全網格任意接觸均已排除。正式世界碰撞、遊戲動畫混合與傷害未接入；動作仍待使用者看GIF驗收。
