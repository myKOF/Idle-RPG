# 樹人第2階來源與交接

任務 `TOWER-TREANT-LV2-20261109`，Codex，2026-11-09。使用者提供 `BOSS2_LV2.glb`，指定為第2隻BOSS的第2階，全部動作沿用第1階並接入遊戲、提供GIF。同系列自製／自行生成及遊戲使用／修改授權已記錄在 [第1階來源](TOWER_TREANT_SOURCE.md)，本次匯入沿用該授權與使用者指示；沒有新增外部美術素材。

| 來源 | SHA-256 |
| --- | --- |
| BOSS2_LV2.glb | 403d4a38bbbd21c9337d1de5d6ca0fc2ac8675b99e80e313550e82506aed9648 |
| 第1階 treant.glb | f4de6ce8b9aee60e36031c58c3799441372eb0252f0d657ecc5b0dc1fb008e6c |
| 正式 treant_lv2.glb | 251fa3fee269ce8d072f8a05227ccf62f3ee43418b835c00925f086d028d3f31 |

## 模型與動作

Blender 4.5.10 LTS 製作。新來源為紅葉／紅色紋路與眼睛的樹人，原有96骨及Running；第1階為58骨及五動作。兩者靜止表面相同，20,005頂點／10,433三角面，最大位置差0.000000759米。

保留第1階原始網格、蒙皮權重與骨架，依靜止座標逐三角面唯一對應，將新來源的PBR材質與逐角UV轉入；全部10,433面皆有唯一對應，沒有以近鄰插值重畫貼圖。原始新檔另存供編輯，成品保留其紅葉外觀，不使用其Running或額外骨架。非人形素材在Blender處理，沒有新增人體／武器。

| 用途 | GLB動作 | 原速秒數 |
| --- | --- | --- |
| 站立／走路 | Unsteady_Walk | 2.966667 |
| 攻擊1 | Weapon_Combo_2 | 4.5 |
| 攻擊2 | Attack | 2.8 |
| 攻擊3 | Basic_Jump | 5.866667 |
| 死亡 | Shot_and_Fall_Forward | 2.166667 |

第1階已固定的攻擊水平根位移保持，跳躍高度及死亡倒下保持。匯出後重新匯入兩份GLB，比對全部58骨、60Hz共1,103個樣本的有效蒙皮矩陣；最大元素誤差0.00000535。Blender重新匯出補上原本未動的骨骼通道，因此每動畫174通道，原本168個通道目標全部存在；名稱、時長與動作保持。

## 遊戲配置

來源為 `config/Excel/NPC.xlsx` 的 NPC 工作表第493列 `tower_boss_12`。名稱B為「樹人Ⅱ」、圖示F沿用樹人、G:J為 `sprites/boss/boss_treant_lv2.png`、AB為 `images/models/npc3d/treant_lv2.glb`，AC:AH按上表填入。

第12關使用第2階；依既有50列循環，第62／112層也使用該列。第2／52／102層保留第1階。使用者追加第3階接第22關，詳見[第3階交接](TOWER_TREANT_LV3_SOURCE.md)；其餘48列保持。只更新兩列外觀／動作，不改元素、技能、移動／攻擊速度、距離、倍率、公式、存檔或解鎖。

原生Excel確認獨占後窄改、正常重開，比對28,365格資料／公式、24,535格樣式與七物件；儲存後Excel依本機顯示度量正規化列高（最大2.4pt）與欄寬（最大0.0508字元），樣式定義、列結構、合併格、驗證、條件格式、篩選、圖形及視圖保留。詳細QA另存素材包。之後由config_tables.readXlsxRows／csvStringify匯出CSV、套用NPC產生BOSS_LIST；NPC名稱直接從表讀，不重複寫入String。

## 保存與重建

素材庫位置由 `tools/vfx/vfx-library-root.cjs` 解析；獨立套件 `codex-authored/tower-treant-lv2-20261109/` 保存使用者原檔、第1階已認可動作、可編輯且貼圖打包的Blend、正式GLB／透明頭像、製作工具及QA，manifest逐檔記錄SHA。舊樹人與骷髏王素材完整保留。透明頭像與GIF皆為實際成品GLB渲染，沒有另行生成外觀。

1. Blender執行 `tools/meshy-pipeline/blender/prepare_tower_treant_variant.py -- FIRST_STAGE.glb BOSS2_LV2.glb OUTPUT`。
2. Blender執行 `tools/meshy-pipeline/blender/qa_tower_treant_variant.py -- FIRST_STAGE.glb OUTPUT/treant_lv2.glb OUTPUT/animation-qa.json`。
3. `node tools/meshy-pipeline/src/export-tower-treant-lv2.cjs --check` 驗證來源及匯出；`--apply`同步正式素材。
4. Blender執行 `tools/meshy-pipeline/blender/render_tower_treant_lv2.py -- OUTPUT --size 720 --samples 16`，再以 `python tools/meshy-pipeline/package_tower_treant_lv2.py OUTPUT` 產出五份720×784 GIF及1920×1200總覽。本次走路20FPS，三攻擊／死亡10FPS，總覽20FPS；各動作原速完整播放，死亡末幀短暫保持後重播。工具亦支援預設1080px，重新渲染須使用新目錄。
5. 渲染工具加 `--portrait` 產出1080×1080透明頭像；匯出改名為boss_treant_lv2.png。`--config-root`僅供獨立NPC／GLB快照預覽；正式配置完成後須核對快照與來源的模型SHA、NPC動作相同。

預覽GIF與中間影格留在聊天visualizations，不進Git。遊戲接入、原生Excel、測試／Build、實際瀏覽器與雙庫提交結果及限制，見 `docs/AI_TASKS.md` 本任務。通用NPC／Hero3D執行期與戰鬥邏輯不需修改。
