# 樹人第3階來源與交接

任務 `TOWER-TREANT-LV2-20261109` 的使用者追加需求：BOSS2第3階套用第1階全動作後接入。來源為BOSS2_LV3.glb；同系列自製／生成及遊戲使用／修改授權沿用 [第1階來源](TOWER_TREANT_SOURCE.md) 與本次匯入指示，沒有新增外部美術來源。

| 檔案 | SHA-256 |
| --- | --- |
| BOSS2_LV3.glb | b6b3661bd2b080cd828ccff5b2fa86437512a6000dd367e07ae1c6965c0df53c |
| 第1階 treant.glb | f4de6ce8b9aee60e36031c58c3799441372eb0252f0d657ecc5b0dc1fb008e6c |
| 正式 treant_lv3.glb | d8a555c99ecd356049dd90c02ebe6ba397e7e0e35a6034e2c50e8d28575fa263 |

Blender 4.5.10 LTS，重用 [第2階流程](TOWER_TREANT_LV2_SOURCE.md)。新來源20,001頂點、10,433三角面、89骨，附Running。UV接縫分割不同，頂點數與第1階20,005不同；全部三角面仍可按靜止座標唯一對應，最大位置差0.000000851米。工具驗證面數、每面唯一對應及逐角距離，沒有改為近似材質投影。

保留第1階網格、58骨、權重與五動作，轉入第3階原始PBR及每角UV。走路Unsteady_Walk、三攻擊Weapon_Combo_2／Attack／Basic_Jump、死亡Shot_and_Fall_Forward，原速時長依序2.966667／4.5／2.8／5.866667／2.166667秒。攻擊水平根位移沿用已認可原地版本，跳躍與倒下保持，無武器。重新匯入GLB後，58骨、1,103個60Hz取樣最大有效蒙皮矩陣誤差0.00000535。原始Running與新來源骨架不帶入。

權威配置 `config/Excel/NPC.xlsx` NPC工作表第503列 `tower_boss_22`：B為樹人Ⅲ、F為樹人圖示、G:J為sprites/boss/boss_treant_lv3.png、AB為images/models/npc3d/treant_lv3.glb、AC:AH為站立／走路／三攻擊／死亡。第22／72／122層使用第3階，第2／12關保留第1／2階。兩階僅更新第12與22關外觀／動作，其他48列及所有原有數值、屬性、技能、距離、倍率、存檔／解鎖保持。原生Excel正常重開核對28,365格及七物件，本階13格修改，CSV／data由既有管線產生。

素材庫由tools/vfx/vfx-library-root.cjs解析，套件 `codex-authored/tower-treant-lv3-20261109/` 保存原檔、第1階動作來源、貼圖打包的Treant_LV3.blend、正式模型／透明頭像、工具快照、QA及逐檔SHA。共用工具內部仍輸出Treant_LV2.blend／treant_lv2.glb，素材包保存時依本階改名；內容由manifest核對。

- `node tools/meshy-pipeline/src/export-tower-treant-lv3.cjs --check` 檢查雙庫；`--apply`同步匯出。
- Blender執行 `prepare_tower_treant_variant.py -- FIRST_STAGE.glb BOSS2_LV3.glb OUTPUT`，再執行 `qa_tower_treant_variant.py -- FIRST_STAGE.glb OUTPUT/treant_lv2.glb OUTPUT/animation-qa.json`。
- Blender執行 `render_tower_treant_lv2.py -- OUTPUT --npc tower_boss_22 --portrait`，由正式表與GLB渲染1080px透明頭像。省略--portrait可輸出動作影格；本次第3階未額外要求五動作GIF。

遊戲實機、測試、Build、雙庫提交及Excel原生尺寸正規化紀錄見AI_TASKS同任務。未修改通用3D執行期或戰鬥計算。預覽／截圖及中間影格不進Git。
