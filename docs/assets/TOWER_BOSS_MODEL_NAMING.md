# 封魔塔BOSS 3D 模型命名規則

使用者要求（2026-11-16）：NPC 表裡封魔塔BOSS 的 3D 模型與動作名稱不統一，一律改成 BOSS1、BOSS2 這樣的檔名，動作一律用 Walk、Die、Attack1／2／3。

## 規則

- 檔名：`images/models/npc3d/bossN.glb`、`bossN_lv2.glb`、`bossN_lv3.glb`，N＝第幾隻封魔塔BOSS，lv2／lv3 是同一隻的第二、三階貼圖版。
- 動作（GLB 內的動畫名稱，也是 NPC 表 AC:AH 欄）：`Walk`（站立與移動共用）、`Attack1`、`Attack2`、`Attack3`、`Die`。
- 新增BOSS一律照此命名；`tests/npc3d-config.test.cjs` 的最後一項會擋下不符的檔名與動作名。

## 對照（2026-11-16 改名）

| 第幾隻 | 角色 | 新檔名 | 舊檔名 | 動作改名 |
| --- | --- | --- | --- | --- |
| 1 | 骷髏王 | `boss1.glb` | `boss1.glb` | 無（本來就是標準動作名） |
| 1 | 骷髏王Ⅱ | `boss1_lv2.glb` | `boss2.glb` | 無 |
| 1 | 骷髏王Ⅲ | `boss1_lv3.glb` | `boss3.glb` | 無 |
| 2 | 樹人 | `boss2.glb` | `treant.glb` | Unsteady_Walk→Walk、Weapon_Combo_2→Attack1、Attack→Attack2、Basic_Jump→Attack3、Shot_and_Fall_Forward→Die |
| 2 | 樹人Ⅱ／Ⅲ | `boss2_lv2.glb`／`boss2_lv3.glb` | `treant_lv2／lv3.glb` | 同上 |
| 3 | 雷霆巨獸（骷髏王Ⅲ） | `boss3.glb`／`boss3_lv2.glb`／`boss3_lv3.glb` | `boss3_character*.glb` | Running→Walk、Basic_Jump→Attack1、Right_Hand_Sword_Slash→Attack2、Shield_Push_Left→Attack3、Shot_and_Fall_Forward→Die |
| 5 | 鬼面 | `boss5.glb`／`boss5_lv2.glb`／`boss5_lv3.glb` | 同 | 本來就是 |

注意：`boss2.glb`、`boss3.glb` 這兩個檔名**原本是第1隻骷髏王的第二、三階**，現在分別是樹人與第3隻BOSS，舊版瀏覽器快取以 `?v=` 版號（`js/npc3d.js` 的 `VERSION`）區分，已換新。第4隻BOSS（製作中）將是 `boss4.glb`。

## 實作

- `tools/meshy-pipeline/src/normalize-tower-boss-models.cjs`：改名＋只改 GLB 的 JSON 區塊裡的動畫名稱（二進位網格、貼圖、動作內容逐位元不動），並同步素材庫各資產包的 `exports/`、`manifest.json`（路徑與 SHA-256）。原有的 `export-tower-*.cjs --check` 全部仍通過。
- 素材庫裡的 Blender 可編輯來源（.blend）與各資產包的說明文件保持原樣，裡面仍用舊檔名與舊動作名；`docs/assets/TOWER_*_SOURCE.md` 是當時的紀錄，以本文件的對照表為準。
- 立繪／頭像（`images/sprites/boss/boss_treant*.png`、`boss3_character*.png` 等）沒有改名（使用者只要求模型與動作）。
- 舊的製作腳本（`prepare_tower_*`、`package_tower_*`）仍輸出舊名稱；重新製作後要再跑上面的正規化工具。
