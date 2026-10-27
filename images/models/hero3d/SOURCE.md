# 3D 主角模型：黃金騎士（Sunbrand Knight）

- 檔案：`sunbrand-knight.glb`（約 700 KB）：4903 個三角面（Meshy 原模型 4911 個，拿掉 8 個錯綁的尖刺三角面，見下方「動作修正」）、25 根骨骼、一張 1024×1024 貼圖、五個動畫（`CombatIdle`、`Run`、`Attack1`、`Attack2`、`Death`，24 fps）。
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

## 動作時間（`js/hero3d.js` 的 `CLIP_FOR` 依此取用有用的那一段）

量法：以 GLB 載入後逐幀（24 fps）取劍骨骼 `Sword` 的世界位移速度。

| 動作 | 全長 | 蓄力 | 揮劍 | 收招 | 取用區間（start→end） |
|---|---|---|---|---|---|
| Attack1 | 2.375 s | 0～0.8 s | 0.87～1.08 s（峰值 0.92 s） | 1.1～2.4 s | 0.62 → 1.75 s |
| Attack2 | 3.167 s | 0～0.5 s | 0.58～1.5 s（兩下，0.67 s 與 1.33 s） | 1.5～3.2 s | 0.37 → 1.75 s（施法 0.37 → 1.2 s） |
| Death | 2.75 s | | | | 整段（起身為倒著播） |
| Run | 0.625 s | | | | 循環 |
| CombatIdle | 1.667 s | | | | 循環 |

重新匯出或換動作後，這些數字要重量。

## 模型與動作修正（握劍、尖刺）

Meshy 原模型／動作有三處問題：
1. Attack1 劈下去時副手鬆開；2. Attack2 前伸時劍與前臂不成直線；
3. 劍的網格有 8 個三角面，其中一個頂點被錯綁到右手 65%＋右腿 35%，腿一動就被拉成一根長尖刺（揮劍時劍旁邊的尖刺）。
`tools/meshy-pipeline/src/fix-grips.mjs` 直接改本檔內烘焙好的關鍵幀（不需要 Blender）。**重新從 Blender 匯出會蓋掉修正，匯出後要重新套用**：

```
node tools/meshy-pipeline/src/fix-grips.mjs <新匯出的.glb> images/models/hero3d/sunbrand-knight.glb
```

注意：輸入必須是「原始」動作；對已修過的檔再跑一次，結果不同。`tests/hero3d-battle-rules.test.cjs` 會量測目前的檔案，沒握好就失敗。
