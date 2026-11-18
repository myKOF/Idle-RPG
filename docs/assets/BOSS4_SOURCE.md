# BOSS4 半人馬（角獸惡魔騎士）3D 資產交接

任務 `TOWER-BOSS4-CENTAUR-20261118`，Claude。使用者提供三視圖、未綁骨的原始模型、自己綁好四足骨架與 Walk／Run 的動畫版，以及三個正式貼圖版（`BOSS4.glb`、`BOSS4_2.glb`、`BOSS4_3.glb`，都是同一份 9262 頂點網格、原始扭轉姿勢、未綁骨）。要求：轉正、頭朝前、武器拆下重做成直的握在右手、三個攻擊與死亡動作，全部接為第4隻封魔塔BOSS。素材全部是使用者提供或在本專案內程序化產生，沒有外部素材。

## 遊戲用檔案

| 版本 | 外觀 | 樓層 | 模型 | 頭像 |
| --- | --- | --- | --- | --- |
| 第1套材質（暗金） | 半人馬1 | 4／54／104（`tower_boss_4`） | `images/models/npc3d/boss4.glb` | `images/sprites/boss/boss4_centaur.png` |
| 第2套材質（暗紅） | 半人馬2 | 14／64／114（`tower_boss_14`） | `boss4_lv2.glb` | `boss4_centaur_lv2.png` |
| 第3套材質（金紅，同三視圖） | 半人馬3 | 24／74／124（`tower_boss_24`） | `boss4_lv3.glb` | `boss4_centaur_lv3.png` |

- 動作：`Walk`（0.958 s 循環）、`Attack1` 長槍直刺（1.5 s）、`Attack2` 長槍揮砍（1.5 s）、`Attack3` 奮力一擊（2.25 s，人立踢腿後落地下刺）、`Die`（3.0 s，分段倒向左側、長矛脫手落地）。另有 `Run` 只在桌面 `BOSS4_output` 的 Blender 檔，不進遊戲。
- 骨架 56 根：使用者的 afk-horse 四足骨架（馬身、四腿、尾巴照舊）＋新增人形上半身 `upper_waist／chest／neck／head`、`clavicle／upperarm／forearm／hand_{r,l}`、武器骨 `weapon_r`（掛在 `hand_r` 下）。長矛整支 100% 綁 `weapon_r`，握點在矛尾往上 43%。
- 所有動作的起點／終點是「備戰持槍」：槍尖朝前下方、矛尾從肩外往後上，Walk 第一格同此姿勢（站立停 Walk 首幀）。
- 模型以四蹄中心置中（根節點 `afk-horse` 平移 −0.116／+0.038）；高約 2.0 m（含長矛），與 boss6 相當。攻擊只有約 0.1 m 的前衝根位移，死亡橫向倒地約 0.5 m，都在 NPC 畫布（6.2 m）內。

## NPC 表（NPC.xlsx，經 `tools/excel-update-sheets.ps1` 寫入並重開驗證）

- 第485／495／505列（tower_boss_4／14／24）：G:J 頭像、AB 模型、AC:AH 動作（Walk、Walk、Attack1、Attack2、Attack3、Die）；**攻擊速度 3 → 0.4**（動作 1.5～2.25 秒，每秒 3 次會被壓進 0.33 秒；與第5、6隻相同處理）。名稱「鋼鐵魔像」、屬性、技能（野蠻衝鋒／震地衝擊）、距離 5、倍率沿用原列，未改。
- 備註欄：使用者 2026-11-18 要求凡是改成新版 3D 模型的封魔塔BOSS，備註前面寫外觀名稱＋第幾套材質（骷髏王1／2、樹人1～3、雷霆巨獸1～3、半人馬1～3、鬼面1～3、深淵領主1～3）。備註是 `tools/config_tables.cjs` 由 data.js 自動產生的欄位，外觀名稱由 `npcLookNote()` 依模型檔名產生（`NPC_MODEL_LOOK` 對照表），新增BOSS時在那裡加一筆。

## 重建方式

- 動作製作（依序，每支讀前一支的 .blend）：`tools/boss4/anim/` 的 `rig_stage.py` → `a_thrust.py` → `a_slash.py` → `a_power.py` → `a_death.py` → `a_walkrun.py` → `finalize.py`。共用模組：`posekit.py`（世界軸旋轉、解析式兩骨 IK、`place_spear` 握點＋方向、`head_look` 視線）、`legkit.py`（四肢 IK、逐格烘焙、長矛穿模檢查）、`spearpath.py`（烘焙後逐格內插握點並自動外推避免穿模）、`ready.py`（備戰持槍）。
- 正式貼圖版：`blender -b --python tools/boss4/build_variant.py -- BOSS4.glb BOSS4_animated.blend BOSS4_rig.blend out.blend out.glb`（以 UV 把每個身體頂點對到 11-10 轉正網格的位置，再以剛體 ICP 對齊動畫骨架的靜止姿勢；長矛是沒有對應的 639 頂點，拉直、補握把、握點 43%、叉刃對齊）→ `rest_fix.py`（左手臂逐段 Kabsch 對齊、右拳平移到矛軸，用反向線性混合蒙皮把手臂拉回骨架的靜止姿勢）→ `game_export.py`（以四蹄置中後輸出遊戲 GLB）。頭像：`tools/boss4/render_portrait.py`（由 BOSS5 版改：腳要入鏡、從左前方取景）。
- 驗證：`node --test tests/boss4-character-asset.test.cjs`（56 關節、五動作秒數、長矛 100% 在 weapon_r、NPC 表外觀備註）；`node tools/boss4/verify-ingame.cjs out.png`（真正的遊戲頁面以 `Npc3D.create` 載入三版、逐動作擺姿截圖）。

## 已知限制

- 名稱仍是「鋼鐵魔像」、emoji 🤖、技能是衝鋒／震地，等使用者決定是否改成符合半人馬的名稱與技能。
- 沒有做戰鬥特效（如鬼面的眼光、噴火）；攻擊命中、傷害仍由模擬層決定。
- 第1、2套材質的長矛與手臂是由 11-10 轉正網格推得的，右拳以平移對齊矛軸，特寫下拳頭與矛桿可能有少量穿插。
