# 銀甲劍盾騎士：第一批 3D 動作候選

任務：KNIGHT-3D-BATCH1-20261023。此目錄供美術預覽與後續編輯，尚未接入遊戲，也沒有替換 `images/sprites/knight`。

使用者指定 Blender 製作；依遊戲中約 60～80 像素的站姿身高，以效能、輪廓及動作可讀性優先。模型保留銀甲、封閉頭盔、單手劍及鳶形盾；刪除小鉚釘、指節、細縫與刀光。不是寫實高模。

## 內容

- `knight_batch1.blend`：可編輯 Blender 5.2 模型、骨架、六段 Action 及預覽攝影棚；開啟後選取 KNIGHT_RIG，在 Action Editor 選擇動作，時間軸設為對應幀範圍。NLA 軌預設靜音，避免不同動作互相疊加。
- `knight_batch1.glb`：只含角色，排除地板、燈光與攝影機；六段具名骨架動畫，材質貼圖內嵌。
- `manifest.json`：模型統計、座標、幀率、動作長度及預覽取樣。

模型：**2,681 三角面、1,476 製作網格頂點、1 個蒙皮網格、1 個材質、16 根骨骼**。GLB 因 UV／法線分裂，匯出頂點數與製作頂點數可能不同；以 GLB accessor 為準。只有 1 個 mesh primitive；最終引擎的陰影及其他 pass 會影響實際 draw call。兩張 32×4 程序色盤（底色及金屬度／粗糙度），無外部貼圖依賴。這些是資產結構量測，並非已完成遊戲 GPU/FPS 驗收。

| 動作 | 幀數／fps | 長度 | 內容 |
| --- | --- | --- | --- |
| idle | 30 / 30 | 1 秒循環 | 呼吸、持盾待機 |
| walk | 15 / 30 | 0.5 秒循環 | 原地跑動，移動距離交由遊戲控制 |
| attack1 | 15 / 30 | 0.5 秒 | 舉劍、橫向斬擊、收招 |
| attack2 | 15 / 30 | 0.5 秒 | 下壓蓄勢、斜向上挑、收招 |
| cast | 15 / 30 | 0.5 秒 | 舉劍施法姿勢，無法術及刀光 |
| die | 30 / 30 | 1 秒 | 後仰倒地，保留末姿 |

`attack3` 可沿用 cast，`rise` 可倒播 die，本批未額外增加重複動畫資料。非循環 GIF 在末幀停留後重播，這個預覽停留時間不寫入模型動作。第一批為大致符合既有圖集的動作；未宣稱逐幀重現。正式上線前仍需確認命中／釋放時點、八方向、移動腳步及遊戲投影。

## 重建與預覽

在專案根目錄執行，將 `<Blender>` 換成安裝的 `blender.exe`，`<預覽目錄>` 使用專案外的絕對路徑：

```powershell
& '<Blender>' --background --factory-startup --python tools/knight3d/build_knight.py -- --output assets/characters/knight3d --preview '<預覽目錄>' --render none
& '<Blender>' --background --factory-startup --python tools/knight3d/render_batch.py -- --model assets/characters/knight3d/knight_batch1.blend --preview '<預覽目錄>'
python tools/knight3d/package_previews.py --preview '<預覽目錄>'
python tools/knight3d/validate_asset.py assets/characters/knight3d/knight_batch1.glb
node tools/knight3d/sync-library.cjs --apply
node tools/knight3d/sync-library.cjs --check
```

`render_batch.py --validate-only` 只檢查重開、六個 Action、骨架、貼圖內嵌、逐幀有限矩陣與最低頂點，不渲染。影片輸出使用 Blender Cycles；可用時啟用 CUDA，否則使用 CPU。Blender 產生的 `.blend1` 為備份，不屬交付包。

預覽包含六組獨立 GIF、六格大圖、約 80 像素站姿身高的小圖，以及 24 視角環繞。小圖是攝影棚渲染的縮圖，不是正式戰鬥整合驗收。GIF 不以放慢播放冒充更流暢的動作。

## 來源及保存

`images/sprites/knight` 六份既有圖集及 `knight.json` 僅供輪廓、裝備類型、姿勢及時間參考；未擷取、貼用、描摹圖集像素。幾何、材質色盤、骨架、動畫與攝影棚均由本任務程序原創；無第三方模型、材質或動畫匯入。字型只用於預覽文字，不嵌入模型。

本地素材庫位置由既有 `vfx-library-root.cjs` 解析；必要模型與腳本以穩定相對路徑保存至 `codex-authored/knight3d`，`sync-library.cjs --check` 逐檔核對 SHA256。這是候選製作包的保存流程，未改動正式角色圖集匯出器或出貨索引。動態預覽及逐幀 PNG 保存在聊天的 visualizations，未提交進遊戲或素材庫。

效能優先的後續方案可將此模型預先渲染為八方向圖集，沿用目前精靈播放方式；若改用即時 3D，需另行整合並實測蒙皮、繪製與陰影成本。本批沒有修改遊戲渲染路徑。
