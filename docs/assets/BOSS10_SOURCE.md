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
