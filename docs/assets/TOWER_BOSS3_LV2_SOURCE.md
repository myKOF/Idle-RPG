# 第3隻BOSS第2階來源與交接

任務 `TOWER-BOSS3-LV2-20261110`，Codex。使用者提供BOSS3_2.glb，指定為BOSS3第2階，五動作完全沿用第1階並接入。來源授權沿用本聊天已確認的使用者自製／生成系列及遊戲使用／修改授權與本次匯入指示，沒有新增外部素材。

| 檔案 | SHA-256 |
| --- | --- |
| BOSS3_2.glb | f6b3149cef3081f4b62dc4afa254690c77ccb954fedf8194de0312e45e4edcb1 |
| 第1階 boss3_character.glb | 47330ede8adcd84eed9aaad38f6f6b156913bba0fd840da569db40ab540f7b4e |
| 第2階 boss3_character_lv2.glb | 4807786de03ece3d91f869f774d0a122acba7f0ffafa4bb00d5ebab34552118c |

## 製作與動作一致性

Blender 4.5.10 LTS。新來源16,450頂點／10,452三角面／47骨，只有Running；第1階原始匯出身高2.14，新來源2.12，以1.0094339998的等比例對齊後，全部10,452三角面按靜止座標唯一匹配，最大表面差0.000000885米。UV接縫的頂點分割不同不影響三角面對應。

保留第1階網格、蒙皮權重、47骨及五個已接入動作，精確轉入新來源的逐角UV與PBR。三張法線／基色／金屬粗糙貼圖的原始位元組與來源相同；沒有重畫、生成或重新壓縮貼圖。輸出GLB因新UV接縫分割為16,462頂點，三角面與表面形狀保持。

五動作為Running、Basic_Jump、Right_Hand_Sword_Slash、Shield_Push_Left、Shot_and_Fall_Forward，原時長依序0.633333／5.866667／1.5／2.366667／2.166667秒。新來源Running不採用；保留第1階的攻擊原地根位移、跳躍與死亡倒下。

匯出後重新匯入兩份GLB，以60Hz比較47骨、757個樣本的有效蒙皮矩陣，最大誤差0.000008271。這是Blender／GLB浮點表示差異，沒有換用其他動作。重匯出補上靜止關節通道，原120個通道目標全部存在；動作名稱、時間及實際蒙皮變換保持。

## NPC與遊戲

權威來源 `config/Excel/NPC.xlsx`，NPC工作表第494列tower_boss_13：G:J為sprites/boss/boss3_character_lv2.png，AB為images/models/npc3d/boss3_character_lv2.glb，AC:AH按第1階站立／走路／三攻擊／死亡填入。原名稱「雷霆巨獸」、圖示、所有屬性／技能／數值／速度／距離／倍率保持；其餘49列維持。

第13／63／113層使用第2階；第3／53／103層保留第1階，第23等獨立列保持。站立停Running首幀，移動按既有接地步幅與實際位移調速，普攻／施法與死亡沿用既有規則；沒有修改通用3D、戰鬥、協議、存檔或解鎖。

原生Excel獨占後窄改11格並正常重開，比對28,365格資料／公式及七物件；24,535格樣式、樣式XML、列高／欄寬、合併／驗證／條件格式／視圖／篩選／圖形皆保持。CSV與data由既有管線產生，主頁data／bridge及Worker資料快取同步。

## 保存與重建

素材庫由tools/vfx/vfx-library-root.cjs解析，套件 `codex-authored/tower-boss3-lv2-20261110/` 保存原檔、第1階動作來源、正式模型／透明頭像、打包貼圖的BOSS3_LV2.blend、工具及QA，manifest逐檔SHA。頭像為正式GLB的Running首幀實際渲染，1080px RGBA。

1. Blender執行 `tools/meshy-pipeline/blender/prepare_tower_boss3_variant.py -- APPROVED.glb BOSS3_2.glb OUTPUT`。
2. Blender執行 `qa_tower_treant_variant.py -- APPROVED.glb OUTPUT/boss3_character_lv2.glb QA.json`；該既有QA比較任意模型全關節，檔名沿用樹人。
3. Blender執行 `prepare_tower_boss3_character.py -- OUTPUT/boss3_character_lv2.glb PORTRAIT` 重建透明頭像；共用工具仍輸出boss3_character.png，匯入素材包時依第2階改名。
4. `node tools/meshy-pipeline/src/export-tower-boss3-lv2.cjs --check`核對來源／專案，`--apply`同步輸出。

實機、測試、Build、雙庫提交與限制見AI_TASKS同任務。本次只要求接入，未額外產生GIF；暫存預覽／測試截圖不進Git。
