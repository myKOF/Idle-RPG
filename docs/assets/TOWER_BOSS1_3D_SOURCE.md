# 封魔塔 BOSS1 3D 預覽來源與交接

任務：`TOWER-BOSS1-CAPE-20261108`、`TOWER-SKELETON-KING-20261108`，Codex。使用者已認可手部，本輪保留握姿、增加披風避碰，並將封魔塔第一種 BOSS 改為「骷髏王」，接入實際 3D 戰鬥顯示。第三招另提供正面五倍慢動作，五動作提供背面預覽。

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

素材庫由 `tools/vfx/vfx-library-root.cjs` 解析，目前套件為 `codex-authored/tower-boss1-3d-20261108-v3/`；前兩版完整保留。`sources/` 保存五個原檔與已認可的上一版 GLB，`editable/BOSS1_preview.blend` 是貼圖已打包的可編輯來源，`exports/boss1.glb` 對應 `images/models/npc3d/boss1.glb`。`exports/boss_skeleton_king.png` 是同一實際 GLB 渲染的透明頭像，對應 `images/sprites/boss/`。manifest 記錄來源、製作工具、輸出與 QA 的 SHA。聊天預覽 PNG／GIF 不納入 Git，正式頭像保留。

## 製作方式

角色身體沿用使用者底模；新增手部使用上述 MakeHuman 人體／指骨製作。編修、骨骼、動作烘焙、GLB 匯出與預覽皆使用 Blender 5.2.3 LTS。

- 保留原劍身、護手及紅寶石劍首的幾何與 UV；拆出獨立 `BOSS1_Sword`，補整握柄。
- 獨立 `Sword_R` 骨骼以 `mixamorig:RightHand` 為父骨；整把劍僅有一項 100% 權重，避免刀刃被身體／腿部骨骼拉彎。
- 保留原護臂，移除舊手掌／手指後，接上以 MakeHuman 指骨彎曲的右手；拇指／食指朝劍格，小指朝劍首。低持劍時手背朝人物右側、掌面朝身體，前臂沿自身軸旋轉承接握姿，手腕連接區在前臂與右手之間漸變權重。手指固定為握拳，五動作共用相同握點。
- 五個原始動作保持原速，右手朝向校正為持劍姿勢；落劍時以整把武器的最低頂點修正手腕，避免只檢查劍尖而忽略護手或劍首。
- 走路與三個攻擊採原地根骨，位置由後續遊戲移動控制；保留跳躍高度、全身轉動及死亡向前倒地位移。
- 第二版把背部披風拆成獨立 `BOSS1_Cape`，保留原幾何／UV，解除腿骨與原披風骨的混合權重，改由 `Cape_Upper / Cape_Middle / Cape_Lower` 與上背連接。上段跟隨背部位置，下段保持重力向下，沉身／倒地時向身後低處鋪開；肩部殘留邊緣的原四根披風骨共用同一曲線，避免接縫上翹或拉扯肩甲。
- 披風是烘焙的骨骼動畫，未新增即時布料模擬。原前方裙襬、頭髮與其他衣甲保留原動作／權重；未做全身布料或盔甲碰撞處理。

第三版在使用者認可的實際 GLB 上追加 `CapeFit_00_00` 等 15×9 個骨骼。披風原幾何／UV 保留，每個頂點最多四根骨權重。先擬合原重力垂墜，再依當幀實際身體／衣甲三角面向背側避讓，另做整片三角面交叉處理與地面限制，接觸解除短暫緩放。碰撞結果以 60 fps 烘焙；原角色與武器動作的時間、姿勢保持，沒有執行期布料成本。使用已匯出的 GLB 作為輸入，可保留使用者實際看到的四元數插值，避免 Blender 來源的 Bezier 中間姿勢改變握劍。

## NPC 表欄位

權威來源為 `config/Excel/NPC.xlsx` 的 `NPC` 工作表。第 482 列 `tower_boss_1` 名稱為骷髏王，`W:AC` 保存模型與五個動作。第 483–491 列撤下尚未接入的預填 3D 綁定，維持原外觀；之後仍可各列獨立填入其他模型。第 482 列原有四個圖像欄 `G:J` 改為 `sprites/boss/boss_skeleton_king.png`，站立圖像同時供列表頭像與載入備援讀取。數值、技能、元素及備註未改。

原生 Excel 正常重開驗證 69 個授權儲存格；兩張表共 24,550 格資料／公式逐格比對，其他儲存格與七個原生物件保留。名稱屬 NPC 配置內容，未另在 String 表重複建立。

| 欄位 | 目前值 | 用途 |
| --- | --- | --- |
| 3D模型 | images/models/npc3d/boss1.glb | 相對專案根目錄的 GLB |
| 3D站立動作 | Walk | 使用首幀停格，未增加第六個動作 |
| 3D移動動作 | Walk | 8.667 秒循環 |
| 3D攻擊1動作 | Attack1 | 5.867 秒 |
| 3D攻擊2動作 | Attack2 | 2.967 秒 |
| 3D攻擊3動作 | Attack3 | 2.967 秒 |
| 3D死亡動作 | Die | 2.167 秒，倒地後保持末幀 |

表頭的 Excel 註解記錄原始動作檔名。修改後沿用「套用參數.bat」或既有 Excel→CSV→`config_tables` 流程，生成 `BOSS_LIST[].model3d` 與站立圖像 `img`。GLB 路徑、存在性及動作名稱會驗證；錯誤時中止套用。模型及動作欄位全清空可取消綁定。

