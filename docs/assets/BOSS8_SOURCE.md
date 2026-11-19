# BOSS8 石像鬼：正式第一套貼圖

2026-11-19使用者確認第四版五個動作可用，提供新的正式第一套貼圖模型，並將外觀名稱改為「石像鬼」。來源為使用者提供的 `BOSS8.glb`，SHA-256 `3bd2450700cee2296fa03f9449caa021a8d30fa08aea1ab9638edb6d41b213e4`；沒有引入外部模型、材質或動作，也未另行宣稱來源授權條款。

素材庫 `codex-authored/boss8-gargoyle-20261119/` 保存原始GLB、打包貼圖的可編輯 `exports/boss8.blend`、正式GLB、1080透明面部／上半身頭像、工具、骨架差異及驗證報告。核准動作來源為相鄰素材包 `boss8-animation-preview-v4-20261119/exports/boss8_preview.blend`，該來源及製作歷史保持。

正式模型有18,029頂點、10,338三角面、70骨骼，保留使用者的網格、UV、權重、骨骼層級、靜止姿勢及正式材質（底色／法線／金屬粗糙度）。骨名與層級相同，但多處關節位置、方向及骨長變動，尾巴Bone022至Bone015尤其明顯；不是將舊材質換圖或直接複製局部旋轉軌。Blender在世界靜止空間對應各骨骼旋轉差量，依新骨長計算連接位置，五動作逐個烘焙；死亡末姿依正式網格修正接地。

| 動作 | 時長 | 內容 |
| --- | --- | --- |
| Walk | 1.6秒 | 拍翼懸浮與尾部跟隨 |
| Attack1 | 1.7333秒 | 左爪高舉下劈、全身向右約半圈跟轉，核准1.5倍速 |
| Attack2 | 2.08秒 | 全身蓄力雙爪劈向前下方，手臂方向提高45度，核准1.25倍速 |
| Attack3 | 2.4秒 | 拉升、收翼俯衝撲擊與回復 |
| Die | 3.7667秒 | 短促掙扎、失速墜地與側躺保持 |

正式接線：`images/models/npc3d/boss8.glb`、`images/sprites/boss/boss8_gargoyle.png`。NPC.xlsx的NPC第489列 `tower_boss_8` 管理名稱「石像鬼」、備註「外觀：石像鬼1｜」、頭像及Walk／Attack1～3／Die。對應封魔塔第8／58／108層；其他材質與獨立列保持原樣。既有光屬性、火球／治癒技能、出手頻率、射程、移速及倍率不變，遊戲沿用既有NPC 3D流程按戰鬥出手間隔調速，死亡原速播放。

重製：`blender -b --python-exit-code 1 -P tools/boss8/prepare_game.py -- <approved-v4.blend> <formal-BOSS8.glb> <exports>`；驗證：`blender -b --python-exit-code 1 -P tools/boss8/verify_game.py -- <boss8.blend> <formal-BOSS8.glb> <validation.json>`；匯出及雜湊：`node tools/boss8/export.cjs --apply`／`--check`。

## 第二套材質（2026-11-19）

使用者提供 `BOSS8_2.glb`，SHA-256 `8f026595ce2dca45026633922ce00a79b56a5160a73719bd891d44d44f14d714`。第二套為青綠石膚、紫色角與翼緣，18,030頂點／10,338三角面／70骨骼；尾骨的長度及方向和第一套不同。沿用核准v4動作來源，直接對應到第二套自己的靜止骨架，保留第二套網格、UV、蒙皮、尾鏈及三張正式貼圖，沒有將第二套材質套回首套網格。

素材庫 `codex-authored/boss8-gargoyle-variant2-20261119/` 保存原檔、`exports/boss8_lv2.blend`、五動作 `boss8_lv2.glb`、1080透明頭像及工具／QA／清單。動作與首套時長相同，死亡段逐150FPS幀依第二套表面修正接地，避免長尾在補間幀穿地；第一套素材包及正式輸出保持原樣。製作命令最後加參數 `2`，即可使用第二套輸出檔名；驗證工具接受第二套blend及原檔。

NPC.xlsx第499列 `tower_boss_18` 管理第18／68／118層，名稱「石像鬼」、備註「外觀：石像鬼2｜」，模型為 `images/models/npc3d/boss8_lv2.glb`，頭像為 `sprites/boss/boss8_gargoyle_lv2.png`。技能、屬性、攻速、射程、移速、倍率及其他列保持。`node tools/boss8/export.cjs --apply --variants`／`--check --variants` 處理第二套；實機 `node tools/boss8/verify_ingame.cjs <output> 18`。

## 第三套材質（2026-11-19）

使用者提供的 `BOSS8_3.glb` 採紅黑石膚與翼部符紋，含18,030頂點、10,338三角面及70根骨骼。原始SHA-256為 `5982ebee9e75f866a53e4e16123a56e6b2fd2c141e1f40a0f97cefe40d47fb45`。以核准的第四版動作直接對應第三套的靜止骨架與尾鏈，保留原網格、UV、蒙皮與三張正式貼圖。死亡段逐150FPS幀依第三套表面校正接地。

素材庫 `codex-authored/boss8-gargoyle-variant3-20261119/` 保存原檔、可編輯的 `boss8_lv3.blend`、五動作GLB、1080透明頭像及驗證報告。製作命令的最後參數填 `3`。使用 `node tools/boss8/export.cjs --apply --material3` 匯出，`--check --material3` 驗證雜湊。以 `node tools/boss8/verify_ingame.cjs <output> 28` 驗證遊戲載入。

NPC.xlsx第509列 `tower_boss_28` 管理第28／78／128層，名稱為「石像鬼」，備註為「外觀：石像鬼3｜」。該列綁定 `images/models/npc3d/boss8_lv3.glb`、`sprites/boss/boss8_gargoyle_lv3.png` 與核准的五個動作。
