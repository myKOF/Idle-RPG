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
3. 劍的網格有 8 個三角面，其中一個頂點被錯綁到右手 65%＋右腿 35%，腿一動就被拉成一根長尖刺（揮劍時劍旁邊的尖刺）；
4. 披風下擺最末端的頂點整個綁在腿骨骼上，跨步時三角面被拉成一根根細絲 → 逐幀量測所有動作裡披風三角面被拉長的倍數，只刪除超過 4 倍的細絲（布料只准小幅伸縮；不重新綁權重，否則披風會黏在腿上）；
5a. 盔甲是硬質的、不能有形變，但 Meshy 的權重是柔性的（骨骼一轉盔甲就被拉扯壓扁，前臂護甲被壓成扁楔形）→ 不屬於布料的頂點，自己與所有相鄰頂點都以同一根骨骼為主的，改成 100% 單一骨骼（約 1,600 個頂點）；骨骼交界那一圈保留原權重（盔甲連成一整片，整塊綁死會在關節處撕成長條）。布料頂點清單：`images/models/hero3d/sunbrand-cloth.json`；
5b. 原動作右手腕扭轉最大 208°（人體手腕左右約 90°，多數時候不該轉）→ 把超過 60° 的扭轉搬到前臂（上限 90°），手的最終朝向與劍的方向不變；Attack2 轉身舉劍有 4 個關鍵幀仍到 96°（原動作需要約 186°，前臂＋手腕只能給到 150～180°）；
6. Attack2 的下劈在 t=1.24～1.30 手臂近乎水平（劍停在頭部高度＝平砍），之後往下再往後拉 → 重新設計右臂軌跡：舉到頭上不遠 → 劍尖掃過敵人肩高（約 1.5 m）到腰高（約 1.1 m）→ 收在斜下方約 0.5 m 保持（曲線在腳本 `CFG.Attack2.chop`）；手臂各段扭轉用瞄準＋參考幀偏移決定，手掌順著手臂、不亂轉。
`tools/meshy-pipeline/src/fix-grips.mjs` 直接改本檔內烘焙好的關鍵幀（不需要 Blender）。**重新從 Blender 匯出會蓋掉修正，匯出後要重新套用**：

```
node tools/meshy-pipeline/src/fix-grips.mjs <新匯出的.glb> images/models/hero3d/sunbrand-knight.glb
```

注意：輸入必須是「原始」動作；對已修過的檔再跑一次，結果不同。`tests/hero3d-battle-rules.test.cjs` 會量測目前的檔案，沒握好就失敗。

### 動作與披風（後續修正）

- Attack2 收招：t=1.46～1.70 全身平順回到起始姿勢（t=0.37），動作首尾相接；腳本 `CFG.Attack2.recover／startTime` 要和 `hero3d.js` 的 `CLIP_FOR.attack2.start／end` 一致（測試會檢查）。
- 披風穿模在播放時處理（`hero3d.js` 的 `buildCape`，說明見該函式上方註解）：不是模型檔的內容，換模型要確認布料頂點清單 `sunbrand-cloth.json` 仍然對得上。

### 改用 Meshy 動作庫的現成砍劈（2026-10-27）

手調 Attack2 軌跡（上面第 6 點）無法讓使用者滿意，改成直接用 Meshy 動作庫的動作（骨骼同名、直接套用）：
- Attack2（斜劈）：Double Combo Attack（action 92）1.74～2.82 秒；Attack3（平砍）：Reaping Swing（action 99）1.5～2.1 秒，兩段放在同一條 `Attack2` 動畫的 0.37 秒與 1.90 秒起（`CLIP_FOR.attack2／attack3`）。
- 取樣檔在 `tools/meshy-pipeline/src/data/meshy-*.json`，匯入、原地化、瞄準修正、跨步／下沉、收招回起始姿勢都在 `fix-grips.mjs`（`CFG.Attack2.meshy`）。
- 其餘候選（Charged Slash、Sword Judgment、Weapon Combo／1／2、Right-hand Sword Slash、Counterstrike、Dodge and Counter、Triple Combo Attack、Double Blade Spin、Charged Upward Slash）花了 39 點試過，未採用；任務編號見 `docs/AI_TASKS.md`。
- Attack1（2026-10-28）：使用者上傳的 Meshy 網頁動作 Sword Judgment 0.30～1.25 秒（右手單手劍，小跳躍→轉圈→斜砍），以世界旋轉差重新瞄準到本模型骨架，動作不改；只調 Sword 相對右手的旋轉。取樣檔 `tools/meshy-pipeline/src/data/meshy-sword-judgment.json`，匯入與握姿見 `fix-grips.mjs`（`CFG.Attack1.retarget`）。
- 護手（2026-10-28）：護手右翼端 11 個頂點在 Meshy 權重裡綁在右手而非劍，會讓護手一邊跟著手歪；`fix-grips.mjs` 的 `fixGuardWing` 改綁劍骨骼。
- Attack2（2026-10-28）：使用者上傳的 Meshy 網頁動作 Left Slash 0.30～1.55 秒（右手：上撩斜砍＋斜砍回位）重新瞄準到本模型，取代舊斜劈；取樣檔 `tools/meshy-pipeline/src/data/meshy-left-slash.json`。劍握姿＝劍身對準前臂＋繞劍身翻轉讓刀刃順著揮砍方向（`fitSwordGrip`）。
