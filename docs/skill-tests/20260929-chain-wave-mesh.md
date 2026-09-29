# CHAIN-WAVE-MESH-20260929

## 原因與修正

當前金色 Preset 的 motionSpeed／motionAmplitude 不在檔案中，缺省0因此沒有動態波形。正式存檔往返測試通過；不能確認是舊分頁存檔或其他操作移除。補回12次／秒、40px動態幅度；紫色也調為40px。保留目前使用者對金色圖層尺寸、位置及靜態幅度的調整。

原Pixi網格依特效axis選擇17×5或5×17，但PNG旋轉90度後長度在另一個UV軸；金色圖層寬約1047px，裁切542px後只剩約2～3個有效內部縱向樣本。現在依實際變換矩陣決定密集取樣方向，裁切時將樣本分配至可見UV範圍；貼圖座標與幾何一對一，不拉伸，維持每層85個頂點。

## 修改與檢查

修改：js/vfx-pixi-backend.js、tests/vfx-pixi-sheet.test.cjs、tools/vfx/editor/index.html、金色及紫色bolt-chain-travel Preset、docs/AI_TASKS.md與本文件。素材原檔先同步至素材庫既有codex-authored/lightning/presets，提交de2df11。

檢查但未修改：js/vfx-core.js、js/battle-renderer.js、js/vfx-runtime.js、index.html、tools/vfx/editor/editor.js、vfx/asset-index.json、相關Core／deformation／editor測試。使用者配置表、NPC／技能資料及beam-light不納入。

## 驗證

- node --test tests/vfx-core.test.cjs tests/vfx-pixi-sheet.test.cjs tests/vfx-deformation.test.cjs tests/vfx-editor-code-controls.test.cjs：175通過，0失敗。
- 新增旋轉與裁切17點取樣、固定X時同時反向彎曲、正式金紫Preset透過Core到Pixi頂點的一秒動態測試；遊戲1/3縮放後主弧差異超過8px。涵蓋UV保形、尖端、暫停快取與重用。
- npm run build：404檔通過。
- node tools/vfx/export-assets.cjs --check：239 Preset、157素材已最新。
- 實機視覺驗證未完成：In-app browser無法附掛測試頁，非遊戲運行錯誤。上述為實際Core與Pixi後端頂點驗證，Pixi物件由測試替身提供。

## 未完成與交接

預檢發現Claude在改index.html與js/vfx-runtime.js。使用者指示等Claude改好且合併後才改，故本次不動這兩檔，也不合併或推送。

待Claude合併：將index.html的vfx-pixi-backend版本更新為20260929-wave-mesh；更新Runtime DATA_VERSION（建議20260929-chain-wave-mesh）並同步遊戲及編輯器引用的Runtime版本號。再重新載入遊戲及編輯器，避免舊分頁覆蓋新版Preset，完成低速實戰觀察。

本提交程式及素材可審查；完整交付仍待上述快取更新與實機觀察。遊戲commit見本文件首次提交。
