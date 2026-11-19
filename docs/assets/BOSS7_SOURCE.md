# BOSS7 岩石怪三套材質

- 來源：使用者於 2026-11-19 提供 `BOSS7_Walk.glb`、`BOSS7_Attack1.glb`、`BOSS7_Attack2.glb`、`BOSS7_Attack3.glb`、`BOSS7_Die.glb`，並要求接入遊戲。本次只匯入使用者提供的素材，沒有另外引入第三方模型、貼圖或動作；未另行宣稱來源授權條款。
- 素材庫：`codex-authored/boss7-rock-20261119/`。`sources/` 保存原始五檔；`exports/boss7.blend` 保存五動作、打包貼圖及頭像攝影／燈光；`exports/model-qa.json` 記錄 SHA-256、原動作名、原時長及 Blender 版本；`manifest.json` 記錄來源及正式輸出雜湊。
- 製作：Blender 4.5.10 LTS 合併相同骨架的五個動作。模型與原貼圖沿用，未重新繪製。非人形模型不另套 MakeHuman 人體。`tools/boss7/prepare.py` 接受原檔目錄及輸出目錄，產出可編輯來源、GLB 及 1080×1080 透明面部／上半身頭像。重製：`blender -b --python-exit-code 1 -P tools/boss7/prepare.py -- <sources> <exports>`。
- 遊戲輸出：`images/models/npc3d/boss7.glb`、`images/sprites/boss/boss7_rock.png`；由 `node tools/boss7/export.cjs --apply` 從素材庫同步，`--check` 核對原始檔及正式輸出的雜湊。
- 動作：Walk 0.8 秒、Attack1 2.5 秒、Attack2 2.8 秒、Attack3 1.4 秒、Die 65/30 秒。站姿停 Walk 首幀，移動依實際速度調整步幅；三段攻擊沿用現有出手間隔的完整動作調速，死亡原速播放。沒有修改玩家傷害判定或出手節奏。
- 配置：`NPC.xlsx` 的 `NPC!B488` 名稱「岩石怪」、F 外觀圖示、G:J 頭像／備援、AA 備註「外觀：岩石怪1｜」、AB:AH 模型及動作。`tower_boss_7` 用於第 7／57／107 層，第二／第三套樓層對應見下節。屬性、技能、攻速、射程、移速與倍率維持既有配置。
- 名稱與備註以 NPC 表為來源；`tools/config_tables.cjs` 的 `NPC_MODEL_LOOK` 登記 `boss7: 岩石怪`，重建備註時保留外觀名稱。

## 第二與第三套貼圖（2026-11-19）

- 使用者提供 `BOSS7_2.glb`（冰藍）及 `BOSS7_3.glb`（紅黑熔岩），明確要求套用首套五個動作並接入。保存於素材庫 `codex-authored/boss7-rock-variants-20261119/sources/`，來源與SHA-256記於該目錄 `SOURCE.md`、`manifest.json`及 `exports/model-qa_lv2.json`／`model-qa_lv3.json`。未另行引入第三方素材或宣稱其他授權條款。
- 兩份模型的13739頂點、9998三角面與UV均與首套相同；靜止表面位置誤差低於0.000002米。供應骨架骨長略異，第三套另有食指骨，因此透過Blender把材質套回首套核准網格、蒙皮及58骨架，保留已驗證的五個動作，沒有沿用新檔內的Running動畫。三套動作逐軌取樣比對一致。
- `tools/boss7/prepare_variant.py` 以首套可編輯 `boss7.blend`、單一新貼圖GLB、輸出目錄及材質編號2／3為輸入，產出 `boss7_lv2.glb`／`boss7_lv3.glb`、對應可編輯blend、QA及 `boss7_rock_lv2.png`／`boss7_rock_lv3.png`。頭像沿用首套面部及上半身特寫的攝影／燈光。可執行 `node tools/boss7/export.cjs --apply --variants` 同步或 `--check --variants` 核對雜湊；首套預設匯出模式保持。
- `NPC.xlsx` 第498列 `tower_boss_17` 為第二套（第17／67／117層），第508列 `tower_boss_27` 為第三套（第27／77／127層）。名稱均為「岩石怪」，備註分別「外觀：岩石怪2｜」及「外觀：岩石怪3｜」，G:J頭像與AB:AH模型／動作由表管理。屬性、技能、所有戰鬥數值及倍率沿用原列；第37／47等獨立列保持原樣。