`tower.makeBoss` 將 NPC 身分／model3d 傳給戰鬥快照；`js/npc3d.js` 使用既有 Hero3D 的 Three／Pixi 身體介面，獨立於玩家的 3D 開關。站立停 Walk 首幀，移動正常循環，普通攻擊依序使用三招並按既有攻擊間隔播放，Die 原速播放後淡出；模擬的傷害、攻速、技能、數值、解鎖及存檔不變。已認可的手部與骨骼姿勢沒有在執行期重算。模型載入期間或 WebGL 失敗沿用原身體／備援圖；載入完成前已退場則立即回收，正常死亡或換場也釋放 Three、Canvas 貼圖與 WebGL context。其他九種 BOSS 不建立 NPC 3D 控制器。沿用原十種 BOSS 樓層循環，因此第 11／21…層仍使用第一種 BOSS 定義。

## 重建與驗證

1. `node tools/meshy-pipeline/src/export-tower-boss1.cjs --check` 檢查素材庫與專案雜湊。
2. Blender 先執行 `tools/meshy-pipeline/blender/build_tower_boss_hand.py -- <上述版本 MPFB checkout> <手部輸出資料夾>`，再執行 `tools/meshy-pipeline/blender/prepare_tower_boss1.py -- <五個原檔所在資料夾> <製作輸出資料夾> --hand-source <手部輸出資料夾>/BOSS1_anatomical_hand.blend`，輸出 Blender、GLB 與握點 QA。已有素材庫手部 Blend 時可直接使用，不必重新安裝 MPFB。更新必要來源及 manifest 後依雙倉庫流程提交。
   第三版接著執行 `refine_tower_boss_cape.py -- <已認可的第二版 GLB> <新輸出資料夾>`。此步保留原素材與動作，新增避碰披風骨格，輸出可編輯 Blend、GLB 與 cape-bake-qa.json。
3. `node tools/config_tables.cjs --apply NPC` 應回報語意變更 0。
4. Blender 執行 `tools/meshy-pipeline/blender/qa_tower_boss1.py -- <實際 GLB> <QA.json> <已認可的第二版 GLB>`，以 60 fps 檢查披風與身體三角面交叉、下襬／地面、武器不入地、握點及拇指方向。右手、前臂及劍骨每個取樣都與已認可版本比較。肩領最上方 rest Z > 1.505 米的微小貼合區允許原接縫接觸，其餘披風不允許幾何交叉。另檢視背／側／正面影格；不能以純數值替代目視。
5. Blender 執行 `tools/meshy-pipeline/blender/render_tower_boss1.py -- <全新預覽資料夾> --only Attack3 --camera front --speed 0.2`。由 NPC 表讀 GLB 與動作名稱，重新匯入實際 GLB，以 EEVEE 原生 1080×1080、25 fps 逐幀渲染。固定正面鏡頭保留原動作轉身，沒有讓鏡頭跟著角色旋轉。原第三招 2.967 秒，檢視片段延長為 14.833 秒。
6. `python tools/meshy-pipeline/package_tower_boss1.py <預覽資料夾>` 輸出 1080×1144 GIF，表頭標示正面與 0.2 倍速；結尾短暫停留後重播。省略 `--only` 可重建五動作與總覽；變更鏡頭／速度／fps 時須使用不同目錄，避免混入舊影格。
7. `node --test tests/npc3d-config.test.cjs tests/npc-vision.test.cjs tests/worker-protocol.test.cjs tests/vfx-editor-cache-versions.test.cjs`。
8. `--camera rear --fps 15` 輸出五動作背面；`--portrait` 單獨輸出從當下模型自動構圖的透明頭像與來源雜湊。`node --test tests/npc3d-runtime.test.cjs tests/tower-boss3d.test.cjs` 驗證接入與生命週期；另跑既有 `hero3d*.test.cjs`。

第二版上述四檔 30/30 通過，並增加披風獨立網格／專用骨架／無腿骨權重檢查。第一版較廣套件的三項原有失敗仍留存紀錄（NPC-SKILL-4 的既有生成備註／縮放差異、NPC-SPRITE-4 的既有空白圖像備註、NPC-SPRITE-5 假定哥布林縮放仍為 1）；當時已在隔離副本以修改前版本確認同名失敗。第二版未改這些測試、原配置或對應玩法。

第二版最終 GLB 重匯入共檢查 684 幀：披風下襬至少低於肩部 0.180 米，披風最低 0.027 米，全劍最低 0.035 米，握點誤差低於 0.000001 米；拇指末節與刀刃方向點積 0.884，Walk 手背朝人物右側投影點積至少 0.963。舊版以握點到掌心的向量推論手背方向並不可靠，已由真正的手背法向與右側鏡頭取代。手套為單色銀色材質，未新增手部細節貼圖；該版握姿已獲使用者認可。

第三版 GLB 重匯入共 1,363 個 60 Hz 取樣，披風／身體交叉對數均為 0；地面最低 0.038 米，右手／前臂／劍骨矩陣對已認可版本最大誤差 0.00000188，握點誤差低於 0.000001 米。這是五個已烘焙動作的避碰，沒有加入披風自碰撞、兵器接觸或即時布料物理；前裙襬仍保留來源權重。第三招 0.2 倍速僅供檢視，GLB 原時長與遊戲攻速不變。

第三版同步 data／tower／hero3d／npc3d／battle-renderer 主頁快取與 Worker 資料版本。主頁更新與 Claude 音效版本行相鄰，三方試跑衝突，使用者已明確同意分段更新；本輪未改兩個音效版本行，也未合併該分支。必要回歸、建置與實際瀏覽器結果記錄於本輪 AI_TASKS。
