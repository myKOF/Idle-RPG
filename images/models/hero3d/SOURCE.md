# 3D 主角模型：黃金騎士（Sunbrand Knight）

- 檔案：`sunbrand-knight.glb`（約 700 KB）：4911 個三角面、25 根骨骼、一張 1024×1024 貼圖、五個動畫（`CombatIdle`、`Run`、`Attack1`、`Attack2`、`Death`，24 fps）。
- **製作方式**：以 Meshy AI 生成（文字生圖 → 圖生 3D → 貼圖 → 綁骨架 → 動作庫動畫），再用 Blender 腳本處理（鏡像成右手持劍、修劍與披風權重、獨立劍骨骼、動作整理與修正）。
  完整流程、參數、任務編號與成本見 `tools/meshy-pipeline/README.md` 與其 `assets/Reports/`（Meshy 任務編號在 `cost-report.json`）。
- **與 AI_RULES 8.7.1 的關係**：該節規定今後 3D 模型以 MakeHuman＋Blender 製作。本模型是使用者在 2026-10-27 **明確指示**用 Meshy 管線做的內測用模型，
  不取代 `assets/characters/knight3d/` 的 MakeHuman 候選；兩者並存，切換由內測按鈕決定。
- **授權（待使用者確認）**：Meshy 的輸出授權取決於訂閱方案（付費方案的商用條款）；動作來自 Meshy 動作庫。
  使用者使用的是 Pro 方案，但我（Claude）無法替使用者確認條款，**正式版使用前必須由使用者確認 Meshy 當前條款允許本專案使用**。
  目前只在內測載入，正式版不載入此檔。
- 概念圖由 Meshy 的文字生圖以我們自己寫的描述產生，沒有使用或上傳任何參考圖；與參考圖的差異清單見 `tools/meshy-pipeline/specs/sunbrand-knight.spec.json`。
- 重新匯出遊戲版：
  ```
  blender --background --python tools/meshy-pipeline/blender/export_assets.py -- <processed.blend> <輸出資料夾> sunbrand-knight --max-texture 1024
  ```
