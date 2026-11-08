# 封魔塔 BOSS1 3D 預覽來源與交接

任務：`TOWER-BOSS1-3D-PREVIEW-20261108`，Codex。此輪交付五動作及高清 GIF 供使用者檢視；**尚未接入正式戰鬥渲染器**。NPC 表與生成資料已保存 3D 配置。

## 授權與來源

使用者於 2026-11-08 本聊天提供五份 GLB，並明確確認「這些是我自製／自行生成的素材，可用於本遊戲並修改」。沿用使用者模型、貼圖與動作，不新增其他外部美術來源。新握柄與封閉式銀色分節手甲由 Codex 在 Blender 自製。

| 原檔 | SHA-256 |
| --- | --- |
| BOSS1_Walk.glb | 57f25a7a22ff299968e659a8abe3eb8e2d6e3f670c7f065e4af355eedf8965aa |
| BOSS1_Attack1.glb | bbba59140681e125318398b157c7e67c6ea0b17379b98833c971c6e4f47b7b9a |
| BOSS1_Attack2.glb | 83f98ae01b2a266d5bd335110874a703833fa2985fc81917791cc325123b0e5a |
| BOSS1_Attack3.glb | 5c66dfaef36662647e4400171d3e1d96fd9d065d6327bfd1801489a0705dbf41 |
| BOSS1_Die.glb | da1cf3e807abfc266325cad5933bdc5f76201ac502c8b7fa2796540590548a6d |

素材庫由 `tools/vfx/vfx-library-root.cjs` 解析，套件相對位置為 `codex-authored/tower-boss1-3d-20261108/`。`sources/` 保存五個原檔，`editable/BOSS1_preview.blend` 是貼圖已打包的可編輯來源，`exports/boss1.glb` 對應遊戲專案 `images/models/npc3d/boss1.glb`。`manifest.json` 記錄每份來源、製作工具與輸出的 SHA。預覽 PNG／GIF 是聊天交付產物，不納入 Git。

## 製作方式

沿用既有自製人物底模，沒有另外生成或替換人體，沒有虛構 MakeHuman 參數。編修、骨骼、動作烘焙、GLB 匯出與預覽皆使用 Blender 5.2.3 LTS。

- 保留原劍身、護手及紅寶石劍首的幾何與 UV；拆出獨立 `BOSS1_Sword`，補整握柄。
- 獨立 `Sword_R` 骨骼以 `mixamorig:RightHand` 為父骨；整把劍僅有一項 100% 權重，避免刀刃被身體／腿部骨骼拉彎。
- 保留原手腕與護臂，重建握柄周圍的掌部及四指／拇指分節。新手甲剛性綁定右手，所有動作使用相同握點。
- 五個原始動作保持原速，右手朝向校正為持劍姿勢；落劍時以整把武器的最低頂點修正手腕，避免只檢查劍尖而忽略護手或劍首。
- 走路與三個攻擊採原地根骨，位置由後續遊戲移動控制；保留跳躍高度、全身轉動及死亡向前倒地位移。
- 來源披風及衣甲沿用原骨架權重；本輪未另做布料物理或全身重綁。少數大幅沉身姿勢的衣襬可接近／穿過地面，仍需使用者檢視是否追加布料修整。

## NPC 表欄位

權威來源為 `config/Excel/NPC.xlsx` 的 `NPC` 工作表，`W:AC`；封魔塔十列位於第 482–491 列，各列可獨立換模型與動作。原有四欄 2D 圖像、備註、數值與技能均保留。原生 Excel 修改並正常模式重開驗證，原兩張工作表的既有資料、公式及物件保留。

| 欄位 | 目前值 | 用途 |
| --- | --- | --- |
| 3D模型 | images/models/npc3d/boss1.glb | 相對專案根目錄的 GLB |
| 3D站立動作 | Walk | 使用首幀停格，未增加第六個動作 |
| 3D移動動作 | Walk | 8.667 秒循環 |
| 3D攻擊1動作 | Attack1 | 5.867 秒 |
| 3D攻擊2動作 | Attack2 | 2.967 秒 |
| 3D攻擊3動作 | Attack3 | 2.967 秒 |
| 3D死亡動作 | Die | 2.167 秒，倒地後保持末幀 |

表頭的 Excel 註解記錄原始動作檔名。修改後沿用「套用參數.bat」或既有 Excel→CSV→`config_tables` 流程；生成 `BOSS_LIST[].model3d`。GLB 路徑、檔案存在性及每個動作名稱都會驗證；錯誤時中止套用。模型及動作欄位全清空可取消該列綁定。站立取首幀／死亡停末幀是後續接入的語意，現行遊戲尚未消費此 3D 配置。

## 重建與驗證

1. `node tools/meshy-pipeline/src/export-tower-boss1.cjs --check` 檢查素材庫與專案雜湊。
2. Blender 執行 `tools/meshy-pipeline/blender/prepare_tower_boss1.py -- <五個原檔所在資料夾> <製作輸出資料夾>`，輸出 Blender、GLB 與握點 QA。更新必要來源及 manifest 後依雙倉庫流程提交，不覆寫使用者尚未確認的預覽。
3. `node tools/config_tables.cjs --apply NPC` 應回報語意變更 0。
4. Blender 執行 `tools/meshy-pipeline/blender/render_tower_boss1.py -- <預覽資料夾>`，由 NPC 表讀 GLB 與動作名稱，重新匯入實際 GLB，以 EEVEE 原生 1080×1080、25 fps 逐幀渲染。
5. `python tools/meshy-pipeline/package_tower_boss1.py <預覽資料夾>` 輸出五個 1080×1144 GIF 與 1920×1200 總覽。GIF 使用共用調色盤，保留來源速度；單次動作在結尾短暫停留後重播。
6. `node --test tests/npc3d-config.test.cjs tests/npc-sprites.test.cjs tests/npc-vision.test.cjs tests/npc-elite-skills.test.cjs tests/worker-protocol.test.cjs tests/vfx-editor-cache-versions.test.cjs`。

本輪 Build 與新增 3D 測試通過；上述相關套件有三項原有失敗（NPC-SKILL-4 的既有生成備註／縮放差異、NPC-SPRITE-4 的既有空白圖像備註、NPC-SPRITE-5 假定哥布林縮放仍為 1）。在隔離副本使用修改前 HEAD 的測試、配置工具、NPC.csv 與 data.js 重跑，三項同名失敗。沒有弱化這些斷言或改動原配置來讓測試通過。NPC-SKILL-1 的完整表頭斷言依新欄位擴充。

主頁 data／bridge 及 Worker 資料快取同步；Worker 協議、戰鬥／存檔與解鎖不變。首頁與 Claude 的音效快取改動不同區段，使用共同祖先及對方分支三方試跑 exit 0；本輪未合入對方修改。正式遊戲 3D、攻擊事件對時、效能與實戰驗收留待預覽確認後接入，不宣稱已完成。
