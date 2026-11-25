# BOSS9 四足獸死亡動作

任務 `BOSS9-DEATH-20261126`。使用者授權自行構思，沒有提供死亡GIF，後續明確要求完成後直接commit，並保留GIF供視覺檢查。以已核准第三招包的模型、暫代材質、73骨與五個動作為來源，追加 `BOSS9_Death`；提交動作資產，尚未接入實戰。

完整4秒（v2）：依使用者最後要求加大胸頸及頭部仰起幅度，0.22秒達到仰天張口的高點，保持約1秒，帶有微幅長嘯震動；1.22秒後前爪試圖撐住而後腿彎曲失力。重心偏移後加速向一側翻倒，頭與軀幹沉落，四肢及尾部留下短暫餘勢。約2.56秒落地，3.7秒起保持屍體姿勢，不循環回Idle。GIF為方便觀看而重播，GLB動作本身不含起身或回站姿。

所有骨骼使用局部旋轉及固定骨長，腳掌遠端整組隨腿移動，沒有為了貼地獨立扭轉腳趾。兩側前肢先後失去支撐，上側前肢較晚鬆落；尾骨有延遲與衰減。角色落地高度依實際蒙皮表面校正，不以壓扁身體穿入地板。首幀逐點保留來源Idle；來源有一個趾尖低於預覽平面約0.026模型單位，起始保留該外形，再於前0.35秒逐漸接回地面。

`spec.json`保存可調關鍵姿勢、時間與短暫的前肢避讓曲線。`author.py`會重建局部FK及接地校正，保留原GLB二進位前綴、網格、材質、蒙皮與五個動畫，只附加死亡通道；原生Blend保留原五個Action。`--probe`檢查稀疏姿態，`--sweep`及`--sweep-time`只供製作時比較關節角度、表面距離與穿插，不修改正式輸出。

素材庫由`tools/vfx/vfx-library-root.cjs`解析，製作包為`codex-authored/boss9-lizard-death-20261126`：

- `exports/boss9_death.blend`、`.glb`：可編輯模型與六個動作，240Hz、961姿態；原生24FPS、96格。
- `source/inputs.json`：依賴的核准第三招GLB／Blend素材庫相對路徑與SHA，沒有重複複製大型來源。GLB SHA256為`c485d8e0a54221d11483cff639739bcb4552656bc9b26a56bd9ce95311e8498e`。
- `preview/BOSS9_Death_v2.gif`、`_Slow.gif`、`_Side.gif`、`_End.png`：正常4秒、四倍慢放16秒、側面與最後姿勢。正面以25度觀察側翻，側面70度；兩視角固定攝影機，沒有以攝影機動作代替骨架。
- `exports/build.json`、`validation.json`與`qa/`：必要製作及幾何／預覽證據。截圖直接在記憶體中編碼，沒有留下逐張PNG暫存。
- `source/tools`與本文件：可重建工具與規格；`manifest.json`核對輸入、原生／GLB、來源工具及GIF雜湊。

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/death/author.py -- SOURCE/boss9_attack3.glb SOURCE/boss9_attack3.blend OUTPUT/exports
blender -b --python-exit-code 1 -P tools/boss9-lizard/death/verify.py -- SOURCE/boss9_attack3.glb OUTPUT/exports/boss9_death.glb OUTPUT/exports/boss9_death.blend OUTPUT/exports/validation.json
node tools/boss9-lizard/death/capture.cjs front --azimuth 25 --browser-exe CHROME_EXECUTABLE --python PYTHON_EXECUTABLE
node tools/boss9-lizard/death/capture.cjs side --azimuth 70 --browser-exe CHROME_EXECUTABLE --python PYTHON_EXECUTABLE
node tools/boss9-lizard/death/export.cjs --stage
```

驗證涵蓋原五個GLB動畫與原生Action、骨長／尺度、腳面剛體形狀、接地、屍體側倒與末段保持、十組指定手／腳／頭／軀幹三角形交疊，以及原生與GLB表面一致性；原生與GLB各檢查1921個鍵格及錯相補間時點。另檢查1秒長嘯區間的頭部仰角大於65度、下顎張開大於25度。兩視角逐幀核對入鏡、播放控制與Console，GIF逐幀解碼核對時長。指定區域檢查不代表全模型任意接觸都已排除；遊戲死亡狀態切換、淡出與碰撞尚未接入。
