# 骷髏王Ⅱ材質版來源與交接

任務 `TOWER-BOSS2-LV2-20261108`，Codex，2026-11-08。使用者提供 `BOSS1_LV2.glb`，要求沿用先前五動作、重新拆劍綁骨，指定作第二個 BOSS，確認名稱「骷髏王Ⅱ」。使用者已確認同系列為自製／自行生成且可用於本遊戲與修改。新外觀取自這份 GLB，沒有以文字生成替代貼圖。

| 檔案 | SHA-256 |
| --- | --- |
| 使用者 BOSS1_LV2.glb | 9aca658fa82927d6dea44eda59c5d063ee9b93de447719225d3f7465bd178e63 |
| 已認可 boss1.glb 動作來源 | 2e945e89db9210f8ce18fc52a7d3f272cdeafb1eec7f626f116c8e5ad9e67fce |
| 匯出 boss2.glb | aadf8f4d14eecbd3bd90b3d92732a5bb3c85a2d377c93aee7214777cc3202ca9 |

## 模型製作

使用 Blender 5.2.3 LTS。新檔雖為相同表面，原始骨架及標準化身高不同；依原生表面對齊到已認可模型，比例為 1.052941327。逐三角面轉入新 PBR 材質與 UV：身體 7,821 面、披風 1,718 面、劍 436 面，無漏面或重複候選。保留已認可的 MakeHuman 銀色手套與黑色皮革握柄。

從新檔融合網格重新拆出 436 個劍面，合入已擬合的握柄，移除舊劍與舊 Sword_R，再建立獨立 Sword_R，父骨為 mixamorig:RightHand；整把劍 100% 單骨權重。模型仍沿用 BOSS1_Rig／Body／Cape／Sword 的共同內部名稱，檔案與 NPC 綁定獨立。

直接沿用已認可的 Walk、Attack1、Attack2、Attack3、Die 五動作及 135 根披風避碰骨。新來源的 Running 不採用。手部沿用先前使用者認可的握姿；手部來源為官方 MakeHuman MPFB CC0，版本 b1a2dc98776da9d1eea751b159d42cf61778fe2e，完整來源及參數見 [第一個 BOSS 交接](TOWER_BOSS1_3D_SOURCE.md)。本套件另保存同一手部 Blend、原始 CC0 檔及授權。

重建劍骨後，GLB 匯出可能改變其靜止軸表示；動作一致性須比較真正作用於蒙皮的 `pose × inverse(rest)`，不能直接比較原始四元數或骨軸。qa_tower_boss_variant.py 比對全部 194 骨、五動作的 1,363 個 60 Hz 樣本，最大矩陣元素誤差 0.00001711。獨立幾何 QA 中披風／身體交叉對數全為 0，披風最低 0.038 米、全劍最低 0.03438 米，握點誤差低於 0.000001 米。肩領最上方原接縫接觸區沿用第一版 QA 定義，不是即時布料或全身裝備碰撞。

## NPC 與遊戲

權威來源 `config/Excel/NPC.xlsx` → NPC 工作表第 **483** 列 `tower_boss_2`：

| 欄位 | 值 |
| --- | --- |
| 名稱 | 骷髏王Ⅱ |
| 四種圖像 G:J | sprites/boss/boss_skeleton_king_lv2.png |
| 3D模型 W | images/models/npc3d/boss2.glb |
| 站立／移動 X:Y | Walk／Walk |
| 攻擊1／2／3 Z:AB | Attack1／Attack2／Attack3 |
| 死亡 AC | Die |

站立沿用 Walk 首幀；五動作時長依序為 8.667、5.867、2.967、2.967、2.167 秒。遊戲攻擊按既有間隔播放，預覽為原速。沿用十種 BOSS 循環，因此第 2／12／22…層套用此定義。第一種與第三至十種保持原有配置。本次只改名稱、外觀、圖像及模型動作欄，不調整原第二種的冰屬性、技能、數值、解鎖或存檔。

使用原生 Excel 窄範圍更新 13 格，正常重開後比對兩張表共 24,550 格資料／公式及七個原生物件。匯出 NPC.csv，再以 config_tables 套用，只有 BOSS_LIST 一項語意改變；再次試跑為 0。NPC 名稱屬配置，不在 String 重複保存。使用者已同意與 Claude 2247d5e2 分段處理同列／快取，只套本次外觀，不合併該分支；其數值成果留在來源分支。

## 素材庫與重建

素材庫位置由 `tools/vfx/vfx-library-root.cjs` 解析。獨立套件 `codex-authored/tower-boss2-lv2-20261108/` 保存使用者原檔、已認可動作 GLB、可編輯 BOSS2_preview.blend、正式 GLB／透明頭像、製作工具與 QA；manifest 逐檔記錄 SHA。前一個 BOSS 的套件及匯出保持。

1. `node tools/meshy-pipeline/src/export-tower-boss2.cjs --check` 驗證來源／專案一致；`--apply` 才寫入匯出。
2. Blender 執行 `prepare_tower_boss_variant.py -- APPROVED.glb BOSS1_LV2.glb OUTPUT`，保存五動作 Blend／GLB。
3. Blender 執行 `qa_tower_boss_variant.py -- APPROVED.glb boss2.glb animation-qa.json`，另執行 `qa_tower_boss1.py -- boss2.glb geometry-qa.json` 檢查幾何及握點。
4. Blender 執行 `render_tower_boss1.py -- OUTPUT --npc tower_boss_2 --fps 20`；使用新的輸出目錄。以 `package_tower_boss1.py OUTPUT` 產出 1920×1200 五動作總覽與五份 1080×1144 GIF。工具沿用 BOSS1 的輸出檔名，NPC 選擇與來源 manifest 指向第二個模型。
5. `--portrait` 產出實際 GLB 的透明頭像；正式匯出改名為 boss_skeleton_king_lv2.png。原生 1080×1080 RGBA，alpha 0–255。

GIF／測試畫面及中間影格留在聊天預覽目錄，不進 Git；正式模型、頭像、編輯來源及 QA 納入雙倉庫。相關六份測試 37/37 通過，建置 690 檔通過；實際瀏覽器及雙庫提交結果記錄於 AI_TASKS。未驗證行動真機或長時間效能，披風為已烘焙動作的避碰。
