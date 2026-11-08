# 封魔塔 BOSS1 3D 預覽來源與交接

任務：`TOWER-BOSS1-3D-PREVIEW-20261108`、`TOWER-BOSS1-3D-REV2-20261108`，Codex。第二版依使用者回饋修正披風上翹與正握方向，提供第三招正面五倍慢動作高清 GIF；**尚未接入正式戰鬥渲染器**。NPC 表與生成資料已保存 3D 配置。

## 授權與來源

使用者於 2026-11-08 本聊天提供五份 GLB，並明確確認「這些是我自製／自行生成的素材，可用於本遊戲並修改」。沿用使用者模型、貼圖與動作。第一版的程序化手甲已由 MakeHuman 真實手部拓樸取代；新握柄與手部姿勢／擬合在 Blender 製作。第二版以使用者最新的人物右側持劍照片為準：右側鏡頭看到手背、掌面朝身體、四指包住握柄、拇指朝劍格。兩張參考圖只用於姿勢判讀，沒有匯入圖像或文字。

手部採官方 [MakeHuman MPFB](https://github.com/makehumancommunity/mpfb2) 的 CC0 人體資產，版本 `b1a2dc98776da9d1eea751b159d42cf61778fe2e`。`base.obj` 檔頭明載 CC0，搭配同庫的 `rig.mixamo.json`、`weights.mixamo.json`；保留四個原始檔與 `LICENSE.ASSETS.md`、來源 SHA。完整 CC0 授權另匯出至 `images/models/npc3d/MAKEHUMAN_LICENSE.txt`。生成參數為男性 1、年齡 0.5、肌肉／體重 0.45、身高／比例 0.5、三族比例各 0.33；完整參數及版本保存在 `editable/hand-source.json`，人體／指骨姿勢及擬合手網格保存在 `editable/BOSS1_anatomical_hand.blend`。僅取其右手作為銀色手套，未替換原角色身體、盔甲或貼圖。

| 原檔 | SHA-256 |
| --- | --- |
| BOSS1_Walk.glb | 57f25a7a22ff299968e659a8abe3eb8e2d6e3f670c7f065e4af355eedf8965aa |
| BOSS1_Attack1.glb | bbba59140681e125318398b157c7e67c6ea0b17379b98833c971c6e4f47b7b9a |
| BOSS1_Attack2.glb | 83f98ae01b2a266d5bd335110874a703833fa2985fc81917791cc325123b0e5a |
| BOSS1_Attack3.glb | 5c66dfaef36662647e4400171d3e1d96fd9d065d6327bfd1801489a0705dbf41 |
| BOSS1_Die.glb | da1cf3e807abfc266325cad5933bdc5f76201ac502c8b7fa2796540590548a6d |

素材庫由 `tools/vfx/vfx-library-root.cjs` 解析，目前套件為 `codex-authored/tower-boss1-3d-20261108-v2/`；第一版 `codex-authored/tower-boss1-3d-20261108/` 完整保留。`sources/` 保存五個原檔，`editable/BOSS1_preview.blend` 是貼圖已打包的可編輯來源，`exports/boss1.glb` 對應遊戲專案 `images/models/npc3d/boss1.glb`。`manifest.json` 記錄來源、製作工具、輸出與 QA 的 SHA。預覽 PNG／GIF 是聊天交付產物，不納入 Git。

## 製作方式

角色身體沿用使用者底模；新增手部使用上述 MakeHuman 人體／指骨製作。編修、骨骼、動作烘焙、GLB 匯出與預覽皆使用 Blender 5.2.3 LTS。

- 保留原劍身、護手及紅寶石劍首的幾何與 UV；拆出獨立 `BOSS1_Sword`，補整握柄。
- 獨立 `Sword_R` 骨骼以 `mixamorig:RightHand` 為父骨；整把劍僅有一項 100% 權重，避免刀刃被身體／腿部骨骼拉彎。
- 保留原護臂，移除舊手掌／手指後，接上以 MakeHuman 指骨彎曲的右手；拇指／食指朝劍格，小指朝劍首。低持劍時手背朝人物右側、掌面朝身體，前臂沿自身軸旋轉承接握姿，手腕連接區在前臂與右手之間漸變權重。手指固定為握拳，五動作共用相同握點。
- 五個原始動作保持原速，右手朝向校正為持劍姿勢；落劍時以整把武器的最低頂點修正手腕，避免只檢查劍尖而忽略護手或劍首。
- 走路與三個攻擊採原地根骨，位置由後續遊戲移動控制；保留跳躍高度、全身轉動及死亡向前倒地位移。
- 第二版把背部披風拆成獨立 `BOSS1_Cape`，保留原幾何／UV，解除腿骨與原披風骨的混合權重，改由 `Cape_Upper / Cape_Middle / Cape_Lower` 與上背連接。上段跟隨背部位置，下段保持重力向下，沉身／倒地時向身後低處鋪開；肩部殘留邊緣的原四根披風骨共用同一曲線，避免接縫上翹或拉扯肩甲。
- 披風是烘焙的骨骼動畫，未新增即時布料模擬。原前方裙襬、頭髮與其他衣甲保留原動作／權重；未做全身布料或盔甲碰撞處理。

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
2. Blender 先執行 `tools/meshy-pipeline/blender/build_tower_boss_hand.py -- <上述版本 MPFB checkout> <手部輸出資料夾>`，再執行 `tools/meshy-pipeline/blender/prepare_tower_boss1.py -- <五個原檔所在資料夾> <製作輸出資料夾> --hand-source <手部輸出資料夾>/BOSS1_anatomical_hand.blend`，輸出 Blender、GLB 與握點 QA。已有素材庫手部 Blend 時可直接使用，不必重新安裝 MPFB。更新必要來源及 manifest 後依雙倉庫流程提交。
3. `node tools/config_tables.cjs --apply NPC` 應回報語意變更 0。
4. Blender 執行 `tools/meshy-pipeline/blender/qa_tower_boss1.py -- <實際 GLB> <QA.json>`，逐幀檢查披風骨向下、下襬低於肩部、武器不入地、握點誤差、拇指朝劍格，並確認披風沒有腿骨權重。使用手部真正的手背法向檢查低持劍 Walk 朝人物右側；攻擊揮劍、倒地時手掌隨原動作旋轉，不強迫全程朝同一方向。數值不能代替握姿目視，另檢視人物右側／前側近照及實際動作影格。
5. Blender 執行 `tools/meshy-pipeline/blender/render_tower_boss1.py -- <全新預覽資料夾> --only Attack3 --camera front --speed 0.2`。由 NPC 表讀 GLB 與動作名稱，重新匯入實際 GLB，以 EEVEE 原生 1080×1080、25 fps 逐幀渲染。固定正面鏡頭保留原動作轉身，沒有讓鏡頭跟著角色旋轉。原第三招 2.967 秒，檢視片段延長為 14.833 秒。
6. `python tools/meshy-pipeline/package_tower_boss1.py <預覽資料夾>` 輸出 1080×1144 GIF，表頭標示正面與 0.2 倍速；結尾短暫停留後重播。省略 `--only` 可重建五動作與總覽；變更鏡頭／速度／fps 時須使用不同目錄，避免混入舊影格。
7. `node --test tests/npc3d-config.test.cjs tests/npc-vision.test.cjs tests/worker-protocol.test.cjs tests/vfx-editor-cache-versions.test.cjs`。

第二版上述四檔 30/30 通過，並增加披風獨立網格／專用骨架／無腿骨權重檢查。第一版較廣套件的三項原有失敗仍留存紀錄（NPC-SKILL-4 的既有生成備註／縮放差異、NPC-SPRITE-4 的既有空白圖像備註、NPC-SPRITE-5 假定哥布林縮放仍為 1）；當時已在隔離副本以修改前版本確認同名失敗。第二版未改這些測試、原配置或對應玩法。

第二版最終 GLB 重匯入共檢查 684 幀：披風下襬至少低於肩部 0.180 米，披風最低 0.027 米，全劍最低 0.035 米，握點誤差低於 0.000001 米；拇指末節與刀刃方向點積 0.884，Walk 手背朝人物右側投影點積至少 0.963。舊版以握點到掌心的向量推論手背方向並不可靠，已由真正的手背法向與右側鏡頭取代。手套為單色銀色材質，未新增手部細節貼圖；仍須由使用者檢視本輪握姿。

第一版已同步主頁 data／bridge 與 Worker 資料快取。第二版只修模型及製作／檢視工具，NPC 表中的模型路徑與五動作名稱、data、前端／Worker 腳本及快取均保持；0.2 倍速僅用於檢視，沒有修改 GLB 原片段時長、遊戲攻速或命中時序。正式遊戲 3D、攻擊事件對時、效能與實戰驗收留待預覽確認後接入，不宣稱已完成。
