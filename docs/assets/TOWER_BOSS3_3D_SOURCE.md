# 骷髏王Ⅲ材質版來源與交接

任務 `TOWER-BOSS3-LV3-20261108`，Codex，2026-11-08。使用者提供 BOSS1_LV3.glb，要求完全沿用上一隻的流程套上；承接為第3關「骷髏王Ⅲ」。同系列來源、使用與修改授權沿用本聊天使用者已確認的自製／自行生成授權；未新增外部美術來源。

| 檔案 | SHA-256 |
| --- | --- |
| 使用者 BOSS1_LV3.glb | 8418790c5ce4fe72faea12015d8a92f8231726218f1d5b82351c8f5108cd72f2 |
| 已認可 boss1.glb 動作來源 | 2e945e89db9210f8ce18fc52a7d3f272cdeafb1eec7f626f116c8e5ad9e67fce |
| 匯出 boss3.glb | 6bf58a6026d0d0214e91bff12cd5dbb9fdd344fa1d248ea26d4870f692c03043 |

## 模型與五動作

使用 Blender 5.2.3 LTS 及既有 prepare_tower_boss_variant.py，將新來源身高對齊已認可模型，比例1.052940999。新來源20616個頂點／94根骨，僅有Running；依使用者要求不採用Running，沿用先前Walk／Attack1／Attack2／Attack3／Die。

以原生三角面對應新PBR及每角UV：身體7821面、披風1718面、劍436面，共9975面，缺漏及重複候選均0。保留新檔的灰髮、深色披風、金屬與紅寶石材質。原始劍面從新融合網格重新拆出，合入先前已擬合的黑皮握柄；移除舊劍及Sword_R，重建獨立劍骨、父骨mixamorig:RightHand，整劍100%單骨權重。

保留已認可的銀色手套、194骨、135根CapeFit披風骨及60fps避碰動畫。手部來自官方MakeHuman MPFB CC0，版本b1a2dc98776da9d1eea751b159d42cf61778fe2e；原始CC0檔、手部參數及可編輯手部Blend另保存，詳見[第一個BOSS來源](TOWER_BOSS1_3D_SOURCE.md)。使用者的握劍照片只作姿勢判讀，未匯入成品。

五動作時長依序8.667／5.867／2.967／2.967／2.167秒。比較重匯入GLB的有效蒙皮矩陣pose×inverse(rest)，全部194骨、1363個60Hz樣本的最大元素誤差0.00001711。重新建骨可能改變靜止軸的表示，不能用原始四元數直接判定握姿改變。

幾何QA逐樣本披風／身體交叉對數均0；披風最低0.038m，整劍最低0.0343824m，握點誤差<0.000001m。沿用肩領最上方原接縫區的接觸定義；這是已烘焙五動作的避碰，沒有即時布料、披風自碰撞或全身裝備物理。

## NPC 配置

權威來源是config/Excel/NPC.xlsx，NPC工作表第 **484** 列tower_boss_3。原生Excel獨占來源確認後，只更新13格並正常重開，核對兩表28365格資料／公式及七個原生物件。CSV採既有config_tables.readXlsxRows／csvStringify匯出，保留原始數值精度，再套用NPC；僅BOSS_LIST一項語意變更，後續試跑0。

| 欄位 | 值 |
| --- | --- |
| 名稱 B | 骷髏王Ⅲ |
| 四圖像 G:J | sprites/boss/boss_skeleton_king_lv3.png |
| 3D模型 AB | images/models/npc3d/boss3.glb |
| 站立／移動 AC:AD | Walk／Walk |
| 攻擊1／2／3 AE:AG | Attack1／Attack2／Attack3 |
| 死亡 AH | Die |

最新專案為50關各自一列。**只換第3列外觀**；第13／23／33／43關仍是各自的雷霆巨獸配置，其他49列皆保持。51至150層仍沿用既有50列循環，所以53／103層使用第3列。第3列原雷屬性、雷光球／連鎖閃電等技能、移動／攻擊數值、五倍率及公式保持；名稱由NPC配置讀取，不在String重複登記。

## 保存與重建

素材庫由tools/vfx/vfx-library-root.cjs解析；獨立套件codex-authored/tower-boss3-lv3-20261108保存原檔、已認可動作GLB、可編輯Blend、正式模型／透明頭像、製作工具、授權、逐檔雜湊及QA。前兩個模型與素材套件保持。通用工具內部沿用BOSS1節點名、BOSS_LV2_PBR材質名及BOSS2_preview輸出名，不影響獨立檔案與NPC配置。

1. `node tools/meshy-pipeline/src/export-tower-boss3.cjs --check`驗證來源及匯出；`--apply`同步正式匯出。
2. Blender執行`prepare_tower_boss_variant.py -- APPROVED.glb BOSS1_LV3.glb OUTPUT`。
3. Blender執行`qa_tower_boss_variant.py -- APPROVED.glb boss3.glb animation-qa.json`，另執行`qa_tower_boss1.py -- boss3.glb geometry-qa.json`。
4. Blender執行`render_tower_boss1.py -- OUTPUT --npc tower_boss_3 --fps 20`，再以`package_tower_boss1.py OUTPUT`輸出五份1080×1144及1920×1200總覽GIF。工具共用BOSS1檔名；交付總覽另命名BOSS3_actions_HD.gif，內容雜湊相同。使用新的輸出資料夾避免混入舊影格。
5. `--portrait`輸出實際GLB的1080×1080透明頭像，正式匯出命名boss_skeleton_king_lv3.png。

預覽GIF／測試畫面與中間影格保留於聊天預覽目錄，不進Git；正式來源、模型、頭像及QA以雙倉庫提交。測試指令、實際瀏覽器結果、提交及未驗證範圍記錄於AI_TASKS；本次不改通用3D執行期，未做行動真機或長時間效能驗證。
