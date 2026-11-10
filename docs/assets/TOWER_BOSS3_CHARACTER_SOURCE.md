# 第3隻BOSS五動作來源與交接

任務 `TOWER-BOSS3-WALK-20261110`，Codex。使用者先提供BOSS3_Walk.glb，再追加Attack1／Attack2／Attack3／Die，要求全部接入第三隻BOSS。沿用本聊天已確認的使用者自製／生成BOSS系列及遊戲使用／修改授權與本次匯入指示，沒有新增外部素材。

## 模型與動作

正式模型 `images/models/npc3d/boss3_character.glb`，SHA-256 `47330ede8adcd84eed9aaad38f6f6b156913bba0fd840da569db40ab540f7b4e`。五來源節點與靜止骨架完全相同，以Walk為底保留單一網格、47關節、權重、PBR、貼圖與原始二進位區塊，追加四個動畫的accessor／buffer view。沒有重新編碼網格或貼圖，沒有拼入其他BOSS動作。原boss3.glb骷髏王資產完整保留。

| 用途 | 原始檔 | 動畫名稱 | 原速秒數 |
| --- | --- | --- | --- |
| 站立／走路 | BOSS3_Walk.glb | Running | 0.633333 |
| 攻擊1 | BOSS3_Attack1.glb | Basic_Jump | 5.866667 |
| 攻擊2 | BOSS3_Attack2.glb | Right_Hand_Sword_Slash | 1.5 |
| 攻擊3 | BOSS3_Attack3.glb | Shield_Push_Left | 2.366667 |
| 死亡 | BOSS3_Die.glb | Shot_and_Fall_Forward | 2.166667 |

每動作120通道。攻擊的Hips水平x/z固定為首鍵，保留垂直高度與其他119通道；走路及死亡全部120通道原樣保持，所有時間key逐位元相同。動畫內的Sword／Shield是來源動作名稱，沒有新增武器或盾牌。

Blender 4.5.10 LTS匯入實際五動作成品，清除匯入的骨骼預覽輔助網格、打包貼圖與所有動作，保存BOSS3_Character.blend。匯入16,451頂點／10,452三角面；透明頭像boss3_character.png為同一GLB的Running首幀渲染，1080×1080 RGBA，沒有另行生成外觀。可編輯來源有相機／燈光，正式GLB仍使用保留Walk原始表面的合併檔。

## NPC與遊戲

權威來源 `config/Excel/NPC.xlsx`，NPC工作表第484列tower_boss_3：G:J為sprites/boss/boss3_character.png；AB為images/models/npc3d/boss3_character.glb；AC:AH依上表填站立／走路／三攻擊／死亡。第3／53／103層使用本列，其他49列維持；本次未要求更名，名稱／圖示沿用原NPC設定。屬性、技能、速度、距離、倍率、存檔及解鎖不變。

站立停Running首幀；走路循環，沿既有Npc3D接地步幅與實際速度調速。普攻／施法按既有停步時間適配完整三招，死亡原速播放後淡出，傷害與技能結算沿原規則。

原生Excel獨占來源後窄改、正常重開，每輪比對28,365格資料／公式與七物件；與任務開始基線比對最終只有11格外觀／動作改變。由config_tables.readXlsxRows／csvStringify匯出NPC.csv，再套用NPC產生data；主頁data／bridge及Worker資料快取同步。格式、實機及回歸結果見AI_TASKS及素材包QA。

## 保存與重建

素材庫位置由tools/vfx/vfx-library-root.cjs解析，套件 `codex-authored/tower-boss3-character-20261110/` 保存五原檔、正式GLB／頭像、貼圖打包Blend、工具、來源與NPC／動作／執行QA及逐檔SHA。

1. `node tools/meshy-pipeline/src/prepare-tower-boss3-character.cjs SOURCES OUTPUT.glb`重建完整五動作；沿用既有樹人合併流程的獨立BOSS3版本，避免改動既有素材包鎖定的製作器。
2. Blender執行 `tools/meshy-pipeline/blender/prepare_tower_boss3_character.py -- OUTPUT.glb DIRECTORY`，重建可編輯Blend、透明頭像與模型QA。
3. `node tools/meshy-pipeline/src/export-tower-boss3-character.cjs --check`核對來源與專案，`--apply`同步正式輸出。

本次未要求額外GIF。測試截圖、暫存中間檔留聊天目錄，不進Git。提交、完整驗證與未驗證範圍見AI_TASKS同任務。
