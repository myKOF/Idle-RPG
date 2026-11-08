# 樹人五動作來源與交接

任務 `TOWER-TREANT-ACTIONS-20261109`，Codex，2026-11-09。使用者先提供BOSS2_Walk.glb指定為第2個BOSS，後補三攻擊與死亡。本聊天先前已確認系列素材為使用者自製／自行生成，可供遊戲及修改；沒有新增第三方美術或握手素材。頭像為模型實際渲染，沒有武器加工。

## 模型與動作

正式模型 `images/models/npc3d/treant.glb`。五個原檔節點與靜止骨架完全相同；以走路檔為底，保留網格、蒙皮、材質、貼圖與原始二進位區塊，僅追加另外四個動畫所需的accessor／buffer view。沒有重建網格、重貼材質或帶入重複模型。

| NPC欄位 | 原始檔 | GLB動作名稱 | 原速秒數 |
| --- | --- | --- | --- |
| 站立／走路 AC:AD | BOSS2_Walk.glb | Unsteady_Walk | 2.966667 |
| 攻擊1 AE | BOSS2_Attack1.glb | Weapon_Combo_2 | 4.5 |
| 攻擊2 AF | BOSS2_Attack2.glb | Attack | 2.8 |
| 攻擊3 AG | BOSS2_Attack3.glb | Basic_Jump | 5.866667 |
| 死亡 AH | BOSS2_Die.glb | Shot_and_Fall_Forward | 2.166667 |

每個動作168個channel，原骨架58個joint，單一無武器網格。攻擊的Hips水平x/z固定在第一個key，避免外觀自行滑離戰場座標；高度、旋轉、其他骨骼與所有時間key保持原值，因此跳躍與落地保留。走路保持原有小幅原地擺動；死亡完整保留倒下動作。原始動畫名稱含Weapon只是來源名稱，模型沒有武器。

預覽全為原速。實戰依NPC表攻速及技能busy時長，將整段攻擊動畫適配到該次站定時間；死亡原速播放後保持最後一格再淡出。走路仍按接地步幅、實際位移與顯示尺寸調速。

## NPC權威配置

`config/Excel/NPC.xlsx`，NPC工作表第 **483** 列 `tower_boss_2`：B為「樹人」、F為樹emoji、G:J為 `sprites/boss/boss_treant.png`、AB為正式GLB，AC:AH如上表。原生Excel兩次窄改，每次13格以正常模式重開，核對28365格資料／公式及七個原生物件；最後再對HEAD比對兩頁樣式、格線樣式ID、列屬性、欄寬、合併格、驗證及條件格式。只有本列外觀與動作變更，其他49列、使用者最新移速／攻速／射程／倍率、屬性與技能保持。

CSV經config_tables.readXlsxRows／csvStringify匯出，套用NPC僅BOSS_LIST有1項語意變更，後續試跑0。第52／102層依50列循環使用樹人；第12／22等仍用各自原列，不因舊名稱相同而替換。

## 行動互斥

塔BOSS開場先接戰，不為遠距技能反覆後退。普攻／施法建立暫態動作鎖，普通追擊與跑位等整段動作完成後繼續；跑位目標固定在世界座標，且受既有場地邊界限制。主執行緒以一次ACT事件驅動姿勢，與位置同延遲並等待移動插值結束，防止多枚特效重播或邊走邊攻擊。技能本身的衝鋒與受擊推移仍依原技能／物理規則，移動幀顯示走路。未改技能傷害與結算時機、存檔或解鎖。

## 保存與重建

素材庫套件 `codex-authored/tower-treant-20261109` 保存五原檔、正式GLB／透明頭像、打包貼圖的可編輯Blend、工具快照、NPC原生檢查與模型／動畫QA、逐檔SHA。位置由tools/vfx/vfx-library-root.cjs解析。舊boss2.glb及骷髏王素材套件保持。

1. `node tools/meshy-pipeline/src/prepare-tower-treant.cjs SOURCE_DIRECTORY OUTPUT.glb` 重建五動作模型及來源SHA報告。
2. `node tools/meshy-pipeline/src/export-tower-treant.cjs --check` 驗證雙庫；`--apply` 同步正式匯出。
3. Blender執行 `tools/meshy-pipeline/blender/render_tower_treant.py -- OUTPUT`，從NPC表讀正式檔，20FPS／1080px渲染並保存可編輯場景。
4. Python執行 `tools/meshy-pipeline/package_tower_treant.py OUTPUT`，產出五份1080×1144 GIF與1920×1200總覽。各動作原速完整播放，非循環動作末端短暫保持；總覽各自循環，原比例不拉伸。

同一渲染工具加 `--portrait` 可重建透明頭像；原製作場景亦保存在素材庫，來源為未改動的Walk網格與動畫。預覽GIF、截圖及中間影格放在聊天visualizations，不進遊戲Git。測試、提交、限制與完整交付見docs/AI_TASKS.md同任務；不處理develop既有合併，不推送。
