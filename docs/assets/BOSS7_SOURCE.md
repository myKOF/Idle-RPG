# BOSS7 岩石怪第一套材質

- 來源：使用者於 2026-11-19 提供 `BOSS7_Walk.glb`、`BOSS7_Attack1.glb`、`BOSS7_Attack2.glb`、`BOSS7_Attack3.glb`、`BOSS7_Die.glb`，並要求接入遊戲。本次只匯入使用者提供的素材，沒有另外引入第三方模型、貼圖或動作；未另行宣稱來源授權條款。
- 素材庫：`codex-authored/boss7-rock-20261119/`。`sources/` 保存原始五檔；`exports/boss7.blend` 保存五動作、打包貼圖及頭像攝影／燈光；`exports/model-qa.json` 記錄 SHA-256、原動作名、原時長及 Blender 版本；`manifest.json` 記錄來源及正式輸出雜湊。
- 製作：Blender 4.5.10 LTS 合併相同骨架的五個動作。模型與原貼圖沿用，未重新繪製。非人形模型不另套 MakeHuman 人體。`tools/boss7/prepare.py` 接受原檔目錄及輸出目錄，產出可編輯來源、GLB 及 1080×1080 透明面部／上半身頭像。重製：`blender -b --python-exit-code 1 -P tools/boss7/prepare.py -- <sources> <exports>`。
- 遊戲輸出：`images/models/npc3d/boss7.glb`、`images/sprites/boss/boss7_rock.png`；由 `node tools/boss7/export.cjs --apply` 從素材庫同步，`--check` 核對原始檔及正式輸出的雜湊。
- 動作：Walk 0.8 秒、Attack1 2.5 秒、Attack2 2.8 秒、Attack3 1.4 秒、Die 65/30 秒。站姿停 Walk 首幀，移動依實際速度調整步幅；三段攻擊沿用現有出手間隔的完整動作調速，死亡原速播放。沒有修改玩家傷害判定或出手節奏。
- 配置：`NPC.xlsx` 的 `NPC!B488` 名稱「岩石怪」、F 外觀圖示、G:J 頭像／備援、AA 備註「外觀：岩石怪1｜」、AB:AH 模型及動作。`tower_boss_7` 用於第 7／57／107 層；第 17、27、37、47 等獨立列不變。屬性、技能、攻速、射程、移速與倍率維持既有配置。
- 名稱與備註以 NPC 表為來源；`tools/config_tables.cjs` 的 `NPC_MODEL_LOOK` 登記 `boss7: 岩石怪`，重建備註時保留外觀名稱。
