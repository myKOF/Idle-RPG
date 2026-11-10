# 第3隻BOSS第3階來源與交接

任務 `TOWER-BOSS3-LV3-20261110`，Codex。使用者提供BOSS3_3.glb，指定為第3階並完全沿用第1階動作。來源授權沿用本聊天已確認的使用者自製／生成系列及遊戲使用／修改授權與本次匯入指示，沒有新增外部素材。

| 檔案 | SHA-256 |
| --- | --- |
| BOSS3_3.glb | 35586ec14cfc2c33518023700c545058b973f1344b272325fbabc98bd933ba45 |
| 第1階 boss3_character.glb | 47330ede8adcd84eed9aaad38f6f6b156913bba0fd840da569db40ab540f7b4e |
| 第3階 boss3_character_lv3.glb | 4185787cccb0ae44740ebcde2e5df019088aad8981be038a13e53629f74dfd4f |

## 模型與動畫

使用Blender 4.5.10 LTS。新來源16,452頂點／10,452三角面／47骨，原身高2.16對齊第1階2.14，等比例0.9907407862。全部三角面按靜止座標唯一匹配，最大表面差0.000002161米。保留第1階網格、權重、骨架與五動作，轉入新來源逐角UV與PBR；三張基色／法線／金屬粗糙貼圖原始位元組與來源相同。新UV接縫使正式GLB分割為16,462頂點，面數及形狀保持。

Running、Basic_Jump、Right_Hand_Sword_Slash、Shield_Push_Left、Shot_and_Fall_Forward的時長依序0.633333／5.866667／1.5／2.366667／2.166667秒。站立停Running首幀，移動按實際位移調速，攻擊沿用第1階原地水平根位移與跳躍，死亡原速倒下。

匯出後以60Hz比對47骨、757個樣本的有效蒙皮矩陣，最大誤差0.000008271；原動作通道目標全部存在、名稱及時長保持。這是GLB／Blender浮點表示誤差。可編輯Blend正常重開，五動作、47骨與六張打包圖片通過。頭像為正式模型Running首幀實際渲染，1080px RGBA。

## 配置與驗證

權威來源NPC.xlsx的NPC工作表第504列tower_boss_23，僅G:J換為sprites/boss/boss3_character_lv3.png、AB換為images/models/npc3d/boss3_character_lv3.glb、AC:AH填入與第1階相同的站立／移動／三攻擊／死亡。原名稱「雷霆巨獸」、圖示、數值／技能與其他49列保持。第23／73／123層映射第3階；第1、2階保持。沒有修改通用3D執行期、戰鬥、Worker協議、存檔或解鎖。

原生Excel獨占窄改後正常重開，核對28,365格資料／公式、七物件及全部變更，只有本列11格改變。兩頁24,535格樣式、樣式XML、列高／欄寬、合併／驗證／條件格式／視圖／篩選／圖形一致。CSV與data由既有管線生成，主頁與Worker必要資料快取同步。

隔離Edge新局及正式Worker第23層驗證：新模型五動作載入、移動有正位移及同步播放率、三攻擊／施法輪播、命中後死亡使用Shot_and_Fall_Forward。Console error 0，另記錄既有音訊振盪器頻率16405.7Hz限幅提示。43項相關回歸通過，Build與提交紀錄見AI_TASKS同任務。未做行動真機、跨瀏覽器或長時間效能測試。

## 保存與重建

素材庫由tools/vfx/vfx-library-root.cjs解析，套件 `codex-authored/tower-boss3-lv3-20261110` 保存使用者原檔、已認可第1階動作來源、正式成品、打包貼圖的BOSS3_LV3.blend、工具快照及QA，manifest逐檔SHA。

1. Blender執行 `tools/meshy-pipeline/blender/prepare_tower_boss3_variant.py -- APPROVED.glb BOSS3_3.glb OUTPUT`。沿用既有通用變體工具，內部檔名仍為boss3_character_lv2.glb及BOSS3_LV2.blend，入庫時依第3階改名；工具及舊階段來源不改動。
2. Blender執行 `qa_tower_treant_variant.py -- APPROVED.glb OUTPUT/boss3_character_lv2.glb QA.json`。既有QA名稱沿用樹人，實際比較任意兩份模型全部關節。
3. Blender執行 `prepare_tower_boss3_character.py -- MODEL.glb PORTRAIT`，將boss3_character.png依第3階改名。其model-qa的gameExport描述為工具既有文字；本階實際製作方式以surface-qa為準。
4. `node tools/meshy-pipeline/src/export-tower-boss3-lv3.cjs --check`核對來源與專案；`--apply`同步正式輸出。

本次只要求接入，未另產生GIF。暫存測試與預覽不進遊戲Git；來源及必要QA在素材庫保存。
