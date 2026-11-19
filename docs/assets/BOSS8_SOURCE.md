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
