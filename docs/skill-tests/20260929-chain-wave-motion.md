# CHAIN-WAVE-MOTION-20260929：雷鏈動態波形

## 完成內容

原本每次施放只抽一次 phase、mirror、width，飛行時形狀固定。新增依總播放時間取樣的隨機波形：相鄰隨機形狀以 smoothstep 平滑過渡；所有變形圖層共用同一份狀態，避免亮芯、外光及分岔脫節。端點仍由包絡固定，沿用既有飛行、裁切及回收。

使用總時間而非幀數或循環內時間，確保同 seed 可重現、FPS 不影響波形、loop 不跳回、暫停不漂移。Pixi mesh 快取納入 motionTime，確保實際 GPU 頂點更新；停住時仍能重用快取。

VFX 編輯器「程式變形／隨機鏡射」自動由共用 DEFORMATION_FIELDS 顯示：

- 波形變化速度（次／秒；0 靜止）：`motionSpeed`。
- 動態波形幅度（px，上限為區間15%）：`motionAmplitude`。

兩個欄位預設 0，既有未啟用的特效行為不變。金色 `bolt-chain-travel-bluewhite` 與紫色 `bolt-chain-travel-bluewhite-08` 明列 12 次／秒、16 px。保留使用者當前的顏色、圖層位置／縮放、靜態振幅等調整，將這兩份正式素材完整保存。這是程序變形，不是替換原貼圖。

## 修改與檢查範圍

- 修改 Core、Pixi backend、Runtime 資料快取、兩個頁面快取、deformation／Pixi 測試、兩份 Preset、任務及本文件；納入使用者已建立的紫色 layout。
- 未改但檢查：`tools/vfx/editor/editor.js`（欄位自動生成）、`tests/vfx-editor-code-controls.test.cjs`、`tools/vfx/export-assets.cjs`、素材索引。
- 配置表、技能程式、NPC 資料、beam-light 的既有未提交修改不納入本次提交。

## 驗證與雙倉庫

- 衝突預檢通過。
- `node --test --test-reporter=tap tests/vfx-deformation.test.cjs tests/vfx-pixi-sheet.test.cjs tests/vfx-editor-code-controls.test.cjs`：32／32 通過。
- Core、上述測試與 Runtime 合跑：288 項，284 通過、4 項既有失敗。
- `node --test --test-reporter=tap "tests/vfx-*.test.cjs"`：996 項，979 通過、15 失敗、2 略過。失敗涵蓋素材建置、HIER-16、編輯器既有靜態檢查／記憶體、canonical／layout、投影及四项 Runtime 基準問題。
- 對失敗檔案以 HEAD Core／backend／Runtime／頁面及移除新欄位的原外觀覆蓋唯讀取樣重跑：399 項，383 通過、15 失敗、1 略過；15 個失敗名稱全部重現，無新增失敗。
- `npm run build`：404 檔通過；`git diff --check` 通過。
- `node tools/vfx/export-assets.cjs --check`：239 份 Preset、157 個引用素材，已是最新，不需更動匯出檔。兩張 spark PNG 的素材庫／正式匯出／索引 SHA-256 一致。
- 透過設定解析素材庫，保存至既有 `codex-authored/lightning/presets`、`layouts` 路徑；與遊戲檔案內容一致。素材庫先提交 **0b8d24d**，共享庫工作區乾淨。

## 交接

本次範圍完成，可獨立整合；基準測試非全綠，未重新進行瀏覽器實機視覺驗收。重新載入遊戲與 VFX 編輯器，使用新 Core／backend 及 Runtime 1.0.146、資料版本 `20260929-chain-wave-motion`。遊戲 Commit 見本文件首次提交。未合併或推送。
