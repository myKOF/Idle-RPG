# FIREGOD-SHARP-20260923

狀態：Done。使用者確認遊戲尺寸預覽並要求接入；素材庫commit 135a8a4；遊戲commit為本文件所在提交。

以程序化幾何繪製邊緣清晰的金橙火焰 sharp-flame.png，源碼存於素材庫 codex-authored/firegod/generate-sharp-flame.py。火核與細弧形尾焰使用新圖，舊的柔邊火焰保留低透明度底層。技能傷害、彈體數、碰撞、半徑8米、速度24米／秒、旋轉0.5圈／秒與射程50米未更動。

改動：vfx/presets/proj-firehunt-ring.json、同名layout、vfx/asset-index.json、vfx/shipped-assets.json、images/vfx/assets/codex-authored/firegod/sharp-flame.png、tools/vfx/authoring/author/projectiles.cjs、tools/vfx/authoring/vfx-catalog.cjs、js/vfx-runtime.js（資料快取）、index.html（程式快取）、tools/vfx/editor/firegod-review.html、tests/firegod-render.test.cjs、docs/AI_TASKS.md及本報告。素材庫同步Preset、layout、新圖及產生器。

唯讀檢查舊火焰PNG、火狩拖尾、Pixi backend、飛行軌道、素材掃描和匯出流程。驗證：相關測試38/38通過；build399檔通過；export-assets --check已最新；雙倉庫素材位元組一致；git diff --check通過。Pixi以遊戲大小檢視。全戰鬥場景高攻速效能與HUD遮擋待實機驗證。可合併，未合併／推送。
