# 六轉劍盾模型保留版本（2026-11-09）

使用者表示「好，暫時這樣吧，commit清理unstaged區」，因此保存目前確認的候選、製作器及來源。這是製作進度存檔；正式六轉選擇／快取、轉生條件、存檔與0～5轉人物均未修改。

## 來源與授權

- Role6.glb：使用者提供並逐項確認本遊戲使用及修改授權，SHA256 `cdfe8ccab67419b94dffb805a45b06d5370196dd21b43d36a8945a38a77be901`。
- 金甲原畫：使用者提供，已確認依圖製作授權；原檔及SHA保存在素材包。新劍由本專案Blender製作器生成，原畫未展示的厚度／背面作合理補足。
- 動作與握劍基準：沿用本專案已授權Role1六動作與Sword出刃方向；來源依賴副本與SHA保存在素材包。
- 手指／掌背甲／前臂甲與左盾：使用Role6原網格和原UV／材質調整；小型腕縫、劍與盾固定帶為自行製作。

## 保存位置

素材庫由 `tools/vfx/vfx-library-root.cjs` 解析。獨立套件為 `codex-authored/hero3d-role6-candidate-20261109`，含授權來源、可編輯人物／劍Blend、成品與三張2048px原貼圖、原握姿接觸基準、QA及逐項SHA清單。

專案候選副本為 `tools/meshy-pipeline/candidates/role6-20261109/`。主模型SHA256為 `a051e9dd30526b5934110e17d3d4a9a814e5eb30c85a371fac60584aaca09a1c`，GLB與旁載貼圖需一起保存。這個路徑未接到正式角色選擇入口。

```powershell
node tools/meshy-pipeline/src/export-role6-candidate.cjs --check
# 另一台電腦取得素材庫後可重建相同候選副本：
node tools/meshy-pipeline/src/export-role6-candidate.cjs --apply
```

## 製作與驗證

在Blender背景模式執行下列工具；路徑以命令參數提供，不依賴原桌面附件位置。

```text
blender -b --python-exit-code 1 --python tools/meshy-pipeline/blender/build_role6_sword.py -- OUTPUT_DIR REFERENCE_IMAGE
blender -b --python-exit-code 1 --python tools/meshy-pipeline/blender/prepare_role6.py -- ROLE6_SOURCE ROLE1_REFERENCE SWORD_GLB OUTPUT_GLB OUTPUT_BLEND OUTPUT_REPORT
blender -b --python-exit-code 1 --python tools/meshy-pipeline/blender/validate_role6_candidate.py -- PACKAGE_DIR ROLE1_REFERENCE RESULT_JSON
node tools/meshy-pipeline/src/validate-role6-motion.cjs CANDIDATE_GLB RESULT_JSON
```

`pose_role6_hands.py`及`limit_role6_wrists.py`由製作器載入。盾牌長軸平行左前臂，連桿縮短70%；人物的原手掌彎成右手正握／左拳，手背甲與前臂甲獨立。原拇指圓整並扣向食指，四指實際接觸點與已接受基準最大位移為0。原貼圖SHA、25骨架／IBM及非腕部動畫資料保持；雙Hand旋轉重取樣並保留軸向扭轉，限制彎腕48度。

獨立驗證包括實際劍柄BVH接觸、原四指接觸基準、原圖SHA、原生Blend六actions／三圖打包、120Hz攻擊握點漂移與腕角。最新1080p／30FPS／84幀Attack4 GIF仍保存在本聊天預覽，QA結論收入素材包。

## 待辦與限制

此提交只保存已確認的製作版本。正式六轉模型入口、快取同步、全動作及過渡避碰、實際轉生／讀檔回歸與行動裝置驗證仍待後續。舊檢查曾發現Attack1護腕／盾緣及Attack2柄尾／護腕接觸，不能宣稱全六動作無穿模。Death原有放劍軌保留；原畫手部精度不作已達成承諾。

本次未修改正式JS或解鎖功能，因此沒有玩家文字、表格、快取或LV行為變更，也沒有合併／推送develop或main。
