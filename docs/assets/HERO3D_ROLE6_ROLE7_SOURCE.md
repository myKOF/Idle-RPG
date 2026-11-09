# 六／七轉3D人物正式外觀（2026-11-09）

使用者提供Role7.glb並逐項確認本遊戲使用及修改授權，要求沿用六轉動作、製作新劍、拆下背盾；另明確選擇將已確認的六轉與新七轉一起正式接入。

## 來源與保留

- 六轉：沿用已確認候選GLB，SHA256 `a051e9dd30526b5934110e17d3d4a9a814e5eb30c85a371fac60584aaca09a1c`，不再改手姿或模型。原製作紀錄見[六轉保存版本](HERO3D_ROLE6_CANDIDATE.md)。素材庫原套件與專案候選副本保持不變。
- 七轉：使用者授權Role7.glb，SHA256 `43017e0faa6a242afb923741648882993b51807fea666566d344b1c54a556a01`。與原Role6同19670頂點及30501索引，索引／UV逐位一致，頂點差最大`2.98e-8m`；可完整使用已修好的六轉網格與動作。
- 新劍：本專案以Blender程序化自製七轉紅白金配色的銀刃、對稱翼形金銀護手、紅寶石及酒紅纏柄。不是外部劍網格；保留六轉握柄圓柱、柄尾與固定環尺寸，使原握點及原手指接觸保持。
- 七轉原baseColor、normal、metallicRoughness三張2048px貼圖原檔完整保存，未重畫、改色或重壓縮。base／MR為JPEG、normal為PNG。
- 0～5轉及原黃金騎士素材保持，未改玩家頭像、戰鬥、數值、解鎖或存檔資料格式。

## 遊戲行為

`Hero3D.skinForReincarnations`／`modelForReincarnations`於6轉選Role6，7轉以上選Role7。沿用既有當場換身體、輪廓、動作狀態保存與載入失敗保留目前人物的流程。主頁hero3d快取更新為`20261109-role6-role7-v1`；原內測3D開關與正式環境限制保持。

兩者均為右手正握劍、左前臂固定原盾；背盾已拆離原背部，盾長軸、70%短連桿、原手掌／獨立掌背甲、左拳與48度彎腕上限沿用六轉確認版。七轉的所有非武器頂點、法線、UV、權重、索引、25骨架與IBM逐位相同，六條動畫的全部取樣與插值方式也逐位相同；只替換原PBR三圖與新劍。

普攻仍隨機使用四招並避免連續同招；第三招仍是Attack2時間軸的後段，沒有新增或修改攻擊時序。Death保留原有放劍軌，不能以死亡期間劍／手相對移動判定攻擊握點失效。

## 素材庫與重建

使用`tools/vfx/vfx-library-root.cjs`解析本機素材庫根目錄，不在受管理設定內硬編碼本機路徑。

- 原六轉套件：`codex-authored/hero3d-role6-candidate-20261109`，素材提交`116aa9994f484a7fb81fa750ce1d73a9c6c6ce83`。
- 新七轉套件：`codex-authored/hero3d-role7-20261109`，含授權原Role7、可編輯人物／新劍Blend、七轉成品及原貼圖、製作／驗證工具、原生QA與SHA manifest。
- 新manifest以依賴引用原六轉套件，將其相同SHA檔案匯出到正式角色目錄；不更動原候選套件，也不以另一份來源取代它。

```powershell
node tools/meshy-pipeline/src/export-role7.cjs --check
node tools/meshy-pipeline/src/export-role7.cjs --apply
node tools/meshy-pipeline/src/export-role6-candidate.cjs --check
```

Blender4.5背景模式製作與驗證，以下大寫項目均為明確傳入的路徑：

```text
blender -b --python-exit-code 1 --python tools/meshy-pipeline/blender/build_role7_sword.py -- OUTPUT_DIRECTORY
blender -b --python-exit-code 1 --python tools/meshy-pipeline/blender/prepare_role7.py -- ROLE7_SOURCE ROLE6_SOURCE ROLE6_APPROVED ROLE6_REPORT NEW_SWORD OUTPUT_GLB OUTPUT_BLEND OUTPUT_REPORT
blender -b --python-exit-code 1 --python tools/meshy-pipeline/blender/validate_role7.py -- ROLE7_GLB ROLE7_REPORT ROLE7_BLEND ROLE6_PACKAGE NEW_SWORD RESULT_JSON
node tools/meshy-pipeline/src/validate-role6-motion.cjs images/models/hero3d/role7.glb RESULT_JSON
```

## 驗證與實際限制

新劍使用實際三角網格BVH檢查四指握柄接觸；最小間隙約0.079～0.176mm。全部攻擊握點在120Hz取樣的漂移小於`0.00000025m`，腕角最大48.044度。原生Blend重開六actions及三原圖打包通過，貼圖SHA及全部非武器幾何／動畫與六轉逐位核對通過。

新增角色資產／貼圖／動作回歸，以及5→6→7換模、同皮膚不重載、7／8共用皮膚、載入競態、失敗保留6轉與6／7轉開局存檔回歸。相關91項測試及Build700檔通過。

實際遊戲以隔離Edge／原生Worker的GM指令切換轉生數驗證，包含正常資源載入與重載；另故意阻擋七轉baseColor確認回退，該階段的404與回退警告為預期。高清預覽使用相同Hero3D／PBR與正式GLB、診斷鏡頭輸出1920×1080、30FPS、84幀Attack4；是放大的角色預覽，未聲稱為正式戰場鏡頭。最終GIF／近景留聊天，不把逐幀PNG、除錯腳本或臨時日誌當正式素材提交。

實機正常階段page error為0。第一次輔助驗證將「全部console warning必須為0」列為條件，因此在功能檢查已通過後，因既有音訊頻率限幅與一筆未使用預載提示停止。以HEAD原index／hero3d的唯讀覆蓋重新操作，重現同類音訊提示；預載提示確認為原index相同的dark-gold-seal宣告，短暫基準閒置沒有重現，不能稱兩者均逐次重現。最終QA分別保存功能通過與上述已知提示，沒有更改音訊、預載或產品程式配合驗證，也沒有宣稱console全淨。

六轉先前確認版本存在部分盾緣／肩甲、柄尾／護腕接觸，使用者接受目前外觀並允許盾略微穿模。這次不再改動該確認版；未宣稱全動作、所有動作間過渡或衣甲自身均無穿模，未做行動真機及長時間效能測試。
