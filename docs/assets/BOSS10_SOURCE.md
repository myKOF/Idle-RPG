# 熔岩巨人 BOSS10 首套材質

使用者提供五個帶動作的 GLB。五個檔案的共用模型含52根骨骼、14,057個頂點及3張內嵌貼圖。製作工具檢查骨架、蒙皮、網格及材質一致性，再把五段原始動畫接入同一個 GLB，逐位元比對時間與取樣資料。Blender 重開成品，保存可編輯的 blend 及1080透明頭像。

| 遊戲動作 | 來源內的動作 | 時長 |
| --- | --- | ---: |
| Walk | Monster_Walk | 4.10秒 |
| Attack1 | Heavy_Hammer_Swing | 1.83秒 |
| Attack2 | Attack | 2.80秒 |
| Attack3 | Left_Slash | 3.17秒 |
| Die | Dead | 2.97秒 |

NPC.xlsx 第491列 `tower_boss_10` 綁定第10／60／110層，名稱「熔岩巨人」、備註「外觀：熔岩巨人1」、模型 `images/models/npc3d/boss10.glb`、頭像 `sprites/boss/boss10_lava.png`。站立使用 Walk 起始姿勢，三段攻擊依既有 NPC 3D 規則輪替。

素材庫 `codex-authored/boss10-lava-20261124/` 包含原檔、成品、Blender檔、頭像、工具、來源SHA-256及驗證報告。製作用 `blender -b --python-exit-code 1 -P tools/boss10/prepare.py -- <sources> <exports>`。匯出用 `node tools/boss10/export.cjs --apply`，驗證用 `--check`。

## 第二套材質

`BOSS10_2.glb` 是冰霜外觀，含52根骨骼、14,061個頂點及3張內嵌貼圖。成品保留第二套的網格、UV、蒙皮、材質及靜止骨架，將首套五個動作的旋轉、位移及比例帶入第二套骨架座標，沿用原取樣時間。右手兩支指骨鏈以關節位置對應，因為來源匯出的拇指與中指鏈名稱互換。第二套原檔內的 Running 只存於素材庫來源檔。

NPC.xlsx 第501列 `tower_boss_20` 綁定第20／70／120層，名稱「熔岩巨人」，外觀備註「熔岩巨人2」，使用 `images/models/npc3d/boss10_lv2.glb` 及 `sprites/boss/boss10_lava_lv2.png`。

素材庫 `codex-authored/boss10-lava-variant2-20261124/` 保存來源、成品、可編輯 Blender 檔、頭像及驗證。製作用 `blender -b --python-exit-code 1 -P tools/boss10/prepare_variant.py -- <首套遊戲GLB> <BOSS10_2.glb> <exports>`。匯出用 `node tools/boss10/export.cjs --apply --variants`，驗證用 `--check --variants`。

## 第三套材質

`BOSS10_3.glb` 是紫晶岩石外觀，含54根骨骼、14,070個頂點及3張內嵌貼圖。五個動作沿用首套取樣時間，按第三套的靜止骨架調整旋轉、位移與比例。右手兩支指骨鏈依實際位置配對。左腿額外的 Bone_004、Bone_003 沿原骨骼層級跟隨左腿，維持原始蒙皮，左腳與腳趾也保留動作。

NPC.xlsx 第511列 `tower_boss_30` 綁定第30／80／130層，名稱「熔岩巨人」，外觀備註「熔岩巨人3」，使用 `images/models/npc3d/boss10_lv3.glb` 及 `sprites/boss/boss10_lava_lv3.png`。

素材庫 `codex-authored/boss10-lava-variant3-20261124/` 保存原檔、五動作成品、可編輯 Blender 檔、1080透明頭像及驗證。製作用 `blender -b --python-exit-code 1 -P tools/boss10/prepare_variant.py -- <首套遊戲GLB> <BOSS10_3.glb> <exports> 3`。匯出用 `node tools/boss10/export.cjs --apply --material3`，驗證用 `--check --material3`。
